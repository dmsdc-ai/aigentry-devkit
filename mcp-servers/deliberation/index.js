#!/usr/bin/env node
/**
 * MCP Deliberation Server (Global) — v2.5 Multi-Session + Transport Routing + Cross-Platform + BrowserControlPort
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
 *   deliberation_speaker_candidates      선택 가능한 스피커 후보(로컬 CLI + 브라우저 LLM 탭) 조회
 *   deliberation_browser_llm_tabs      브라우저 LLM 탭 목록 조회
 *   deliberation_clipboard_prepare_turn 브라우저 LLM용 턴 프롬프트를 클립보드로 복사
 *   deliberation_clipboard_submit_turn  클립보드 텍스트를 현재 턴 응답으로 제출
 *   deliberation_browser_auto_turn      브라우저 LLM에 자동으로 턴을 전송하고 응답을 수집 (CDP 기반)
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { execFileSync } from "child_process";
import fs from "fs";
import path from "path";
import os from "os";
import { OrchestratedBrowserPort } from "./browser-control-port.js";

// ── Paths ──────────────────────────────────────────────────────

const HOME = os.homedir();
const GLOBAL_STATE_DIR = path.join(HOME, ".local", "lib", "mcp-deliberation", "state");
const GLOBAL_RUNTIME_LOG = path.join(HOME, ".local", "lib", "mcp-deliberation", "runtime.log");
const OBSIDIAN_VAULT = path.join(HOME, "Documents", "Obsidian Vault");
const OBSIDIAN_PROJECTS = path.join(OBSIDIAN_VAULT, "10-Projects");
const DEFAULT_SPEAKERS = ["agent-a", "agent-b"];
const DEFAULT_CLI_CANDIDATES = [
  "claude",
  "codex",
  "gemini",
  "qwen",
  "chatgpt",
  "aider",
  "llm",
  "opencode",
  "cursor-agent",
  "cursor",
  "continue",
];
const MAX_AUTO_DISCOVERED_SPEAKERS = 12;

function loadDeliberationConfig() {
  const configPath = path.join(HOME, ".local", "lib", "mcp-deliberation", "config.json");
  try {
    return JSON.parse(fs.readFileSync(configPath, "utf-8"));
  } catch {
    return {};
  }
}

function saveDeliberationConfig(config) {
  const configPath = path.join(HOME, ".local", "lib", "mcp-deliberation", "config.json");
  config.updated = new Date().toISOString();
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
}

const DEFAULT_BROWSER_APPS = ["Google Chrome", "Brave Browser", "Arc", "Microsoft Edge", "Safari"];
const DEFAULT_LLM_DOMAINS = [
  "chatgpt.com",
  "openai.com",
  "claude.ai",
  "anthropic.com",
  "gemini.google.com",
  "copilot.microsoft.com",
  "poe.com",
  "perplexity.ai",
  "mistral.ai",
  "huggingface.co/chat",
  "deepseek.com",
  "qwen.ai",
  "notebooklm.google.com",
];

const PRODUCT_DISCLAIMER = "ℹ️ 이 도구는 외부 웹사이트를 영구 수정하지 않습니다. 브라우저 문맥을 읽기 전용으로 참조하여 발화자를 라우팅합니다.";
const LOCKS_SUBDIR = ".locks";
const LOCK_RETRY_MS = 25;
const LOCK_TIMEOUT_MS = 8000;
const LOCK_STALE_MS = 60000;

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

function getLocksDir() {
  return path.join(getProjectStateDir(), LOCKS_SUBDIR);
}

function formatRuntimeError(error) {
  if (error instanceof Error) {
    return error.stack || error.message;
  }
  return String(error);
}

function appendRuntimeLog(level, message) {
  try {
    fs.mkdirSync(path.dirname(GLOBAL_RUNTIME_LOG), { recursive: true });
    const line = `${new Date().toISOString()} [${level}] ${message}\n`;
    fs.appendFileSync(GLOBAL_RUNTIME_LOG, line, "utf-8");
  } catch {
    // ignore logging failures
  }
}

function safeToolHandler(toolName, handler) {
  return async (args) => {
    try {
      return await handler(args);
    } catch (error) {
      const message = formatRuntimeError(error);
      appendRuntimeLog("ERROR", `${toolName}: ${message}`);
      return { content: [{ type: "text", text: `❌ ${toolName} 실패: ${message}` }] };
    }
  };
}

function sleepMs(ms) {
  if (!Number.isFinite(ms) || ms <= 0) return;
  const sab = new SharedArrayBuffer(4);
  const arr = new Int32Array(sab);
  Atomics.wait(arr, 0, 0, Math.floor(ms));
}

function writeTextAtomic(filePath, text) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, text, "utf-8");
  fs.renameSync(tmp, filePath);
}

function acquireFileLock(lockPath, {
  timeoutMs = LOCK_TIMEOUT_MS,
  retryMs = LOCK_RETRY_MS,
  staleMs = LOCK_STALE_MS,
} = {}) {
  fs.mkdirSync(path.dirname(lockPath), { recursive: true });
  const token = `${process.pid}:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`;
  const startedAt = Date.now();

  while (true) {
    try {
      const fd = fs.openSync(lockPath, "wx");
      fs.writeFileSync(fd, token, "utf-8");
      fs.closeSync(fd);
      return token;
    } catch (error) {
      const isExists = error && typeof error === "object" && "code" in error && error.code === "EEXIST";
      if (!isExists) {
        throw error;
      }

      try {
        const stat = fs.statSync(lockPath);
        if (Date.now() - stat.mtimeMs > staleMs) {
          fs.unlinkSync(lockPath);
          continue;
        }
      } catch {
        // lock might have been removed concurrently
      }

      if (Date.now() - startedAt > timeoutMs) {
        throw new Error(`lock timeout: ${lockPath}`);
      }
      sleepMs(retryMs);
    }
  }
}

function releaseFileLock(lockPath, token) {
  try {
    const current = fs.readFileSync(lockPath, "utf-8").trim();
    if (current === token) {
      fs.unlinkSync(lockPath);
    }
  } catch {
    // already released or replaced
  }
}

function withFileLock(lockPath, fn, options) {
  const token = acquireFileLock(lockPath, options);
  try {
    return fn();
  } finally {
    releaseFileLock(lockPath, token);
  }
}

function withProjectLock(fn, options) {
  return withFileLock(path.join(getLocksDir(), "_project.lock"), fn, options);
}

function withSessionLock(sessionId, fn, options) {
  const safeId = String(sessionId).replace(/[^a-zA-Z0-9가-힣._-]/g, "_");
  return withFileLock(path.join(getLocksDir(), `${safeId}.lock`), fn, options);
}

function normalizeSpeaker(raw) {
  if (typeof raw !== "string") return null;
  const normalized = raw.trim().toLowerCase();
  if (!normalized || normalized === "none") return null;
  return normalized;
}

function dedupeSpeakers(items = []) {
  const out = [];
  const seen = new Set();
  for (const item of items) {
    const normalized = normalizeSpeaker(item);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    out.push(normalized);
  }
  return out;
}

function resolveCliCandidates() {
  const fromEnv = (process.env.DELIBERATION_CLI_CANDIDATES || "")
    .split(/[,\s]+/)
    .map(v => v.trim())
    .filter(Boolean);

  // If config has enabled_clis, use that as the primary filter
  const config = loadDeliberationConfig();
  if (Array.isArray(config.enabled_clis) && config.enabled_clis.length > 0) {
    return dedupeSpeakers([...fromEnv, ...config.enabled_clis]);
  }

  return dedupeSpeakers([...fromEnv, ...DEFAULT_CLI_CANDIDATES]);
}

function commandExistsInPath(command) {
  if (!command || !/^[a-zA-Z0-9._-]+$/.test(command)) {
    return false;
  }

  if (process.platform === "win32") {
    try {
      execFileSync("where", [command], { stdio: "ignore" });
      return true;
    } catch {
      // keep PATH scan fallback for shells where "where" is unavailable
    }
  }

  const pathVar = process.env.PATH || "";
  const dirs = pathVar.split(path.delimiter).filter(Boolean);
  if (dirs.length === 0) return false;

  const extensions = process.platform === "win32"
    ? ["", ".exe", ".cmd", ".bat", ".ps1"]
    : [""];

  for (const dir of dirs) {
    for (const ext of extensions) {
      const fullPath = path.join(dir, `${command}${ext}`);
      try {
        fs.accessSync(fullPath, fs.constants.X_OK);
        return true;
      } catch {
        // ignore and continue
      }
    }
  }
  return false;
}

function shellQuote(value) {
  return `'${String(value).replace(/'/g, "'\\''")}'`;
}

function discoverLocalCliSpeakers() {
  const found = [];
  for (const candidate of resolveCliCandidates()) {
    if (commandExistsInPath(candidate)) {
      found.push(candidate);
    }
    if (found.length >= MAX_AUTO_DISCOVERED_SPEAKERS) {
      break;
    }
  }
  return found;
}

function detectCallerSpeaker() {
  const hinted = normalizeSpeaker(process.env.DELIBERATION_CALLER_SPEAKER);
  if (hinted) return hinted;

  const pathHint = process.env.PATH || "";
  if (/\bCODEX_[A-Z0-9_]+\b/.test(Object.keys(process.env).join(" "))) {
    return "codex";
  }
  if (pathHint.includes("/.codex/")) {
    return "codex";
  }

  if (/\bCLAUDE_[A-Z0-9_]+\b/.test(Object.keys(process.env).join(" "))) {
    return "claude";
  }
  if (pathHint.includes("/.claude/")) {
    return "claude";
  }

  return null;
}

function resolveClipboardReader() {
  if (process.platform === "darwin" && commandExistsInPath("pbpaste")) {
    return { cmd: "pbpaste", args: [] };
  }
  if (process.platform === "win32") {
    const windowsShell = ["powershell.exe", "powershell", "pwsh.exe", "pwsh"]
      .find(cmd => commandExistsInPath(cmd));
    if (windowsShell) {
      return { cmd: windowsShell, args: ["-NoProfile", "-Command", "Get-Clipboard -Raw"] };
    }
  }
  if (commandExistsInPath("wl-paste")) {
    return { cmd: "wl-paste", args: ["-n"] };
  }
  if (commandExistsInPath("xclip")) {
    return { cmd: "xclip", args: ["-selection", "clipboard", "-o"] };
  }
  if (commandExistsInPath("xsel")) {
    return { cmd: "xsel", args: ["--clipboard", "--output"] };
  }
  return null;
}

function resolveClipboardWriter() {
  if (process.platform === "darwin" && commandExistsInPath("pbcopy")) {
    return { cmd: "pbcopy", args: [] };
  }
  if (process.platform === "win32") {
    if (commandExistsInPath("clip.exe") || commandExistsInPath("clip")) {
      return { cmd: "clip", args: [] };
    }
    const windowsShell = ["powershell.exe", "powershell", "pwsh.exe", "pwsh"]
      .find(cmd => commandExistsInPath(cmd));
    if (windowsShell) {
      return { cmd: windowsShell, args: ["-NoProfile", "-Command", "[Console]::In.ReadToEnd() | Set-Clipboard"] };
    }
  }
  if (commandExistsInPath("wl-copy")) {
    return { cmd: "wl-copy", args: [] };
  }
  if (commandExistsInPath("xclip")) {
    return { cmd: "xclip", args: ["-selection", "clipboard"] };
  }
  if (commandExistsInPath("xsel")) {
    return { cmd: "xsel", args: ["--clipboard", "--input"] };
  }
  return null;
}

function readClipboardText() {
  const tool = resolveClipboardReader();
  if (!tool) {
    throw new Error("지원되는 클립보드 읽기 명령이 없습니다 (pbpaste/wl-paste/xclip/xsel 등).");
  }
  return execFileSync(tool.cmd, tool.args, {
    encoding: "utf-8",
    stdio: ["ignore", "pipe", "pipe"],
    maxBuffer: 5 * 1024 * 1024,
  });
}

function writeClipboardText(text) {
  const tool = resolveClipboardWriter();
  if (!tool) {
    throw new Error("지원되는 클립보드 쓰기 명령이 없습니다 (pbcopy/wl-copy/xclip/xsel 등).");
  }
  execFileSync(tool.cmd, tool.args, {
    input: text,
    encoding: "utf-8",
    stdio: ["pipe", "ignore", "pipe"],
    maxBuffer: 5 * 1024 * 1024,
  });
}

function isLlmUrl(url = "") {
  const value = String(url || "").trim();
  if (!value) return false;
  try {
    const parsed = new URL(value);
    const host = parsed.hostname.toLowerCase();
    return DEFAULT_LLM_DOMAINS.some(domain => host === domain || host.endsWith(`.${domain}`));
  } catch {
    const lowered = value.toLowerCase();
    return DEFAULT_LLM_DOMAINS.some(domain => lowered.includes(domain));
  }
}

function dedupeBrowserTabs(tabs = []) {
  const out = [];
  const seen = new Set();
  for (const tab of tabs) {
    const browser = String(tab?.browser || "").trim();
    const title = String(tab?.title || "").trim();
    const url = String(tab?.url || "").trim();
    if (!url || !isLlmUrl(url)) continue;
    const key = `${browser}\t${title}\t${url}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      browser: browser || "Browser",
      title: title || "(untitled)",
      url,
    });
  }
  return out;
}

function parseInjectedBrowserTabsFromEnv() {
  const raw = process.env.DELIBERATION_BROWSER_TABS_JSON;
  if (!raw) {
    return { tabs: [], note: null };
  }

  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return { tabs: [], note: "DELIBERATION_BROWSER_TABS_JSON 형식 오류: JSON 배열이어야 합니다." };
    }

    const tabs = dedupeBrowserTabs(parsed.map(item => ({
      browser: item?.browser || "External Bridge",
      title: item?.title || "(untitled)",
      url: item?.url || "",
    })));
    return {
      tabs,
      note: tabs.length > 0 ? `환경변수 탭 주입 사용: ${tabs.length}개` : "DELIBERATION_BROWSER_TABS_JSON에 유효한 LLM URL이 없습니다.",
    };
  } catch (error) {
    const reason = error instanceof Error ? error.message : "unknown error";
    return { tabs: [], note: `DELIBERATION_BROWSER_TABS_JSON 파싱 실패: ${reason}` };
  }
}

function normalizeCdpEndpoint(raw) {
  const value = String(raw || "").trim();
  if (!value) return null;

  const withProto = /^https?:\/\//i.test(value) ? value : `http://${value}`;
  try {
    const url = new URL(withProto);
    if (!url.pathname || url.pathname === "/") {
      url.pathname = "/json/list";
    }
    return url.toString();
  } catch {
    return null;
  }
}

function resolveCdpEndpoints() {
  const fromEnv = (process.env.DELIBERATION_BROWSER_CDP_ENDPOINTS || "")
    .split(/[,\s]+/)
    .map(v => normalizeCdpEndpoint(v))
    .filter(Boolean);
  if (fromEnv.length > 0) {
    return [...new Set(fromEnv)];
  }

  const ports = (process.env.DELIBERATION_BROWSER_CDP_PORTS || "9222,9223,9333")
    .split(/[,\s]+/)
    .map(v => Number.parseInt(v, 10))
    .filter(v => Number.isInteger(v) && v > 0 && v < 65536);

  const endpoints = [];
  for (const port of ports) {
    endpoints.push(`http://127.0.0.1:${port}/json/list`);
    endpoints.push(`http://localhost:${port}/json/list`);
  }
  return [...new Set(endpoints)];
}

async function fetchJson(url, timeoutMs = 900) {
  if (typeof fetch !== "function") {
    throw new Error("fetch API unavailable in current Node runtime");
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      method: "GET",
      signal: controller.signal,
      headers: { "accept": "application/json" },
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

function inferBrowserFromCdpEndpoint(endpoint) {
  try {
    const parsed = new URL(endpoint);
    const port = Number.parseInt(parsed.port, 10);
    if (port === 9222) return "Google Chrome (CDP)";
    if (port === 9223) return "Microsoft Edge (CDP)";
    if (port === 9333) return "Brave Browser (CDP)";
    return `Browser (CDP:${parsed.host})`;
  } catch {
    return "Browser (CDP)";
  }
}

function summarizeFailures(items = [], max = 3) {
  if (!Array.isArray(items) || items.length === 0) return null;
  const shown = items.slice(0, max);
  const suffix = items.length > max ? ` 외 ${items.length - max}개` : "";
  return `${shown.join(", ")}${suffix}`;
}

async function collectBrowserLlmTabsViaCdp() {
  const endpoints = resolveCdpEndpoints();
  const tabs = [];
  const failures = [];

  for (const endpoint of endpoints) {
    try {
      const payload = await fetchJson(endpoint);
      if (!Array.isArray(payload)) {
        throw new Error("unexpected payload");
      }

      const browser = inferBrowserFromCdpEndpoint(endpoint);
      for (const item of payload) {
        if (!item || String(item.type) !== "page") continue;
        const url = String(item.url || "").trim();
        if (!isLlmUrl(url)) continue;
        tabs.push({
          browser,
          title: String(item.title || "").trim() || "(untitled)",
          url,
        });
      }
    } catch (error) {
      const reason = error instanceof Error ? error.message : "unknown error";
      failures.push(`${endpoint} (${reason})`);
    }
  }

  const uniqTabs = dedupeBrowserTabs(tabs);
  if (uniqTabs.length > 0) {
    const failSummary = summarizeFailures(failures);
    return {
      tabs: uniqTabs,
      note: failSummary ? `일부 CDP 엔드포인트 접근 실패: ${failSummary}` : null,
    };
  }

  const failSummary = summarizeFailures(failures);
  return {
    tabs: [],
    note: `CDP에서 LLM 탭을 찾지 못했습니다. 브라우저를 --remote-debugging-port=9222로 실행하거나 DELIBERATION_BROWSER_TABS_JSON으로 탭 목록을 주입하세요.${failSummary ? ` (실패: ${failSummary})` : ""}`,
  };
}

function collectBrowserLlmTabsViaAppleScript() {
  if (process.platform !== "darwin") {
    return { tabs: [], note: "AppleScript 탭 스캔은 macOS에서만 지원됩니다." };
  }

  const escapedDomains = DEFAULT_LLM_DOMAINS.map(d => d.replace(/"/g, '\\"'));
  const escapedApps = DEFAULT_BROWSER_APPS.map(a => a.replace(/"/g, '\\"'));
  const domainList = `{${escapedDomains.map(d => `"${d}"`).join(", ")}}`;
  const appList = `{${escapedApps.map(a => `"${a}"`).join(", ")}}`;

  const script = [
    `set llmDomains to ${domainList}`,
    `set browserApps to ${appList}`,
    "set outText to \"\"",
    // Pre-check running apps via System Events (no locate dialog)
    "tell application \"System Events\"",
    "set runningApps to name of every application process",
    "end tell",
    "repeat with appName in browserApps",
    "if runningApps contains (appName as string) then",
    "try",
    "tell application (appName as string)",
    "if (appName as string) is \"Safari\" then",
    "repeat with w in windows",
    "try",
    "repeat with t in tabs of w",
    "set u to URL of t as string",
    "set matched to false",
    "repeat with d in llmDomains",
    "if u contains (d as string) then set matched to true",
    "end repeat",
    "if matched then set outText to outText & (appName as string) & tab & (name of t as string) & tab & u & linefeed",
    "end repeat",
    "end try",
    "end repeat",
    "else",
    "repeat with w in windows",
    "try",
    "repeat with t in tabs of w",
    "set u to URL of t as string",
    "set matched to false",
    "repeat with d in llmDomains",
    "if u contains (d as string) then set matched to true",
    "end repeat",
    "if matched then set outText to outText & (appName as string) & tab & (title of t as string) & tab & u & linefeed",
    "end repeat",
    "end try",
    "end repeat",
    "end if",
    "end tell",
    "on error errMsg",
    "set outText to outText & (appName as string) & tab & \"ERROR\" & tab & errMsg & linefeed",
    "end try",
    "end if",
    "end repeat",
    "return outText",
  ];

  try {
    const raw = execFileSync("osascript", script.flatMap(line => ["-e", line]), {
      encoding: "utf-8",
      timeout: 8000,
      maxBuffer: 2 * 1024 * 1024,
    });
    const rows = String(raw)
      .split("\n")
      .map(line => line.trim())
      .filter(Boolean)
      .map(line => {
        const [browser = "", title = "", url = ""] = line.split("\t");
        return { browser, title, url };
      });
    const tabs = rows.filter(r => r.title !== "ERROR");
    const errors = rows.filter(r => r.title === "ERROR");
    return {
      tabs,
      note: errors.length > 0
        ? `일부 브라우저 접근 실패: ${errors.map(e => `${e.browser} (${e.url})`).join(", ")}`
        : null,
    };
  } catch (error) {
    const reason = error instanceof Error ? error.message : "unknown error";
    return {
      tabs: [],
      note: `브라우저 탭 스캔 실패: ${reason}. macOS 자동화 권한(터미널 -> 브라우저 제어)을 확인하세요.`,
    };
  }
}

async function collectBrowserLlmTabs() {
  const mode = (process.env.DELIBERATION_BROWSER_SCAN_MODE || "auto").trim().toLowerCase();
  const tabs = [];
  const notes = [];

  const injected = parseInjectedBrowserTabsFromEnv();
  tabs.push(...injected.tabs);
  if (injected.note) notes.push(injected.note);

  if (mode === "off") {
    return {
      tabs: dedupeBrowserTabs(tabs),
      note: notes.length > 0 ? notes.join(" | ") : "브라우저 탭 자동 스캔이 비활성화되었습니다.",
    };
  }

  const shouldUseAppleScript = mode === "auto" || mode === "applescript";
  if (shouldUseAppleScript && process.platform === "darwin") {
    const mac = collectBrowserLlmTabsViaAppleScript();
    tabs.push(...mac.tabs);
    if (mac.note) notes.push(mac.note);
  } else if (mode === "applescript" && process.platform !== "darwin") {
    notes.push("AppleScript 스캔은 macOS 전용입니다. CDP 스캔으로 전환하세요.");
  }

  const shouldUseCdp = mode === "auto" || mode === "cdp";
  if (shouldUseCdp) {
    const cdp = await collectBrowserLlmTabsViaCdp();
    tabs.push(...cdp.tabs);
    if (cdp.note) notes.push(cdp.note);
  }

  const uniqTabs = dedupeBrowserTabs(tabs);
  return {
    tabs: uniqTabs,
    note: notes.length > 0 ? notes.join(" | ") : null,
  };
}

function inferLlmProvider(url = "") {
  const value = String(url).toLowerCase();
  if (value.includes("claude.ai") || value.includes("anthropic.com")) return "claude";
  if (value.includes("chatgpt.com") || value.includes("openai.com")) return "chatgpt";
  if (value.includes("gemini.google.com") || value.includes("notebooklm.google.com")) return "gemini";
  if (value.includes("copilot.microsoft.com")) return "copilot";
  if (value.includes("perplexity.ai")) return "perplexity";
  if (value.includes("poe.com")) return "poe";
  if (value.includes("mistral.ai")) return "mistral";
  if (value.includes("huggingface.co/chat")) return "huggingface";
  if (value.includes("deepseek.com")) return "deepseek";
  if (value.includes("qwen.ai")) return "qwen";
  return "web-llm";
}

async function collectSpeakerCandidates({ include_cli = true, include_browser = true } = {}) {
  const candidates = [];
  const seen = new Set();

  const add = (candidate) => {
    const speaker = normalizeSpeaker(candidate?.speaker);
    if (!speaker || seen.has(speaker)) return;
    seen.add(speaker);
    candidates.push({ ...candidate, speaker });
  };

  if (include_cli) {
    for (const cli of discoverLocalCliSpeakers()) {
      add({
        speaker: cli,
        type: "cli",
        label: cli,
        command: cli,
      });
    }
  }

  let browserNote = null;
  if (include_browser) {
    const { tabs, note } = await collectBrowserLlmTabs();
    browserNote = note || null;
    const providerCounts = new Map();
    for (const tab of tabs) {
      const provider = inferLlmProvider(tab.url);
      const count = (providerCounts.get(provider) || 0) + 1;
      providerCounts.set(provider, count);
      add({
        speaker: `web-${provider}-${count}`,
        type: "browser",
        provider,
        browser: tab.browser || "",
        title: tab.title || "",
        url: tab.url || "",
      });
    }

    // CDP auto-detection: probe endpoints for matching tabs
    const cdpEndpoints = resolveCdpEndpoints();
    const cdpTabs = [];
    for (const endpoint of cdpEndpoints) {
      try {
        const tabs = await fetchJson(endpoint, 2000);
        if (Array.isArray(tabs)) {
          for (const t of tabs) {
            if (t.type === "page" && t.url) cdpTabs.push(t);
          }
        }
      } catch { /* endpoint not reachable */ }
    }

    // Match CDP tabs with discovered browser candidates
    for (const candidate of candidates) {
      if (candidate.type !== "browser") continue;
      let candidateHost = "";
      try {
        candidateHost = new URL(candidate.url).hostname.toLowerCase();
      } catch { continue; }
      if (!candidateHost) continue;
      const matches = cdpTabs.filter(t => {
        try {
          return new URL(t.url).hostname.toLowerCase() === candidateHost;
        } catch { return false; }
      });
      if (matches.length === 1) {
        candidate.cdp_available = true;
        candidate.cdp_tab_id = matches[0].id;
        candidate.cdp_ws_url = matches[0].webSocketDebuggerUrl;
      }
    }
  }

  return { candidates, browserNote };
}

function formatSpeakerCandidatesReport({ candidates, browserNote }) {
  const cli = candidates.filter(c => c.type === "cli");
  const browser = candidates.filter(c => c.type === "browser");

  let out = "## Selectable Speakers\n\n";
  out += "### CLI\n";
  if (cli.length === 0) {
    out += "- (감지된 로컬 CLI 없음)\n\n";
  } else {
    out += `${cli.map(c => `- \`${c.speaker}\` (command: ${c.command})`).join("\n")}\n\n`;
  }

  out += "### Browser LLM\n";
  if (browser.length === 0) {
    out += "- (감지된 브라우저 LLM 탭 없음)\n";
  } else {
    out += `${browser.map(c => {
      const icon = c.cdp_available ? "⚡자동" : "📋클립보드";
      return `- \`${c.speaker}\` [${icon}] [${c.browser}] ${c.title}\n  ${c.url}`;
    }).join("\n")}\n`;
  }

  if (browserNote) {
    out += `\n\nℹ️ ${browserNote}`;
  }
  return out;
}

function mapParticipantProfiles(speakers, candidates, typeOverrides) {
  const bySpeaker = new Map();
  for (const c of candidates || []) {
    const key = normalizeSpeaker(c.speaker);
    if (key) bySpeaker.set(key, c);
  }

  const overrides = typeOverrides || {};

  const profiles = [];
  for (const raw of speakers || []) {
    const speaker = normalizeSpeaker(raw);
    if (!speaker) continue;

    // Check for explicit type override
    const overrideType = overrides[speaker] || overrides[raw];
    if (overrideType) {
      profiles.push({
        speaker,
        type: overrideType,
        ...(overrideType === "browser_auto" ? { provider: "chatgpt" } : {}),
      });
      continue;
    }

    const candidate = bySpeaker.get(speaker);
    if (!candidate) {
      profiles.push({
        speaker,
        type: "manual",
      });
      continue;
    }

    if (candidate.type === "cli") {
      profiles.push({
        speaker,
        type: "cli",
        command: candidate.command || speaker,
      });
      continue;
    }

    const effectiveType = candidate.cdp_available ? "browser_auto" : "browser";
    profiles.push({
      speaker,
      type: effectiveType,
      provider: candidate.provider || null,
      browser: candidate.browser || null,
      title: candidate.title || null,
      url: candidate.url || null,
    });
  }
  return profiles;
}

// ── Transport routing ─────────────────────────────────────────

const TRANSPORT_TYPES = {
  cli: "cli_respond",
  browser: "clipboard",
  browser_auto: "browser_auto",
  manual: "manual",
};

// BrowserControlPort singleton — initialized lazily on first use
let _browserPort = null;
function getBrowserPort() {
  if (!_browserPort) {
    const cdpEndpoints = resolveCdpEndpoints();
    _browserPort = new OrchestratedBrowserPort({ cdpEndpoints });
  }
  return _browserPort;
}

function resolveTransportForSpeaker(state, speaker) {
  const normalizedSpeaker = normalizeSpeaker(speaker);
  if (!normalizedSpeaker || !state?.participant_profiles) {
    return { transport: "manual", reason: "no_profile" };
  }
  const profile = state.participant_profiles.find(
    p => normalizeSpeaker(p.speaker) === normalizedSpeaker
  );
  if (!profile) {
    return { transport: "manual", reason: "speaker_not_in_profiles" };
  }
  const transport = TRANSPORT_TYPES[profile.type] || "manual";
  return { transport, profile, reason: null };
}

function formatTransportGuidance(transport, state, speaker) {
  const sid = state.id;
  switch (transport) {
    case "cli_respond":
      return `CLI speaker입니다. \`deliberation_respond(session_id: "${sid}", speaker: "${speaker}", content: "...")\`로 직접 응답하세요.`;
    case "clipboard":
      return `브라우저 LLM speaker입니다. 다음 순서로 진행하세요:\n1. \`deliberation_clipboard_prepare_turn(session_id: "${sid}")\` → 클립보드에 프롬프트 복사\n2. 브라우저 LLM에 붙여넣고 응답 생성\n3. 응답을 복사한 뒤 \`deliberation_clipboard_submit_turn(session_id: "${sid}", speaker: "${speaker}")\` 호출`;
    case "browser_auto":
      return `자동 브라우저 speaker입니다. \`deliberation_browser_auto_turn(session_id: "${sid}")\`으로 자동 진행됩니다. CDP를 통해 브라우저 LLM에 직접 입력하고 응답을 읽습니다.`;
    case "manual":
    default:
      return `수동 speaker입니다. 응답을 직접 작성해 \`deliberation_respond(session_id: "${sid}", speaker: "${speaker}", content: "...")\`로 제출하세요.`;
  }
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
  const rand = Math.random().toString(36).slice(2, 6);
  return `${slug}-${ts}${rand}`;
}

function generateTurnId() {
  return `t-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
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
  fs.mkdirSync(getLocksDir(), { recursive: true });
}

function loadSession(sessionId) {
  const file = getSessionFile(sessionId);
  if (!fs.existsSync(file)) return null;
  return normalizeSessionActors(JSON.parse(fs.readFileSync(file, "utf-8")));
}

function saveSession(state) {
  ensureDirs();
  state.updated = new Date().toISOString();
  writeTextAtomic(getSessionFile(state.id), JSON.stringify(state, null, 2));
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
  // Write to state dir instead of CWD to avoid polluting project root
  const mdPath = path.join(getProjectStateDir(), filename);
  try {
    writeTextAtomic(mdPath, stateToMarkdown(state));
  } catch { /* ignore sync failures */ }
}

function cleanupSyncMarkdown(state) {
  const filename = `deliberation-${state.id}.md`;
  // Remove from state dir
  const statePath = path.join(getProjectStateDir(), filename);
  try { fs.unlinkSync(statePath); } catch { /* ignore */ }
  // Also clean up legacy files in CWD (from older versions)
  const cwdPath = path.join(process.cwd(), filename);
  try { fs.unlinkSync(cwdPath); } catch { /* ignore */ }
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
    if (entry.channel_used || entry.fallback_reason) {
      const parts = [];
      if (entry.channel_used) parts.push(`channel: ${entry.channel_used}`);
      if (entry.fallback_reason) parts.push(`fallback: ${entry.fallback_reason}`);
      md += `> _${parts.join(" | ")}_\n\n`;
    }
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
  writeTextAtomic(dest, stateToMarkdown(state));
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

function tryExecFile(command, args = []) {
  try {
    execFileSync(command, args, { stdio: "ignore", windowsHide: true });
    return true;
  } catch {
    return false;
  }
}

function resolveMonitorShell() {
  if (commandExistsInPath("bash")) return "bash";
  if (commandExistsInPath("sh")) return "sh";
  return null;
}

function buildMonitorCommand(sessionId, project) {
  const shell = resolveMonitorShell();
  if (!shell) return null;
  return `${shell} ${shellQuote(MONITOR_SCRIPT)} ${shellQuote(sessionId)} ${shellQuote(project)}`;
}

function hasTmuxSession(name) {
  try {
    execFileSync("tmux", ["has-session", "-t", name], { stdio: "ignore", windowsHide: true });
    return true;
  } catch {
    return false;
  }
}

function tmuxWindowCount(name) {
  try {
    const output = execFileSync("tmux", ["list-windows", "-t", name], {
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"],
      windowsHide: true,
    });
    return String(output)
      .split("\n")
      .map(line => line.trim())
      .filter(Boolean)
      .length;
  } catch {
    return 0;
  }
}

function buildTmuxAttachCommand(sessionId) {
  const winName = tmuxWindowName(sessionId);
  return `tmux attach -t ${shellQuote(TMUX_SESSION)} \\; select-window -t ${shellQuote(`${TMUX_SESSION}:${winName}`)}`;
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
  const winName = tmuxWindowName(sessionId);
  const attachCmd = `tmux attach -t "${TMUX_SESSION}" \\; select-window -t "${TMUX_SESSION}:${winName}"`;

  if (process.platform === "darwin") {
    const before = new Set(listPhysicalTerminalWindowIds());
    try {
      const output = execFileSync(
        "osascript",
        [
          "-e",
          'tell application "Terminal"',
          "-e",
          "activate",
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
        return { opened: true, windowIds: [...new Set(opened)] };
      }
      if (Number.isInteger(frontId) && frontId > 0) {
        return { opened: true, windowIds: [frontId] };
      }
      return { opened: false, windowIds: [] };
    } catch {
      return { opened: false, windowIds: [] };
    }
  }

  if (process.platform === "linux") {
    const shell = resolveMonitorShell() || "sh";
    const launchCmd = `${buildTmuxAttachCommand(sessionId)}; exec ${shell}`;
    const attempts = [
      ["gnome-terminal", ["--", shell, "-lc", launchCmd]],
      ["kgx", ["--", shell, "-lc", launchCmd]],
      ["konsole", ["-e", shell, "-lc", launchCmd]],
      ["x-terminal-emulator", ["-e", shell, "-lc", launchCmd]],
      ["xterm", ["-e", shell, "-lc", launchCmd]],
      ["alacritty", ["-e", shell, "-lc", launchCmd]],
      ["kitty", [shell, "-lc", launchCmd]],
      ["wezterm", ["start", "--", shell, "-lc", launchCmd]],
    ];

    for (const [command, args] of attempts) {
      if (!commandExistsInPath(command)) continue;
      if (tryExecFile(command, args)) {
        return { opened: true, windowIds: [] };
      }
    }
    return { opened: false, windowIds: [] };
  }

  if (process.platform === "win32") {
    const attachForWindows = `tmux attach -t "${TMUX_SESSION}"`;
    if ((commandExistsInPath("wt.exe") || commandExistsInPath("wt"))
      && tryExecFile("wt", ["new-tab", "powershell", "-NoExit", "-Command", attachForWindows])) {
      return { opened: true, windowIds: [] };
    }

    const shell = ["powershell.exe", "powershell", "pwsh.exe", "pwsh"]
      .find(cmd => commandExistsInPath(cmd));
    if (shell) {
      const targetShell = shell.toLowerCase().startsWith("pwsh") ? "pwsh" : "powershell";
      const escaped = attachForWindows.replace(/'/g, "''");
      const script = `Start-Process ${targetShell} -ArgumentList '-NoExit','-Command','${escaped}'`;
      if (tryExecFile(shell, ["-NoProfile", "-Command", script])) {
        return { opened: true, windowIds: [] };
      }
    }
  }

  return { opened: false, windowIds: [] };
}

function spawnMonitorTerminal(sessionId) {
  if (!commandExistsInPath("tmux")) {
    return false;
  }

  const project = getProjectSlug();
  const winName = tmuxWindowName(sessionId);
  const cmd = buildMonitorCommand(sessionId, project);
  if (!cmd) {
    return false;
  }

  try {
    if (hasTmuxSession(TMUX_SESSION)) {
      execFileSync("tmux", ["new-window", "-t", TMUX_SESSION, "-n", winName, cmd], {
        stdio: "ignore",
        windowsHide: true,
      });
    } else {
      execFileSync("tmux", ["new-session", "-d", "-s", TMUX_SESSION, "-n", winName, cmd], {
        stdio: "ignore",
        windowsHide: true,
      });
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
    execFileSync("tmux", ["kill-window", "-t", `${TMUX_SESSION}:${winName}`], {
      stdio: "ignore",
      windowsHide: true,
    });
  } catch { /* ignore */ }

  try {
    if (tmuxWindowCount(TMUX_SESSION) === 0) {
      execFileSync("tmux", ["kill-session", "-t", TMUX_SESSION], {
        stdio: "ignore",
        windowsHide: true,
      });
    }
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
    execFileSync("tmux", ["kill-session", "-t", TMUX_SESSION], { stdio: "ignore", windowsHide: true });
  } catch { /* ignore */ }
}

function multipleSessionsError() {
  const active = listActiveSessions();
  const list = active.map(s => `- **${s.id}**: "${s.topic}" (Round ${s.current_round}/${s.max_rounds}, next: ${s.current_speaker})`).join("\n");
  return `여러 활성 세션이 있습니다. session_id를 지정하세요:\n\n${list}`;
}

function formatRecentLogForPrompt(state, maxEntries = 4) {
  const entries = Array.isArray(state.log) ? state.log.slice(-Math.max(0, maxEntries)) : [];
  if (entries.length === 0) {
    return "(아직 이전 응답 없음)";
  }
  return entries.map(e => {
    const content = String(e.content || "").trim();
    return `- ${e.speaker} (Round ${e.round})\n${content}`;
  }).join("\n\n");
}

function buildClipboardTurnPrompt(state, speaker, prompt, includeHistoryEntries = 4) {
  const recent = formatRecentLogForPrompt(state, includeHistoryEntries);
  const extraPrompt = prompt ? `\n[추가 지시]\n${prompt}\n` : "";
  return `[deliberation_turn_request]
session_id: ${state.id}
project: ${state.project}
topic: ${state.topic}
round: ${state.current_round}/${state.max_rounds}
target_speaker: ${speaker}
required_turn: ${state.current_speaker}

[recent_log]
${recent}
[/recent_log]${extraPrompt}

[response_rule]
- 위 토론 맥락을 반영해 ${speaker}의 이번 턴 응답만 작성
- 마크다운 본문만 출력 (불필요한 머리말/꼬리말 금지)
[/response_rule]
[/deliberation_turn_request]
`;
}

function submitDeliberationTurn({ session_id, speaker, content, turn_id, channel_used, fallback_reason }) {
  const resolved = resolveSessionId(session_id);
  if (!resolved) {
    return { content: [{ type: "text", text: "활성 deliberation이 없습니다." }] };
  }
  if (resolved === "MULTIPLE") {
    return { content: [{ type: "text", text: multipleSessionsError() }] };
  }

  return withSessionLock(resolved, () => {
    const state = loadSession(resolved);
    if (!state || state.status !== "active") {
      return { content: [{ type: "text", text: `세션 "${resolved}"이 활성 상태가 아닙니다.` }] };
    }

    const normalizedSpeaker = normalizeSpeaker(speaker);
    if (!normalizedSpeaker) {
      return { content: [{ type: "text", text: "speaker 값이 비어 있습니다. 응답자 이름을 지정하세요." }] };
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

    // turn_id 검증 (선택적 — 제공 시 반드시 일치해야 함)
    if (turn_id && state.pending_turn_id && turn_id !== state.pending_turn_id) {
      return {
        content: [{
          type: "text",
          text: `[${state.id}] turn_id 불일치. 예상: "${state.pending_turn_id}", 수신: "${turn_id}". 오래된 요청이거나 중복 제출일 수 있습니다.`,
        }],
      };
    }

    state.log.push({
      round: state.current_round,
      speaker: normalizedSpeaker,
      content,
      timestamp: new Date().toISOString(),
      turn_id: state.pending_turn_id || null,
      channel_used: channel_used || null,
      fallback_reason: fallback_reason || null,
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

    if (state.status === "active") {
      state.pending_turn_id = generateTurnId();
    }

    saveSession(state);
    return {
      content: [{
        type: "text",
        text: `✅ [${state.id}] ${normalizedSpeaker} Round ${state.log[state.log.length - 1].round} 완료.\n\n**다음:** ${state.current_speaker} (Round ${state.current_round})`,
      }],
    };
  });
}

// ── MCP Server ─────────────────────────────────────────────────

process.on("uncaughtException", (error) => {
  const message = formatRuntimeError(error);
  appendRuntimeLog("UNCAUGHT_EXCEPTION", message);
  try {
    process.stderr.write(`[mcp-deliberation] uncaughtException: ${message}\n`);
  } catch {
    // ignore stderr write failures
  }
});

process.on("unhandledRejection", (reason) => {
  const message = formatRuntimeError(reason);
  appendRuntimeLog("UNHANDLED_REJECTION", message);
  try {
    process.stderr.write(`[mcp-deliberation] unhandledRejection: ${message}\n`);
  } catch {
    // ignore stderr write failures
  }
});

const server = new McpServer({
  name: "mcp-deliberation",
  version: "2.4.0",
});

server.tool(
  "deliberation_start",
  "새 deliberation을 시작합니다. 여러 토론을 동시에 진행할 수 있습니다.",
  {
    topic: z.string().describe("토론 주제"),
    rounds: z.number().default(3).describe("라운드 수 (기본 3)"),
    first_speaker: z.string().trim().min(1).max(64).optional().describe("첫 발언자 이름 (미지정 시 speakers의 첫 항목)"),
    speakers: z.array(z.string().trim().min(1).max(64)).min(1).optional().describe("참가자 이름 목록 (예: codex, claude, web-chatgpt-1)"),
    require_manual_speakers: z.boolean().default(true).describe("true면 speakers를 반드시 직접 지정해야 시작"),
    auto_discover_speakers: z.boolean().default(false).describe("speakers 생략 시 PATH 기반 자동 탐색 여부 (require_manual_speakers=false일 때만 사용)"),
    participant_types: z.record(z.string(), z.enum(["cli", "browser", "browser_auto", "manual"])).optional().describe("speaker별 타입 오버라이드 (예: {\"chatgpt\": \"browser_auto\"})"),
  },
  safeToolHandler("deliberation_start", async ({ topic, rounds, first_speaker, speakers, require_manual_speakers, auto_discover_speakers, participant_types }) => {
    const sessionId = generateSessionId(topic);
    const hasManualSpeakers = Array.isArray(speakers) && speakers.length > 0;
    const candidateSnapshot = await collectSpeakerCandidates({ include_cli: true, include_browser: true });

    if (!hasManualSpeakers && require_manual_speakers) {
      const candidateText = formatSpeakerCandidatesReport(candidateSnapshot);
      return {
        content: [{
          type: "text",
          text: `스피커를 직접 선택해야 deliberation을 시작할 수 있습니다.\n\n${candidateText}\n\n예시:\n\ndeliberation_start(\n  topic: "${topic.replace(/"/g, '\\"')}",\n  rounds: ${rounds},\n  speakers: ["codex", "web-claude-1", "web-chatgpt-1"],\n  first_speaker: "codex"\n)\n\n먼저 deliberation_speaker_candidates를 호출해 현재 선택 가능한 스피커를 확인하세요.`,
        }],
      };
    }

    const autoDiscoveredSpeakers = (!hasManualSpeakers && auto_discover_speakers)
      ? discoverLocalCliSpeakers()
      : [];
    const selectedSpeakers = dedupeSpeakers(hasManualSpeakers
      ? speakers
      : autoDiscoveredSpeakers);
    const callerSpeaker = (!hasManualSpeakers && !first_speaker)
      ? detectCallerSpeaker()
      : null;

    const normalizedFirstSpeaker = normalizeSpeaker(first_speaker)
      || normalizeSpeaker(hasManualSpeakers ? selectedSpeakers?.[0] : callerSpeaker)
      || normalizeSpeaker(selectedSpeakers?.[0])
      || DEFAULT_SPEAKERS[0];
    const speakerOrder = buildSpeakerOrder(selectedSpeakers, normalizedFirstSpeaker, "front");
    const participantMode = hasManualSpeakers
      ? "수동 지정"
      : (autoDiscoveredSpeakers.length > 0 ? "자동 탐색(PATH)" : "기본값");

    const state = {
      id: sessionId,
      project: getProjectSlug(),
      topic,
      status: "active",
      max_rounds: rounds,
      current_round: 1,
      current_speaker: normalizedFirstSpeaker,
      speakers: speakerOrder,
      participant_profiles: mapParticipantProfiles(speakerOrder, candidateSnapshot.candidates, participant_types),
      log: [],
      synthesis: null,
      pending_turn_id: generateTurnId(),
      monitor_terminal_window_ids: [],
      created: new Date().toISOString(),
      updated: new Date().toISOString(),
    };
    withSessionLock(sessionId, () => {
      saveSession(state);
    });

    const active = listActiveSessions();
    const tmuxOpened = spawnMonitorTerminal(sessionId);
    const terminalOpenResult = tmuxOpened
      ? openPhysicalTerminal(sessionId)
      : { opened: false, windowIds: [] };
    const terminalWindowIds = Array.isArray(terminalOpenResult.windowIds)
      ? terminalOpenResult.windowIds
      : [];
    const physicalOpened = terminalOpenResult.opened === true;
    if (terminalWindowIds.length > 0) {
      withSessionLock(sessionId, () => {
        const latest = loadSession(sessionId);
        if (!latest) return;
        latest.monitor_terminal_window_ids = terminalWindowIds;
        saveSession(latest);
      });
      state.monitor_terminal_window_ids = terminalWindowIds;
    }
    const terminalMsg = !tmuxOpened
      ? `\n⚠️ tmux를 찾을 수 없어 모니터 터미널 미생성`
      : physicalOpened
        ? `\n🖥️ 모니터 터미널 오픈됨: tmux attach -t ${TMUX_SESSION}`
        : `\n⚠️ tmux 윈도우는 생성됐지만 외부 터미널 자동 오픈 실패. 수동 실행: tmux attach -t ${TMUX_SESSION}`;
    const manualNotDetected = hasManualSpeakers
      ? speakerOrder.filter(s => !candidateSnapshot.candidates.some(c => c.speaker === s))
      : [];
    const detectWarning = manualNotDetected.length > 0
      ? `\n\n⚠️ 현재 환경에서 즉시 검출되지 않은 speaker: ${manualNotDetected.join(", ")}\n(수동 지정으로는 참가 가능)`
      : "";

    const transportSummary = state.participant_profiles.map(p => {
      const { transport } = resolveTransportForSpeaker(state, p.speaker);
      return `  - \`${p.speaker}\`: ${transport} (${p.type})`;
    }).join("\n");

    return {
      content: [{
        type: "text",
        text: `✅ Deliberation 시작!\n\n**세션:** ${sessionId}\n**프로젝트:** ${state.project}\n**주제:** ${topic}\n**라운드:** ${rounds}\n**참가자 구성:** ${participantMode}\n**참가자:** ${speakerOrder.join(", ")}\n**첫 발언:** ${state.current_speaker}\n**동시 진행 세션:** ${active.length}개${terminalMsg}${detectWarning}\n\n**Transport 라우팅:**\n${transportSummary}\n\n💡 이후 도구 호출 시 session_id: "${sessionId}" 를 사용하세요.`,
      }],
    };
  })
);

server.tool(
  "deliberation_speaker_candidates",
  "사용자가 선택 가능한 스피커 후보(로컬 CLI + 브라우저 LLM 탭)를 조회합니다.",
  {
    include_cli: z.boolean().default(true).describe("로컬 CLI 후보 포함"),
    include_browser: z.boolean().default(true).describe("브라우저 LLM 탭 후보 포함"),
  },
  async ({ include_cli, include_browser }) => {
    const snapshot = await collectSpeakerCandidates({ include_cli, include_browser });
    const text = formatSpeakerCandidatesReport(snapshot);
    return { content: [{ type: "text", text: `${text}\n\n${PRODUCT_DISCLAIMER}` }] };
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
  "deliberation_browser_llm_tabs",
  "현재 브라우저에서 열려 있는 LLM 탭(chatgpt/claude/gemini 등)을 조회합니다.",
  {},
  async () => {
    const { tabs, note } = await collectBrowserLlmTabs();
    if (tabs.length === 0) {
      const suffix = note ? `\n\n${note}` : "";
      return { content: [{ type: "text", text: `감지된 LLM 탭이 없습니다.${suffix}` }] };
    }

    const lines = tabs.map((t, i) => `${i + 1}. [${t.browser}] ${t.title}\n   ${t.url}`).join("\n");
    const noteLine = note ? `\n\nℹ️ ${note}` : "";
    return { content: [{ type: "text", text: `## Browser LLM Tabs\n\n${lines}${noteLine}\n\n${PRODUCT_DISCLAIMER}` }] };
  }
);

server.tool(
  "deliberation_clipboard_prepare_turn",
  "현재 턴 요청 프롬프트를 생성해 클립보드에 복사합니다. 브라우저 LLM에 붙여넣어 사용하세요.",
  {
    session_id: z.string().optional().describe("세션 ID (여러 세션 진행 중이면 필수)"),
    speaker: z.string().trim().min(1).max(64).optional().describe("대상 speaker (미지정 시 현재 차례)"),
    prompt: z.string().optional().describe("브라우저 LLM에 추가로 전달할 지시"),
    include_history_entries: z.number().int().min(0).max(12).default(4).describe("프롬프트에 포함할 최근 로그 개수"),
  },
  async ({ session_id, speaker, prompt, include_history_entries }) => {
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

    const targetSpeaker = normalizeSpeaker(speaker) || normalizeSpeaker(state.current_speaker) || state.speakers[0];
    if (targetSpeaker !== state.current_speaker) {
      return {
        content: [{
          type: "text",
          text: `[${state.id}] 지금은 **${state.current_speaker}** 차례입니다. prepare 대상 speaker는 현재 차례와 같아야 합니다.`,
        }],
      };
    }

    const payload = buildClipboardTurnPrompt(state, targetSpeaker, prompt, include_history_entries);
    try {
      writeClipboardText(payload);
    } catch (error) {
      const message = error instanceof Error ? error.message : "unknown error";
      return { content: [{ type: "text", text: `클립보드 복사 실패: ${message}` }] };
    }

    return {
      content: [{
        type: "text",
        text: `✅ [${state.id}] 턴 프롬프트를 클립보드에 복사했습니다.\n\n**대상 speaker:** ${targetSpeaker}\n**라운드:** ${state.current_round}/${state.max_rounds}\n\n다음 단계:\n1. 브라우저 LLM에 붙여넣고 응답 생성\n2. 응답 본문을 복사\n3. deliberation_clipboard_submit_turn(session_id: "${state.id}", speaker: "${targetSpeaker}") 호출\n\n${PRODUCT_DISCLAIMER}`,
      }],
    };
  }
);

server.tool(
  "deliberation_clipboard_submit_turn",
  "클립보드 텍스트(또는 content)를 현재 턴 응답으로 제출합니다.",
  {
    session_id: z.string().optional().describe("세션 ID (여러 세션 진행 중이면 필수)"),
    speaker: z.string().trim().min(1).max(64).describe("응답자 이름"),
    content: z.string().optional().describe("응답 내용 (미지정 시 클립보드 텍스트 사용)"),
    trim_content: z.boolean().default(false).describe("응답 앞뒤 공백 제거 여부"),
    turn_id: z.string().optional().describe("턴 검증 ID"),
  },
  safeToolHandler("deliberation_clipboard_submit_turn", async ({ session_id, speaker, content, trim_content, turn_id }) => {
    let body = content;
    if (typeof body !== "string") {
      try {
        body = readClipboardText();
      } catch (error) {
        const message = error instanceof Error ? error.message : "unknown error";
        return { content: [{ type: "text", text: `클립보드 읽기 실패: ${message}` }] };
      }
    }

    if (trim_content) {
      body = body.trim();
    }
    if (!body || body.trim().length === 0) {
      return { content: [{ type: "text", text: "제출할 응답이 비어 있습니다. 클립보드 또는 content를 확인하세요." }] };
    }

    return submitDeliberationTurn({ session_id, speaker, content: body, turn_id, channel_used: "clipboard" });
  })
);

server.tool(
  "deliberation_route_turn",
  "현재 턴의 speaker에 맞는 transport를 자동 결정하고 안내합니다. CLI speaker는 자동 응답 경로, 브라우저 speaker는 클립보드 경로로 라우팅합니다.",
  {
    session_id: z.string().optional().describe("세션 ID (여러 세션 진행 중이면 필수)"),
    auto_prepare_clipboard: z.boolean().default(true).describe("브라우저 speaker일 때 자동으로 클립보드 prepare 실행"),
    prompt: z.string().optional().describe("브라우저 LLM에 추가로 전달할 지시"),
    include_history_entries: z.number().int().min(0).max(12).default(4).describe("프롬프트에 포함할 최근 로그 개수"),
  },
  safeToolHandler("deliberation_route_turn", async ({ session_id, auto_prepare_clipboard, prompt, include_history_entries }) => {
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

    const speaker = state.current_speaker;
    const { transport, profile, reason } = resolveTransportForSpeaker(state, speaker);
    const guidance = formatTransportGuidance(transport, state, speaker);
    const turnId = state.pending_turn_id || null;

    let extra = "";

    if (transport === "clipboard" && auto_prepare_clipboard) {
      // 자동으로 클립보드 prepare 실행
      const payload = buildClipboardTurnPrompt(state, speaker, prompt, include_history_entries);
      try {
        writeClipboardText(payload);
        extra = `\n\n✅ 클립보드에 턴 프롬프트가 자동 복사되었습니다.`;
      } catch (error) {
        const message = error instanceof Error ? error.message : "unknown error";
        extra = `\n\n⚠️ 클립보드 자동 복사 실패: ${message}\n수동으로 deliberation_clipboard_prepare_turn을 호출하세요.`;
      }
    }

    if (transport === "browser_auto") {
      // Auto-execute browser_auto_turn
      try {
        const port = getBrowserPort();
        const sessionId = state.id;
        const turnSpeaker = speaker;
        const turnProvider = profile?.provider || "chatgpt";

        // Build prompt
        const turnPrompt = buildClipboardTurnPrompt(state, turnSpeaker, prompt, include_history_entries);

        // Attach
        const attachResult = await port.attach(sessionId, { provider: turnProvider, url: profile?.url });
        if (!attachResult.ok) throw new Error(`attach failed: ${attachResult.error?.message}`);

        // Send turn
        const autoTurnId = turnId || `auto-${Date.now()}`;
        const sendResult = await port.sendTurnWithDegradation(sessionId, autoTurnId, turnPrompt);
        if (!sendResult.ok) throw new Error(`send failed: ${sendResult.error?.message}`);

        // Wait for response
        const waitResult = await port.waitTurnResult(sessionId, autoTurnId, 45);
        const degradationState = port.getDegradationState(sessionId);
        await port.detach(sessionId);

        if (waitResult.ok && waitResult.data?.response) {
          // Auto-submit the response
          submitDeliberationTurn({
            session_id: sessionId,
            speaker: turnSpeaker,
            content: waitResult.data.response,
            turn_id: state.pending_turn_id || generateTurnId(),
            channel_used: "browser_auto",
            fallback_reason: null,
          });
          extra = `\n\n⚡ 자동 실행 완료! 브라우저 LLM 응답이 자동으로 제출되었습니다. (${waitResult.data.elapsedMs}ms)`;
        } else {
          throw new Error(waitResult.error?.message || "no response received");
        }
      } catch (autoErr) {
        // Fallback to clipboard
        const errMsg = autoErr instanceof Error ? autoErr.message : String(autoErr);
        const payload = buildClipboardTurnPrompt(state, speaker, prompt, include_history_entries);
        try {
          writeClipboardText(payload);
          extra = `\n\n⚠️ 자동 실행 실패 (${errMsg}). 클립보드 모드로 폴백했습니다.\n✅ 클립보드에 턴 프롬프트가 복사되었습니다.`;
        } catch (clipErr) {
          extra = `\n\n⚠️ 자동 실행 실패 (${errMsg}). 클립보드 복사도 실패했습니다.\n수동으로 deliberation_clipboard_prepare_turn을 호출하세요.`;
        }
      }
    }

    const profileInfo = profile
      ? `\n**프로필:** ${profile.type}${profile.url ? ` | ${profile.url}` : ""}${profile.command ? ` | command: ${profile.command}` : ""}`
      : "";

    return {
      content: [{
        type: "text",
        text: `## 턴 라우팅 — ${state.id}\n\n**현재 speaker:** ${speaker}\n**Transport:** ${transport}${reason ? ` (fallback: ${reason})` : ""}${profileInfo}\n**Turn ID:** ${turnId || "(없음)"}\n**라운드:** ${state.current_round}/${state.max_rounds}\n\n${guidance}${extra}\n\n${PRODUCT_DISCLAIMER}`,
      }],
    };
  })
);

server.tool(
  "deliberation_browser_auto_turn",
  "브라우저 LLM에 자동으로 턴을 전송하고 응답을 수집합니다 (CDP 기반).",
  {
    session_id: z.string().optional().describe("세션 ID (여러 세션 진행 중이면 필수)"),
    provider: z.string().optional().default("chatgpt").describe("LLM 프로바이더 (chatgpt, claude, gemini)"),
    timeout_sec: z.number().optional().default(45).describe("응답 대기 타임아웃 (초)"),
  },
  safeToolHandler("deliberation_browser_auto_turn", async ({ session_id, provider, timeout_sec }) => {
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

    const speaker = state.current_speaker;
    if (speaker === "none") {
      return { content: [{ type: "text", text: "현재 발언 차례인 speaker가 없습니다." }] };
    }

    const { transport } = resolveTransportForSpeaker(state, speaker);
    if (transport !== "browser_auto" && transport !== "clipboard") {
      return { content: [{ type: "text", text: `speaker "${speaker}"는 브라우저 타입이 아닙니다 (transport: ${transport}). CLI speaker는 deliberation_respond를 사용하세요.` }] };
    }

    const turnId = state.pending_turn_id || generateTurnId();
    const port = getBrowserPort();

    // Step 1: Attach
    const attachResult = await port.attach(resolved, { provider });
    if (!attachResult.ok) {
      return { content: [{ type: "text", text: `❌ 브라우저 탭 바인딩 실패: ${attachResult.error.message}\n\n**에러 코드:** ${attachResult.error.code}\n**도메인:** ${attachResult.error.domain}\n\nCDP 디버깅 포트가 활성화된 브라우저가 실행 중인지 확인하세요.\n\`google-chrome --remote-debugging-port=9222\`\n\n${PRODUCT_DISCLAIMER}` }] };
    }

    // Step 2: Build turn prompt
    const turnPrompt = buildClipboardTurnPrompt(state, speaker, null, 3);

    // Step 3: Send turn with degradation
    const sendResult = await port.sendTurnWithDegradation(resolved, turnId, turnPrompt);
    if (!sendResult.ok) {
      // Fallback to clipboard
      return submitDeliberationTurn({
        session_id: resolved,
        speaker,
        content: `[browser_auto 실패 — fallback] ${sendResult.error.message}`,
        turn_id: turnId,
        channel_used: "browser_auto_fallback",
        fallback_reason: sendResult.error.code,
      });
    }

    // Step 4: Wait for response
    const waitResult = await port.waitTurnResult(resolved, turnId, timeout_sec);
    if (!waitResult.ok) {
      return { content: [{ type: "text", text: `⏱️ 브라우저 LLM 응답 대기 타임아웃 (${timeout_sec}초)\n\n**에러:** ${waitResult.error.message}\n\nclipboard fallback으로 수동 진행하세요:\n1. \`deliberation_clipboard_prepare_turn(session_id: "${resolved}")\`\n2. 브라우저에 붙여넣기\n3. \`deliberation_clipboard_submit_turn(session_id: "${resolved}")\`\n\n${PRODUCT_DISCLAIMER}` }] };
    }

    // Step 5: Submit the response
    const response = waitResult.data.response;
    const result = submitDeliberationTurn({
      session_id: resolved,
      speaker,
      content: response,
      turn_id: turnId,
      channel_used: "browser_auto",
      fallback_reason: null,
    });

    // Step 6: Capture degradation state before detach
    const degradationState = port.getDegradationState(resolved);

    await port.detach(resolved);
    const degradationInfo = degradationState
      ? `\n**Degradation:** ${JSON.stringify(degradationState)}`
      : "";

    return {
      content: [{
        type: "text",
        text: `✅ 브라우저 자동 턴 완료!\n\n**Provider:** ${provider}\n**Turn ID:** ${turnId}\n**응답 길이:** ${response.length}자\n**소요 시간:** ${waitResult.data.elapsedMs}ms${degradationInfo}\n\n${result.content[0].text}`,
      }],
    };
  })
);

server.tool(
  "deliberation_respond",
  "현재 턴의 응답을 제출합니다.",
  {
    session_id: z.string().optional().describe("세션 ID (여러 세션 진행 중이면 필수)"),
    speaker: z.string().trim().min(1).max(64).describe("응답자 이름"),
    content: z.string().describe("응답 내용 (마크다운)"),
    turn_id: z.string().optional().describe("턴 검증 ID (deliberation_route_turn에서 받은 값)"),
  },
  safeToolHandler("deliberation_respond", async ({ session_id, speaker, content, turn_id }) => {
    return submitDeliberationTurn({ session_id, speaker, content, turn_id, channel_used: "cli_respond" });
  })
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
  safeToolHandler("deliberation_synthesize", async ({ session_id, synthesis }) => {
    const resolved = resolveSessionId(session_id);
    if (!resolved) {
      return { content: [{ type: "text", text: "활성 deliberation이 없습니다." }] };
    }
    if (resolved === "MULTIPLE") {
      return { content: [{ type: "text", text: multipleSessionsError() }] };
    }

    let state = null;
    let archivePath = null;
    const lockedResult = withSessionLock(resolved, () => {
      const loaded = loadSession(resolved);
      if (!loaded) {
        return { content: [{ type: "text", text: `세션 "${resolved}"을 찾을 수 없습니다.` }] };
      }

      loaded.synthesis = synthesis;
      loaded.status = "completed";
      loaded.current_speaker = "none";
      saveSession(loaded);
      archivePath = archiveState(loaded);
      cleanupSyncMarkdown(loaded);
      state = loaded;
      return null;
    });
    if (lockedResult) {
      return lockedResult;
    }

    // 토론 종료 즉시 모니터 터미널(물리 Terminal 포함) 강제 종료
    closeMonitorTerminal(state.id, getSessionWindowIds(state));

    return {
      content: [{
        type: "text",
        text: `✅ [${state.id}] Deliberation 완료!\n\n**프로젝트:** ${state.project}\n**주제:** ${state.topic}\n**라운드:** ${state.max_rounds}\n**응답:** ${state.log.length}건\n\n📁 ${archivePath}\n🖥️ 모니터 터미널이 즉시 강제 종료되었습니다.`,
      }],
    };
  })
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
  safeToolHandler("deliberation_reset", async ({ session_id }) => {
    ensureDirs();
    const sessionsDir = getSessionsDir();

    if (session_id) {
      // 특정 세션만 초기화
      let toCloseIds = [];
      const result = withSessionLock(session_id, () => {
        const file = getSessionFile(session_id);
        if (!fs.existsSync(file)) {
          return { content: [{ type: "text", text: `세션 "${session_id}"을 찾을 수 없습니다.` }] };
        }
        const state = loadSession(session_id);
        if (state && state.log.length > 0) {
          archiveState(state);
        }
        if (state) cleanupSyncMarkdown(state);
        toCloseIds = getSessionWindowIds(state);
        fs.unlinkSync(file);
        return { content: [{ type: "text", text: `✅ 세션 "${session_id}" 초기화 완료. 🖥️ 모니터 터미널 닫힘.` }] };
      });
      if (toCloseIds.length > 0) {
        closeMonitorTerminal(session_id, toCloseIds);
      }
      return result;
    }

    // 전체 초기화
    const resetResult = withProjectLock(() => {
      if (!fs.existsSync(sessionsDir)) {
        return { files: [], archived: 0, terminalWindowIds: [], noSessions: true };
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
          cleanupSyncMarkdown(state);
          fs.unlinkSync(filePath);
        } catch {
          try {
            fs.unlinkSync(filePath);
          } catch {
            // ignore deletion race
          }
        }
      }

      return { files, archived, terminalWindowIds, noSessions: false };
    });

    if (resetResult.noSessions) {
      return { content: [{ type: "text", text: "초기화할 세션이 없습니다." }] };
    }

    for (const windowId of resetResult.terminalWindowIds) {
      closePhysicalTerminal(windowId);
    }
    closeAllMonitorTerminals();

    return {
      content: [{
        type: "text",
        text: `✅ 전체 초기화 완료. ${resetResult.files.length}개 세션 삭제, ${resetResult.archived}개 아카이브됨. 🖥️ 모든 모니터 터미널 닫힘.`,
      }],
    };
  })
);

server.tool(
  "deliberation_cli_config",
  "딜리버레이션 참가자 CLI 설정을 조회하거나 변경합니다. enabled_clis를 지정하면 저장합니다.",
  {
    enabled_clis: z.array(z.string()).optional().describe("활성화할 CLI 목록 (예: [\"claude\", \"codex\", \"gemini\"]). 미지정 시 현재 설정 조회"),
  },
  safeToolHandler("deliberation_cli_config", async ({ enabled_clis }) => {
    const config = loadDeliberationConfig();

    if (!enabled_clis) {
      // Read mode: show current config + detected CLIs
      const detected = discoverLocalCliSpeakers();
      const configured = Array.isArray(config.enabled_clis) ? config.enabled_clis : [];
      const mode = configured.length > 0 ? "config" : "auto-detect";

      return {
        content: [{
          type: "text",
          text: `## Deliberation CLI 설정\n\n**모드:** ${mode}\n**설정된 CLI:** ${configured.length > 0 ? configured.join(", ") : "(없음 — 전체 자동 감지)"}\n**현재 감지된 CLI:** ${detected.join(", ") || "(없음)"}\n**지원 CLI 전체:** ${DEFAULT_CLI_CANDIDATES.join(", ")}\n\n변경하려면:\n\`deliberation_cli_config(enabled_clis: ["claude", "codex"])\`\n\n전체 자동 감지로 되돌리려면:\n\`deliberation_cli_config(enabled_clis: [])\``,
        }],
      };
    }

    // Write mode: save new config
    if (enabled_clis.length === 0) {
      // Empty array = reset to auto-detect all
      delete config.enabled_clis;
      saveDeliberationConfig(config);
      return {
        content: [{
          type: "text",
          text: `✅ CLI 설정 초기화 완료. 전체 자동 감지 모드로 전환되었습니다.\n감지 대상: ${DEFAULT_CLI_CANDIDATES.join(", ")}`,
        }],
      };
    }

    // Validate CLIs
    const valid = [];
    const invalid = [];
    for (const cli of enabled_clis) {
      const normalized = cli.trim().toLowerCase();
      if (normalized) valid.push(normalized);
    }

    config.enabled_clis = valid;
    saveDeliberationConfig(config);

    // Check which are actually installed
    const installed = valid.filter(cli => {
      try {
        execFileSync(process.platform === "win32" ? "where" : "which", [cli], { stdio: "ignore" });
        return true;
      } catch { return false; }
    });
    const notInstalled = valid.filter(cli => !installed.includes(cli));

    let result = `✅ CLI 설정 저장 완료!\n\n**활성화된 CLI:** ${valid.join(", ")}`;
    if (installed.length > 0) result += `\n**설치 확인됨:** ${installed.join(", ")}`;
    if (notInstalled.length > 0) result += `\n**⚠️ 미설치:** ${notInstalled.join(", ")} (PATH에서 찾을 수 없음)`;

    return { content: [{ type: "text", text: result }] };
  })
);

// ── Start ──────────────────────────────────────────────────────

const transport = new StdioServerTransport();
await server.connect(transport);
