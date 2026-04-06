package com.codex.mcsroff.match;

import net.minecraft.resources.ResourceLocation;

public final class MatchOpponent {
    private final String name;
    private final int elo;
    private final String rank;
    private final ResourceLocation skinTexture;

    public MatchOpponent(String name, int elo, String rank, ResourceLocation skinTexture) {
        this.name = name;
        this.elo = elo;
        this.rank = rank;
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

    public ResourceLocation getSkinTexture() {
        return this.skinTexture;
    }
}
