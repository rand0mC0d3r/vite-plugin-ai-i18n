import { visualizer } from "rollup-plugin-visualizer";
import { defineConfig } from "tsdown";

function analyzerPlugins() {
  return process.env.ANALYZE !== undefined && process.env.ANALYZE !== ""
    ? [
        visualizer({
          filename: "bundle-stats.html",
          template: "treemap",
          gzipSize: true,
          open: true,
        }),
      ]
    : [];
}

export default defineConfig({
  entry: ["src/index.ts", "src/runtime/index.ts", "src/cli/prune.ts", "src/cli/stats.ts"],
  plugins: analyzerPlugins(),
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
