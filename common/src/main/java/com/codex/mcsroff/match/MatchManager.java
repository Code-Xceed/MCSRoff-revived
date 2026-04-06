package com.codex.mcsroff.match;

import com.codex.mcsroff.net.BackendApi;
import com.codex.mcsroff.net.FsgApi;
import com.codex.mcsroff.seed.SeedAssignment;

public final class MatchManager {
    private final BackendApi backendApi;
    private final FsgApi fsgApi;
    private MatchSession currentSession;

    public MatchManager(BackendApi backendApi, FsgApi fsgApi) {
        this.backendApi = backendApi;
        this.fsgApi = fsgApi;
    }

    public BackendApi getBackendApi() {
        return this.backendApi;
    }

    public FsgApi getFsgApi() {
        return this.fsgApi;
    }

    public MatchSession getCurrentSession() {
        return this.currentSession;
    }

    public void setCurrentSession(MatchSession currentSession) {
        this.currentSession = currentSession;
    }

    public void clearCurrentSession() {
        this.currentSession = null;
    }

    public MatchSession beginPendingLocalSession(SeedAssignment seedAssignment, String seedTypeLabel, MatchOpponent opponent) {
        MatchSession session = new MatchSession("local:pending", "local", seedAssignment, MatchPhase.WORLD_CREATING, seedTypeLabel, opponent);
        this.currentSession = session;
        return session;
    }

    public MatchSession beginMatchedSession(String matchId, String playerRole, SeedAssignment seedAssignment, String seedTypeLabel, MatchOpponent opponent) {
        MatchSession session = new MatchSession(matchId, playerRole, seedAssignment, MatchPhase.WORLD_CREATING, seedTypeLabel, opponent);
        this.currentSession = session;
        return session;
    }

    public MatchSession bindCurrentSessionToWorld(String worldId) {
        if (this.currentSession != null && this.currentSession.getMatchId() != null && this.currentSession.getMatchId().startsWith("local:")) {
            this.currentSession.setMatchId("local:" + worldId);
        }
        return this.currentSession;
    }

    public void updateCurrentPhase(MatchPhase phase) {
        if (this.currentSession != null) {
            this.currentSession.setPhase(phase);
        }
    }
}
