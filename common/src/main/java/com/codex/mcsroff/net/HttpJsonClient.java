package com.codex.mcsroff.net;

import com.google.gson.JsonObject;
import com.google.gson.JsonParser;

import java.io.BufferedReader;
import java.io.BufferedWriter;
import java.io.IOException;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStreamWriter;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.HashMap;
import java.util.Map;

final class HttpJsonClient {
    private static final String USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
            + "(KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36";

    private HttpJsonClient() {
    }

    static JsonObject getJson(String url) throws IOException {
        return getJson(url, defaultHeaders());
    }

    static JsonObject getJson(String url, Map<String, String> headers) throws IOException {
        HttpURLConnection connection = (HttpURLConnection) new URL(url).openConnection();
        connection.setRequestMethod("GET");
        connection.setConnectTimeout(10000);
        connection.setReadTimeout(15000);
        connection.setInstanceFollowRedirects(true);
        applyHeaders(connection, headers);

        int status = connection.getResponseCode();
        InputStream stream = status >= 200 && status < 300 ? connection.getInputStream() : connection.getErrorStream();
        String body = readFully(stream);

        if (status < 200 || status >= 300) {
            throw new HttpRequestException(status, url, body);
        }

        return new JsonParser().parse(body).getAsJsonObject();
    }

    static JsonObject postJson(String url, Map<String, String> headers, JsonObject body) throws IOException {
        HttpURLConnection connection = (HttpURLConnection) new URL(url).openConnection();
        connection.setRequestMethod("POST");
        connection.setConnectTimeout(10000);
        connection.setReadTimeout(15000);
        connection.setInstanceFollowRedirects(true);
        connection.setDoOutput(true);

        Map<String, String> finalHeaders = new HashMap<String, String>(defaultHeaders());
        if (headers != null) {
            finalHeaders.putAll(headers);
        }
        finalHeaders.put("Content-Type", "application/json");
        applyHeaders(connection, finalHeaders);

        BufferedWriter writer = new BufferedWriter(new OutputStreamWriter(connection.getOutputStream(), StandardCharsets.UTF_8));
        writer.write(body == null ? "{}" : body.toString());
        writer.flush();
        writer.close();

        int status = connection.getResponseCode();
        InputStream stream = status >= 200 && status < 300 ? connection.getInputStream() : connection.getErrorStream();
        String responseBody = readFully(stream);

        if (status < 200 || status >= 300) {
            throw new HttpRequestException(status, url, responseBody);
        }

        return responseBody.isEmpty() ? new JsonObject() : new JsonParser().parse(responseBody).getAsJsonObject();
    }

    static Map<String, String> headersWithApiKey(String apiKey) {
        Map<String, String> headers = new HashMap<String, String>(defaultHeaders());
        if (apiKey != null && !apiKey.trim().isEmpty()) {
            headers.put("apikey", apiKey);
            headers.put("Authorization", "Bearer " + apiKey);
        }
        return headers;
    }

    private static Map<String, String> defaultHeaders() {
        Map<String, String> headers = new HashMap<String, String>();
        headers.put("Accept", "application/json");
        headers.put("Accept-Language", "en-US,en;q=0.9");
        headers.put("Cache-Control", "no-cache");
        headers.put("Pragma", "no-cache");
        headers.put("User-Agent", USER_AGENT);
        return headers;
    }

    private static void applyHeaders(HttpURLConnection connection, Map<String, String> headers) {
        for (Map.Entry<String, String> header : headers.entrySet()) {
            connection.setRequestProperty(header.getKey(), header.getValue());
        }
    }

    private static String readFully(InputStream inputStream) throws IOException {
        if (inputStream == null) {
            return "";
        }

        BufferedReader reader = new BufferedReader(new InputStreamReader(inputStream, StandardCharsets.UTF_8));
        StringBuilder builder = new StringBuilder();
        String line;
        while ((line = reader.readLine()) != null) {
            builder.append(line);
        }
        return builder.toString();
    }
}
