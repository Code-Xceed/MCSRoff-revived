package com.codex.mcsroff.net;

import java.io.IOException;

public final class HttpRequestException extends IOException {
    private final int statusCode;
    private final String url;
    private final String responseBody;

    public HttpRequestException(int statusCode, String url, String responseBody) {
        super("HTTP " + statusCode + " for " + url + ": " + responseBody);
        this.statusCode = statusCode;
        this.url = url;
        this.responseBody = responseBody == null ? "" : responseBody;
    }

    public int getStatusCode() {
        return this.statusCode;
    }

    public String getUrl() {
        return this.url;
    }

    public String getResponseBody() {
        return this.responseBody;
    }
}
