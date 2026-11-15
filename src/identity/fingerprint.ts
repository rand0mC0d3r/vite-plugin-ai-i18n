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
 * Hashes the semantic context of a message into a stable 24-character hex ID. Filename, line number and component
 * position are deliberately excluded: context is semantic evidence, not a permanent identity by itself.
 */
export function createFingerprint(
  message: Pick<ExtractedMessage, "source" | "kind" | "tag" | "component" | "attribute" | "context">,
): string {
  // Component names and file paths are intentionally excluded: moving or renaming a
  // component should not invalidate the message identity when its semantic context stays stable.
  const material = [
    normalizeSource(message.source),
    message.kind,
    message.tag.toLowerCase(),
    message.attribute ?? "",
    message.context,
  ].join("\u001f");
  return createHash("sha256").update(material).digest("hex").slice(0, 24);
}
