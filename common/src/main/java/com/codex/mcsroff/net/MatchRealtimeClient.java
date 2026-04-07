package com.codex.mcsroff.net;

import com.codex.mcsroff.auth.AccountManager;
import com.codex.mcsroff.auth.AuthSession;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;

import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;

public final class MatchRealtimeClient {
    private static final long RETRY_DELAY_MILLIS = 1500L;

    private final BackendApi backendApi;
    private final AccountManager accountManager;

    private volatile String activeMatchId = "";
    private volatile boolean running;
    private volatile boolean connected;
    private volatile Thread workerThread;
    private volatile HttpURLConnection activeConnection;
    private volatile RemoteMatchSnapshot latestSnapshot;
    private volatile long lastSnapshotAtMillis;

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
        if (this.running && normalizedMatchId.equals(this.activeMatchId) && this.workerThread != null && this.workerThread.isAlive()) {
            return;
        }

        stopInternal();
        this.activeMatchId = normalizedMatchId;
        this.running = true;
        Thread thread = new Thread(new Runnable() {
            @Override
            public void run() {
                runLoop();
            }
        }, "mcsroff-match-stream");
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

    private void runLoop() {
        while (this.running) {
            AuthSession session = this.accountManager.getCurrentSession();
            if (session == null || !session.isUsable()) {
                this.connected = false;
                sleepQuietly(RETRY_DELAY_MILLIS);
                continue;
            }

            HttpURLConnection connection = null;
            try {
                connection = (HttpURLConnection) new URL(this.backendApi.getMatchStreamUrl(this.activeMatchId)).openConnection();
                this.activeConnection = connection;
                connection.setRequestMethod("GET");
                connection.setConnectTimeout(10000);
                connection.setReadTimeout(30000);
                connection.setInstanceFollowRedirects(true);
                connection.setRequestProperty("Accept", "text/event-stream");
                connection.setRequestProperty("Cache-Control", "no-cache");
                connection.setRequestProperty("Authorization", "Bearer " + session.getAccessToken());
                connection.setRequestProperty("User-Agent", "mcsroff-match-stream");

                int status = connection.getResponseCode();
                if (status < 200 || status >= 300) {
                    this.connected = false;
                    sleepQuietly(RETRY_DELAY_MILLIS);
                    continue;
                }

                this.connected = true;
                consumeEventStream(connection.getInputStream());
            } catch (IOException exception) {
                this.connected = false;
            } finally {
                this.connected = false;
                if (connection != null) {
                    connection.disconnect();
                }
                if (this.activeConnection == connection) {
                    this.activeConnection = null;
                }
            }

            if (this.running) {
                sleepQuietly(RETRY_DELAY_MILLIS);
            }
        }
    }

    private void consumeEventStream(InputStream inputStream) throws IOException {
        BufferedReader reader = new BufferedReader(new InputStreamReader(inputStream, StandardCharsets.UTF_8));
        StringBuilder dataBuilder = new StringBuilder();
        String line;
        while (this.running && (line = reader.readLine()) != null) {
            if (line.startsWith("data:")) {
                dataBuilder.append(line.substring(5).trim());
                continue;
            }
            if (line.isEmpty()) {
                dispatchEventData(dataBuilder);
                dataBuilder.setLength(0);
            }
        }
        dispatchEventData(dataBuilder);
    }

    private void dispatchEventData(StringBuilder dataBuilder) {
        if (dataBuilder.length() == 0) {
            return;
        }
        try {
            JsonObject root = new JsonParser().parse(dataBuilder.toString()).getAsJsonObject();
            this.latestSnapshot = RemoteMatchSnapshot.fromJson(root);
            this.lastSnapshotAtMillis = System.currentTimeMillis();
        } catch (Exception ignored) {
        }
    }

    private synchronized void stopInternal() {
        this.running = false;
        this.connected = false;
        this.activeMatchId = "";
        this.latestSnapshot = null;
        this.lastSnapshotAtMillis = 0L;

        HttpURLConnection connection = this.activeConnection;
        this.activeConnection = null;
        if (connection != null) {
            connection.disconnect();
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
