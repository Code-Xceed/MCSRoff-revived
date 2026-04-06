package com.codex.mcsroff.auth;

public final class DeviceLinkChallenge {
    private final String deviceCode;
    private final String userCode;
    private final String verificationUri;
    private final String verificationUriComplete;
    private final long expiresAtEpochMillis;
    private final long pollIntervalMillis;

    public DeviceLinkChallenge(
            String deviceCode,
            String userCode,
            String verificationUri,
            String verificationUriComplete,
            long expiresAtEpochMillis,
            long pollIntervalMillis
    ) {
        this.deviceCode = deviceCode;
        this.userCode = userCode;
        this.verificationUri = verificationUri;
        this.verificationUriComplete = verificationUriComplete;
        this.expiresAtEpochMillis = expiresAtEpochMillis;
        this.pollIntervalMillis = pollIntervalMillis;
    }

    public String getDeviceCode() {
        return this.deviceCode;
    }

    public String getUserCode() {
        return this.userCode;
    }

    public String getVerificationUri() {
        return this.verificationUri;
    }

    public String getVerificationUriComplete() {
        return this.verificationUriComplete;
    }

    public long getExpiresAtEpochMillis() {
        return this.expiresAtEpochMillis;
    }

    public long getPollIntervalMillis() {
        return this.pollIntervalMillis;
    }

    public boolean isExpired() {
        return System.currentTimeMillis() >= this.expiresAtEpochMillis;
    }
}
