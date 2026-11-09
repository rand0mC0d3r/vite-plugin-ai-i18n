import path from "node:path";
import { readJsonFile, toJson, writeFileAtomic } from "./io.js";
import type { Catalog } from "./types.js";

/**
 * One locale's file on disk (`locales/<locale>.json`). `messages` is what the runtime and build read,
 * and `sources` records the source text each translation was made from, so a changed source is re-translated.
 */
export interface LocaleFile {
  messages: Catalog;
  sources: Catalog;
}

export const emptyLocaleFile = (): LocaleFile => ({ messages: {}, sources: {} });

export function localeFilePath(outDir: string, locale: string): string {
  return path.join(outDir, `${locale}.json`);
}

/** A file without the `messages`/`sources` wrapper (the pre-merge format) is treated as empty and rebuilt. */
export async function readLocaleFile(file: string, warn?: (message: string) => void): Promise<LocaleFile> {
  const parsed = await readJsonFile<Partial<LocaleFile> | null>(file, null, warn);
  if (!parsed || typeof parsed.messages !== "object" || typeof parsed.sources !== "object") return emptyLocaleFile();
  return { messages: parsed.messages, sources: parsed.sources };
}

export const writeLocaleFile = (file: string, content: LocaleFile): Promise<void> => writeFileAtomic(file, toJson(content));

/** Returns a copy of `catalog` that keeps only `keep`, plus the keys that were dropped. */
export function pruneCatalog(catalog: Catalog, keep: ReadonlySet<string>): { catalog: Catalog; removed: string[] } {
  const kept: Catalog = {};
  const removed: string[] = [];
  for (const [id, text] of Object.entries(catalog)) {
    if (keep.has(id)) kept[id] = text;
    else removed.push(id);
  }
  return { catalog: kept, removed };
}
