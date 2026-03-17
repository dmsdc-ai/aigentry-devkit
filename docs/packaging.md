# Packaging

Secondary distribution artifacts for `aigentry-devkit`.

Primary public install surface remains:

```bash
npx --yes --package @dmsdc-ai/aigentry-devkit aigentry-devkit install
```

## Homebrew

Formula source:

- `packaging/homebrew/aigentry-devkit.rb`

Local validation:

```bash
ruby -c packaging/homebrew/aigentry-devkit.rb
```

Notes:

- Formula currently installs from the published npm tarball
- `node` is the only hard Homebrew dependency
- Actual Homebrew distribution requires a tap repo; the local path itself is not installable with modern Homebrew
- After tap publication, the public install shape should be `brew install <tap>/aigentry-devkit`

## Docker

Build:

```bash
docker build -t dmsdc-ai/aigentry-devkit:0.0.5 .
```

Run:

```bash
docker run --rm -it dmsdc-ai/aigentry-devkit:0.0.5 --help
```

Notes:

- This image is a secondary packaging target, not the canonical install path
- Browser/MCP integrations that depend on the host environment remain host-bound
- For real local development flows, prefer native install via `npx`
