package com.codex.mcsroff.mixin;

import com.codex.mcsroff.McsroffRuntime;
import net.minecraft.client.multiplayer.ClientPacketListener;
import net.minecraft.network.protocol.game.ClientboundGameEventPacket;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;

@Mixin(ClientPacketListener.class)
public abstract class ClientPacketListenerMixin {
    @Inject(method = "handleGameEvent", at = @At("HEAD"), cancellable = true)
    private void mcsroff$suppressCredits(ClientboundGameEventPacket packet, CallbackInfo callbackInfo) {
        if (packet == null || packet.getEvent() != ClientboundGameEventPacket.WIN_GAME) {
            return;
        }
        if (McsroffRuntime.getTelemetryManager().shouldSuppressWinGamePacket()) {
            callbackInfo.cancel();
        }
    }
}
