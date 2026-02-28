# Agents

프로젝트에서 사용하는 에이전트 목록입니다.

## 에이전트 목록

| 에이전트 | 역할 | 상세 |
|---------|------|------|
| (추가 필요) | - | - |

## 에이전트 아키텍처

```
SupervisorAgent (최상위 조율자)
└── Clusters
    ├── PlanningCluster
    ├── ProcessCluster
    └── NotifyCluster
```

## 사용법

```python
from framework.agents import BaseAgent, AgentResponse

class MyAgent(BaseAgent):
    async def invoke(self, input_data: dict) -> AgentResponse:
        # 에이전트 로직
        return AgentResponse.success({"result": "done"})
```

---

Parent: [_index.md](../_index.md)

## Next References

- (에이전트 상세 문서 추가)
