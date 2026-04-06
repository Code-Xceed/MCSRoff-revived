package com.codex.mcsroff.seed;

public class FsgApiException extends RuntimeException {
    public FsgApiException(String message) {
        super(message);
    }

    public FsgApiException(String message, Throwable cause) {
        super(message, cause);
    }
}
