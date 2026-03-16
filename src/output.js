const RED = '\x1b[31m';
const YELLOW = '\x1b[33m';
const GREEN = '\x1b[32m';
const GRAY = '\x1b[90m';
const BOLD = '\x1b[1m';
const RESET = '\x1b[0m';
const DIM = '\x1b[2m';

// Strip ANSI/control characters from untrusted package metadata
function sanitize(str) {
  if (!str) return str;
  // eslint-disable-next-line no-control-regex
  return str.replace(/[\x00-\x1f\x7f-\x9f]/g, '');
}

export function formatResults(results, options = {}) {
  console.log(`\n${BOLD}lguard${RESET} ${DIM}v0.1.0${RESET}\n`);
  console.log(`  Path:        ${results.path}`);
  console.log(`  Ecosystems:  ${results.ecosystems.join(', ')}`);
  console.log(`  Total deps:  ${results.summary.total}\n`);

  const high = results.dependencies.filter(d => d.risk === 'high');
  const medium = results.dependencies.filter(d => d.risk === 'medium');
  const unknown = results.dependencies.filter(d => d.risk === 'unknown');
  const low = results.dependencies.filter(d => d.risk === 'low');

  if (high.length > 0) {
    console.log(`${RED}${BOLD}  HIGH RISK (copyleft)${RESET} ${RED}— ${high.length} package(s)${RESET}`);
    for (const d of high) {
      const nameVer = sanitize(`${d.name}@${d.version}`);
      console.log(`    ${nameVer.padEnd(45)} ${RED}${sanitize(d.license || 'UNKNOWN').padEnd(20)}${RESET} ${DIM}[${d.ecosystem}]${RESET}`);
    }
    console.log();
  }

  if (medium.length > 0) {
    console.log(`${YELLOW}${BOLD}  MEDIUM RISK (weak copyleft)${RESET} ${YELLOW}— ${medium.length} package(s)${RESET}`);
    for (const d of medium) {
      const nameVer = sanitize(`${d.name}@${d.version}`);
      console.log(`    ${nameVer.padEnd(45)} ${YELLOW}${sanitize(d.license || 'UNKNOWN').padEnd(20)}${RESET} ${DIM}[${d.ecosystem}]${RESET}`);
    }
    console.log();
  }

  if (unknown.length > 0) {
    console.log(`${GRAY}${BOLD}  UNKNOWN LICENSE${RESET} ${GRAY}— ${unknown.length} package(s)${RESET}`);
    for (const d of unknown) {
      const nameVer = sanitize(`${d.name}@${d.version}`);
      console.log(`    ${nameVer.padEnd(45)} ${GRAY}${sanitize(d.license || 'NONE').padEnd(20)}${RESET} ${DIM}[${d.ecosystem}]${RESET}`);
    }
    console.log();
  }

  if (options.showAll && low.length > 0) {
    console.log(`${GREEN}${BOLD}  LOW RISK (permissive)${RESET} ${GREEN}— ${low.length} package(s)${RESET}`);
    for (const d of low) {
      const nameVer = sanitize(`${d.name}@${d.version}`);
      console.log(`    ${nameVer.padEnd(45)} ${GREEN}${sanitize(d.license || 'UNKNOWN').padEnd(20)}${RESET} ${DIM}[${d.ecosystem}]${RESET}`);
    }
    console.log();
  } else if (low.length > 0) {
    console.log(`${GREEN}  LOW RISK (permissive) — ${low.length} package(s) ${DIM}(use --all to show)${RESET}\n`);
  }

  // Summary
  const parts = [];
  if (high.length) parts.push(`${RED}${high.length} high${RESET}`);
  if (medium.length) parts.push(`${YELLOW}${medium.length} medium${RESET}`);
  if (unknown.length) parts.push(`${GRAY}${unknown.length} unknown${RESET}`);
  if (low.length) parts.push(`${GREEN}${low.length} permissive${RESET}`);
  console.log(`  ${BOLD}Summary:${RESET} ${parts.join(', ')}\n`);
}
