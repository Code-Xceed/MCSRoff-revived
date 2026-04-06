package com.codex.mcsroff.ui;

import com.codex.mcsroff.McsroffMod;
import com.codex.mcsroff.McsroffRuntime;
import com.codex.mcsroff.auth.AccountManager;
import com.codex.mcsroff.auth.AuthSession;
import com.codex.mcsroff.auth.DeviceLinkChallenge;
import com.codex.mcsroff.auth.DeviceLinkPollResult;
import com.codex.mcsroff.util.BrowserLauncher;
import com.mojang.blaze3d.vertex.PoseStack;
import net.minecraft.client.gui.components.Button;
import net.minecraft.client.gui.screens.Screen;
import net.minecraft.network.chat.TextComponent;

import java.util.List;
import java.util.concurrent.CompletableFuture;

public final class AccountLinkScreen extends Screen {
    private static final int FRAME_LIGHT = 0xFF6E6E6E;
    private static final int FRAME_DARK = 0xFF2A2A2A;
    private static final int PANEL_FILL = 0xCC1A1A1A;
    private static final int PANEL_INSET = 0xAA3B3B3B;

    private final Screen lastScreen;
    private final Screen successScreen;
    private final boolean requiredFlow;

    private CompletableFuture<AuthSession> bootstrapFuture;
    private CompletableFuture<DeviceLinkChallenge> linkStartFuture;
    private CompletableFuture<DeviceLinkPollResult> pollFuture;
    private DeviceLinkChallenge challenge;
    private String statusLine = "Checking account session...";
    private long nextPollAtMillis;

    private Button linkButton;
    private Button unlinkButton;
    private Button openWebsiteButton;

    public AccountLinkScreen(Screen lastScreen) {
        this(lastScreen, lastScreen, false);
    }

    public AccountLinkScreen(Screen lastScreen, Screen successScreen, boolean requiredFlow) {
        super(new TextComponent("Account"));
        this.lastScreen = lastScreen;
        this.successScreen = successScreen;
        this.requiredFlow = requiredFlow;
    }

    public static AccountLinkScreen required(Screen lastScreen) {
        return new AccountLinkScreen(lastScreen, new McsroffMenuScreen(lastScreen), true);
    }

    @Override
    protected void init() {
        int centerX = this.width / 2;
        int baseY = this.height - 86;

        this.linkButton = this.addScreenButton(new Button(centerX - 100, baseY, 96, 20, new TextComponent("Link Account"), new Button.OnPress() {
            @Override
            public void onPress(Button button) {
                beginLink();
            }
        }));
        this.unlinkButton = this.addScreenButton(new Button(centerX + 4, baseY, 96, 20, new TextComponent("Unlink"), new Button.OnPress() {
            @Override
            public void onPress(Button button) {
                McsroffRuntime.getAccountManager().clearSession();
                challenge = null;
                statusLine = "Local session cleared.";
                updateButtons();
            }
        }));
        this.openWebsiteButton = this.addScreenButton(new Button(centerX - 100, baseY + 24, 200, 20, new TextComponent("Open Website"), new Button.OnPress() {
            @Override
            public void onPress(Button button) {
                openWebsite();
            }
        }));
        this.addScreenButton(new Button(centerX - 100, baseY + 48, 200, 20, new TextComponent(this.requiredFlow ? "Cancel" : "Back"), new Button.OnPress() {
            @Override
            public void onPress(Button button) {
                onClose();
            }
        }));

        this.bootstrapFuture = McsroffRuntime.getAccountManager().bootstrapSession();
        updateButtons();
    }

    @Override
    public void tick() {
        if (this.bootstrapFuture != null && this.bootstrapFuture.isDone()) {
            try {
                AuthSession session = this.bootstrapFuture.join();
                this.statusLine = session == null ? "No trusted account linked yet." : "Trusted account session restored.";
                if (session != null) {
                    if (this.requiredFlow) {
                        continueAfterSuccess();
                        return;
                    }
                } else if (this.requiredFlow && this.linkStartFuture == null && this.challenge == null) {
                    beginLink();
                }
            } catch (Exception exception) {
                this.statusLine = "Session restore failed: " + unwrapMessage(exception);
            } finally {
                this.bootstrapFuture = null;
                updateButtons();
            }
        }

        if (this.linkStartFuture != null && this.linkStartFuture.isDone()) {
            try {
                this.challenge = this.linkStartFuture.join();
                this.statusLine = "Open the website and approve this device code.";
                this.nextPollAtMillis = System.currentTimeMillis() + this.challenge.getPollIntervalMillis();
            } catch (Exception exception) {
                this.statusLine = "Link start failed: " + unwrapMessage(exception);
            } finally {
                this.linkStartFuture = null;
                updateButtons();
            }
        }

        if (this.challenge != null && !this.challenge.isExpired() && this.pollFuture == null && System.currentTimeMillis() >= this.nextPollAtMillis) {
            this.pollFuture = McsroffRuntime.getAccountManager().pollDeviceLink(this.challenge);
            this.nextPollAtMillis = System.currentTimeMillis() + this.challenge.getPollIntervalMillis();
        }

        if (this.pollFuture != null && this.pollFuture.isDone()) {
            try {
                DeviceLinkPollResult result = this.pollFuture.join();
                if (result.getStatus() == DeviceLinkPollResult.Status.APPROVED) {
                    this.challenge = null;
                    this.statusLine = "Account linked successfully.";
                    if (this.requiredFlow) {
                        continueAfterSuccess();
                        return;
                    }
                } else if (result.getStatus() == DeviceLinkPollResult.Status.DENIED) {
                    this.challenge = null;
                    this.statusLine = "Link request denied on website.";
                } else if (result.getStatus() == DeviceLinkPollResult.Status.EXPIRED) {
                    this.challenge = null;
                    this.statusLine = "Link code expired. Start again.";
                } else {
                    this.statusLine = "Waiting for website approval...";
                }
            } catch (Exception exception) {
                this.statusLine = "Link polling failed: " + unwrapMessage(exception);
            } finally {
                this.pollFuture = null;
                updateButtons();
            }
        }

        if (this.challenge != null && this.challenge.isExpired()) {
            this.challenge = null;
            this.statusLine = "Link code expired. Start again.";
            updateButtons();
        }
    }

    @Override
    public void render(PoseStack poseStack, int mouseX, int mouseY, float partialTick) {
        this.renderBackground(poseStack);

        int panelWidth = 300;
        int panelHeight = 212;
        int panelX = (this.width - panelWidth) / 2;
        int panelY = 28;

        renderFrame(poseStack, panelX, panelY, panelWidth, panelHeight);
        renderInset(poseStack, panelX + 10, panelY + 10, panelWidth - 20, 18);
        drawCenteredString(poseStack, this.font, this.title, this.width / 2, panelY + 15, 16777215);

        AuthSession session = McsroffRuntime.getAccountManager().getCurrentSession();
        renderInset(poseStack, panelX + 12, panelY + 36, panelWidth - 24, 64);
        drawString(poseStack, this.font, "Status", panelX + 20, panelY + 44, 11184810);
        renderWrappedText(poseStack, session == null ? "Not linked" : "Linked and trusted", panelX + 20, panelY + 56, panelWidth - 40, 16777215, 1);
        if (session != null) {
            drawString(poseStack, this.font, fit("Account: " + session.getDisplayName(), panelWidth - 40), panelX + 20, panelY + 68, 14737632);
            drawString(poseStack, this.font, fit("Username: " + session.getUsername(), panelWidth - 40), panelX + 20, panelY + 80, 14737632);
            drawString(poseStack, this.font, fit("Rank: " + session.getRankTier() + " | Elo " + session.getElo(), panelWidth - 40), panelX + 20, panelY + 92, 14737632);
        } else {
            drawString(poseStack, this.font, "Competitive play requires website-linked identity.", panelX + 20, panelY + 68, 14737632);
        }

        renderInset(poseStack, panelX + 12, panelY + 108, panelWidth - 24, 78);
        drawString(poseStack, this.font, "Device Link", panelX + 20, panelY + 116, 11184810);
        if (this.challenge == null) {
            renderWrappedText(poseStack, this.statusLine, panelX + 20, panelY + 130, panelWidth - 40, 16777215, 3);
            drawString(poseStack, this.font, fit("Website: " + McsroffMod.getConfig().getWebAppBaseUrl(), panelWidth - 40), panelX + 20, panelY + 164, 14737632);
        } else {
            drawString(poseStack, this.font, fit("Code: " + this.challenge.getUserCode(), panelWidth - 40), panelX + 20, panelY + 130, 16777215);
            drawString(poseStack, this.font, fit("Open: " + this.challenge.getVerificationUri(), panelWidth - 40), panelX + 20, panelY + 142, 14737632);
            drawString(poseStack, this.font, fit("Code expires soon. Approval is required before matchmaking.", panelWidth - 40), panelX + 20, panelY + 154, 14737632);
            drawString(poseStack, this.font, fit(this.statusLine, panelWidth - 40), panelX + 20, panelY + 166, 14737632);
        }

        super.render(poseStack, mouseX, mouseY, partialTick);
    }

    @Override
    public void onClose() {
        this.minecraft.setScreen(this.lastScreen);
    }

    private void continueAfterSuccess() {
        this.minecraft.setScreen(this.successScreen);
    }

    private void beginLink() {
        if (this.linkStartFuture != null || this.pollFuture != null) {
            return;
        }
        AccountManager accountManager = McsroffRuntime.getAccountManager();
        String displayName = this.minecraft.getUser().getName();
        this.challenge = null;
        this.statusLine = "Requesting device code from website auth...";
        this.linkStartFuture = accountManager.startDeviceLink(displayName);
        updateButtons();
    }

    private void openWebsite() {
        String target = this.challenge != null
                ? this.challenge.getVerificationUriComplete()
                : McsroffMod.getConfig().getWebAppBaseUrl();
        if (BrowserLauncher.open(target)) {
            this.statusLine = this.challenge != null
                    ? "Browser opened. Finish account approval on the website."
                    : "Browser opened. Sign in or create an account on the website.";
        } else {
            this.statusLine = "Failed to open browser. Open this manually: " + target;
        }
        updateButtons();
    }

    private void updateButtons() {
        boolean busy = this.bootstrapFuture != null || this.linkStartFuture != null || this.pollFuture != null;
        boolean linked = McsroffRuntime.getAccountManager().hasTrustedSession();
        if (this.linkButton != null) {
            this.linkButton.active = !busy;
            this.linkButton.setMessage(new TextComponent(linked ? "Relink Account" : "Link Account"));
        }
        if (this.unlinkButton != null) {
            this.unlinkButton.active = !busy && linked;
        }
        if (this.openWebsiteButton != null) {
            this.openWebsiteButton.active = !busy;
            this.openWebsiteButton.setMessage(new TextComponent(this.challenge == null ? "Open Website" : "Open Approval Page"));
        }
    }

    private void renderFrame(PoseStack poseStack, int x, int y, int width, int height) {
        fill(poseStack, x, y, x + width, y + height, PANEL_FILL);
        fill(poseStack, x, y, x + width, y + 1, FRAME_LIGHT);
        fill(poseStack, x, y, x + 1, y + height, FRAME_LIGHT);
        fill(poseStack, x + width - 1, y, x + width, y + height, FRAME_DARK);
        fill(poseStack, x, y + height - 1, x + width, y + height, FRAME_DARK);
    }

    private void renderInset(PoseStack poseStack, int x, int y, int width, int height) {
        fill(poseStack, x, y, x + width, y + height, PANEL_INSET);
        fill(poseStack, x, y, x + width, y + 1, FRAME_DARK);
        fill(poseStack, x, y, x + 1, y + height, FRAME_DARK);
        fill(poseStack, x + width - 1, y, x + width, y + height, FRAME_LIGHT);
        fill(poseStack, x, y + height - 1, x + width, y + height, FRAME_LIGHT);
    }

    private void renderWrappedText(PoseStack poseStack, String value, int x, int y, int maxWidth, int color, int maxLines) {
        List<net.minecraft.network.chat.FormattedText> lines = this.font.split(new TextComponent(value == null ? "" : value), Math.max(24, maxWidth));
        int lineCount = Math.min(lines.size(), maxLines);
        for (int index = 0; index < lineCount; index++) {
            this.font.draw(poseStack, lines.get(index), x, y + (index * 10), color);
        }
    }

    private String fit(String value, int maxWidth) {
        if (value == null) {
            return "";
        }
        String trimmed = this.font.plainSubstrByWidth(value, maxWidth);
        if (trimmed.length() == value.length()) {
            return trimmed;
        }
        String ellipsis = "...";
        return this.font.plainSubstrByWidth(value, maxWidth - this.font.width(ellipsis)) + ellipsis;
    }

    private static String unwrapMessage(Throwable throwable) {
        Throwable current = throwable;
        while (current.getCause() != null) {
            current = current.getCause();
        }
        return current.getMessage() == null ? current.getClass().getSimpleName() : current.getMessage();
    }

    @SuppressWarnings({"rawtypes", "unchecked"})
    private Button addScreenButton(Button button) {
        this.children.add(button);
        ((List) this.buttons).add(button);
        return button;
    }
}
