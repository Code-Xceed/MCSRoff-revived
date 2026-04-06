package com.codex.mcsroff.net;

import com.codex.mcsroff.auth.AuthSession;
import com.codex.mcsroff.auth.DeviceLinkChallenge;
import com.codex.mcsroff.auth.DeviceLinkPollResult;
import com.google.gson.JsonObject;

import java.io.IOException;
import java.util.HashMap;
import java.util.Map;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.CompletionException;

public final class WebAuthApi {
    private final String authApiBaseUrl;

    public WebAuthApi(String authApiBaseUrl) {
        this.authApiBaseUrl = trimTrailingSlash(authApiBaseUrl);
    }

    public CompletableFuture<AuthSession> refreshSession(final String refreshToken) {
        return CompletableFuture.supplyAsync(() -> {
            try {
                JsonObject body = new JsonObject();
                body.addProperty("refresh_token", refreshToken);
                return parseSession(HttpJsonClient.postJson(this.authApiBaseUrl + "/refresh", null, body));
            } catch (IOException exception) {
                throw new CompletionException(exception);
            }
        });
    }

    public CompletableFuture<DeviceLinkChallenge> startDeviceLink(final String minecraftName, final String loaderId) {
        return CompletableFuture.supplyAsync(() -> {
            try {
                JsonObject body = new JsonObject();
                body.addProperty("minecraft_name", minecraftName);
                body.addProperty("loader", loaderId);
                body.addProperty("scope", "mcsr_mod");

                JsonObject response = HttpJsonClient.postJson(this.authApiBaseUrl + "/device/start", null, body);
                long expiresInSeconds = response.has("expires_in") ? response.get("expires_in").getAsLong() : 600L;
                long intervalSeconds = response.has("interval") ? response.get("interval").getAsLong() : 3L;
                return new DeviceLinkChallenge(
                        response.get("device_code").getAsString(),
                        response.get("user_code").getAsString(),
                        response.get("verification_uri").getAsString(),
                        response.has("verification_uri_complete") && !response.get("verification_uri_complete").isJsonNull()
                                ? response.get("verification_uri_complete").getAsString()
                                : response.get("verification_uri").getAsString(),
                        System.currentTimeMillis() + (expiresInSeconds * 1000L),
                        Math.max(1000L, intervalSeconds * 1000L)
                );
            } catch (IOException exception) {
                throw new CompletionException(exception);
            }
        });
    }

    public CompletableFuture<DeviceLinkPollResult> pollDeviceLink(final String deviceCode) {
        return CompletableFuture.supplyAsync(() -> {
            try {
                JsonObject body = new JsonObject();
                body.addProperty("device_code", deviceCode);
                JsonObject response = HttpJsonClient.postJson(this.authApiBaseUrl + "/device/poll", null, body);
                String status = response.has("status") ? response.get("status").getAsString() : "pending";
                if ("approved".equalsIgnoreCase(status)) {
                    return new DeviceLinkPollResult(DeviceLinkPollResult.Status.APPROVED, parseSession(response.getAsJsonObject("session")));
                }
                if ("denied".equalsIgnoreCase(status)) {
                    return new DeviceLinkPollResult(DeviceLinkPollResult.Status.DENIED, null);
                }
                if ("expired".equalsIgnoreCase(status)) {
                    return new DeviceLinkPollResult(DeviceLinkPollResult.Status.EXPIRED, null);
                }
                return new DeviceLinkPollResult(DeviceLinkPollResult.Status.PENDING, null);
            } catch (IOException exception) {
                throw new CompletionException(exception);
            }
        });
    }

    public CompletableFuture<JsonObject> fetchProfile(final AuthSession session) {
        return CompletableFuture.supplyAsync(() -> {
            try {
                Map<String, String> headers = new HashMap<String, String>();
                headers.put("Authorization", "Bearer " + session.getAccessToken());
                return HttpJsonClient.getJson(this.authApiBaseUrl + "/me", headers);
            } catch (IOException exception) {
                throw new CompletionException(exception);
            }
        });
    }

    public CompletableFuture<AuthSession> validateSession(final AuthSession session) {
        return fetchProfile(session).thenApply(profile -> mergeSessionProfile(session, profile));
    }

    private static AuthSession parseSession(JsonObject response) throws IOException {
        if (response == null || !response.has("access_token")) {
            throw new IOException("Auth response did not contain a session");
        }

        JsonObject user = response.has("user") && response.get("user").isJsonObject() ? response.getAsJsonObject("user") : response;
        return new AuthSession(
                response.get("access_token").getAsString(),
                response.has("refresh_token") && !response.get("refresh_token").isJsonNull() ? response.get("refresh_token").getAsString() : "",
                user.get("id").getAsString(),
                user.has("username") && !user.get("username").isJsonNull() ? user.get("username").getAsString() : "",
                user.has("display_name") && !user.get("display_name").isJsonNull() ? user.get("display_name").getAsString() : "",
                user.has("elo") && !user.get("elo").isJsonNull() ? user.get("elo").getAsInt() : 1200,
                user.has("rank_tier") && !user.get("rank_tier").isJsonNull() ? user.get("rank_tier").getAsString() : "Unranked",
                response.has("expires_at") && !response.get("expires_at").isJsonNull()
                        ? response.get("expires_at").getAsLong()
                        : ((System.currentTimeMillis() / 1000L) + 3600L)
        );
    }

    private static AuthSession mergeSessionProfile(AuthSession session, JsonObject profile) {
        return new AuthSession(
                session.getAccessToken(),
                session.getRefreshToken(),
                getString(profile, "id", session.getUserId()),
                getString(profile, "username", session.getUsername()),
                getString(profile, "display_name", session.getDisplayName()),
                getInt(profile, "elo", session.getElo()),
                getString(profile, "rank_tier", session.getRankTier()),
                session.getExpiresAtEpochSeconds()
        );
    }

    private static String getString(JsonObject object, String key, String fallback) {
        return object != null && object.has(key) && !object.get(key).isJsonNull()
                ? object.get(key).getAsString()
                : fallback;
    }

    private static int getInt(JsonObject object, String key, int fallback) {
        return object != null && object.has(key) && !object.get(key).isJsonNull()
                ? object.get(key).getAsInt()
                : fallback;
    }

    private static String trimTrailingSlash(String value) {
        if (value == null || value.isEmpty()) {
            return "";
        }
        return value.endsWith("/") ? value.substring(0, value.length() - 1) : value;
    }
}
