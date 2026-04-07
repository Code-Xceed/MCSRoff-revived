package com.codex.mcsroff.ui;

import com.codex.mcsroff.McsroffRuntime;
import com.codex.mcsroff.match.MatchOpponent;
import com.codex.mcsroff.match.MatchSession;
import com.mojang.blaze3d.systems.RenderSystem;
import com.mojang.blaze3d.vertex.PoseStack;
import net.minecraft.client.Minecraft;
import net.minecraft.client.gui.GuiComponent;
import net.minecraft.client.gui.components.Button;
import net.minecraft.client.gui.screens.Screen;
import net.minecraft.network.chat.TextComponent;
import net.minecraft.resources.ResourceLocation;

public final class WorldPreparationScreen extends Screen {
    private static final int FRAME_LIGHT = 0xFF6E6E6E;
    private static final int FRAME_DARK = 0xFF2A2A2A;
    private static final int PANEL_FILL = 0xC4181818;
    private static final int PANEL_INSET = 0xAA3B3B3B;
    private Button quitButton;

    public WorldPreparationScreen() {
        super(new TextComponent("World Preparation"));
    }

    @Override
    protected void init() {
        int buttonWidth = 132;
        this.quitButton = this.addButton(new Button(
                (this.width - buttonWidth) / 2,
                (this.height / 2) + 74,
                buttonWidth,
                20,
                new TextComponent("Quit Match"),
                new Button.OnPress() {
                    @Override
                    public void onPress(Button button) {
                        McsroffRuntime.getPreRaceController().quitAbortedMatch(Minecraft.getInstance());
                    }
                }
        ));
        this.quitButton.visible = false;
        this.quitButton.active = false;
    }

    @Override
    public void tick() {
        McsroffRuntime.getPreRaceController().onClientTick(Minecraft.getInstance());
        if (this.quitButton != null) {
            boolean aborted = McsroffRuntime.getPreRaceController().isAborted();
            this.quitButton.visible = aborted;
            this.quitButton.active = aborted;
        }
    }

    @Override
    public void render(PoseStack poseStack, int mouseX, int mouseY, float partialTick) {
        this.renderBackground(poseStack);

        MatchSession session = McsroffRuntime.getPreRaceController().getActiveSession();
        String seedTypeLine = session == null ? "Preparing race world" : session.getSeedTypeLabel();
        String localStatus = McsroffRuntime.getPreRaceController().getLocalWorldStatus();
        String opponentStatus = McsroffRuntime.getPreRaceController().getOpponentWorldStatus();
        boolean aborted = McsroffRuntime.getPreRaceController().isAborted();
        int panelWidth = 284;
        int panelHeight = 164;
        int panelX = (this.width - panelWidth) / 2;
        int panelY = (this.height - panelHeight) / 2 - 18;

        renderFrame(poseStack, panelX, panelY, panelWidth, panelHeight);
        renderInset(poseStack, panelX + 10, panelY + 10, panelWidth - 20, 18);
        drawCenteredString(poseStack, this.font, new TextComponent("Generating Race World"), this.width / 2, panelY + 15, 16777215);
        drawCenteredString(poseStack, this.font, new TextComponent(fit(seedTypeLine, panelWidth - 42)), this.width / 2, panelY + 31, 0xFFE0C36A);

        renderInset(poseStack, panelX + 20, panelY + 46, 88, 88);
        renderLoaderGrid(poseStack, panelX + 64, panelY + 90);

        renderInset(poseStack, panelX + 118, panelY + 46, panelWidth - 138, 40);
        drawString(poseStack, this.font, "Local World", panelX + 128, panelY + 56, 11184810);
        renderWrappedText(poseStack, localStatus, panelX + 128, panelY + 68, panelWidth - 158, 16777215, 2);

        renderInset(poseStack, panelX + 118, panelY + 94, panelWidth - 138, 40);
        drawString(poseStack, this.font, "Opponent World", panelX + 128, panelY + 104, 11184810);
        renderWrappedText(poseStack, opponentStatus, panelX + 128, panelY + 116, panelWidth - 158, 16777215, 2);

        renderInset(poseStack, panelX + 20, panelY + 140, panelWidth - 40, 14);
        drawCenteredString(
                poseStack,
                this.font,
                new TextComponent(aborted
                        ? fit(McsroffRuntime.getPreRaceController().getAbortReason(), panelWidth - 50)
                        : "Both runners stay locked until both worlds are ready."),
                this.width / 2,
                panelY + 144,
                aborted ? 0xFFE38C8C : 10526880
        );

        renderOpponentStatus(poseStack, session == null ? null : session.getOpponent(), opponentStatus);
        super.render(poseStack, mouseX, mouseY, partialTick);
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

    private void renderLoaderGrid(PoseStack poseStack, int centerX, int centerY) {
        int cellSize = 12;
        int gap = 4;
        int gridSize = (cellSize * 3) + (gap * 2);
        int startX = centerX - (gridSize / 2);
        int startY = centerY - (gridSize / 2);
        long phase = (System.currentTimeMillis() / 140L) % 9L;

        for (int index = 0; index < 9; index++) {
            int row = index / 3;
            int column = index % 3;
            int x = startX + (column * (cellSize + gap));
            int y = startY + (row * (cellSize + gap));
            boolean active = index == phase || index == ((phase + 8L) % 9L);
            int fillColor = active ? 0xFFD9D9D9 : 0xFF6A6A6A;
            fill(poseStack, x, y, x + cellSize, y + cellSize, fillColor);
            fill(poseStack, x, y, x + cellSize, y + 1, FRAME_LIGHT);
            fill(poseStack, x, y, x + 1, y + cellSize, FRAME_LIGHT);
            fill(poseStack, x + cellSize - 1, y, x + cellSize, y + cellSize, FRAME_DARK);
            fill(poseStack, x, y + cellSize - 1, x + cellSize, y + cellSize, FRAME_DARK);
        }
    }

    private void renderOpponentStatus(PoseStack poseStack, MatchOpponent opponent, String opponentStatus) {
        if (opponent == null) {
            return;
        }

        int panelWidth = 170;
        int panelHeight = 52;
        int x = this.width - panelWidth - 12;
        int y = this.height - panelHeight - 12;

        renderFrame(poseStack, x, y, panelWidth, panelHeight);
        renderInset(poseStack, x + 6, y + 10, 32, 32);
        renderSkinHead(poseStack, opponent.getSkinTexture(), x + 10, y + 14, 24);

        drawString(poseStack, this.font, fit(opponent.getName(), 112), x + 46, y + 12, 16777215);
        drawString(poseStack, this.font, "World: " + fit(opponentStatus, 108), x + 46, y + 24, 14737632);
        drawString(poseStack, this.font, "Status feed", x + 46, y + 36, 11184810);
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

    private void renderWrappedText(PoseStack poseStack, String value, int x, int y, int maxWidth, int color, int maxLines) {
        java.util.List<net.minecraft.network.chat.FormattedText> lines = this.font.split(new TextComponent(value == null ? "" : value), Math.max(24, maxWidth));
        int renderedLines = Math.min(lines.size(), maxLines);
        for (int index = 0; index < renderedLines; index++) {
            net.minecraft.network.chat.FormattedText line = lines.get(index);
            if (index == renderedLines - 1 && lines.size() > maxLines) {
                this.font.draw(poseStack, fit(line.getString(), maxWidth), x, y + (index * 10), color);
            } else {
                this.font.draw(poseStack, line, x, y + (index * 10), color);
            }
        }
    }
}
