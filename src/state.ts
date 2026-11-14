import { stat } from "node:fs/promises";
import { readLocaleFile, writeLocaleFile, type LocaleFile } from "./catalog.js";
import { loadRegistry, saveRegistry } from "./identity/registry.js";
import type { Catalog, ExtractedMessage, ResolvedMessage, Registry } from "./types.js";

/** Last extraction of one source file. The hash lets an unchanged file skip re-extraction. */
export interface ExtractionCacheEntry { hash: string; messages: ExtractedMessage[] }

/** A parsed file kept until its on-disk stamp changes. Cached values are shared, so callers must not mutate them. */
interface Cached<T> { stamp: string; value: T }

/** Changes whenever the file is replaced or edited; undefined when the file does not exist. */
async function stampOf(file: string): Promise<string | undefined> {
  try {
    const info = await stat(file);
    return `${info.mtimeMs}:${info.size}`;
  } catch {
    return undefined;
  }
}

/** Two catalogues are the same when they hold the same keys with the same text. */
export function sameCatalog(a: Catalog | undefined, b: Catalog): boolean {
  if (!a) return false;
  const keys = Object.keys(b);
  return keys.length === Object.keys(a).length && keys.every(key => a[key] === b[key]);
}

/**
 * Everything the plugin remembers between syncs: the source index, the compiled catalogues and the
 * caches for files read from disk. Files are cached by their stamp, so a locale or registry file edited
 * outside the plugin is read again on the next sync.
 */
export class IndexState {
  extractions = new Map<string, ExtractionCacheEntry>();
  fileMessages = new Map<string, ResolvedMessage[]>();
  catalogs = new Map<string, Catalog>();
  catalogFiles: Record<string, string> = {};
  readonly warnedFiles = new Set<string>();
  legacySidecarsRemoved = false;
  private readonly localeFiles = new Map<string, Cached<LocaleFile>>();
  private registryCache: Cached<Registry> | undefined;

  /** Hash of an indexed file. Derived from `extractions`, so the two cannot diverge. */
  hashOf(file: string): string | undefined {
    return this.extractions.get(file)?.hash;
  }

  async readLocale(file: string, warn: (message: string) => void): Promise<LocaleFile> {
    const stamp = await stampOf(file);
    const cached = this.localeFiles.get(file);
    if (stamp !== undefined && cached?.stamp === stamp) return cached.value;
    const value = await readLocaleFile(file, warn);
    if (stamp !== undefined) this.localeFiles.set(file, { stamp, value });
    return value;
  }

  async writeLocale(file: string, content: LocaleFile): Promise<void> {
    await writeLocaleFile(file, content);
    const stamp = await stampOf(file);
    if (stamp !== undefined) this.localeFiles.set(file, { stamp, value: content });
  }

  async readRegistry(file: string, warn: (message: string) => void): Promise<Registry> {
    const stamp = await stampOf(file);
    if (stamp !== undefined && this.registryCache?.stamp === stamp) return this.registryCache.value;
    const value = await loadRegistry(file, warn);
    if (stamp !== undefined) this.registryCache = { stamp, value };
    return value;
  }

  async writeRegistry(file: string, registry: Registry): Promise<void> {
    await saveRegistry(file, registry);
    const stamp = await stampOf(file);
    if (stamp !== undefined) this.registryCache = { stamp, value: registry };
  }
}
