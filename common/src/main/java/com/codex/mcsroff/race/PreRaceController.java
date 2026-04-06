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

import java.util.List;
import java.util.concurrent.CompletableFuture;

public final class PreRaceController {
    private static final long POLL_INTERVAL_MILLIS = 900L;

    private MatchSession activeSession;
    private CompletableFuture<RemoteMatchSnapshot> pendingBackendFuture;
    private long nextPollAtMillis = -1L;
    private long countdownTargetMillis = -1L;
    private boolean localWorldGenerated;
    private boolean localReadySent;
    private String localWorldStatus = "Generating world";
    private String opponentWorldStatus = "Waiting";
    private String localBackendStatus = "Waiting for backend sync";

    public void armLocalStart(MatchSession session) {
        if (session == null) {
            throw new IllegalArgumentException("Session is required");
        }

        this.activeSession = session;
        this.pendingBackendFuture = null;
        this.nextPollAtMillis = System.currentTimeMillis() + 200L;
        this.countdownTargetMillis = -1L;
        this.localWorldGenerated = false;
        this.localReadySent = false;
        this.localWorldStatus = "Generating world";
        this.opponentWorldStatus = "Waiting";
        this.localBackendStatus = "Waiting for backend sync";
        this.activeSession.setPhase(MatchPhase.WORLD_CREATING);
    }

    public void onClientTick(Minecraft minecraft) {
        if (this.activeSession == null) {
            return;
        }

        long now = System.currentTimeMillis();
        consumeBackendResult();

        if (!this.localWorldGenerated) {
            if (minecraft.level == null || minecraft.player == null) {
                return;
            }

            this.localWorldGenerated = true;
            this.localWorldStatus = "Generated";
            this.localBackendStatus = "Local world generated";
            this.activeSession.setPhase(MatchPhase.SPAWN_WAIT);
            requestWorldGenerated();
            ensurePreparationScreen(minecraft);
            return;
        }

        if (this.countdownTargetMillis > 0L) {
            this.activeSession.setPhase(MatchPhase.COUNTDOWN);
            ensureCountdownScreen(minecraft);
            if (now >= this.countdownTargetMillis) {
                this.activeSession.setPhase(MatchPhase.RUNNING);
                if (minecraft.screen instanceof PreRaceCountdownScreen) {
                    minecraft.setScreen(null);
                }
                clearRuntimeState();
                return;
            }
        } else {
            ensurePreparationScreen(minecraft);
        }

        if (shouldSendReady()) {
            requestReady();
            return;
        }

        if (this.pendingBackendFuture == null && now >= this.nextPollAtMillis) {
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
        return this.opponentWorldStatus;
    }

    private void requestWorldGenerated() {
        if (!McsroffRuntime.getAccountManager().hasTrustedSession()) {
            this.localBackendStatus = "Auth expired";
            return;
        }
        this.pendingBackendFuture = McsroffRuntime.getAccountManager().executeAuthenticated(session ->
                McsroffRuntime.getBackendApi().markWorldGenerated(session, this.activeSession.getMatchId())
        );
        this.nextPollAtMillis = System.currentTimeMillis() + POLL_INTERVAL_MILLIS;
    }

    private void requestReady() {
        if (!McsroffRuntime.getAccountManager().hasTrustedSession()) {
            this.localBackendStatus = "Auth expired";
            return;
        }
        this.localReadySent = true;
        this.localBackendStatus = "Locking ready state";
        this.pendingBackendFuture = McsroffRuntime.getAccountManager().executeAuthenticated(session ->
                McsroffRuntime.getBackendApi().markReady(session, this.activeSession.getMatchId())
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
            if (this.localReadySent) {
                this.localReadySent = false;
            }
        } finally {
            this.pendingBackendFuture = null;
        }
    }

    private void applySnapshot(RemoteMatchSnapshot snapshot) {
        if (snapshot == null) {
            this.localBackendStatus = "Waiting for backend sync";
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
            this.localWorldStatus = humanizeWorldStatus(localPlayer.getWorldStatus());
            this.localBackendStatus = this.localWorldStatus;
        }
        if (opponentPlayer != null) {
            this.opponentWorldStatus = humanizeWorldStatus(opponentPlayer.getWorldStatus());
        }

        if (snapshot.getCountdownTargetEpochMillis() > 0L) {
            this.countdownTargetMillis = snapshot.getCountdownTargetEpochMillis();
            this.localBackendStatus = "Countdown synchronized";
            this.activeSession.setPhase(MatchPhase.COUNTDOWN);
            return;
        }

        this.nextPollAtMillis = System.currentTimeMillis() + POLL_INTERVAL_MILLIS;
    }

    private boolean shouldSendReady() {
        return this.localWorldGenerated
                && !this.localReadySent
                && worldStage(this.localWorldStatus) >= 2
                && worldStage(this.opponentWorldStatus) >= 2
                && this.countdownTargetMillis <= 0L
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
        this.countdownTargetMillis = -1L;
        this.localWorldGenerated = false;
        this.localReadySent = false;
        this.localWorldStatus = "Generating world";
        this.opponentWorldStatus = "Waiting";
        this.localBackendStatus = "Waiting for backend sync";
    }

    private static int worldStage(String status) {
        if (status == null) {
            return 0;
        }
        if ("Ready".equals(status)) {
            return 3;
        }
        if ("Generated".equals(status)) {
            return 2;
        }
        if ("Generating world".equals(status)) {
            return 1;
        }
        return 0;
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
}
