# Contracts

Define interfaces between aigentry modules using YAML contracts.

## Structure
```yaml
schema_version: "1.0"
interface:
  name: MyContract
  version: "0.1.0"
  description: What this contract defines

# Define your schema here
```

## Templates
See `templates/` for starter contracts:
- `mcp-tool.yaml` — MCP tool interface definition
- `interface.yaml` — Module-to-module interface
- `sub-agent.yaml` — Sub-agent capability contract
