import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { ExtractedMessage, Registry, RegistryEntry } from "../types.js";

const emptyRegistry = (): Registry => ({ version: 1, entries: {} });

export async function loadRegistry(file: string): Promise<Registry> {
  try {
    const parsed = JSON.parse(await readFile(file, "utf8")) as Registry;
    if (parsed.version !== 1 || !parsed.entries) return emptyRegistry();
    return parsed;
  } catch { return emptyRegistry(); }
}

export function reconcile(registry: Registry, messages: ExtractedMessage[]): Registry {
  const now = new Date().toISOString();
  const oldEntries = Object.values(registry.entries);
  const groups = new Map<string, RegistryEntry[]>();
  for (const entry of oldEntries) {
    const list = groups.get(entry.fingerprint) ?? [];
    list.push(entry);
    groups.set(entry.fingerprint, list);
  }
  const incoming = new Map<string, ExtractedMessage[]>();
  for (const message of messages) {
    const list = incoming.get(message.fingerprint) ?? [];
    list.push(message);
    incoming.set(message.fingerprint, list);
  }

  const seen = new Set<string>();
  for (const [fingerprint, current] of incoming) {
    const previous = (groups.get(fingerprint) ?? []).filter(x => x.status === "active");
    // For repeated identical occurrences, preserve IDs by stable source ordering.
    // This survives line shifts and most edits, but deliberately cannot promise identity
    // when indistinguishable duplicates are reordered or independently moved.
    current.sort((a, b) => `${a.file}:${String(a.start).padStart(12, "0")}`.localeCompare(`${b.file}:${String(b.start).padStart(12, "0")}`));
    previous.sort((a, b) => a.location.localeCompare(b.location));
    for (let i = 0; i < current.length; i++) {
      const message = current[i];
      const candidate = previous[i];
      if (candidate) {
        message.id = candidate.id;
        candidate.status = "active";
        candidate.lastSeen = now;
        candidate.source = message.source;
        candidate.location = `${message.file}:${message.start}`;
        seen.add(candidate.id);
      } else {
        const id = `msg_${randomUUID().replaceAll("-", "").slice(0, 16)}`;
        message.id = id;
        registry.entries[id] = {
          id, source: message.source, kind: message.kind, tag: message.tag,
          component: message.component, attribute: message.attribute,
          context: message.context, fingerprint: message.fingerprint,
          location: `${message.file}:${message.start}`,
          status: "active", firstSeen: now, lastSeen: now
        };
        seen.add(id);
      }
    }
  }
  for (const entry of Object.values(registry.entries)) if (!seen.has(entry.id)) entry.status = "orphaned";
  return registry;
}

export async function saveRegistry(file: string, registry: Registry): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  const temp = `${file}.tmp`;
  await writeFile(temp, JSON.stringify(registry, null, 2) + "\n", "utf8");
  const { rename } = await import("node:fs/promises");
  await rename(temp, file);
}
