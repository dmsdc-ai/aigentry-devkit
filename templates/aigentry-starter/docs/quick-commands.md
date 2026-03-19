# aigentry Quick Commands

## Setup
```bash
npx @dmsdc-ai/aigentry-devkit setup          # First-time install (core)
npx @dmsdc-ai/aigentry-devkit setup --profile ecosystem-full  # Full install
aigentry doctor                               # Diagnose issues
aigentry tier                                 # Show license tier
```

## Sessions
```bash
aigentry start                    # Start all sessions from aigentry.yml
aigentry stop                     # Stop all sessions
aigentry session create <name>    # Create new session
aigentry session kill <name>      # Kill session
aigentry session list             # List active sessions
```

## Communication
```bash
telepty inject --from <src> <dst> "message"   # Send task
telepty list                                   # List sessions
telepty kill --id <session-id>                 # Kill session
```

## Health
```bash
aigentry status                   # All module health
aigentry doctor                   # Detailed diagnostics
```

## Deliberation
```bash
# Via MCP tools in Claude Code:
deliberation_start    # Start a discussion
deliberation_respond  # Add your perspective
deliberation_synthesize  # Generate consensus
```

## Brain
```bash
aigentry-brain health             # Check brain
aigentry-brain query "topic"      # Search memory
aigentry-brain append --category session  # Save memory
```

## Experiments (WTM)
```bash
wtm-experiment init <name>        # Start experiment
wtm-experiment run <name>         # Execute iteration
wtm-experiment status <name>      # Check progress
wtm-experiment report <name>      # Generate report
```
