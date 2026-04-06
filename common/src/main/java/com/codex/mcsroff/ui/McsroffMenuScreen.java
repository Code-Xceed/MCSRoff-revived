package com.codex.mcsroff.ui;

import com.codex.mcsroff.McsroffMod;
import com.codex.mcsroff.McsroffRuntime;
import com.codex.mcsroff.auth.AuthSession;
import com.codex.mcsroff.seed.FsgCooldownException;
import com.codex.mcsroff.seed.FsgFilter;
import com.codex.mcsroff.seed.SeedMode;
import com.mojang.blaze3d.vertex.PoseStack;
import net.minecraft.client.gui.components.Button;
import net.minecraft.client.gui.screens.Screen;
import net.minecraft.network.chat.TextComponent;

import java.io.IOException;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Comparator;
import java.util.List;
import java.util.concurrent.CompletableFuture;

public final class McsroffMenuScreen extends Screen {
    private final Screen lastScreen;

    private List<FsgFilter> filters = Collections.emptyList();
    private int selectedFilterIndex;
    private SeedMode selectedSeedMode;
    private CompletableFuture<AuthSession> accountFuture;
    private CompletableFuture<List<FsgFilter>> filtersFuture;
    private String statusMessage = "Loading filters...";

    private Button accountButton;
    private Button modeButton;
    private Button previousFilterButton;
    private Button nextFilterButton;
    private Button requestMatchButton;
    private Button reloadButton;

    public McsroffMenuScreen(Screen lastScreen) {
        super(new TextComponent("offline MCSR"));
        this.lastScreen = lastScreen;
        this.selectedSeedMode = McsroffMod.getConfig().getDefaultSeedMode();
        this.selectedFilterIndex = -1;
    }

    @Override
    protected void init() {
        int centerX = this.width / 2;
        int baseY = this.height / 4 + 24;

        this.accountButton = this.addScreenButton(new Button(centerX - 100, baseY, 200, 20, new TextComponent("Account"), new Button.OnPress() {
            @Override
            public void onPress(Button button) {
                minecraft.setScreen(new AccountLinkScreen(McsroffMenuScreen.this));
            }
        }));
        this.modeButton = this.addScreenButton(new Button(centerX - 100, baseY, 200, 20, new TextComponent("Mode"), new Button.OnPress() {
            @Override
            public void onPress(Button button) {
                cycleSeedMode();
            }
        }));
        this.modeButton.y = baseY + 28;
        this.previousFilterButton = this.addScreenButton(new Button(centerX - 100, baseY + 52, 20, 20, new TextComponent("<"), new Button.OnPress() {
            @Override
            public void onPress(Button button) {
                moveFilterSelection(-1);
            }
        }));
        this.nextFilterButton = this.addScreenButton(new Button(centerX + 80, baseY + 52, 20, 20, new TextComponent(">"), new Button.OnPress() {
            @Override
            public void onPress(Button button) {
                moveFilterSelection(1);
            }
        }));
        this.requestMatchButton = this.addScreenButton(new Button(centerX - 100, baseY + 80, 200, 20, new TextComponent("Request Match"), new Button.OnPress() {
            @Override
            public void onPress(Button button) {
                openMatchmaking();
            }
        }));
        this.reloadButton = this.addScreenButton(new Button(centerX - 100, baseY + 104, 200, 20, new TextComponent("Reload Filters"), new Button.OnPress() {
            @Override
            public void onPress(Button button) {
                loadFilters(true);
            }
        }));
        this.addScreenButton(new Button(centerX - 100, baseY + 152, 200, 20, new TextComponent("Back"), new Button.OnPress() {
            @Override
            public void onPress(Button button) {
                onClose();
            }
        }));

        this.accountFuture = McsroffRuntime.getAccountManager().bootstrapSession();
        updateButtonLabels();
        loadFilters(false);
    }

    @Override
    public void tick() {
        if (this.accountFuture != null && this.accountFuture.isDone()) {
            try {
                AuthSession session = this.accountFuture.join();
                if (session != null) {
                    this.statusMessage = "Trusted account ready. Choose a seed type and request a match.";
                } else if (this.filtersFuture == null) {
                    this.statusMessage = "Link your website account before entering ranked matchmaking.";
                }
            } catch (Exception exception) {
                this.statusMessage = "Account restore failed: " + unwrapMessage(exception);
            } finally {
                this.accountFuture = null;
                updateButtonLabels();
            }
        }

        if (this.filtersFuture != null && this.filtersFuture.isDone()) {
            try {
                this.filters = sortFilters(this.filtersFuture.join());
                syncSelectedFilterWithConfig();
                this.statusMessage = this.filters.isEmpty()
                        ? "No race filters available."
                        : (McsroffRuntime.getAccountManager().hasTrustedSession()
                            ? "Choose a seed type and request a match."
                            : "Link your website account before entering ranked matchmaking.");
            } catch (Exception exception) {
                this.statusMessage = "Failed to load filters: " + unwrapMessage(exception);
            } finally {
                this.filtersFuture = null;
                updateButtonLabels();
            }
        }
    }

    @Override
    public void render(PoseStack poseStack, int mouseX, int mouseY, float partialTick) {
        this.renderBackground(poseStack);
        drawCenteredString(poseStack, this.font, this.title, this.width / 2, 20, 16777215);
        drawCenteredString(poseStack, this.font, new TextComponent("Loader: " + McsroffMod.getLoaderType().getId()), this.width / 2, 40, 10526880);
        AuthSession session = McsroffRuntime.getAccountManager().getCurrentSession();
        drawCenteredString(poseStack, this.font, new TextComponent("Player: " + this.minecraft.getUser().getName()), this.width / 2, 52, 10526880);
        drawCenteredString(
                poseStack,
                this.font,
                new TextComponent(session == null
                        ? "Account: Not linked"
                        : "Account: " + session.getDisplayName() + " | " + session.getRankTier() + " | Elo " + session.getElo()),
                this.width / 2,
                64,
                10526880
        );

        drawCenteredString(poseStack, this.font, new TextComponent("Seed Type"), this.width / 2, this.height / 4 + 78, 16777215);
        drawCenteredString(poseStack, this.font, new TextComponent(getSelectedFilterLabel()), this.width / 2, this.height / 4 + 90, 16777215);
        drawCenteredString(poseStack, this.font, new TextComponent(getSelectedFilterSummary()), this.width / 2, this.height / 4 + 102, 10526880);

        int infoY = this.height / 4 + 198;
        drawCenteredString(poseStack, this.font, new TextComponent(this.statusMessage), this.width / 2, infoY, 16777215);

        super.render(poseStack, mouseX, mouseY, partialTick);
    }

    @Override
    public void onClose() {
        this.minecraft.setScreen(this.lastScreen);
    }

    private void loadFilters(boolean forceReload) {
        if (this.filtersFuture != null) {
            return;
        }
        this.statusMessage = forceReload ? "Reloading filters..." : "Loading filters...";
        this.filtersFuture = McsroffRuntime.getFsgApi().fetchFilters();
        updateButtonLabels();
    }

    private void openMatchmaking() {
        if (this.filters.isEmpty() || !McsroffRuntime.getAccountManager().hasTrustedSession()) {
            return;
        }

        persistSelection();
        this.minecraft.setScreen(new MatchmakingScreen(
                this.lastScreen,
                this.selectedSeedMode,
                getSelectedFilterLabel(),
                getSelectedFilterIds()
        ));
    }

    private void cycleSeedMode() {
        this.selectedSeedMode = this.selectedSeedMode == SeedMode.PRACTICE ? SeedMode.MATCH : SeedMode.PRACTICE;
        persistSelection();
        updateButtonLabels();
    }

    private void moveFilterSelection(int delta) {
        if (this.filters.isEmpty()) {
            return;
        }
        int totalSlots = this.filters.size() + 1;
        int currentSlot = this.selectedFilterIndex + 1;
        int nextSlot = (currentSlot + delta + totalSlots) % totalSlots;
        this.selectedFilterIndex = nextSlot - 1;
        persistSelection();
        updateButtonLabels();
    }

    private void syncSelectedFilterWithConfig() {
        List<String> configuredFilters = McsroffMod.getConfig().getDefaultFilters();
        if (configuredFilters.isEmpty() || configuredFilters.size() > 1) {
            this.selectedFilterIndex = -1;
            return;
        }

        String preferredFilter = configuredFilters.get(0);
        for (int index = 0; index < this.filters.size(); index++) {
            if (preferredFilter.equals(this.filters.get(index).getId())) {
                this.selectedFilterIndex = index;
                return;
            }
        }
        this.selectedFilterIndex = -1;
    }

    private void persistSelection() {
        McsroffMod.getConfig().setDefaultSeedMode(this.selectedSeedMode);
        McsroffMod.getConfig().setDefaultFilters(getSelectedFilterIds());
        try {
            McsroffMod.getConfig().save();
        } catch (IOException exception) {
            McsroffMod.LOGGER.warn("Failed to save config", exception);
        }
    }

    private void updateButtonLabels() {
        if (this.modeButton != null) {
            this.modeButton.setMessage(new TextComponent("Mode: " + formatMode(this.selectedSeedMode)));
        }

        boolean accountBusy = this.accountFuture != null;
        boolean linked = McsroffRuntime.getAccountManager().hasTrustedSession();
        boolean hasFilters = !this.filters.isEmpty();
        boolean busy = this.filtersFuture != null;
        boolean matchReady = linked && hasFilters && !busy && !accountBusy;

        if (this.accountButton != null) {
            this.accountButton.active = !accountBusy;
            this.accountButton.setMessage(new TextComponent(linked ? "Account Linked" : (accountBusy ? "Checking Account..." : "Link Account")));
        }

        if (this.previousFilterButton != null) {
            this.previousFilterButton.active = hasFilters && !busy && !accountBusy;
        }
        if (this.nextFilterButton != null) {
            this.nextFilterButton.active = hasFilters && !busy && !accountBusy;
        }
        if (this.requestMatchButton != null) {
            this.requestMatchButton.active = matchReady;
            if (accountBusy) {
                this.requestMatchButton.setMessage(new TextComponent("Checking Account..."));
            } else if (!linked) {
                this.requestMatchButton.setMessage(new TextComponent("Link Account First"));
            } else {
                this.requestMatchButton.setMessage(new TextComponent(busy ? "Loading..." : "Request Match"));
            }
        }
        if (this.reloadButton != null) {
            this.reloadButton.active = !busy && !accountBusy;
        }
    }

    private String getSelectedFilterLabel() {
        if (this.filters.isEmpty()) {
            return this.filtersFuture != null ? "Loading..." : "Unavailable";
        }
        if (this.selectedFilterIndex < 0) {
            return "Random FSG Race Pool";
        }
        return this.filters.get(this.selectedFilterIndex).getDisplayName();
    }

    private String getSelectedFilterSummary() {
        if (this.filters.isEmpty()) {
            return "";
        }
        if (this.selectedFilterIndex < 0) {
            return "Randomly picks from the approved race pools";
        }

        String id = this.filters.get(this.selectedFilterIndex).getId();
        if ("zsg".equals(id)) {
            return "Recommended standard race pool";
        }
        if ("zsgvillage".equals(id)) {
            return "Village-biased FSG race pool";
        }
        if ("zsgtemple".equals(id)) {
            return "Temple-biased FSG race pool";
        }
        if ("zsgshipwreck".equals(id)) {
            return "Shipwreck-biased FSG race pool";
        }
        return "Approved 1.16.1 race pool";
    }

    private List<String> getSelectedFilterIds() {
        if (this.selectedFilterIndex < 0) {
            List<String> ids = new ArrayList<String>(this.filters.size());
            for (FsgFilter filter : this.filters) {
                ids.add(filter.getId());
            }
            return ids;
        }
        return Collections.singletonList(this.filters.get(this.selectedFilterIndex).getId());
    }

    private static String formatMode(SeedMode mode) {
        return mode == SeedMode.PRACTICE ? "Practice Seeds" : "Fresh Race Seeds";
    }

    private static List<FsgFilter> sortFilters(List<FsgFilter> filters) {
        List<FsgFilter> sorted = new ArrayList<FsgFilter>();
        for (FsgFilter filter : filters) {
            if (isRaceReadyFilter(filter)) {
                sorted.add(filter);
            }
        }
        Collections.sort(sorted, new Comparator<FsgFilter>() {
            @Override
            public int compare(FsgFilter left, FsgFilter right) {
                int raceCompare = Integer.compare(getRacePriority(left), getRacePriority(right));
                if (raceCompare != 0) {
                    return raceCompare;
                }
                return left.getDisplayName().compareToIgnoreCase(right.getDisplayName());
            }
        });
        return Collections.unmodifiableList(sorted);
    }

    private static boolean isRaceReadyFilter(FsgFilter filter) {
        if (!filter.getSupportedVersions().contains("1.16.1")) {
            return false;
        }
        String id = filter.getId();
        return "zsg".equals(id) || "zsgvillage".equals(id) || "zsgtemple".equals(id) || "zsgshipwreck".equals(id);
    }

    private static int getRacePriority(FsgFilter filter) {
        String id = filter.getId();
        if ("zsg".equals(id)) {
            return 0;
        }
        if ("zsgvillage".equals(id)) {
            return 1;
        }
        if ("zsgtemple".equals(id)) {
            return 2;
        }
        if ("zsgshipwreck".equals(id)) {
            return 3;
        }
        return 100;
    }

    private static String unwrapMessage(Throwable throwable) {
        Throwable current = throwable;
        while (current.getCause() != null) {
            current = current.getCause();
        }
        if (current instanceof FsgCooldownException) {
            return "Cooldown " + ((FsgCooldownException) current).getCooldownMillis() + "ms";
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
