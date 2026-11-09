import type { Catalog } from "./types.js";

/**
 * Some batches of a translation request failed while others succeeded. `partial` holds the translations
 * that did come back, so the caller can keep them and report the rest.
 */
export class PartialTranslationError extends Error {
  constructor(message: string, readonly partial: Catalog, readonly failed: number) {
    super(message);
    this.name = "PartialTranslationError";
  }
}
