#!/usr/bin/env node
/**
 * MCP Deliberation Server (Global) — v2 Multi-Session
 *
 * 모든 프로젝트에서 사용 가능한 AI 간 deliberation 서버.
 * 동시에 여러 deliberation을 병렬 진행할 수 있다.
 *
 * 상태 저장: ~/.local/lib/mcp-deliberation/state/{project-slug}/sessions/{id}.json
 *
 * Tools:
 *   deliberation_start        새 토론 시작 → session_id 반환
 *   deliberation_status       세션 상태 조회 (session_id 선택적)
 *   deliberation_list_active  진행 중인 모든 세션 목록
 *   deliberation_context      프로젝트 컨텍스트 로드
 *   deliberation_respond      응답 제출 (session_id 필수)
 *   deliberation_history      토론 기록 조회 (session_id 선택적)
 *   deliberation_synthesize   합성 보고서 생성 (session_id 선택적)
 *   deliberation_list         과거 아카이브 목록
 *   deliberation_reset        세션 초기화 (session_id 선택적, 없으면 전체)
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { execFileSync, execSync } from "child_process";
import fs from "fs";
import path from "path";
import os from "os";

// ── Paths ──────────────────────────────────────────────────────

const HOME = os.homedir();
const GLOBAL_STATE_DIR = path.join(HOME, ".local", "lib", "mcp-deliberation", "state");
const OBSIDIAN_VAULT = path.join(HOME, "Documents", "Obsidian Vault");
const OBSIDIAN_PROJECTS = path.join(OBSIDIAN_VAULT, "10-Projects");
const DEFAULT_SPEAKERS = ["claude", "codex"];

function getProjectSlug() {
  return path.basename(process.cwd());
}

function getProjectStateDir() {
  return path.join(GLOBAL_STATE_DIR, getProjectSlug());
}

function getSessionsDir() {
  return path.join(getProjectStateDir(), "sessions");
}

function getSessionFile(sessionId) {
  return path.join(getSessionsDir(), `${sessionId}.json`);
}

function getArchiveDir() {
  const obsidianDir = path.join(OBSIDIAN_PROJECTS, getProjectSlug(), "deliberations");
  if (fs.existsSync(path.join(OBSIDIAN_PROJECTS, getProjectSlug()))) {
    return obsidianDir;
  }
  return path.join(getProjectStateDir(), "archive");
}

function normalizeSpeaker(raw) {
  if (typeof raw !== "string") return null;
  const normalized = raw.trim().toLowerCase();
  if (!normalized || normalized === "none") return null;
  return normalized;
}

function buildSpeakerOrder(speakers, fallbackSpeaker = DEFAULT_SPEAKERS[0], fallbackPlacement = "front") {
  const ordered = [];
  const seen = new Set();

  const add = (candidate) => {
    const speaker = normalizeSpeaker(candidate);
    if (!speaker || seen.has(speaker)) return;
    seen.add(speaker);
    ordered.push(speaker);
  };

  if (fallbackPlacement === "front") {
    add(fallbackSpeaker);
  }

  if (Array.isArray(speakers)) {
    for (const speaker of speakers) {
      add(speaker);
    }
  }

  if (fallbackPlacement !== "front") {
    add(fallbackSpeaker);
  }

  if (ordered.length === 0) {
    for (const speaker of DEFAULT_SPEAKERS) {
      add(speaker);
    }
  }

  return ordered;
}

function normalizeSessionActors(state) {
  if (!state || typeof state !== "object") return state;

  const fallbackSpeaker = normalizeSpeaker(state.current_speaker)
    || normalizeSpeaker(state.log?.[0]?.speaker)
    || DEFAULT_SPEAKERS[0];
  const speakers = buildSpeakerOrder(state.speakers, fallbackSpeaker, "end");
  state.speakers = speakers;

  const normalizedCurrent = normalizeSpeaker(state.current_speaker);
  if (state.status === "active") {
    state.current_speaker = (normalizedCurrent && speakers.includes(normalizedCurrent))
      ? normalizedCurrent
      : speakers[0];
  } else if (normalizedCurrent) {
    state.current_speaker = normalizedCurrent;
  }

  return state;
}

// ── Session ID generation ─────────────────────────────────────

function generateSessionId(topic) {
  const slug = topic
    .replace(/[^a-zA-Z0-9가-힣\s-]/g, "")
    .replace(/\s+/g, "-")
    .toLowerCase()
    .slice(0, 20);
  const ts = Date.now().toString(36);
  return `${slug}-${ts}`;
}

// ── Context detection ──────────────────────────────────────────

function detectContextDirs() {
  const dirs = [];
  const slug = getProjectSlug();

  if (process.env.DELIBERATION_CONTEXT_DIR) {
    dirs.push(process.env.DELIBERATION_CONTEXT_DIR);
  }
  dirs.push(process.cwd());

  const obsidianProject = path.join(OBSIDIAN_PROJECTS, slug);
  if (fs.existsSync(obsidianProject)) {
    dirs.push(obsidianProject);
  }

  return [...new Set(dirs)];
}

function readContextFromDirs(dirs, maxChars = 15000) {
  let context = "";
  const seen = new Set();

  for (const dir of dirs) {
    if (!fs.existsSync(dir)) continue;

    const files = fs.readdirSync(dir)
      .filter(f => f.endsWith(".md") && !f.startsWith("_") && !f.startsWith("."))
      .sort();

    for (const file of files) {
      if (seen.has(file)) continue;
      seen.add(file);

      const fullPath = path.join(dir, file);
      let raw;
      try { raw = fs.readFileSync(fullPath, "utf-8"); } catch { continue; }

      let body = raw;
      if (body.startsWith("---")) {
        const end = body.indexOf("---", 3);
        if (end !== -1) body = body.slice(end + 3).trim();
      }

      const truncated = body.length > 1200
        ? body.slice(0, 1200) + "\n(...)"
        : body;

      context += `### ${file.replace(".md", "")}\n${truncated}\n\n---\n\n`;

      if (context.length > maxChars) {
        context = context.slice(0, maxChars) + "\n\n(...context truncated)";
        return context;
      }
    }
  }
  return context || "(컨텍스트 파일을 찾을 수 없습니다)";
}

// ── State helpers ──────────────────────────────────────────────

function ensureDirs() {
  fs.mkdirSync(getSessionsDir(), { recursive: true });
  fs.mkdirSync(getArchiveDir(), { recursive: true });
}

function loadSession(sessionId) {
  const file = getSessionFile(sessionId);
  if (!fs.existsSync(file)) return null;
  return normalizeSessionActors(JSON.parse(fs.readFileSync(file, "utf-8")));
}

function saveSession(state) {
  ensureDirs();
  state.updated = new Date().toISOString();
  fs.writeFileSync(getSessionFile(state.id), JSON.stringify(state, null, 2), "utf-8");
  syncMarkdown(state);
}

function listActiveSessions() {
  const dir = getSessionsDir();
  if (!fs.existsSync(dir)) return [];

  return fs.readdirSync(dir)
    .filter(f => f.endsWith(".json"))
    .map(f => {
      try {
        const data = JSON.parse(fs.readFileSync(path.join(dir, f), "utf-8"));
        return data;
      } catch { return null; }
    })
    .filter(s => s && (s.status === "active" || s.status === "awaiting_synthesis"));
}

function resolveSessionId(sessionId) {
  // session_id가 주어지면 그대로 사용
  if (sessionId) return sessionId;

  // 없으면 활성 세션이 1개일 때 자동 선택
  const active = listActiveSessions();
  if (active.length === 0) return null;
  if (active.length === 1) return active[0].id;

  // 여러 개면 null (목록 표시 필요)
  return "MULTIPLE";
}

function syncMarkdown(state) {
  const filename = `deliberation-${state.id}.md`;
  const mdPath = path.join(process.cwd(), filename);
  try {
    fs.writeFileSync(mdPath, stateToMarkdown(state), "utf-8");
  } catch {
    const fallback = path.join(getProjectStateDir(), filename);
    fs.writeFileSync(fallback, stateToMarkdown(state), "utf-8");
  }
}

function stateToMarkdown(s) {
  const speakerOrder = buildSpeakerOrder(s.speakers, s.current_speaker, "end");
  let md = `---
title: "Deliberation - ${s.topic}"
session_id: "${s.id}"
created: ${s.created}
updated: ${s.updated || new Date().toISOString()}
type: deliberation
status: ${s.status}
project: "${s.project}"
participants: ${JSON.stringify(speakerOrder)}
rounds: ${s.max_rounds}
current_round: ${s.current_round}
current_speaker: "${s.current_speaker}"
tags: [deliberation]
---

# Deliberation: ${s.topic}

**Session:** ${s.id} | **Project:** ${s.project} | **Status:** ${s.status} | **Round:** ${s.current_round}/${s.max_rounds} | **Next:** ${s.current_speaker}

---

`;

  if (s.synthesis) {
    md += `## Synthesis\n\n${s.synthesis}\n\n---\n\n`;
  }

  md += `## Debate Log\n\n`;
  for (const entry of s.log) {
    md += `### ${entry.speaker} — Round ${entry.round}\n\n`;
    md += `${entry.content}\n\n---\n\n`;
  }
  return md;
}

function archiveState(state) {
  ensureDirs();
  const slug = state.topic
    .replace(/[^a-zA-Z0-9가-힣\s-]/g, "")
    .replace(/\s+/g, "-")
    .slice(0, 30);
  const ts = new Date().toISOString().slice(0, 16).replace(/:/g, "");
  const filename = `deliberation-${ts}-${slug}.md`;
  const dest = path.join(getArchiveDir(), filename);
  fs.writeFileSync(dest, stateToMarkdown(state), "utf-8");
  return dest;
}

// ── Terminal management ────────────────────────────────────────

const TMUX_SESSION = "deliberation";
const MONITOR_SCRIPT = path.join(HOME, ".local", "lib", "mcp-deliberation", "session-monitor.sh");

function tmuxWindowName(sessionId) {
  // tmux 윈도우 이름은 짧게 (마지막 부분 제거하고 20자)
  return sessionId.replace(/[^a-zA-Z0-9가-힣-]/g, "").slice(0, 25);
}

function appleScriptQuote(value) {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

function listPhysicalTerminalWindowIds() {
  if (process.platform !== "darwin") {
    return [];
  }
  try {
    const output = execFileSync(
      "osascript",
      [
        "-e",
        'tell application "Terminal"',
        "-e",
        "if not running then return \"\"",
        "-e",
        "set outText to \"\"",
        "-e",
        "repeat with w in windows",
        "-e",
        "set outText to outText & (id of w as string) & linefeed",
        "-e",
        "end repeat",
        "-e",
        "return outText",
        "-e",
        "end tell",
      ],
      { encoding: "utf-8" }
    );
    return String(output)
      .split("\n")
      .map(s => Number.parseInt(s.trim(), 10))
      .filter(n => Number.isInteger(n) && n > 0);
  } catch {
    return [];
  }
}

function openPhysicalTerminal(sessionId) {
  if (process.platform !== "darwin") {
    return [];
  }

  const winName = tmuxWindowName(sessionId);
  const attachCmd = `tmux attach -t "${TMUX_SESSION}" \\; select-window -t "${TMUX_SESSION}:${winName}"`;
  const before = new Set(listPhysicalTerminalWindowIds());

  try {
    const output = execFileSync(
      "osascript",
      [
        "-e",
        'tell application "Terminal"',
        "-e",
        `do script ${appleScriptQuote(attachCmd)}`,
        "-e",
        "delay 0.15",
        "-e",
        "return id of front window",
        "-e",
        "end tell",
      ],
      { encoding: "utf-8" }
    );
    const frontId = Number.parseInt(String(output).trim(), 10);
    const after = listPhysicalTerminalWindowIds();
    const opened = after.filter(id => !before.has(id));
    if (opened.length > 0) {
      return [...new Set(opened)];
    }
    if (Number.isInteger(frontId) && frontId > 0) {
      return [frontId];
    }
    return [];
  } catch {
    return [];
  }
}

function spawnMonitorTerminal(sessionId) {
  const project = getProjectSlug();
  const winName = tmuxWindowName(sessionId);
  const cmd = `bash "${MONITOR_SCRIPT}" "${sessionId}" "${project}"`;

  try {
    // tmux 세션이 있으면 새 윈도우 추가
    try {
      execSync(`tmux has-session -t "${TMUX_SESSION}" 2>/dev/null`, { stdio: "ignore" });
      execSync(`tmux new-window -t "${TMUX_SESSION}" -n "${winName}" '${cmd}'`, { stdio: "ignore" });
    } catch {
      // tmux 세션이 없으면 새로 생성 (detached)
      execSync(`tmux new-session -d -s "${TMUX_SESSION}" -n "${winName}" '${cmd}'`, { stdio: "ignore" });
    }
    return true;
  } catch {
    return false;
  }
}

function closePhysicalTerminal(windowId) {
  if (process.platform !== "darwin") {
    return false;
  }
  if (!Number.isInteger(windowId) || windowId <= 0) {
    return false;
  }

  const windowExists = () => {
    try {
      const out = execFileSync(
        "osascript",
        [
          "-e",
          'tell application "Terminal"',
          "-e",
          `if exists window id ${windowId} then return "1"`,
          "-e",
          'return "0"',
          "-e",
          "end tell",
        ],
        { encoding: "utf-8" }
      ).trim();
      return out === "1";
    } catch {
      return false;
    }
  };

  const dismissCloseDialogs = () => {
    try {
      execFileSync(
        "osascript",
        [
          "-e",
          'tell application "System Events"',
          "-e",
          'if exists process "Terminal" then',
          "-e",
          'tell process "Terminal"',
          "-e",
          "repeat with w in windows",
          "-e",
          "try",
          "-e",
          "if exists (sheet 1 of w) then",
          "-e",
          "if exists button \"종료\" of sheet 1 of w then",
          "-e",
          'click button "종료" of sheet 1 of w',
          "-e",
          "else if exists button \"Terminate\" of sheet 1 of w then",
          "-e",
          'click button "Terminate" of sheet 1 of w',
          "-e",
          "else if exists button \"확인\" of sheet 1 of w then",
          "-e",
          'click button "확인" of sheet 1 of w',
          "-e",
          "else",
          "-e",
          "click button 1 of sheet 1 of w",
          "-e",
          "end if",
          "-e",
          "end if",
          "-e",
          "end try",
          "-e",
          "end repeat",
          "-e",
          "end tell",
          "-e",
          "end if",
          "-e",
          "end tell",
        ],
        { stdio: "ignore" }
      );
    } catch {
      // ignore
    }
  };

  for (let i = 0; i < 5; i += 1) {
    try {
      execFileSync(
        "osascript",
        [
          "-e",
          'tell application "Terminal"',
          "-e",
          "activate",
          "-e",
          `if exists window id ${windowId} then`,
          "-e",
          "try",
          "-e",
          `do script "exit" in window id ${windowId}`,
          "-e",
          "end try",
          "-e",
          "delay 0.12",
          "-e",
          "try",
          "-e",
          `close (window id ${windowId})`,
          "-e",
          "end try",
          "-e",
          "end if",
          "-e",
          "end tell",
        ],
        { stdio: "ignore" }
      );
    } catch {
      // ignore
    }

    dismissCloseDialogs();

    if (!windowExists()) {
      return true;
    }
  }

  return !windowExists();
}

function closeMonitorTerminal(sessionId, terminalWindowIds = []) {
  const winName = tmuxWindowName(sessionId);
  try {
    // 해당 윈도우만 닫기
    execSync(`tmux kill-window -t "${TMUX_SESSION}:${winName}" 2>/dev/null`, { stdio: "ignore" });

    // 남은 윈도우가 없으면 세션도 정리
    try {
      const count = execSync(`tmux list-windows -t "${TMUX_SESSION}" 2>/dev/null | wc -l`, { encoding: "utf-8" }).trim();
      if (parseInt(count) === 0) {
        execSync(`tmux kill-session -t "${TMUX_SESSION}" 2>/dev/null`, { stdio: "ignore" });
      }
    } catch { /* ignore */ }
  } catch { /* ignore */ }

  for (const windowId of terminalWindowIds) {
    closePhysicalTerminal(windowId);
  }
}

function getSessionWindowIds(state) {
  if (!state || typeof state !== "object") {
    return [];
  }
  const ids = [];
  if (Array.isArray(state.monitor_terminal_window_ids)) {
    for (const id of state.monitor_terminal_window_ids) {
      if (Number.isInteger(id) && id > 0) {
        ids.push(id);
      }
    }
  }
  if (Number.isInteger(state.monitor_terminal_window_id) && state.monitor_terminal_window_id > 0) {
    ids.push(state.monitor_terminal_window_id);
  }
  return [...new Set(ids)];
}

function closeAllMonitorTerminals() {
  try {
    execSync(`tmux kill-session -t "${TMUX_SESSION}" 2>/dev/null`, { stdio: "ignore" });
  } catch { /* ignore */ }
}

function multipleSessionsError() {
  const active = listActiveSessions();
  const list = active.map(s => `- **${s.id}**: "${s.topic}" (Round ${s.current_round}/${s.max_rounds}, next: ${s.current_speaker})`).join("\n");
  return `여러 활성 세션이 있습니다. session_id를 지정하세요:\n\n${list}`;
}

// ── MCP Server ─────────────────────────────────────────────────

const server = new McpServer({
  name: "mcp-deliberation",
  version: "2.0.0",
});

server.tool(
  "deliberation_start",
  "새 deliberation을 시작합니다. 여러 토론을 동시에 진행할 수 있습니다.",
  {
    topic: z.string().describe("토론 주제"),
    rounds: z.number().default(3).describe("라운드 수 (기본 3)"),
    first_speaker: z.string().trim().min(1).max(64).optional().describe("첫 발언자 CLI 이름 (미지정 시 speakers의 첫 항목)"),
    speakers: z.array(z.string().trim().min(1).max(64)).min(1).optional().describe("참가자 CLI 이름 목록 (예: [\"claude\", \"codex\", \"gemini\"])"),
  },
  async ({ topic, rounds, first_speaker, speakers }) => {
    const sessionId = generateSessionId(topic);
    const normalizedFirstSpeaker = normalizeSpeaker(first_speaker)
      || normalizeSpeaker(speakers?.[0])
      || DEFAULT_SPEAKERS[0];
    const speakerOrder = buildSpeakerOrder(speakers, normalizedFirstSpeaker, "front");

    const state = {
      id: sessionId,
      project: getProjectSlug(),
      topic,
      status: "active",
      max_rounds: rounds,
      current_round: 1,
      current_speaker: normalizedFirstSpeaker,
      speakers: speakerOrder,
      log: [],
      synthesis: null,
      monitor_terminal_window_ids: [],
      created: new Date().toISOString(),
      updated: new Date().toISOString(),
    };
    saveSession(state);

    const active = listActiveSessions();
    const tmuxOpened = spawnMonitorTerminal(sessionId);
    const terminalWindowIds = tmuxOpened ? openPhysicalTerminal(sessionId) : [];
    const physicalOpened = terminalWindowIds.length > 0;
    if (physicalOpened) {
      state.monitor_terminal_window_ids = terminalWindowIds;
      saveSession(state);
    }
    const terminalMsg = !tmuxOpened
      ? `\n⚠️ tmux를 찾을 수 없어 모니터 터미널 미생성`
      : physicalOpened
        ? `\n🖥️ 모니터 터미널 강제 오픈됨 (Terminal): tmux attach -t ${TMUX_SESSION}`
        : `\n⚠️ tmux 윈도우는 생성됐지만 Terminal 자동 오픈 실패. 수동 실행: tmux attach -t ${TMUX_SESSION}`;

    return {
      content: [{
        type: "text",
        text: `✅ Deliberation 시작!\n\n**세션:** ${sessionId}\n**프로젝트:** ${state.project}\n**주제:** ${topic}\n**라운드:** ${rounds}\n**참가자:** ${speakerOrder.join(", ")}\n**첫 발언:** ${state.current_speaker}\n**동시 진행 세션:** ${active.length}개${terminalMsg}\n\n💡 이후 도구 호출 시 session_id: "${sessionId}" 를 사용하세요.`,
      }],
    };
  }
);

server.tool(
  "deliberation_list_active",
  "현재 프로젝트에서 진행 중인 모든 deliberation 세션 목록을 반환합니다.",
  {},
  async () => {
    const active = listActiveSessions();
    if (active.length === 0) {
      return { content: [{ type: "text", text: "진행 중인 deliberation이 없습니다." }] };
    }

    let list = `## 진행 중인 Deliberation (${getProjectSlug()}) — ${active.length}개\n\n`;
    for (const s of active) {
      list += `### ${s.id}\n- **주제:** ${s.topic}\n- **상태:** ${s.status} | Round ${s.current_round}/${s.max_rounds} | Next: ${s.current_speaker}\n- **응답 수:** ${s.log.length}\n\n`;
    }
    return { content: [{ type: "text", text: list }] };
  }
);

server.tool(
  "deliberation_status",
  "deliberation 상태를 조회합니다. 활성 세션이 1개면 자동 선택, 여러 개면 session_id 필요.",
  {
    session_id: z.string().optional().describe("세션 ID (여러 세션 진행 중이면 필수)"),
  },
  async ({ session_id }) => {
    const resolved = resolveSessionId(session_id);
    if (!resolved) {
      return { content: [{ type: "text", text: "활성 deliberation이 없습니다. deliberation_start로 시작하세요." }] };
    }
    if (resolved === "MULTIPLE") {
      return { content: [{ type: "text", text: multipleSessionsError() }] };
    }

    const state = loadSession(resolved);
    if (!state) {
      return { content: [{ type: "text", text: `세션 "${resolved}"을 찾을 수 없습니다.` }] };
    }

    return {
      content: [{
        type: "text",
        text: `**세션:** ${state.id}\n**프로젝트:** ${state.project}\n**주제:** ${state.topic}\n**상태:** ${state.status}\n**라운드:** ${state.current_round}/${state.max_rounds}\n**참가자:** ${state.speakers.join(", ")}\n**현재 차례:** ${state.current_speaker}\n**응답 수:** ${state.log.length}`,
      }],
    };
  }
);

server.tool(
  "deliberation_context",
  "현재 프로젝트의 컨텍스트(md 파일들)를 로드합니다. CWD + Obsidian 자동 감지.",
  {},
  async () => {
    const dirs = detectContextDirs();
    const context = readContextFromDirs(dirs);
    return {
      content: [{
        type: "text",
        text: `## 프로젝트 컨텍스트 (${getProjectSlug()})\n\n**소스:** ${dirs.join(", ")}\n\n${context}`,
      }],
    };
  }
);

server.tool(
  "deliberation_respond",
  "현재 턴의 응답을 제출합니다.",
  {
    session_id: z.string().optional().describe("세션 ID (여러 세션 진행 중이면 필수)"),
    speaker: z.string().trim().min(1).max(64).describe("응답자 CLI 이름"),
    content: z.string().describe("응답 내용 (마크다운)"),
  },
  async ({ session_id, speaker, content }) => {
    const resolved = resolveSessionId(session_id);
    if (!resolved) {
      return { content: [{ type: "text", text: "활성 deliberation이 없습니다." }] };
    }
    if (resolved === "MULTIPLE") {
      return { content: [{ type: "text", text: multipleSessionsError() }] };
    }

    const state = loadSession(resolved);
    if (!state || state.status !== "active") {
      return { content: [{ type: "text", text: `세션 "${resolved}"이 활성 상태가 아닙니다.` }] };
    }

    const normalizedSpeaker = normalizeSpeaker(speaker);
    if (!normalizedSpeaker) {
      return { content: [{ type: "text", text: "speaker 값이 비어 있습니다. CLI 이름을 지정하세요." }] };
    }

    state.speakers = buildSpeakerOrder(state.speakers, state.current_speaker, "end");
    const normalizedCurrentSpeaker = normalizeSpeaker(state.current_speaker);
    if (!normalizedCurrentSpeaker || !state.speakers.includes(normalizedCurrentSpeaker)) {
      state.current_speaker = state.speakers[0];
    } else {
      state.current_speaker = normalizedCurrentSpeaker;
    }

    if (state.current_speaker !== normalizedSpeaker) {
      return {
        content: [{
          type: "text",
          text: `[${state.id}] 지금은 **${state.current_speaker}** 차례입니다. ${normalizedSpeaker}는 대기하세요.`,
        }],
      };
    }

    state.log.push({
      round: state.current_round,
      speaker: normalizedSpeaker,
      content,
      timestamp: new Date().toISOString(),
    });

    const idx = state.speakers.indexOf(normalizedSpeaker);
    const nextIdx = (idx + 1) % state.speakers.length;
    state.current_speaker = state.speakers[nextIdx];

    if (nextIdx === 0) {
      if (state.current_round >= state.max_rounds) {
        state.status = "awaiting_synthesis";
        state.current_speaker = "none";
        saveSession(state);
        return {
          content: [{
            type: "text",
            text: `✅ [${state.id}] ${normalizedSpeaker} Round ${state.log[state.log.length - 1].round} 완료.\n\n🏁 **모든 라운드 종료!**\ndeliberation_synthesize(session_id: "${state.id}")로 합성 보고서를 작성하세요.`,
          }],
        };
      }
      state.current_round += 1;
    }

    saveSession(state);
    return {
      content: [{
        type: "text",
        text: `✅ [${state.id}] ${normalizedSpeaker} Round ${state.log[state.log.length - 1].round} 완료.\n\n**다음:** ${state.current_speaker} (Round ${state.current_round})`,
      }],
    };
  }
);

server.tool(
  "deliberation_history",
  "토론 기록을 반환합니다.",
  {
    session_id: z.string().optional().describe("세션 ID (여러 세션 진행 중이면 필수)"),
  },
  async ({ session_id }) => {
    const resolved = resolveSessionId(session_id);
    if (!resolved) {
      return { content: [{ type: "text", text: "활성 deliberation이 없습니다." }] };
    }
    if (resolved === "MULTIPLE") {
      return { content: [{ type: "text", text: multipleSessionsError() }] };
    }

    const state = loadSession(resolved);
    if (!state) {
      return { content: [{ type: "text", text: `세션 "${resolved}"을 찾을 수 없습니다.` }] };
    }

    if (state.log.length === 0) {
      return {
        content: [{
          type: "text",
          text: `**세션:** ${state.id}\n**주제:** ${state.topic}\n\n아직 응답이 없습니다. **${state.current_speaker}**가 먼저 응답하세요.`,
        }],
      };
    }

    let history = `**세션:** ${state.id}\n**주제:** ${state.topic} | **상태:** ${state.status}\n\n`;
    for (const e of state.log) {
      history += `### ${e.speaker} — Round ${e.round}\n\n${e.content}\n\n---\n\n`;
    }
    return { content: [{ type: "text", text: history }] };
  }
);

server.tool(
  "deliberation_synthesize",
  "토론을 종료하고 합성 보고서를 제출합니다.",
  {
    session_id: z.string().optional().describe("세션 ID (여러 세션 진행 중이면 필수)"),
    synthesis: z.string().describe("합성 보고서 (마크다운)"),
  },
  async ({ session_id, synthesis }) => {
    const resolved = resolveSessionId(session_id);
    if (!resolved) {
      return { content: [{ type: "text", text: "활성 deliberation이 없습니다." }] };
    }
    if (resolved === "MULTIPLE") {
      return { content: [{ type: "text", text: multipleSessionsError() }] };
    }

    const state = loadSession(resolved);
    if (!state) {
      return { content: [{ type: "text", text: `세션 "${resolved}"을 찾을 수 없습니다.` }] };
    }

    state.synthesis = synthesis;
    state.status = "completed";
    state.current_speaker = "none";
    saveSession(state);

    const archivePath = archiveState(state);

    // 토론 종료 즉시 모니터 터미널(물리 Terminal 포함) 강제 종료
    closeMonitorTerminal(state.id, getSessionWindowIds(state));

    return {
      content: [{
        type: "text",
        text: `✅ [${state.id}] Deliberation 완료!\n\n**프로젝트:** ${state.project}\n**주제:** ${state.topic}\n**라운드:** ${state.max_rounds}\n**응답:** ${state.log.length}건\n\n📁 ${archivePath}\n🖥️ 모니터 터미널이 즉시 강제 종료되었습니다.`,
      }],
    };
  }
);

server.tool(
  "deliberation_list",
  "과거 deliberation 아카이브 목록을 반환합니다.",
  {},
  async () => {
    ensureDirs();
    const archiveDir = getArchiveDir();
    if (!fs.existsSync(archiveDir)) {
      return { content: [{ type: "text", text: "과거 deliberation이 없습니다." }] };
    }

    const files = fs.readdirSync(archiveDir)
      .filter(f => f.startsWith("deliberation-") && f.endsWith(".md"))
      .sort().reverse();

    if (files.length === 0) {
      return { content: [{ type: "text", text: "과거 deliberation이 없습니다." }] };
    }

    const list = files.map((f, i) => `${i + 1}. ${f.replace(".md", "")}`).join("\n");
    return { content: [{ type: "text", text: `## 과거 Deliberation (${getProjectSlug()})\n\n${list}` }] };
  }
);

server.tool(
  "deliberation_reset",
  "deliberation을 초기화합니다. session_id 지정 시 해당 세션만, 미지정 시 전체 초기화.",
  {
    session_id: z.string().optional().describe("초기화할 세션 ID (미지정 시 전체 초기화)"),
  },
  async ({ session_id }) => {
    ensureDirs();
    const sessionsDir = getSessionsDir();

    if (session_id) {
      // 특정 세션만 초기화
      const file = getSessionFile(session_id);
      if (fs.existsSync(file)) {
        const state = loadSession(session_id);
        if (state && state.log.length > 0) {
          archiveState(state);
        }
        fs.unlinkSync(file);
        closeMonitorTerminal(session_id, getSessionWindowIds(state));
        return { content: [{ type: "text", text: `✅ 세션 "${session_id}" 초기화 완료. 🖥️ 모니터 터미널 닫힘.` }] };
      }
      return { content: [{ type: "text", text: `세션 "${session_id}"을 찾을 수 없습니다.` }] };
    }

    // 전체 초기화
    if (!fs.existsSync(sessionsDir)) {
      return { content: [{ type: "text", text: "초기화할 세션이 없습니다." }] };
    }

    const files = fs.readdirSync(sessionsDir).filter(f => f.endsWith(".json"));
    let archived = 0;
    const terminalWindowIds = [];
    for (const f of files) {
      const filePath = path.join(sessionsDir, f);
      try {
        const state = JSON.parse(fs.readFileSync(filePath, "utf-8"));
        for (const id of getSessionWindowIds(state)) {
          terminalWindowIds.push(id);
        }
        if (state.log && state.log.length > 0) {
          archiveState(state);
          archived++;
        }
        fs.unlinkSync(filePath);
      } catch {
        fs.unlinkSync(filePath);
      }
    }

    for (const windowId of terminalWindowIds) {
      closePhysicalTerminal(windowId);
    }

    closeAllMonitorTerminals();

    return {
      content: [{
        type: "text",
        text: `✅ 전체 초기화 완료. ${files.length}개 세션 삭제, ${archived}개 아카이브됨. 🖥️ 모든 모니터 터미널 닫힘.`,
      }],
    };
  }
);

// ── Start ──────────────────────────────────────────────────────

const transport = new StdioServerTransport();
await server.connect(transport);
