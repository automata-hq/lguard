# lguard

Scan your project's dependencies for open source license risks. Catches copyleft licenses (AGPL, GPL, SSPL) that can force you to open-source your code before they become a problem.

Zero dependencies. Works across multiple ecosystems.

## Install

```sh
npm i -g lguard
```

Or run directly:

```sh
npx lguard
```

## Usage

```sh
# Scan current directory (auto-detects ecosystem)
lguard

# Scan a specific path
lguard /path/to/project

# Show all deps including permissive
lguard --all

# JSON output for CI/tooling
lguard --json

# Fail CI if risky licenses found
lguard --fail-on=high

# Force a specific ecosystem
lguard --ecosystem=cargo

# Ignore specific packages
lguard --ignore=some-pkg,another-pkg
```

## Example output

```
lguard v0.1.1

  Path:        /home/user/my-app
  Ecosystems:  npm
  Total deps:  142

  HIGH RISK (copyleft) — 1 package(s)
    evil-lib@2.0.0                                AGPL-3.0             [npm]

  MEDIUM RISK (weak copyleft) — 2 package(s)
    image-lib@1.4.0                               LGPL-3.0-or-later    [npm]
    xml-parser@3.1.0                               MPL-2.0              [npm]

  LOW RISK (permissive) — 139 package(s) (use --all to show)

  Summary: 1 high, 2 medium, 139 permissive
```

## Supported ecosystems

| Ecosystem | Detected by | Method |
|-----------|------------|--------|
| npm / bun / pnpm | `package.json` | Reads `node_modules` locally |
| Cargo (Rust) | `Cargo.toml` | `cargo metadata` |
| pip (Python) | `requirements.txt`, `Pipfile.lock`, `pyproject.toml` | Local venv metadata, PyPI API fallback |
| RubyGems | `Gemfile.lock` | RubyGems API |
| Go modules | `go.mod` | `go list` + LICENSE file detection in module cache |
| Swift PM | `Package.swift` | `Package.resolved` + GitHub API |

Multiple ecosystems in the same project are detected and scanned automatically.

## Risk levels

| Level | Licenses | What it means |
|-------|----------|---------------|
| **HIGH** | AGPL, GPL, SSPL, EUPL, OSL | Viral copyleft — using these typically requires you to open-source your entire application under the same license |
| **MEDIUM** | LGPL, MPL, EPL, CDDL | Weak copyleft — modifications to the *library itself* must be shared, but your application code is unaffected |
| **LOW** | MIT, Apache-2.0, BSD, ISC, etc. | Permissive — safe for commercial use with minimal obligations |
| **UNKNOWN** | Unrecognized or missing | Review manually |

SPDX expressions are handled correctly:
- `(MIT OR GPL-3.0)` — OR means you can choose, so the least risky option is used
- `(MIT AND GPL-3.0)` — AND means you must comply with both, so the most risky option is used

## CI integration

```yaml
# GitHub Actions
- name: License check
  run: npx lguard --fail-on=high
```

`--fail-on` accepts `high`, `medium`, or `unknown` and exits with code 1 if any dependency matches that risk level or above.

## Environment variables

| Variable | Used by |
|----------|---------|
| `GITHUB_TOKEN` | Swift ecosystem — avoids GitHub API rate limits when fetching license info |

## License

MIT
