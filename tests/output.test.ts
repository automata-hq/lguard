import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { formatResults } from '../src/output.js';
import { FIXTURES, normalizeVersion } from './helpers.js';

const GOLDEN = join(FIXTURES, 'golden');

let logSpy: ReturnType<typeof spyOn>;
let captured: string[];

beforeEach(() => {
  captured = [];
  logSpy = spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
    captured.push(args.map(String).join(' '));
  });
});

afterEach(() => {
  logSpy.mockRestore();
});

function capturedText(): string {
  return `${captured.join('\n')}\n`;
}

async function synthetic() {
  return JSON.parse(await readFile(join(GOLDEN, 'synthetic-scan-result.json'), 'utf-8'));
}

describe('formatResults', () => {
  test('--all output matches the v0.3.1 golden byte-for-byte (version-normalized)', async () => {
    formatResults(await synthetic(), { showAll: true });
    const golden = await readFile(join(GOLDEN, 'synthetic-human-all.txt'), 'utf-8');
    expect(normalizeVersion(capturedText())).toBe(normalizeVersion(golden));
  });

  test('collapsed output matches the v0.3.1 golden byte-for-byte (version-normalized)', async () => {
    formatResults(await synthetic(), {});
    const golden = await readFile(join(GOLDEN, 'synthetic-human-collapsed.txt'), 'utf-8');
    expect(normalizeVersion(capturedText())).toBe(normalizeVersion(golden));
  });

  test('collapsed mode hides low-risk entries behind a count line', async () => {
    formatResults(await synthetic(), {});
    const text = capturedText();
    expect(text).toContain('LOW RISK (permissive) — 2 package(s)');
    expect(text).toContain('(use --all to show)');
    expect(text).not.toContain('nice-pkg@4.2.0');
  });

  test('control characters in package names and licenses are stripped', async () => {
    formatResults(await synthetic(), { showAll: true });
    const text = capturedText();
    // The hostile name embeds ESC[31m; sanitize() must remove the ESC byte.
    expect(text).toContain('hostile[31m-pkg@1.0.0');
    expect(text).not.toContain('hostile\u001b[31m');
    expect(text).not.toContain('\u0007');
  });

  test('chain, override reason, and violation reason render', async () => {
    formatResults(await synthetic(), { showAll: true });
    const text = capturedText();
    expect(text).toContain('└─ express > middleware-x > evil-lib');
    expect(text).toContain('"Dynamically linked - LGPL allows this use"');
    expect(text).toContain('denied by policy');
    expect(text).toContain('VIOLATION');
  });

  test('summary line composes counts, violations, and overrides', async () => {
    formatResults(await synthetic(), { showAll: true });
    const text = capturedText();
    expect(text).toContain('2 high');
    expect(text).toContain('1 medium');
    expect(text).toContain('1 unknown');
    expect(text).toContain('2 permissive');
    expect(text).toContain('1 policy violation(s)');
    expect(text).toContain('1 overridden');
  });
});
