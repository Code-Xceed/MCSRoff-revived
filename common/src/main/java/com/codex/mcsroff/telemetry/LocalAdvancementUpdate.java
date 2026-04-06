package com.codex.mcsroff.telemetry;

public final class LocalAdvancementUpdate {
    private final String advancementId;
    private final String title;

    public LocalAdvancementUpdate(String advancementId, String title) {
        this.advancementId = advancementId;
        this.title = title;
    }

    public String getAdvancementId() {
        return this.advancementId;
    }

    public String getTitle() {
        return this.title;
    }
}
