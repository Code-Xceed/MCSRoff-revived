package com.codex.mcsroff.auth;

public final class AuthSession {
    private final String accessToken;
    private final String refreshToken;
    private final String userId;
    private final String username;
    private final String displayName;
    private final int elo;
    private final String rankTier;
    private final long expiresAtEpochSeconds;

    public AuthSession(String accessToken, String refreshToken, String userId, String username, String displayName, int elo, String rankTier, long expiresAtEpochSeconds) {
        this.accessToken = accessToken;
        this.refreshToken = refreshToken;
        this.userId = userId;
        this.username = username;
        this.displayName = displayName;
        this.elo = elo;
        this.rankTier = rankTier;
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

    public String getUsername() {
        return this.username;
    }

    public String getDisplayName() {
        return this.displayName;
    }

    public int getElo() {
        return this.elo;
    }

    public String getRankTier() {
        return this.rankTier;
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
