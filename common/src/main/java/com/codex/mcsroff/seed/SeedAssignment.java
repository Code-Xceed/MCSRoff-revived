package com.codex.mcsroff.seed;

public final class SeedAssignment {
    private final String seed;
    private final String filterId;
    private final String token;
    private final SeedMode seedMode;

    public SeedAssignment(String seed, String filterId, String token, SeedMode seedMode) {
        this.seed = seed;
        this.filterId = filterId;
        this.token = token;
        this.seedMode = seedMode;
    }

    public String getSeed() {
        return this.seed;
    }

    public String getFilterId() {
        return this.filterId;
    }

    public String getToken() {
        return this.token;
    }

    public SeedMode getSeedMode() {
        return this.seedMode;
    }
}
