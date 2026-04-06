package com.codex.mcsroff.util;

import java.awt.Desktop;
import java.net.URI;

public final class BrowserLauncher {
    private BrowserLauncher() {
    }

    public static boolean open(String uri) {
        if (uri == null || uri.trim().isEmpty()) {
            return false;
        }

        try {
            if (!Desktop.isDesktopSupported()) {
                return false;
            }
            Desktop.getDesktop().browse(new URI(uri));
            return true;
        } catch (Exception exception) {
            return false;
        }
    }
}
