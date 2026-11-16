import { createHash } from "node:crypto";

import type { ExtractedMessage } from "../types.js";

/**
 * Collapses runs of whitespace to single spaces and trims the ends, so layout-only edits do not change a message's
 * identity.
 */
export function normalizeSource(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

/**
 * Hashes a message's normalized source text into a stable 24-character hex ID. Component, file and position are
 * deliberately excluded, so moving or renaming code does not change the identity of its copy.
 */
export function createFingerprint(message: Pick<ExtractedMessage, "source">): string {
  return createHash("sha256").update(normalizeSource(message.source)).digest("hex").slice(0, 24);
}
