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
import net.minecraft.client.gui.Font;
import net.minecraft.network.chat.MutableComponent;
import net.minecraft.network.chat.TextComponent;
import net.minecraft.resources.ResourceKey;
import net.minecraft.world.level.Level;

import java.util.Iterator;
import java.util.List;
import java.util.Queue;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ConcurrentLinkedQueue;

public final class TelemetryManager {
    private static final long HEARTBEAT_INTERVAL_MILLIS = 4000L;
    private static final long REALTIME_FRESHNESS_MILLIS = 3500L;
    private final Queue<LocalAdvancementUpdate> pendingAdvancements = new ConcurrentLinkedQueue<LocalAdvancementUpdate>();

    private CompletableFuture<RemoteMatchSnapshot> pendingSnapshotFuture;
    private long nextPollAtMillis = -1L;
    private long lastSeenEventSequence;
    private boolean startReported;
    private String lastDimensionKey = "";
    private String opponentStatus = "Started Match";
    private String lastReportedActivityKey = "";
    private long lastReportedActivityAtMillis;
    private boolean finishSubmissionInFlight;

    public void onClientTick(Minecraft minecraft) {
        MatchSession session = McsroffRuntime.getMatchManager().getCurrentSession();
        if (session == null || session.getPhase() != MatchPhase.RUNNING) {
            clearRuntimeState();
            return;
        }
        if (minecraft == null || minecraft.player == null || minecraft.level == null) {
            return;
        }

        McsroffRuntime.getMatchRealtimeClient().ensureStreaming(session.getMatchId());
        consumeRealtimeSnapshot(minecraft, session);
        consumeBackendResult(minecraft, session);
        if (this.pendingSnapshotFuture == null) {
            flushLocalSignals(minecraft, session);
        }

        long now = System.currentTimeMillis();
        if (this.pendingSnapshotFuture == null
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

        int right = minecraft.getWindow().getGuiScaledWidth() - 6;
        int y = 8;
        drawRightAligned(font, poseStack, title, right, y, 0xFFE9D35B, true);
        drawRightAligned(font, poseStack, mode, right, y + 12, 0xFFFFFFFF, true);
        drawRightAligned(font, poseStack, opponentLine, right, y + 24, 0xFF75C7FF, true);
        drawRightAligned(font, poseStack, statusLine, right, y + 36, 0xFFC9B6FF, true);
    }

    public void recordAwardedAdvancement(String advancementId, String title) {
        if (advancementId == null || advancementId.isEmpty() || title == null || title.isEmpty()) {
            return;
        }
        this.pendingAdvancements.add(new LocalAdvancementUpdate(advancementId, title));
    }

    private void flushLocalSignals(Minecraft minecraft, MatchSession session) {
        if (!this.startReported) {
            reportActivity(session, "activity", "started_match", "Started Match", "", "");
            this.startReported = true;
            return;
        }

        String dimensionKey = getDimensionKey(minecraft.level.dimension());
        if (!dimensionKey.equals(this.lastDimensionKey)) {
            this.lastDimensionKey = dimensionKey;
            if ("minecraft:the_nether".equals(dimensionKey)) {
                reportActivity(session, "activity", "entered_nether", "Entered Nether", "", "");
                return;
            }
            if ("minecraft:the_end".equals(dimensionKey)) {
                reportActivity(session, "activity", "in_the_end", "In the End", "", "");
                return;
            }
        }

        LocalAdvancementUpdate update = this.pendingAdvancements.poll();
        if (update != null) {
            if ("minecraft:end/kill_dragon".equals(update.getAdvancementId())) {
                reportFinish(session);
                return;
            }
            String statusText = mapStatusFromAdvancement(update.getAdvancementId());
            reportActivity(session, "advancement", update.getAdvancementId(), statusText, update.getTitle(), update.getAdvancementId());
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

    private void reportActivity(MatchSession session, String type, String activityKey, String statusText, String chatMessage, String advancementId) {
        if (!McsroffRuntime.getAccountManager().hasTrustedSession()) {
            return;
        }
        if (statusText != null && !statusText.isEmpty() && activityKey != null && activityKey.equals(this.lastReportedActivityKey)) {
            long now = System.currentTimeMillis();
            if (now - this.lastReportedActivityAtMillis < 1500L) {
                return;
            }
        }

        if (statusText != null && !statusText.isEmpty()) {
            this.lastReportedActivityKey = activityKey == null ? "" : activityKey;
            this.lastReportedActivityAtMillis = System.currentTimeMillis();
        }

        this.pendingSnapshotFuture = McsroffRuntime.getAccountManager().executeAuthenticated(authSession ->
                McsroffRuntime.getBackendApi().reportActivity(
                        authSession,
                        session.getMatchId(),
                        type,
                        activityKey,
                        statusText,
                        chatMessage,
                        advancementId
                )
        );
        this.nextPollAtMillis = System.currentTimeMillis() + HEARTBEAT_INTERVAL_MILLIS;
    }

    private void reportFinish(MatchSession session) {
        if (session == null || session.isFinishReported() || !McsroffRuntime.getAccountManager().hasTrustedSession()) {
            return;
        }

        long now = System.currentTimeMillis();
        long startedAt = session.getRunStartedAtMillis();
        long finishTimeMs = startedAt > 0L ? Math.max(0L, now - startedAt) : 0L;
        session.setFinishReported(true);
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
            applySnapshot(minecraft, session, snapshot);
        } catch (Exception exception) {
            if (this.finishSubmissionInFlight) {
                session.setFinishReported(false);
            }
            this.nextPollAtMillis = System.currentTimeMillis() + HEARTBEAT_INTERVAL_MILLIS;
        } finally {
            this.finishSubmissionInFlight = false;
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
            session.setPhase(MatchPhase.FINISHED);
            McsroffRuntime.getMatchRealtimeClient().stop();
        } else if ("aborted".equalsIgnoreCase(snapshot.getState())) {
            session.setPhase(MatchPhase.ABORTED);
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
            if ("advancement".equalsIgnoreCase(event.getType()) && event.getChatMessage() != null && !event.getChatMessage().isEmpty()) {
                appendOpponentAdvancementToChat(minecraft, session, event.getChatMessage());
            }
        }

        this.nextPollAtMillis = System.currentTimeMillis() + HEARTBEAT_INTERVAL_MILLIS;
    }

    private void appendOpponentAdvancementToChat(Minecraft minecraft, MatchSession session, String chatMessage) {
        if (minecraft.gui == null || minecraft.gui.getChat() == null) {
            return;
        }

        MatchOpponent opponent = session.getOpponent();
        String prefix = opponent != null && opponent.getName() != null && !opponent.getName().isEmpty()
                ? opponent.getName() + ": "
                : "Opponent: ";
        MutableComponent message = new TextComponent(prefix + chatMessage).withStyle(ChatFormatting.GRAY);
        minecraft.gui.getChat().addMessage(message);
    }

    private void clearRuntimeState() {
        this.pendingSnapshotFuture = null;
        this.nextPollAtMillis = -1L;
        this.lastSeenEventSequence = 0L;
        this.startReported = false;
        this.lastDimensionKey = "";
        this.opponentStatus = "Started Match";
        this.lastReportedActivityKey = "";
        this.lastReportedActivityAtMillis = 0L;
        this.finishSubmissionInFlight = false;
        this.pendingAdvancements.clear();
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
            return "Completed";
        }
        return "";
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
