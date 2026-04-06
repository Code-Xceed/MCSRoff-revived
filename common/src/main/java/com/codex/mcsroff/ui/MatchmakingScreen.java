package com.codex.mcsroff.ui;

import com.codex.mcsroff.McsroffRuntime;
import com.codex.mcsroff.auth.AuthSession;
import com.codex.mcsroff.match.MatchOpponent;
import com.codex.mcsroff.match.MatchSession;
import com.codex.mcsroff.seed.SeedAssignment;
import com.codex.mcsroff.seed.SeedMode;
import com.mojang.authlib.GameProfile;
import com.mojang.blaze3d.systems.RenderSystem;
import com.mojang.blaze3d.vertex.PoseStack;
import net.minecraft.client.Minecraft;
import net.minecraft.client.gui.GuiComponent;
import net.minecraft.client.gui.components.Button;
import net.minecraft.client.gui.screens.Screen;
import net.minecraft.client.resources.DefaultPlayerSkin;
import net.minecraft.network.chat.FormattedText;
import net.minecraft.network.chat.TextComponent;
import net.minecraft.resources.ResourceLocation;

import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;

public final class MatchmakingScreen extends Screen {
    private static final long DUMMY_OPPONENT_FOUND_AFTER_MILLIS = 5000L;
    private static final long REDIRECT_COUNTDOWN_MILLIS = 3000L;
    private static final UUID OPPONENT_UUID = UUID.fromString("7a97bce6-8f18-4c86-a913-7d0ec408a677");
    private static final int FRAME_LIGHT = 0xFF6E6E6E;
    private static final int FRAME_DARK = 0xFF2A2A2A;
    private static final int PANEL_FILL = 0xCC1A1A1A;
    private static final int PANEL_INSET = 0xAA3B3B3B;

    private final Screen homeScreen;
    private final SeedMode seedMode;
    private final String selectedSeedTypeLabel;
    private final List<String> requestedFilterIds;
    private final long startedAtMillis;
    private final MatchmakingProfile localProfile;
    private final MatchmakingProfile searchingOpponentProfile;
    private final MatchmakingProfile foundOpponentProfile;

    private CompletableFuture<SeedAssignment> seedFuture;
    private SeedAssignment preparedSeed;
    private boolean opponentFound;
    private String statusLine = "Contacting FSG and searching for an opponent...";
    private long redirectTargetMillis = -1L;
    private boolean launchTriggered;
    private String opponentWorldStatus = "Waiting";

    private Button cancelButton;

    public MatchmakingScreen(Screen homeScreen, SeedMode seedMode, String selectedSeedTypeLabel, List<String> requestedFilterIds) {
        super(new TextComponent("Matchmaking"));
        this.homeScreen = homeScreen;
        this.seedMode = seedMode;
        this.selectedSeedTypeLabel = selectedSeedTypeLabel;
        this.requestedFilterIds = requestedFilterIds;
        this.startedAtMillis = System.currentTimeMillis();
        this.localProfile = createLocalProfile();
        this.searchingOpponentProfile = createSearchingOpponentProfile();
        this.foundOpponentProfile = createFoundOpponentProfile();
    }

    @Override
    protected void init() {
        int centerX = this.width / 2;
        int bottomY = this.height - 38;
        this.cancelButton = this.addScreenButton(new Button(centerX - 70, bottomY, 140, 20, new TextComponent("Cancel Matchmaking"), new Button.OnPress() {
            @Override
            public void onPress(Button button) {
                onClose();
            }
        }));
        this.seedFuture = McsroffRuntime.getFsgApi().requestSeed(this.requestedFilterIds, this.seedMode);
    }

    @Override
    public void tick() {
        if (!this.opponentFound && System.currentTimeMillis() - this.startedAtMillis >= DUMMY_OPPONENT_FOUND_AFTER_MILLIS) {
            this.opponentFound = true;
            this.opponentWorldStatus = "Waiting";
            updateStatusLine();
        }

        if (this.seedFuture != null && this.seedFuture.isDone()) {
            try {
                this.preparedSeed = this.seedFuture.join();
            } catch (Exception exception) {
                this.statusLine = "Seed prep failed: " + unwrapMessage(exception);
            } finally {
                this.seedFuture = null;
                updateStatusLine();
            }
        } else {
            updateStatusLine();
        }

        if (this.opponentFound && this.preparedSeed != null && this.redirectTargetMillis < 0L && !this.launchTriggered) {
            this.redirectTargetMillis = System.currentTimeMillis() + REDIRECT_COUNTDOWN_MILLIS;
            this.opponentWorldStatus = "Generating world";
            if (this.cancelButton != null) {
                this.cancelButton.active = false;
            }
            updateStatusLine();
        }

        if (!this.launchTriggered && this.redirectTargetMillis > 0L && System.currentTimeMillis() >= this.redirectTargetMillis) {
            beginWorldLaunch();
        }
    }

    @Override
    public void render(PoseStack poseStack, int mouseX, int mouseY, float partialTick) {
        this.renderBackground(poseStack);

        drawCenteredString(poseStack, this.font, new TextComponent("MCSR Matchmaking"), this.width / 2, 14, 16777215);
        drawCenteredString(poseStack, this.font, new TextComponent("Race Queue"), this.width / 2, 28, 11184810);

        int panelWidth = Math.min(214, Math.max(170, (this.width - 284) / 2));
        int panelHeight = 214;
        int leftX = 20;
        int rightX = this.width - panelWidth - 20;
        int panelY = 48;

        renderProfilePanel(poseStack, leftX, panelY, panelWidth, panelHeight, "You", this.localProfile, true);
        renderCenterColumn(poseStack, panelWidth, panelY, panelHeight);
        renderProfilePanel(poseStack, rightX, panelY, panelWidth, panelHeight, this.opponentFound ? "Opponent Found" : "Searching", getDisplayedOpponentProfile(), this.opponentFound);
        renderRedirectFooter(poseStack);
        renderOpponentWorldStatus(poseStack);

        super.render(poseStack, mouseX, mouseY, partialTick);
    }

    @Override
    public void onClose() {
        this.minecraft.setScreen(this.homeScreen);
    }

    private void renderCenterColumn(PoseStack poseStack, int panelWidth, int panelY, int panelHeight) {
        int centerLeft = panelWidth + 56;
        int centerRight = this.width - panelWidth - 56;
        int centerX = this.width / 2;
        int centerWidth = centerRight - centerLeft;

        drawCenteredString(poseStack, this.font, new TextComponent(this.opponentFound ? "MATCH FOUND" : "SEARCHING"), centerX, panelY + 10, 16777215);
        drawCenteredString(poseStack, this.font, new TextComponent(this.opponentFound ? "Opponent locked" : "Scanning queue"), centerX, panelY + 24, 11184810);

        if (this.opponentFound) {
            renderScaledCenteredText(poseStack, "VS", centerX, panelY + 38, 2.7F, 0xFFE0C36A);
        } else {
            drawCenteredString(poseStack, this.font, new TextComponent("Elapsed"), centerX, panelY + 46, 11184810);
            renderScaledCenteredText(poseStack, formatElapsed(), centerX, panelY + 60, 2.0F, 16777215);
        }

        fill(poseStack, centerLeft + 14, panelY + 92, centerRight - 14, panelY + 93, FRAME_DARK);
        fill(poseStack, centerLeft + 14, panelY + 93, centerRight - 14, panelY + 94, FRAME_LIGHT);
        drawCenteredString(poseStack, this.font, new TextComponent("Seed Type"), centerX, panelY + 106, 11184810);
        renderCenteredWrappedText(poseStack, this.selectedSeedTypeLabel, centerX, panelY + 120, centerWidth - 24, 16777215, 2);

        drawCenteredString(poseStack, this.font, new TextComponent(formatMode(this.seedMode)), centerX, panelY + 156, 14737632);
        renderCenteredWrappedText(poseStack, this.statusLine, centerX, panelY + 174, centerWidth - 24, 14737632, 2);
    }

    private void renderRedirectFooter(PoseStack poseStack) {
        int centerX = this.width / 2;
        int timerY = this.cancelButton.y - 12;
        String timerLine;
        int color;

        if (this.launchTriggered) {
            timerLine = "Redirecting to world creation...";
            color = 14737632;
        } else if (this.redirectTargetMillis > 0L) {
            timerLine = "Redirecting in " + formatRedirectCountdown();
            color = 0xFFE0C36A;
        } else if (this.opponentFound) {
            timerLine = "Preparing redirect...";
            color = 14737632;
        } else {
            timerLine = "";
            color = 14737632;
        }

        if (!timerLine.isEmpty()) {
            drawCenteredString(poseStack, this.font, new TextComponent(timerLine), centerX, timerY, color);
        }
    }

    private void renderOpponentWorldStatus(PoseStack poseStack) {
        if (!this.opponentFound) {
            return;
        }

        int right = this.width - 14;
        int bottom = this.height - 54;
        String nameLine = this.foundOpponentProfile.getName();
        String statusLineText = "World: " + this.opponentWorldStatus;

        this.font.drawShadow(poseStack, nameLine, right - this.font.width(nameLine), bottom - 10, 16777215);
        this.font.drawShadow(poseStack, statusLineText, right - this.font.width(statusLineText), bottom, 14737632);
    }

    private void renderProfilePanel(PoseStack poseStack, int x, int y, int width, int height, String title, MatchmakingProfile profile, boolean live) {
        renderFrame(poseStack, x, y, width, height);
        renderInset(poseStack, x + 8, y + 10, width - 16, 18);
        drawCenteredString(poseStack, this.font, new TextComponent(title), x + width / 2, y + 15, live ? 16777215 : 11184810);

        renderInset(poseStack, x + 8, y + 34, width - 16, 64);
        renderSkinHead(poseStack, profile.getSkinTexture(), x + 16, y + 48, 24);
        int textX = x + 54;
        int textWidth = width - 70;
        drawString(poseStack, this.font, fit(textWidth, profile.getName()), textX, y + 42, 16777215);
        drawString(poseStack, this.font, "Elo " + formatElo(profile.getElo()), textX, y + 57, 14737632);
        drawString(poseStack, this.font, fit(textWidth, profile.getRank()), textX, y + 72, 14737632);

        renderDataRow(poseStack, x + 8, y + 104, width - 16, "Achievements", profile.getAchievements(), 34);
        renderDataRow(poseStack, x + 8, y + 142, width - 16, "Record", profile.getRecord(), 28);
        renderDataRow(poseStack, x + 8, y + 174, width - 16, "Status", profile.getStatus(), 28);
    }

    private void renderSkinHead(PoseStack poseStack, ResourceLocation texture, int x, int y, int size) {
        renderInset(poseStack, x - 4, y - 4, size + 8, size + 8);
        Minecraft.getInstance().getTextureManager().bind(texture);
        RenderSystem.color4f(1.0F, 1.0F, 1.0F, 1.0F);
        GuiComponent.blit(poseStack, x, y, 0, 8.0F, 8.0F, size, size, 64, 64);
        GuiComponent.blit(poseStack, x, y, 0, 40.0F, 8.0F, size, size, 64, 64);
    }

    private void renderDataRow(PoseStack poseStack, int x, int y, int width, String label, String value, int height) {
        renderInset(poseStack, x, y, width, height);
        drawString(poseStack, this.font, label, x + 6, y + 4, 11184810);
        renderWrappedText(poseStack, value, x + 6, y + 15, width - 12, 14737632, 2);
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

    private MatchmakingProfile getDisplayedOpponentProfile() {
        return this.opponentFound ? this.foundOpponentProfile : this.searchingOpponentProfile;
    }

    private void updateStatusLine() {
        if (this.launchTriggered) {
            this.statusLine = "Opening race world and synchronizing both runners.";
            return;
        }

        if (this.redirectTargetMillis > 0L) {
            this.statusLine = "Race seed locked. Redirecting both runners to world creation.";
            return;
        }

        if (this.preparedSeed == null && this.seedFuture != null) {
            this.statusLine = this.opponentFound
                    ? "Opponent locked. Finalizing race seed..."
                    : "Securing race seed and scanning queue...";
            return;
        }

        if (this.preparedSeed != null) {
            this.statusLine = this.opponentFound
                    ? "Race seed locked. Match preview ready."
                    : "Race seed locked. Waiting for opponent...";
        }
    }

    private void beginWorldLaunch() {
        this.launchTriggered = true;
        this.opponentWorldStatus = "Generating world";
        if (this.cancelButton != null) {
            this.cancelButton.active = false;
        }
        updateStatusLine();

        try {
            MatchSession session = McsroffRuntime.getMatchManager().beginPendingLocalSession(this.preparedSeed, this.selectedSeedTypeLabel, toMatchOpponent(this.foundOpponentProfile));
            McsroffRuntime.getPreRaceController().armLocalStart(session);
            this.minecraft.setScreen(new WorldPreparationScreen());
            String worldId = McsroffRuntime.getWorldLauncher().launchSeedWorld(this.preparedSeed);
            McsroffRuntime.getMatchManager().bindCurrentSessionToWorld(worldId);
        } catch (RuntimeException exception) {
            this.launchTriggered = false;
            this.redirectTargetMillis = -1L;
            this.opponentWorldStatus = "Waiting";
            McsroffRuntime.getMatchManager().clearCurrentSession();
            this.statusLine = "World creation failed: " + unwrapMessage(exception);
            if (this.cancelButton != null) {
                this.cancelButton.active = true;
            }
        }
    }

    private String formatElapsed() {
        long elapsedSeconds = Math.max(0L, (System.currentTimeMillis() - this.startedAtMillis) / 1000L);
        long minutes = elapsedSeconds / 60L;
        long seconds = elapsedSeconds % 60L;
        return minutes + ":" + (seconds < 10L ? "0" : "") + seconds;
    }

    private String formatRedirectCountdown() {
        long remainingMillis = Math.max(0L, this.redirectTargetMillis - System.currentTimeMillis());
        long tenths = (remainingMillis + 99L) / 100L;
        long seconds = tenths / 10L;
        long fraction = tenths % 10L;
        return seconds + "." + fraction + "s";
    }

    private static String formatMode(SeedMode seedMode) {
        return seedMode == SeedMode.MATCH ? "Fresh Race Seed" : "Practice Seed";
    }

    private MatchmakingProfile createLocalProfile() {
        Minecraft minecraft = Minecraft.getInstance();
        AuthSession session = McsroffRuntime.getAccountManager().getCurrentSession();
        String name = session != null && session.getDisplayName() != null && !session.getDisplayName().isEmpty()
                ? session.getDisplayName()
                : minecraft.getUser().getName();
        int hash = Math.abs(name.hashCode());
        int elo = session != null && session.getElo() > 0 ? session.getElo() : 1180 + (hash % 420);
        String rank = session != null && session.getRankTier() != null && !session.getRankTier().isEmpty()
                ? session.getRankTier()
                : getRankForElo(elo);
        String achievements = "Dragon PB " + (15 + (hash % 10)) + ":" + (10 + (hash % 49));
        String record = (20 + (hash % 40)) + "W / " + (8 + (hash % 25)) + "L";
        String status = session != null ? "Account Verified" : "Queue Ready";
        return new MatchmakingProfile(name, elo, rank, achievements, record, status, resolveSkin(minecraft.getUser().getGameProfile()));
    }

    private static MatchmakingProfile createSearchingOpponentProfile() {
        return new MatchmakingProfile(
                "Searching...",
                -1,
                "Pending",
                "Waiting for queue match",
                "--",
                "Open Slot",
                DefaultPlayerSkin.getDefaultSkin(OPPONENT_UUID)
        );
    }

    private static MatchmakingProfile createFoundOpponentProfile() {
        return new MatchmakingProfile(
                "NetherBurst",
                1642,
                "Diamond II",
                "Zero-cycle route expert",
                "38W / 16L",
                "Opponent Locked",
                DefaultPlayerSkin.getDefaultSkin(OPPONENT_UUID)
        );
    }

    private static String getRankForElo(int elo) {
        if (elo >= 1700) {
            return "Diamond I";
        }
        if (elo >= 1550) {
            return "Diamond II";
        }
        if (elo >= 1400) {
            return "Gold I";
        }
        if (elo >= 1250) {
            return "Gold II";
        }
        return "Silver I";
    }

    private static String formatElo(int elo) {
        return elo < 0 ? "--" : Integer.toString(elo);
    }

    private static MatchOpponent toMatchOpponent(MatchmakingProfile profile) {
        return new MatchOpponent(profile.getName(), profile.getElo(), profile.getRank(), profile.getSkinTexture());
    }

    private String fit(int maxWidth, String value) {
        if (value == null) {
            return "";
        }
        String trimmed = this.font.plainSubstrByWidth(value, Math.max(12, maxWidth));
        if (trimmed.length() == value.length()) {
            return trimmed;
        }
        String ellipsis = "...";
        String base = this.font.plainSubstrByWidth(value, Math.max(12, maxWidth - this.font.width(ellipsis)));
        return base + ellipsis;
    }

    private String fitCentered(String value, int maxWidth) {
        return fit(maxWidth, value);
    }

    private void renderScaledCenteredText(PoseStack poseStack, String value, int centerX, int baselineY, float scale, int color) {
        poseStack.pushPose();
        poseStack.scale(scale, scale, scale);
        float scaledX = (centerX / scale) - (this.font.width(value) / 2.0F);
        float scaledY = baselineY / scale;
        this.font.drawShadow(poseStack, value, scaledX, scaledY, color);
        poseStack.popPose();
    }

    private void renderWrappedText(PoseStack poseStack, String value, int x, int y, int maxWidth, int color, int maxLines) {
        List<FormattedText> lines = getWrappedLines(value, maxWidth, maxLines);
        for (int index = 0; index < lines.size(); index++) {
            this.font.draw(poseStack, lines.get(index), x, y + (index * 10), color);
        }
    }

    private void renderCenteredWrappedText(PoseStack poseStack, String value, int centerX, int y, int maxWidth, int color, int maxLines) {
        List<FormattedText> lines = getWrappedLines(value, maxWidth, maxLines);
        for (int index = 0; index < lines.size(); index++) {
            FormattedText line = lines.get(index);
            this.font.drawShadow(poseStack, line, centerX - (this.font.width(line) / 2.0F), y + (index * 10), color);
        }
    }

    private List<FormattedText> getWrappedLines(String value, int maxWidth, int maxLines) {
        List<FormattedText> rawLines = this.font.split(new TextComponent(value == null ? "" : value), Math.max(24, maxWidth));
        if (rawLines.size() <= maxLines) {
            return rawLines;
        }

        List<FormattedText> lines = new ArrayList<FormattedText>(maxLines);
        for (int index = 0; index < maxLines; index++) {
            if (index == maxLines - 1) {
                String rawValue = rawLines.get(index).getString();
                lines.add(new TextComponent(fit(maxWidth, rawValue)));
            } else {
                lines.add(rawLines.get(index));
            }
        }
        return lines;
    }

    private static ResourceLocation resolveSkin(GameProfile gameProfile) {
        if (gameProfile == null || gameProfile.getId() == null) {
            return DefaultPlayerSkin.getDefaultSkin();
        }
        return DefaultPlayerSkin.getDefaultSkin(gameProfile.getId());
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
