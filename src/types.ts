export type MessageKind = "text" | "attribute" | "mixed" | "string";
export interface ExtractedMessage {
  source: string;
  prefix?: string;
  suffix?: string;
  kind: MessageKind;
  /** For "mixed" messages: placeholder names in the order of the element's expression children. */
  placeholders?: string[];
  file: string;
  start: number;
  end: number;
  tag: string;
  component: string;
  attribute?: string;
  context: string;
  fingerprint: string;
}
/** A message with the stable ID that the registry assigned to it. */
export type ResolvedMessage = ExtractedMessage & { id: string };
export type RegistryEntry = Pick<ExtractedMessage, "source" | "kind" | "tag" | "component" | "attribute" | "context" | "fingerprint"> & {
  id: string;
  location: string;
  status: "active" | "orphaned";
  firstSeen: string;
  lastSeen: string;
};
export interface Registry { version: 1; entries: Record<string, RegistryEntry> }
export type Catalog = Record<string, string>;
export interface TranslationRequest { id: string; source: string; context: string; kind: MessageKind; placeholders?: string[] }
export interface TranslationProvider {
  translate(input: { sourceLocale: string; targetLocale: string; messages: TranslationRequest[] }): Promise<Catalog>;
}
