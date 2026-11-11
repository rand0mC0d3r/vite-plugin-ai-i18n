import { describe, expect, it } from "vitest";
import { extractMessages } from "./compiler/extract.js";

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
