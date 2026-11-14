import { type } from "arktype";

// Node-side validation only. Nothing here may be imported by the runtime module, which is embedded via toString().

/** Shape of an OpenAI-compatible chat completion response. It must contain at least one choice. */
export const chatCompletionSchema = type({
  choices: type({ message: { "content?": "string | null" } }).array().atLeastLength(1)
});

/** Shape of an Anthropic Messages API response. Only text blocks carry translations. */
export const anthropicMessageSchema = type({
  content: type({ type: "string", "text?": "string" }).array()
});

/** Shape of a Gemini `generateContent` response. Each candidate's text parts hold the reply. */
export const geminiResponseSchema = type({
  candidates: type({ "content?": { "parts?": type({ "text?": "string" }).array() } }).array()
});

// The model's reply must be a JSON object; individual values are checked per ID by the caller.
/** Validates a model reply as an object keyed by message ID. */
export const translationMapSchema = type("Record<string, unknown>");

/** Validates a locale file (`messages` and `sources` maps) read from disk. */
export const localeFileSchema = type({ messages: "Record<string, unknown>", sources: "Record<string, unknown>" });

/** Validates a registry entry read from `registry.json`. Keys not listed here are dropped from the result. */
export const registryEntrySchema = type({
  id: "string",
  source: "string",
  kind: "'text' | 'attribute' | 'mixed' | 'string'",
  tag: "string",
  component: "string",
  "attribute?": "string",
  context: "string",
  fingerprint: "string",
  location: "string",
  status: "'active' | 'orphaned'",
  firstSeen: "string",
  lastSeen: "string"
}).onUndeclaredKey("delete");

/** Validates the top level of `registry.json`. Entries are checked one at a time when they are loaded. */
export const registryFileSchema = type({ version: "1", entries: "Record<string, unknown>" });

/** A string that is not empty, used for option values where `""` would be a mistake. */
const nonEmptyString = type("string >= 1");

/**
 * Validates the plugin options. `validateOptions` in `index.ts` runs it at startup and reports every failure at once.
 * Optional keys also accept `undefined`, so options set from possibly-unset environment variables are allowed.
 */
export const optionsSchema = type({
  locales: nonEmptyString.array(),
  "sourceLocale?": nonEmptyString.or("undefined"),
  "delivery?": "'build' | 'runtime' | undefined",
  "locale?": nonEmptyString.or("undefined"),
  "include?": "string[] | undefined",
  "exclude?": "string[] | undefined",
  "directory?": nonEmptyString.or("undefined"),
  "provider?": "object | undefined",
  "failOnMissingProvider?": "boolean | undefined",
  "onAmbiguous?": "'warn' | 'error' | undefined",
  "orphanRetentionMinutes?": type("number >= 0").or(type.unit(Infinity)).or("undefined"),
  "localeConcurrency?": "number >= 1 | undefined",
  "componentProps?": "Record<string, string[]> | undefined",
  "stringMarker?": nonEmptyString.or("undefined"),
  "debug?": "boolean | undefined"
});
