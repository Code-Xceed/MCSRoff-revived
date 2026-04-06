package com.codex.mcsroff.seed;

public final class FsgTokenCheckResult {
    private final String token;
    private final String seed;
    private final String filterId;
    private final long issuedAtEpochMillis;

    public FsgTokenCheckResult(String token, String seed, String filterId, long issuedAtEpochMillis) {
        this.token = token;
        this.seed = seed;
        this.filterId = filterId;
        this.issuedAtEpochMillis = issuedAtEpochMillis;
    }

    public String getToken() {
        return this.token;
    }

    public String getSeed() {
        return this.seed;
    }

    public String getFilterId() {
        return this.filterId;
    }

    public long getIssuedAtEpochMillis() {
        return this.issuedAtEpochMillis;
    }
}
