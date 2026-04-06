package com.codex.mcsroff.net;

import com.codex.mcsroff.auth.AuthSession;
import com.codex.mcsroff.seed.SeedMode;
import com.google.gson.JsonObject;
import com.google.gson.JsonArray;

import java.io.IOException;
import java.util.List;
import java.util.HashMap;
import java.util.Map;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.CompletionException;

public final class BackendApi {
    private final String baseUrl;
    private final String publishableKey;

    public BackendApi(String baseUrl, String publishableKey) {
        this.baseUrl = baseUrl;
        this.publishableKey = publishableKey;
    }

    public String getBaseUrl() {
        return this.baseUrl;
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
