# dustcraw: 3-Minute First Signal

## 1. Install
```bash
npx @dmsdc-ai/aigentry-devkit setup --profile curator-public
```

## 2. Configure
Choose a seed preset: `tech-business`, `humanities`, `finance`, `creator`

## 3. Run
```bash
dustcraw tick --preset tech-business --express 5m
```

## 4. View Results
```bash
dustcraw signals --limit 10 --sort score
```

Signals are scored automatically. High-scoring signals promote to brain memory.
