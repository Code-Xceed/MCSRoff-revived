package com.codex.mcsroff.auth;

public final class DeviceLinkPollResult {
    public enum Status {
        PENDING,
        APPROVED,
        DENIED,
        EXPIRED
    }

    private final Status status;
    private final AuthSession session;

    public DeviceLinkPollResult(Status status, AuthSession session) {
        this.status = status;
        this.session = session;
    }

    public Status getStatus() {
        return this.status;
    }

    public AuthSession getSession() {
        return this.session;
    }
}
