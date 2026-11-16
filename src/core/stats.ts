import type { LocaleFile } from "../io/catalog.js";
import type { Registry, RegistryEntry } from "../types.js";

/** Translation progress for one locale, measured against the active registry entries. */
export interface LocaleStats {
  locale: string;
  /** Active messages that have a translation. */
  translated: number;
  /** Active messages in the registry. Same for every locale. */
  total: number;
  /** `translated / total` from 0 to 1. A project with no active messages counts as fully covered. */
  coverage: number;
  /** IDs of active messages with no translation yet. */
  missing: string[];
  /** IDs of translated active messages whose stored source differs from the current source, so they need re-translating. */
  outdated: string[];
  /** Keys in `messages` or `sources` that are no longer active. `autoi18n prune` removes these. */
  orphanedKeys: string[];
}

/** Registry-level counts and the orphaned entries that are waiting for pruning. */
export interface RegistryStats {
  total: number;
  active: number;
  orphaned: number;
  byComponent: Record<string, number>;
  /** Orphaned entries, least recently seen first. */
  orphans: RegistryEntry[];
}

/** The full statistics report. */
export interface StatsReport {
  registry: RegistryStats;
  /** One entry per locale file, sorted by locale. */
  locales: LocaleStats[];
  /** Mean coverage across locales, or `null` when there are no locale files. */
  averageCoverage: number | null;
}

const countBy = (values: string[]): Record<string, number> => {
  const counts: Record<string, number> = {};
  for (const value of values) counts[value] = (counts[value] ?? 0) + 1;
  return counts;
};

/**
 * Computes translation statistics from the registry and the locale files. `locales` maps a locale name to its parsed
 * file and must not include the source locale, because the source locale is not translated.
 */
export function computeStats(registry: Registry, locales: Record<string, LocaleFile>): StatsReport {
  const entries = Object.values(registry.entries);
  const active = entries.filter((entry) => entry.status === "active");
  const activeIds = new Set(active.map((entry) => entry.id));
  const orphans = entries
    .filter((entry) => entry.status === "orphaned")
    .sort((a, b) => a.lastSeen.localeCompare(b.lastSeen) || a.id.localeCompare(b.id));

  const localeStats: LocaleStats[] = Object.keys(locales)
    .sort((a, b) => a.localeCompare(b))
    .map((locale) => {
      const file = locales[locale];
      const missing = active.filter((entry) => !Object.hasOwn(file.messages, entry.id)).map((entry) => entry.id);
      const outdated = active
        .filter((entry) => Object.hasOwn(file.messages, entry.id) && file.sources[entry.id] !== entry.source)
        .map((entry) => entry.id);
      const orphanedKeys = [...new Set([...Object.keys(file.messages), ...Object.keys(file.sources)])].filter(
        (id) => !activeIds.has(id),
      );
      const total = active.length;
      const translated = total - missing.length;
      return {
        locale,
        translated,
        total,
        coverage: total === 0 ? 1 : translated / total,
        missing: missing.sort(),
        outdated: outdated.sort(),
        orphanedKeys: orphanedKeys.sort(),
      };
    });

  const averageCoverage =
    localeStats.length === 0 ? null : localeStats.reduce((sum, stats) => sum + stats.coverage, 0) / localeStats.length;

  return {
    registry: {
      total: entries.length,
      active: active.length,
      orphaned: orphans.length,
      byComponent: countBy(active.map((entry) => entry.component)),
      orphans,
    },
    locales: localeStats,
    averageCoverage,
  };
}
