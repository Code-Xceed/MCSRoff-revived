package com.codex.mcsroff.seed;

public final class FsgCooldownException extends FsgApiException {
    private final long cooldownMillis;

    public FsgCooldownException(long cooldownMillis) {
        super("FSG cooldown active for " + cooldownMillis + "ms");
        this.cooldownMillis = cooldownMillis;
    }

    public long getCooldownMillis() {
        return this.cooldownMillis;
    }
}
