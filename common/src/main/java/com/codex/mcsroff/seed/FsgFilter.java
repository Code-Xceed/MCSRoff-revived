package com.codex.mcsroff.seed;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

public final class FsgFilter {
    private final String id;
    private final String displayName;
    private final List<String> supportedVersions;
    private final int maxGenerating;
    private final boolean runRetimed;
    private final boolean cooldownScaling;

    public FsgFilter(String id, String displayName, List<String> supportedVersions, int maxGenerating, boolean runRetimed, boolean cooldownScaling) {
        this.id = id;
        this.displayName = displayName;
        this.supportedVersions = Collections.unmodifiableList(new ArrayList<String>(supportedVersions));
        this.maxGenerating = maxGenerating;
        this.runRetimed = runRetimed;
        this.cooldownScaling = cooldownScaling;
    }

    public String getId() {
        return this.id;
    }

    public String getDisplayName() {
        return this.displayName;
    }

    public List<String> getSupportedVersions() {
        return this.supportedVersions;
    }

    public int getMaxGenerating() {
        return this.maxGenerating;
    }

    public boolean isRunRetimed() {
        return this.runRetimed;
    }

    public boolean hasCooldownScaling() {
        return this.cooldownScaling;
    }
}
