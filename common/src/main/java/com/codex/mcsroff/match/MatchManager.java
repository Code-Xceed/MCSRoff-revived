package com.codex.mcsroff.match;

import com.codex.mcsroff.McsroffMod;
import com.codex.mcsroff.config.ModConfig;
import com.codex.mcsroff.config.PersistedMatchState;
import com.codex.mcsroff.net.BackendApi;
import com.codex.mcsroff.net.FsgApi;
import com.codex.mcsroff.seed.SeedMode;
import com.codex.mcsroff.seed.SeedAssignment;
import net.minecraft.client.resources.DefaultPlayerSkin;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.UUID;

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
        persistCurrentSession();
    }

    public void clearCurrentSession() {
        this.currentSession = null;
        persistCurrentSession();
    }

    public MatchSession beginPendingLocalSession(SeedAssignment seedAssignment, String seedTypeLabel, MatchOpponent opponent) {
        MatchSession session = new MatchSession("local:pending", "local", seedAssignment, MatchPhase.WORLD_CREATING, seedTypeLabel, opponent);
        this.currentSession = session;
        persistCurrentSession();
        return session;
    }

    public MatchSession beginMatchedSession(String matchId, String playerRole, SeedAssignment seedAssignment, String seedTypeLabel, MatchOpponent opponent) {
        MatchSession session = new MatchSession(matchId, playerRole, seedAssignment, MatchPhase.WORLD_CREATING, seedTypeLabel, opponent);
        this.currentSession = session;
        persistCurrentSession();
        return session;
    }

    public MatchSession bindCurrentSessionToWorld(String worldId) {
        if (this.currentSession != null) {
            if (this.currentSession.getMatchId() != null && this.currentSession.getMatchId().startsWith("local:")) {
                this.currentSession.setMatchId("local:" + worldId);
            }
            this.currentSession.setWorldId(worldId);
            persistCurrentSession();
        }
        return this.currentSession;
    }

    public void updateCurrentPhase(MatchPhase phase) {
        if (this.currentSession != null) {
            this.currentSession.setPhase(phase);
            persistCurrentSession();
        }
    }

    public void recordRunStarted(long runStartedAtMillis) {
        if (this.currentSession != null) {
            this.currentSession.setRunStartedAtMillis(runStartedAtMillis);
            this.currentSession.setFinishReported(false);
            persistCurrentSession();
        }
    }

    public void updateFinishReported(boolean finishReported) {
        if (this.currentSession != null) {
            this.currentSession.setFinishReported(finishReported);
            persistCurrentSession();
        }
    }

    public MatchSession restoreSession(PersistedMatchState state) {
        if (state == null || state.getMatchId().isEmpty() || state.getSeed().isEmpty()) {
            return null;
        }

        SeedMode seedMode = "PRACTICE".equalsIgnoreCase(state.getSeedModeName()) ? SeedMode.PRACTICE : SeedMode.MATCH;
        SeedAssignment seedAssignment = new SeedAssignment(
                state.getSeed(),
                state.getFsgFilterId(),
                state.getFsgToken(),
                seedMode
        );
        String opponentName = state.getOpponentName().isEmpty() ? "Opponent" : state.getOpponentName();
        MatchOpponent opponent = new MatchOpponent(
                opponentName,
                state.getOpponentElo(),
                state.getOpponentRank(),
                DefaultPlayerSkin.getDefaultSkin(UUID.nameUUIDFromBytes(opponentName.getBytes(StandardCharsets.UTF_8)))
        );
        MatchPhase phase;
        try {
            phase = MatchPhase.valueOf(state.getPhaseName());
        } catch (IllegalArgumentException exception) {
            phase = MatchPhase.WORLD_CREATING;
        }

        MatchSession session = new MatchSession(state.getMatchId(), state.getPlayerRole(), seedAssignment, phase, state.getSeedTypeLabel(), opponent);
        session.setWorldId(state.getWorldId());
        session.setRunStartedAtMillis(state.getRunStartedAtMillis());
        session.setFinishReported(state.isFinishReported());
        session.setResumePending(true);
        this.currentSession = session;
        persistCurrentSession();
        return session;
    }

    public void persistCurrentSession() {
        ModConfig config = McsroffMod.getConfig();
        if (config == null) {
            return;
        }
        if (this.currentSession == null || this.currentSession.getSeedAssignment() == null || this.currentSession.getMatchId() == null || this.currentSession.getMatchId().isEmpty()) {
            config.clearActiveMatch();
            saveConfigQuietly(config);
            return;
        }

        PersistedMatchState persisted = new PersistedMatchState();
        persisted.setMatchId(this.currentSession.getMatchId());
        persisted.setPlayerRole(this.currentSession.getPlayerRole());
        persisted.setSeed(this.currentSession.getSeedAssignment().getSeed());
        persisted.setFsgFilterId(this.currentSession.getSeedAssignment().getFilterId());
        persisted.setFsgToken(this.currentSession.getSeedAssignment().getToken());
        persisted.setSeedModeName(this.currentSession.getSeedAssignment().getSeedMode().name());
        persisted.setSeedTypeLabel(this.currentSession.getSeedTypeLabel());
        MatchOpponent opponent = this.currentSession.getOpponent();
        if (opponent != null) {
            persisted.setOpponentName(opponent.getName());
            persisted.setOpponentElo(opponent.getElo());
            persisted.setOpponentRank(opponent.getRank());
        }
        persisted.setWorldId(this.currentSession.getWorldId());
        persisted.setPhaseName(this.currentSession.getPhase().name());
        persisted.setRunStartedAtMillis(this.currentSession.getRunStartedAtMillis());
        persisted.setFinishReported(this.currentSession.isFinishReported());
        config.setActiveMatch(persisted);
        saveConfigQuietly(config);
    }

    private static void saveConfigQuietly(ModConfig config) {
        try {
            config.save();
        } catch (IOException exception) {
            McsroffMod.LOGGER.warn("Failed to persist active match state", exception);
        }
    }
}
