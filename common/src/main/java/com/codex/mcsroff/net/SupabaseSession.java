package com.codex.mcsroff.net;

public final class SupabaseSession {
    private final String accessToken;
    private final String refreshToken;
    private final String userId;
    private final long expiresAtEpochSeconds;

    public SupabaseSession(String accessToken, String refreshToken, String userId, long expiresAtEpochSeconds) {
        this.accessToken = accessToken;
        this.refreshToken = refreshToken;
        this.userId = userId;
        this.expiresAtEpochSeconds = expiresAtEpochSeconds;
    }

    public String getAccessToken() {
        return this.accessToken;
    }

    public String getRefreshToken() {
        return this.refreshToken;
    }

    public String getUserId() {
        return this.userId;
    }

    public long getExpiresAtEpochSeconds() {
        return this.expiresAtEpochSeconds;
    }

    public boolean isUsable() {
        return this.accessToken != null
                && !this.accessToken.isEmpty()
                && this.userId != null
                && !this.userId.isEmpty()
                && this.expiresAtEpochSeconds > ((System.currentTimeMillis() / 1000L) + 30L);
    }
}
