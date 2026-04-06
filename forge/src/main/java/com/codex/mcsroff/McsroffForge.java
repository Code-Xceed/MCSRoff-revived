package com.codex.mcsroff;

import net.minecraftforge.fml.common.Mod;
import net.minecraftforge.fml.loading.FMLPaths;

@Mod(McsroffMod.MOD_ID)
public final class McsroffForge {
    public McsroffForge() {
        McsroffMod.init(McsroffMod.LoaderType.FORGE, FMLPaths.CONFIGDIR.get());
    }
}
