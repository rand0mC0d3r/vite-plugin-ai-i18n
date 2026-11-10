import { describe, expect, it, vi } from "vitest";
import { buildCatalogs } from "./engine.js";
import { mapWithConcurrency } from "./concurrency.js";
import { PartialTranslationError } from "./errors.js";
import { reconcile } from "./identity/registry.js";
import type { ExtractedMessage, Registry, TranslationProvider } from "./types.js";

const message = (start: number, source = "Save", file = "App.tsx"): ExtractedMessage => ({
  source, kind: "text", file, start, end: start + source.length, tag: "button", component: "App", context: "", fingerprint: `fp-${source}`
});

const emptyRegistry = (): Registry => ({ version: 1, entries: {} });

const baseInput = {
  registry: emptyRegistry(),
  orphanRetentionMinutes: 30 * 24 * 60,
  sourceLocale: "en",
  localeConcurrency: 2,
  previous: new Map(),
  debug: false
};

describe("buildCatalogs", () => {
  it("builds the source catalogue and translates every requested locale", async () => {
    const provider: TranslationProvider = {
      translate: vi.fn(async ({ targetLocale, messages }) => Object.fromEntries(messages.map(m => [m.id, `${targetLocale}:${m.source}`])))
    };
    const result = await buildCatalogs({
      ...baseInput,
      files: [{ file: "App.tsx", messages: [message(1, "Save"), message(20, "Cancel")] }],
      locales: ["de", "fr"],
      provider
    });
    const [saveId, cancelId] = result.messages.map(m => m.id);
    expect(result.sourceFile.messages).toEqual({ [saveId]: "Save", [cancelId]: "Cancel" });
    expect(result.locales.get("de")?.file.messages).toEqual({ [saveId]: "de:Save", [cancelId]: "de:Cancel" });
    expect(result.locales.get("fr")?.file.messages).toEqual({ [saveId]: "fr:Save", [cancelId]: "fr:Cancel" });
    expect(result.failures.size).toBe(0);
    expect(result.registry.entries[saveId]).toMatchObject({ source: "Save", status: "active" });
  });

  it("does not mutate the registry it is given", async () => {
    const registry = emptyRegistry();
    await buildCatalogs({ ...baseInput, registry, files: [{ file: "App.tsx", messages: [message(1)] }], locales: [] });
    expect(registry.entries).toEqual({});
  });

  it("keeps the previous file for a locale whose translation threw and reports the error", async () => {
    const error = new Error("quota exceeded");
    const provider: TranslationProvider = {
      translate: vi.fn(async ({ targetLocale }) => {
        if (targetLocale === "fr") throw error;
        return {};
      })
    };
    const result = await buildCatalogs({
      ...baseInput,
      files: [{ file: "App.tsx", messages: [message(1)] }],
      locales: ["de", "fr"],
      provider
    });
    expect(result.locales.has("de")).toBe(true);
    expect(result.locales.has("fr")).toBe(false);
    expect(result.failures.get("fr")).toBe(error);
  });

  it("uses the previous locale file when one exists and does not translate messages already stored", async () => {
    const provider: TranslationProvider = { translate: vi.fn(async () => ({})) };
    const first = await buildCatalogs({ ...baseInput, files: [{ file: "App.tsx", messages: [message(1)] }], locales: ["de"], provider });
    const id = first.messages[0].id;
    const previous = new Map([["de", { messages: { [id]: "Speichern" }, sources: { [id]: "Save" } }]]);
    const second = await buildCatalogs({ ...baseInput, registry: first.registry, files: [{ file: "App.tsx", messages: [message(1)] }], locales: ["de"], provider, previous });
    expect(provider.translate).toHaveBeenCalledTimes(1);
    expect(second.locales.get("de")?.file.messages).toEqual({ [id]: "Speichern" });
  });

  it("returns ambiguous sources and pruned orphans from the registry reconciliation", async () => {
    const first = reconcile(emptyRegistry(), [message(1), message(50), message(90, "Other")]);
    const result = await buildCatalogs({
      ...baseInput,
      registry: first.registry,
      orphanRetentionMinutes: 0,
      files: [{ file: "App.tsx", messages: [message(1)] }],
      locales: []
    });
    expect(result.ambiguous).toEqual(["Save"]);
    // The second "Save" occurrence and "Other" are both gone from the source, and retention is 0.
    expect(result.pruned.map(e => e.source)).toEqual(["Save", "Other"]);
    expect(result.locales.size).toBe(0);
  });

  it("returns the translation messages in the order the files were given", async () => {
    const result = await buildCatalogs({
      ...baseInput,
      files: [
        { file: "A.tsx", messages: [message(1, "First", "A.tsx")] },
        { file: "B.tsx", messages: [message(1, "Second", "B.tsx")] }
      ],
      locales: []
    });
    expect(result.messages.map(m => [m.file, m.source])).toEqual([["A.tsx", "First"], ["B.tsx", "Second"]]);
  });

  it("keeps partial translations from a locale whose batches partly failed", async () => {
    const provider: TranslationProvider = {
      translate: vi.fn(async ({ messages }) => {
        throw new PartialTranslationError("1 messages failed", { [messages[0].id]: "Speichern" }, 1);
      })
    };
    const result = await buildCatalogs({ ...baseInput, files: [{ file: "App.tsx", messages: [message(1)] }], locales: ["de"], provider });
    expect(result.locales.get("de")).toMatchObject({ failed: 1, file: { messages: { [result.messages[0].id]: "Speichern" } } });
  });
});

describe("mapWithConcurrency", () => {
  it("runs at most the given number of tasks at once", async () => {
    let active = 0;
    let peak = 0;
    const results = await mapWithConcurrency([1, 2, 3, 4, 5], 2, async n => {
      active++;
      peak = Math.max(peak, active);
      await new Promise(resolve => setTimeout(resolve, 5));
      active--;
      return n * 10;
    });
    expect(peak).toBe(2);
    expect(results.map(r => r.status === "fulfilled" && r.value)).toEqual([10, 20, 30, 40, 50]);
  });

  it("keeps going after a failure and reports it as rejected in place", async () => {
    const results = await mapWithConcurrency(["a", "b", "c"], 1, async item => {
      if (item === "b") throw new Error("nope");
      return item.toUpperCase();
    });
    expect(results[0]).toEqual({ status: "fulfilled", value: "A" });
    expect(results[1]).toMatchObject({ status: "rejected" });
    expect(results[2]).toEqual({ status: "fulfilled", value: "C" });
  });

  it("returns an empty result for no items and treats a non-positive limit as one", async () => {
    expect(await mapWithConcurrency([], 4, async () => 1)).toEqual([]);
    const task = vi.fn(async (n: number) => n);
    expect(await mapWithConcurrency([1, 2], 0, task)).toEqual([
      { status: "fulfilled", value: 1 },
      { status: "fulfilled", value: 2 }
    ]);
  });
});
