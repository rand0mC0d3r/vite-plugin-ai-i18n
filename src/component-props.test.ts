import { describe, expect, it } from "vitest";
import { extractMessages } from "./compiler/extract.js";
import { transformSource } from "./compiler/transform.js";

const CODE = `
export function App() {
  return (
    <>
      <Button aria-label="Close dialog" title="Close" variant="primary" />
      <input aria-label="Search" />
      <Card heading="Welcome back" />
    </>
  );
}
`;

describe("componentProps extraction", () => {
  it("ignores attributes of custom components by default", () => {
    const sources = extractMessages(CODE, "App.tsx").map(m => m.source);
    expect(sources).toContain("Search");
    expect(sources).not.toContain("Close dialog");
    expect(sources).not.toContain("Welcome back");
  });

  it("extracts only the configured props of the configured components", () => {
    const messages = extractMessages(CODE, "App.tsx", { componentProps: { Button: ["aria-label", "title"] } });
    const sources = messages.map(m => m.source);
    expect(sources).toContain("Close dialog");
    expect(sources).toContain("Close");
    expect(sources).not.toContain("primary");
    expect(sources).not.toContain("Welcome back");
    const button = messages.find(m => m.source === "Close dialog");
    expect(button?.attribute).toBe("aria-label");
    expect(button?.tag).toBe("Button");
  });

  it("does not let componentProps widen intrinsic element extraction", () => {
    const messages = extractMessages(CODE, "App.tsx", { componentProps: { input: ["title"] } });
    expect(messages.map(m => m.source)).toContain("Search");
  });
});

describe("children extraction for capitalised components", () => {
  const TEXT_CODE = `
export function App({ count }) {
  return (
    <>
      <Button>Save</Button>
      <Button>Delete {count} files</Button>
      <Heading level={2}>Recent documents</Heading>
      <Code>const x = 1</Code>
    </>
  );
}
`;

  it("ignores text children of components by default", () => {
    const sources = extractMessages(TEXT_CODE, "App.tsx").map(m => m.source);
    expect(sources).not.toContain("Save");
    expect(sources).not.toContain("Recent documents");
  });

  it("extracts text and mixed children only for components that list children", () => {
    const messages = extractMessages(TEXT_CODE, "App.tsx", { componentProps: { Button: ["children"] } });
    const save = messages.find(m => m.source === "Save");
    expect(save).toMatchObject({ kind: "text", tag: "Button" });
    const mixed = messages.find(m => m.kind === "mixed");
    expect(mixed).toMatchObject({ source: "Delete {count} files", placeholders: ["count"], tag: "Button" });
    expect(messages.map(m => m.source)).not.toContain("Recent documents");
    expect(messages.map(m => m.source)).not.toContain("const x = 1");
  });

  it("does not extract children when only attributes are listed", () => {
    const messages = extractMessages(TEXT_CODE, "App.tsx", { componentProps: { Button: ["aria-label"] } });
    expect(messages.map(m => m.source)).not.toContain("Save");
    expect(messages.some(m => m.kind === "mixed")).toBe(false);
  });

  it("translates component children in build output", () => {
    const options = { componentProps: { Button: ["children"] } };
    const messages = extractMessages(TEXT_CODE, "App.tsx", options).map((m, i) => ({ ...m, id: `id${i}` }));
    const catalog = { id0: "Speichern", id1: "Lösche {count} Dateien" };
    const { code } = transformSource(TEXT_CODE, "App.tsx", messages, "de", catalog);
    expect(code).toContain("{\"Speichern\"}");
    expect(code).toContain("Lösche ");
    expect(code).toContain("{count}");
  });
});
