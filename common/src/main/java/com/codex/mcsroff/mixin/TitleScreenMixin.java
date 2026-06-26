package com.codex.mcsroff.mixin;

import com.codex.mcsroff.ui.AuthGateScreen;
import net.minecraft.client.gui.components.Button;
import net.minecraft.client.gui.screens.Screen;
import net.minecraft.client.gui.screens.TitleScreen;
import net.minecraft.network.chat.Component;
import net.minecraft.network.chat.TextComponent;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;

import java.util.List;

@Mixin(TitleScreen.class)
public abstract class TitleScreenMixin extends Screen {
    protected TitleScreenMixin(Component title) {
        super(title);
    }

    @Inject(method = "init", at = @At("TAIL"))
    private void mcsroff$addButton(CallbackInfo callbackInfo) {
        // Add a clearly visible MCSR button below the standard title screen buttons
        int buttonWidth = 200;
        int centerX = this.width / 2;
        int buttonY = this.height / 4 + 140;

        Button mcsrButton = new Button(
                centerX - buttonWidth / 2,
                buttonY,
                buttonWidth,
                20,
                new TextComponent("\u00A76\u269B offline MCSR"),
                button -> this.minecraft.setScreen(new AuthGateScreen((Screen) (Object) this))
        );

        addModButton(mcsrButton);
    }

    @SuppressWarnings({"rawtypes", "unchecked"})
    private void addModButton(Button button) {
        this.children.add(button);
        ((List) this.buttons).add(button);
    }
}
