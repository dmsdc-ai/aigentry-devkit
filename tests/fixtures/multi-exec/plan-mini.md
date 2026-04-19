---
multi_exec:
  enabled: true
  coder_session: MINI-coder-test
  reviewer: subagent
  max_fix_iterations: 5
  chunk_gates:
    - after_chunk: 1
      type: auto_approved
---

# Mini Plan

## Chunk 1: Smoke

### Task 1: echo hello
- [ ] step 1: `echo hello`

### Task 2: echo world
- [ ] step 1: `echo world`
