import { randomUUID } from "node:crypto";
import type { ExtractedMessage, Registry, RegistryEntry, ResolvedMessage } from "../types.js";
import { readJsonFile, toJson, writeFileAtomic } from "../io.js";
import { registryEntrySchema, registryFileSchema } from "../schemas.js";

const emptyRegistry = (): Registry => ({ version: 1, entries: {} });

/**
 * Loads the registry. Invalid entries are dropped individually so the IDs of the valid ones stay stable;
 * a file with the wrong top-level shape is replaced by an empty registry.
 */
export async function loadRegistry(file: string, warn?: (message: string) => void): Promise<Registry> {
  const parsed = await readJsonFile<unknown>(file, null, warn);
  if (parsed === null) return emptyRegistry();
  const header = registryFileSchema.safeParse(parsed);
  if (!header.success) {
    warn?.(`autoi18n: ${file} has an unsupported format; message IDs will be regenerated.`);
    return emptyRegistry();
  }
  const entries: Record<string, RegistryEntry> = {};
  for (const [key, value] of Object.entries(header.data.entries)) {
    const entry = registryEntrySchema.safeParse(value);
    if (entry.success) entries[key] = entry.data;
    else warn?.(`autoi18n: dropped invalid registry entry "${key}" in ${file}.`);
  }
  return { version: 1, entries };
}

/** One ordering key for both old and new occurrences, so IDs follow the same position in each list. */
function orderKey(file: string, start: number): string {
  return `${file}:${String(start).padStart(12, "0")}`;
}

function locationKey(location: string): string {
  const split = location.lastIndexOf(":");
  return orderKey(location.slice(0, split), Number(location.slice(split + 1)));
}

export interface ReconcileResult {
  registry: Registry;
  /** Sources whose duplicate count changed; their IDs may have moved between occurrences. */
  ambiguous: string[];
  /** The input messages in their original order, each with the ID assigned to it. */
  messages: ResolvedMessage[];
}

export function reconcile(registry: Registry, messages: ExtractedMessage[]): ReconcileResult {
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

  const assigned = new Map<ExtractedMessage, string>();
  const seen = new Set<string>();
  const ambiguous: string[] = [];
  for (const [fingerprint, current] of incoming) {
    const previous = (groups.get(fingerprint) ?? []).filter(x => x.status === "active");
    // For repeated identical occurrences, preserve IDs by stable source ordering.
    // This survives line shifts and most edits, but deliberately cannot promise identity
    // when indistinguishable duplicates are reordered or independently moved.
    current.sort((a, b) => orderKey(a.file, a.start).localeCompare(orderKey(b.file, b.start)));
    previous.sort((a, b) => locationKey(a.location).localeCompare(locationKey(b.location)));
    if (current.length !== previous.length && (current.length > 1 || previous.length > 1)) {
      ambiguous.push(current[0].source);
    }
    for (let i = 0; i < current.length; i++) {
      const message = current[i];
      const candidate = previous[i];
      if (candidate) {
        assigned.set(message, candidate.id);
        candidate.status = "active";
        candidate.lastSeen = now;
        candidate.source = message.source;
        candidate.location = `${message.file}:${message.start}`;
        seen.add(candidate.id);
      } else {
        const id = `msg_${randomUUID().replaceAll("-", "").slice(0, 16)}`;
        assigned.set(message, id);
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
  const resolved = messages.map((message): ResolvedMessage => {
    const id = assigned.get(message);
    if (id === undefined) throw new Error(`autoi18n: no message ID was assigned to ${message.file}:${message.start}`);
    return { ...message, id };
  });
  return { registry, ambiguous, messages: resolved };
}

const MINUTE_MS = 60 * 1000;
/** 30 days. */
export const DEFAULT_ORPHAN_RETENTION_MINUTES = 30 * 24 * 60;

/**
 * Deletes orphaned entries that have not been seen in the source for longer than `retentionMinutes`.
 * `lastSeen` is only updated while an entry is active, so for orphans it marks when they disappeared.
 * Returns the removed entries.
 */
export function pruneOrphans(registry: Registry, retentionMinutes: number, now = Date.now()): RegistryEntry[] {
  const cutoff = now - retentionMinutes * MINUTE_MS;
  const removed: RegistryEntry[] = [];
  for (const [id, entry] of Object.entries(registry.entries)) {
    if (entry.status === "orphaned" && Date.parse(entry.lastSeen) <= cutoff) {
      delete registry.entries[id];
      removed.push(entry);
    }
  }
  return removed;
}

export async function saveRegistry(file: string, registry: Registry): Promise<void> {
  await writeFileAtomic(file, toJson(registry));
}
