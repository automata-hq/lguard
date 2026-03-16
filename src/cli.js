#!/usr/bin/env node

import { resolve } from 'path';
import { scanProject } from './scan.js';
import { formatResults } from './output.js';

const args = process.argv.slice(2);
const flags = {};
const positional = [];

for (const arg of args) {
  if (arg === '-h' || arg === '--help') {
    flags.help = true;
  } else if (arg.startsWith('--')) {
    const [key, ...rest] = arg.slice(2).split('=');
    flags[key] = rest.length ? rest.join('=') : true;
  } else {
    positional.push(arg);
  }
}

if (flags.help) {
  console.log(`
lguard — Scan dependencies for open source license risks

Usage: lguard [path] [options]

Options:
  --all              Show all dependencies including permissive
  --json             Output as JSON
  --fail-on=LEVEL    Exit 1 if risk level found (high, medium, unknown)
  --ecosystem=NAME   Force specific ecosystem (npm, cargo, python, ruby, go, swift)
  --ignore=PKG,...   Ignore specific packages (comma-separated)
  -h, --help         Show this help

Risk levels:
  HIGH     Strong copyleft (AGPL, GPL, SSPL) — viral, must open-source your code
  MEDIUM   Weak copyleft (LGPL, MPL, EPL) — modifications to the library must be shared
  LOW      Permissive (MIT, Apache-2.0, BSD, ISC) — safe for commercial use
  UNKNOWN  License not recognized or missing
`);
  process.exit(0);
}

const targetPath = resolve(positional[0] || '.');
const ignore = flags.ignore ? flags.ignore.split(',') : [];

try {
  const results = await scanProject(targetPath, {
    ecosystem: flags.ecosystem,
    ignore,
  });

  if (flags.json) {
    console.log(JSON.stringify(results, null, 2));
  } else {
    formatResults(results, { showAll: flags.all });
  }

  if (flags['fail-on']) {
    const level = flags['fail-on'];
    const hasRisk = results.dependencies.some(d => {
      if (level === 'high') return d.risk === 'high';
      if (level === 'medium') return d.risk === 'high' || d.risk === 'medium';
      if (level === 'unknown') return d.risk !== 'low';
      return false;
    });
    if (hasRisk) process.exit(1);
  }
} catch (err) {
  console.error(`Error: ${err.message}`);
  process.exit(1);
}
