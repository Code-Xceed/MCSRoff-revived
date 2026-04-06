package com.codex.mcsroff;

import net.fabricmc.api.ModInitializer;
import net.fabricmc.loader.api.FabricLoader;

public final class McsroffFabric implements ModInitializer {
    @Override
    public void onInitialize() {
        McsroffMod.init(McsroffMod.LoaderType.FABRIC, FabricLoader.getInstance().getConfigDir());
    }
}
