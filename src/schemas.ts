import * as v from "valibot";
import type { ProviderConfig } from "./types.js";

// Node-side validation only. Nothing here may be imported by the runtime module, which is embedded via toString().

/** Shape of an OpenAI-compatible chat completion response. It must contain at least one choice. */
export const chatCompletionSchema = v.object({
  choices: v.pipe(v.array(v.object({ message: v.object({ content: v.nullish(v.string()) }) })), v.minLength(1))
});

/** Shape of an Anthropic Messages API response. Only text blocks carry translations. */
export const anthropicMessageSchema = v.object({
  content: v.array(v.object({ type: v.string(), text: v.optional(v.string()) }))
});

/** Shape of a Gemini `generateContent` response. Each candidate's text parts hold the reply. */
export const geminiResponseSchema = v.object({
  candidates: v.array(v.object({ content: v.optional(v.object({ parts: v.optional(v.array(v.object({ text: v.optional(v.string()) }))) })) }))
});

// The model's reply must be a JSON object; individual values are checked per ID by the caller.
/** Validates a model reply as an object keyed by message ID. */
export const translationMapSchema = v.record(v.string(), v.unknown());

/** Validates a locale file (`messages` and `sources` maps) read from disk. */
export const localeFileSchema = v.object({ messages: v.record(v.string(), v.unknown()), sources: v.record(v.string(), v.unknown()) });

/** Validates a registry entry read from `registry.json`. */
export const registryEntrySchema = v.object({
  id: v.string(),
  source: v.string(),
  kind: v.picklist(["text", "attribute", "mixed", "string"]),
  tag: v.string(),
  component: v.string(),
  attribute: v.optional(v.string()),
  context: v.string(),
  fingerprint: v.string(),
  location: v.string(),
  status: v.picklist(["active", "orphaned"]),
  firstSeen: v.string(),
  lastSeen: v.string()
});

/** Validates the top level of `registry.json`. Entries are checked one at a time when they are loaded. */
export const registryFileSchema = v.object({ version: v.literal(1), entries: v.record(v.string(), v.unknown()) });

/** A string that is not empty, used for option values where `""` would be a mistake. */
const nonEmptyString = v.pipe(v.string(), v.minLength(1));

/** Validates the plugin options. `validateOptions` in `index.ts` runs it at startup and reports every failure at once. */
export const optionsSchema = v.object({
  locales: v.array(nonEmptyString),
  sourceLocale: v.optional(nonEmptyString),
  delivery: v.optional(v.picklist(["build", "runtime"])),
  locale: v.optional(nonEmptyString),
  include: v.optional(v.array(v.string())),
  exclude: v.optional(v.array(v.string())),
  directory: v.optional(nonEmptyString),
  provider: v.optional(v.custom<ProviderConfig>(value => value === undefined || (typeof value === "object" && value !== null))),
  failOnMissingProvider: v.optional(v.boolean()),
  onAmbiguous: v.optional(v.picklist(["warn", "error"])),
  orphanRetentionMinutes: v.optional(v.union([v.pipe(v.number(), v.minValue(0)), v.literal(Infinity)])),
  localeConcurrency: v.optional(v.pipe(v.number(), v.minValue(1))),
  componentProps: v.optional(v.record(v.string(), v.array(v.string()))),
  stringMarker: v.optional(nonEmptyString),
  debug: v.optional(v.boolean())
});
