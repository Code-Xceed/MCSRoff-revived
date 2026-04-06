package com.codex.mcsroff.ui;

import net.minecraft.resources.ResourceLocation;

public final class MatchmakingProfile {
    private final String name;
    private final int elo;
    private final String rank;
    private final String achievements;
    private final String record;
    private final String status;
    private final ResourceLocation skinTexture;

    public MatchmakingProfile(String name, int elo, String rank, String achievements, String record, String status, ResourceLocation skinTexture) {
        this.name = name;
        this.elo = elo;
        this.rank = rank;
        this.achievements = achievements;
        this.record = record;
        this.status = status;
        this.skinTexture = skinTexture;
    }

    public String getName() {
        return this.name;
    }

    public int getElo() {
        return this.elo;
    }

    public String getRank() {
        return this.rank;
    }

    public String getAchievements() {
        return this.achievements;
    }

    public String getRecord() {
        return this.record;
    }

    public String getStatus() {
        return this.status;
    }

    public ResourceLocation getSkinTexture() {
        return this.skinTexture;
    }
}
