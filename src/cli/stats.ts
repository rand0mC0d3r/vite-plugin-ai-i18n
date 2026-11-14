import { existsSync } from "node:fs";
import { readdir } from "node:fs/promises";
import path from "node:path";
import { readLocaleFile, type LocaleFile } from "../catalog.js";
import { loadRegistry } from "../identity/registry.js";
import { computeStats, type StatsReport } from "../stats.js";

/** Parsed command-line options for the stats CLI. */
interface StatsArgs {
  /** Directory holding `registry.json` and `locales/`, relative to the working directory. */
  directory: string;
  /** Locale whose file is the source text. It is excluded from the translation figures. */
  sourceLocale: string;
  /** When true, the report is printed as JSON instead of text. */
  json: boolean;
  /** When true, the text report lists the missing and outdated message IDs per locale. */
  verbose: boolean;
}

/**
 * Parses `--directory`, `--source-locale`, `--json` and `--verbose` from the arguments after the script name.
 *
 * @throws If an option is unknown or lacks its value.
 */
function parseArgs(argv: string[]): StatsArgs {
  const args: StatsArgs = { directory: ".autoi18n", sourceLocale: "en", json: false, verbose: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--json") {
      args.json = true;
    } else if (arg === "--verbose") {
      args.verbose = true;
    } else if (arg === "--directory" || arg === "--source-locale") {
      const value = argv[++i];
      if (value === undefined || value.startsWith("--")) throw new Error(`${arg} needs a value`);
      if (arg === "--directory") args.directory = value;
      else args.sourceLocale = value;
    } else {
      throw new Error(`Unknown option ${arg}`);
    }
  }
  return args;
}

/** Reads every translated locale file (all `*.json` except the source locale and legacy `*.sources.json` sidecars). */
async function readLocales(localesDir: string, sourceLocale: string): Promise<Record<string, LocaleFile>> {
  const locales: Record<string, LocaleFile> = {};
  if (!existsSync(localesDir)) return locales;
  for (const name of await readdir(localesDir)) {
    if (!name.endsWith(".json") || name.endsWith(".sources.json")) continue;
    const locale = name.slice(0, -".json".length);
    if (locale === sourceLocale) continue;
    locales[locale] = await readLocaleFile(path.join(localesDir, name), message => console.warn(message));
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
  const kinds = Object.entries(registry.byKind).sort(([a], [b]) => a.localeCompare(b));
  if (kinds.length) lines.push(`  by kind: ${kinds.map(([kind, count]) => `${kind} ${count}`).join(", ")}`);
  const components = Object.entries(registry.byComponent).sort(([a], [b]) => a.localeCompare(b));
  if (components.length) lines.push(`  by component: ${components.map(([name, count]) => `${name} ${count}`).join(", ")}`);

  lines.push("", "Coverage");
  if (report.locales.length === 0) {
    lines.push("  no locale files found.");
  } else {
    const rows = [["locale", "translated", "missing", "outdated", "orphaned keys", "coverage"], ...report.locales.map(stats => [
      stats.locale,
      `${stats.translated}/${stats.total}`,
      String(stats.missing.length),
      String(stats.outdated.length),
      String(stats.orphanedKeys.length),
      percent(stats.coverage),
    ])];
    const widths = rows[0].map((_, column) => Math.max(...rows.map(row => row[column].length)));
    for (const row of rows) lines.push("  " + row.map((cell, column) => cell.padEnd(widths[column])).join("  ").trimEnd());
    lines.push(`  average coverage: ${percent(report.averageCoverage ?? 1)}`);
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
 * Entry point for the stats CLI (`npm run stats`). Prints registry counts, per-locale translation coverage, outdated
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
  const registry = await loadRegistry(registryFile, message => console.warn(message));
  const locales = await readLocales(path.join(path.dirname(registryFile), "locales"), args.sourceLocale);
  const report = computeStats(registry, locales);
  console.log(args.json ? JSON.stringify(report, null, 2) : formatReport(report, args.verbose));
}

main().catch(error => {
  console.error(`autoi18n: ${(error as Error).message}`);
  process.exitCode = 1;
});
