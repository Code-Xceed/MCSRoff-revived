package com.codex.mcsroff.mixin;

import com.codex.mcsroff.McsroffRuntime;
import net.minecraft.client.player.Input;
import net.minecraft.client.player.LocalPlayer;
import net.minecraft.world.phys.Vec3;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.Shadow;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;

@Mixin(LocalPlayer.class)
public abstract class LocalPlayerMixin {
    @Shadow public Input input;

    @Inject(method = "aiStep", at = @At("HEAD"))
    private void mcsroff$freezePreRaceMovement(CallbackInfo callbackInfo) {
        if (!McsroffRuntime.getPreRaceController().shouldFreezePlayer()) {
            return;
        }

        if (this.input != null) {
            this.input.leftImpulse = 0.0F;
            this.input.forwardImpulse = 0.0F;
            this.input.up = false;
            this.input.down = false;
            this.input.left = false;
            this.input.right = false;
            this.input.jumping = false;
            this.input.shiftKeyDown = false;
        }

        LocalPlayer player = (LocalPlayer) (Object) this;
        player.setDeltaMovement(Vec3.ZERO);
        player.setSprinting(false);
    }
}
