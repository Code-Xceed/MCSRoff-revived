package com.codex.mcsroff.mixin;

import com.codex.mcsroff.McsroffRuntime;
import net.minecraft.server.level.ServerLevel;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.world.entity.Entity;
import net.minecraft.world.level.Level;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfoReturnable;

@Mixin(ServerPlayer.class)
public abstract class ServerPlayerMixin {
    @Inject(method = "changeDimension", at = @At("HEAD"))
    private void mcsroff$reportEndFountainCompletion(ServerLevel destination, CallbackInfoReturnable<Entity> callbackInfoReturnable) {
        ServerPlayer player = (ServerPlayer) (Object) this;
        if (player.level == null || destination == null) {
            return;
        }
        if (player.level.dimension() != Level.END || destination.dimension() != Level.OVERWORLD) {
            return;
        }
        McsroffRuntime.getTelemetryManager().reportLocalPortalFinish();
    }
}
