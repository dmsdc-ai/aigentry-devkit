"use strict";

// SPDX-License-Identifier: MIT
// Shared context-ref/v1 hook payload schema. This mirrors the accepted ADR
// section 3.1.2.3 wire contract and is frozen to prevent runtime drift.

const CONTEXT_REF_V1_SCHEMA = Object.freeze({
  version: "context-ref/v1",
  required: Object.freeze([
    "version",
    "ref_path",
    "ref_sha256",
    "ref_body",
    "inline_message",
    "decoded_at",
  ]),
  fieldTypes: Object.freeze({
    version: "string",
    ref_path: "string",
    ref_sha256: "string",
    ref_body: "string",
    inline_message: "string",
    decoded_at: "string",
  }),
});

module.exports = { CONTEXT_REF_V1_SCHEMA };
