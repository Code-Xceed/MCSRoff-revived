package com.codex.mcsroff.ui;

public final class McsroffScreens {
    private static boolean bootstrapped;

    private McsroffScreens() {
    }

    public static void bootstrap() {
        if (bootstrapped) {
            return;
        }
        bootstrapped = true;
    }
}
