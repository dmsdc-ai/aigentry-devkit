#!/usr/bin/env node
// context-ref-installer/v1 sha256={{SCRIPT_SHA256}}
// context-ref/v1 - Gemini receiver stub.
// Deferred by spec section 4.3.0 until dustcraw validates Gemini CLI hook schema.
// DO NOT EDIT - managed by `aigentry scaffold install-hooks gemini`

process.stderr.write("aigentry context-ref hook: Gemini receiver is deferred by spec section 4.3.0; pass-through.\n");
process.stdin.pipe(process.stdout);
