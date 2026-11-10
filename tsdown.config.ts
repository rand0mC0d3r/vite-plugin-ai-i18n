import { defineConfig } from "tsdown";
import { visualizer } from "rollup-plugin-visualizer";

export default defineConfig({
    entry: ["src/index.ts", "src/runtime/index.ts", "src/cli/prune.ts"],
    plugins: process.env.ANALYZE
        ? [
              visualizer({
                  filename: "bundle-stats.html",
                  template: "treemap",
                  gzipSize: true,
                  open: true,
              }),
          ]
        : [],
    format: "esm",
    dts: true,
    clean: true,
    fixedExtension: false,
    unbundle: false,
    minify: true,
    treeshake: true,
    target: "node26",
    failOnWarn: true,
    suppressWarnings: [/TypeScript Go is experimental/],
});
