package com.codex.mcsroff.net;

import com.codex.mcsroff.auth.AuthSession;
import com.codex.mcsroff.seed.SeedMode;
import com.google.gson.JsonObject;
import com.google.gson.JsonArray;

import java.io.IOException;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.HashMap;
import java.util.Map;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.CompletionException;

public final class BackendApi {
    private final String baseUrl;
    private final String streamBaseUrl;
    private final String publishableKey;

    public BackendApi(String baseUrl, String streamBaseUrl, String publishableKey) {
        this.baseUrl = baseUrl;
        this.streamBaseUrl = streamBaseUrl;
        this.publishableKey = publishableKey;
    }

    public String getBaseUrl() {
        return this.baseUrl;
    }

    public String getMatchStreamUrl(String matchId) {
        return this.streamBaseUrl + "?match_id=" + URLEncoder.encode(matchId == null ? "" : matchId, StandardCharsets.UTF_8);
    }

    public JsonObject invokeMatchmaker(String action, JsonObject payload, AuthSession session) throws IOException {
        JsonObject requestBody = payload == null
                ? new JsonObject()
                : new com.google.gson.JsonParser().parse(payload.toString()).getAsJsonObject();
        requestBody.addProperty("action", action);

        Map<String, String> headers = new HashMap<String, String>(HttpJsonClient.headersWithApiKey(this.publishableKey));
        if (session != null && session.getAccessToken() != null && !session.getAccessToken().isEmpty()) {
            headers.put("Authorization", "Bearer " + session.getAccessToken());
        }

        return HttpJsonClient.postJson(this.baseUrl, headers, requestBody);
    }

    public CompletableFuture<RemoteMatchSnapshot> joinQueue(
            final AuthSession session,
            final String playerName,
            final SeedMode seedMode,
            final String seedTypeLabel,
            final List<String> filterIds
    ) {
        return invokeSnapshotAsync("join_queue", buildQueuePayload(session, playerName, seedMode, seedTypeLabel, filterIds), session);
    }

    public CompletableFuture<RemoteMatchSnapshot> pollMatch(final AuthSession session, final String matchId) {
        JsonObject payload = new JsonObject();
        payload.addProperty("match_id", matchId);
        return invokeSnapshotAsync("poll_match", payload, session);
    }

    public CompletableFuture<RemoteMatchSnapshot> pollActiveMatch(final AuthSession session) {
        return invokeSnapshotAsync("poll_match", new JsonObject(), session);
    }

    public CompletableFuture<RemoteMatchSnapshot> cancelQueue(final AuthSession session) {
        return invokeSnapshotAsync("cancel_queue", new JsonObject(), session);
    }

    public CompletableFuture<RemoteMatchSnapshot> markWorldGenerated(final AuthSession session, final String matchId) {
        JsonObject payload = new JsonObject();
        payload.addProperty("match_id", matchId);
        return invokeSnapshotAsync("mark_world_generated", payload, session);
    }

    public CompletableFuture<RemoteMatchSnapshot> markReady(final AuthSession session, final String matchId) {
        JsonObject payload = new JsonObject();
        payload.addProperty("match_id", matchId);
        return invokeSnapshotAsync("mark_ready", payload, session);
    }

    public CompletableFuture<RemoteMatchSnapshot> reportActivity(
            final AuthSession session,
            final String matchId,
            final String type,
            final String activityKey,
            final String statusText,
            final String chatMessage,
            final String advancementId
    ) {
        JsonObject payload = new JsonObject();
        payload.addProperty("match_id", matchId);
        payload.addProperty("type", type);
        payload.addProperty("activity_key", activityKey);
        payload.addProperty("status_text", statusText);
        payload.addProperty("chat_message", chatMessage);
        payload.addProperty("advancement_id", advancementId);
        return invokeSnapshotAsync("report_activity", payload, session);
    }

    public CompletableFuture<RemoteMatchSnapshot> heartbeat(final AuthSession session, final String matchId) {
        JsonObject payload = new JsonObject();
        payload.addProperty("match_id", matchId);
        return invokeSnapshotAsync("heartbeat", payload, session);
    }

    public CompletableFuture<RemoteMatchSnapshot> reportFinish(final AuthSession session, final String matchId, final long finishTimeMs) {
        JsonObject payload = new JsonObject();
        payload.addProperty("match_id", matchId);
        payload.addProperty("finish_time_ms", finishTimeMs);
        return invokeSnapshotAsync("report_finish", payload, session);
    }

    public CompletableFuture<RemoteMatchSnapshot> forfeitMatch(final AuthSession session, final String matchId) {
        JsonObject payload = new JsonObject();
        payload.addProperty("match_id", matchId);
        return invokeSnapshotAsync("forfeit_match", payload, session);
    }

    private CompletableFuture<RemoteMatchSnapshot> invokeSnapshotAsync(final String action, final JsonObject payload, final AuthSession session) {
        return CompletableFuture.supplyAsync(() -> {
            try {
                return RemoteMatchSnapshot.fromJson(invokeMatchmaker(action, payload, session));
            } catch (IOException exception) {
                throw new CompletionException(exception);
            }
        });
    }

    private static JsonObject buildQueuePayload(AuthSession session, String playerName, SeedMode seedMode, String seedTypeLabel, List<String> filterIds) {
        JsonObject payload = new JsonObject();
        payload.addProperty("player_id", session != null ? session.getUserId() : "");
        payload.addProperty("username", session != null ? session.getUsername() : "");
        payload.addProperty("display_name", session != null && session.getDisplayName() != null && !session.getDisplayName().isEmpty() ? session.getDisplayName() : playerName);
        payload.addProperty("seed_mode", seedMode.name());
        payload.addProperty("seed_type_label", seedTypeLabel);

        JsonArray filtersArray = new JsonArray();
        if (filterIds != null) {
            for (String filterId : filterIds) {
                filtersArray.add(filterId);
            }
        }
        payload.add("filter_ids", filtersArray);
        return payload;
    }
}
