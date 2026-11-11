import { z } from "zod";
import type { TranslationProvider } from "./types.js";

// Node-side validation only. Nothing here may be imported by the runtime module, which is embedded via toString().

export const chatCompletionSchema = z.object({
  choices: z.array(z.object({ message: z.object({ content: z.string().nullish() }) })).min(1)
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
  attribute: z.string().optional(),
  context: z.string(),
  fingerprint: z.string(),
  location: z.string(),
  status: z.enum(["active", "orphaned"]),
  firstSeen: z.string(),
  lastSeen: z.string()
});

export const registryFileSchema = z.object({ version: z.literal(1), entries: z.record(z.string(), z.unknown()) });

export const optionsSchema = z.object({
  locales: z.array(z.string().min(1)),
  sourceLocale: z.string().min(1).optional(),
  delivery: z.enum(["build", "runtime"]).optional(),
  locale: z.string().min(1).optional(),
  include: z.array(z.string()).optional(),
  exclude: z.array(z.string()).optional(),
  directory: z.string().min(1).optional(),
  provider: z.custom<TranslationProvider>(value => value === undefined || (typeof value === "object" && value !== null && typeof (value as TranslationProvider).translate === "function")).optional(),
  failOnMissingProvider: z.boolean().optional(),
  onAmbiguous: z.enum(["warn", "error"]).optional(),
  orphanRetentionMinutes: z.union([z.number().min(0), z.literal(Infinity)]).optional(),
  localeConcurrency: z.number().min(1).optional(),
  componentProps: z.record(z.string(), z.array(z.string())).optional(),
  debug: z.boolean().optional()
});
