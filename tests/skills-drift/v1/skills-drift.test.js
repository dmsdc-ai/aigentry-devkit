"use strict";

// #739 drift guard — `aigentry-devkit doctor --skills` backing logic.

const test = require("node:test");
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const { shippedSkills, hashDir, checkSkillsDrift } = require("../../../lib/skills-drift");

const repoRoot = path.resolve(__dirname, "..", "..", "..");

function tmpFixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "skills-drift-"));
  const root = path.join(dir, "devkit");
  const installed = path.join(dir, "installed");
  fs.mkdirSync(path.join(root, "skills", "alpha"), { recursive: true });
  fs.mkdirSync(path.join(root, "skills", "beta"), { recursive: true });
  fs.mkdirSync(path.join(root, "skills", "delisted"), { recursive: true });
  fs.mkdirSync(installed, { recursive: true });
  fs.writeFileSync(path.join(root, "skills", "alpha", "SKILL.md"), "alpha\n");
  fs.writeFileSync(path.join(root, "skills", "beta", "SKILL.md"), "beta\n");
  fs.writeFileSync(path.join(root, "skills", "delisted", "SKILL.md"), "delisted\n");
  fs.writeFileSync(
    path.join(root, "package.json"),
    JSON.stringify({ files: ["skills/alpha/**", "skills/beta/**", "lib/**"] })
  );
  return { dir, root, installed };
}

test("shippedSkills — only skills/<name>/** entries from package.json files[]", () => {
  const { root } = tmpFixture();
  assert.deepEqual(shippedSkills(root), ["alpha", "beta"]);
});

test("shippedSkills — the real package.json ships the promoted skills, not the de-listed ones", () => {
  const names = shippedSkills(repoRoot);
  for (const promoted of ["caveman", "diagnose", "session-create", "workspace-lifecycle"]) {
    assert.ok(names.includes(promoted), `${promoted} should be shipped`);
  }
  for (const delisted of ["project-ops", "clipboard-image", "youtube-analyzer"]) {
    assert.ok(!names.includes(delisted), `${delisted} should be de-listed`);
  }
});

test("shippedSkills — every shipped skill directory exists on disk", () => {
  for (const name of shippedSkills(repoRoot)) {
    assert.ok(fs.existsSync(path.join(repoRoot, "skills", name, "SKILL.md")), `${name}/SKILL.md missing`);
  }
});

test("hashDir — missing directory yields null, identical content yields equal digests", () => {
  const { root, installed } = tmpFixture();
  assert.equal(hashDir(path.join(installed, "alpha")), null);
  fs.cpSync(path.join(root, "skills", "alpha"), path.join(installed, "alpha"), { recursive: true });
  assert.equal(hashDir(path.join(installed, "alpha")), hashDir(path.join(root, "skills", "alpha")));
});

test("hashDir — dotfiles are ignored", () => {
  const { root } = tmpFixture();
  const before = hashDir(path.join(root, "skills", "alpha"));
  fs.writeFileSync(path.join(root, "skills", "alpha", ".DS_Store"), "junk");
  assert.equal(hashDir(path.join(root, "skills", "alpha")), before);
});

test("checkSkillsDrift — reports ok / missing / drift and skips de-listed skills", () => {
  const { root, installed } = tmpFixture();
  fs.cpSync(path.join(root, "skills", "alpha"), path.join(installed, "alpha"), { recursive: true });
  fs.cpSync(path.join(root, "skills", "delisted"), path.join(installed, "delisted"), { recursive: true });
  fs.mkdirSync(path.join(installed, "beta"));
  fs.writeFileSync(path.join(installed, "beta", "SKILL.md"), "stale beta\n");

  const byName = Object.fromEntries(checkSkillsDrift(root, installed).map((r) => [r.name, r.status]));
  assert.deepEqual(byName, { alpha: "ok", beta: "drift" });
});

test("checkSkillsDrift — a symlinked install counts as in-sync", () => {
  const { root, installed } = tmpFixture();
  fs.symlinkSync(path.join(root, "skills", "alpha"), path.join(installed, "alpha"));
  const alpha = checkSkillsDrift(root, installed).find((r) => r.name === "alpha");
  assert.equal(alpha.status, "ok");
});
