import { existsSync } from "node:fs";
import { readdir } from "node:fs/promises";
import path from "node:path";
import { debugLog } from "../debug.js";
import { DEFAULT_ORPHAN_RETENTION_MINUTES, loadRegistry, pruneOrphans, saveRegistry } from "../identity/registry.js";
import { readJsonFile, writeFileAtomic } from "../io.js";

type Catalog = Record<string, string>;

/** Drops catalogue keys (`locales/*.json`, `*.sources.json`) that are no longer active registry ids. */
async function pruneCatalogs(localesDir: string, activeIds: Set<string>): Promise<{ file: string; removed: string[] }[]> {
  if (!existsSync(localesDir)) return [];
  const results: { file: string; removed: string[] }[] = [];
  for (const name of await readdir(localesDir)) {
    if (!name.endsWith(".json")) continue;
    const file = path.join(localesDir, name);
    const catalog = await readJsonFile<Catalog>(file, {}, message => console.warn(message));
    const removed = Object.keys(catalog).filter(id => !activeIds.has(id));
    if (!removed.length) continue;
    for (const id of removed) delete catalog[id];
    await writeFileAtomic(file, JSON.stringify(catalog, null, 2) + "\n");
    results.push({ file, removed });
  }
  return results;
}

interface PruneArgs {
  directory: string;
  retentionMinutes: number;
  debug: boolean;
}

function parseArgs(argv: string[]): PruneArgs {
  const args: PruneArgs = { directory: ".autoi18n", retentionMinutes: DEFAULT_ORPHAN_RETENTION_MINUTES, debug: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--debug") {
      args.debug = true;
    } else if (arg === "--directory" || arg === "--retention-minutes") {
      const value = argv[++i];
      if (value === undefined) throw new Error(`${arg} needs a value`);
      if (arg === "--directory") args.directory = value;
      else args.retentionMinutes = Number(value);
    } else {
      throw new Error(`Unknown option ${arg}`);
    }
  }
  if (!(args.retentionMinutes >= 0)) throw new Error("--retention-minutes must be a number of minutes, 0 or more");
  return args;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const registryFile = path.resolve(process.cwd(), args.directory, "registry.json");
  if (!existsSync(registryFile)) {
    console.log(`autoi18n: no registry found at ${registryFile}; nothing to prune.`);
    return;
  }
  const registry = await loadRegistry(registryFile, message => console.warn(message));
  const removed = pruneOrphans(registry, args.retentionMinutes);
  if (removed.length) await saveRegistry(registryFile, registry);
  const activeIds = new Set(Object.values(registry.entries).filter(entry => entry.status === "active").map(entry => entry.id));
  const catalogs = await pruneCatalogs(path.join(path.dirname(registryFile), "locales"), activeIds);
  if (args.debug) {
    for (const entry of removed) debugLog(`removed ${entry.id} ${JSON.stringify(entry.source)} (last seen ${entry.lastSeen})`);
    for (const { file, removed: ids } of catalogs) {
      for (const id of ids) debugLog(`removed ${id} from ${file}`);
    }
  }
  console.log(`autoi18n: removed ${removed.length} registry entries orphaned for more than ${args.retentionMinutes} minutes.`);
  if (catalogs.length) console.log(`autoi18n: removed stale keys from ${catalogs.length} locale files.`);
}

main().catch(error => {
  console.error(`autoi18n: ${(error as Error).message}`);
  process.exitCode = 1;
});
