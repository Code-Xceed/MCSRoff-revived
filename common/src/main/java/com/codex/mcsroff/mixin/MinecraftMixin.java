package com.codex.mcsroff.mixin;

import com.codex.mcsroff.McsroffRuntime;
import net.minecraft.client.Minecraft;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;

@Mixin(Minecraft.class)
public abstract class MinecraftMixin {
    @Inject(method = "tick", at = @At("TAIL"))
    private void mcsroff$runPreRaceController(CallbackInfo callbackInfo) {
        McsroffRuntime.getPreRaceController().onClientTick((Minecraft) (Object) this);
    }
}
