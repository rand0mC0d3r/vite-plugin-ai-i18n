import { stat } from "node:fs/promises";

import { type LocaleFile, readLocaleFile, writeLocaleFile } from "./catalog.js";
import type { ParsedSource } from "./compiler/ast.js";
import { loadRegistry, saveRegistry } from "./identity/registry.js";
import type { Catalog, ExtractedMessage, Registry, ResolvedMessage } from "./types.js";

/** Last extraction of one source file. The hash lets an unchanged file skip re-extraction. */
export interface ExtractionCacheEntry {
  hash: string;
  messages: ExtractedMessage[];
}

/**
 * A parsed file kept until its on-disk stamp changes. Cached values are shared, so callers must not mutate them.
 * `written` marks a value this process saved, whose text is exactly what is on disk.
 */
interface Cached<T> {
  stamp: string;
  value: T;
  written: boolean;
}

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
    if (stamp !== undefined) this.entries.set(file, { stamp, value, written: false });
    return value;
  }

  /**
   * True when this process last saved an equal value and the file has not changed since, so saving again would change
   * nothing.
   */
  async holds(file: string, value: T, same: (a: T, b: T) => boolean): Promise<boolean> {
    const cached = this.entries.get(file);
    if (cached?.written !== true || !same(cached.value, value)) return false;
    return (await stampOf(file)) === cached.stamp;
  }

  /** Saves the file, then caches the value under the stamp the save produced. */
  async write(file: string, value: T, save: () => Promise<void>): Promise<void> {
    await save();
    const stamp = await stampOf(file);
    if (stamp !== undefined) this.entries.set(file, { stamp, value, written: true });
  }
}

/** Two catalogues are the same when they hold the same keys with the same text. */
export function sameCatalog(a: Catalog | undefined, b: Catalog): boolean {
  if (!a) return false;
  const keys = Object.keys(b);
  return keys.length === Object.keys(a).length && keys.every((key) => a[key] === b[key]);
}

function sameLocale(a: LocaleFile, b: LocaleFile): boolean {
  return sameCatalog(a.messages, b.messages) && sameCatalog(a.sources, b.sources);
}

/**
 * Everything the plugin remembers between syncs: the source index, the compiled catalogues and the caches for files
 * read from disk. Files are cached by their stamp, so a locale or registry file edited outside the plugin is read again
 * on the next sync.
 */
export class IndexState {
  extractions = new Map<string, ExtractionCacheEntry>();
  /** ASTs parsed by the latest sync for files whose content changed. The transform hook consumes each once. */
  parsedSources = new Map<string, ParsedSource>();
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

  async writeLocale(file: string, content: LocaleFile): Promise<void> {
    if (await this.locales.holds(file, content, sameLocale)) return;
    return this.locales.write(file, content, () => writeLocaleFile(file, content));
  }

  readRegistry(file: string, warn: (message: string) => void): Promise<Registry> {
    return this.registries.read(file, () => loadRegistry(file, warn));
  }

  writeRegistry(file: string, registry: Registry): Promise<void> {
    return this.registries.write(file, registry, () => saveRegistry(file, registry));
  }
}
