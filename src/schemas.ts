import * as z from "zod/mini";
import type { ProviderConfig } from "./types.js";

// Node-side validation only. Nothing here may be imported by the runtime module, which is embedded via toString().

export const chatCompletionSchema = z.object({
  choices: z.array(z.object({ message: z.object({ content: z.nullish(z.string()) }) })).check(z.minLength(1))
});

export const anthropicMessageSchema = z.object({
  content: z.array(z.object({ type: z.string(), text: z.optional(z.string()) }))
});

export const geminiResponseSchema = z.object({
  candidates: z.array(z.object({ content: z.optional(z.object({ parts: z.optional(z.array(z.object({ text: z.optional(z.string()) }))) })) }))
});

// The model's reply must be a JSON object; individual values are checked per ID by the caller.
export const translationMapSchema = z.record(z.string(), z.unknown());

export const localeFileSchema = z.object({ messages: z.record(z.string(), z.unknown()), sources: z.record(z.string(), z.unknown()) });

export const registryEntrySchema = z.object({
  id: z.string(),
  source: z.string(),
  kind: z.enum(["text", "attribute", "mixed", "string"]),
  tag: z.string(),
  component: z.string(),
  attribute: z.optional(z.string()),
  context: z.string(),
  fingerprint: z.string(),
  location: z.string(),
  status: z.enum(["active", "orphaned"]),
  firstSeen: z.string(),
  lastSeen: z.string()
});

export const registryFileSchema = z.object({ version: z.literal(1), entries: z.record(z.string(), z.unknown()) });

const nonEmptyString = z.string().check(z.minLength(1));

export const optionsSchema = z.object({
  locales: z.array(nonEmptyString),
  sourceLocale: z.optional(nonEmptyString),
  delivery: z.optional(z.enum(["build", "runtime"])),
  locale: z.optional(nonEmptyString),
  include: z.optional(z.array(z.string())),
  exclude: z.optional(z.array(z.string())),
  directory: z.optional(nonEmptyString),
  provider: z.optional(z.custom<ProviderConfig>(value => value === undefined || (typeof value === "object" && value !== null))),
  failOnMissingProvider: z.optional(z.boolean()),
  onAmbiguous: z.optional(z.enum(["warn", "error"])),
  orphanRetentionMinutes: z.optional(z.union([z.number().check(z.minimum(0)), z.literal(Infinity)])),
  localeConcurrency: z.optional(z.number().check(z.minimum(1))),
  componentProps: z.optional(z.record(z.string(), z.array(z.string()))),
  debug: z.optional(z.boolean())
});
