package com.codex.mcsroff.net;

import com.google.gson.JsonArray;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

import com.codex.mcsroff.seed.SeedMode;

public final class RemoteMatchSnapshot {
    private final String queueStatus;
    private final String matchId;
    private final String state;
    private final String seed;
    private final String fsgToken;
    private final String seedTypeLabel;
    private final String fsgFilterId;
    private final String abortReason;
    private final String winnerPlayerId;
    private final SeedMode seedMode;
    private final long countdownTargetEpochMillis;
    private final List<RemoteMatchPlayer> players;
    private final List<RemoteMatchEvent> events;

    public RemoteMatchSnapshot(
            String queueStatus,
            String matchId,
            String state,
            String seed,
            String fsgToken,
            String seedTypeLabel,
            String fsgFilterId,
            String abortReason,
            String winnerPlayerId,
            SeedMode seedMode,
            long countdownTargetEpochMillis,
            List<RemoteMatchPlayer> players,
            List<RemoteMatchEvent> events
    ) {
        this.queueStatus = queueStatus;
        this.matchId = matchId;
        this.state = state;
        this.seed = seed;
        this.fsgToken = fsgToken;
        this.seedTypeLabel = seedTypeLabel;
        this.fsgFilterId = fsgFilterId;
        this.abortReason = abortReason;
        this.winnerPlayerId = winnerPlayerId;
        this.seedMode = seedMode == null ? SeedMode.MATCH : seedMode;
        this.countdownTargetEpochMillis = countdownTargetEpochMillis;
        this.players = players == null ? Collections.<RemoteMatchPlayer>emptyList() : Collections.unmodifiableList(new ArrayList<RemoteMatchPlayer>(players));
        this.events = events == null ? Collections.<RemoteMatchEvent>emptyList() : Collections.unmodifiableList(new ArrayList<RemoteMatchEvent>(events));
    }

    public String getQueueStatus() {
        return this.queueStatus;
    }

    public String getMatchId() {
        return this.matchId;
    }

    public String getState() {
        return this.state;
    }

    public String getSeed() {
        return this.seed;
    }

    public String getFsgToken() {
        return this.fsgToken;
    }

    public String getSeedTypeLabel() {
        return this.seedTypeLabel;
    }

    public String getFsgFilterId() {
        return this.fsgFilterId;
    }

    public String getAbortReason() {
        return this.abortReason;
    }

    public String getWinnerPlayerId() {
        return this.winnerPlayerId;
    }

    public SeedMode getSeedMode() {
        return this.seedMode;
    }

    public long getCountdownTargetEpochMillis() {
        return this.countdownTargetEpochMillis;
    }

    public List<RemoteMatchPlayer> getPlayers() {
        return this.players;
    }

    public List<RemoteMatchEvent> getEvents() {
        return this.events;
    }

    public static RemoteMatchSnapshot fromJson(JsonObject root) {
        JsonObject match = root != null && root.has("match") && root.get("match").isJsonObject()
                ? root.getAsJsonObject("match")
                : root;

        List<RemoteMatchPlayer> players = new ArrayList<RemoteMatchPlayer>();
        List<RemoteMatchEvent> events = new ArrayList<RemoteMatchEvent>();
        if (match != null && match.has("players") && match.get("players").isJsonArray()) {
            JsonArray array = match.getAsJsonArray("players");
            for (JsonElement element : array) {
                if (!element.isJsonObject()) {
                    continue;
                }
                JsonObject player = element.getAsJsonObject();
                players.add(new RemoteMatchPlayer(
                        getString(player, "player_id"),
                        getString(player, "display_name"),
                        getInt(player, "elo_snapshot", 1200),
                        getString(player, "rank_snapshot"),
                        getString(player, "slot"),
                        getString(player, "world_status"),
                        getBoolean(player, "connected", true),
                        getString(player, "activity_status"),
                        getLong(player, "finish_time_ms", 0L),
                        getString(player, "result")
                ));
            }
        }

        if (match != null && match.has("events") && match.get("events").isJsonArray()) {
            JsonArray array = match.getAsJsonArray("events");
            for (JsonElement element : array) {
                if (!element.isJsonObject()) {
                    continue;
                }
                JsonObject event = element.getAsJsonObject();
                events.add(new RemoteMatchEvent(
                        getLong(event, "seq", 0L),
                        getString(event, "player_id"),
                        getString(event, "type"),
                        getString(event, "activity_key"),
                        getString(event, "status_text"),
                        getString(event, "chat_message"),
                        getString(event, "advancement_id"),
                        getLong(event, "created_at", 0L)
                ));
            }
        }

        return new RemoteMatchSnapshot(
                getString(root, "queue_status"),
                getString(match, "id"),
                getString(match, "state"),
                getString(match, "seed"),
                getString(match, "fsg_token"),
                getString(match, "seed_type_label"),
                getString(match, "fsg_filter_id"),
                getString(match, "abort_reason"),
                getString(match, "winner_player_id"),
                parseSeedMode(getString(match, "seed_mode")),
                getLong(match, "countdown_target_epoch_millis", 0L),
                players,
                events
        );
    }

    private static SeedMode parseSeedMode(String value) {
        if ("PRACTICE".equalsIgnoreCase(value)) {
            return SeedMode.PRACTICE;
        }
        return SeedMode.MATCH;
    }

    private static String getString(JsonObject object, String key) {
        return object != null && object.has(key) && !object.get(key).isJsonNull()
                ? object.get(key).getAsString()
                : "";
    }

    private static int getInt(JsonObject object, String key, int fallback) {
        return object != null && object.has(key) && !object.get(key).isJsonNull()
                ? object.get(key).getAsInt()
                : fallback;
    }

    private static long getLong(JsonObject object, String key, long fallback) {
        return object != null && object.has(key) && !object.get(key).isJsonNull()
                ? object.get(key).getAsLong()
                : fallback;
    }

    private static boolean getBoolean(JsonObject object, String key, boolean fallback) {
        return object != null && object.has(key) && !object.get(key).isJsonNull()
                ? object.get(key).getAsBoolean()
                : fallback;
    }
}
