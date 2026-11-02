import { createHash } from "node:crypto";
import type { ExtractedMessage } from "../types.js";

export function normalizeSource(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

// Deliberately excludes filename, line number and component position.
// Context is semantic evidence, not a permanent identity by itself.
export function createFingerprint(message: Pick<ExtractedMessage, "source" | "kind" | "tag" | "component" | "attribute" | "context">): string {
  // Component names and file paths are intentionally excluded: moving or renaming a
  // component should not invalidate the message identity when its semantic context stays stable.
  const material = [normalizeSource(message.source), message.kind, message.tag.toLowerCase(), message.attribute ?? "", message.context].join("\u001f");
  return createHash("sha256").update(material).digest("hex").slice(0, 24);
}
