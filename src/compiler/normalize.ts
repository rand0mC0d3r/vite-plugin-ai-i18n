/**
 * Collapses runs of whitespace to single spaces and trims the ends, so layout-only edits do not change a message's
 * identity.
 */
export function normalizeSource(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}
