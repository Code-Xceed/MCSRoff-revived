package com.codex.mcsroff.net;

public final class RemoteMatchEvent {
    private final long sequence;
    private final String playerId;
    private final String type;
    private final String activityKey;
    private final String statusText;
    private final String chatMessage;
    private final String advancementId;
    private final long createdAtMillis;

    public RemoteMatchEvent(long sequence, String playerId, String type, String activityKey, String statusText, String chatMessage, String advancementId, long createdAtMillis) {
        this.sequence = sequence;
        this.playerId = playerId;
        this.type = type;
        this.activityKey = activityKey;
        this.statusText = statusText;
        this.chatMessage = chatMessage;
        this.advancementId = advancementId;
        this.createdAtMillis = createdAtMillis;
    }

    public long getSequence() {
        return this.sequence;
    }

    public String getPlayerId() {
        return this.playerId;
    }

    public String getType() {
        return this.type;
    }

    public String getActivityKey() {
        return this.activityKey;
    }

    public String getStatusText() {
        return this.statusText;
    }

    public String getChatMessage() {
        return this.chatMessage;
    }

    public String getAdvancementId() {
        return this.advancementId;
    }

    public long getCreatedAtMillis() {
        return this.createdAtMillis;
    }
}
