import { defineConfig } from "tsdown";

export default defineConfig({
    entry: ["src/index.ts", "src/runtime/index.ts", "src/cli/prune.ts"],
    format: "esm",
    dts: true,
    clean: true,
    fixedExtension: false,
    unbundle: false,
    minify: true,
    treeshake: true,
    target: "node26",
    failOnWarn: true,
});
