package com.codex.mcsroff.net;

import com.codex.mcsroff.auth.AccountManager;
import com.codex.mcsroff.auth.AuthSession;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;

import javax.websocket.*;
import java.io.IOException;
import java.net.URI;
import java.nio.ByteBuffer;
import java.nio.charset.StandardCharsets;
import java.util.Collections;
import java.util.List;
import java.util.Map;

/**
 * WebSocket-based real-time match client.
 * Replaces the old SSE-based MatchRealtimeClient for lower latency,
 * bidirectional communication, and protocol-level keepalive.
 */
public final class MatchRealtimeClient {
    private static final long RETRY_BASE_MILLIS = 1000L;
    private static final long RETRY_MAX_MILLIS = 15000L;
    private static final int MAX_RETRY_ATTEMPTS = 10;

    private final BackendApi backendApi;
    private final AccountManager accountManager;

    private volatile String activeMatchId = "";
    private volatile boolean running;
    private volatile boolean connected;
    private volatile Thread workerThread;
    private volatile Session wsSession;
    private volatile RemoteMatchSnapshot latestSnapshot;
    private volatile long lastSnapshotAtMillis;
    private volatile int retryCount;

    public MatchRealtimeClient(BackendApi backendApi, AccountManager accountManager) {
        this.backendApi = backendApi;
        this.accountManager = accountManager;
    }

    public synchronized void ensureStreaming(String matchId) {
        String normalizedMatchId = matchId == null ? "" : matchId.trim();
        if (normalizedMatchId.isEmpty()) {
            stop();
            return;
        }
        if (this.running && normalizedMatchId.equals(this.activeMatchId)
                && this.workerThread != null && this.workerThread.isAlive()) {
            return;
        }

        stopInternal();
        this.activeMatchId = normalizedMatchId;
        this.running = true;
        this.retryCount = 0;
        Thread thread = new Thread(new Runnable() {
            @Override
            public void run() {
                runLoop();
            }
        }, "mcsroff-ws-stream");
        thread.setDaemon(true);
        this.workerThread = thread;
        thread.start();
    }

    public synchronized void stop() {
        stopInternal();
    }

    public RemoteMatchSnapshot consumeLatestSnapshot() {
        RemoteMatchSnapshot snapshot = this.latestSnapshot;
        this.latestSnapshot = null;
        return snapshot;
    }

    public boolean isFresh(long now, long freshnessWindowMillis) {
        return this.lastSnapshotAtMillis > 0L && (now - this.lastSnapshotAtMillis) <= freshnessWindowMillis;
    }

    public boolean isStreamingMatch(String matchId) {
        return this.running && this.activeMatchId.equals(matchId);
    }

    public boolean isConnected() {
        return this.connected;
    }

    /**
     * Send a heartbeat over the WebSocket connection.
     * This saves a separate HTTP round-trip.
     */
    public void sendHeartbeat() {
        Session session = this.wsSession;
        if (session != null && session.isOpen()) {
            try {
                session.getBasicRemote().sendText("{\"type\":\"heartbeat\"}");
            } catch (IOException ignored) {
                // Will reconnect on next cycle
            }
        }
    }

    private void runLoop() {
        while (this.running) {
            AuthSession authSession = this.accountManager.getCurrentSession();
            if (authSession == null || !authSession.isUsable()) {
                this.connected = false;
                sleepQuietly(RETRY_BASE_MILLIS);
                continue;
            }

            try {
                connectWebSocket(authSession);
            } catch (Exception exception) {
                this.connected = false;
            }

            if (this.running) {
                long delay = calculateBackoff();
                sleepQuietly(delay);
            }
        }
    }

    private void connectWebSocket(AuthSession authSession) throws Exception {
        String wsUrl = this.backendApi.getMatchWebSocketUrl(this.activeMatchId);
        if (wsUrl == null || wsUrl.isEmpty()) {
            // Fall back to SSE-style URL conversion
            String baseUrl = this.backendApi.getMatchStreamUrl(this.activeMatchId);
            wsUrl = baseUrl.replace("http://", "ws://").replace("https://", "wss://")
                    .replace("/mod-stream/match", "/ws/match/" + this.activeMatchId);
        }

        ClientEndpointConfig.Configurator configurator = new ClientEndpointConfig.Configurator() {
            @Override
            public void beforeRequest(Map<String, List<String>> headers) {
                headers.put("Authorization", Collections.singletonList("Bearer " + authSession.getAccessToken()));
                headers.put("User-Agent", Collections.singletonList("mcsroff-ws-client"));
            }
        };

        ClientEndpointConfig config = ClientEndpointConfig.Builder.create()
                .configurator(configurator)
                .build();

        WebSocketContainer container = ContainerProvider.getWebSocketContainer();
        container.setDefaultMaxSessionIdleTimeout(60000);

        Endpoint endpoint = new Endpoint() {
            @Override
            public void onOpen(Session session, EndpointConfig endpointConfig) {
                MatchRealtimeClient.this.wsSession = session;
                MatchRealtimeClient.this.connected = true;
                MatchRealtimeClient.this.retryCount = 0;

                session.addMessageHandler(String.class, new MessageHandler.Whole<String>() {
                    @Override
                    public void onMessage(String message) {
                        handleMessage(message);
                    }
                });
            }

            @Override
            public void onClose(Session session, CloseReason closeReason) {
                MatchRealtimeClient.this.connected = false;
                MatchRealtimeClient.this.wsSession = null;
            }

            @Override
            public void onError(Session session, Throwable throwable) {
                MatchRealtimeClient.this.connected = false;
            }
        };

        Session session = container.connectToServer(endpoint, config, URI.create(wsUrl));
        this.wsSession = session;

        // Block until session closes or stop is called
        while (this.running && session.isOpen()) {
            sleepQuietly(500);
        }
    }

    private void handleMessage(String message) {
        if (message == null || message.isEmpty()) {
            return;
        }
        try {
            JsonObject root = new JsonParser().parse(message).getAsJsonObject();
            String type = root.has("type") ? root.get("type").getAsString() : "";

            if ("snapshot".equals(type) && root.has("data")) {
                JsonObject data = root.getAsJsonObject("data");
                // Parse from the match sub-object if present
                if (data.has("match")) {
                    this.latestSnapshot = RemoteMatchSnapshot.fromJson(data);
                } else {
                    this.latestSnapshot = RemoteMatchSnapshot.fromJson(root);
                }
                this.lastSnapshotAtMillis = System.currentTimeMillis();
            } else if ("error".equals(type)) {
                // Server sent an error — will trigger reconnect
                this.connected = false;
                Session session = this.wsSession;
                if (session != null && session.isOpen()) {
                    session.close(new CloseReason(CloseReason.CloseCodes.NORMAL_CLOSURE, "server_error"));
                }
            }
        } catch (Exception ignored) {
            // Malformed message, ignore
        }
    }

    private long calculateBackoff() {
        this.retryCount = Math.min(this.retryCount + 1, MAX_RETRY_ATTEMPTS);
        long delay = Math.min(RETRY_BASE_MILLIS * (1L << (this.retryCount - 1)), RETRY_MAX_MILLIS);
        // Add jitter: ±25%
        long jitter = (long) (delay * 0.25 * (Math.random() * 2 - 1));
        return Math.max(500L, delay + jitter);
    }

    private synchronized void stopInternal() {
        this.running = false;
        this.connected = false;
        this.activeMatchId = "";
        this.latestSnapshot = null;
        this.lastSnapshotAtMillis = 0L;
        this.retryCount = 0;

        Session session = this.wsSession;
        this.wsSession = null;
        if (session != null) {
            try {
                if (session.isOpen()) {
                    session.close(new CloseReason(CloseReason.CloseCodes.NORMAL_CLOSURE, "client_stop"));
                }
            } catch (IOException ignored) {
            }
        }

        Thread thread = this.workerThread;
        this.workerThread = null;
        if (thread != null) {
            thread.interrupt();
        }
    }

    private static void sleepQuietly(long millis) {
        try {
            Thread.sleep(millis);
        } catch (InterruptedException ignored) {
            Thread.currentThread().interrupt();
        }
    }
}
