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

# Generate a .lguardrc config file
lguard --init
```

## Example output

```
lguard v0.3.1

  Path:        /home/user/my-app
  Ecosystems:  npm
  Total deps:  142
  Config:      .lguardrc

  POLICY VIOLATIONS — 1 package(s)
    evil-lib@2.0.0                                AGPL-3.0             [npm] (transitive) VIOLATION
      └─ express > middleware-x > evil-lib
      denied by policy

  HIGH RISK (copyleft) — 1 package(s)
    evil-lib@2.0.0                                AGPL-3.0             [npm] (transitive) VIOLATION
      └─ express > middleware-x > evil-lib

  MEDIUM RISK (weak copyleft) — 1 package(s)
    @img/sharp-libvips-darwin-arm64@1.0.4         LGPL-3.0-or-later    [npm] (transitive) overridden
      └─ sharp > @img/sharp-libvips-darwin-arm64
      "Dynamically linked — LGPL allows this use"

  LOW RISK (permissive) — 139 package(s) (use --all to show)

  Summary: 1 high, 1 medium, 139 permissive | 1 policy violation(s) | 1 overridden
```

## Config file

Run `lguard --init` to generate a `.lguardrc` in your project root.

```json
{
  "deny": ["AGPL-3.0", "GPL-3.0", "SSPL-1.0"],
  "ignore": [],
  "failOn": "high",
  "overrides": {}
}
```

### Options

| Field | Type | Description |
|-------|------|-------------|
| `deny` | `string[]` | Block these licenses. Any dep using a denied license is a policy violation. |
| `allow` | `string[]` | Only allow these licenses. Everything else is a violation. Mutually exclusive with `deny`. |
| `ignore` | `string[]` | Skip these packages entirely. |
| `failOn` | `string` | Exit with code 1 if risk level met. One of: `high`, `medium`, `unknown`. |
| `overrides` | `object` | Package-level exceptions. Key is package name, value is a reason string. Overridden packages are never policy violations. |

### Allow vs deny

**`deny`** is a blocklist. Use it when you want to block specific problematic licenses but allow everything else:

```json
{ "deny": ["AGPL-3.0", "GPL-3.0", "SSPL-1.0"] }
```

**`allow`** is a whitelist. Use it when you want strict control over exactly which licenses are permitted:

```json
{ "allow": ["MIT", "Apache-2.0", "BSD-2-Clause", "BSD-3-Clause", "ISC", "0BSD"] }
```

### Overrides

When you've reviewed a dependency and accepted its license despite the policy, add an override:

```json
{
  "deny": ["LGPL-3.0-or-later"],
  "overrides": {
    "@img/sharp-libvips-darwin-arm64": "Dynamically linked — LGPL allows this use"
  }
}
```

Overridden packages are still shown in the output with their risk level, but they don't trigger policy violations or exit code 1.

## Dependency chains

lguard traces how transitive dependencies end up in your project. When a risky dep is found, the chain shows which direct dependency pulled it in:

```
  MEDIUM RISK (weak copyleft) — 1 package(s)
    @img/sharp-libvips-darwin-arm64@1.0.4         LGPL-3.0-or-later    [npm] (transitive)
      └─ sharp > @img/sharp-libvips-darwin-arm64
```

Dependency graph support by ecosystem:

| Ecosystem | Graph support |
|-----------|--------------|
| npm / bun / pnpm | Full chain |
| Cargo | Full chain |
| Go | Full chain |
| RubyGems | Full chain |
| Python | Direct deps only |
| Swift | Direct deps only |

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
- `GPL-2.0-only WITH Classpath-exception-2.0` — WITH exceptions are parsed correctly

Policy evaluation also respects SPDX semantics:
- `deny: ["GPL-3.0"]` won't block `(MIT OR GPL-3.0)` because the consumer can choose MIT
- `deny: ["GPL-3.0"]` will block `(MIT AND GPL-3.0)` because GPL-3.0 compliance is required

## CI integration

```yaml
# GitHub Actions
- name: License check
  run: npx lguard --fail-on=high
```

With a `.lguardrc` in your repo, lguard automatically picks it up. Policy violations always exit with code 1.

`--fail-on` accepts `high`, `medium`, or `unknown` and exits with code 1 if any dependency matches that risk level or above.

## Environment variables

| Variable | Used by |
|----------|---------|
| `GITHUB_TOKEN` | Swift ecosystem — avoids GitHub API rate limits when fetching license info |

## License

MIT
