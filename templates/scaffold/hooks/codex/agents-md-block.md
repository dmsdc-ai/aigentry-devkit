<!-- BEGIN aigentry context-ref/v1 -->
<!-- spec: ADR 2026-05-05-telepty-devkit-boundary section 3.1.2 (commit e4b072b) -->
<!-- devkit version: {{DEVKIT_VERSION}} -->
<!-- context-ref-installer/v1 sha256={{BLOCK_SHA256}} -->
<!-- DO NOT EDIT - managed by `aigentry scaffold install-hooks codex` -->

## Context-ref directive (`[context-ref/v1]`)

When you receive a user prompt whose first line starts with the literal prefix
`[context-ref] Read <path-token> and use it as the source of truth for this task.`,
you MUST:

1. Treat `<path-token>` as a filesystem path (absolute, e.g. `/abs/path.md`, or home-relative, e.g. `~/.telepty/shared/<sha>.md`).
2. Expand `~/` to `$HOME` if present. Reject any path that is neither absolute nor `~/`-prefixed.
3. Read the file at the resolved path. Verify mode `0600` and that the file is owned by the current user. If verification fails, respond as if the directive line were absent and use the remaining prompt body verbatim.
4. Treat the file body as the authoritative payload for the task. The remainder of the user prompt after the first line is supplementary inline context only.
5. If the prefix is present but malformed, the file is missing, or any receiver check fails, respond as if the directive line were absent. Do not surface this fall-open to the user as an error unless they ask.

This directive is wire-contract-locked to `[context-ref/v1]` per ADR section 3.1.2.1.1 rule 1. Future `[context-ref/v2+]` will arrive via a successor ADR; until then, treat any literal prefix variant other than exact `[context-ref] ` as if the directive were absent.

<!-- END aigentry context-ref/v1 -->
