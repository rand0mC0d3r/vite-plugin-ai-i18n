import { existsSync } from "node:fs";
import path from "node:path";

import { computeStats, type StatsReport } from "../core/stats.js";
import { type LocaleFile, readLocaleFile } from "../io/catalog.js";
import { loadRegistry } from "../io/registry-file.js";
import { listLocaleFiles, parseCliArgs } from "./common.js";

/**
 * Parses `--directory`, `--source-locale`, `--json` and `--verbose` from the arguments after the script name.
 *
 * @throws If an option is unknown or lacks its value.
 */
function parseArgs(argv: string[]) {
  return parseCliArgs<{ directory: string; sourceLocale: string; json: boolean; verbose: boolean }>(argv, {
    directory: ".autoi18n",
    sourceLocale: "en",
    json: false,
    verbose: false,
  });
}

/** Reads every translated locale file (all `*.json` except the source locale and legacy `*.sources.json` sidecars). */
async function readLocales(localesDir: string, sourceLocale: string): Promise<Record<string, LocaleFile>> {
  const locales: Record<string, LocaleFile> = {};
  for (const name of await listLocaleFiles(localesDir)) {
    if (name.endsWith(".sources.json")) continue;
    const locale = name.slice(0, -".json".length);
    if (locale === sourceLocale) continue;
    locales[locale] = await readLocaleFile(path.join(localesDir, name), (message) => console.warn(message));
  }
  return locales;
}

const percent = (coverage: number): string => `${(coverage * 100).toFixed(1)}%`;

/** Renders the report as aligned plain text. Missing and outdated IDs are listed only when `verbose` is set. */
function formatReport(report: StatsReport, verbose: boolean): string {
  const lines: string[] = [];
  const { registry } = report;
  lines.push("Registry");
  lines.push(`  entries: ${registry.total} (${registry.active} active, ${registry.orphaned} orphaned)`);
  const components = Object.entries(registry.byComponent).sort(([a], [b]) => a.localeCompare(b));
  if (components.length)
    lines.push(`  by component: ${components.map(([name, count]) => `${name} ${count}`).join(", ")}`);

  lines.push("", "Coverage");
  if (report.averageCoverage === null) {
    lines.push("  no locale files found.");
  } else {
    const rows = [
      ["locale", "translated", "missing", "outdated", "orphaned keys", "coverage"],
      ...report.locales.map((stats) => [
        stats.locale,
        `${stats.translated}/${stats.total}`,
        String(stats.missing.length),
        String(stats.outdated.length),
        String(stats.orphanedKeys.length),
        percent(stats.coverage),
      ]),
    ];
    const widths = rows[0].map((_, column) => Math.max(...rows.map((row) => row[column].length)));
    for (const row of rows)
      lines.push(
        "  " +
          row
            .map((cell, column) => cell.padEnd(widths[column]))
            .join("  ")
            .trimEnd(),
      );
    lines.push(`  average coverage: ${percent(report.averageCoverage)}`);
    if (verbose) {
      for (const stats of report.locales) {
        if (stats.missing.length) lines.push(`  ${stats.locale} missing: ${stats.missing.join(", ")}`);
        if (stats.outdated.length) lines.push(`  ${stats.locale} outdated: ${stats.outdated.join(", ")}`);
        if (stats.orphanedKeys.length) lines.push(`  ${stats.locale} orphaned keys: ${stats.orphanedKeys.join(", ")}`);
      }
    }
  }

  lines.push("", "Orphans");
  if (registry.orphans.length === 0) {
    lines.push("  none.");
  } else {
    for (const entry of registry.orphans) {
      lines.push(`  ${entry.id}  ${JSON.stringify(entry.source)}  ${entry.location}  last seen ${entry.lastSeen}`);
    }
  }
  return lines.join("\n");
}

/**
 * Entry point for the stats CLI (`bun run stats`). Prints registry counts, per-locale translation coverage, outdated
 * translations, orphaned keys, and orphaned registry entries. Does nothing if no registry exists yet. Failures set
 * `process.exitCode` to 1.
 */
async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const registryFile = path.resolve(process.cwd(), args.directory, "registry.json");
  if (!existsSync(registryFile)) {
    console.log(`autoi18n: no registry found at ${registryFile}; nothing to report.`);
    return;
  }
  const registry = await loadRegistry(registryFile, (message) => console.warn(message));
  const locales = await readLocales(path.join(path.dirname(registryFile), "locales"), args.sourceLocale);
  const report = computeStats(registry, locales);
  console.log(args.json ? JSON.stringify(report, null, 2) : formatReport(report, args.verbose));
}

// eslint-disable-next-line bun/no-side-effects-on-import -- CLI entry point, runs when the bin is executed
main().catch((error) => {
  console.error(`autoi18n: ${(error as Error).message}`);
  process.exitCode = 1;
});
