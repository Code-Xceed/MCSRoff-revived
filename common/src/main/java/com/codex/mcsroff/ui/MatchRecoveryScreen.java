package com.codex.mcsroff.ui;

import com.codex.mcsroff.McsroffMod;
import com.codex.mcsroff.McsroffRuntime;
import com.codex.mcsroff.auth.AuthSession;
import com.codex.mcsroff.config.PersistedMatchState;
import com.codex.mcsroff.match.MatchManager;
import com.codex.mcsroff.match.MatchPhase;
import com.codex.mcsroff.match.MatchSession;
import com.codex.mcsroff.net.RemoteMatchPlayer;
import com.codex.mcsroff.net.RemoteMatchSnapshot;
import com.mojang.blaze3d.vertex.PoseStack;
import net.minecraft.client.gui.components.Button;
import net.minecraft.client.gui.screens.Screen;
import net.minecraft.network.chat.TextComponent;

import java.io.IOException;
import java.util.List;
import java.util.concurrent.CompletableFuture;

public final class MatchRecoveryScreen extends Screen {
    private static final int FRAME_LIGHT = 0xFF6E6E6E;
    private static final int FRAME_DARK = 0xFF2A2A2A;
    private static final int PANEL_FILL = 0xCC1A1A1A;
    private static final int PANEL_INSET = 0xAA3B3B3B;

    private final Screen lastScreen;
    private final RemoteMatchSnapshot snapshot;
    private String statusLine = "Active match found. Resume or leave the match.";
    private Button resumeButton;
    private Button forfeitButton;
    private boolean actionInFlight;

    public MatchRecoveryScreen(Screen lastScreen, RemoteMatchSnapshot snapshot) {
        super(new TextComponent("Recover Match"));
        this.lastScreen = lastScreen;
        this.snapshot = snapshot;
    }

    @Override
    protected void init() {
        int centerX = this.width / 2;
        int buttonY = this.height / 2 + 54;

        this.resumeButton = this.addScreenButton(new Button(centerX - 100, buttonY, 200, 20, new TextComponent(getResumeLabel()), new Button.OnPress() {
            @Override
            public void onPress(Button button) {
                resumeMatch();
            }
        }));
        this.forfeitButton = this.addScreenButton(new Button(centerX - 100, buttonY + 24, 200, 20, new TextComponent("Forfeit Active Match"), new Button.OnPress() {
            @Override
            public void onPress(Button button) {
                forfeitMatch();
            }
        }));
        this.addScreenButton(new Button(centerX - 100, buttonY + 52, 200, 20, new TextComponent("Back"), new Button.OnPress() {
            @Override
            public void onPress(Button button) {
                onClose();
            }
        }));
        updateButtons();
    }

    @Override
    public void render(PoseStack poseStack, int mouseX, int mouseY, float partialTick) {
        this.renderBackground(poseStack);

        int panelWidth = 300;
        int panelHeight = 170;
        int panelX = (this.width - panelWidth) / 2;
        int panelY = (this.height - panelHeight) / 2 - 22;

        renderFrame(poseStack, panelX, panelY, panelWidth, panelHeight);
        renderInset(poseStack, panelX + 10, panelY + 10, panelWidth - 20, 20);
        renderInset(poseStack, panelX + 10, panelY + 38, panelWidth - 20, 80);

        drawCenteredString(poseStack, this.font, new TextComponent("Active Match Recovery"), this.width / 2, panelY + 16, 16777215);
        drawCenteredString(poseStack, this.font, new TextComponent(getStateLabel()), this.width / 2, panelY + 44, 14737632);

        int lineX = panelX + 18;
        int lineY = panelY + 60;
        drawString(poseStack, this.font, "Opponent: " + getOpponentName(), lineX, lineY, 16777215);
        drawString(poseStack, this.font, "Seed: " + safe(this.snapshot.getSeedTypeLabel()), lineX, lineY + 14, 14737632);
        drawString(poseStack, this.font, "World: " + getWorldStateLabel(), lineX, lineY + 28, 14737632);
        drawString(poseStack, this.font, "Save: " + getWorldIdLabel(), lineX, lineY + 42, 14737632);
        drawString(poseStack, this.font, this.statusLine, lineX, lineY + 62, 11184810);

        super.render(poseStack, mouseX, mouseY, partialTick);
    }

    @Override
    public void onClose() {
        this.minecraft.setScreen(this.lastScreen);
    }

    private void resumeMatch() {
        PersistedMatchState state = resolveStateForRecovery();
        if (state == null) {
            this.statusLine = "Recovery data missing.";
            updateButtons();
            return;
        }
        if (isRunningState() && (state.getWorldId().isEmpty() || !McsroffRuntime.getWorldLauncher().worldExists(state.getWorldId()))) {
            this.statusLine = "Local race world is missing. You cannot resume this running match.";
            updateButtons();
            return;
        }

        MatchManager matchManager = McsroffRuntime.getMatchManager();
        MatchSession session = matchManager.restoreSession(state);
        if (session == null) {
            this.statusLine = "Failed to rebuild match session.";
            updateButtons();
            return;
        }

        this.actionInFlight = true;
        updateButtons();
        try {
            if (isRunningState()) {
                matchManager.updateCurrentPhase(MatchPhase.RUNNING);
                this.minecraft.setScreen(null);
                McsroffRuntime.getWorldLauncher().loadExistingWorld(state.getWorldId());
                return;
            }

            if (!state.getWorldId().isEmpty() && McsroffRuntime.getWorldLauncher().worldExists(state.getWorldId())) {
                McsroffRuntime.getPreRaceController().recoverLocalStart(session, this.snapshot);
                this.minecraft.setScreen(new WorldPreparationScreen());
                McsroffRuntime.getWorldLauncher().loadExistingWorld(state.getWorldId());
            } else {
                McsroffRuntime.getPreRaceController().armLocalStart(session);
                this.minecraft.setScreen(new WorldPreparationScreen());
                String worldId = McsroffRuntime.getWorldLauncher().launchSeedWorld(session.getSeedAssignment());
                matchManager.bindCurrentSessionToWorld(worldId);
            }
        } catch (RuntimeException exception) {
            this.actionInFlight = false;
            this.statusLine = "Recovery failed: " + unwrapMessage(exception);
            updateButtons();
        }
    }

    private void forfeitMatch() {
        if (this.actionInFlight) {
            return;
        }
        this.actionInFlight = true;
        this.statusLine = "Forfeiting active match...";
        updateButtons();
        CompletableFuture<RemoteMatchSnapshot> future = McsroffRuntime.getAccountManager().executeAuthenticated((AuthSession session) ->
                McsroffRuntime.getBackendApi().forfeitMatch(session, this.snapshot.getMatchId())
        );
        future.whenComplete((result, throwable) -> this.minecraft.execute(() -> {
            this.actionInFlight = false;
            McsroffRuntime.getMatchRealtimeClient().stop();
            McsroffRuntime.getMatchManager().clearCurrentSession();
            if (throwable != null) {
                this.statusLine = "Forfeit failed: " + unwrapMessage(throwable);
                updateButtons();
                return;
            }
            clearPersistedActiveMatch();
            this.minecraft.setScreen(new McsroffMenuScreen(this.lastScreen));
        }));
    }

    private PersistedMatchState resolveStateForRecovery() {
        PersistedMatchState persisted = McsroffMod.getConfig().getActiveMatch();
        if (persisted != null && this.snapshot.getMatchId().equals(persisted.getMatchId())) {
            return persisted;
        }

        if (this.snapshot.getSeed() == null || this.snapshot.getSeed().isEmpty()) {
            return null;
        }

        PersistedMatchState derived = new PersistedMatchState();
        derived.setMatchId(this.snapshot.getMatchId());
        derived.setPlayerRole(resolveLocalPlayerRole());
        derived.setSeed(this.snapshot.getSeed());
        derived.setFsgFilterId(this.snapshot.getFsgFilterId());
        derived.setFsgToken(this.snapshot.getFsgToken());
        derived.setSeedModeName(this.snapshot.getSeedMode().name());
        derived.setSeedTypeLabel(this.snapshot.getSeedTypeLabel());
        derived.setOpponentName(getOpponentName());
        RemoteMatchPlayer opponent = getOpponentPlayer();
        if (opponent != null) {
            derived.setOpponentElo(opponent.getElo());
            derived.setOpponentRank(opponent.getRank());
        }
        derived.setPhaseName(isRunningState() ? MatchPhase.RUNNING.name() : MatchPhase.WORLD_CREATING.name());
        McsroffMod.getConfig().setActiveMatch(derived);
        try {
            McsroffMod.getConfig().save();
        } catch (IOException exception) {
            McsroffMod.LOGGER.warn("Failed to persist derived recovery state", exception);
        }
        return derived;
    }

    private String resolveLocalPlayerRole() {
        AuthSession session = McsroffRuntime.getAccountManager().getCurrentSession();
        if (session == null) {
            return "host";
        }
        List<RemoteMatchPlayer> players = this.snapshot.getPlayers();
        for (RemoteMatchPlayer player : players) {
            if (session.getUserId().equals(player.getPlayerId())) {
                return safe(player.getSlot());
            }
        }
        return "host";
    }

    private RemoteMatchPlayer getOpponentPlayer() {
        AuthSession session = McsroffRuntime.getAccountManager().getCurrentSession();
        String localUserId = session == null ? "" : session.getUserId();
        for (RemoteMatchPlayer player : this.snapshot.getPlayers()) {
            if (!localUserId.equals(player.getPlayerId())) {
                return player;
            }
        }
        return null;
    }

    private String getOpponentName() {
        RemoteMatchPlayer opponent = getOpponentPlayer();
        if (opponent != null && opponent.getDisplayName() != null && !opponent.getDisplayName().isEmpty()) {
            return opponent.getDisplayName();
        }
        PersistedMatchState persisted = McsroffMod.getConfig().getActiveMatch();
        return persisted != null && !persisted.getOpponentName().isEmpty() ? persisted.getOpponentName() : "Opponent";
    }

    private String getStateLabel() {
        String state = safe(this.snapshot.getState());
        if ("running".equalsIgnoreCase(state)) {
            return "Match already running";
        }
        if ("countdown".equalsIgnoreCase(state)) {
            return "Countdown locked";
        }
        if ("world_generated".equalsIgnoreCase(state) || "world_generating".equalsIgnoreCase(state)) {
            return "World generation ready";
        }
        return "Match reserved";
    }

    private String getWorldStateLabel() {
        PersistedMatchState persisted = McsroffMod.getConfig().getActiveMatch();
        if (persisted == null || persisted.getWorldId().isEmpty()) {
            return isRunningState() ? "Missing saved world" : "World not created yet";
        }
        return McsroffRuntime.getWorldLauncher().worldExists(persisted.getWorldId()) ? "Saved world available" : "Saved world missing";
    }

    private String getWorldIdLabel() {
        PersistedMatchState persisted = McsroffMod.getConfig().getActiveMatch();
        return persisted == null || persisted.getWorldId().isEmpty() ? "--" : persisted.getWorldId();
    }

    private String getResumeLabel() {
        PersistedMatchState persisted = McsroffMod.getConfig().getActiveMatch();
        boolean hasWorld = persisted != null && !persisted.getWorldId().isEmpty() && McsroffRuntime.getWorldLauncher().worldExists(persisted.getWorldId());
        if (isRunningState()) {
            return hasWorld ? "Load Race World" : "Resume Unavailable";
        }
        return hasWorld ? "Load Race World" : "Create Race World";
    }

    private boolean isRunningState() {
        return "running".equalsIgnoreCase(this.snapshot.getState());
    }

    private void updateButtons() {
        if (this.resumeButton != null) {
            this.resumeButton.setMessage(new TextComponent(getResumeLabel()));
            this.resumeButton.active = !this.actionInFlight && (!isRunningState() || (McsroffMod.getConfig().getActiveMatch() != null
                    && !McsroffMod.getConfig().getActiveMatch().getWorldId().isEmpty()
                    && McsroffRuntime.getWorldLauncher().worldExists(McsroffMod.getConfig().getActiveMatch().getWorldId())));
        }
        if (this.forfeitButton != null) {
            this.forfeitButton.active = !this.actionInFlight;
        }
    }

    private void renderFrame(PoseStack poseStack, int x, int y, int width, int height) {
        fill(poseStack, x, y, x + width, y + height, PANEL_FILL);
        fill(poseStack, x, y, x + width, y + 1, FRAME_LIGHT);
        fill(poseStack, x, y, x + 1, y + height, FRAME_LIGHT);
        fill(poseStack, x + width - 1, y, x + width, y + height, FRAME_DARK);
        fill(poseStack, x, y + height - 1, x + width, y + height, FRAME_DARK);
    }

    private void renderInset(PoseStack poseStack, int x, int y, int width, int height) {
        fill(poseStack, x, y, x + width, y + height, PANEL_INSET);
        fill(poseStack, x, y, x + width, y + 1, FRAME_DARK);
        fill(poseStack, x, y, x + 1, y + height, FRAME_DARK);
        fill(poseStack, x + width - 1, y, x + width, y + height, FRAME_LIGHT);
        fill(poseStack, x, y + height - 1, x + width, y + height, FRAME_LIGHT);
    }

    private static void clearPersistedActiveMatch() {
        McsroffMod.getConfig().clearActiveMatch();
        try {
            McsroffMod.getConfig().save();
        } catch (IOException exception) {
            McsroffMod.LOGGER.warn("Failed to clear active match state", exception);
        }
    }

    private static String safe(String value) {
        return value == null ? "" : value;
    }

    private static String unwrapMessage(Throwable throwable) {
        Throwable current = throwable;
        while (current.getCause() != null) {
            current = current.getCause();
        }
        return current.getMessage() == null ? current.getClass().getSimpleName() : current.getMessage();
    }

    @SuppressWarnings({"rawtypes", "unchecked"})
    private Button addScreenButton(Button button) {
        this.children.add(button);
        ((List) this.buttons).add(button);
        return button;
    }
}
