package com.codex.mcsroff.telemetry;

public final class LocalAdvancementUpdate {
    private final String advancementId;
    private final String frameType;
    private final String title;

    public LocalAdvancementUpdate(String advancementId, String frameType, String title) {
        this.advancementId = advancementId;
        this.frameType = frameType;
        this.title = title;
    }

    public String getAdvancementId() {
        return this.advancementId;
    }

    public String getFrameType() {
        return this.frameType;
    }

    public String getTitle() {
        return this.title;
    }
}
