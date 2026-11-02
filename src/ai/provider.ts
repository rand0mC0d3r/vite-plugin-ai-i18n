import type { TranslationProvider, TranslationRequest, Catalog } from "../types.js";

export class OpenAICompatibleProvider implements TranslationProvider {
  constructor(private options: { apiKey: string; model: string; baseURL?: string }) {}

  async translate(input: { sourceLocale: string; targetLocale: string; messages: TranslationRequest[] }): Promise<Catalog> {
    const response = await fetch(`${this.options.baseURL ?? "https://api.openai.com/v1"}/chat/completions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${this.options.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: this.options.model,
        temperature: 0,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: `You are a professional software localization engine. Translate UI messages from ${input.sourceLocale} to ${input.targetLocale}. Preserve placeholders exactly. Respect context and UI conventions. Return ONLY a JSON object mapping message IDs to translated strings. Do not translate product names or code.` },
          { role: "user", content: JSON.stringify(input.messages.map(m => ({ id: m.id, text: m.source, context: m.context, kind: m.kind }))) }
        ]
      })
    });
    if (!response.ok) throw new Error(`Translation API failed (${response.status}): ${await response.text()}`);
    const json = await response.json() as any;
    const content = json.choices?.[0]?.message?.content;
    if (!content) throw new Error("Translation provider returned no content");
    const parsed = JSON.parse(content) as Catalog;
    for (const message of input.messages) if (typeof parsed[message.id] !== "string") throw new Error(`Missing translation for ${message.id}`);
    return parsed;
  }
}
