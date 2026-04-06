package com.codex.mcsroff.net;

import com.codex.mcsroff.McsroffMod;
import com.codex.mcsroff.config.ModConfig;
import com.google.gson.JsonObject;

import java.io.IOException;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.CompletionException;

public final class SupabaseAuthApi {
    private final String supabaseUrl;
    private final String publishableKey;

    public SupabaseAuthApi(String supabaseUrl, String publishableKey) {
        this.supabaseUrl = supabaseUrl;
        this.publishableKey = publishableKey;
    }

    public CompletableFuture<SupabaseSession> ensureAnonymousSession(String displayName) {
        ModConfig config = McsroffMod.getConfig();
        SupabaseSession cached = new SupabaseSession(
                config.getSupabaseAccessToken(),
                config.getSupabaseRefreshToken(),
                config.getSupabaseUserId(),
                config.getSupabaseAccessTokenExpiresAtEpochSeconds()
        );

        if (cached.isUsable()) {
            return CompletableFuture.completedFuture(cached);
        }

        return CompletableFuture.supplyAsync(() -> {
            try {
                SupabaseSession refreshed = tryRefreshSession(cached.getRefreshToken());
                if (refreshed != null && refreshed.isUsable()) {
                    persistSession(refreshed);
                    return refreshed;
                }

                SupabaseSession created = signInAnonymously(displayName);
                persistSession(created);
                return created;
            } catch (IOException exception) {
                throw new CompletionException(exception);
            }
        });
    }

    private SupabaseSession signInAnonymously(String displayName) throws IOException {
        JsonObject requestBody = new JsonObject();
        JsonObject metadata = new JsonObject();
        metadata.addProperty("display_name", displayName == null ? "" : displayName);
        requestBody.add("data", metadata);

        JsonObject response = HttpJsonClient.postJson(
                this.supabaseUrl + "/auth/v1/signup",
                HttpJsonClient.headersWithApiKey(this.publishableKey),
                requestBody
        );
        return parseSession(response);
    }

    private SupabaseSession tryRefreshSession(String refreshToken) throws IOException {
        if (refreshToken == null || refreshToken.isEmpty()) {
            return null;
        }

        JsonObject requestBody = new JsonObject();
        requestBody.addProperty("refresh_token", refreshToken);

        JsonObject response = HttpJsonClient.postJson(
                this.supabaseUrl + "/auth/v1/token?grant_type=refresh_token",
                HttpJsonClient.headersWithApiKey(this.publishableKey),
                requestBody
        );
        return parseSession(response);
    }

    private void persistSession(SupabaseSession session) throws IOException {
        McsroffMod.getConfig().setSupabaseSession(
                session.getAccessToken(),
                session.getRefreshToken(),
                session.getUserId(),
                session.getExpiresAtEpochSeconds()
        );
        McsroffMod.getConfig().save();
    }

    private static SupabaseSession parseSession(JsonObject response) throws IOException {
        if (response == null || !response.has("access_token") || !response.has("user")) {
            throw new IOException("Supabase auth response did not contain a session");
        }

        JsonObject user = response.getAsJsonObject("user");
        String accessToken = response.get("access_token").getAsString();
        String refreshToken = response.has("refresh_token") && !response.get("refresh_token").isJsonNull()
                ? response.get("refresh_token").getAsString()
                : "";
        String userId = user.get("id").getAsString();
        long expiresAt = response.has("expires_at") && !response.get("expires_at").isJsonNull()
                ? response.get("expires_at").getAsLong()
                : ((System.currentTimeMillis() / 1000L) + 3600L);

        return new SupabaseSession(accessToken, refreshToken, userId, expiresAt);
    }
}
