package com.codex.mcsroff.race;

import com.codex.mcsroff.match.MatchPhase;
import com.codex.mcsroff.match.MatchSession;
import com.codex.mcsroff.ui.PreRaceCountdownScreen;
import com.codex.mcsroff.ui.WorldPreparationScreen;
import net.minecraft.client.Minecraft;

public final class PreRaceController {
    private static final long OPPONENT_WORLD_GENERATED_DELAY_MILLIS = 2200L;
    private static final long OPPONENT_READY_DELAY_MILLIS = 3600L;
    private static final long LOCAL_COUNTDOWN_MILLIS = 10000L;

    private MatchSession activeSession;
    private long armedAtMillis = -1L;
    private long syncStartedAtMillis = -1L;
    private long countdownTargetMillis = -1L;
    private boolean localWorldGenerated;
    private String localWorldStatus = "Creating local world";
    private String opponentWorldStatus = "Generating world";

    public void armLocalStart(MatchSession session) {
        if (session == null) {
            throw new IllegalArgumentException("Session is required");
        }
        this.activeSession = session;
        this.armedAtMillis = System.currentTimeMillis();
        this.syncStartedAtMillis = -1L;
        this.countdownTargetMillis = -1L;
        this.localWorldGenerated = false;
        this.localWorldStatus = "Creating local world";
        this.opponentWorldStatus = "Generating world";
        this.activeSession.setPhase(MatchPhase.WORLD_CREATING);
    }

    public void onClientTick(Minecraft minecraft) {
        if (this.activeSession == null) {
            return;
        }

        long now = System.currentTimeMillis();

        if (!this.localWorldGenerated) {
            if (minecraft.level == null || minecraft.player == null) {
                return;
            }

            this.localWorldGenerated = true;
            this.syncStartedAtMillis = now;
            this.localWorldStatus = "Local world generated";
            this.activeSession.setPhase(MatchPhase.SPAWN_WAIT);
        }

        if (this.activeSession.getPhase() == MatchPhase.WORLD_CREATING || this.activeSession.getPhase() == MatchPhase.SPAWN_WAIT) {
            updateOpponentState(now);
            if (isBothPlayersReady()) {
                beginCountdown(minecraft, now);
            } else {
                ensurePreparationScreen(minecraft);
            }
            return;
        }

        if (this.activeSession.getPhase() != MatchPhase.COUNTDOWN) {
            return;
        }

        ensureCountdownScreen(minecraft);
        if (now >= this.countdownTargetMillis) {
            this.activeSession.setPhase(MatchPhase.RUNNING);
            if (minecraft.screen instanceof PreRaceCountdownScreen) {
                minecraft.setScreen(null);
            }
            this.activeSession = null;
            this.armedAtMillis = -1L;
            this.syncStartedAtMillis = -1L;
            this.countdownTargetMillis = -1L;
            this.localWorldGenerated = false;
            this.localWorldStatus = "Creating local world";
            this.opponentWorldStatus = "Generating world";
        }
    }

    public boolean shouldFreezePlayer() {
        if (this.activeSession == null) {
            return false;
        }
        MatchPhase phase = this.activeSession.getPhase();
        return phase == MatchPhase.WORLD_CREATING || phase == MatchPhase.SPAWN_WAIT || phase == MatchPhase.COUNTDOWN;
    }

    public long getMillisRemaining() {
        if (!shouldFreezePlayer()) {
            return 0L;
        }
        return Math.max(0L, this.countdownTargetMillis - System.currentTimeMillis());
    }

    public int getCountdownSecondsRemaining() {
        long millis = getMillisRemaining();
        if (millis <= 0L) {
            return 0;
        }
        return (int) ((millis + 999L) / 1000L);
    }

    public MatchSession getActiveSession() {
        return this.activeSession;
    }

    public String getLocalWorldStatus() {
        return this.localWorldStatus;
    }

    public String getOpponentWorldStatus() {
        return this.opponentWorldStatus;
    }

    private boolean isBothPlayersReady() {
        return "Ready".equals(this.localWorldStatus) && "Ready".equals(this.opponentWorldStatus);
    }

    private void updateOpponentState(long now) {
        long elapsed = this.syncStartedAtMillis < 0L ? 0L : Math.max(0L, now - this.syncStartedAtMillis);
        if (elapsed >= OPPONENT_READY_DELAY_MILLIS) {
            this.opponentWorldStatus = "Ready";
            this.localWorldStatus = "Ready";
            return;
        }
        if (elapsed >= OPPONENT_WORLD_GENERATED_DELAY_MILLIS) {
            this.opponentWorldStatus = "Generated";
        } else {
            this.opponentWorldStatus = "Generating world";
        }
    }

    private void beginCountdown(Minecraft minecraft, long now) {
        this.activeSession.setPhase(MatchPhase.COUNTDOWN);
        this.countdownTargetMillis = now + LOCAL_COUNTDOWN_MILLIS;
        ensureCountdownScreen(minecraft);
    }

    private void ensurePreparationScreen(Minecraft minecraft) {
        if (!(minecraft.screen instanceof WorldPreparationScreen)) {
            minecraft.setScreen(new WorldPreparationScreen());
        }
    }

    private void ensureCountdownScreen(Minecraft minecraft) {
        if (!(minecraft.screen instanceof PreRaceCountdownScreen)) {
            minecraft.setScreen(new PreRaceCountdownScreen());
        }
    }
}
