/**
 * Splits a translated sentence at its {name} placeholders so values keep their React nodes; unknown names stay literal.
 * Serialised into the runtime module via toString(), so it must not reference anything outside its body.
 */
export function formatPlaceholders(text: string, values: Record<string, unknown>, placeholder: RegExp): unknown[] {
  const parts: unknown[] = [];
  let last = 0;
  for (const match of text.matchAll(placeholder)) {
    if (!Object.hasOwn(values, match[1])) continue;
    const index = match.index ?? 0;
    if (index > last) parts.push(text.slice(last, index));
    parts.push(values[match[1]]);
    last = index + match[0].length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts;
}
