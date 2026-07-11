import { afterEach, describe, expect, test } from 'bun:test';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { FIXTURES, normalizeScanResult, removeDir, runCli, tempDir } from './helpers.js';

const NPM_PROJECT = join(FIXTURES, 'npm-project');
const NPM_PROJECT_CONFIG = join(FIXTURES, 'npm-project-config');

async function golden(name: string) {
  return JSON.parse(await readFile(join(FIXTURES, 'golden', name), 'utf-8'));
}

describe('cli — flags and errors (frozen behavior)', () => {
  test('--help exits 0 and prints usage', async () => {
    const { stdout, code } = await runCli(['--help']);
    expect(code).toBe(0);
    expect(stdout).toContain('Usage: lguard [path] [options]');
  });

  test('-h is the only short flag', async () => {
    const { stdout, code } = await runCli(['-h']);
    expect(code).toBe(0);
    expect(stdout).toContain('Usage: lguard [path] [options]');
  });

  test('unknown flag → exact stderr and exit 1', async () => {
    const { stderr, code } = await runCli(['--bogus']);
    expect(code).toBe(1);
    expect(stderr).toBe('Unknown flag: --bogus\n');
  });

  test('bare "--" is an unknown flag, not a separator', async () => {
    const { stderr, code } = await runCli(['--']);
    expect(code).toBe(1);
    expect(stderr).toBe('Unknown flag: --\n');
  });

  test('bare --fail-on yields the literal "true" in the error', async () => {
    const { stderr, code } = await runCli(['--fail-on']);
    expect(code).toBe(1);
    expect(stderr).toBe('Invalid --fail-on level: true. Must be one of: high, medium, unknown\n');
  });

  test('unrecognized short flag is treated as a positional path', async () => {
    const { stderr, code } = await runCli(['-x']);
    expect(code).toBe(1);
    expect(stderr).toBe(`Error: Path does not exist: ${resolve('-x')}\n`);
  });

  test('nonexistent path errors', async () => {
    const { stderr, code } = await runCli(['/definitely/not/a/real/path']);
    expect(code).toBe(1);
    expect(stderr).toBe('Error: Path does not exist: /definitely/not/a/real/path\n');
  });

  test('file (not directory) path errors', async () => {
    const target = join(FIXTURES, 'empty-project', 'README.txt');
    const { stderr, code } = await runCli([target]);
    expect(code).toBe(1);
    expect(stderr).toBe(`Error: Not a directory: ${target}\n`);
  });

  test('unknown forced ecosystem errors', async () => {
    const { stderr, code } = await runCli([NPM_PROJECT, '--ecosystem=bogus']);
    expect(code).toBe(1);
    expect(stderr).toBe(
      'Error: Unknown ecosystem: bogus. Supported: npm, cargo, python, ruby, go, swift\n',
    );
  });

  test('--json=false still enables JSON output (truthy string quirk)', async () => {
    const { stdout, code } = await runCli([NPM_PROJECT, '--json=false']);
    expect(code).toBe(0);
    expect(() => JSON.parse(stdout)).not.toThrow();
  });
});

describe('cli — scanning and exit codes', () => {
  test('--json output matches golden, exit 0 without config', async () => {
    const { stdout, code } = await runCli([NPM_PROJECT, '--json']);
    expect(code).toBe(0);
    expect(normalizeScanResult(JSON.parse(stdout))).toEqual(await golden('npm-project.json'));
  });

  test('with .lguardrc: --json matches golden, violations force exit 1', async () => {
    const { stdout, code } = await runCli([NPM_PROJECT_CONFIG, '--json']);
    expect(code).toBe(1);
    expect(normalizeScanResult(JSON.parse(stdout))).toEqual(
      await golden('npm-project-config.json'),
    );
  });

  test('--fail-on thresholds against a fixture containing high risk', async () => {
    expect((await runCli([NPM_PROJECT, '--fail-on=high'])).code).toBe(1);
    expect((await runCli([NPM_PROJECT, '--fail-on=medium'])).code).toBe(1);
    expect((await runCli([NPM_PROJECT, '--fail-on=unknown'])).code).toBe(1);
  });

  test('invalid --fail-on value errors', async () => {
    const { stderr, code } = await runCli([NPM_PROJECT, '--fail-on=critical']);
    expect(code).toBe(1);
    expect(stderr).toBe(
      'Invalid --fail-on level: critical. Must be one of: high, medium, unknown\n',
    );
  });

  test('--ignore removes packages from the scan', async () => {
    const { stdout, code } = await runCli([
      NPM_PROJECT,
      '--json',
      '--ignore=gpl-pkg,transitive-gpl',
    ]);
    expect(code).toBe(0);
    const result = JSON.parse(stdout);
    const names = result.dependencies.map((d: { name: string }) => d.name);
    expect(names).not.toContain('gpl-pkg');
    expect(names).not.toContain('transitive-gpl');
    expect(result.summary.high).toBe(0);
  });

  describe('clean project', () => {
    let dir: string;

    afterEach(async () => {
      await removeDir(dir);
    });

    test('permissive-only project passes every --fail-on level', async () => {
      dir = await tempDir();
      await writeFile(
        join(dir, 'package.json'),
        JSON.stringify({ name: 'clean', version: '1.0.0', dependencies: { 'mit-pkg': '^1.0.0' } }),
      );
      await mkdir(join(dir, 'node_modules', 'mit-pkg'), { recursive: true });
      await writeFile(
        join(dir, 'node_modules', 'mit-pkg', 'package.json'),
        JSON.stringify({ name: 'mit-pkg', version: '1.0.0', license: 'MIT' }),
      );
      expect((await runCli([dir, '--fail-on=high'])).code).toBe(0);
      expect((await runCli([dir, '--fail-on=medium'])).code).toBe(0);
      expect((await runCli([dir, '--fail-on=unknown'])).code).toBe(0);
    });
  });
});

describe('cli — --init', () => {
  let dir: string;

  afterEach(async () => {
    await removeDir(dir);
  });

  test('creates a default config, exit 0; second run errors', async () => {
    dir = await tempDir();
    const first = await runCli(['--init', dir]);
    expect(first.code).toBe(0);
    expect(first.stdout).toBe(`Created ${join(dir, '.lguardrc')}\n`);
    const written = JSON.parse(await readFile(join(dir, '.lguardrc'), 'utf-8'));
    expect(written.failOn).toBe('high');

    const second = await runCli(['--init', dir]);
    expect(second.code).toBe(1);
    expect(second.stderr).toBe('Error: .lguardrc already exists\n');
  });
});
