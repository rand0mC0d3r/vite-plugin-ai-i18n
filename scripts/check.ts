// Runs typecheck, formatting, lint and the test suite with coverage gates.
// Every step runs even if an earlier one fails, and the exit code is 1 if any failed.
// Invoked through the `check` script in package.json: bun run check
import { spawnSync } from "node:child_process";

export function runChecks(): number {
  const steps: [name: string, args: string[]][] = [
    ["typecheck", ["run", "typecheck"]],
    ["format", ["run", "fmt:check"]],
    ["lint", ["run", "lint:check"]],
    ["tests", ["run", "test:coverage"]],
  ];
  const failed: string[] = [];
  for (const [name, args] of steps) {
    console.log(`\n==> ${name}: bun ${args.join(" ")}`);
    const result = spawnSync("bun", args, { stdio: "inherit" });
    if (result.status !== 0) failed.push(name);
  }

  if (failed.length > 0) {
    console.error(`\ncheck failed: ${failed.join(", ")}`);
    return 1;
  }
  console.log("\ncheck passed: typecheck, format, lint and tests are all green");
  return 0;
}
