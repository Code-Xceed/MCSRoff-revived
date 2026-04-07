package com.codex.mcsroff.net;

public final class RemoteMatchPlayer {
    private final String playerId;
    private final String displayName;
    private final int elo;
    private final String rank;
    private final String slot;
    private final String worldStatus;
    private final boolean connected;
    private final String activityStatus;
    private final long finishTimeMs;
    private final String result;

    public RemoteMatchPlayer(String playerId, String displayName, int elo, String rank, String slot, String worldStatus, boolean connected, String activityStatus, long finishTimeMs, String result) {
        this.playerId = playerId;
        this.displayName = displayName;
        this.elo = elo;
        this.rank = rank;
        this.slot = slot;
        this.worldStatus = worldStatus;
        this.connected = connected;
        this.activityStatus = activityStatus;
        this.finishTimeMs = finishTimeMs;
        this.result = result;
    }

    public String getPlayerId() {
        return this.playerId;
    }

    public String getDisplayName() {
        return this.displayName;
    }

    public int getElo() {
        return this.elo;
    }

    public String getRank() {
        return this.rank;
    }

    public String getSlot() {
        return this.slot;
    }

    public String getWorldStatus() {
        return this.worldStatus;
    }

    public boolean isConnected() {
        return this.connected;
    }

    public String getActivityStatus() {
        return this.activityStatus;
    }

    public long getFinishTimeMs() {
        return this.finishTimeMs;
    }

    public String getResult() {
        return this.result;
    }
}
