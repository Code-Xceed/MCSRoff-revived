package com.codex.mcsroff;

import com.codex.mcsroff.auth.AccountManager;
import com.codex.mcsroff.match.MatchManager;
import com.codex.mcsroff.net.BackendApi;
import com.codex.mcsroff.net.FsgApi;
import com.codex.mcsroff.net.MatchRealtimeClient;
import com.codex.mcsroff.net.SupabaseAuthApi;
import com.codex.mcsroff.net.WebAuthApi;
import com.codex.mcsroff.race.PreRaceController;
import com.codex.mcsroff.telemetry.TelemetryManager;
import com.codex.mcsroff.ui.McsroffScreens;
import com.codex.mcsroff.world.WorldLauncher;

public final class McsroffRuntime {
    private static boolean bootstrapped;
    private static BackendApi backendApi;
    private static FsgApi fsgApi;
    private static SupabaseAuthApi supabaseAuthApi;
    private static WebAuthApi webAuthApi;
    private static AccountManager accountManager;
    private static MatchManager matchManager;
    private static MatchRealtimeClient matchRealtimeClient;
    private static PreRaceController preRaceController;
    private static TelemetryManager telemetryManager;
    private static WorldLauncher worldLauncher;

    private McsroffRuntime() {
    }

    public static synchronized void bootstrap() {
        if (bootstrapped) {
            return;
        }

        String backendBaseUrl = trimTrailingSlash(McsroffMod.getConfig().getBackendBaseUrl());
        backendApi = new BackendApi(backendBaseUrl + "/matchmaker", backendBaseUrl + "/mod-stream/match", "");
        fsgApi = new FsgApi(McsroffMod.getConfig().getFsgBaseUrl());
        String supabaseUrl = trimTrailingSlash(McsroffMod.getConfig().getSupabaseUrl());
        String supabasePublishableKey = McsroffMod.getConfig().getSupabasePublishableKey();
        supabaseAuthApi = supabaseUrl.isEmpty() || supabasePublishableKey == null || supabasePublishableKey.trim().isEmpty()
                ? null
                : new SupabaseAuthApi(supabaseUrl, supabasePublishableKey.trim());
        webAuthApi = new WebAuthApi(McsroffMod.getConfig().getWebAuthApiBaseUrl());
        accountManager = new AccountManager(webAuthApi);
        matchManager = new MatchManager(backendApi, fsgApi);
        matchRealtimeClient = new MatchRealtimeClient(backendApi, accountManager);
        preRaceController = new PreRaceController();
        telemetryManager = new TelemetryManager();
        worldLauncher = new WorldLauncher();

        McsroffScreens.bootstrap();

        bootstrapped = true;
    }

    private static String trimTrailingSlash(String value) {
        if (value == null || value.isEmpty()) {
            return "";
        }
        return value.endsWith("/") ? value.substring(0, value.length() - 1) : value;
    }

    public static BackendApi getBackendApi() {
        return backendApi;
    }

    public static FsgApi getFsgApi() {
        return fsgApi;
    }

    public static SupabaseAuthApi getSupabaseAuthApi() {
        return supabaseAuthApi;
    }

    public static WebAuthApi getWebAuthApi() {
        return webAuthApi;
    }

    public static AccountManager getAccountManager() {
        return accountManager;
    }

    public static MatchManager getMatchManager() {
        return matchManager;
    }

    public static MatchRealtimeClient getMatchRealtimeClient() {
        return matchRealtimeClient;
    }

    public static PreRaceController getPreRaceController() {
        return preRaceController;
    }

    public static TelemetryManager getTelemetryManager() {
        return telemetryManager;
    }

    public static WorldLauncher getWorldLauncher() {
        return worldLauncher;
    }
}
