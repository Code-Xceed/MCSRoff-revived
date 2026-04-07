package com.codex.mcsroff.config;

public final class PersistedMatchState {
    private String matchId = "";
    private String playerRole = "";
    private String seed = "";
    private String fsgFilterId = "";
    private String fsgToken = "";
    private String seedModeName = "MATCH";
    private String seedTypeLabel = "";
    private String opponentName = "";
    private int opponentElo;
    private String opponentRank = "";
    private String worldId = "";
    private String phaseName = "IDLE";
    private long runStartedAtMillis;
    private boolean finishReported;

    public String getMatchId() {
        return this.matchId == null ? "" : this.matchId;
    }

    public void setMatchId(String matchId) {
        this.matchId = matchId == null ? "" : matchId;
    }

    public String getPlayerRole() {
        return this.playerRole == null ? "" : this.playerRole;
    }

    public void setPlayerRole(String playerRole) {
        this.playerRole = playerRole == null ? "" : playerRole;
    }

    public String getSeed() {
        return this.seed == null ? "" : this.seed;
    }

    public void setSeed(String seed) {
        this.seed = seed == null ? "" : seed;
    }

    public String getFsgFilterId() {
        return this.fsgFilterId == null ? "" : this.fsgFilterId;
    }

    public void setFsgFilterId(String fsgFilterId) {
        this.fsgFilterId = fsgFilterId == null ? "" : fsgFilterId;
    }

    public String getFsgToken() {
        return this.fsgToken == null ? "" : this.fsgToken;
    }

    public void setFsgToken(String fsgToken) {
        this.fsgToken = fsgToken == null ? "" : fsgToken;
    }

    public String getSeedModeName() {
        return this.seedModeName == null || this.seedModeName.isEmpty() ? "MATCH" : this.seedModeName;
    }

    public void setSeedModeName(String seedModeName) {
        this.seedModeName = seedModeName == null || seedModeName.isEmpty() ? "MATCH" : seedModeName;
    }

    public String getSeedTypeLabel() {
        return this.seedTypeLabel == null ? "" : this.seedTypeLabel;
    }

    public void setSeedTypeLabel(String seedTypeLabel) {
        this.seedTypeLabel = seedTypeLabel == null ? "" : seedTypeLabel;
    }

    public String getOpponentName() {
        return this.opponentName == null ? "" : this.opponentName;
    }

    public void setOpponentName(String opponentName) {
        this.opponentName = opponentName == null ? "" : opponentName;
    }

    public int getOpponentElo() {
        return this.opponentElo;
    }

    public void setOpponentElo(int opponentElo) {
        this.opponentElo = Math.max(0, opponentElo);
    }

    public String getOpponentRank() {
        return this.opponentRank == null ? "" : this.opponentRank;
    }

    public void setOpponentRank(String opponentRank) {
        this.opponentRank = opponentRank == null ? "" : opponentRank;
    }

    public String getWorldId() {
        return this.worldId == null ? "" : this.worldId;
    }

    public void setWorldId(String worldId) {
        this.worldId = worldId == null ? "" : worldId;
    }

    public String getPhaseName() {
        return this.phaseName == null || this.phaseName.isEmpty() ? "IDLE" : this.phaseName;
    }

    public void setPhaseName(String phaseName) {
        this.phaseName = phaseName == null || phaseName.isEmpty() ? "IDLE" : phaseName;
    }

    public long getRunStartedAtMillis() {
        return this.runStartedAtMillis;
    }

    public void setRunStartedAtMillis(long runStartedAtMillis) {
        this.runStartedAtMillis = Math.max(0L, runStartedAtMillis);
    }

    public boolean isFinishReported() {
        return this.finishReported;
    }

    public void setFinishReported(boolean finishReported) {
        this.finishReported = finishReported;
    }
}
