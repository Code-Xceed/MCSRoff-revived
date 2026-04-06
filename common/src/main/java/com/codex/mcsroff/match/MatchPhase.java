package com.codex.mcsroff.match;

public enum MatchPhase {
    IDLE,
    QUEUEING,
    MATCH_FOUND,
    SEED_ASSIGNED,
    WORLD_CREATING,
    SPAWN_WAIT,
    COUNTDOWN,
    RUNNING,
    FINISHED,
    ABORTED
}
