package com.codex.mcsroff.match;

import com.codex.mcsroff.seed.SeedAssignment;

public final class MatchSession {
    private String matchId;
    private final String playerRole;
    private final SeedAssignment seedAssignment;
    private final String seedTypeLabel;
    private final MatchOpponent opponent;
    private MatchPhase phase;

    public MatchSession(String matchId, String playerRole, SeedAssignment seedAssignment, MatchPhase phase, String seedTypeLabel, MatchOpponent opponent) {
        this.matchId = matchId;
        this.playerRole = playerRole;
        this.seedAssignment = seedAssignment;
        this.phase = phase;
        this.seedTypeLabel = seedTypeLabel;
        this.opponent = opponent;
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
}
