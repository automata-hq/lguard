const RED = '\x1b[31m';
const YELLOW = '\x1b[33m';
const GREEN = '\x1b[32m';
const GRAY = '\x1b[90m';
const BOLD = '\x1b[1m';
const RESET = '\x1b[0m';
const DIM = '\x1b[2m';
const MAGENTA = '\x1b[35m';

// eslint-disable-next-line no-control-regex
const CTRL_RE = /[\x00-\x1f\x7f-\x9f]/g;
function sanitize(str) {
  return str ? str.replace(CTRL_RE, '') : str;
}

function depLine(d, color) {
  const nameVer = sanitize(`${d.name}@${d.version}`);
  const license = sanitize(d.license || 'NONE');
  const directTag = d.direct ? '' : ` ${DIM}(transitive)${RESET}`;
  const overrideTag = d.overrideReason ? ` ${GREEN}overridden${RESET}` : '';
  const violationTag = d.violation ? ` ${RED}VIOLATION${RESET}` : '';
  return `    ${nameVer.padEnd(45)} ${color}${license.padEnd(20)}${RESET} ${DIM}[${d.ecosystem}]${RESET}${directTag}${overrideTag}${violationTag}`;
}

function chainLine(d) {
  if (!d.chain || d.chain.length === 0) return null;
  return `      ${DIM}\u2514\u2500 ${d.chain.join(' > ')}${RESET}`;
}

function printDep(d, color) {
  console.log(depLine(d, color));
  const chain = chainLine(d);
  if (chain) console.log(chain);
  if (d.overrideReason) {
    console.log(`      ${DIM}"${sanitize(d.overrideReason)}"${RESET}`);
  }
}

export function formatResults(results, options = {}) {
  console.log(`\n${BOLD}lguard${RESET} ${DIM}v0.2.0${RESET}\n`);
  console.log(`  Path:        ${results.path}`);
  console.log(`  Ecosystems:  ${results.ecosystems.join(', ')}`);
  console.log(`  Total deps:  ${results.summary.total}`);
  if (results.hasConfig) console.log(`  Config:      .lguardrc`);
  console.log();

  const violations = results.dependencies.filter(d => d.violation);
  const high = results.dependencies.filter(d => d.risk === 'high');
  const medium = results.dependencies.filter(d => d.risk === 'medium');
  const unknown = results.dependencies.filter(d => d.risk === 'unknown');
  const low = results.dependencies.filter(d => d.risk === 'low');

  // Policy violations first (when config is active)
  if (violations.length > 0) {
    console.log(`${MAGENTA}${BOLD}  POLICY VIOLATIONS${RESET} ${MAGENTA}\u2014 ${violations.length} package(s)${RESET}`);
    for (const d of violations) {
      printDep(d, MAGENTA);
      if (d.violationReason) {
        console.log(`      ${MAGENTA}${d.violationReason}${RESET}`);
      }
    }
    console.log();
  }

  if (high.length > 0) {
    console.log(`${RED}${BOLD}  HIGH RISK (copyleft)${RESET} ${RED}\u2014 ${high.length} package(s)${RESET}`);
    for (const d of high) printDep(d, RED);
    console.log();
  }

  if (medium.length > 0) {
    console.log(`${YELLOW}${BOLD}  MEDIUM RISK (weak copyleft)${RESET} ${YELLOW}\u2014 ${medium.length} package(s)${RESET}`);
    for (const d of medium) printDep(d, YELLOW);
    console.log();
  }

  if (unknown.length > 0) {
    console.log(`${GRAY}${BOLD}  UNKNOWN LICENSE${RESET} ${GRAY}\u2014 ${unknown.length} package(s)${RESET}`);
    for (const d of unknown) printDep(d, GRAY);
    console.log();
  }

  if (options.showAll && low.length > 0) {
    console.log(`${GREEN}${BOLD}  LOW RISK (permissive)${RESET} ${GREEN}\u2014 ${low.length} package(s)${RESET}`);
    for (const d of low) printDep(d, GREEN);
    console.log();
  } else if (low.length > 0) {
    console.log(`${GREEN}  LOW RISK (permissive) \u2014 ${low.length} package(s) ${DIM}(use --all to show)${RESET}\n`);
  }

  // Summary
  const parts = [];
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
  console.log(summaryLine + '\n');
}
