import type { RiskLevel } from './types.js';

const RISK: Record<'HIGH' | 'MEDIUM' | 'LOW' | 'UNKNOWN', RiskLevel> = {
  HIGH: 'high',
  MEDIUM: 'medium',
  LOW: 'low',
  UNKNOWN: 'unknown',
};

const LICENSE_MAP: Record<string, RiskLevel> = {
  // High risk — strong copyleft
  'AGPL-3.0': RISK.HIGH,
  'AGPL-3.0-only': RISK.HIGH,
  'AGPL-3.0-or-later': RISK.HIGH,
  'AGPL-1.0': RISK.HIGH,
  'AGPL-1.0-only': RISK.HIGH,
  'AGPL-1.0-or-later': RISK.HIGH,
  'GPL-2.0': RISK.HIGH,
  'GPL-2.0-only': RISK.HIGH,
  'GPL-2.0-or-later': RISK.HIGH,
  'GPL-3.0': RISK.HIGH,
  'GPL-3.0-only': RISK.HIGH,
  'GPL-3.0-or-later': RISK.HIGH,
  'SSPL-1.0': RISK.HIGH,
  'EUPL-1.1': RISK.HIGH,
  'EUPL-1.2': RISK.HIGH,
  'OSL-3.0': RISK.HIGH,
  'RPL-1.1': RISK.HIGH,
  'RPL-1.5': RISK.HIGH,

  // Medium risk — weak copyleft
  'LGPL-2.0': RISK.MEDIUM,
  'LGPL-2.0-only': RISK.MEDIUM,
  'LGPL-2.0-or-later': RISK.MEDIUM,
  'LGPL-2.1': RISK.MEDIUM,
  'LGPL-2.1-only': RISK.MEDIUM,
  'LGPL-2.1-or-later': RISK.MEDIUM,
  'LGPL-3.0': RISK.MEDIUM,
  'LGPL-3.0-only': RISK.MEDIUM,
  'LGPL-3.0-or-later': RISK.MEDIUM,
  'MPL-2.0': RISK.MEDIUM,
  'MPL-1.0': RISK.MEDIUM,
  'MPL-1.1': RISK.MEDIUM,
  'EPL-1.0': RISK.MEDIUM,
  'EPL-2.0': RISK.MEDIUM,
  'CDDL-1.0': RISK.MEDIUM,
  'CDDL-1.1': RISK.MEDIUM,
  'CPL-1.0': RISK.MEDIUM,
  'IPL-1.0': RISK.MEDIUM,
  'MS-RL': RISK.MEDIUM,
  'CECILL-2.1': RISK.MEDIUM,
  'APSL-2.0': RISK.MEDIUM,
  'EUPL-1.0': RISK.MEDIUM,

  // Low risk — permissive
  MIT: RISK.LOW,
  'Apache-2.0': RISK.LOW,
  'BSD-2-Clause': RISK.LOW,
  'BSD-3-Clause': RISK.LOW,
  'BSD-4-Clause': RISK.LOW,
  ISC: RISK.LOW,
  Unlicense: RISK.LOW,
  '0BSD': RISK.LOW,
  'CC0-1.0': RISK.LOW,
  'CC-BY-3.0': RISK.LOW,
  'CC-BY-4.0': RISK.LOW,
  Zlib: RISK.LOW,
  'BSL-1.0': RISK.LOW,
  'PSF-2.0': RISK.LOW,
  'Artistic-2.0': RISK.LOW,
  'MS-PL': RISK.LOW,
  WTFPL: RISK.LOW,
  PostgreSQL: RISK.LOW,
  'BlueOak-1.0.0': RISK.LOW,
  'Python-2.0': RISK.LOW,
  'Unicode-DFS-2016': RISK.LOW,
  'Unicode-3.0': RISK.LOW,
  X11: RISK.LOW,
  Vim: RISK.LOW,
  'AFL-3.0': RISK.LOW,
  Fair: RISK.LOW,
  'MulanPSL-2.0': RISK.LOW,
  NCSA: RISK.LOW,
  OpenSSL: RISK.LOW,
  'PHP-3.01': RISK.LOW,
  'TCP-wrappers': RISK.LOW,
  W3C: RISK.LOW,
};

export interface Classification {
  risk: RiskLevel;
  normalized: string | null;
}

// --- Tokenizer ---

type TokenType = 'LPAREN' | 'RPAREN' | 'OR' | 'AND' | 'WITH' | 'LICENSE';

interface Token {
  type: TokenType;
  value?: string;
}

function tokenize(expr: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < expr.length) {
    const ch = expr.charAt(i);
    if (ch === '(') {
      tokens.push({ type: 'LPAREN' });
      i++;
      continue;
    }
    if (ch === ')') {
      tokens.push({ type: 'RPAREN' });
      i++;
      continue;
    }
    if (/\s/.test(ch)) {
      i++;
      continue;
    }

    let word = '';
    while (i < expr.length && !/[\s()]/.test(expr.charAt(i))) word += expr.charAt(i++);

    const upper = word.toUpperCase();
    if (upper === 'OR') tokens.push({ type: 'OR' });
    else if (upper === 'AND') tokens.push({ type: 'AND' });
    else if (upper === 'WITH') tokens.push({ type: 'WITH' });
    else tokens.push({ type: 'LICENSE', value: word });
  }
  return tokens;
}

function isCompound(expression: string): boolean {
  return (
    / OR /i.test(expression) ||
    / AND /i.test(expression) ||
    / WITH /i.test(expression) ||
    /[()]/.test(expression)
  );
}

// --- Single license classification ---

function classifyLicense(license: string | null | undefined): Classification {
  if (!license) return { risk: RISK.UNKNOWN, normalized: null };

  const normalized = license.trim();
  if (!normalized || normalized === 'NOASSERTION' || normalized === 'NONE') {
    return { risk: RISK.UNKNOWN, normalized: null };
  }
  const direct = LICENSE_MAP[normalized];
  if (direct) return { risk: direct, normalized };

  const upper = normalized.toUpperCase();
  for (const [key, risk] of Object.entries(LICENSE_MAP)) {
    if (key.toUpperCase() === upper) return { risk, normalized: key };
  }

  if (/\bAGPL\b/i.test(normalized)) return { risk: RISK.HIGH, normalized };
  if (/\bGPL\b/i.test(normalized) && !/\bLGPL\b/i.test(normalized))
    return { risk: RISK.HIGH, normalized };
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

// --- SPDX expression parser (one grammar, three evaluators) ---
//
// Grammar: expr := and (OR and)* ; and := atom (AND atom)* ;
// atom := LPAREN expr RPAREN? | LICENSE (WITH LICENSE)? | <anything else>
// Malformed input recovers exactly like the historical per-purpose parsers:
// a missing/unexpected token becomes an `empty` node.

type SpdxNode =
  | { kind: 'license'; id: string | undefined }
  | { kind: 'or' | 'and'; left: SpdxNode; right: SpdxNode }
  | { kind: 'empty' };

const EMPTY: SpdxNode = { kind: 'empty' };

interface Parse {
  node: SpdxNode;
  pos: number;
}

function parseExpr(tokens: Token[], pos: number): Parse {
  let { node, pos: p } = parseAnd(tokens, pos);
  while (tokens[p]?.type === 'OR') {
    p++;
    const right = parseAnd(tokens, p);
    node = { kind: 'or', left: node, right: right.node };
    p = right.pos;
  }
  return { node, pos: p };
}

function parseAnd(tokens: Token[], pos: number): Parse {
  let { node, pos: p } = parseAtom(tokens, pos);
  while (tokens[p]?.type === 'AND') {
    p++;
    const right = parseAtom(tokens, p);
    node = { kind: 'and', left: node, right: right.node };
    p = right.pos;
  }
  return { node, pos: p };
}

function parseAtom(tokens: Token[], pos: number): Parse {
  const token = tokens[pos];
  if (!token) return { node: EMPTY, pos };
  if (token.type === 'LPAREN') {
    const inner = parseExpr(tokens, pos + 1);
    const p = tokens[inner.pos]?.type === 'RPAREN' ? inner.pos + 1 : inner.pos;
    return { node: inner.node, pos: p };
  }
  if (token.type === 'LICENSE') {
    // A WITH exception modifies obligations, not the license's risk class —
    // consume it but classify by the base license.
    let p = pos + 1;
    if (tokens[p]?.type === 'WITH') {
      p++;
      if (tokens[p]?.type === 'LICENSE') p++;
    }
    return { node: { kind: 'license', id: token.value }, pos: p };
  }
  return { node: EMPTY, pos: pos + 1 };
}

function parseExpression(trimmed: string): SpdxNode | null {
  const tokens = tokenize(trimmed);
  if (tokens.length === 0) return null;
  return parseExpr(tokens, 0).node;
}

// --- Evaluators ---

const RISK_ORDER: RiskLevel[] = [RISK.LOW, RISK.MEDIUM, RISK.HIGH, RISK.UNKNOWN];

function classifyNode(node: SpdxNode): Classification {
  switch (node.kind) {
    case 'empty':
      return { risk: RISK.UNKNOWN, normalized: null };
    case 'license':
      return classifyLicense(node.id);
    case 'or': {
      // OR: the consumer can choose, so the least risky branch wins (ties keep left).
      const left = classifyNode(node.left);
      const right = classifyNode(node.right);
      return RISK_ORDER.indexOf(left.risk) <= RISK_ORDER.indexOf(right.risk) ? left : right;
    }
    case 'and': {
      // AND: all branches bind, so the most risky branch wins (ties keep left).
      const left = classifyNode(node.left);
      const right = classifyNode(node.right);
      return RISK_ORDER.indexOf(left.risk) >= RISK_ORDER.indexOf(right.risk) ? left : right;
    }
  }
}

function isNodeDenied(node: SpdxNode, denySet: string[]): boolean {
  switch (node.kind) {
    case 'empty':
      return false;
    case 'license':
      return licenseMatchesSet(node.id, denySet);
    case 'or':
      // Denied only if every choice is denied.
      return isNodeDenied(node.left, denySet) && isNodeDenied(node.right, denySet);
    case 'and':
      // Denied if any required part is denied.
      return isNodeDenied(node.left, denySet) || isNodeDenied(node.right, denySet);
  }
}

function isNodeAllowed(node: SpdxNode, allowSet: string[]): boolean {
  switch (node.kind) {
    case 'empty':
      return false;
    case 'license':
      return licenseMatchesSet(node.id, allowSet);
    case 'or':
      // Allowed if any choice is allowed.
      return isNodeAllowed(node.left, allowSet) || isNodeAllowed(node.right, allowSet);
    case 'and':
      // Allowed only if every required part is allowed.
      return isNodeAllowed(node.left, allowSet) && isNodeAllowed(node.right, allowSet);
  }
}

// --- Public API ---

export function classifyExpression(expression: string | null | undefined): Classification {
  if (!expression) return { risk: RISK.UNKNOWN, normalized: null };
  const trimmed = expression.trim();
  if (!isCompound(trimmed)) return classifyLicense(trimmed);
  const node = parseExpression(trimmed);
  if (!node) return { risk: RISK.UNKNOWN, normalized: null };
  return classifyNode(node);
}

function licenseMatchesSet(license: string | null | undefined, set: string[]): boolean {
  if (!license) return false;
  const lower = license.trim().toLowerCase();
  for (const entry of set) {
    if (entry.toLowerCase() === lower) return true;
  }
  return false;
}

export function isExpressionDenied(
  expression: string | null | undefined,
  denyList: string[] | null | undefined,
): boolean {
  if (!expression || !denyList || denyList.length === 0) return false;
  const trimmed = expression.trim();
  if (!isCompound(trimmed)) return licenseMatchesSet(trimmed, denyList);
  const node = parseExpression(trimmed);
  if (!node) return false;
  return isNodeDenied(node, denyList);
}

export function isExpressionAllowed(
  expression: string | null | undefined,
  allowList: string[] | null | undefined,
): boolean {
  if (!expression) return false;
  if (!allowList || allowList.length === 0) return true;
  const trimmed = expression.trim();
  if (!isCompound(trimmed)) return licenseMatchesSet(trimmed, allowList);
  const node = parseExpression(trimmed);
  if (!node) return false;
  return isNodeAllowed(node, allowList);
}

export { RISK };
