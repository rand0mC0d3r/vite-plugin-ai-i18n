#!/usr/bin/env node
// Usage:
//   node .github/scripts/release.mjs next-version
//     Prints key=value lines (previous_tag, bump, version, tag) for $GITHUB_OUTPUT.
//   node .github/scripts/release.mjs changelog <from-ref> <to-ref>
//     Prints Markdown release notes for the commits in <from-ref>..<to-ref>.
//   node .github/scripts/release.mjs coverage <coverage-summary.json>
//     Prints a Markdown coverage table from a Vitest json-summary report.

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const FIELD = '\x1f';
const RECORD = '\x1e';
const TAG_PATTERN = /^v(\d+)\.(\d+)\.(\d+)$/;
const RELEASE_SUBJECT = /^chore\(release\): /;
const CONVENTIONAL = /^(?<type>[a-z]+)(?:\([^)]*\))?(?<breaking>!)?:\s+(?<description>.+)$/i;
const BUMP_RANK = { none: 0, patch: 1, minor: 2, major: 3 };

const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim();

const fail = (message) => {
  console.error(`::error::${message}`);
  process.exit(1);
};

function latestReleaseTag() {
  try {
    return git('describe', '--tags', '--abbrev=0', '--match', 'v[0-9]*.[0-9]*.[0-9]*', 'HEAD');
  } catch {
    return null;
  }
}

function commitsBetween(range) {
  const output = git('log', `--format=%H${FIELD}%s${FIELD}%b${RECORD}`, range);
  return output
    .split(RECORD)
    .map((record) => record.trim())
    .filter(Boolean)
    .map((record) => {
      const [sha, subject, body = ''] = record.split(FIELD);
      return { sha, subject, body };
    });
}

function parseCommit({ sha, subject, body }) {
  const match = CONVENTIONAL.exec(subject);
  const breaking = Boolean(match?.groups.breaking) || /^BREAKING[ -]CHANGE:/m.test(body);
  return {
    sha,
    type: match ? match.groups.type.toLowerCase() : 'other',
    description: match ? match.groups.description : subject,
    breaking,
  };
}

function bumpFor(commit) {
  if (commit.breaking) return 'major';
  if (commit.type === 'feat') return 'minor';
  if (commit.type === 'fix' || commit.type === 'perf') return 'patch';
  return 'none';
}

function nextVersion(tag, bump) {
  const match = TAG_PATTERN.exec(tag);
  if (!match) fail(`Latest release tag "${tag}" is not a plain semver tag (vMAJOR.MINOR.PATCH).`);
  const [major, minor, patch] = match.slice(1).map(Number);
  if (bump === 'major') return `${major + 1}.0.0`;
  if (bump === 'minor') return `${major}.${minor + 1}.0`;
  return `${major}.${minor}.${patch + 1}`;
}

function nextVersionCommand() {
  const previousTag = latestReleaseTag();
  if (!previousTag) {
    fail('No vMAJOR.MINOR.PATCH tag found. Create a baseline tag (e.g. `git tag v0.6.0 <commit>`) and push it.');
  }

  const bump = commitsBetween(`${previousTag}..HEAD`)
    .map(parseCommit)
    .map(bumpFor)
    .reduce((highest, current) => (BUMP_RANK[current] > BUMP_RANK[highest] ? current : highest), 'none');

  const version = bump === 'none' ? '' : nextVersion(previousTag, bump);
  console.log(`previous_tag=${previousTag}`);
  console.log(`bump=${bump}`);
  console.log(`version=${version}`);
  console.log(`tag=${version ? `v${version}` : ''}`);
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
    { title: '⚠ BREAKING CHANGES', include: (c) => c.breaking },
    { title: 'Features', include: (c) => !c.breaking && c.type === 'feat' },
    { title: 'Bug Fixes', include: (c) => !c.breaking && c.type === 'fix' },
    { title: 'Performance Improvements', include: (c) => !c.breaking && c.type === 'perf' },
    { title: 'Other Changes', include: (c) => !c.breaking && !['feat', 'fix', 'perf'].includes(c.type) },
  ];

  const lines = [`## ${to}`, ''];
  for (const section of sections) {
    const items = commits.filter(section.include);
    if (items.length === 0) continue;
    lines.push(`### ${section.title}`, '');
    for (const item of items) {
      lines.push(`- ${item.description} (${commitLink(item.sha)})`);
    }
    lines.push('');
  }

  if (commits.length === 0) lines.push('No notable changes.', '');

  const repository = process.env.GITHUB_REPOSITORY;
  if (repository) {
    lines.push(`**Full Changelog**: https://github.com/${repository}/compare/${from}...${to}`, '');
  }

  console.log(lines.join('\n'));
}

function coverageCommand(file) {
  const { total } = JSON.parse(readFileSync(file, 'utf8'));
  const metrics = [
    ['Statements', total.statements],
    ['Branches', total.branches],
    ['Functions', total.functions],
    ['Lines', total.lines],
  ];

  const lines = [
    '## Test coverage',
    '',
    'Measured on `src/**` (V8) for the commit in this release.',
    '',
    '| Metric | Coverage | Covered / Total |',
    '|---|---|---|',
  ];
  for (const [name, metric] of metrics) {
    lines.push(`| ${name} | ${metric.pct}% | ${metric.covered} / ${metric.total} |`);
  }
  lines.push('');

  console.log(lines.join('\n'));
}

const [command, ...args] = process.argv.slice(2);

switch (command) {
  case 'next-version':
    nextVersionCommand();
    break;
  case 'changelog':
    if (args.length !== 2) fail('Usage: release.mjs changelog <from-ref> <to-ref>');
    changelogCommand(args[0], args[1]);
    break;
  case 'coverage':
    if (args.length !== 1) fail('Usage: release.mjs coverage <coverage-summary.json>');
    coverageCommand(args[0]);
    break;
  default:
    fail('Usage: release.mjs <next-version | changelog <from-ref> <to-ref> | coverage <file>>');
}
