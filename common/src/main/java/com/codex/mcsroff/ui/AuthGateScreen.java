package com.codex.mcsroff.ui;

import com.codex.mcsroff.McsroffRuntime;
import com.codex.mcsroff.auth.AuthSession;
import com.codex.mcsroff.net.RemoteMatchSnapshot;
import com.mojang.blaze3d.vertex.PoseStack;
import net.minecraft.client.gui.components.Button;
import net.minecraft.client.gui.screens.Screen;
import net.minecraft.network.chat.TextComponent;

import java.util.List;
import java.util.concurrent.CompletableFuture;

public final class AuthGateScreen extends Screen {
    private static final int FRAME_LIGHT = 0xFF6E6E6E;
    private static final int FRAME_DARK = 0xFF2A2A2A;
    private static final int PANEL_FILL = 0xCC1A1A1A;
    private static final int PANEL_INSET = 0xAA3B3B3B;

    private final Screen lastScreen;
    private CompletableFuture<GateResolution> bootstrapFuture;
    private String statusLine = "Checking trusted account session...";
    private boolean redirected;

    public AuthGateScreen(Screen lastScreen) {
        super(new TextComponent("offline MCSR"));
        this.lastScreen = lastScreen;
    }

    @Override
    protected void init() {
        int centerX = this.width / 2;
        int buttonY = (this.height / 2) + 48;

        this.addScreenButton(new Button(centerX - 100, buttonY, 200, 20, new TextComponent("Back"), new Button.OnPress() {
            @Override
            public void onPress(Button button) {
                onClose();
            }
        }));

        this.bootstrapFuture = McsroffRuntime.getAccountManager().bootstrapSession().thenCompose(session -> {
            if (session == null) {
                return CompletableFuture.completedFuture(new GateResolution(null, null));
            }
            this.statusLine = "Checking for active match recovery...";
            return McsroffRuntime.getAccountManager().executeAuthenticated(activeSession ->
                    McsroffRuntime.getBackendApi().pollActiveMatch(activeSession)
            ).handle((snapshot, throwable) -> new GateResolution(session, throwable == null ? snapshot : null));
        });
    }

    @Override
    public void tick() {
        if (this.redirected || this.bootstrapFuture == null || !this.bootstrapFuture.isDone()) {
            return;
        }

        try {
            GateResolution resolution = this.bootstrapFuture.join();
            this.redirected = true;
            if (resolution.session == null) {
                this.minecraft.setScreen(AccountLinkScreen.required(this.lastScreen));
            } else if (hasRecoverableMatch(resolution.snapshot)) {
                this.minecraft.setScreen(new MatchRecoveryScreen(this.lastScreen, resolution.snapshot));
            } else {
                clearStaleActiveMatch();
                this.minecraft.setScreen(new McsroffMenuScreen(this.lastScreen));
            }
        } catch (Exception exception) {
            this.statusLine = "Account check failed: " + unwrapMessage(exception);
            this.redirected = true;
            this.minecraft.setScreen(AccountLinkScreen.required(this.lastScreen));
        } finally {
            this.bootstrapFuture = null;
        }
    }

    @Override
    public void render(PoseStack poseStack, int mouseX, int mouseY, float partialTick) {
        this.renderBackground(poseStack);

        int panelWidth = 286;
        int panelHeight = 118;
        int panelX = (this.width - panelWidth) / 2;
        int panelY = (this.height - panelHeight) / 2 - 12;

        renderFrame(poseStack, panelX, panelY, panelWidth, panelHeight);
        renderInset(poseStack, panelX + 10, panelY + 10, panelWidth - 20, 18);
        renderInset(poseStack, panelX + 10, panelY + 36, panelWidth - 20, 54);

        drawCenteredString(poseStack, this.font, new TextComponent("MCSR Authentication"), this.width / 2, panelY + 15, 16777215);
        drawCenteredString(poseStack, this.font, new TextComponent("Trusted account verification"), this.width / 2, panelY + 42, 11184810);
        renderWrappedText(poseStack, this.statusLine, panelX + 18, panelY + 58, panelWidth - 36, 16777215, 3);

        super.render(poseStack, mouseX, mouseY, partialTick);
    }

    @Override
    public void onClose() {
        this.minecraft.setScreen(this.lastScreen);
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

    private void renderWrappedText(PoseStack poseStack, String value, int x, int y, int maxWidth, int color, int maxLines) {
        List<net.minecraft.network.chat.FormattedText> lines = this.font.split(new TextComponent(value == null ? "" : value), Math.max(24, maxWidth));
        int lineCount = Math.min(lines.size(), maxLines);
        for (int index = 0; index < lineCount; index++) {
            this.font.draw(poseStack, lines.get(index), x, y + (index * 10), color);
        }
    }

    private static String unwrapMessage(Throwable throwable) {
        Throwable current = throwable;
        while (current.getCause() != null) {
            current = current.getCause();
        }
        return current.getMessage() == null ? current.getClass().getSimpleName() : current.getMessage();
    }

    private static boolean hasRecoverableMatch(RemoteMatchSnapshot snapshot) {
        if (snapshot == null || snapshot.getMatchId() == null || snapshot.getMatchId().isEmpty()) {
            return false;
        }
        String state = snapshot.getState();
        return "matched".equalsIgnoreCase(state)
                || "world_generating".equalsIgnoreCase(state)
                || "world_generated".equalsIgnoreCase(state)
                || "countdown".equalsIgnoreCase(state)
                || "running".equalsIgnoreCase(state);
    }

    private static void clearStaleActiveMatch() {
        if (com.codex.mcsroff.McsroffMod.getConfig().getActiveMatch() == null) {
            return;
        }
        com.codex.mcsroff.McsroffMod.getConfig().clearActiveMatch();
        try {
            com.codex.mcsroff.McsroffMod.getConfig().save();
        } catch (java.io.IOException exception) {
            com.codex.mcsroff.McsroffMod.LOGGER.warn("Failed to clear stale active match state", exception);
        }
    }

    private static final class GateResolution {
        private final AuthSession session;
        private final RemoteMatchSnapshot snapshot;

        private GateResolution(AuthSession session, RemoteMatchSnapshot snapshot) {
            this.session = session;
            this.snapshot = snapshot;
        }
    }

    @SuppressWarnings({"rawtypes", "unchecked"})
    private Button addScreenButton(Button button) {
        this.children.add(button);
        ((List) this.buttons).add(button);
        return button;
    }
}
