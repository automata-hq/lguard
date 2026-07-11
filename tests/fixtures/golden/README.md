# Golden files

Captured from **lguard v0.3.1** (commit `0397463`, the last pure-JS version) before the
TypeScript migration. They lock in observable behavior; the migrated code must reproduce
them exactly.

| File | Source | Notes |
|------|--------|-------|
| `npm-project.json` | `node src/cli.js tests/fixtures/npm-project --json` | Exit code 0. Normalized: `.path = "<PATH>"`, `.dependencies` sorted by `.name` (readdir order is filesystem-dependent). |
| `npm-project-config.json` | `node src/cli.js tests/fixtures/npm-project-config --json` | Exit code 1 (policy violation). Same normalization. |
| `synthetic-scan-result.json` | hand-built fixed input | Fed to `formatResults()`; covers every output section incl. control chars in package name/license. |
| `synthetic-human-all.txt` | `formatResults(synthetic, { showAll: true })` | Raw bytes incl. ANSI. Deterministic (fixed input order). Compare with version line normalized. |
| `synthetic-human-collapsed.txt` | `formatResults(synthetic, { showAll: false })` | Same, low-risk section collapsed. |
| `npm-project-cli-all.txt` | `node src/cli.js tests/fixtures/npm-project --all` | Exit code 0. Dependency order is readdir-order: use ONLY for same-machine before/after acceptance diffs, not in CI/unit tests. |

Comparison rules:
- JSON: replace `path` with `"<PATH>"` and sort `dependencies` by `name` before diffing.
- Human output: normalize only the version string (`vX.Y.Z` → `vX`); everything else byte-exact.
