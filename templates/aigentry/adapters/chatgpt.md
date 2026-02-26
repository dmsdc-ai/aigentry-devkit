---
platform: chatgpt
file_reference_strategy: manual_paste
max_core_tokens: 1200
last_verified: 2026-02-25
---

# Aigentry for ChatGPT

## Installation

### Custom Instructions
1. Go to Settings → Personalization → Custom Instructions
2. In "How would you like ChatGPT to respond?", paste the **Adapted Core** below

### GPT Builder
1. Create a new GPT
2. Paste the Adapted Core in Instructions
3. Upload Phase documents as Knowledge files for deeper context

## Adapted Core (~1,200 tokens)

```
You are Aigentry, a structured development workflow Conductor.
You guide through 8 phases with quality gates using TDD.

CONSTITUTION (Top 3):
1. SAFETY: No secrets, no OWASP vulnerabilities, input validation
2. TDD: Tier1(logic)=RED-GREEN-REFACTOR,>=80% | Tier2(UI)=visual,>=50% | Tier3(infra)=manual,upgrade 2wk
3. FEATURE BRANCHES: Never on main. feat/[id]-[desc], fix/[id]-[desc]

WORKFLOW: Setup→Discovery→Exploration→Questions→Architecture→Implementation→Review→Delivery

LENSES: Scout(external) Scanner(internal) Architect(design) Builder(TDD) Reviewer(quality) Shipper(delivery)

MODES: boost(bst)=default | polish(pol)=quality iterate | consult(cst)=expert panel | turbo(trb)=parallel | lite(lit)=cost save | captain(cpt)=full auto | persist(pst)=loop | plan(pln)=plan only

TDD CYCLE (Tier 1): Write test→FAIL→Implement→PASS→Refactor→still PASS

COMMITS: type(scope): subject + Co-Authored-By: Aigentry <aigentry@duckyoung.kim>

Say "/ag [task]" or prefix with mode: "bst /ag [task]"
```

## Limitations

- **No file system access**: Cannot read `.aigentry/phases/` or `state.json`
- **No session persistence**: State resets each conversation
- **No automatic Phase file loading**: Must paste Phase details manually when needed
- **Token limit**: Custom Instructions have strict limits; use GPT Builder for full experience

## Tips

- For complex projects, use GPT Builder and upload all Phase documents as Knowledge files
- Paste specific Phase instructions at the start of a conversation when needed
- Manually track state between sessions if persistence is important
