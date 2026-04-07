package com.codex.mcsroff.race;

import com.codex.mcsroff.McsroffRuntime;
import com.codex.mcsroff.auth.AuthSession;
import com.codex.mcsroff.match.MatchPhase;
import com.codex.mcsroff.match.MatchSession;
import com.codex.mcsroff.net.RemoteMatchPlayer;
import com.codex.mcsroff.net.RemoteMatchSnapshot;
import com.codex.mcsroff.ui.PreRaceCountdownScreen;
import com.codex.mcsroff.ui.WorldPreparationScreen;
import net.minecraft.client.Minecraft;
import net.minecraft.client.gui.screens.TitleScreen;

import java.util.List;
import java.util.concurrent.CompletableFuture;

public final class PreRaceController {
    private static final long POLL_INTERVAL_MILLIS = 900L;
    private static final long HEARTBEAT_INTERVAL_MILLIS = 4000L;
    private static final long REALTIME_FRESHNESS_MILLIS = 2500L;

    private MatchSession activeSession;
    private CompletableFuture<RemoteMatchSnapshot> pendingBackendFuture;
    private long nextPollAtMillis = -1L;
    private long nextHeartbeatAtMillis = -1L;
    private long countdownTargetMillis = -1L;
    private boolean worldLoadRequested;
    private boolean localWorldLoaded;
    private boolean localReadyLockedSent;
    private String localWorldStatusCode = "queued";
    private String opponentWorldStatusCode = "queued";
    private String localBackendStatus = "Waiting for world launch";
    private String abortReason = "";
    private boolean aborted;

    public void armLocalStart(MatchSession session) {
        if (session == null) {
            throw new IllegalArgumentException("Session is required");
        }

        this.activeSession = session;
        this.pendingBackendFuture = null;
        this.nextPollAtMillis = System.currentTimeMillis() + 200L;
        this.nextHeartbeatAtMillis = System.currentTimeMillis() + 500L;
        this.countdownTargetMillis = -1L;
        this.worldLoadRequested = false;
        this.localWorldLoaded = false;
        this.localReadyLockedSent = false;
        this.localWorldStatusCode = "queued";
        this.opponentWorldStatusCode = "queued";
        this.localBackendStatus = "Starting world generation";
        this.abortReason = "";
        this.aborted = false;
        this.activeSession.setPhase(MatchPhase.WORLD_CREATING);
        requestBeginWorldLoad();
    }

    public void onClientTick(Minecraft minecraft) {
        if (this.activeSession == null) {
            return;
        }

        long now = System.currentTimeMillis();
        consumeRealtimeSnapshot();
        consumeBackendResult();

        McsroffRuntime.getMatchRealtimeClient().ensureStreaming(this.activeSession.getMatchId());

        if (this.aborted || this.activeSession.getPhase() == MatchPhase.ABORTED) {
            McsroffRuntime.getMatchManager().updateCurrentPhase(MatchPhase.ABORTED);
            ensurePreparationScreen(minecraft);
            return;
        }

        if (!this.localWorldLoaded) {
            if (minecraft.level == null || minecraft.player == null) {
                if (this.pendingBackendFuture == null && now >= this.nextHeartbeatAtMillis) {
                    requestHeartbeat("Generating local world");
                }
                return;
            }

            this.localWorldLoaded = true;
            this.localWorldStatusCode = maxWorldStatus(this.localWorldStatusCode, "generated");
            this.localBackendStatus = "Local world loaded";
            this.activeSession.setPhase(MatchPhase.SPAWN_WAIT);
            requestWorldLoaded();
            ensurePreparationScreen(minecraft);
            return;
        }

        if (this.countdownTargetMillis > 0L) {
            McsroffRuntime.getMatchManager().updateCurrentPhase(MatchPhase.COUNTDOWN);
            ensureCountdownScreen(minecraft);
            if (now >= this.countdownTargetMillis) {
                McsroffRuntime.getMatchManager().updateCurrentPhase(MatchPhase.RUNNING);
                McsroffRuntime.getMatchManager().recordRunStarted(this.countdownTargetMillis > 0L ? this.countdownTargetMillis : now);
                if (minecraft.screen instanceof PreRaceCountdownScreen) {
                    minecraft.setScreen(null);
                }
                clearRuntimeState();
                return;
            }
        } else {
            ensurePreparationScreen(minecraft);
        }

        if (this.pendingBackendFuture == null && now >= this.nextHeartbeatAtMillis) {
            requestHeartbeat(this.countdownTargetMillis > 0L ? "Countdown synchronized" : "Waiting for opponent world");
            return;
        }

        if (shouldSendReadyLocked(minecraft)) {
            requestReadyLocked();
            return;
        }

        if (this.pendingBackendFuture == null && now >= this.nextPollAtMillis
                && !McsroffRuntime.getMatchRealtimeClient().isFresh(now, REALTIME_FRESHNESS_MILLIS)) {
            requestPoll();
        }
    }

    public boolean shouldFreezePlayer() {
        if (this.activeSession == null) {
            return false;
        }
        MatchPhase phase = this.activeSession.getPhase();
        return phase == MatchPhase.WORLD_CREATING || phase == MatchPhase.SPAWN_WAIT || phase == MatchPhase.COUNTDOWN;
    }

    public long getMillisRemaining() {
        if (!shouldFreezePlayer()) {
            return 0L;
        }
        return Math.max(0L, this.countdownTargetMillis - System.currentTimeMillis());
    }

    public int getCountdownSecondsRemaining() {
        long millis = getMillisRemaining();
        if (millis <= 0L) {
            return 0;
        }
        return (int) ((millis + 999L) / 1000L);
    }

    public MatchSession getActiveSession() {
        return this.activeSession;
    }

    public String getLocalWorldStatus() {
        return this.localBackendStatus;
    }

    public String getOpponentWorldStatus() {
        return humanizeWorldStatus(this.opponentWorldStatusCode);
    }

    public boolean isAborted() {
        return this.aborted || (this.activeSession != null && this.activeSession.getPhase() == MatchPhase.ABORTED);
    }

    public String getAbortReason() {
        return this.abortReason == null ? "" : this.abortReason;
    }

    public void quitAbortedMatch(Minecraft minecraft) {
        McsroffRuntime.getMatchRealtimeClient().stop();
        McsroffRuntime.getMatchManager().clearCurrentSession();
        clearRuntimeState();
        if (minecraft.level != null) {
            minecraft.level.disconnect();
        }
        minecraft.clearLevel();
        minecraft.setScreen(new TitleScreen());
    }

    private void requestWorldGenerated() {
        requestWorldLoaded();
    }

    private void requestBeginWorldLoad() {
        if (!McsroffRuntime.getAccountManager().hasTrustedSession()) {
            this.localBackendStatus = "Auth expired";
            return;
        }
        if (this.worldLoadRequested) {
            return;
        }
        this.worldLoadRequested = true;
        this.localWorldStatusCode = maxWorldStatus(this.localWorldStatusCode, "generating");
        this.localBackendStatus = "Registering world generation";
        this.pendingBackendFuture = McsroffRuntime.getAccountManager().executeAuthenticated(session ->
                McsroffRuntime.getBackendApi().beginWorldLoad(session, this.activeSession.getMatchId())
        );
        this.nextPollAtMillis = System.currentTimeMillis() + POLL_INTERVAL_MILLIS;
    }

    private void requestWorldLoaded() {
        if (!McsroffRuntime.getAccountManager().hasTrustedSession()) {
            this.localBackendStatus = "Auth expired";
            return;
        }
        this.localWorldStatusCode = maxWorldStatus(this.localWorldStatusCode, "generated");
        this.localBackendStatus = "Syncing loaded world";
        this.pendingBackendFuture = McsroffRuntime.getAccountManager().executeAuthenticated(session ->
                McsroffRuntime.getBackendApi().markWorldLoaded(session, this.activeSession.getMatchId())
        );
        this.nextPollAtMillis = System.currentTimeMillis() + POLL_INTERVAL_MILLIS;
    }

    private void requestReadyLocked() {
        if (!McsroffRuntime.getAccountManager().hasTrustedSession()) {
            this.localBackendStatus = "Auth expired";
            return;
        }
        this.localReadyLockedSent = true;
        this.localWorldStatusCode = maxWorldStatus(this.localWorldStatusCode, "ready");
        this.localBackendStatus = "Locking pre-race barrier";
        this.pendingBackendFuture = McsroffRuntime.getAccountManager().executeAuthenticated(session ->
                McsroffRuntime.getBackendApi().markReadyLocked(session, this.activeSession.getMatchId())
        );
        this.nextPollAtMillis = System.currentTimeMillis() + POLL_INTERVAL_MILLIS;
    }

    private void requestPoll() {
        if (!McsroffRuntime.getAccountManager().hasTrustedSession()) {
            this.localBackendStatus = "Auth expired";
            return;
        }
        this.pendingBackendFuture = McsroffRuntime.getAccountManager().executeAuthenticated(session ->
                McsroffRuntime.getBackendApi().pollMatch(session, this.activeSession.getMatchId())
        );
        this.nextPollAtMillis = System.currentTimeMillis() + POLL_INTERVAL_MILLIS;
    }

    private void requestHeartbeat(String statusText) {
        if (!McsroffRuntime.getAccountManager().hasTrustedSession()) {
            this.localBackendStatus = "Auth expired";
            return;
        }
        if (statusText != null && !statusText.isEmpty()) {
            this.localBackendStatus = statusText;
        }
        this.pendingBackendFuture = McsroffRuntime.getAccountManager().executeAuthenticated(session ->
                McsroffRuntime.getBackendApi().heartbeat(session, this.activeSession.getMatchId())
        );
        this.nextHeartbeatAtMillis = System.currentTimeMillis() + HEARTBEAT_INTERVAL_MILLIS;
        this.nextPollAtMillis = System.currentTimeMillis() + POLL_INTERVAL_MILLIS;
    }

    private void consumeBackendResult() {
        if (this.pendingBackendFuture == null || !this.pendingBackendFuture.isDone()) {
            return;
        }

        try {
            RemoteMatchSnapshot snapshot = this.pendingBackendFuture.join();
            applySnapshot(snapshot);
        } catch (Exception exception) {
            this.localBackendStatus = "Backend sync retrying";
            this.nextPollAtMillis = System.currentTimeMillis() + POLL_INTERVAL_MILLIS;
            this.nextHeartbeatAtMillis = System.currentTimeMillis() + HEARTBEAT_INTERVAL_MILLIS;
            if (this.localReadyLockedSent) {
                this.localReadyLockedSent = false;
            }
        } finally {
            this.pendingBackendFuture = null;
        }
    }

    private void consumeRealtimeSnapshot() {
        RemoteMatchSnapshot snapshot = McsroffRuntime.getMatchRealtimeClient().consumeLatestSnapshot();
        if (snapshot != null) {
            applySnapshot(snapshot);
        }
    }

    private void applySnapshot(RemoteMatchSnapshot snapshot) {
        if (snapshot == null) {
            this.localBackendStatus = "Waiting for backend sync";
            return;
        }

        if ("aborted".equalsIgnoreCase(snapshot.getState())) {
            this.aborted = true;
            this.countdownTargetMillis = -1L;
            this.localReadyLockedSent = false;
            this.opponentWorldStatusCode = "disconnected";
            this.abortReason = humanizeAbortReason(snapshot.getAbortReason());
            this.localBackendStatus = this.abortReason;
            this.activeSession.setPhase(MatchPhase.ABORTED);
            McsroffRuntime.getMatchRealtimeClient().stop();
            return;
        }

        AuthSession session = McsroffRuntime.getAccountManager().getCurrentSession();
        if (session == null) {
            this.localBackendStatus = "Auth expired";
            return;
        }

        List<RemoteMatchPlayer> players = snapshot.getPlayers();
        RemoteMatchPlayer localPlayer = null;
        RemoteMatchPlayer opponentPlayer = null;
        for (RemoteMatchPlayer player : players) {
            if (session.getUserId().equals(player.getPlayerId())) {
                localPlayer = player;
            } else {
                opponentPlayer = player;
            }
        }

        if (localPlayer != null) {
            this.localWorldStatusCode = maxWorldStatus(this.localWorldStatusCode, localPlayer.getWorldStatus());
            this.localBackendStatus = humanizeLocalWorldStatus(this.localWorldStatusCode);
        }
        if (opponentPlayer != null) {
            this.opponentWorldStatusCode = maxWorldStatus(this.opponentWorldStatusCode, opponentPlayer.getWorldStatus());
        }

        if (snapshot.getCountdownTargetEpochMillis() > 0L) {
            this.countdownTargetMillis = snapshot.getCountdownTargetEpochMillis();
            this.localBackendStatus = "Countdown synchronized";
            McsroffRuntime.getMatchManager().updateCurrentPhase(MatchPhase.COUNTDOWN);
            return;
        }

        this.nextPollAtMillis = System.currentTimeMillis() + POLL_INTERVAL_MILLIS;
        this.nextHeartbeatAtMillis = System.currentTimeMillis() + HEARTBEAT_INTERVAL_MILLIS;
    }

    private boolean shouldSendReadyLocked(Minecraft minecraft) {
        return this.localWorldLoaded
                && !this.localReadyLockedSent
                && worldStage(this.localWorldStatusCode) >= worldStage("generated")
                && worldStage(this.opponentWorldStatusCode) >= worldStage("generated")
                && this.countdownTargetMillis <= 0L
                && minecraft.screen instanceof WorldPreparationScreen
                && this.pendingBackendFuture == null;
    }

    private void ensurePreparationScreen(Minecraft minecraft) {
        if (!(minecraft.screen instanceof WorldPreparationScreen)) {
            minecraft.setScreen(new WorldPreparationScreen());
        }
    }

    private void ensureCountdownScreen(Minecraft minecraft) {
        if (!(minecraft.screen instanceof PreRaceCountdownScreen)) {
            minecraft.setScreen(new PreRaceCountdownScreen());
        }
    }

    private void clearRuntimeState() {
        this.activeSession = null;
        this.pendingBackendFuture = null;
        this.nextPollAtMillis = -1L;
        this.nextHeartbeatAtMillis = -1L;
        this.countdownTargetMillis = -1L;
        this.worldLoadRequested = false;
        this.localWorldLoaded = false;
        this.localReadyLockedSent = false;
        this.localWorldStatusCode = "queued";
        this.opponentWorldStatusCode = "queued";
        this.localBackendStatus = "Waiting for world launch";
        this.abortReason = "";
        this.aborted = false;
    }

    private static int worldStage(String status) {
        if (status == null) {
            return 0;
        }
        if ("ready".equalsIgnoreCase(status) || "Ready".equals(status)) {
            return 3;
        }
        if ("running".equalsIgnoreCase(status) || "Running".equals(status)) {
            return 4;
        }
        if ("finished".equalsIgnoreCase(status) || "Finished".equals(status)) {
            return 5;
        }
        if ("disconnected".equalsIgnoreCase(status) || "Disconnected".equals(status)) {
            return 6;
        }
        if ("generated".equalsIgnoreCase(status) || "Generated".equals(status)) {
            return 2;
        }
        if ("generating".equalsIgnoreCase(status) || "Generating world".equals(status)) {
            return 1;
        }
        return 0;
    }

    private static String maxWorldStatus(String left, String right) {
        return worldStage(right) >= worldStage(left) ? safeStatus(right) : safeStatus(left);
    }

    private static String safeStatus(String status) {
        return status == null || status.isEmpty() ? "queued" : status;
    }

    private static String humanizeLocalWorldStatus(String backendStatus) {
        if ("generating".equalsIgnoreCase(backendStatus)) {
            return "Generating local world";
        }
        if ("generated".equalsIgnoreCase(backendStatus)) {
            return "Waiting for opponent world";
        }
        if ("ready".equalsIgnoreCase(backendStatus)) {
            return "World locked and ready";
        }
        return humanizeWorldStatus(backendStatus);
    }

    private static String humanizeWorldStatus(String backendStatus) {
        if (backendStatus == null || backendStatus.isEmpty()) {
            return "Waiting";
        }
        if ("queued".equalsIgnoreCase(backendStatus)) {
            return "Waiting";
        }
        if ("generating".equalsIgnoreCase(backendStatus)) {
            return "Generating world";
        }
        if ("generated".equalsIgnoreCase(backendStatus)) {
            return "Generated";
        }
        if ("ready".equalsIgnoreCase(backendStatus)) {
            return "Ready";
        }
        if ("running".equalsIgnoreCase(backendStatus)) {
            return "Running";
        }
        if ("finished".equalsIgnoreCase(backendStatus)) {
            return "Finished";
        }
        if ("disconnected".equalsIgnoreCase(backendStatus)) {
            return "Disconnected";
        }
        return backendStatus;
    }

    private static String humanizeAbortReason(String backendReason) {
        if (backendReason == null || backendReason.isEmpty()) {
            return "Match unavailable";
        }
        if ("presence_timeout".equalsIgnoreCase(backendReason)) {
            return "Opponent disconnected";
        }
        if ("player_cancelled".equalsIgnoreCase(backendReason)) {
            return "Opponent cancelled";
        }
        if ("player_requeued".equalsIgnoreCase(backendReason)) {
            return "Opponent left queue";
        }
        return backendReason;
    }
}
