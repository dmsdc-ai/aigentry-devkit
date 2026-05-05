const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const HASH_ZERO = "0".repeat(64);
const DEFAULT_HEADER_PATTERN = /^# context-ref-installer\/v1 sha256=([0-9a-f]{64})$/m;

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function backupPathFor(filePath) {
  return `${filePath}.bak.${new Date().toISOString()}`;
}

function ensureParent(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function fsyncDir(dirPath) {
  try {
    const fd = fs.openSync(dirPath, "r");
    try {
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
  } catch (_) {
    // Some filesystems do not allow fsync on directories; the file rename is still atomic.
  }
}

function atomicWriteFile(filePath, content, mode) {
  ensureParent(filePath);
  const dir = path.dirname(filePath);
  const tmp = path.join(dir, `${path.basename(filePath)}.tmp.${process.pid}.${crypto.randomBytes(6).toString("hex")}`);
  const fd = fs.openSync(tmp, "w", mode);
  try {
    fs.writeFileSync(fd, content, "utf8");
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  if (mode != null) fs.chmodSync(tmp, mode);
  fs.renameSync(tmp, filePath);
  fsyncDir(dir);
}

function backupFile(filePath, opts = {}) {
  if (opts.backup === false || !fs.existsSync(filePath)) return null;
  const backupPath = backupPathFor(filePath);
  fs.copyFileSync(filePath, backupPath);
  return backupPath;
}

function detectIndent(text) {
  const match = text.match(/\n( +)"/);
  if (match && (match[1].length === 2 || match[1].length === 4)) return match[1].length;
  return 2;
}

function parseJsonError(error, text) {
  const err = new Error(error.message);
  err.code = "AIGENTRY_JSON_PARSE";
  const positionMatch = String(error.message).match(/position (\d+)/);
  if (positionMatch) {
    const position = Number(positionMatch[1]);
    const before = text.slice(0, position);
    const lines = before.split(/\n/);
    err.line = lines.length;
    err.column = lines[lines.length - 1].length + 1;
  }
  return err;
}

function parseJsonFile(filePath) {
  if (!fs.existsSync(filePath)) return { value: {}, exists: false, indent: 2 };
  const text = fs.readFileSync(filePath, "utf8");
  try {
    return { value: JSON.parse(text), exists: true, indent: detectIndent(text) };
  } catch (error) {
    throw parseJsonError(error, text);
  }
}

function changedResult(changed, action, backupPath = null, extra = {}) {
  return { changed, backupPath, action, ...extra };
}

const markdownSentinel = {
  detect(filePath, beginMarker, endMarker) {
    if (!fs.existsSync(filePath)) {
      return { present: false, range: null, contentSha256: null, malformed: false };
    }
    const text = fs.readFileSync(filePath, "utf8");
    const beginIndexes = [];
    const endIndexes = [];
    let pos = text.indexOf(beginMarker);
    while (pos !== -1) {
      beginIndexes.push(pos);
      pos = text.indexOf(beginMarker, pos + beginMarker.length);
    }
    pos = text.indexOf(endMarker);
    while (pos !== -1) {
      endIndexes.push(pos);
      pos = text.indexOf(endMarker, pos + endMarker.length);
    }
    const malformed = beginIndexes.length !== endIndexes.length || beginIndexes.length > 1 || endIndexes.length > 1
      || (beginIndexes.length === 1 && endIndexes.length === 1 && beginIndexes[0] > endIndexes[0]);
    if (malformed) return { present: false, range: null, contentSha256: null, malformed: true };
    if (beginIndexes.length === 0) {
      return { present: false, range: null, contentSha256: null, malformed: false };
    }
    const start = beginIndexes[0];
    const contentStart = start + beginMarker.length;
    const end = endIndexes[0];
    let rangeEnd = end + endMarker.length;
    if (text[rangeEnd] === "\r" && text[rangeEnd + 1] === "\n") rangeEnd += 2;
    else if (text[rangeEnd] === "\n") rangeEnd += 1;
    const content = text.slice(contentStart, end);
    return {
      present: true,
      range: { start, end: rangeEnd },
      contentSha256: sha256(content),
      malformed: false,
    };
  },

  upsert(filePath, beginMarker, endMarker, newBlockContent, opts = {}) {
    const exists = fs.existsSync(filePath);
    const text = exists ? fs.readFileSync(filePath, "utf8") : "";
    const detected = this.detect(filePath, beginMarker, endMarker);
    let blockContent = newBlockContent;
    if (!blockContent.startsWith("\n")) blockContent = `\n${blockContent}`;
    if (!blockContent.endsWith("\n")) blockContent = `${blockContent}\n`;
    const newBlock = `${beginMarker}${blockContent}${endMarker}\n`;

    if (detected.malformed && !opts.force) {
      const error = new Error("sentinel block is malformed");
      error.code = "AIGENTRY_SENTINEL_MALFORMED";
      throw error;
    }

    let nextText;
    let action;
    if (detected.malformed && opts.force) {
      const filtered = text
        .split(/(?<=\n)/)
        .filter((line) => !line.includes(beginMarker) && !line.includes(endMarker))
        .join("");
      const prefix = filtered.length === 0 ? "" : (filtered.endsWith("\n") ? `${filtered}\n` : `${filtered}\n\n`);
      nextText = `${prefix}${newBlock}`;
      action = "replaced";
    } else if (!detected.present) {
      const prefix = text.length === 0 ? "" : (text.endsWith("\n") ? `${text}\n` : `${text}\n\n`);
      nextText = `${prefix}${newBlock}`;
      action = "inserted";
    } else {
      nextText = `${text.slice(0, detected.range.start)}${newBlock}${text.slice(detected.range.end)}`;
      action = "replaced";
    }

    if (nextText === text) return changedResult(false, "noop", null);
    const backupPath = backupFile(filePath, opts);
    atomicWriteFile(filePath, nextText, 0o644);
    return changedResult(true, action, backupPath);
  },

  remove(filePath, beginMarker, endMarker, opts = {}) {
    if (!fs.existsSync(filePath)) return changedResult(false, "noop", null);
    const text = fs.readFileSync(filePath, "utf8");
    const detected = this.detect(filePath, beginMarker, endMarker);
    if (detected.malformed && !opts.force) {
      const error = new Error("sentinel block is malformed");
      error.code = "AIGENTRY_SENTINEL_MALFORMED";
      throw error;
    }
    if (!detected.present && !detected.malformed) return changedResult(false, "noop", null);
    const nextText = detected.malformed
      ? text.split(/(?<=\n)/).filter((line) => !line.includes(beginMarker) && !line.includes(endMarker)).join("")
      : `${text.slice(0, detected.range.start)}${text.slice(detected.range.end)}`.replace(/\n{3,}/g, "\n\n");
    if (nextText === text) return changedResult(false, "noop", null);
    const backupPath = backupFile(filePath, opts);
    atomicWriteFile(filePath, nextText, 0o644);
    return changedResult(true, "removed", backupPath);
  },
};

function normalizeScriptForHash(content, headerPattern = DEFAULT_HEADER_PATTERN) {
  let matched = false;
  const normalized = content.replace(headerPattern, (full) => {
    matched = true;
    return full.replace(/[0-9a-f]{64}/, HASH_ZERO);
  }).replace(/\{\{SCRIPT_SHA256\}\}/g, HASH_ZERO);
  return { normalized, matched };
}

function renderScriptWithHash(scriptBody, headerSha256Field = "SCRIPT_SHA256", headerPattern = DEFAULT_HEADER_PATTERN) {
  const placeholder = new RegExp(`\\{\\{${headerSha256Field}\\}\\}`, "g");
  const withZero = scriptBody.replace(placeholder, HASH_ZERO);
  const digest = sha256(normalizeScriptForHash(withZero, headerPattern).normalized);
  const rendered = scriptBody.replace(placeholder, digest);
  return { rendered, digest };
}

const scriptSha256 = {
  detect(scriptPath, expectedSha256 = null, headerPattern = DEFAULT_HEADER_PATTERN) {
    if (!fs.existsSync(scriptPath)) {
      return {
        exists: false,
        headerSha256: null,
        fileSha256: null,
        headerMatchesFile: false,
        headerMatchesExpected: false,
      };
    }
    const text = fs.readFileSync(scriptPath, "utf8");
    const match = text.match(headerPattern);
    const headerSha256 = match ? match[1] : null;
    const fileSha256 = sha256(normalizeScriptForHash(text, headerPattern).normalized);
    return {
      exists: true,
      headerSha256,
      fileSha256,
      headerMatchesFile: Boolean(headerSha256 && headerSha256 === fileSha256),
      headerMatchesExpected: Boolean(headerSha256 && expectedSha256 && headerSha256 === expectedSha256),
    };
  },

  write(scriptPath, scriptBody, headerSha256Field = "SCRIPT_SHA256", opts = {}) {
    const { rendered, digest } = renderScriptWithHash(scriptBody, headerSha256Field, opts.headerPattern || DEFAULT_HEADER_PATTERN);
    const exists = fs.existsSync(scriptPath);
    if (exists && fs.readFileSync(scriptPath, "utf8") === rendered) {
      const mode = scriptPath.endsWith(".sh") ? 0o755 : 0o644;
      fs.chmodSync(scriptPath, mode);
      return changedResult(false, "noop", null, { sha256: digest });
    }
    if (exists) {
      const detected = this.detect(scriptPath, null, opts.headerPattern || DEFAULT_HEADER_PATTERN);
      if (!opts.force && !detected.headerMatchesFile) {
        const error = new Error(`script ${scriptPath} appears user-modified (sha256 mismatch); refusing to overwrite without --force`);
        error.code = "AIGENTRY_SCRIPT_USER_MODIFIED";
        throw error;
      }
    }
    const backupPath = backupFile(scriptPath, opts);
    const mode = scriptPath.endsWith(".sh") ? 0o755 : 0o644;
    atomicWriteFile(scriptPath, rendered, mode);
    return changedResult(true, exists ? "replaced" : "created", backupPath, { sha256: digest });
  },

  render(scriptBody, headerSha256Field = "SCRIPT_SHA256", headerPattern = DEFAULT_HEADER_PATTERN) {
    return renderScriptWithHash(scriptBody, headerSha256Field, headerPattern);
  },
};

function unifiedDiff(oldText, newText) {
  if (oldText === newText) return "";
  const oldLines = oldText.length === 0 ? [] : oldText.split(/\n/);
  const newLines = newText.length === 0 ? [] : newText.split(/\n/);
  return [
    "--- before",
    "+++ after",
    ...oldLines.map((line) => `-${line}`),
    ...newLines.map((line) => `+${line}`),
  ].join("\n");
}

module.exports = {
  atomicWriteFile,
  backupFile,
  markdownSentinel,
  parseJsonFile,
  scriptSha256,
  sha256,
  unifiedDiff,
};
