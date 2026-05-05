const fs = require("fs");
const path = require("path");
const {
  atomicWriteFile,
  markdownSentinel,
  sha256,
  unifiedDiff,
} = require("../idempotent");

const cliName = "codex";
const beginMarker = "<!-- BEGIN aigentry context-ref/v1 -->";
const endMarker = "<!-- END aigentry context-ref/v1 -->";
const templatePath = path.resolve(__dirname, "..", "..", "..", "templates", "scaffold", "hooks", "codex", "agents-md-block.md");
const packagePath = path.resolve(__dirname, "..", "..", "..", "package.json");

function devkitVersion() {
  return JSON.parse(fs.readFileSync(packagePath, "utf8")).version;
}

function targetPaths(scopePath, opts = {}) {
  return {
    agents_md: opts.global ? path.join(scopePath, ".codex", "AGENTS.md") : path.join(scopePath, "AGENTS.md"),
  };
}

function renderBlock() {
  return fs.readFileSync(templatePath, "utf8").replace(/\{\{DEVKIT_VERSION\}\}/g, devkitVersion());
}

function splitBlock(block) {
  const begin = block.indexOf(beginMarker);
  const end = block.indexOf(endMarker);
  if (begin === -1 || end === -1 || end < begin) throw new Error("codex context-ref template is malformed");
  return block.slice(begin + beginMarker.length, end);
}

function planUpsert(filePath, opts = {}) {
  const block = renderBlock();
  const content = splitBlock(block);
  const existed = fs.existsSync(filePath);
  const oldText = existed ? fs.readFileSync(filePath, "utf8") : "";
  const detected = markdownSentinel.detect(filePath, beginMarker, endMarker);
  if (detected.malformed && !opts.force) {
    return {
      exitCode: 4,
      diagnostics: [{ severity: "error", message: `${filePath}: BEGIN sentinel without END (or vice versa) - file in inconsistent state` }],
      files: [{ path: filePath, action: "error", backupPath: null }],
    };
  }

  let newText;
  let action;
  if (detected.present) {
    const fullBlock = `${beginMarker}${content}${endMarker}\n`;
    newText = `${oldText.slice(0, detected.range.start)}${fullBlock}${oldText.slice(detected.range.end)}`;
    action = "replaced";
  } else {
    const fullBlock = `${beginMarker}${content}${endMarker}\n`;
    const prefix = oldText.length === 0 ? "" : (oldText.endsWith("\n") ? `${oldText}\n` : `${oldText}\n\n`);
    newText = `${prefix}${fullBlock}`;
    action = existed ? "updated" : "created";
  }
  if (newText === oldText) action = "noop";
  return {
    exitCode: 0,
    diagnostics: [],
    files: [{
      path: filePath,
      action,
      backupPath: null,
      diff: unifiedDiff(oldText, newText),
    }],
  };
}

function detect(scopePath, opts = {}) {
  const paths = targetPaths(scopePath, opts);
  const detected = markdownSentinel.detect(paths.agents_md, beginMarker, endMarker);
  let version = null;
  if (detected.present && fs.existsSync(paths.agents_md)) {
    const text = fs.readFileSync(paths.agents_md, "utf8");
    const match = text.match(/<!-- devkit version: ([^ ]+) -->/);
    version = match ? "v1" : null;
  }
  return {
    installed: detected.present,
    version,
    paths,
    issues: detected.malformed ? [{ path: paths.agents_md, severity: "error", message: "sentinel block malformed" }] : [],
  };
}

function install(scopePath, opts = {}) {
  const paths = targetPaths(scopePath, opts);
  if (opts.dryRun) {
    return { cli: cliName, scope: scopePath, action: "dry-run", ...planUpsert(paths.agents_md, opts) };
  }
  const planned = planUpsert(paths.agents_md, opts);
  if (planned.exitCode !== 0) return { cli: cliName, scope: scopePath, action: "install", ...planned };
  const beforeExists = fs.existsSync(paths.agents_md);
  const block = renderBlock();
  const result = markdownSentinel.upsert(paths.agents_md, beginMarker, endMarker, splitBlock(block), opts);
  const action = result.action === "inserted" ? (beforeExists ? "updated" : "created") : result.action;
  return {
    cli: cliName,
    scope: scopePath,
    action: "install",
    exitCode: 0,
    diagnostics: [],
    files: [{ path: paths.agents_md, action, backupPath: result.backupPath }],
  };
}

function uninstall(scopePath, opts = {}) {
  const paths = targetPaths(scopePath, opts);
  const oldText = fs.existsSync(paths.agents_md) ? fs.readFileSync(paths.agents_md, "utf8") : "";
  const detected = markdownSentinel.detect(paths.agents_md, beginMarker, endMarker);
  if (detected.malformed && !opts.force) {
    return {
      cli: cliName,
      scope: scopePath,
      action: opts.dryRun ? "dry-run" : "uninstall",
      exitCode: 4,
      diagnostics: [{ severity: "error", message: `${paths.agents_md}: BEGIN sentinel without END (or vice versa) - file in inconsistent state` }],
      files: [{ path: paths.agents_md, action: "error", backupPath: null }],
    };
  }
  const newText = detected.present
    ? `${oldText.slice(0, detected.range.start)}${oldText.slice(detected.range.end)}`.replace(/\n{3,}/g, "\n\n")
    : oldText;
  if (opts.dryRun) {
    return {
      cli: cliName,
      scope: scopePath,
      action: "dry-run",
      exitCode: 0,
      diagnostics: [],
      files: [{ path: paths.agents_md, action: oldText === newText ? "noop" : "removed", backupPath: null, diff: unifiedDiff(oldText, newText) }],
    };
  }
  const result = markdownSentinel.remove(paths.agents_md, beginMarker, endMarker, opts);
  if (fs.existsSync(paths.agents_md) && fs.readFileSync(paths.agents_md, "utf8").trim() === "") {
    fs.unlinkSync(paths.agents_md);
  }
  return {
    cli: cliName,
    scope: scopePath,
    action: "uninstall",
    exitCode: 0,
    diagnostics: [],
    files: [{ path: paths.agents_md, action: result.action, backupPath: result.backupPath }],
  };
}

function verify(scopePath, opts = {}) {
  const status = detect(scopePath, opts);
  if (!status.installed) return { valid: true, issues: [], paths: status.paths };
  const block = renderBlock();
  const expectedContentHash = sha256(splitBlock(block));
  const detected = markdownSentinel.detect(status.paths.agents_md, beginMarker, endMarker);
  const issues = [...status.issues];
  if (detected.present && detected.contentSha256 !== expectedContentHash) {
    issues.push({ path: status.paths.agents_md, severity: "error", message: "sentinel block content sha256 mismatches expected" });
  }
  return { valid: issues.length === 0, issues, paths: status.paths };
}

module.exports = {
  cliName,
  detect,
  install,
  uninstall,
  verify,
};
