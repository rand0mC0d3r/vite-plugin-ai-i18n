#!/usr/bin/env node
// Usage:
//   node .github/scripts/release.mjs next-version
//     Prints key=value lines (previous_tag, bump, version, tag) for $GITHUB_OUTPUT.
//   node .github/scripts/release.mjs changelog <from-ref> <to-ref>
//     Prints Markdown release notes for the commits in <from-ref>..<to-ref>.
//   node .github/scripts/release.mjs coverage <coverage-summary.json>
//     Prints a Markdown coverage table from a Vitest json-summary report.
//   node .github/scripts/release.mjs package <npm-pack-report.json> <package.json>
//     Prints Markdown package size, distribution, and dependency tables.

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const FIELD = "\x1f";
const RECORD = "\x1e";
const TAG_PATTERN = /^v(\d+)\.(\d+)\.(\d+)$/;
const RELEASE_SUBJECT = /^chore\(release\): /;
const CONVENTIONAL = /^(?<type>[a-z]+)(?:\([^)]*\))?(?<breaking>!)?:\s+(?<description>.+)$/i;
const BUMP_RANK = { none: 0, patch: 1, minor: 2, major: 3 };

const git = (...args) => execFileSync("git", args, { encoding: "utf8" }).trim();

const fail = (message) => {
  console.error(`::error::${message}`);
  process.exit(1);
};

function latestReleaseTag() {
  try {
    return git("describe", "--tags", "--abbrev=0", "--match", "v[0-9]*.[0-9]*.[0-9]*", "HEAD");
  } catch {
    return null;
  }
}

function commitsBetween(range) {
  const output = git("log", `--format=%H${FIELD}%s${FIELD}%b${RECORD}`, range);
  return output
    .split(RECORD)
    .map((record) => record.trim())
    .filter(Boolean)
    .map((record) => {
      const [sha, subject, body = ""] = record.split(FIELD);
      return { sha, subject, body };
    });
}

function parseCommit({ sha, subject, body }) {
  const match = CONVENTIONAL.exec(subject);
  const breaking = Boolean(match?.groups.breaking) || /^BREAKING[ -]CHANGE:/m.test(body);
  return {
    sha,
    type: match ? match.groups.type.toLowerCase() : "other",
    description: match ? match.groups.description : subject,
    breaking,
  };
}

function bumpFor(commit) {
  if (commit.breaking) return "major";
  if (commit.type === "feat") return "patch";
  if (commit.type === "fix" || commit.type === "perf") return "patch";
  return "none";
}

function nextVersion(tag, bump) {
  const match = TAG_PATTERN.exec(tag);
  if (!match) fail(`Latest release tag "${tag}" is not a plain semver tag (vMAJOR.MINOR.PATCH).`);
  const [major, minor, patch] = match.slice(1).map(Number);
  if (bump === "major") return `${major + 1}.0.0`;
  if (bump === "minor") return `${major}.${minor + 1}.0`;
  if (bump === "patch") return `${major}.${minor}.${patch + 1}`;
  return `${major}.${minor}.${patch}`;
}

function nextVersionCommand() {
  const previousTag = latestReleaseTag();
  if (!previousTag) {
    fail("No vMAJOR.MINOR.PATCH tag found. Create a baseline tag (e.g. `git tag v0.6.0 <commit>`) and push it.");
  }

  const bump = commitsBetween(`${previousTag}..HEAD`)
    .map(parseCommit)
    .map(bumpFor)
    .reduce((highest, current) => (BUMP_RANK[current] > BUMP_RANK[highest] ? current : highest), "none");

  const version = bump === "none" ? "" : nextVersion(previousTag, bump);
  console.log(`previous_tag=${previousTag}`);
  console.log(`bump=${bump}`);
  console.log(`version=${version}`);
  console.log(`tag=${version ? `v${version}` : ""}`);
}

function commitLink(sha) {
  const repository = process.env.GITHUB_REPOSITORY;
  const short = sha.slice(0, 7);
  return repository ? `[${short}](https://github.com/${repository}/commit/${sha})` : short;
}

function changelogCommand(from, to) {
  const commits = commitsBetween(`${from}..${to}`)
    .filter((commit) => !RELEASE_SUBJECT.test(commit.subject))
    .map(parseCommit);

  const sections = [
    { title: "⚠ BREAKING CHANGES", include: (c) => c.breaking },
    { title: "Features", include: (c) => !c.breaking && c.type === "feat" },
    { title: "Bug Fixes", include: (c) => !c.breaking && c.type === "fix" },
    { title: "Performance Improvements", include: (c) => !c.breaking && c.type === "perf" },
    { title: "Other Changes", include: (c) => !c.breaking && !["feat", "fix", "perf"].includes(c.type) },
  ];

  const lines = [`## ${to}`, ""];
  for (const section of sections) {
    const items = commits.filter(section.include);
    if (items.length === 0) continue;
    lines.push(`### ${section.title}`, "");
    for (const item of items) {
      lines.push(`- ${item.description} (${commitLink(item.sha)})`);
    }
    lines.push("");
  }

  if (commits.length === 0) lines.push("No notable changes.", "");

  const repository = process.env.GITHUB_REPOSITORY;
  if (repository) {
    lines.push(`**Full Changelog**: https://github.com/${repository}/compare/${from}...${to}`, "");
  }

  console.log(lines.join("\n"));
}

function coverageCommand(file) {
  const { total } = JSON.parse(readFileSync(file, "utf8"));
  const metrics = [
    ["Statements", total.statements],
    ["Branches", total.branches],
    ["Functions", total.functions],
    ["Lines", total.lines],
  ];

  const lines = [
    "## Test coverage",
    "",
    "Measured on `src/**` (V8) for the commit in this release.",
    "",
    "| Metric | Coverage | Covered / Total |",
    "|---|---|---|",
  ];
  for (const [name, metric] of metrics) {
    lines.push(`| ${name} | ${metric.pct}% | ${metric.covered} / ${metric.total} |`);
  }
  lines.push("");

  console.log(lines.join("\n"));
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  return `${(bytes / 1024).toFixed(1)} KiB`;
}

function locationOf(path) {
  const parts = path.split("/");
  return parts.length > 2 ? `${parts[0]}/${parts[1]}/` : parts.length === 2 ? `${parts[0]}/` : "./";
}

function typeOf(path) {
  if (path.endsWith(".d.ts")) return "Declarations (.d.ts)";
  if (path.endsWith(".js")) return "JavaScript (.js)";
  return "Other";
}

function tally(files, keyOf) {
  const totals = new Map();
  for (const file of files) {
    const key = keyOf(file.path);
    const entry = totals.get(key) ?? { files: 0, bytes: 0 };
    entry.files += 1;
    entry.bytes += file.size;
    totals.set(key, entry);
  }
  return [...totals.entries()].sort((a, b) => b[1].bytes - a[1].bytes);
}

function packageCommand(packFile, packageFile) {
  const [pack] = JSON.parse(readFileSync(packFile, "utf8"));
  const pkg = JSON.parse(readFileSync(packageFile, "utf8"));
  const table = (headers, rows) => [
    `| ${headers.join(" | ")} |`,
    `|${headers.map(() => "---").join("|")}|`,
    ...rows.map((row) => `| ${row.join(" | ")} |`),
  ];

  const lines = [
    "## Package",
    "",
    ...table(
      ["Metric", "Value"],
      [
        ["Tarball size (compressed)", formatBytes(pack.size)],
        ["Unpacked size", formatBytes(pack.unpackedSize)],
        ["Files", String(pack.entryCount)],
      ],
    ),
    "",
    "### Distribution by location",
    "",
    ...table(
      ["Location", "Files", "Unpacked size"],
      tally(pack.files, locationOf).map(([key, v]) => [`\`${key}\``, String(v.files), formatBytes(v.bytes)]),
    ),
    "",
    "### Distribution by type",
    "",
    ...table(
      ["Type", "Files", "Unpacked size"],
      tally(pack.files, typeOf).map(([key, v]) => [key, String(v.files), formatBytes(v.bytes)]),
    ),
    "",
    "## Dependencies",
    "",
    "Dependencies are not bundled into `dist/`. Consumers install these alongside the package.",
    "",
  ];

  const dependencies = Object.entries(pkg.dependencies ?? {});
  lines.push("### Runtime dependencies", "");
  lines.push(
    ...(dependencies.length
      ? table(
          ["Package", "Range"],
          dependencies.map(([name, range]) => [`\`${name}\``, `\`${range}\``]),
        )
      : ["None."]),
  );
  lines.push("");

  const peers = Object.entries(pkg.peerDependencies ?? {});
  lines.push("### Peer dependencies", "");
  lines.push(
    ...(peers.length
      ? table(
          ["Package", "Range"],
          peers.map(([name, range]) => [`\`${name}\``, `\`${range}\``]),
        )
      : ["None."]),
  );
  lines.push("");

  console.log(lines.join("\n"));
}

const [command, ...args] = process.argv.slice(2);

switch (command) {
  case "next-version":
    nextVersionCommand();
    break;
  case "changelog":
    if (args.length !== 2) fail("Usage: release.mjs changelog <from-ref> <to-ref>");
    changelogCommand(args[0], args[1]);
    break;
  case "coverage":
    if (args.length !== 1) fail("Usage: release.mjs coverage <coverage-summary.json>");
    coverageCommand(args[0]);
    break;
  case "package":
    if (args.length !== 2) fail("Usage: release.mjs package <npm-pack-report.json> <package.json>");
    packageCommand(args[0], args[1]);
    break;
  default:
    fail(
      "Usage: release.mjs <next-version | changelog <from-ref> <to-ref> | coverage <file> | package <pack-report> <package.json>>",
    );
}
