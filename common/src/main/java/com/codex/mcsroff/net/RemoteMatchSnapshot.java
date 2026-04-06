package com.codex.mcsroff.net;

import com.google.gson.JsonArray;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

public final class RemoteMatchSnapshot {
    private final String queueStatus;
    private final String matchId;
    private final String state;
    private final String seed;
    private final String seedTypeLabel;
    private final String fsgFilterId;
    private final long countdownTargetEpochMillis;
    private final List<RemoteMatchPlayer> players;

    public RemoteMatchSnapshot(
            String queueStatus,
            String matchId,
            String state,
            String seed,
            String seedTypeLabel,
            String fsgFilterId,
            long countdownTargetEpochMillis,
            List<RemoteMatchPlayer> players
    ) {
        this.queueStatus = queueStatus;
        this.matchId = matchId;
        this.state = state;
        this.seed = seed;
        this.seedTypeLabel = seedTypeLabel;
        this.fsgFilterId = fsgFilterId;
        this.countdownTargetEpochMillis = countdownTargetEpochMillis;
        this.players = players == null ? Collections.<RemoteMatchPlayer>emptyList() : Collections.unmodifiableList(new ArrayList<RemoteMatchPlayer>(players));
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

    public String getSeedTypeLabel() {
        return this.seedTypeLabel;
    }

    public String getFsgFilterId() {
        return this.fsgFilterId;
    }

    public long getCountdownTargetEpochMillis() {
        return this.countdownTargetEpochMillis;
    }

    public List<RemoteMatchPlayer> getPlayers() {
        return this.players;
    }

    public static RemoteMatchSnapshot fromJson(JsonObject root) {
        JsonObject match = root != null && root.has("match") && root.get("match").isJsonObject()
                ? root.getAsJsonObject("match")
                : root;

        List<RemoteMatchPlayer> players = new ArrayList<RemoteMatchPlayer>();
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
                        getBoolean(player, "connected", true)
                ));
            }
        }

        return new RemoteMatchSnapshot(
                getString(root, "queue_status"),
                getString(match, "id"),
                getString(match, "state"),
                getString(match, "seed"),
                getString(match, "seed_type_label"),
                getString(match, "fsg_filter_id"),
                getLong(match, "countdown_target_epoch_millis", 0L),
                players
        );
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
