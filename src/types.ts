/** A `t("...")` string found in a source file, before it has an ID. */
export interface ExtractedMessage {
  /** The source text. */
  source: string;
  /** Source file the message was found in. */
  file: string;
  /** Character offsets of the `t("...")` call in the file. */
  start: number;
  end: number;
  /** Enclosing component name. Used with `fingerprint` to match a message to its registry entry. */
  component: string;
  /** Hash of the normalized source, used to match registry entries. */
  fingerprint: string;
}
/** A message with the stable ID that the registry assigned to it. */
export type ResolvedMessage = ExtractedMessage & { id: string };
/** One message remembered in the registry. Entries are kept across builds so stable IDs survive edits. */
export type RegistryEntry = Pick<ExtractedMessage, "source" | "component" | "fingerprint"> & {
  id: string;
  location: string;
  status: "active" | "orphaned";
  firstSeen: string;
  lastSeen: string;
};
/** The persisted `registry.json`: all known messages keyed by ID. `version` allows a future format change. */
export interface Registry {
  version: 1;
  entries: Record<string, RegistryEntry>;
}
/** Maps message IDs to text. */
export type Catalog = Record<string, string>;
/** A message that needs a translation, as sent to a provider. */
export interface TranslationRequest {
  id: string;
  source: string;
  /** Enclosing component name, so providers can pick the right UI wording. */
  context: string;
}
/** One translation call: the locale pair and the messages to translate between them. */
export interface TranslateInput {
  sourceLocale: string;
  targetLocale: string;
  messages: TranslationRequest[];
}
/**
 * Translates a batch of messages into one target locale. Return a catalogue with a key for each message that was
 * translated. Missing keys are left untranslated. Throw a `PartialTranslationError` to keep the keys already done.
 */
export interface TranslationProvider {
  translate(input: TranslateInput): Promise<Catalog>;
}
/**
 * Named providers. The services listed in the README have typed keys so editors can suggest them; any other name is
 * accepted through the index signature.
 */
export interface NamedProviders {
  primary?: string | undefined;
  anthropic?: TranslationProvider | undefined;
  gemini?: TranslationProvider | undefined;
  openai?: TranslationProvider | undefined;
  mistral?: TranslationProvider | undefined;
  groq?: TranslationProvider | undefined;
  deepseek?: TranslationProvider | undefined;
  openrouter?: TranslationProvider | undefined;
  xai?: TranslationProvider | undefined;
  cerebras?: TranslationProvider | undefined;
  perplexity?: TranslationProvider | undefined;
  together?: TranslationProvider | undefined;
  fireworks?: TranslationProvider | undefined;
  huggingface?: TranslationProvider | undefined;
  deepinfra?: TranslationProvider | undefined;
  sambanova?: TranslationProvider | undefined;
  moonshot?: TranslationProvider | undefined;
  ollama?: TranslationProvider | undefined;
  lmstudio?: TranslationProvider | undefined;
  llamacpp?: TranslationProvider | undefined;
  vllm?: TranslationProvider | undefined;
  localai?: TranslationProvider | undefined;
  dockermodelrunner?: TranslationProvider | undefined;
  deepl?: TranslationProvider | undefined;
  google?: TranslationProvider | undefined;
  [name: string]: TranslationProvider | string | undefined;
}
/**
 * A single provider, or named providers. In the named form, `primary` picks the provider tried first; the rest are
 * fallbacks in declaration order. Entries set to `undefined` are skipped, so unconfigured providers can stay in the
 * map.
 */
export type ProviderConfig = TranslationProvider | NamedProviders;
