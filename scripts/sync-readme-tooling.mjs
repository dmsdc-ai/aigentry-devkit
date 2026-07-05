#!/usr/bin/env node
// sync-readme-tooling.mjs — push devkit's canonical README tooling into every repo that
// vendors it. This is the cross-repo consistency mechanism: run it (as maintainer /
// orchestrator, locally) whenever a module version or the generator changes, then
// regen + commit per repo. Zero deps, zero network (Constitution §17).
//
//   node scripts/sync-readme-tooling.mjs           # copy canonical files into each target
//   node scripts/sync-readme-tooling.mjs --check    # exit 1 if any target is out of sync
//
// aterm is intentionally excluded (row-only; hand-written Rust-repo README).
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const devkitRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const projectsRoot = join(devkitRoot, '..');

// Repos that vendor the generator + ecosystem snapshot (devkit is the canonical source).
// telepty is DEFERRED (#697): add 'aigentry-telepty' here once fix/694-busy-submit lands
// and its readme-regen wiring ships, so this tool can't touch 694's active working tree.
const TARGETS = [
  'aigentry-deliberation',
  'aigentry-brain',
  'aigentry',
  'aigentry-orchestrator',
];

const FILES = ['ecosystem.json', 'scripts/gen-readme.mjs'];
const check = process.argv.includes('--check');
let stale = 0;

for (const repo of TARGETS) {
  const repoDir = join(projectsRoot, repo);
  if (!existsSync(repoDir)) {
    console.warn(`skip ${repo}: not found at ${repoDir}`);
    continue;
  }
  for (const rel of FILES) {
    const src = readFileSync(join(devkitRoot, rel), 'utf8');
    const destPath = join(repoDir, rel);
    const cur = existsSync(destPath) ? readFileSync(destPath, 'utf8') : null;
    if (cur === src) continue;
    if (check) {
      console.error(`out of sync: ${repo}/${rel}`);
      stale++;
      continue;
    }
    mkdirSync(dirname(destPath), { recursive: true });
    writeFileSync(destPath, src);
    console.log(`synced ${repo}/${rel}`);
  }
}

if (check && stale) {
  console.error(`sync-readme-tooling --check: ${stale} file(s) out of sync`);
  process.exit(1);
}
if (!check) console.log('sync-readme-tooling: done (now regen + commit per repo)');
