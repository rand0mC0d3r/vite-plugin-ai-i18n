import path from "node:path";
import { readJsonFile, toJson, writeFileAtomic } from "./io.js";
import { localeFileSchema } from "./schemas.js";
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

const stringValues = (record: Record<string, unknown>, warn?: (message: string) => void, file?: string): Catalog => {
  const catalog: Catalog = {};
  for (const [id, value] of Object.entries(record)) {
    if (typeof value === "string") catalog[id] = value;
    else warn?.(`autoi18n: dropped non-text value for "${id}" in ${file}.`);
  }
  return catalog;
};

/**
 * A file without the `messages`/`sources` wrapper (the pre-merge format) is treated as empty and rebuilt.
 * Non-string values inside a valid wrapper are dropped, so they are translated again.
 */
export async function readLocaleFile(file: string, warn?: (message: string) => void): Promise<LocaleFile> {
  const parsed = await readJsonFile<unknown>(file, null, warn);
  const result = localeFileSchema.safeParse(parsed);
  if (!result.success) return emptyLocaleFile();
  return { messages: stringValues(result.data.messages, warn, file), sources: stringValues(result.data.sources, warn, file) };
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
