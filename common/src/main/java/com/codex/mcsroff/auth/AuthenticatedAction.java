package com.codex.mcsroff.auth;

import java.util.concurrent.CompletableFuture;

public interface AuthenticatedAction<T> {
    CompletableFuture<T> run(AuthSession session);
}
