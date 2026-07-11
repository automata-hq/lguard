import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test';
import { join } from 'node:path';
import { main } from '../src/main.js';
import { FIXTURES, removeDir, tempDir } from './helpers.js';

const NPM_PROJECT = join(FIXTURES, 'npm-project');
const NPM_PROJECT_CONFIG = join(FIXTURES, 'npm-project-config');

let logs: string[];
let errors: string[];
let logSpy: ReturnType<typeof spyOn>;
let errorSpy: ReturnType<typeof spyOn>;

beforeEach(() => {
  logs = [];
  errors = [];
  logSpy = spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
    logs.push(args.map(String).join(' '));
  });
  errorSpy = spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
    errors.push(args.map(String).join(' '));
  });
});

afterEach(() => {
  logSpy.mockRestore();
  errorSpy.mockRestore();
});

describe('main — in-process exit codes', () => {
  test('--help → 0 with usage text', async () => {
    expect(await main(['--help'])).toBe(0);
    expect(logs.join('\n')).toContain('Usage: lguard [path] [options]');
  });

  test('unknown flag → 1 with exact stderr', async () => {
    expect(await main(['--nope'])).toBe(1);
    expect(errors).toEqual(['Unknown flag: --nope']);
  });

  test('invalid --fail-on → 1', async () => {
    expect(await main(['--fail-on=banana'])).toBe(1);
    expect(errors).toEqual([
      'Invalid --fail-on level: banana. Must be one of: high, medium, unknown',
    ]);
  });

  test('clean scan → 0; --fail-on=high on risky fixture → 1', async () => {
    expect(await main([NPM_PROJECT])).toBe(0);
    expect(await main([NPM_PROJECT, '--fail-on=high'])).toBe(1);
    expect(await main([NPM_PROJECT, '--fail-on=medium'])).toBe(1);
    expect(await main([NPM_PROJECT, '--fail-on=unknown'])).toBe(1);
  });

  test('config violations force 1 even without --fail-on', async () => {
    expect(await main([NPM_PROJECT_CONFIG])).toBe(1);
  });

  test('overridden deps do not trip --fail-on', async () => {
    // npm-project-config denies GPL-3.0/AGPL-3.0 but overrides transitive-gpl;
    // gpl-pkg still violates, proving overrides are per-package.
    expect(await main([NPM_PROJECT_CONFIG, '--json'])).toBe(1);
    const parsed = JSON.parse(logs.join('\n'));
    const overridden = parsed.dependencies.find(
      (d: { name: string }) => d.name === 'transitive-gpl',
    );
    expect(overridden.violation).toBe(false);
    expect(overridden.overrideReason).toBe('Reviewed — internal tool only');
  });

  test('--json emits parseable JSON on stdout', async () => {
    expect(await main([NPM_PROJECT, '--json'])).toBe(0);
    const parsed = JSON.parse(logs.join('\n'));
    expect(parsed.summary.total).toBe(9);
  });

  describe('--init', () => {
    let dir: string;

    afterEach(async () => {
      await removeDir(dir);
    });

    test('creates config then refuses to overwrite', async () => {
      dir = await tempDir();
      expect(await main(['--init', dir])).toBe(0);
      expect(logs[0]).toBe(`Created ${join(dir, '.lguardrc')}`);
      expect(await main(['--init', dir])).toBe(1);
      expect(errors).toEqual(['Error: .lguardrc already exists']);
    });
  });
});
