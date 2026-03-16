const RISK = { HIGH: 'high', MEDIUM: 'medium', LOW: 'low', UNKNOWN: 'unknown' };

const LICENSE_MAP = {
  // High risk — strong copyleft
  'AGPL-3.0': RISK.HIGH, 'AGPL-3.0-only': RISK.HIGH, 'AGPL-3.0-or-later': RISK.HIGH,
  'AGPL-1.0': RISK.HIGH, 'AGPL-1.0-only': RISK.HIGH, 'AGPL-1.0-or-later': RISK.HIGH,
  'GPL-2.0': RISK.HIGH, 'GPL-2.0-only': RISK.HIGH, 'GPL-2.0-or-later': RISK.HIGH,
  'GPL-3.0': RISK.HIGH, 'GPL-3.0-only': RISK.HIGH, 'GPL-3.0-or-later': RISK.HIGH,
  'SSPL-1.0': RISK.HIGH,
  'EUPL-1.1': RISK.HIGH, 'EUPL-1.2': RISK.HIGH,
  'OSL-3.0': RISK.HIGH,
  'RPL-1.1': RISK.HIGH, 'RPL-1.5': RISK.HIGH,

  // Medium risk — weak copyleft
  'LGPL-2.0': RISK.MEDIUM, 'LGPL-2.0-only': RISK.MEDIUM, 'LGPL-2.0-or-later': RISK.MEDIUM,
  'LGPL-2.1': RISK.MEDIUM, 'LGPL-2.1-only': RISK.MEDIUM, 'LGPL-2.1-or-later': RISK.MEDIUM,
  'LGPL-3.0': RISK.MEDIUM, 'LGPL-3.0-only': RISK.MEDIUM, 'LGPL-3.0-or-later': RISK.MEDIUM,
  'MPL-2.0': RISK.MEDIUM, 'MPL-1.0': RISK.MEDIUM, 'MPL-1.1': RISK.MEDIUM,
  'EPL-1.0': RISK.MEDIUM, 'EPL-2.0': RISK.MEDIUM,
  'CDDL-1.0': RISK.MEDIUM, 'CDDL-1.1': RISK.MEDIUM,
  'CPL-1.0': RISK.MEDIUM,
  'IPL-1.0': RISK.MEDIUM,
  'MS-RL': RISK.MEDIUM,
  'CECILL-2.1': RISK.MEDIUM,
  'APSL-2.0': RISK.MEDIUM,
  'EUPL-1.0': RISK.MEDIUM,

  // Low risk — permissive
  'MIT': RISK.LOW,
  'Apache-2.0': RISK.LOW,
  'BSD-2-Clause': RISK.LOW, 'BSD-3-Clause': RISK.LOW, 'BSD-4-Clause': RISK.LOW,
  'ISC': RISK.LOW,
  'Unlicense': RISK.LOW,
  '0BSD': RISK.LOW,
  'CC0-1.0': RISK.LOW,
  'CC-BY-3.0': RISK.LOW, 'CC-BY-4.0': RISK.LOW,
  'Zlib': RISK.LOW,
  'BSL-1.0': RISK.LOW,
  'PSF-2.0': RISK.LOW,
  'Artistic-2.0': RISK.LOW,
  'MS-PL': RISK.LOW,
  'WTFPL': RISK.LOW,
  'PostgreSQL': RISK.LOW,
  'BlueOak-1.0.0': RISK.LOW,
  'Python-2.0': RISK.LOW,
  'Unicode-DFS-2016': RISK.LOW, 'Unicode-3.0': RISK.LOW,
  'X11': RISK.LOW,
  'Vim': RISK.LOW,
  'AFL-3.0': RISK.LOW,
  'Fair': RISK.LOW,
  'MulanPSL-2.0': RISK.LOW,
  'NCSA': RISK.LOW,
  'OpenSSL': RISK.LOW,
  'PHP-3.01': RISK.LOW,
  'TCP-wrappers': RISK.LOW,
  'W3C': RISK.LOW,
};

function classifyLicense(license) {
  if (!license) return { risk: RISK.UNKNOWN, normalized: null };

  const normalized = license.trim();
  if (LICENSE_MAP[normalized]) return { risk: LICENSE_MAP[normalized], normalized };

  // Case-insensitive match
  const upper = normalized.toUpperCase();
  for (const [key, risk] of Object.entries(LICENSE_MAP)) {
    if (key.toUpperCase() === upper) return { risk, normalized: key };
  }

  // Pattern matching for common variations
  if (/\bAGPL\b/i.test(normalized)) return { risk: RISK.HIGH, normalized };
  if (/\bGPL\b/i.test(normalized) && !/\bLGPL\b/i.test(normalized)) return { risk: RISK.HIGH, normalized };
  if (/\bSSPL\b/i.test(normalized)) return { risk: RISK.HIGH, normalized };
  if (/\bLGPL\b/i.test(normalized)) return { risk: RISK.MEDIUM, normalized };
  if (/\bMPL\b/i.test(normalized)) return { risk: RISK.MEDIUM, normalized };
  if (/\bEPL\b/i.test(normalized)) return { risk: RISK.MEDIUM, normalized };
  if (/\bCDDL\b/i.test(normalized)) return { risk: RISK.MEDIUM, normalized };
  if (/\bMIT\b/i.test(normalized)) return { risk: RISK.LOW, normalized };
  if (/\bApache\b/i.test(normalized)) return { risk: RISK.LOW, normalized };
  if (/\bBSD\b/i.test(normalized)) return { risk: RISK.LOW, normalized };
  if (/\bISC\b/i.test(normalized)) return { risk: RISK.LOW, normalized };

  return { risk: RISK.UNKNOWN, normalized };
}

// Tokenize SPDX expression into atoms, operators, and parens
function tokenize(expr) {
  const tokens = [];
  let i = 0;
  while (i < expr.length) {
    if (expr[i] === '(') { tokens.push({ type: 'LPAREN' }); i++; continue; }
    if (expr[i] === ')') { tokens.push({ type: 'RPAREN' }); i++; continue; }
    if (/\s/.test(expr[i])) { i++; continue; }

    let word = '';
    while (i < expr.length && !/[\s()]/.test(expr[i])) word += expr[i++];

    const upper = word.toUpperCase();
    if (upper === 'OR') tokens.push({ type: 'OR' });
    else if (upper === 'AND') tokens.push({ type: 'AND' });
    else if (upper === 'WITH') tokens.push({ type: 'WITH' });
    else tokens.push({ type: 'LICENSE', value: word });
  }
  return tokens;
}

// Recursive descent parser for SPDX expressions
// Handles: license WITH exception, AND, OR, parentheses
function parseExpression(tokens, pos) {
  let { result, pos: newPos } = parseAnd(tokens, pos);
  while (newPos < tokens.length && tokens[newPos].type === 'OR') {
    newPos++;
    const right = parseAnd(tokens, newPos);
    // OR = you can choose, pick least risky
    const order = [RISK.LOW, RISK.MEDIUM, RISK.HIGH, RISK.UNKNOWN];
    result = order.indexOf(result.risk) <= order.indexOf(right.result.risk) ? result : right.result;
    newPos = right.pos;
  }
  return { result, pos: newPos };
}

function parseAnd(tokens, pos) {
  let { result, pos: newPos } = parseAtom(tokens, pos);
  while (newPos < tokens.length && tokens[newPos].type === 'AND') {
    newPos++;
    const right = parseAtom(tokens, newPos);
    // AND = must comply with all, pick most risky
    const order = [RISK.LOW, RISK.MEDIUM, RISK.HIGH, RISK.UNKNOWN];
    result = order.indexOf(result.risk) >= order.indexOf(right.result.risk) ? result : right.result;
    newPos = right.pos;
  }
  return { result, pos: newPos };
}

function parseAtom(tokens, pos) {
  if (pos >= tokens.length) return { result: { risk: RISK.UNKNOWN, normalized: null }, pos };

  if (tokens[pos].type === 'LPAREN') {
    const inner = parseExpression(tokens, pos + 1);
    // consume RPAREN if present
    const newPos = inner.pos < tokens.length && tokens[inner.pos].type === 'RPAREN' ? inner.pos + 1 : inner.pos;
    return { result: inner.result, pos: newPos };
  }

  if (tokens[pos].type === 'LICENSE') {
    let licenseId = tokens[pos].value;
    let newPos = pos + 1;
    // Handle WITH exception (e.g., GPL-2.0-only WITH Classpath-exception-2.0)
    if (newPos < tokens.length && tokens[newPos].type === 'WITH') {
      newPos++; // skip WITH
      if (newPos < tokens.length && tokens[newPos].type === 'LICENSE') newPos++; // skip exception
    }
    return { result: classifyLicense(licenseId), pos: newPos };
  }

  return { result: { risk: RISK.UNKNOWN, normalized: null }, pos: pos + 1 };
}

export function classifyExpression(expression) {
  if (!expression) return { risk: RISK.UNKNOWN, normalized: null };

  const trimmed = expression.trim();
  // Fast path for simple license IDs (no operators or parens)
  if (!/[\s()]/.test(trimmed) || (!/ OR /i.test(trimmed) && !/ AND /i.test(trimmed) && !/ WITH /i.test(trimmed))) {
    return classifyLicense(trimmed);
  }

  const tokens = tokenize(trimmed);
  if (tokens.length === 0) return { risk: RISK.UNKNOWN, normalized: null };
  return parseExpression(tokens, 0).result;
}

export { RISK };
