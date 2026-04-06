package com.codex.mcsroff.mixin;

import com.codex.mcsroff.McsroffRuntime;
import com.mojang.blaze3d.vertex.PoseStack;
import net.minecraft.client.Minecraft;
import net.minecraft.client.gui.Gui;
import org.spongepowered.asm.mixin.Final;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.Shadow;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;

@Mixin(Gui.class)
public abstract class GuiMixin {
    @Shadow @Final private Minecraft minecraft;

    @Inject(method = "render", at = @At("TAIL"))
    private void mcsroff$renderMatchHud(PoseStack poseStack, float partialTick, CallbackInfo callbackInfo) {
        McsroffRuntime.getTelemetryManager().renderHud(poseStack, this.minecraft);
    }
}
