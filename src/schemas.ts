import * as v from "valibot";
import type { ProviderConfig } from "./types.js";

// Node-side validation only. Nothing here may be imported by the runtime module, which is embedded via toString().

export const chatCompletionSchema = v.object({
  choices: v.pipe(v.array(v.object({ message: v.object({ content: v.nullish(v.string()) }) })), v.minLength(1))
});

export const anthropicMessageSchema = v.object({
  content: v.array(v.object({ type: v.string(), text: v.optional(v.string()) }))
});

export const geminiResponseSchema = v.object({
  candidates: v.array(v.object({ content: v.optional(v.object({ parts: v.optional(v.array(v.object({ text: v.optional(v.string()) }))) })) }))
});

// The model's reply must be a JSON object; individual values are checked per ID by the caller.
export const translationMapSchema = v.record(v.string(), v.unknown());

export const localeFileSchema = v.object({ messages: v.record(v.string(), v.unknown()), sources: v.record(v.string(), v.unknown()) });

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

export const registryFileSchema = v.object({ version: v.literal(1), entries: v.record(v.string(), v.unknown()) });

const nonEmptyString = v.pipe(v.string(), v.minLength(1));

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
