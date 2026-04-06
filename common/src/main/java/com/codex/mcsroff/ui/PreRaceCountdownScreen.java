package com.codex.mcsroff.ui;

import com.codex.mcsroff.McsroffRuntime;
import com.codex.mcsroff.match.MatchOpponent;
import com.codex.mcsroff.match.MatchSession;
import com.mojang.blaze3d.systems.RenderSystem;
import com.mojang.blaze3d.vertex.PoseStack;
import net.minecraft.client.Minecraft;
import net.minecraft.client.gui.GuiComponent;
import net.minecraft.client.gui.screens.Screen;
import net.minecraft.network.chat.TextComponent;
import net.minecraft.resources.ResourceLocation;

public final class PreRaceCountdownScreen extends Screen {
    private static final int FRAME_LIGHT = 0xFF6E6E6E;
    private static final int FRAME_DARK = 0xFF2A2A2A;
    private static final int PANEL_FILL = 0xC4181818;
    private static final int PANEL_INSET = 0xAA3B3B3B;

    public PreRaceCountdownScreen() {
        super(new TextComponent("Race Start"));
    }

    @Override
    public void tick() {
        McsroffRuntime.getPreRaceController().onClientTick(Minecraft.getInstance());
    }

    @Override
    public void render(PoseStack poseStack, int mouseX, int mouseY, float partialTick) {
        fill(poseStack, 0, 0, this.width, this.height, 0xAA000000);

        MatchSession session = McsroffRuntime.getPreRaceController().getActiveSession();
        String filterLine = session == null ? "Preparing race start" : session.getSeedTypeLabel();
        int seconds = McsroffRuntime.getPreRaceController().getCountdownSecondsRemaining();
        String countdownLine = seconds <= 0 ? "Go" : Integer.toString(seconds);

        int panelWidth = 248;
        int panelHeight = 142;
        int panelX = (this.width - panelWidth) / 2;
        int panelY = (this.height - panelHeight) / 2 - 22;

        renderFrame(poseStack, panelX, panelY, panelWidth, panelHeight);
        renderInset(poseStack, panelX + 10, panelY + 10, panelWidth - 20, 18);
        drawCenteredString(poseStack, this.font, new TextComponent("Race Start Locked"), this.width / 2, panelY + 15, 16777215);
        drawCenteredString(poseStack, this.font, new TextComponent(fit(filterLine, panelWidth - 40)), this.width / 2, panelY + 31, 0xFFE0C36A);

        renderInset(poseStack, panelX + 24, panelY + 48, panelWidth - 48, 54);
        drawCenteredString(poseStack, this.font, new TextComponent("Race unlocks in"), this.width / 2, panelY + 56, 16777215);
        renderScaledCenteredText(poseStack, countdownLine, this.width / 2, panelY + 76, 4.0F, 16777215);

        renderInset(poseStack, panelX + 16, panelY + 110, panelWidth - 32, 18);
        drawCenteredString(poseStack, this.font, new TextComponent("Movement and timers remain frozen until release"), this.width / 2, panelY + 115, 10526880);

        renderOpponentCard(poseStack, session == null ? null : session.getOpponent());
    }

    @Override
    public boolean shouldCloseOnEsc() {
        return false;
    }

    @Override
    public boolean isPauseScreen() {
        return true;
    }

    @Override
    public void onClose() {
    }

    private void renderOpponentCard(PoseStack poseStack, MatchOpponent opponent) {
        if (opponent == null) {
            return;
        }

        int panelWidth = 168;
        int panelHeight = 58;
        int x = this.width - panelWidth - 12;
        int y = this.height - panelHeight - 12;

        renderFrame(poseStack, x, y, panelWidth, panelHeight);
        renderInset(poseStack, x + 6, y + 13, 32, 32);
        renderSkinHead(poseStack, opponent.getSkinTexture(), x + 10, y + 17, 24);
        drawString(poseStack, this.font, fit(opponent.getName(), 110), x + 46, y + 10, 16777215);
        drawString(poseStack, this.font, "Elo " + opponent.getElo(), x + 46, y + 23, 14737632);
        drawString(poseStack, this.font, fit(opponent.getRank(), 110), x + 46, y + 35, 14737632);
    }

    private void renderSkinHead(PoseStack poseStack, ResourceLocation texture, int x, int y, int size) {
        Minecraft.getInstance().getTextureManager().bind(texture);
        RenderSystem.color4f(1.0F, 1.0F, 1.0F, 1.0F);
        GuiComponent.blit(poseStack, x, y, 0, 8.0F, 8.0F, size, size, 64, 64);
        GuiComponent.blit(poseStack, x, y, 0, 40.0F, 8.0F, size, size, 64, 64);
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

    private String fit(String value, int maxWidth) {
        if (value == null) {
            return "";
        }
        String trimmed = this.font.plainSubstrByWidth(value, maxWidth);
        if (trimmed.length() == value.length()) {
            return trimmed;
        }
        String ellipsis = "...";
        return this.font.plainSubstrByWidth(value, maxWidth - this.font.width(ellipsis)) + ellipsis;
    }

    private void renderScaledCenteredText(PoseStack poseStack, String value, int centerX, int baselineY, float scale, int color) {
        poseStack.pushPose();
        poseStack.scale(scale, scale, scale);
        float scaledX = (centerX / scale) - (this.font.width(value) / 2.0F);
        float scaledY = baselineY / scale;
        this.font.drawShadow(poseStack, value, scaledX, scaledY, color);
        poseStack.popPose();
    }
}
