import { PartialTranslationError } from "../errors.js";
import type { Catalog, ProviderConfig, TranslationProvider, TranslationRequest } from "../types.js";

interface NamedProvider { name: string; provider: TranslationProvider }

/**
 * Tries providers in order. Messages a provider did not translate (a failed request, or a partial result) are sent
 * to the next provider. Throws only when nothing could be translated, or a PartialTranslationError when some messages
 * are still missing after every provider has been tried.
 */
export class FallbackProvider implements TranslationProvider {
  constructor(
    private readonly providers: NamedProvider[],
    private readonly onFallback: (message: string) => void = () => {}
  ) {}

  async translate(input: { sourceLocale: string; targetLocale: string; messages: TranslationRequest[] }): Promise<Catalog> {
    const result: Catalog = {};
    let remaining = input.messages;
    let firstError: unknown;
    let lastError: unknown;

    for (const [index, { name, provider }] of this.providers.entries()) {
      try {
        Object.assign(result, await provider.translate({ ...input, messages: remaining }));
      } catch (error) {
        firstError ??= error;
        lastError = error;
        if (error instanceof PartialTranslationError) Object.assign(result, error.partial);
        const next = this.providers[index + 1];
        if (next && remaining.some(m => result[m.id] === undefined)) this.onFallback(`${name} failed (${errorMessage(error)}); sending the rest to ${next.name}.`);
      }
      remaining = remaining.filter(m => result[m.id] === undefined);
      if (!remaining.length) return result;
    }

    if (Object.keys(result).length === 0) throw firstError;
    throw new PartialTranslationError(`${remaining.length} messages failed to translate: ${errorMessage(lastError)}`, result, remaining.length);
  }
}

const errorMessage = (error: unknown): string => (error instanceof Error ? error.message : String(error));

const isProvider = (value: unknown): value is TranslationProvider =>
  typeof value === "object" && value !== null && typeof (value as TranslationProvider).translate === "function";

/**
 * Normalizes the `provider` option to one provider. Returns undefined when no provider is configured.
 */
export function resolveProvider(config: ProviderConfig | undefined, onFallback?: (message: string) => void): TranslationProvider | undefined {
  if (config === undefined) return undefined;
  if (isProvider(config)) return config;

  const { primary, ...entries } = config;
  const named: NamedProvider[] = [];
  for (const [name, value] of Object.entries(entries)) {
    if (value === undefined) continue;
    if (!isProvider(value)) throw new Error(`autoi18n: provider "${name}" must be an object with a translate(input) method.`);
    named.push({ name, provider: value });
  }
  if (primary !== undefined) {
    const index = named.findIndex(entry => entry.name === primary);
    if (index < 0) throw new Error(`autoi18n: primary provider "${primary}" is not configured.`);
    named.unshift(...named.splice(index, 1));
  }

  if (named.length === 0) return undefined;
  if (named.length === 1) return named[0].provider;
  return new FallbackProvider(named, onFallback);
}
