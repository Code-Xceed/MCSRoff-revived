package com.codex.mcsroff.auth;

import com.codex.mcsroff.McsroffMod;
import com.codex.mcsroff.config.ModConfig;
import com.codex.mcsroff.net.WebAuthApi;

import java.io.IOException;
import java.util.concurrent.CompletableFuture;

public final class AccountManager {
    private final WebAuthApi webAuthApi;
    private volatile AuthSession currentSession;

    public AccountManager(WebAuthApi webAuthApi) {
        this.webAuthApi = webAuthApi;
        this.currentSession = loadCachedSession();
    }

    public AuthSession getCurrentSession() {
        return this.currentSession;
    }

    public boolean hasTrustedSession() {
        return this.currentSession != null && this.currentSession.isUsable();
    }

    public CompletableFuture<AuthSession> bootstrapSession() {
        AuthSession cached = loadCachedSession();
        if (cached == null) {
            this.currentSession = null;
            return CompletableFuture.completedFuture(null);
        }

        CompletableFuture<AuthSession> bootstrapFuture = cached.isUsable()
                ? this.webAuthApi.validateSession(cached)
                    .handle((session, throwable) -> throwable == null ? session : null)
                    .thenCompose(session -> session != null ? CompletableFuture.completedFuture(session) : refreshCachedSession(cached))
                : refreshCachedSession(cached);

        return bootstrapFuture.handle((session, throwable) -> {
            if (throwable != null || session == null) {
                this.currentSession = null;
                clearPersistedSessionQuietly();
                return null;
            }
            persistSession(session);
            return session;
        });
    }

    public CompletableFuture<DeviceLinkChallenge> startDeviceLink(String minecraftName) {
        return this.webAuthApi.startDeviceLink(minecraftName, McsroffMod.getLoaderType().getId());
    }

    public CompletableFuture<DeviceLinkPollResult> pollDeviceLink(DeviceLinkChallenge challenge) {
        return this.webAuthApi.pollDeviceLink(challenge.getDeviceCode()).thenApply(result -> {
            if (result.getStatus() == DeviceLinkPollResult.Status.APPROVED && result.getSession() != null) {
                persistSession(result.getSession());
            }
            return result;
        });
    }

    public void clearSession() {
        this.currentSession = null;
        ModConfig config = McsroffMod.getConfig();
        config.clearModSession();
        try {
            config.save();
        } catch (IOException exception) {
            McsroffMod.LOGGER.warn("Failed to clear stored mod session", exception);
        }
    }

    private AuthSession loadCachedSession() {
        ModConfig config = McsroffMod.getConfig();
        AuthSession session = new AuthSession(
                config.getModAccessToken(),
                config.getModRefreshToken(),
                config.getModUserId(),
                config.getModUsername(),
                config.getModDisplayName(),
                config.getModElo(),
                config.getModRankTier(),
                config.getModAccessTokenExpiresAtEpochSeconds()
        );
        return session.isUsable() || (session.getRefreshToken() != null && !session.getRefreshToken().isEmpty()) ? session : null;
    }

    private void persistSession(AuthSession session) {
        this.currentSession = session;
        ModConfig config = McsroffMod.getConfig();
        config.setModSession(
                session.getAccessToken(),
                session.getRefreshToken(),
                session.getUserId(),
                session.getUsername(),
                session.getDisplayName(),
                session.getElo(),
                session.getRankTier(),
                session.getExpiresAtEpochSeconds()
        );
        try {
            config.save();
        } catch (IOException exception) {
            McsroffMod.LOGGER.warn("Failed to persist mod session", exception);
        }
    }

    private CompletableFuture<AuthSession> refreshCachedSession(AuthSession cached) {
        if (cached.getRefreshToken() == null || cached.getRefreshToken().isEmpty()) {
            return CompletableFuture.completedFuture(null);
        }
        return this.webAuthApi.refreshSession(cached.getRefreshToken());
    }

    private void clearPersistedSessionQuietly() {
        ModConfig config = McsroffMod.getConfig();
        config.clearModSession();
        try {
            config.save();
        } catch (IOException exception) {
            McsroffMod.LOGGER.warn("Failed to clear stored mod session", exception);
        }
    }
}
