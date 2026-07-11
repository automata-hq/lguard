import { readFileSync } from 'node:fs';
import type { ScannedDependency, ScanResult } from './types.js';

// Resolves from both src/ (dev) and dist/ (published) — package.json sits one
// level above either directory. Lazy so importing this module does no I/O.
let cachedVersion: string | undefined;
function getVersion(): string {
  cachedVersion ??= (
    JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf-8')) as {
      version: string;
    }
  ).version;
  return cachedVersion;
}

const RED = '\x1b[31m';
const YELLOW = '\x1b[33m';
const GREEN = '\x1b[32m';
const GRAY = '\x1b[90m';
const BOLD = '\x1b[1m';
const RESET = '\x1b[0m';
const DIM = '\x1b[2m';
const MAGENTA = '\x1b[35m';

// biome-ignore lint/suspicious/noControlCharactersInRegex: strips ANSI/control chars from untrusted package metadata
const CTRL_RE = /[\x00-\x1f\x7f-\x9f]/g;
function sanitize(str: string): string {
  return str ? str.replace(CTRL_RE, '') : str;
}

function depLine(d: ScannedDependency, color: string): string {
  const nameVer = sanitize(`${d.name}@${d.version}`);
  const license = sanitize(d.license || 'NONE');
  const directTag = d.direct ? '' : ` ${DIM}(transitive)${RESET}`;
  const overrideTag = d.overrideReason ? ` ${GREEN}overridden${RESET}` : '';
  const violationTag = d.violation ? ` ${RED}VIOLATION${RESET}` : '';
  return `    ${nameVer.padEnd(45)} ${color}${license.padEnd(20)}${RESET} ${DIM}[${d.ecosystem}]${RESET}${directTag}${overrideTag}${violationTag}`;
}

function chainLine(d: ScannedDependency): string | null {
  if (!d.chain || d.chain.length === 0) return null;
  return `      ${DIM}└─ ${d.chain.join(' > ')}${RESET}`;
}

function printDep(d: ScannedDependency, color: string): void {
  console.log(depLine(d, color));
  const chain = chainLine(d);
  if (chain) console.log(chain);
  if (d.overrideReason) {
    console.log(`      ${DIM}"${sanitize(d.overrideReason)}"${RESET}`);
  }
}

export interface FormatOptions {
  showAll?: boolean;
}

export function formatResults(results: ScanResult, options: FormatOptions = {}): void {
  console.log(`\n${BOLD}lguard${RESET} ${DIM}v${getVersion()}${RESET}\n`);
  console.log(`  Path:        ${results.path}`);
  console.log(`  Ecosystems:  ${results.ecosystems.join(', ')}`);
  console.log(`  Total deps:  ${results.summary.total}`);
  if (results.hasConfig) console.log(`  Config:      .lguardrc`);
  console.log();

  const violations = results.dependencies.filter((d) => d.violation);
  const high = results.dependencies.filter((d) => d.risk === 'high');
  const medium = results.dependencies.filter((d) => d.risk === 'medium');
  const unknown = results.dependencies.filter((d) => d.risk === 'unknown');
  const low = results.dependencies.filter((d) => d.risk === 'low');

  // Policy violations first (when config is active)
  if (violations.length > 0) {
    console.log(
      `${MAGENTA}${BOLD}  POLICY VIOLATIONS${RESET} ${MAGENTA}— ${violations.length} package(s)${RESET}`,
    );
    for (const d of violations) {
      printDep(d, MAGENTA);
      if (d.violationReason) {
        console.log(`      ${MAGENTA}${d.violationReason}${RESET}`);
      }
    }
    console.log();
  }

  if (high.length > 0) {
    console.log(
      `${RED}${BOLD}  HIGH RISK (copyleft)${RESET} ${RED}— ${high.length} package(s)${RESET}`,
    );
    for (const d of high) printDep(d, RED);
    console.log();
  }

  if (medium.length > 0) {
    console.log(
      `${YELLOW}${BOLD}  MEDIUM RISK (weak copyleft)${RESET} ${YELLOW}— ${medium.length} package(s)${RESET}`,
    );
    for (const d of medium) printDep(d, YELLOW);
    console.log();
  }

  if (unknown.length > 0) {
    console.log(
      `${GRAY}${BOLD}  UNKNOWN LICENSE${RESET} ${GRAY}— ${unknown.length} package(s)${RESET}`,
    );
    for (const d of unknown) printDep(d, GRAY);
    console.log();
  }

  if (options.showAll && low.length > 0) {
    console.log(
      `${GREEN}${BOLD}  LOW RISK (permissive)${RESET} ${GREEN}— ${low.length} package(s)${RESET}`,
    );
    for (const d of low) printDep(d, GREEN);
    console.log();
  } else if (low.length > 0) {
    console.log(
      `${GREEN}  LOW RISK (permissive) — ${low.length} package(s) ${DIM}(use --all to show)${RESET}\n`,
    );
  }

  // Summary
  const parts: string[] = [];
  if (high.length) parts.push(`${RED}${high.length} high${RESET}`);
  if (medium.length) parts.push(`${YELLOW}${medium.length} medium${RESET}`);
  if (unknown.length) parts.push(`${GRAY}${unknown.length} unknown${RESET}`);
  if (low.length) parts.push(`${GREEN}${low.length} permissive${RESET}`);

  let summaryLine = `  ${BOLD}Summary:${RESET} ${parts.join(', ')}`;
  if (results.summary.violations > 0) {
    summaryLine += ` ${MAGENTA}| ${results.summary.violations} policy violation(s)${RESET}`;
  }
  if (results.summary.overrides > 0) {
    summaryLine += ` ${DIM}| ${results.summary.overrides} overridden${RESET}`;
  }
  console.log(`${summaryLine}\n`);
}
