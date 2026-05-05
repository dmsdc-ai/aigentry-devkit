#!/usr/bin/env bash
# context-ref-installer/v1 sha256={{SCRIPT_SHA256}}
# context-ref/v1 - devkit-installed hook for [context-ref] inject protocol
# spec: ADR 2026-05-05-telepty-devkit-boundary section 3.1.2 (commit e4b072b)
# devkit version: {{DEVKIT_VERSION}}
# min telepty version: {{MIN_TELEPTY_VERSION}}
# DO NOT EDIT - managed by `aigentry scaffold install-hooks claude`

prompt_body="$(cat)"

fall_open() {
  printf '%s' "$prompt_body"
  exit 0
}

parse_semver() {
  printf '%s' "$1" | sed -E 's/.*([0-9]+[.][0-9]+[.][0-9]+(-[0-9A-Za-z.-]+)?).*/\1/'
}

semver_ge() {
  local runtime="$1"
  local minimum="$2"
  local runtime_core="${runtime%%-*}"
  local minimum_core="${minimum%%-*}"
  local runtime_pre=""
  local minimum_pre=""
  if [[ "$runtime" == *-* ]]; then runtime_pre="${runtime#*-}"; fi
  if [[ "$minimum" == *-* ]]; then minimum_pre="${minimum#*-}"; fi
  IFS='.' read -r runtime_major runtime_minor runtime_patch <<< "$runtime_core"
  IFS='.' read -r minimum_major minimum_minor minimum_patch <<< "$minimum_core"
  for part in major minor patch; do
    local runtime_value="runtime_${part}"
    local minimum_value="minimum_${part}"
    if (( ${!runtime_value} > ${!minimum_value} )); then return 0; fi
    if (( ${!runtime_value} < ${!minimum_value} )); then return 1; fi
  done
  if [[ -z "$runtime_pre" && -n "$minimum_pre" ]]; then return 0; fi
  if [[ -n "$runtime_pre" && -z "$minimum_pre" ]]; then return 1; fi
  [[ "$runtime_pre" > "$minimum_pre" || "$runtime_pre" == "$minimum_pre" ]]
}

script_path="${BASH_SOURCE[0]}"
min_telepty_version="$(sed -n 's/^# min telepty version: //p' "$script_path" | head -n 1)"
if [[ -n "$min_telepty_version" && "$min_telepty_version" != "unknown" ]]; then
  if ! telepty_output="$(telepty --version 2>/dev/null)"; then
    printf '%s\n' 'aigentry context-ref hook: telepty CLI not found on PATH; pass-through. Install or fix PATH; re-run `aigentry doctor`.' >&2
    fall_open
  fi
  runtime_telepty_version="$(parse_semver "$telepty_output")"
  if [[ ! "$runtime_telepty_version" =~ ^[0-9]+[.][0-9]+[.][0-9]+(-[0-9A-Za-z.-]+)?$ ]]; then
    printf '%s\n' 'aigentry context-ref hook: telepty version is unparseable; pass-through. Reinstall hooks or run `aigentry doctor`.' >&2
    fall_open
  fi
  if ! semver_ge "$runtime_telepty_version" "$min_telepty_version"; then
    printf 'aigentry context-ref hook: telepty %s is older than required %s; pass-through. Run `telepty --update` or reinstall hooks.\n' "$runtime_telepty_version" "$min_telepty_version" >&2
    fall_open
  fi
fi

if [[ "$prompt_body" == *$'\n'* ]]; then
  first_line="${prompt_body%%$'\n'*}"
  inline_message="${prompt_body#*$'\n'}"
else
  first_line="$prompt_body"
  inline_message=""
fi

prefix='[context-ref] Read '
marker=' and use it as'
if [[ "$first_line" != "$prefix"* || "$first_line" != *"$marker"* ]]; then
  fall_open
fi

path_tail="${first_line#"$prefix"}"
path_token="${path_tail%%"$marker"*}"
if [[ -z "$path_token" ]]; then
  fall_open
fi

if [[ "$path_token" == "~/"* ]]; then
  ref_path="${HOME}/${path_token#~/}"
elif [[ "$path_token" == "/"* ]]; then
  ref_path="$path_token"
else
  fall_open
fi

if ! hook_output="$(INLINE_MESSAGE="$inline_message" node - "$ref_path" <<'NODE'
const crypto = require("crypto");
const fs = require("fs");

const refPath = process.argv[2];
const stat = fs.statSync(refPath);
if (!stat.isFile()) process.exit(2);
if ((stat.mode & 0o777) !== 0o600) process.exit(2);
if (typeof process.getuid === "function" && stat.uid !== process.getuid()) process.exit(2);
const refBody = fs.readFileSync(refPath, "utf8");
// Schema mirrors lib/scaffold/payload-schema.js CONTEXT_REF_V1_SCHEMA.
const payload = {
  version: "context-ref/v1",
  ref_path: refPath,
  ref_sha256: crypto.createHash("sha256").update(refBody).digest("hex"),
  ref_body: refBody,
  inline_message: process.env.INLINE_MESSAGE || "",
  decoded_at: new Date().toISOString(),
};
process.stdout.write(JSON.stringify({
  additionalContext: refBody,
  aigentry_context_ref: payload,
}));
NODE
)"; then
  printf '%s\n' 'aigentry context-ref hook: failed to decode payload; pass-through.' >&2
  fall_open
fi

printf '%s' "$hook_output"
exit 0
