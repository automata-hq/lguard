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
  'AGPL-3.0-only WITH': RISK.HIGH,

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

export function classifyExpression(expression) {
  if (!expression) return { risk: RISK.UNKNOWN, normalized: null };

  // Handle SPDX OR — you can choose, so pick least risky
  if (/\bOR\b/i.test(expression)) {
    const parts = expression.replace(/[()]/g, '').split(/\s+OR\s+/i);
    const classified = parts.map(p => classifyLicense(p.trim()));
    const order = [RISK.LOW, RISK.MEDIUM, RISK.HIGH, RISK.UNKNOWN];
    classified.sort((a, b) => order.indexOf(a.risk) - order.indexOf(b.risk));
    return classified[0];
  }

  // Handle SPDX AND — must comply with all, so pick most risky
  if (/\bAND\b/i.test(expression)) {
    const parts = expression.replace(/[()]/g, '').split(/\s+AND\s+/i);
    const classified = parts.map(p => classifyLicense(p.trim()));
    const order = [RISK.LOW, RISK.MEDIUM, RISK.HIGH, RISK.UNKNOWN];
    classified.sort((a, b) => order.indexOf(b.risk) - order.indexOf(a.risk));
    return classified[0];
  }

  return classifyLicense(expression);
}

export { RISK };
