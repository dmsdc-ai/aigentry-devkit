#!/usr/bin/env python3

import argparse
import datetime as dt
import json
import os
import re
import subprocess
import sys
import tempfile
import textwrap
import urllib.error
import urllib.request


DEFAULT_API = os.environ.get("TELEPTY_API_URL", "http://localhost:3848")


def run_command(argv):
    return subprocess.run(argv, capture_output=True, text=True)


def strip_ansi(text):
    return re.sub(r"\x1b\[[0-9;]*m", "", text)


def slugify(text):
    slug = re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")
    return slug[:48] or "thread"


def derive_project(session_id, cwd):
    base = os.path.basename((cwd or "").rstrip("/"))
    if base and base not in {"", "projects"}:
        return base
    match = re.match(r"aigentry-([a-z0-9-]+)-\d+$", session_id)
    if match:
        return f"aigentry-{match.group(1)}"
    if session_id == "aigentry-orchestrator":
        return "aigentry-orchestrator"
    return session_id


def load_sessions_from_api():
    request = urllib.request.Request(f"{DEFAULT_API}/api/sessions")
    with urllib.request.urlopen(request, timeout=2) as response:
        payload = response.read().decode("utf-8")
    data = json.loads(payload)
    sessions = []
    for item in data:
        session_id = item.get("id", "")
        cwd = item.get("cwd", "")
        sessions.append(
            {
                "id": session_id,
                "command": item.get("command", ""),
                "cwd": cwd,
                "project": derive_project(session_id, cwd),
                "created_at": item.get("createdAt", ""),
                "active_clients": item.get("active_clients"),
                "transport": "api",
            }
        )
    return sessions


def load_sessions_from_cli():
    result = run_command(["telepty", "list"])
    if result.returncode != 0:
        raise RuntimeError(result.stderr.strip() or result.stdout.strip() or "telepty list failed")

    text = strip_ansi(result.stdout)
    sessions = []
    current = None

    for raw_line in text.splitlines():
        line = raw_line.rstrip()
        if line.startswith("  - ID: "):
            if current:
                sessions.append(current)
            session_id = line.split("  - ID: ", 1)[1].strip()
            current = {"id": session_id, "command": "", "cwd": "", "project": session_id, "transport": "cli"}
        elif current and line.strip().startswith("Command: "):
            current["command"] = line.strip().split("Command: ", 1)[1].strip()
        elif current and line.strip().startswith("CWD: "):
            cwd = line.strip().split("CWD: ", 1)[1].strip()
            current["cwd"] = cwd
            current["project"] = derive_project(current["id"], cwd)
        elif current and line.strip().startswith("Started: "):
            current["created_at"] = line.strip().split("Started: ", 1)[1].strip()

    if current:
        sessions.append(current)

    return sessions


def load_sessions():
    try:
        return load_sessions_from_api()
    except (urllib.error.URLError, TimeoutError, json.JSONDecodeError, ValueError):
        return load_sessions_from_cli()


def detect_features():
    features = {
        "current_session_id": os.environ.get("TELEPTY_SESSION_ID", ""),
        "has_sessions_api": False,
        "has_deliberate": False,
        "has_reply": False,
        "has_handoff": False,
        "supports_routing_flags": False,
    }

    try:
        load_sessions_from_api()
        features["has_sessions_api"] = True
    except Exception:
        pass

    top_help = run_command(["telepty", "--help"])
    top_text = strip_ansi((top_help.stdout or "") + (top_help.stderr or ""))
    features["has_reply"] = "telepty reply" in top_text
    features["has_handoff"] = "handoff" in top_text

    deliberate_help = run_command(["telepty", "deliberate", "--help"])
    deliberate_text = strip_ansi((deliberate_help.stdout or "") + (deliberate_help.stderr or ""))
    features["has_deliberate"] = "telepty deliberate" in deliberate_text

    inject_usage = run_command(["telepty", "inject"])
    inject_text = strip_ansi((inject_usage.stdout or "") + (inject_usage.stderr or ""))
    features["supports_routing_flags"] = "--from" in inject_text and "--reply-to" in inject_text

    return features


def normalize_participants(raw_ids, sessions, initiator):
    all_ids = [session["id"] for session in sessions]
    if raw_ids:
        requested = [item.strip() for item in raw_ids.split(",") if item.strip()]
        return [item for item in requested if item in all_ids]
    return [item for item in all_ids if item != initiator]


def build_thread_id(topic):
    stamp = dt.datetime.now(dt.timezone.utc).strftime("%Y%m%d%H%M%S")
    return f"telepty-delib-{slugify(topic)}-{stamp}"


def render_session_map(sessions):
    lines = []
    for session in sessions:
        lines.append(
            f"- {session['id']} | project={session['project']} | command={session['command']} | cwd={session['cwd']}"
        )
    return "\n".join(lines)


def build_prompt(topic, context, initiator, reply_to, sessions, participants, thread_id):
    selected = [session for session in sessions if session["id"] in participants]
    session_map = render_session_map(sessions)
    participant_lines = "\n".join(f"- {session['id']}" for session in selected) or "- (none)"
    context_block = context.strip() if context else "(no extra context)"

    prompt = f"""[from: {initiator}] [reply-to: {reply_to}] [thread-id: {thread_id}]
멀티세션 토론 kickoff입니다.

Topic:
{topic}

Context:
{context_block}

Participants:
{participant_lines}

Session Map:
{session_map}

Protocol:
1. 다른 프로젝트/세션의 사실은 추측하지 말고 직접 해당 세션에 질문합니다.
2. 다른 세션에 보내는 모든 메시지에는 [from: <session>] [reply-to: <session>]를 포함합니다.
3. sub-deliberation은 허용됩니다.
4. 각 세션은 자기 프로젝트 관점에서 아래를 먼저 답합니다.
   - 제공 가능한 인터페이스
   - 필요한 인터페이스
   - 아직 모르는 점 / 누구에게 물어볼지
5. 필요하면 다른 세션과 직접 교차 질문하고, 답변은 reply-to 세션으로 회신합니다.
6. 합의가 구현으로 이어질 수 있으면 토론만 하고 멈추지 말고 즉시 owner 세션이 실행으로 전환합니다.

Automatic Skill Matching Guide:
- 코드 분석/구현 요청 -> explore -> executor 또는 동등한 로컬 skill/tool
- 아키텍처 결정 필요 -> architect / plan
- 버그 발견 -> analyze -> build-fix 또는 동등한 디버그/수정 skill
- 보안 관련 논의 -> security-review
- API 스펙 / 공식 문서 논의 -> researcher 또는 공식 문서 조회 도구
- 테스트 필요 -> tdd / ultraqa
- 인터페이스 합의 완료 -> deliberation-executor 또는 owner session handoff
- 설계 교착 / 이견 지속 -> deliberation-gate 또는 멀티AI 검증 경로

Boundary Enforcement:
1. 자기 영역이 아닌 핵심 로직은 본인 프로젝트에 구현하지 않습니다.
2. 다른 프로젝트 기능이 필요하면 해당 세션에 직접 질문하거나 구현 요청합니다.
3. 자기 프로젝트에는 client adapter / thin wrapper만 허용합니다.
4. 다른 프로젝트 핵심 로직 복제/재구현은 금지합니다.
5. sub-deliberation 결과와 결론은 관련 세션에 공유합니다.

Active Reporting:
1. 태스크 완료 시 결과를 오케스트레이터에 보고하고 다음 지시를 요청합니다.
2. 블로커 발생 시 문제를 설명하고 오케스트레이터 또는 관련 세션에 즉시 도움을 요청합니다.
3. 다른 세션의 응답이 필요하면 기다리지 말고 해당 세션에 직접 질문합니다.
4. 30초 이상 대기 상태가 되면 현재 상태, 대기 이유, 다음 예상 액션을 오케스트레이터에 보고합니다.

Requested Output:
- your current position
- interfaces you provide
- interfaces you need
- open questions
- next sessions to ask, if any
- local skill/tool you will invoke next, if any
"""

    return textwrap.dedent(prompt).strip()


def print_discover(args):
    sessions = load_sessions()
    current = os.environ.get("TELEPTY_SESSION_ID", "")
    if args.json:
        payload = {
            "current_session_id": current,
            "sessions": sessions,
        }
        print(json.dumps(payload, indent=2))
        return

    print(f"Current session: {current or '(unset)'}")
    print("")
    print("Active telepty sessions:")
    for session in sessions:
        marker = " (current)" if session["id"] == current else ""
        print(
            f"- {session['id']}{marker}: project={session['project']} command={session['command']} cwd={session['cwd']}"
        )


def print_features(_args):
    print(json.dumps(detect_features(), indent=2))


def print_prompt(args):
    sessions = load_sessions()
    initiator = args.initiator or os.environ.get("TELEPTY_SESSION_ID", "")
    if not initiator:
        raise SystemExit("TELEPTY_SESSION_ID is not set. Pass --initiator explicitly.")

    reply_to = args.reply_to or initiator
    participants = normalize_participants(args.participants, sessions, initiator)
    thread_id = args.thread_id or build_thread_id(args.topic)
    print(build_prompt(args.topic, args.context or "", initiator, reply_to, sessions, participants, thread_id))


def kickoff_auto(args):
    features = detect_features()
    if features["has_deliberate"]:
        return kickoff_deliberate(args)
    return kickoff_fallback(args)


def kickoff_deliberate(args):
    sessions = load_sessions()
    initiator = args.initiator or os.environ.get("TELEPTY_SESSION_ID", "")
    if not initiator:
        raise SystemExit("TELEPTY_SESSION_ID is not set. Pass --initiator explicitly.")

    reply_to = args.reply_to or initiator
    participants = normalize_participants(args.participants, sessions, initiator)
    if not participants:
        raise SystemExit("No target participants found.")

    thread_id = args.thread_id or build_thread_id(args.topic)
    prompt = build_prompt(args.topic, args.context or "", initiator, reply_to, sessions, participants, thread_id)
    command = ["telepty", "deliberate", "--topic", args.topic, "--sessions", ",".join(participants)]

    if args.dry_run:
        print(json.dumps({"mode": "deliberate", "targets": participants, "thread_id": thread_id}, indent=2))
        print("")
        print("Command:")
        print(" ".join(command + ["--context", "<tempfile>"]))
        print("")
        print(prompt)
        return

    temp_path = None
    try:
        with tempfile.NamedTemporaryFile("w", encoding="utf-8", suffix=".txt", delete=False) as handle:
            handle.write(prompt)
            temp_path = handle.name
        command.extend(["--context", temp_path])
        result = run_command(command)
        sys.stdout.write(result.stdout)
        sys.stderr.write(result.stderr)
        if result.returncode != 0:
            raise SystemExit(result.returncode)
    finally:
        if temp_path and os.path.exists(temp_path):
            os.unlink(temp_path)


def kickoff_fallback(args):
    sessions = load_sessions()
    initiator = args.initiator or os.environ.get("TELEPTY_SESSION_ID", "")
    if not initiator:
        raise SystemExit("TELEPTY_SESSION_ID is not set. Pass --initiator explicitly.")

    reply_to = args.reply_to or initiator
    participants = normalize_participants(args.participants, sessions, initiator)
    if not participants:
        raise SystemExit("No target participants found.")

    thread_id = args.thread_id or build_thread_id(args.topic)
    prompt = build_prompt(args.topic, args.context or "", initiator, reply_to, sessions, participants, thread_id)
    target_list = ",".join(participants)

    if args.dry_run:
        print(json.dumps({"targets": participants, "thread_id": thread_id}, indent=2))
        print("")
        print(prompt)
        return

    result = run_command(["telepty", "multicast", target_list, prompt])
    sys.stdout.write(result.stdout)
    sys.stderr.write(result.stderr)
    if result.returncode != 0:
        raise SystemExit(result.returncode)


def build_parser():
    parser = argparse.ArgumentParser(description="telepty multi-session deliberation helper")
    subparsers = parser.add_subparsers(dest="command", required=True)

    discover = subparsers.add_parser("discover", help="Show active telepty sessions and derived project map")
    discover.add_argument("--json", action="store_true", help="Print JSON instead of markdown-like text")
    discover.set_defaults(func=print_discover)

    features = subparsers.add_parser("features", help="Detect telepty capabilities relevant to deliberation")
    features.set_defaults(func=print_features)

    prompt = subparsers.add_parser("prompt", help="Build the kickoff protocol text")
    prompt.add_argument("--topic", required=True, help="Discussion topic or objective")
    prompt.add_argument("--context", default="", help="Optional background context")
    prompt.add_argument("--initiator", help="Current session id override")
    prompt.add_argument("--reply-to", dest="reply_to", help="Reply target session id")
    prompt.add_argument("--participants", help="Comma-separated participant ids; default is all except initiator")
    prompt.add_argument("--thread-id", dest="thread_id", help="Explicit thread id")
    prompt.set_defaults(func=print_prompt)

    kickoff_auto_parser = subparsers.add_parser("kickoff", help="Auto-select deliberate or fallback transport")
    kickoff_auto_parser.add_argument("--topic", required=True, help="Discussion topic or objective")
    kickoff_auto_parser.add_argument("--context", default="", help="Optional background context")
    kickoff_auto_parser.add_argument("--initiator", help="Current session id override")
    kickoff_auto_parser.add_argument("--reply-to", dest="reply_to", help="Reply target session id")
    kickoff_auto_parser.add_argument("--participants", help="Comma-separated participant ids; default is all except initiator")
    kickoff_auto_parser.add_argument("--thread-id", dest="thread_id", help="Explicit thread id")
    kickoff_auto_parser.add_argument("--dry-run", action="store_true", help="Print planned mode and payload without sending")
    kickoff_auto_parser.set_defaults(func=kickoff_auto)

    kickoff = subparsers.add_parser("kickoff-fallback", help="Send kickoff via telepty multicast")
    kickoff.add_argument("--topic", required=True, help="Discussion topic or objective")
    kickoff.add_argument("--context", default="", help="Optional background context")
    kickoff.add_argument("--initiator", help="Current session id override")
    kickoff.add_argument("--reply-to", dest="reply_to", help="Reply target session id")
    kickoff.add_argument("--participants", help="Comma-separated participant ids; default is all except initiator")
    kickoff.add_argument("--thread-id", dest="thread_id", help="Explicit thread id")
    kickoff.add_argument("--dry-run", action="store_true", help="Print targets and prompt without sending")
    kickoff.set_defaults(func=kickoff_fallback)

    return parser


def main():
    parser = build_parser()
    args = parser.parse_args()
    args.func(args)


if __name__ == "__main__":
    main()
