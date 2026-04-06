package com.codex.mcsroff.auth;

import com.codex.mcsroff.McsroffMod;
import com.codex.mcsroff.config.ModConfig;
import com.codex.mcsroff.net.HttpRequestException;
import com.codex.mcsroff.net.WebAuthApi;

import java.io.IOException;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.CompletionException;

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

    public <T> CompletableFuture<T> executeAuthenticated(AuthenticatedAction<T> action) {
        return ensureActiveSession().thenCompose(session -> {
            if (session == null) {
                return failedFuture(new IllegalStateException("Trusted account session missing"));
            }
            return executeWithRetry(action, session, true);
        });
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

    private CompletableFuture<AuthSession> ensureActiveSession() {
        AuthSession session = this.currentSession != null ? this.currentSession : loadCachedSession();
        if (session == null) {
            return CompletableFuture.completedFuture(null);
        }
        if (session.isUsable()) {
            return CompletableFuture.completedFuture(session);
        }
        return refreshCachedSession(session).handle((refreshed, throwable) -> {
            if (throwable != null || refreshed == null) {
                this.currentSession = null;
                clearPersistedSessionQuietly();
                return null;
            }
            persistSession(refreshed);
            return refreshed;
        });
    }

    private <T> CompletableFuture<T> executeWithRetry(AuthenticatedAction<T> action, AuthSession session, boolean allowRefreshRetry) {
        CompletableFuture<T> actionFuture;
        try {
            actionFuture = action.run(session);
        } catch (Exception exception) {
            return failedFuture(exception);
        }

        CompletableFuture<T> resultFuture = new CompletableFuture<T>();
        actionFuture.whenComplete((result, throwable) -> {
            if (throwable == null) {
                resultFuture.complete(result);
                return;
            }

            Throwable cause = unwrap(throwable);
            if (!allowRefreshRetry || !isUnauthorized(cause) || session.getRefreshToken() == null || session.getRefreshToken().isEmpty()) {
                resultFuture.completeExceptionally(cause);
                return;
            }

            refreshCachedSession(session).whenComplete((refreshed, refreshThrowable) -> {
                if (refreshThrowable != null || refreshed == null) {
                    this.currentSession = null;
                    clearPersistedSessionQuietly();
                    Throwable finalCause = refreshThrowable == null ? cause : unwrap(refreshThrowable);
                    resultFuture.completeExceptionally(finalCause);
                    return;
                }

                persistSession(refreshed);
                executeWithRetry(action, refreshed, false).whenComplete((retryResult, retryThrowable) -> {
                    if (retryThrowable != null) {
                        resultFuture.completeExceptionally(unwrap(retryThrowable));
                        return;
                    }
                    resultFuture.complete(retryResult);
                });
            });
        });
        return resultFuture;
    }

    private static boolean isUnauthorized(Throwable throwable) {
        return throwable instanceof HttpRequestException
                && ((((HttpRequestException) throwable).getStatusCode() == 401)
                || (((HttpRequestException) throwable).getStatusCode() == 403));
    }

    private static Throwable unwrap(Throwable throwable) {
        Throwable current = throwable;
        while (current instanceof CompletionException && current.getCause() != null) {
            current = current.getCause();
        }
        while (current.getCause() != null && current.getCause() != current) {
            current = current.getCause();
        }
        return current;
    }

    private static <T> CompletableFuture<T> failedFuture(Throwable throwable) {
        CompletableFuture<T> future = new CompletableFuture<T>();
        future.completeExceptionally(throwable);
        return future;
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
