package com.codex.mcsroff;

import com.codex.mcsroff.config.ModConfig;
import com.codex.mcsroff.telemetry.TelemetryManager;
import com.codex.mcsroff.ui.McsroffScreens;
import com.codex.mcsroff.world.WorldLauncher;
import org.apache.logging.log4j.LogManager;
import org.apache.logging.log4j.Logger;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.concurrent.atomic.AtomicBoolean;

public final class McsroffMod {
    public static final String MOD_ID = "mcsroff";
    public static final Logger LOGGER = LogManager.getLogger("offline MCSR");

    private static final AtomicBoolean INITIALIZED = new AtomicBoolean(false);

    private static LoaderType loaderType;
    private static Path configDirectory;
    private static ModConfig config;

    private McsroffMod() {
    }

    public static void init(LoaderType loader, Path baseConfigDirectory) {
        if (!INITIALIZED.compareAndSet(false, true)) {
            return;
        }

        loaderType = loader;
        configDirectory = baseConfigDirectory.resolve(MOD_ID);

        try {
            Files.createDirectories(configDirectory);
            config = ModConfig.load(configDirectory.resolve("client.json"));
        } catch (IOException exception) {
            throw new RuntimeException("Failed to initialize mod config directory", exception);
        }

        McsroffRuntime.bootstrap();

        LOGGER.info("Initialized {} on {} with config directory {}", MOD_ID, loaderType.getId(), configDirectory);
    }

    public static LoaderType getLoaderType() {
        return loaderType;
    }

    public static Path getConfigDirectory() {
        return configDirectory;
    }

    public static ModConfig getConfig() {
        return config;
    }

    public enum LoaderType {
        FABRIC("fabric"),
        FORGE("forge");

        private final String id;

        LoaderType(String id) {
            this.id = id;
        }

        public String getId() {
            return this.id;
        }
    }
}
