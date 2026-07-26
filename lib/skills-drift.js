"use strict";

// #739 drift guard — compares devkit-shipped skills against the installed
// copies under ~/.claude/skills. The installers cp -R (they do not symlink for
// new skills), so an installed copy can silently rot behind the devkit SSOT.
// Consumed by `aigentry-devkit doctor --skills`.

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

// package.json "files" is the ship gate: entries shaped `skills/<name>/**`.
// Reading it here means the de-listed skills (#739 D1/D4) — present in git but
// absent from files[] — are neither shipped nor guarded, with no second list.
function shippedSkills(rootDir) {
  const pkg = JSON.parse(fs.readFileSync(path.join(rootDir, "package.json"), "utf8"));
  const names = (pkg.files || [])
    .map((entry) => /^skills\/([^/*]+)\/\*\*$/.exec(entry))
    .filter(Boolean)
    .map((m) => m[1]);
  return names.sort();
}

// Digest of a directory's contents: relative path + file bytes, sorted, so the
// result is stable across filesystems. Symlinks are followed (an installed
// skill may be a symlink back into a checkout). Dotfiles are ignored — .DS_Store
// and friends are not skill content. Returns null when the directory is absent.
function hashDir(dir) {
  if (!fs.existsSync(dir)) return null;
  const hash = crypto.createHash("sha256");
  const walk = (current, prefix) => {
    const entries = fs.readdirSync(current).filter((n) => !n.startsWith(".")).sort();
    for (const name of entries) {
      const full = path.join(current, name);
      const rel = prefix ? `${prefix}/${name}` : name;
      let stat;
      try {
        stat = fs.statSync(full);
      } catch {
        continue; // broken symlink — nothing to hash
      }
      if (stat.isDirectory()) {
        walk(full, rel);
      } else {
        hash.update(rel);
        hash.update(fs.readFileSync(full));
      }
    }
  };
  walk(dir, "");
  return hash.digest("hex");
}

// status: "ok" | "missing" (not installed) | "drift" (installed copy differs)
function checkSkillsDrift(rootDir, installedDir) {
  return shippedSkills(rootDir).map((name) => {
    const shipped = hashDir(path.join(rootDir, "skills", name));
    const installed = hashDir(path.join(installedDir, name));
    let status;
    if (installed === null) status = "missing";
    else if (installed === shipped) status = "ok";
    else status = "drift";
    return { name, status, shipped, installed };
  });
}

module.exports = { shippedSkills, hashDir, checkSkillsDrift };
