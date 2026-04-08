package com.codex.mcsroff.mixin;

import com.codex.mcsroff.McsroffRuntime;
import net.minecraft.core.BlockPos;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.world.entity.Entity;
import net.minecraft.world.level.Level;
import net.minecraft.world.level.block.EndPortalBlock;
import net.minecraft.world.level.block.state.BlockState;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;

@Mixin(EndPortalBlock.class)
public abstract class EndPortalBlockMixin {
    @Inject(method = "entityInside", at = @At("HEAD"), cancellable = true)
    private void mcsroff$handleLiveMatchEndPortal(BlockState state, Level level, BlockPos pos, Entity entity, CallbackInfo callbackInfo) {
        if (!(entity instanceof ServerPlayer) || level == null || level.dimension() != Level.END) {
            return;
        }
        if (!McsroffRuntime.getTelemetryManager().isLiveMatchRunning()) {
            return;
        }
        McsroffRuntime.getTelemetryManager().reportLocalPortalFinish();
        callbackInfo.cancel();
    }
}
