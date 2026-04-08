package com.codex.mcsroff.telemetry;

import com.codex.mcsroff.McsroffRuntime;
import com.codex.mcsroff.auth.AuthSession;
import com.codex.mcsroff.match.MatchOpponent;
import com.codex.mcsroff.match.MatchPhase;
import com.codex.mcsroff.match.MatchSession;
import com.codex.mcsroff.net.RemoteMatchEvent;
import com.codex.mcsroff.net.RemoteMatchPlayer;
import com.codex.mcsroff.net.RemoteMatchSnapshot;
import com.mojang.blaze3d.vertex.PoseStack;
import net.minecraft.ChatFormatting;
import net.minecraft.client.Minecraft;
import net.minecraft.client.server.IntegratedServer;
import net.minecraft.client.gui.Font;
import net.minecraft.network.chat.MutableComponent;
import net.minecraft.network.chat.TextComponent;
import net.minecraft.network.chat.TranslatableComponent;
import net.minecraft.resources.ResourceKey;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.world.level.Level;
import net.minecraft.world.level.GameType;
import net.minecraft.world.level.LevelSettings;
import net.minecraft.world.level.storage.PrimaryLevelData;
import net.minecraft.world.level.storage.WorldData;

import java.lang.reflect.Field;
import java.util.Iterator;
import java.util.List;
import java.util.Queue;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ConcurrentLinkedQueue;

public final class TelemetryManager {
    private static final long HEARTBEAT_INTERVAL_MILLIS = 4000L;
    private static final long REALTIME_FRESHNESS_MILLIS = 3500L;
    private static final long LOCAL_STATE_FORFEIT_GRACE_MILLIS = 5000L;
    private final Queue<LocalAdvancementUpdate> pendingAdvancements = new ConcurrentLinkedQueue<LocalAdvancementUpdate>();
    private final Queue<PendingActivityReport> pendingActivities = new ConcurrentLinkedQueue<PendingActivityReport>();

    private CompletableFuture<RemoteMatchSnapshot> pendingSnapshotFuture;
    private PendingActivityReport inFlightActivity;
    private long nextPollAtMillis = -1L;
    private long lastSeenEventSequence;
    private boolean startReported;
    private String lastDimensionKey = "";
    private String opponentStatus = "Started Match";
    private String lastReportedActivityKey = "";
    private long lastReportedActivityAtMillis;
    private boolean finishSubmissionInFlight;
    private boolean forfeitSubmissionInFlight;
    private boolean forfeitRequested;
    private long missingLocalStateSinceMillis = -1L;
    private String lastResolvedMatchId = "";

    public void onClientTick(Minecraft minecraft) {
        MatchSession session = McsroffRuntime.getMatchManager().getCurrentSession();
        if (session == null || session.getPhase() != MatchPhase.RUNNING) {
            clearRuntimeState();
            return;
        }
        if (minecraft == null) {
            return;
        }
        if (minecraft.player == null || minecraft.level == null) {
            long now = System.currentTimeMillis();
            if (this.missingLocalStateSinceMillis < 0L) {
                this.missingLocalStateSinceMillis = now;
            }
            if (now - this.missingLocalStateSinceMillis >= LOCAL_STATE_FORFEIT_GRACE_MILLIS) {
                requestForfeit(session);
            }
            return;
        }
        this.missingLocalStateSinceMillis = -1L;

        McsroffRuntime.getMatchRealtimeClient().ensureStreaming(session.getMatchId());
        consumeRealtimeSnapshot(minecraft, session);
        consumeBackendResult(minecraft, session);
        flushLocalSignals(minecraft, session);

        long now = System.currentTimeMillis();
        if (this.pendingSnapshotFuture == null
                && this.pendingActivities.isEmpty()
                && now >= this.nextPollAtMillis
                && !McsroffRuntime.getMatchRealtimeClient().isFresh(now, REALTIME_FRESHNESS_MILLIS)) {
            requestPoll(session);
        }
    }

    public void renderHud(PoseStack poseStack, Minecraft minecraft) {
        MatchSession session = McsroffRuntime.getMatchManager().getCurrentSession();
        if (session == null || session.getPhase() != MatchPhase.RUNNING || minecraft == null || minecraft.options.hideGui) {
            return;
        }

        MatchOpponent opponent = session.getOpponent();
        Font font = minecraft.font;
        String title = "Current Match";
        String mode = getMatchTypeLabel(session);
        String opponentLine = opponent != null ? opponent.getName() : "Opponent";
        String statusLine = this.opponentStatus == null || this.opponentStatus.isEmpty() ? "Started Match" : this.opponentStatus;

        int guiHeight = minecraft.getWindow().getGuiScaledHeight();
        int right = minecraft.getWindow().getGuiScaledWidth() - 8;
        int y = Math.max(18, (guiHeight / 2) - 42);
        drawRightAligned(font, poseStack, title, right, y, 0xFFE9D35B, true);
        drawRightAligned(font, poseStack, mode, right, y + 12, 0xFFFFFFFF, true);
        drawRightAligned(font, poseStack, opponentLine, right, y + 24, 0xFF75C7FF, true);
        drawRightAligned(font, poseStack, statusLine, right, y + 36, 0xFFC9B6FF, true);
    }

    public void recordAwardedAdvancement(String advancementId, String frameType, String title) {
        if (advancementId == null || advancementId.isEmpty() || title == null || title.isEmpty()) {
            return;
        }
        this.pendingAdvancements.add(new LocalAdvancementUpdate(advancementId, normalizeAdvancementFrame(frameType), title));
    }

    public boolean isLiveMatchRunning() {
        MatchSession session = McsroffRuntime.getMatchManager().getCurrentSession();
        return session != null && session.getPhase() == MatchPhase.RUNNING;
    }

    public void reportLocalPortalFinish() {
        MatchSession session = McsroffRuntime.getMatchManager().getCurrentSession();
        if (session == null || session.getPhase() != MatchPhase.RUNNING) {
            return;
        }
        submitFinish(session);
    }

    private void flushLocalSignals(Minecraft minecraft, MatchSession session) {
        if (!this.startReported) {
            enqueueActivity("activity", "started_match", "Started Match", "", "");
            this.startReported = true;
        }

        String dimensionKey = getDimensionKey(minecraft.level.dimension());
        if (!dimensionKey.equals(this.lastDimensionKey)) {
            this.lastDimensionKey = dimensionKey;
            if ("minecraft:the_nether".equals(dimensionKey)) {
                enqueueActivity("activity", "entered_nether", "Entered Nether", "", "");
            }
            if ("minecraft:the_end".equals(dimensionKey)) {
                enqueueActivity("activity", "in_the_end", "In the End", "", "");
            }
        }

        LocalAdvancementUpdate update = this.pendingAdvancements.poll();
        if (update != null) {
            String statusText = mapStatusFromAdvancement(update.getAdvancementId());
            enqueueActivity(
                    "advancement:" + update.getFrameType(),
                    update.getAdvancementId(),
                    statusText,
                    update.getTitle(),
                    update.getAdvancementId()
            );
        }

        if (this.pendingSnapshotFuture == null) {
            dispatchNextActivity(session);
        }
    }

    private void requestPoll(MatchSession session) {
        if (!McsroffRuntime.getAccountManager().hasTrustedSession()) {
            return;
        }
        this.pendingSnapshotFuture = McsroffRuntime.getAccountManager().executeAuthenticated(authSession ->
                McsroffRuntime.getBackendApi().heartbeat(authSession, session.getMatchId())
        );
        this.nextPollAtMillis = System.currentTimeMillis() + HEARTBEAT_INTERVAL_MILLIS;
    }

    private void dispatchNextActivity(MatchSession session) {
        PendingActivityReport next = this.pendingActivities.peek();
        if (next == null || !McsroffRuntime.getAccountManager().hasTrustedSession()) {
            return;
        }
        this.inFlightActivity = next;
        reportActivity(session, next);
    }

    private void enqueueActivity(String type, String activityKey, String statusText, String chatMessage, String advancementId) {
        PendingActivityReport next = new PendingActivityReport(type, activityKey, statusText, chatMessage, advancementId);
        PendingActivityReport current = this.inFlightActivity;
        if (current != null && current.samePayload(next)) {
            return;
        }
        Iterator<PendingActivityReport> iterator = this.pendingActivities.iterator();
        while (iterator.hasNext()) {
            if (iterator.next().samePayload(next)) {
                return;
            }
        }
        this.pendingActivities.add(next);
    }

    private void reportActivity(MatchSession session, PendingActivityReport activity) {
        if (!McsroffRuntime.getAccountManager().hasTrustedSession()) {
            return;
        }
        if (activity == null) {
            return;
        }
        String activityKey = activity.getActivityKey();
        String statusText = activity.getStatusText();
        if (statusText != null && !statusText.isEmpty() && activityKey != null && activityKey.equals(this.lastReportedActivityKey)) {
            long now = System.currentTimeMillis();
            if (now - this.lastReportedActivityAtMillis < 1500L) {
                return;
            }
        }

        if (!statusText.isEmpty()) {
            this.lastReportedActivityKey = activityKey;
            this.lastReportedActivityAtMillis = System.currentTimeMillis();
        }

        this.pendingSnapshotFuture = McsroffRuntime.getAccountManager().executeAuthenticated(authSession ->
                McsroffRuntime.getBackendApi().reportActivity(
                        authSession,
                        session.getMatchId(),
                        activity.getType(),
                        activityKey,
                        statusText,
                        activity.getChatMessage(),
                        activity.getAdvancementId()
                )
        );
        this.nextPollAtMillis = System.currentTimeMillis() + HEARTBEAT_INTERVAL_MILLIS;
    }

    private void submitFinish(MatchSession session) {
        if (session == null || session.isFinishReported() || !McsroffRuntime.getAccountManager().hasTrustedSession()) {
            return;
        }

        long now = System.currentTimeMillis();
        long startedAt = session.getRunStartedAtMillis();
        long finishTimeMs = startedAt > 0L ? Math.max(0L, now - startedAt) : 0L;
        session.setFinishReported(true);
        McsroffRuntime.getMatchManager().updateFinishReported(true);
        this.finishSubmissionInFlight = true;
        this.pendingSnapshotFuture = McsroffRuntime.getAccountManager().executeAuthenticated(authSession ->
                McsroffRuntime.getBackendApi().reportFinish(authSession, session.getMatchId(), finishTimeMs)
        );
        this.nextPollAtMillis = now + HEARTBEAT_INTERVAL_MILLIS;
    }

    private void consumeBackendResult(Minecraft minecraft, MatchSession session) {
        if (this.pendingSnapshotFuture == null || !this.pendingSnapshotFuture.isDone()) {
            return;
        }

        try {
            RemoteMatchSnapshot snapshot = this.pendingSnapshotFuture.join();
            if (this.inFlightActivity != null) {
                PendingActivityReport head = this.pendingActivities.peek();
                if (head != null && head.samePayload(this.inFlightActivity)) {
                    this.pendingActivities.poll();
                }
            }
            applySnapshot(minecraft, session, snapshot);
        } catch (Exception exception) {
            if (this.finishSubmissionInFlight) {
                session.setFinishReported(false);
                McsroffRuntime.getMatchManager().updateFinishReported(false);
            }
            if (this.forfeitSubmissionInFlight) {
                this.forfeitRequested = false;
            }
            this.nextPollAtMillis = System.currentTimeMillis() + HEARTBEAT_INTERVAL_MILLIS;
        } finally {
            this.finishSubmissionInFlight = false;
            this.forfeitSubmissionInFlight = false;
            this.inFlightActivity = null;
            this.pendingSnapshotFuture = null;
        }
    }

    private void consumeRealtimeSnapshot(Minecraft minecraft, MatchSession session) {
        RemoteMatchSnapshot snapshot = McsroffRuntime.getMatchRealtimeClient().consumeLatestSnapshot();
        if (snapshot != null) {
            applySnapshot(minecraft, session, snapshot);
        }
    }

    private void applySnapshot(Minecraft minecraft, MatchSession session, RemoteMatchSnapshot snapshot) {
        if (snapshot == null) {
            return;
        }

        AuthSession authSession = McsroffRuntime.getAccountManager().getCurrentSession();
        String localUserId = authSession != null ? authSession.getUserId() : "";
        RemoteMatchPlayer opponentPlayer = null;
        for (RemoteMatchPlayer player : snapshot.getPlayers()) {
            if (!localUserId.isEmpty() && !localUserId.equals(player.getPlayerId())) {
                opponentPlayer = player;
                break;
            }
        }

        if (opponentPlayer != null && opponentPlayer.getActivityStatus() != null && !opponentPlayer.getActivityStatus().isEmpty()) {
            this.opponentStatus = opponentPlayer.getActivityStatus();
        }

        if ("finished".equalsIgnoreCase(snapshot.getState())) {
            showWinnerResult(minecraft, snapshot);
            applyPostMatchState(minecraft);
            McsroffRuntime.getMatchManager().updateCurrentPhase(MatchPhase.FINISHED);
            McsroffRuntime.getMatchRealtimeClient().stop();
        } else if ("aborted".equalsIgnoreCase(snapshot.getState())) {
            McsroffRuntime.getMatchManager().updateCurrentPhase(MatchPhase.ABORTED);
            McsroffRuntime.getMatchRealtimeClient().stop();
        }

        List<RemoteMatchEvent> events = snapshot.getEvents();
        for (RemoteMatchEvent event : events) {
            if (event.getSequence() <= this.lastSeenEventSequence) {
                continue;
            }
            this.lastSeenEventSequence = event.getSequence();
            if (localUserId.equals(event.getPlayerId())) {
                continue;
            }
            if (isAdvancementEvent(event) && event.getChatMessage() != null && !event.getChatMessage().isEmpty()) {
                appendOpponentAdvancementToChat(minecraft, session, event);
            }
        }

        this.nextPollAtMillis = System.currentTimeMillis() + HEARTBEAT_INTERVAL_MILLIS;
    }

    private void appendOpponentAdvancementToChat(Minecraft minecraft, MatchSession session, RemoteMatchEvent event) {
        if (minecraft.gui == null || minecraft.gui.getChat() == null) {
            return;
        }

        MatchOpponent opponent = session.getOpponent();
        String opponentName = opponent != null && opponent.getName() != null && !opponent.getName().isEmpty()
                ? opponent.getName()
                : "Opponent";
        String frameType = extractAdvancementFrameType(event.getType());
        MutableComponent message = new TranslatableComponent(
                "chat.type.advancement." + frameType,
                new TextComponent(opponentName),
                new TextComponent(event.getChatMessage())
        ).withStyle(ChatFormatting.GRAY);
        minecraft.gui.getChat().addMessage(message);
    }

    private void clearRuntimeState() {
        this.pendingSnapshotFuture = null;
        this.inFlightActivity = null;
        this.nextPollAtMillis = -1L;
        this.lastSeenEventSequence = 0L;
        this.startReported = false;
        this.lastDimensionKey = "";
        this.opponentStatus = "Started Match";
        this.lastReportedActivityKey = "";
        this.lastReportedActivityAtMillis = 0L;
        this.finishSubmissionInFlight = false;
        this.forfeitSubmissionInFlight = false;
        this.forfeitRequested = false;
        this.missingLocalStateSinceMillis = -1L;
        this.lastResolvedMatchId = "";
        this.pendingAdvancements.clear();
        this.pendingActivities.clear();
    }

    private void requestForfeit(MatchSession session) {
        if (session == null || this.forfeitRequested || this.finishSubmissionInFlight || this.forfeitSubmissionInFlight) {
            return;
        }
        if (!McsroffRuntime.getAccountManager().hasTrustedSession()) {
            this.forfeitRequested = true;
            return;
        }

        this.forfeitRequested = true;
        this.forfeitSubmissionInFlight = true;
        this.pendingSnapshotFuture = McsroffRuntime.getAccountManager().executeAuthenticated(authSession ->
                McsroffRuntime.getBackendApi().forfeitMatch(authSession, session.getMatchId())
        );
        this.nextPollAtMillis = System.currentTimeMillis() + HEARTBEAT_INTERVAL_MILLIS;
    }

    private static String getMatchTypeLabel(MatchSession session) {
        if (session.getSeedAssignment() != null && session.getSeedAssignment().getSeedMode() != null && session.getSeedAssignment().getSeedMode().name().equals("PRACTICE")) {
            return "Practice";
        }
        return "Ranked";
    }

    private static String getDimensionKey(ResourceKey<Level> dimension) {
        return dimension == null || dimension.location() == null ? "" : dimension.location().toString();
    }

    private static String mapStatusFromAdvancement(String advancementId) {
        if ("minecraft:story/enter_the_nether".equals(advancementId)) {
            return "Entered Nether";
        }
        if ("minecraft:nether/find_fortress".equals(advancementId)) {
            return "Finding Fortress";
        }
        if ("minecraft:nether/find_bastion".equals(advancementId) || "minecraft:nether/loot_bastion".equals(advancementId)) {
            return "Finding Bastion";
        }
        if ("minecraft:story/follow_ender_eye".equals(advancementId)) {
            return "Finding Stronghold";
        }
        if ("minecraft:end/kill_dragon".equals(advancementId)) {
            return "Dragon Down";
        }
        return "";
    }

    private void showWinnerResult(Minecraft minecraft, RemoteMatchSnapshot snapshot) {
        if (minecraft == null || minecraft.gui == null || snapshot == null || snapshot.getMatchId() == null || snapshot.getMatchId().isEmpty()) {
            return;
        }
        if (snapshot.getMatchId().equals(this.lastResolvedMatchId)) {
            return;
        }

        RemoteMatchPlayer winner = null;
        if (snapshot.getWinnerPlayerId() != null && !snapshot.getWinnerPlayerId().isEmpty()) {
            for (RemoteMatchPlayer player : snapshot.getPlayers()) {
                if (snapshot.getWinnerPlayerId().equals(player.getPlayerId())) {
                    winner = player;
                    break;
                }
            }
        }
        if (winner == null) {
            for (RemoteMatchPlayer player : snapshot.getPlayers()) {
                if ("win".equalsIgnoreCase(player.getResult())) {
                    winner = player;
                    break;
                }
            }
        }
        if (winner == null) {
            return;
        }

        String title = winner.getDisplayName() + " wins";
        String subtitle = winner.getFinishTimeMs() > 0L
                ? "Winner Time " + formatRaceTime(winner.getFinishTimeMs())
                : "Match complete";
        minecraft.gui.setTitles(new TextComponent(title), new TextComponent(subtitle), 0, 80, 20);
        this.lastResolvedMatchId = snapshot.getMatchId();
    }

    private void applyPostMatchState(Minecraft minecraft) {
        if (minecraft == null) {
            return;
        }
        IntegratedServer server = minecraft.getSingleplayerServer();
        if (server == null || minecraft.player == null) {
            return;
        }
        server.execute(() -> {
            ServerPlayer serverPlayer = server.getPlayerList().getPlayer(minecraft.player.getUUID());
            if (serverPlayer != null) {
                serverPlayer.setGameMode(GameType.SPECTATOR);
            }
            enableLocalCommands(server);
        });
    }

    private void enableLocalCommands(IntegratedServer server) {
        if (server == null) {
            return;
        }
        try {
            WorldData worldData = server.getWorldData();
            if (!(worldData instanceof PrimaryLevelData)) {
                return;
            }
            PrimaryLevelData primaryLevelData = (PrimaryLevelData) worldData;
            if (primaryLevelData.getAllowCommands()) {
                return;
            }

            LevelSettings current = primaryLevelData.getLevelSettings();
            LevelSettings updated = new LevelSettings(
                    current.levelName(),
                    current.gameType(),
                    current.hardcore(),
                    current.difficulty(),
                    true,
                    current.gameRules(),
                    current.getDataPackConfig()
            );
            Field settingsField = PrimaryLevelData.class.getDeclaredField("settings");
            settingsField.setAccessible(true);
            settingsField.set(primaryLevelData, updated);
        } catch (Throwable ignored) {
        }
    }

    private static String formatRaceTime(long totalMillis) {
        long millis = Math.max(0L, totalMillis);
        long hours = millis / 3600000L;
        millis %= 3600000L;
        long minutes = millis / 60000L;
        millis %= 60000L;
        long seconds = millis / 1000L;
        long remainingMillis = millis % 1000L;
        if (hours > 0L) {
            return String.format("%d:%02d:%02d.%03d", hours, minutes, seconds, remainingMillis);
        }
        return String.format("%02d:%02d.%03d", minutes, seconds, remainingMillis);
    }

    private static boolean isAdvancementEvent(RemoteMatchEvent event) {
        return event != null
                && event.getType() != null
                && event.getType().toLowerCase().startsWith("advancement");
    }

    private static String extractAdvancementFrameType(String type) {
        if (type == null) {
            return "task";
        }
        int separatorIndex = type.indexOf(':');
        if (separatorIndex < 0 || separatorIndex >= type.length() - 1) {
            return "task";
        }
        return normalizeAdvancementFrame(type.substring(separatorIndex + 1));
    }

    private static String normalizeAdvancementFrame(String frameType) {
        if ("challenge".equalsIgnoreCase(frameType)) {
            return "challenge";
        }
        if ("goal".equalsIgnoreCase(frameType)) {
            return "goal";
        }
        return "task";
    }

    private static void drawRightAligned(Font font, PoseStack poseStack, String text, int rightX, int y, int color, boolean shadow) {
        if (text == null || text.isEmpty()) {
            return;
        }
        float x = rightX - font.width(text);
        if (shadow) {
            font.drawShadow(poseStack, text, x, y, color);
            return;
        }
        font.draw(poseStack, text, x, y, color);
    }
}
