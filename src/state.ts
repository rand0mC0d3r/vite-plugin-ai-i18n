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

/** Keeps parsed files by path, reusing an entry while its on-disk stamp is unchanged. */
class StampCache<T> {
  private readonly entries = new Map<string, Cached<T>>();

  /** Returns the cached value while the file's stamp is unchanged; otherwise loads the file again. */
  async read(file: string, load: () => Promise<T>): Promise<T> {
    const stamp = await stampOf(file);
    const cached = this.entries.get(file);
    if (stamp !== undefined && cached?.stamp === stamp) return cached.value;
    const value = await load();
    if (stamp !== undefined) this.entries.set(file, { stamp, value });
    return value;
  }

  /** Saves the file, then caches the value under the stamp the save produced. */
  async write(file: string, value: T, save: () => Promise<void>): Promise<void> {
    await save();
    const stamp = await stampOf(file);
    if (stamp !== undefined) this.entries.set(file, { stamp, value });
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
  private readonly locales = new StampCache<LocaleFile>();
  private readonly registries = new StampCache<Registry>();

  /** Hash of an indexed file. Derived from `extractions`, so the two cannot diverge. */
  hashOf(file: string): string | undefined {
    return this.extractions.get(file)?.hash;
  }

  readLocale(file: string, warn: (message: string) => void): Promise<LocaleFile> {
    return this.locales.read(file, () => readLocaleFile(file, warn));
  }

  writeLocale(file: string, content: LocaleFile): Promise<void> {
    return this.locales.write(file, content, () => writeLocaleFile(file, content));
  }

  readRegistry(file: string, warn: (message: string) => void): Promise<Registry> {
    return this.registries.read(file, () => loadRegistry(file, warn));
  }

  writeRegistry(file: string, registry: Registry): Promise<void> {
    return this.registries.write(file, registry, () => saveRegistry(file, registry));
  }
}
