package com.codex.mcsroff.world;

import com.codex.mcsroff.seed.SeedAssignment;
import net.minecraft.client.Minecraft;
import net.minecraft.core.RegistryAccess;
import net.minecraft.world.Difficulty;
import net.minecraft.world.level.DataPackConfig;
import net.minecraft.world.level.GameRules;
import net.minecraft.world.level.GameType;
import net.minecraft.world.level.LevelSettings;
import net.minecraft.world.level.levelgen.WorldGenSettings;
import net.minecraft.world.level.storage.LevelStorageSource;

import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;
import java.util.OptionalLong;

public final class WorldLauncher {
    private static final SimpleDateFormat WORLD_ID_FORMAT = new SimpleDateFormat("yyyyMMdd_HHmmss", Locale.ROOT);

    public String launchSeedWorld(SeedAssignment assignment) {
        if (assignment == null) {
            throw new IllegalArgumentException("Seed assignment is required");
        }

        Minecraft minecraft = Minecraft.getInstance();
        long seed = parseSeed(assignment.getSeed());
        String worldId = createUniqueWorldId(minecraft);
        String levelName = "offline MCSR Race";

        LevelSettings levelSettings = new LevelSettings(
                levelName,
                GameType.SURVIVAL,
                false,
                Difficulty.NORMAL,
                false,
                new GameRules(),
                DataPackConfig.DEFAULT
        );

        WorldGenSettings worldGenSettings = WorldGenSettings.makeDefault().withSeed(true, OptionalLong.of(seed));
        RegistryAccess.RegistryHolder registries = (RegistryAccess.RegistryHolder) RegistryAccess.builtin();

        minecraft.createLevel(worldId, levelSettings, registries, worldGenSettings);
        return worldId;
    }

    public boolean worldExists(String worldId) {
        if (worldId == null || worldId.trim().isEmpty()) {
            return false;
        }
        return Minecraft.getInstance().getLevelSource().levelExists(worldId.trim());
    }

    public void loadExistingWorld(String worldId) {
        if (!worldExists(worldId)) {
            throw new IllegalArgumentException("World does not exist: " + worldId);
        }
        Minecraft.getInstance().loadLevel(worldId.trim());
    }

    private static String createUniqueWorldId(Minecraft minecraft) {
        LevelStorageSource levelSource = minecraft.getLevelSource();
        String baseId = "mcsr_race_" + WORLD_ID_FORMAT.format(new Date());
        String candidate = baseId;
        int suffix = 2;

        while (levelSource.levelExists(candidate) || !levelSource.isNewLevelIdAcceptable(candidate)) {
            candidate = baseId + "_" + suffix;
            suffix++;
        }

        return candidate;
    }

    private static long parseSeed(String seedText) {
        if (seedText == null || seedText.trim().isEmpty()) {
            throw new IllegalArgumentException("Seed must not be blank");
        }
        try {
            return Long.parseLong(seedText.trim());
        } catch (NumberFormatException exception) {
            throw new IllegalArgumentException("Unsupported non-numeric seed: " + seedText, exception);
        }
    }
}
