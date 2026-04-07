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

    private transient Path path;

    private String backendBaseUrl = "http://localhost:8080";
    private String webAuthApiBaseUrl = "http://localhost:8080/mod-auth";
    private String webAppBaseUrl = "http://localhost:8080";
    private String modAccessToken = "";
    private String modRefreshToken = "";
    private String modUserId = "";
    private String modUsername = "";
    private String modDisplayName = "";
    private String modRankTier = "Unlinked";
    private int modElo;
    private long modAccessTokenExpiresAtEpochSeconds;
    private String supabaseUrl = "https://uoqolyihlfnscikszxwc.supabase.co";
    private String supabasePublishableKey = "sb_publishable_CuY3gbqRbthBLxWjpPJHWA_oN96YAOQ";
    private String supabaseFunctionUrl = "https://uoqolyihlfnscikszxwc.supabase.co/functions/v1/matchmaker";
    private String supabaseAccessToken = "";
    private String supabaseRefreshToken = "";
    private String supabaseUserId = "";
    private long supabaseAccessTokenExpiresAtEpochSeconds;
    private String fsgBaseUrl = "https://www.filteredseed.com";
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
        if (this.backendBaseUrl == null || this.backendBaseUrl.trim().isEmpty()) {
            this.backendBaseUrl = "http://localhost:8080";
        }
        if (this.webAuthApiBaseUrl == null || this.webAuthApiBaseUrl.trim().isEmpty()) {
            this.webAuthApiBaseUrl = this.backendBaseUrl + "/mod-auth";
        }
        if (this.webAppBaseUrl == null || this.webAppBaseUrl.trim().isEmpty()) {
            this.webAppBaseUrl = "http://localhost:8080";
        }
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
        if (this.supabaseUrl == null || this.supabaseUrl.trim().isEmpty()) {
            this.supabaseUrl = "https://uoqolyihlfnscikszxwc.supabase.co";
        }
        if (this.supabasePublishableKey == null) {
            this.supabasePublishableKey = "";
        }
        if (this.supabaseFunctionUrl == null || this.supabaseFunctionUrl.trim().isEmpty()) {
            this.supabaseFunctionUrl = this.supabaseUrl + "/functions/v1/matchmaker";
        }
        if (this.supabaseAccessToken == null) {
            this.supabaseAccessToken = "";
        }
        if (this.supabaseRefreshToken == null) {
            this.supabaseRefreshToken = "";
        }
        if (this.supabaseUserId == null) {
            this.supabaseUserId = "";
        }
        if (this.fsgBaseUrl == null || this.fsgBaseUrl.trim().isEmpty()) {
            this.fsgBaseUrl = "https://www.filteredseed.com";
        }
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

}
