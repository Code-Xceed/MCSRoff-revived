package com.codex.mcsroff.telemetry;

final class PendingActivityReport {
    private final String type;
    private final String activityKey;
    private final String statusText;
    private final String chatMessage;
    private final String advancementId;

    PendingActivityReport(String type, String activityKey, String statusText, String chatMessage, String advancementId) {
        this.type = type == null ? "" : type;
        this.activityKey = activityKey == null ? "" : activityKey;
        this.statusText = statusText == null ? "" : statusText;
        this.chatMessage = chatMessage == null ? "" : chatMessage;
        this.advancementId = advancementId == null ? "" : advancementId;
    }

    String getType() {
        return this.type;
    }

    String getActivityKey() {
        return this.activityKey;
    }

    String getStatusText() {
        return this.statusText;
    }

    String getChatMessage() {
        return this.chatMessage;
    }

    String getAdvancementId() {
        return this.advancementId;
    }

    boolean samePayload(PendingActivityReport other) {
        if (other == null) {
            return false;
        }
        return this.type.equals(other.type)
                && this.activityKey.equals(other.activityKey)
                && this.statusText.equals(other.statusText)
                && this.chatMessage.equals(other.chatMessage)
                && this.advancementId.equals(other.advancementId);
    }
}
