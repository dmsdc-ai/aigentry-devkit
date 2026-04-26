#!/usr/bin/env python3
"""V3 byte-equality verification harness for substitute-compact-v1.

Implements work-spec §6 (`~/projects/aigentry-orchestrator/docs/superpowers/
specs/2026-04-26-phase4c-v3-implementation-work-spec.md`). Runs impl A and
impl B against each frozen manifest, sha256-compares stdout bytes, prints
per-manifest verdict + aggregate, and writes digests/expected.sha256 only on
10/10 PASS (work-spec §6.4 PASS row).

Stdlib-only (Rule 17 / work-spec §9). LC_ALL=C per ADR §4.6.10 ban item 8 +
work-spec §6.2.
"""
import argparse
import hashlib
import os
import subprocess
import sys
from pathlib import Path


def run_impl(impl, manifest):
    # work-spec §6.2 invocation: `python3 <impl> <manifest>`, stdin=/dev/null,
    # LC_ALL=C, stdout captured as BYTES (no decode — sha256 over raw bytes).
    env = {**os.environ, "LC_ALL": "C"}
    proc = subprocess.run(
        ["python3", str(impl), str(manifest)],
        stdin=subprocess.DEVNULL,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        env=env,
        check=False,
    )
    return proc.stdout, proc.stderr, proc.returncode


def main():
    parser = argparse.ArgumentParser(
        description="V3 byte-equal verification harness (work-spec §6).",
    )
    parser.add_argument("--impl-a", required=True, type=Path)
    parser.add_argument("--impl-b", required=True, type=Path)
    parser.add_argument(
        "--manifests", required=True, type=Path,
        help="Directory containing frozen *.json manifests (work-spec §5).",
    )
    parser.add_argument(
        "--output", required=True, type=Path,
        help="digests/expected.sha256 (written only on 10/10 PASS, §6.4).",
    )
    args = parser.parse_args()

    for label, path in (("--impl-a", args.impl_a), ("--impl-b", args.impl_b)):
        if not path.is_file():
            print(f"error: {label} not found: {path}", file=sys.stderr)
            return 2
    if not args.manifests.is_dir():
        print(f"error: --manifests not a directory: {args.manifests}",
              file=sys.stderr)
        return 2

    # work-spec §6 + ADR §4.6.10 items 6/8: deterministic byte-wise sort by
    # basename. NEVER trust os.listdir / fs enumeration order. Python str sort
    # is byte-wise for ASCII manifest names ("01-…" through "10-…").
    manifests = sorted(args.manifests.glob("*.json"), key=lambda p: p.name)
    if not manifests:
        print(f"error: no *.json manifests under {args.manifests}",
              file=sys.stderr)
        return 2

    digests = []  # [(basename, sha256_hex)] — emitted to --output on PASS.
    pass_count = 0

    for manifest in manifests:
        name = manifest.stem  # basename without .json — work-spec §6.3.
        out_a, err_a, rc_a = run_impl(args.impl_a, manifest)
        out_b, err_b, rc_b = run_impl(args.impl_b, manifest)

        # work-spec §6.2: stderr non-empty → log warning, continue.
        if rc_a != 0:
            print(f"warning: impl-a exit {rc_a} on {name}", file=sys.stderr)
        if rc_b != 0:
            print(f"warning: impl-b exit {rc_b} on {name}", file=sys.stderr)
        if err_a:
            print(f"warning: impl-a stderr on {name}: "
                  f"{err_a[:200].decode('utf-8', 'replace')}", file=sys.stderr)
        if err_b:
            print(f"warning: impl-b stderr on {name}: "
                  f"{err_b[:200].decode('utf-8', 'replace')}", file=sys.stderr)

        digest_a = hashlib.sha256(out_a).hexdigest()
        digest_b = hashlib.sha256(out_b).hexdigest()
        # PASS requires byte-equal AND clean exit on both sides — non-zero rc
        # with empty stdout would otherwise yield a sha256 collision on
        # `e3b0c4…855` (empty digest) and produce a false PASS.
        is_pass = digest_a == digest_b and rc_a == 0 and rc_b == 0
        match = "PASS" if is_pass else "FAIL"
        if is_pass:
            pass_count += 1
            digests.append((name, digest_a))
        # work-spec §6.3 line format (30-char name+colon field for alignment).
        print(f"{name + ':':<30} A={digest_a} B={digest_b} match={match}")

    total = len(manifests)
    fail_count = total - pass_count
    print("---")
    print(f"aggregate: {pass_count}/{total} PASS, {fail_count}/{total} FAIL")

    if pass_count == total:
        # work-spec §6.4 PASS row + dispatch step 3: write digests file
        # (one line per manifest, basename + space + sha256_hex, sorted).
        print("V3 verdict: PASS")
        args.output.parent.mkdir(parents=True, exist_ok=True)
        body = "".join(f"{n} {h}\n" for n, h in sorted(digests, key=lambda t: t[0]))
        args.output.write_text(body, encoding="utf-8")
        return 0

    # work-spec §6.4 FAIL row + dispatch step 4: do NOT write --output
    # (preserved for next attempt). Diagnostic flow → §8.1 ban-list trace.
    print("V3 verdict: FAIL (no partial credit per ADR §9)")
    return 1


if __name__ == "__main__":
    sys.exit(main())
