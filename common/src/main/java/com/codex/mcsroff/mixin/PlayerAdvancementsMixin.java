package com.codex.mcsroff.mixin;

import com.codex.mcsroff.McsroffRuntime;
import net.minecraft.advancements.Advancement;
import net.minecraft.advancements.DisplayInfo;
import net.minecraft.network.chat.Component;
import net.minecraft.server.PlayerAdvancements;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfoReturnable;

@Mixin(PlayerAdvancements.class)
public abstract class PlayerAdvancementsMixin {
    @Inject(method = "award", at = @At("RETURN"))
    private void mcsroff$trackAwardedAdvancement(Advancement advancement, String criterion, CallbackInfoReturnable<Boolean> callbackInfo) {
        if (!callbackInfo.getReturnValueZ() || advancement == null) {
            return;
        }

        DisplayInfo display = advancement.getDisplay();
        if (display == null || !display.shouldAnnounceChat()) {
            return;
        }

        Component title = display.getTitle();
        McsroffRuntime.getTelemetryManager().recordAwardedAdvancement(
                advancement.getId() == null ? "" : advancement.getId().toString(),
                title == null ? "" : title.getString()
        );
    }
}
