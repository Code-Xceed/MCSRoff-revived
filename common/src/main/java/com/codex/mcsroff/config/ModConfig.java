package com.codex.mcsroff.config;

import com.codex.mcsroff.seed.SeedMode;
import com.google.gson.Gson;
import com.google.gson.GsonBuilder;

import java.io.IOException;
import java.io.Reader;
import java.io.Writer;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;

public final class ModConfig {
    private static final Gson GSON = new GsonBuilder().setPrettyPrinting().create();
    private static final String DEFAULT_BACKEND_BASE_URL = resolveSetting("mcsroff.backendBaseUrl", "MCSROFF_BACKEND_BASE_URL", "https://mcsroff-revived.onrender.com");
    private static final String DEFAULT_WEB_AUTH_API_BASE_URL = resolveSetting("mcsroff.webAuthApiBaseUrl", "MCSROFF_WEB_AUTH_API_BASE_URL", "");
    private static final String DEFAULT_WEB_APP_BASE_URL = resolveSetting("mcsroff.webAppBaseUrl", "MCSROFF_WEB_APP_BASE_URL", "");
    private static final String DEFAULT_SUPABASE_URL = resolveSetting("mcsroff.supabaseUrl", "MCSROFF_SUPABASE_URL", "");
    private static final String DEFAULT_SUPABASE_PUBLISHABLE_KEY = resolveSetting("mcsroff.supabasePublishableKey", "MCSROFF_SUPABASE_PUBLISHABLE_KEY", "");
    private static final String DEFAULT_SUPABASE_FUNCTION_URL = resolveSetting("mcsroff.supabaseFunctionUrl", "MCSROFF_SUPABASE_FUNCTION_URL", "");
    private static final String DEFAULT_FSG_BASE_URL = resolveSetting("mcsroff.fsgBaseUrl", "MCSROFF_FSG_BASE_URL", "https://www.filteredseed.com");

    private transient Path path;

    private String backendBaseUrl = DEFAULT_BACKEND_BASE_URL;
    private String webAuthApiBaseUrl = defaultWebAuthApiBaseUrl(DEFAULT_BACKEND_BASE_URL);
    private String webAppBaseUrl = defaultWebAppBaseUrl(DEFAULT_BACKEND_BASE_URL);
    private String modAccessToken = "";
    private String modRefreshToken = "";
    private String modUserId = "";
    private String modUsername = "";
    private String modDisplayName = "";
    private String modRankTier = "Unlinked";
    private int modElo;
    private long modAccessTokenExpiresAtEpochSeconds;
    private String supabaseUrl = DEFAULT_SUPABASE_URL;
    private String supabasePublishableKey = DEFAULT_SUPABASE_PUBLISHABLE_KEY;
    private String supabaseFunctionUrl = defaultSupabaseFunctionUrl(DEFAULT_SUPABASE_URL);
    private String supabaseAccessToken = "";
    private String supabaseRefreshToken = "";
    private String supabaseUserId = "";
    private long supabaseAccessTokenExpiresAtEpochSeconds;
    private String fsgBaseUrl = DEFAULT_FSG_BASE_URL;
    private String playerNameOverride = "";
    private SeedMode defaultSeedMode = SeedMode.MATCH;
    private List<String> defaultFilters = new ArrayList<String>(Arrays.asList("zsg"));
    private boolean debugMode;

    public static ModConfig load(Path path) throws IOException {
        if (Files.notExists(path)) {
            ModConfig config = new ModConfig();
            config.path = path;
            config.save();
            return config;
        }

        try (Reader reader = Files.newBufferedReader(path, StandardCharsets.UTF_8)) {
            ModConfig config = GSON.fromJson(reader, ModConfig.class);
            if (config == null) {
                config = new ModConfig();
            }
            config.path = path;
            config.normalize();
            return config;
        }
    }

    public void save() throws IOException {
        normalize();
        try (Writer writer = Files.newBufferedWriter(this.path, StandardCharsets.UTF_8)) {
            GSON.toJson(this, writer);
        }
    }

    private void normalize() {
        this.backendBaseUrl = normalizeUrlValue(this.backendBaseUrl, DEFAULT_BACKEND_BASE_URL);
        this.webAuthApiBaseUrl = normalizeUrlValue(this.webAuthApiBaseUrl, defaultWebAuthApiBaseUrl(this.backendBaseUrl));
        this.webAppBaseUrl = normalizeUrlValue(this.webAppBaseUrl, defaultWebAppBaseUrl(this.backendBaseUrl));
        if (this.modAccessToken == null) {
            this.modAccessToken = "";
        }
        if (this.modRefreshToken == null) {
            this.modRefreshToken = "";
        }
        if (this.modUserId == null) {
            this.modUserId = "";
        }
        if (this.modUsername == null) {
            this.modUsername = "";
        }
        if (this.modDisplayName == null) {
            this.modDisplayName = "";
        }
        if (this.modRankTier == null || this.modRankTier.trim().isEmpty()) {
            this.modRankTier = "Unlinked";
        }
        this.supabaseUrl = normalizeUrlValue(this.supabaseUrl, DEFAULT_SUPABASE_URL);
        this.supabasePublishableKey = normalizeTextValue(this.supabasePublishableKey, DEFAULT_SUPABASE_PUBLISHABLE_KEY);
        this.supabaseFunctionUrl = normalizeUrlValue(this.supabaseFunctionUrl, defaultSupabaseFunctionUrl(this.supabaseUrl));
        if (this.supabaseAccessToken == null) {
            this.supabaseAccessToken = "";
        }
        if (this.supabaseRefreshToken == null) {
            this.supabaseRefreshToken = "";
        }
        if (this.supabaseUserId == null) {
            this.supabaseUserId = "";
        }
        this.fsgBaseUrl = normalizeUrlValue(this.fsgBaseUrl, DEFAULT_FSG_BASE_URL);
        if (this.playerNameOverride == null) {
            this.playerNameOverride = "";
        }
        if (this.defaultSeedMode == null) {
            this.defaultSeedMode = SeedMode.MATCH;
        }
        if (this.defaultFilters == null || this.defaultFilters.isEmpty()) {
            this.defaultFilters = new ArrayList<String>(Arrays.asList("zsg"));
        }
    }

    public String getBackendBaseUrl() {
        return this.backendBaseUrl;
    }

    public String getFsgBaseUrl() {
        return this.fsgBaseUrl;
    }

    public String getWebAuthApiBaseUrl() {
        return this.webAuthApiBaseUrl;
    }

    public String getWebAppBaseUrl() {
        return this.webAppBaseUrl;
    }

    public String getModAccessToken() {
        return this.modAccessToken;
    }

    public String getModRefreshToken() {
        return this.modRefreshToken;
    }

    public String getModUserId() {
        return this.modUserId;
    }

    public String getModUsername() {
        return this.modUsername;
    }

    public String getModDisplayName() {
        return this.modDisplayName;
    }

    public String getModRankTier() {
        return this.modRankTier;
    }

    public int getModElo() {
        return this.modElo;
    }

    public long getModAccessTokenExpiresAtEpochSeconds() {
        return this.modAccessTokenExpiresAtEpochSeconds;
    }

    public String getSupabaseUrl() {
        return this.supabaseUrl;
    }

    public String getSupabasePublishableKey() {
        return this.supabasePublishableKey;
    }

    public String getSupabaseFunctionUrl() {
        return this.supabaseFunctionUrl;
    }

    public String getSupabaseAccessToken() {
        return this.supabaseAccessToken;
    }

    public String getSupabaseRefreshToken() {
        return this.supabaseRefreshToken;
    }

    public String getSupabaseUserId() {
        return this.supabaseUserId;
    }

    public long getSupabaseAccessTokenExpiresAtEpochSeconds() {
        return this.supabaseAccessTokenExpiresAtEpochSeconds;
    }

    public String getPlayerNameOverride() {
        return this.playerNameOverride;
    }

    public SeedMode getDefaultSeedMode() {
        return this.defaultSeedMode;
    }

    public List<String> getDefaultFilters() {
        return new ArrayList<String>(this.defaultFilters);
    }

    public boolean isDebugMode() {
        return this.debugMode;
    }

    public void setDefaultSeedMode(SeedMode defaultSeedMode) {
        this.defaultSeedMode = defaultSeedMode;
        normalize();
    }

    public void setDefaultFilters(List<String> defaultFilters) {
        this.defaultFilters = new ArrayList<String>(defaultFilters);
        normalize();
    }

    public void setPlayerNameOverride(String playerNameOverride) {
        this.playerNameOverride = playerNameOverride;
        normalize();
    }

    public void setSupabaseSession(String accessToken, String refreshToken, String userId, long expiresAtEpochSeconds) {
        this.supabaseAccessToken = accessToken == null ? "" : accessToken;
        this.supabaseRefreshToken = refreshToken == null ? "" : refreshToken;
        this.supabaseUserId = userId == null ? "" : userId;
        this.supabaseAccessTokenExpiresAtEpochSeconds = expiresAtEpochSeconds;
        normalize();
    }

    public void clearSupabaseSession() {
        this.supabaseAccessToken = "";
        this.supabaseRefreshToken = "";
        this.supabaseUserId = "";
        this.supabaseAccessTokenExpiresAtEpochSeconds = 0L;
        normalize();
    }

    public void setModSession(String accessToken, String refreshToken, String userId, String username, String displayName, int elo, String rankTier, long expiresAtEpochSeconds) {
        this.modAccessToken = accessToken == null ? "" : accessToken;
        this.modRefreshToken = refreshToken == null ? "" : refreshToken;
        this.modUserId = userId == null ? "" : userId;
        this.modUsername = username == null ? "" : username;
        this.modDisplayName = displayName == null ? "" : displayName;
        this.modElo = Math.max(0, elo);
        this.modRankTier = rankTier == null || rankTier.trim().isEmpty() ? "Unlinked" : rankTier;
        this.modAccessTokenExpiresAtEpochSeconds = expiresAtEpochSeconds;
        normalize();
    }

    public void clearModSession() {
        this.modAccessToken = "";
        this.modRefreshToken = "";
        this.modUserId = "";
        this.modUsername = "";
        this.modDisplayName = "";
        this.modElo = 0;
        this.modRankTier = "Unlinked";
        this.modAccessTokenExpiresAtEpochSeconds = 0L;
        normalize();
    }

    private static String resolveSetting(String systemPropertyKey, String environmentKey, String fallbackValue) {
        String value = System.getProperty(systemPropertyKey);
        if (value == null || value.trim().isEmpty()) {
            value = System.getenv(environmentKey);
        }
        if (value == null || value.trim().isEmpty()) {
            return fallbackValue;
        }
        return value.trim();
    }

    private static String normalizeTextValue(String value, String fallbackValue) {
        if (value == null || value.trim().isEmpty()) {
            return fallbackValue == null ? "" : fallbackValue;
        }
        return value.trim();
    }

    private static String normalizeUrlValue(String value, String fallbackValue) {
        String normalized = normalizeTextValue(value, fallbackValue);
        if (normalized.endsWith("/")) {
            return normalized.substring(0, normalized.length() - 1);
        }
        return normalized;
    }

    private static String defaultWebAuthApiBaseUrl(String backendBaseUrl) {
        String configured = normalizeUrlValue(DEFAULT_WEB_AUTH_API_BASE_URL, "");
        if (!configured.isEmpty()) {
            return configured;
        }
        String base = normalizeUrlValue(backendBaseUrl, DEFAULT_BACKEND_BASE_URL);
        return base.isEmpty() ? "" : base + "/mod-auth";
    }

    private static String defaultWebAppBaseUrl(String backendBaseUrl) {
        String configured = normalizeUrlValue(DEFAULT_WEB_APP_BASE_URL, "");
        if (!configured.isEmpty()) {
            return configured;
        }
        return normalizeUrlValue(backendBaseUrl, DEFAULT_BACKEND_BASE_URL);
    }

    private static String defaultSupabaseFunctionUrl(String supabaseUrl) {
        String configured = normalizeUrlValue(DEFAULT_SUPABASE_FUNCTION_URL, "");
        if (!configured.isEmpty()) {
            return configured;
        }
        String base = normalizeUrlValue(supabaseUrl, "");
        return base.isEmpty() ? "" : base + "/functions/v1/matchmaker";
    }

}
