# Brain Memory Guide

## Quick Start
```bash
aigentry-brain health              # Check brain status
aigentry-brain query "topic"       # Search memories
```

## Memory Types
- **session**: Auto-captured on session end (learnings, decisions)
- **manual**: Explicitly saved via `brain append`
- **experiment**: Results from WTM experiments

## Best Practices
- Use `scope='app:<module>'` for isolation
- Include `structured_payload` for machine-readable data
- Compact periodically: `aigentry-brain compact`
- Export for backup: `aigentry-brain export --format jsonl`

## Inter-Session Memory
Sessions share memories through brain's inbox pattern:
```bash
aigentry-brain append --category inbox --source "sender-session" --tags "target:receiver"
```
