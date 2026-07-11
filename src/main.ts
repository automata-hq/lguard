import { stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { initConfig, loadConfig } from './config.js';
import { formatResults } from './output.js';
import { scanProject } from './scan.js';

const VALID_FLAGS = new Set(['all', 'json', 'fail-on', 'ecosystem', 'ignore', 'help', 'init']);
const VALID_FAIL_LEVELS = new Set(['high', 'medium', 'unknown']);

const HELP_TEXT = `
lguard — Scan dependencies for open source license risks

Usage: lguard [path] [options]

Options:
  --all              Show all dependencies including permissive
  --json             Output as JSON
  --fail-on=LEVEL    Exit 1 if risk level found (high, medium, unknown)
  --ecosystem=NAME   Force specific ecosystem (npm, cargo, python, ruby, go, swift)
  --ignore=PKG,...   Ignore specific packages (comma-separated)
  --init             Generate a default .lguardrc config file
  -h, --help         Show this help

Config (.lguardrc):
  {
    "deny": ["AGPL-3.0", "GPL-3.0", ...],   // block these licenses
    "allow": ["MIT", "Apache-2.0", ...],     // only allow these (mutually exclusive with deny)
    "ignore": ["pkg-name"],                  // skip these packages
    "failOn": "high",                        // exit 1 threshold
    "overrides": {                           // reviewed exceptions
      "pkg-name": "reason for override"
    }
  }

Risk levels:
  HIGH     Strong copyleft (AGPL, GPL, SSPL) — viral, must open-source your code
  MEDIUM   Weak copyleft (LGPL, MPL, EPL) — modifications to the library must be shared
  LOW      Permissive (MIT, Apache-2.0, BSD, ISC) — safe for commercial use
  UNKNOWN  License not recognized or missing
`;

export async function main(argv: string[]): Promise<number> {
  const flags: Record<string, string | true> = Object.create(null);
  const positional: string[] = [];

  for (const arg of argv) {
    if (arg === '-h' || arg === '--help') {
      flags.help = true;
    } else if (arg.startsWith('--')) {
      const [key = '', ...rest] = arg.slice(2).split('=');
      if (!VALID_FLAGS.has(key)) {
        console.error(`Unknown flag: --${key}`);
        return 1;
      }
      flags[key] = rest.length ? rest.join('=') : true;
    } else {
      positional.push(arg);
    }
  }

  if (flags.help) {
    console.log(HELP_TEXT);
    return 0;
  }

  const targetPath = resolve(positional[0] || '.');

  if (flags.init) {
    try {
      const path = await initConfig(targetPath);
      console.log(`Created ${path}`);
      return 0;
    } catch (err) {
      console.error(`Error: ${(err as Error).message}`);
      return 1;
    }
  }

  const failOnFlag = flags['fail-on'];
  if (failOnFlag && !VALID_FAIL_LEVELS.has(failOnFlag as string)) {
    console.error(
      `Invalid --fail-on level: ${failOnFlag}. Must be one of: ${[...VALID_FAIL_LEVELS].join(', ')}`,
    );
    return 1;
  }

  try {
    const st = await stat(targetPath);
    if (!st.isDirectory()) {
      console.error(`Error: Not a directory: ${targetPath}`);
      return 1;
    }
  } catch {
    console.error(`Error: Path does not exist: ${targetPath}`);
    return 1;
  }

  try {
    const config = await loadConfig(targetPath);
    // Quirk preserved from 0.3.1: a bare --ignore (boolean true) throws a
    // TypeError here that surfaces as "Error: flags.ignore.split is not a function".
    const ignore = flags.ignore ? (flags.ignore as string).split(',') : [];

    const results = await scanProject(targetPath, {
      // Quirk preserved: a bare --ecosystem passes `true` through and reports
      // "Unknown ecosystem: true".
      ecosystem: flags.ecosystem as string | undefined,
      ignore,
      config,
    });

    if (flags.json) {
      console.log(JSON.stringify(results, null, 2));
    } else {
      formatResults(results, { showAll: !!flags.all });
    }

    // Determine exit code
    const failOn = flags['fail-on'] || config?.failOn;
    let shouldFail = false;

    // Policy violations always cause failure when config is active
    if (results.summary.violations > 0) shouldFail = true;

    // Risk level threshold
    if (failOn) {
      const hasRisk = results.dependencies.some((d) => {
        if (d.overrideReason) return false; // overridden deps don't cause failure
        if (failOn === 'high') return d.risk === 'high';
        if (failOn === 'medium') return d.risk === 'high' || d.risk === 'medium';
        if (failOn === 'unknown') return d.risk !== 'low';
        return false;
      });
      if (hasRisk) shouldFail = true;
    }

    return shouldFail ? 1 : 0;
  } catch (err) {
    console.error(`Error: ${(err as Error).message}`);
    return 1;
  }
}
