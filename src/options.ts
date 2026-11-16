import { ArkErrors } from "arktype";

import { optionsSchema } from "./schemas.js";
import type { ProviderConfig } from "./types.js";

export interface AutoI18nOptions {
  locales: string[];
  sourceLocale?: string;
  /**
   * "build" (default) compiles one locale per build. "runtime" ships every catalogue and switches locale in the browser
   * via `setLocale()` from the `virtual:autoi18n` module.
   */
  delivery?: "build" | "runtime";
  /** Compile this build for one locale. Defaults to sourceLocale; set AUTOI18N_LOCALE for CI matrix builds. */
  locale?: string;
  include?: string[];
  exclude?: string[];
  directory?: string;
  /**
   * One provider, or named providers such as `{ primary: "anthropic", anthropic, openai }`. The primary is tried first;
   * when it fails, messages it did not translate go to the next configured provider.
   */
  provider?: ProviderConfig;
  failOnMissingProvider?: boolean;
  onAmbiguous?: "warn" | "error";
  /**
   * Minutes an orphaned message (one no longer in the source) is kept in the registry before it is deleted. Default
   * 43200 (30 days). `0` deletes orphans on the next build; `Infinity` keeps them forever.
   */
  orphanRetentionMinutes?: number;
  /**
   * Locales translated at the same time. Default 2. The provider's `concurrency` option caps the batches in flight
   * across all locales, so the total number of parallel requests does not multiply with this value.
   */
  localeConcurrency?: number;
  /** Log each message sent to the translation provider and each translation received, with timestamps. Default false. */
  debug?: boolean;
}

/** Throws a single error listing every invalid option, so a misconfigured plugin fails at startup. */
export function validateOptions(options: unknown): void {
  const result = optionsSchema(options);
  if (!(result instanceof ArkErrors)) return;
  const details = result.map((issue) => `${issue.path.join(".") || "options"}: ${issue.message}`).join("; ");
  throw new Error(`autoi18n: invalid options (${details}).`);
}
