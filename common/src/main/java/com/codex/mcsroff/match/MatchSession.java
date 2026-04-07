package com.codex.mcsroff.match;

import com.codex.mcsroff.seed.SeedAssignment;

public final class MatchSession {
    private String matchId;
    private final String playerRole;
    private final SeedAssignment seedAssignment;
    private final String seedTypeLabel;
    private final MatchOpponent opponent;
    private MatchPhase phase;
    private long runStartedAtMillis;
    private boolean finishReported;
    private boolean dragonKillConfirmed;
    private String worldId;

    public MatchSession(String matchId, String playerRole, SeedAssignment seedAssignment, MatchPhase phase, String seedTypeLabel, MatchOpponent opponent) {
        this.matchId = matchId;
        this.playerRole = playerRole;
        this.seedAssignment = seedAssignment;
        this.phase = phase;
        this.seedTypeLabel = seedTypeLabel;
        this.opponent = opponent;
        this.runStartedAtMillis = 0L;
        this.finishReported = false;
        this.dragonKillConfirmed = false;
        this.worldId = "";
    }

    public String getMatchId() {
        return this.matchId;
    }

    public void setMatchId(String matchId) {
        this.matchId = matchId;
    }

    public String getPlayerRole() {
        return this.playerRole;
    }

    public SeedAssignment getSeedAssignment() {
        return this.seedAssignment;
    }

    public String getSeedTypeLabel() {
        return this.seedTypeLabel;
    }

    public MatchOpponent getOpponent() {
        return this.opponent;
    }

    public MatchPhase getPhase() {
        return this.phase;
    }

    public void setPhase(MatchPhase phase) {
        this.phase = phase;
    }

    public long getRunStartedAtMillis() {
        return this.runStartedAtMillis;
    }

    public void setRunStartedAtMillis(long runStartedAtMillis) {
        this.runStartedAtMillis = runStartedAtMillis;
    }

    public boolean isFinishReported() {
        return this.finishReported;
    }

    public void setFinishReported(boolean finishReported) {
        this.finishReported = finishReported;
    }

    public boolean isDragonKillConfirmed() {
        return this.dragonKillConfirmed;
    }

    public void setDragonKillConfirmed(boolean dragonKillConfirmed) {
        this.dragonKillConfirmed = dragonKillConfirmed;
    }

    public String getWorldId() {
        return this.worldId;
    }

    public void setWorldId(String worldId) {
        this.worldId = worldId == null ? "" : worldId;
    }
}
