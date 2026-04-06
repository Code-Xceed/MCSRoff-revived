package com.codex.mcsroff.net;

public final class RemoteMatchPlayer {
    private final String playerId;
    private final String displayName;
    private final int elo;
    private final String rank;
    private final String slot;
    private final String worldStatus;
    private final boolean connected;

    public RemoteMatchPlayer(String playerId, String displayName, int elo, String rank, String slot, String worldStatus, boolean connected) {
        this.playerId = playerId;
        this.displayName = displayName;
        this.elo = elo;
        this.rank = rank;
        this.slot = slot;
        this.worldStatus = worldStatus;
        this.connected = connected;
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
}
