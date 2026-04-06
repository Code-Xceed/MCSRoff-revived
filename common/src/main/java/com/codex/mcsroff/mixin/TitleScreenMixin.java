package com.codex.mcsroff.mixin;

import com.codex.mcsroff.ui.AuthGateScreen;
import com.codex.mcsroff.ui.McsroffIconButton;
import net.minecraft.client.gui.components.Button;
import net.minecraft.client.gui.screens.Screen;
import net.minecraft.client.gui.screens.TitleScreen;
import net.minecraft.network.chat.Component;
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
        int buttonSize = 20;
        int margin = 4;
        int x = this.width - buttonSize - margin;
        int y = margin;

        this.children.add(addTitleButton(new McsroffIconButton(x, y, new Button.OnPress() {
            @Override
            public void onPress(Button button) {
                TitleScreenMixin.this.minecraft.setScreen(new AuthGateScreen((Screen) (Object) TitleScreenMixin.this));
            }
        })));
    }

    @SuppressWarnings({"rawtypes", "unchecked"})
    private Button addTitleButton(Button button) {
        ((List) this.buttons).add(button);
        return button;
    }
}
