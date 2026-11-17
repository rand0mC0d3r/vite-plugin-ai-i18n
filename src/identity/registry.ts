import { randomUUID } from "node:crypto";

import type { ExtractedMessage, Registry, RegistryEntry, ResolvedMessage } from "../types.js";

/** Milliseconds in one minute. Converts `orphanRetentionMinutes` to a timestamp offset. */
const MINUTE_MS = 60 * 1000;
/** 30 days. */
export const DEFAULT_ORPHAN_RETENTION_MINUTES = 30 * 24 * 60;

/** A registry with no entries, used when no usable file exists yet. */
export const emptyRegistry = (): Registry => ({ version: 1, entries: {} });

/** One ordering key for both old and new occurrences, so IDs follow the same position in each list. */
function orderKey(file: string, start: number): string {
  return `${file}:${String(start).padStart(12, "0")}`;
}

/** Converts a stored `file:start` location into the same ordering key that {@link orderKey} produces. */
function locationKey(location: string): string {
  const split = location.lastIndexOf(":");
  return orderKey(location.slice(0, split), Number(location.slice(split + 1)));
}

/** Outcome of matching freshly extracted messages against the stored registry. */
export interface ReconcileResult {
  /** The updated registry, mutated in place. Entries not seen this time are marked `orphaned`. */
  registry: Registry;
  /** Sources whose duplicate count changed; their IDs may have moved between occurrences. */
  ambiguous: string[];
  /** The input messages in their original order, each with the ID assigned to it. */
  messages: ResolvedMessage[];
}

/**
 * Assigns a stable ID to every extracted message by matching it against the registry.
 *
 * Messages are grouped by fingerprint. Within a group, old and new occurrences are paired first by component name, then
 * by position. Unmatched messages get a fresh `msg_` ID. Stored entries that match nothing become `orphaned`, and
 * matched entries are reactivated and have their source, component and location refreshed.
 *
 * @param registry Current registry. It is mutated in place.
 * @param messages Messages extracted from the current source.
 * @returns The updated registry, the ambiguous sources, and the messages with their assigned IDs.
 */
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
    const previous = (groups.get(fingerprint) ?? []).filter((x) => x.status === "active");
    // For repeated identical occurrences, preserve IDs by stable source ordering.
    // This survives line shifts and most edits, but deliberately cannot promise identity
    // when indistinguishable duplicates are reordered or independently moved.
    current.sort((a, b) => orderKey(a.file, a.start).localeCompare(orderKey(b.file, b.start)));
    previous.sort((a, b) => locationKey(a.location).localeCompare(locationKey(b.location)));
    if (current.length !== previous.length && (current.length > 1 || previous.length > 1)) {
      ambiguous.push(current[0].source);
    }
    // Pair by component first, so a renamed or reordered component keeps its IDs; the rest pair by position.
    // Queues keep the sorted order of `previous`, so shifting from one yields the same first untaken match as a scan.
    const pairs = new Array<RegistryEntry | undefined>(current.length);
    const taken = new Set<RegistryEntry>();
    const byComponent = new Map<string, RegistryEntry[]>();
    for (const entry of previous) {
      const queue = byComponent.get(entry.component) ?? [];
      queue.push(entry);
      byComponent.set(entry.component, queue);
    }
    current.forEach((message, index) => {
      const match = byComponent.get(message.component)?.shift();
      if (match) {
        pairs[index] = match;
        taken.add(match);
      }
    });
    const leftovers = previous.filter((p) => !taken.has(p));
    let next = 0;
    current.forEach((_, index) => {
      if (pairs[index] === undefined && next < leftovers.length) pairs[index] = leftovers[next++];
    });
    for (const [index, message] of current.entries()) {
      const candidate = pairs[index];
      if (candidate) {
        assigned.set(message, candidate.id);
        candidate.status = "active";
        candidate.lastSeen = now;
        candidate.source = message.source;
        candidate.component = message.component;
        candidate.autoPlural = message.autoPlural;
        candidate.location = `${message.file}:${message.start}`;
        seen.add(candidate.id);
      } else {
        const id = `msg_${randomUUID().replaceAll("-", "").slice(0, 16)}`;
        assigned.set(message, id);
        registry.entries[id] = {
          id,
          source: message.source,
          component: message.component,
          fingerprint: message.fingerprint,
          autoPlural: message.autoPlural,
          location: `${message.file}:${message.start}`,
          status: "active",
          firstSeen: now,
          lastSeen: now,
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

/**
 * Deletes orphaned entries that have not been seen in the source for longer than `retentionMinutes`. `lastSeen` is only
 * updated while an entry is active, so for orphans it marks when they disappeared. Returns the removed entries.
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
