# Registry API Quick Reference

## Base URL
`http://localhost:8080` (self-hosted) or `https://api.aigentry.dev` (cloud)

## Endpoints
```
GET  /health                    # Health check
GET  /api/agents                # List agents
POST /api/agents                # Register agent
GET  /api/experiments           # List experiments
POST /api/experiments           # Create experiment
GET  /api/experiments/:id/runs  # Experiment runs
GET  /api/leaderboard           # Rankings
```

## Authentication
```bash
curl -H "Authorization: Bearer $AIGENTRY_API_KEY" http://localhost:8080/api/agents
```
