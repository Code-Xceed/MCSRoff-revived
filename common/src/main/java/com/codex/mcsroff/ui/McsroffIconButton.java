package com.codex.mcsroff.ui;

import com.mojang.blaze3d.vertex.PoseStack;
import net.minecraft.client.Minecraft;
import net.minecraft.client.gui.components.Button;
import net.minecraft.network.chat.TextComponent;
import net.minecraft.world.item.ItemStack;
import net.minecraft.world.item.Items;

public final class McsroffIconButton extends Button {
    private static final ItemStack ICON_STACK = new ItemStack(Items.GOLDEN_BOOTS);

    public McsroffIconButton(int x, int y, OnPress onPress) {
        super(x, y, 20, 20, new TextComponent(""), onPress);
    }

    @Override
    public void renderButton(PoseStack poseStack, int mouseX, int mouseY, float partialTick) {
        super.renderButton(poseStack, mouseX, mouseY, partialTick);
        Minecraft minecraft = Minecraft.getInstance();
        if (this.visible && minecraft != null) {
            int iconX = this.x + 2;
            int iconY = this.y + 2;
            minecraft.getItemRenderer().renderGuiItem(ICON_STACK, iconX, iconY);
        }
    }
}
