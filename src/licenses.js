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

// --- Tokenizer ---

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

function isCompound(expression) {
  return / OR /i.test(expression) || / AND /i.test(expression) || / WITH /i.test(expression) || /[()]/.test(expression);
}

// --- Single license classification ---

function classifyLicense(license) {
  if (!license) return { risk: RISK.UNKNOWN, normalized: null };

  const normalized = license.trim();
  if (LICENSE_MAP[normalized]) return { risk: LICENSE_MAP[normalized], normalized };

  const upper = normalized.toUpperCase();
  for (const [key, risk] of Object.entries(LICENSE_MAP)) {
    if (key.toUpperCase() === upper) return { risk, normalized: key };
  }

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

// --- Risk classification (recursive descent) ---

const RISK_ORDER = [RISK.LOW, RISK.MEDIUM, RISK.HIGH, RISK.UNKNOWN];

function parseRiskExpr(tokens, pos) {
  let { result, pos: p } = parseRiskAnd(tokens, pos);
  while (p < tokens.length && tokens[p].type === 'OR') {
    p++;
    const right = parseRiskAnd(tokens, p);
    result = RISK_ORDER.indexOf(result.risk) <= RISK_ORDER.indexOf(right.result.risk) ? result : right.result;
    p = right.pos;
  }
  return { result, pos: p };
}

function parseRiskAnd(tokens, pos) {
  let { result, pos: p } = parseRiskAtom(tokens, pos);
  while (p < tokens.length && tokens[p].type === 'AND') {
    p++;
    const right = parseRiskAtom(tokens, p);
    result = RISK_ORDER.indexOf(result.risk) >= RISK_ORDER.indexOf(right.result.risk) ? result : right.result;
    p = right.pos;
  }
  return { result, pos: p };
}

function parseRiskAtom(tokens, pos) {
  if (pos >= tokens.length) return { result: { risk: RISK.UNKNOWN, normalized: null }, pos };
  if (tokens[pos].type === 'LPAREN') {
    const inner = parseRiskExpr(tokens, pos + 1);
    const p = inner.pos < tokens.length && tokens[inner.pos].type === 'RPAREN' ? inner.pos + 1 : inner.pos;
    return { result: inner.result, pos: p };
  }
  if (tokens[pos].type === 'LICENSE') {
    let p = pos + 1;
    if (p < tokens.length && tokens[p].type === 'WITH') {
      p++;
      if (p < tokens.length && tokens[p].type === 'LICENSE') p++;
    }
    return { result: classifyLicense(tokens[pos].value), pos: p };
  }
  return { result: { risk: RISK.UNKNOWN, normalized: null }, pos: pos + 1 };
}

export function classifyExpression(expression) {
  if (!expression) return { risk: RISK.UNKNOWN, normalized: null };
  const trimmed = expression.trim();
  if (!isCompound(trimmed)) return classifyLicense(trimmed);
  const tokens = tokenize(trimmed);
  if (tokens.length === 0) return { risk: RISK.UNKNOWN, normalized: null };
  return parseRiskExpr(tokens, 0).result;
}

// --- Policy evaluation (allow/deny against SPDX expressions) ---

function licenseMatchesSet(license, set) {
  if (!license) return false;
  const lower = license.trim().toLowerCase();
  for (const entry of set) {
    if (entry.toLowerCase() === lower) return true;
  }
  return false;
}

// Deny: OR = violation only if ALL branches denied, AND = violation if ANY branch denied
function parseDenyExpr(tokens, pos, denySet) {
  let { result, pos: p } = parseDenyAnd(tokens, pos, denySet);
  while (p < tokens.length && tokens[p].type === 'OR') {
    p++;
    const right = parseDenyAnd(tokens, p, denySet);
    // OR: denied only if both sides denied (can choose the non-denied one)
    result = result && right.result;
    p = right.pos;
  }
  return { result, pos: p };
}

function parseDenyAnd(tokens, pos, denySet) {
  let { result, pos: p } = parseDenyAtom(tokens, pos, denySet);
  while (p < tokens.length && tokens[p].type === 'AND') {
    p++;
    const right = parseDenyAtom(tokens, p, denySet);
    // AND: denied if either side denied
    result = result || right.result;
    p = right.pos;
  }
  return { result, pos: p };
}

function parseDenyAtom(tokens, pos, denySet) {
  if (pos >= tokens.length) return { result: false, pos };
  if (tokens[pos].type === 'LPAREN') {
    const inner = parseDenyExpr(tokens, pos + 1, denySet);
    const p = inner.pos < tokens.length && tokens[inner.pos].type === 'RPAREN' ? inner.pos + 1 : inner.pos;
    return { result: inner.result, pos: p };
  }
  if (tokens[pos].type === 'LICENSE') {
    let p = pos + 1;
    if (p < tokens.length && tokens[p].type === 'WITH') {
      p++;
      if (p < tokens.length && tokens[p].type === 'LICENSE') p++;
    }
    return { result: licenseMatchesSet(tokens[pos].value, denySet), pos: p };
  }
  return { result: false, pos: pos + 1 };
}

// Allow: OR = allowed if ANY branch allowed, AND = allowed only if ALL branches allowed
function parseAllowExpr(tokens, pos, allowSet) {
  let { result, pos: p } = parseAllowAnd(tokens, pos, allowSet);
  while (p < tokens.length && tokens[p].type === 'OR') {
    p++;
    const right = parseAllowAnd(tokens, p, allowSet);
    // OR: allowed if either side allowed
    result = result || right.result;
    p = right.pos;
  }
  return { result, pos: p };
}

function parseAllowAnd(tokens, pos, allowSet) {
  let { result, pos: p } = parseAllowAtom(tokens, pos, allowSet);
  while (p < tokens.length && tokens[p].type === 'AND') {
    p++;
    const right = parseAllowAtom(tokens, p, allowSet);
    // AND: allowed only if both sides allowed
    result = result && right.result;
    p = right.pos;
  }
  return { result, pos: p };
}

function parseAllowAtom(tokens, pos, allowSet) {
  if (pos >= tokens.length) return { result: false, pos };
  if (tokens[pos].type === 'LPAREN') {
    const inner = parseAllowExpr(tokens, pos + 1, allowSet);
    const p = inner.pos < tokens.length && tokens[inner.pos].type === 'RPAREN' ? inner.pos + 1 : inner.pos;
    return { result: inner.result, pos: p };
  }
  if (tokens[pos].type === 'LICENSE') {
    let p = pos + 1;
    if (p < tokens.length && tokens[p].type === 'WITH') {
      p++;
      if (p < tokens.length && tokens[p].type === 'LICENSE') p++;
    }
    return { result: licenseMatchesSet(tokens[pos].value, allowSet), pos: p };
  }
  return { result: false, pos: pos + 1 };
}

export function isExpressionDenied(expression, denyList) {
  if (!expression || !denyList || denyList.length === 0) return false;
  const trimmed = expression.trim();
  if (!isCompound(trimmed)) return licenseMatchesSet(trimmed, denyList);
  const tokens = tokenize(trimmed);
  if (tokens.length === 0) return false;
  return parseDenyExpr(tokens, 0, denyList).result;
}

export function isExpressionAllowed(expression, allowList) {
  if (!expression) return false;
  if (!allowList || allowList.length === 0) return true;
  const trimmed = expression.trim();
  if (!isCompound(trimmed)) return licenseMatchesSet(trimmed, allowList);
  const tokens = tokenize(trimmed);
  if (tokens.length === 0) return false;
  return parseAllowExpr(tokens, 0, allowList).result;
}

export { RISK };
