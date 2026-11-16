import { createHash } from "node:crypto";

import { normalizeSource } from "../compiler/normalize.js";
import type { ExtractedMessage } from "../types.js";

/**
 * Hashes a message's normalized source text into a stable 24-character hex ID. Component, file and position are
 * deliberately excluded, so moving or renaming code does not change the identity of its copy.
 */
export function createFingerprint(message: Pick<ExtractedMessage, "source">): string {
  return createHash("sha256").update(normalizeSource(message.source)).digest("hex").slice(0, 24);
}
