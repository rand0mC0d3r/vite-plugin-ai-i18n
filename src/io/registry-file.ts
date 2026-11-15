import { ArkErrors } from "arktype";

import { emptyRegistry } from "../identity/registry.js";
import { readJsonFile, toJson, writeFileIfChanged } from "../io/files.js";
import { registryEntrySchema, registryFileSchema } from "../schemas.js";
import type { Registry, RegistryEntry } from "../types.js";

/**
 * Loads the registry. Invalid entries are dropped individually so the IDs of the valid ones stay stable; a file with
 * the wrong top-level shape is replaced by an empty registry.
 */
export async function loadRegistry(file: string, warn?: (message: string) => void): Promise<Registry> {
  const parsed = await readJsonFile<unknown>(file, null, warn);
  if (parsed === null) return emptyRegistry();
  const header = registryFileSchema(parsed);
  if (header instanceof ArkErrors) {
    warn?.(`autoi18n: ${file} has an unsupported format; message IDs will be regenerated.`);
    return emptyRegistry();
  }
  const entries: Record<string, RegistryEntry> = {};
  for (const [key, value] of Object.entries(header.entries)) {
    const entry = registryEntrySchema(value);
    if (!(entry instanceof ArkErrors)) entries[key] = entry;
    else warn?.(`autoi18n: dropped invalid registry entry "${key}" in ${file}.`);
  }
  return { version: 1, entries };
}

/** Writes the registry to `file`, skipping the write when the content has not changed. */
export async function saveRegistry(file: string, registry: Registry): Promise<void> {
  await writeFileIfChanged(file, toJson(registry));
}
