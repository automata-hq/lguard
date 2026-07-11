import { describe, expect, test } from 'bun:test';
import {
  classifyExpression,
  isExpressionAllowed,
  isExpressionDenied,
  RISK,
} from '../src/licenses.js';

describe('RISK export', () => {
  test('maps constant names to level strings', () => {
    expect(RISK).toEqual({ HIGH: 'high', MEDIUM: 'medium', LOW: 'low', UNKNOWN: 'unknown' });
  });
});

describe('classifyExpression — single licenses', () => {
  const cases: Array<[string, string, string | null]> = [
    // [expression, risk, normalized]
    ['MIT', 'low', 'MIT'],
    ['Apache-2.0', 'low', 'Apache-2.0'],
    ['ISC', 'low', 'ISC'],
    ['BSD-3-Clause', 'low', 'BSD-3-Clause'],
    ['0BSD', 'low', '0BSD'],
    ['Unlicense', 'low', 'Unlicense'],
    ['GPL-3.0', 'high', 'GPL-3.0'],
    ['GPL-2.0-or-later', 'high', 'GPL-2.0-or-later'],
    ['AGPL-3.0', 'high', 'AGPL-3.0'],
    ['AGPL-3.0-or-later', 'high', 'AGPL-3.0-or-later'],
    ['SSPL-1.0', 'high', 'SSPL-1.0'],
    ['EUPL-1.2', 'high', 'EUPL-1.2'],
    ['OSL-3.0', 'high', 'OSL-3.0'],
    ['LGPL-3.0', 'medium', 'LGPL-3.0'],
    ['LGPL-2.1-or-later', 'medium', 'LGPL-2.1-or-later'],
    ['MPL-2.0', 'medium', 'MPL-2.0'],
    ['EPL-2.0', 'medium', 'EPL-2.0'],
    ['CDDL-1.0', 'medium', 'CDDL-1.0'],
    ['EUPL-1.0', 'medium', 'EUPL-1.0'],
  ];

  for (const [expr, risk, normalized] of cases) {
    test(`${expr} → ${risk}`, () => {
      expect(classifyExpression(expr)).toEqual({ risk, normalized });
    });
  }

  test('case-insensitive match returns the canonical SPDX id', () => {
    expect(classifyExpression('mit')).toEqual({ risk: 'low', normalized: 'MIT' });
    expect(classifyExpression('gpl-3.0')).toEqual({ risk: 'high', normalized: 'GPL-3.0' });
    expect(classifyExpression('aPaChE-2.0')).toEqual({ risk: 'low', normalized: 'Apache-2.0' });
  });

  test('whitespace is trimmed', () => {
    expect(classifyExpression('  MIT  ')).toEqual({ risk: 'low', normalized: 'MIT' });
  });

  test('empty / null / NOASSERTION / NONE → unknown with null normalized', () => {
    expect(classifyExpression('')).toEqual({ risk: 'unknown', normalized: null });
    expect(classifyExpression(null)).toEqual({ risk: 'unknown', normalized: null });
    expect(classifyExpression(undefined)).toEqual({ risk: 'unknown', normalized: null });
    expect(classifyExpression('   ')).toEqual({ risk: 'unknown', normalized: null });
    expect(classifyExpression('NOASSERTION')).toEqual({ risk: 'unknown', normalized: null });
    expect(classifyExpression('NONE')).toEqual({ risk: 'unknown', normalized: null });
  });
});

describe('classifyExpression — fuzzy fallbacks', () => {
  const cases: Array<[string, string]> = [
    ['GNU AGPL v3', 'high'],
    ['GNU GPL v3', 'high'],
    ['SSPL variant', 'high'],
    ['LGPL v2 style', 'medium'],
    ['some MPL thing', 'medium'],
    ['EPL variant', 'medium'],
    ['CDDL variant', 'medium'],
    ['MIT-style', 'low'],
    ['Apache style', 'low'],
    ['BSD like', 'low'],
    ['ISC style', 'low'],
    ['Completely Unrecognized License', 'unknown'],
  ];

  for (const [expr, risk] of cases) {
    test(`"${expr}" → ${risk}`, () => {
      const result = classifyExpression(expr);
      expect(result.risk).toBe(risk);
      expect(result.normalized).toBe(expr);
    });
  }

  test('LGPL is not misread as GPL (word-boundary + exclusion)', () => {
    expect(classifyExpression('LGPL-9.9').risk).toBe('medium');
    expect(classifyExpression('weird LGPL text').risk).toBe('medium');
  });

  test('embedded " or " makes a free-text string compound: only the first word classifies', () => {
    // "GNU GPL v3 or later" tokenizes as GNU|GPL|v3|OR|later; "GNU" alone is unknown.
    expect(classifyExpression('GNU GPL v3 or later').risk).toBe('unknown');
  });
});

describe('classifyExpression — compound expressions', () => {
  test('OR picks the least risky branch', () => {
    expect(classifyExpression('(MIT OR GPL-3.0)').risk).toBe('low');
    expect(classifyExpression('GPL-3.0 OR MIT').risk).toBe('low');
    expect(classifyExpression('LGPL-3.0 OR GPL-3.0').risk).toBe('medium');
  });

  test('AND picks the most risky branch', () => {
    expect(classifyExpression('MIT AND GPL-3.0').risk).toBe('high');
    expect(classifyExpression('(MIT AND LGPL-3.0)').risk).toBe('medium');
  });

  test('unknown ranks above high in AND, below everything in OR preference', () => {
    expect(classifyExpression('MIT AND SomeUnknownLicense').risk).toBe('unknown');
    expect(classifyExpression('GPL-3.0 AND SomeUnknownLicense').risk).toBe('unknown');
    expect(classifyExpression('GPL-3.0 OR SomeUnknownLicense').risk).toBe('high');
    expect(classifyExpression('MIT OR SomeUnknownLicense').risk).toBe('low');
  });

  test('OR binds looser than AND: A AND B OR C = (A AND B) OR C', () => {
    expect(classifyExpression('MIT AND GPL-3.0 OR Apache-2.0').risk).toBe('low');
    expect(classifyExpression('GPL-3.0 AND MIT OR AGPL-3.0').risk).toBe('high');
  });

  test('parentheses group correctly', () => {
    expect(classifyExpression('MIT AND (GPL-3.0 OR Apache-2.0)').risk).toBe('low');
    expect(classifyExpression('(MIT OR GPL-3.0) AND LGPL-3.0').risk).toBe('medium');
    expect(classifyExpression('((MIT))').risk).toBe('low');
  });

  test('WITH exception is skipped; the base license classifies', () => {
    expect(classifyExpression('GPL-2.0-only WITH Classpath-exception-2.0').risk).toBe('high');
    expect(classifyExpression('MIT OR GPL-2.0-only WITH Classpath-exception-2.0').risk).toBe('low');
  });

  test('operators are case-insensitive', () => {
    expect(classifyExpression('MIT or GPL-3.0').risk).toBe('low');
    expect(classifyExpression('MIT and GPL-3.0').risk).toBe('high');
  });
});

describe('classifyExpression — malformed input recovery (frozen behavior)', () => {
  test('unbalanced open paren', () => {
    expect(classifyExpression('(MIT').risk).toBe('low');
    expect(classifyExpression('(MIT OR GPL-3.0').risk).toBe('low');
  });

  test('unbalanced close paren', () => {
    expect(classifyExpression('MIT)').risk).toBe('low');
  });

  test('operator without surrounding spaces is not compound — falls to fuzzy match', () => {
    // isCompound requires " OR " / " AND " with spaces on both sides.
    expect(classifyExpression('MIT OR').risk).toBe('low');
    expect(classifyExpression('MIT AND').risk).toBe('low');
    expect(classifyExpression('OR MIT').risk).toBe('low');
    expect(classifyExpression('AND MIT').risk).toBe('low');
  });

  test('trailing operator inside parens hits parser recovery', () => {
    expect(classifyExpression('(MIT OR').risk).toBe('low');
    expect(classifyExpression('(MIT AND').risk).toBe('unknown');
  });

  test('leading operator inside parens hits parser recovery', () => {
    expect(classifyExpression('( OR MIT)').risk).toBe('unknown');
  });

  test('empty parens', () => {
    expect(classifyExpression('()').risk).toBe('unknown');
  });
});

describe('isExpressionDenied', () => {
  test('single license exact and case-insensitive match', () => {
    expect(isExpressionDenied('GPL-3.0', ['GPL-3.0'])).toBe(true);
    expect(isExpressionDenied('gpl-3.0', ['GPL-3.0'])).toBe(true);
    expect(isExpressionDenied('GPL-3.0', ['gpl-3.0'])).toBe(true);
    expect(isExpressionDenied('MIT', ['GPL-3.0'])).toBe(false);
  });

  test('no fuzzy matching against the deny set', () => {
    expect(isExpressionDenied('GNU GPL v3', ['GPL-3.0'])).toBe(false);
  });

  test('OR: denied only if ALL branches denied', () => {
    expect(isExpressionDenied('(MIT OR GPL-3.0)', ['GPL-3.0'])).toBe(false);
    expect(isExpressionDenied('(MIT OR GPL-3.0)', ['GPL-3.0', 'MIT'])).toBe(true);
  });

  test('AND: denied if ANY branch denied', () => {
    expect(isExpressionDenied('MIT AND GPL-3.0', ['GPL-3.0'])).toBe(true);
    expect(isExpressionDenied('MIT AND Apache-2.0', ['GPL-3.0'])).toBe(false);
  });

  test('nesting respects precedence', () => {
    expect(isExpressionDenied('MIT AND (GPL-3.0 OR Apache-2.0)', ['GPL-3.0'])).toBe(false);
    expect(isExpressionDenied('MIT AND (GPL-3.0 OR Apache-2.0)', ['GPL-3.0', 'Apache-2.0'])).toBe(
      true,
    );
  });

  test('WITH: the base license is matched, exception ignored', () => {
    expect(isExpressionDenied('GPL-2.0-only WITH Classpath-exception-2.0', ['GPL-2.0-only'])).toBe(
      true,
    );
    expect(
      isExpressionDenied('GPL-2.0-only WITH Classpath-exception-2.0', ['Classpath-exception-2.0']),
    ).toBe(false);
  });

  test('nullish expression or empty deny list → false', () => {
    expect(isExpressionDenied(null, ['GPL-3.0'])).toBe(false);
    expect(isExpressionDenied('', ['GPL-3.0'])).toBe(false);
    expect(isExpressionDenied('GPL-3.0', [])).toBe(false);
    expect(isExpressionDenied('GPL-3.0', null)).toBe(false);
    expect(isExpressionDenied('GPL-3.0', undefined)).toBe(false);
  });
});

describe('isExpressionAllowed', () => {
  test('single license exact and case-insensitive match', () => {
    expect(isExpressionAllowed('MIT', ['MIT'])).toBe(true);
    expect(isExpressionAllowed('mit', ['MIT'])).toBe(true);
    expect(isExpressionAllowed('GPL-3.0', ['MIT'])).toBe(false);
  });

  test('OR: allowed if ANY branch allowed', () => {
    expect(isExpressionAllowed('(MIT OR GPL-3.0)', ['MIT'])).toBe(true);
    expect(isExpressionAllowed('(AGPL-3.0 OR GPL-3.0)', ['MIT'])).toBe(false);
  });

  test('AND: allowed only if ALL branches allowed', () => {
    expect(isExpressionAllowed('MIT AND GPL-3.0', ['MIT'])).toBe(false);
    expect(isExpressionAllowed('MIT AND Apache-2.0', ['MIT', 'Apache-2.0'])).toBe(true);
  });

  test('WITH: the base license is matched, exception ignored', () => {
    expect(isExpressionAllowed('GPL-2.0-only WITH Classpath-exception-2.0', ['GPL-2.0-only'])).toBe(
      true,
    );
  });

  test('null expression → false, even with an empty allow list', () => {
    expect(isExpressionAllowed(null, ['MIT'])).toBe(false);
    expect(isExpressionAllowed(undefined, ['MIT'])).toBe(false);
  });

  test('empty or missing allow list → true (no restriction)', () => {
    expect(isExpressionAllowed('GPL-3.0', [])).toBe(true);
    expect(isExpressionAllowed('GPL-3.0', null)).toBe(true);
    expect(isExpressionAllowed('GPL-3.0', undefined)).toBe(true);
  });
});
