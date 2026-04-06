"use strict";

const fs = require("fs");
const path = require("path");

const MD_FILES = ["AGENTS.md", "CLAUDE.md", "GEMINI.md"];

// Old patterns → new dynamic replacements
const REPLACEMENTS = [
  {
    pattern: /aigentry-orchestrator-claude/g,
    replacement: "$ATERM_ORCHESTRATOR_SESSION",
    description: "aigentry-orchestrator-claude → $ATERM_ORCHESTRATOR_SESSION",
  },
  {
    pattern: /aterm inject orchestrator\b/g,
    replacement: 'aterm inject "$ATERM_ORCHESTRATOR_SESSION"',
    description: 'aterm inject orchestrator → aterm inject "$ATERM_ORCHESTRATOR_SESSION"',
  },
];

// Session Communication Rules section to append if missing
const SESSION_COMM_SECTION = `
## Session Communication Rules / 세션 통신 규칙

- **respond/reply** = answer in current conversation. Default action. / 현재 대화에서 응답. 기본 동작.
- **inject** = send text to ANOTHER session. Only when explicitly requested. / 다른 세션에 텍스트 전송. 명시적 요청 시에만.
- **broadcast** = send to ALL sessions. Only when explicitly requested. / 모든 세션에 전송. 명시적 요청 시에만.

| User says / 사용자 요청 | Action / 동작 |
|--------------------------|---------------|
| "respond", "reply", "answer", "ACK" (no target) | Reply in current session / 현재 세션에서 응답 |
| "inject <target>", "send to <target>" | \`aterm inject\` / \`telepty inject\` |
| "broadcast" | \`aterm broadcast\` / \`telepty broadcast\` |
| Ambiguous / 모호한 경우 | Ask for clarification. Do NOT assume inject. / 확인 요청. inject 추정 금지. |

- NEVER inject unless cross-session intent is explicit. / 크로스 세션 의도가 명시적이지 않으면 절대 inject 금지.
- NEVER inject into your own session. / 자기 세션에 inject 금지.
- If \`$ATERM_IPC_SOCKET\` set: use \`aterm inject\` for internal, \`telepty inject\` for external. / 내부는 aterm, 외부는 telepty.
- If \`$ATERM_IPC_SOCKET\` unset: use \`telepty inject\`. / aterm 없으면 telepty 사용.
`;

/**
 * Update MD files in projects: replace old patterns, add missing sections.
 *
 * @param {object} opts
 * @param {string} [opts.projectPath] - Single project directory
 * @param {boolean} [opts.all] - Scan ~/projects/aigentry-*
 * @param {boolean} [opts.dryRun] - Show changes without writing
 * @returns {{ updated: object[], skipped: string[] }}
 */
function updateMd({ projectPath, all = false, dryRun = false } = {}) {
  const results = { updated: [], skipped: [] };

  // Resolve project dirs
  let projectDirs = [];
  if (all) {
    const home = process.env.HOME || process.env.USERPROFILE || "";
    const projectsDir = path.join(home, "projects");
    if (fs.existsSync(projectsDir)) {
      const entries = fs.readdirSync(projectsDir, { withFileTypes: true });
      projectDirs = entries
        .filter((e) => e.isDirectory() && e.name.startsWith("aigentry-"))
        .map((e) => path.join(projectsDir, e.name));
    }
    if (projectDirs.length === 0) {
      process.stdout.write("No aigentry-* projects found in ~/projects/\n");
      return results;
    }
  } else {
    projectDirs = [path.resolve(projectPath || process.cwd())];
  }

  for (const dir of projectDirs) {
    if (!fs.existsSync(dir)) continue;

    for (const mdFile of MD_FILES) {
      const filePath = path.join(dir, mdFile);
      if (!fs.existsSync(filePath)) continue;

      let content = fs.readFileSync(filePath, "utf-8");
      let changed = false;
      const changes = [];

      // 1. Apply pattern replacements
      for (const { pattern, replacement, description } of REPLACEMENTS) {
        const regex = new RegExp(pattern.source, pattern.flags);
        const matches = content.match(regex);
        if (matches && matches.length > 0) {
          content = content.replace(regex, replacement);
          changes.push(`${description} (${matches.length}x)`);
          changed = true;
        }
      }

      // 2. Append Session Communication Rules if missing (never delete)
      if (!content.includes("Session Communication Rules")) {
        content += SESSION_COMM_SECTION;
        changes.push("added Session Communication Rules section");
        changed = true;
      }

      if (changed) {
        if (dryRun) {
          process.stdout.write(`[dry-run] ${filePath}:\n`);
        } else {
          fs.writeFileSync(filePath, content);
          process.stdout.write(`Updated: ${filePath}\n`);
        }
        for (const c of changes) {
          process.stdout.write(`  - ${c}\n`);
        }
        results.updated.push({ file: filePath, changes });
      } else {
        results.skipped.push(filePath);
      }
    }
  }

  // Summary
  const prefix = dryRun ? "[dry-run] " : "";
  process.stdout.write(
    `\n${prefix}Summary: ${results.updated.length} files updated, ${results.skipped.length} files unchanged\n`
  );

  return results;
}

module.exports = { updateMd };
