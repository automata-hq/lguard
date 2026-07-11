import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Runs the TS source directly under bun. The '--' separator stops bun's own
// CLI from consuming flags (a bare '--' would otherwise never reach the
// script); node needs no separator. The built dist/cli.js is exercised under
// plain node in CI's smoke jobs.
export const CLI_CMD = ['bun', 'src/cli.ts', '--'];

export interface CliResult {
  stdout: string;
  stderr: string;
  code: number;
}

export function runCli(args: string[], opts: { cwd?: string } = {}): Promise<CliResult> {
  const [cmd = 'node', ...pre] = CLI_CMD;
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, [...pre, ...args], {
      cwd: opts.cwd ?? process.cwd(),
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.on('error', reject);
    child.on('close', (code) => resolve({ stdout, stderr, code: code ?? -1 }));
  });
}

export interface NormalizedScan {
  [key: string]: unknown;
  path: string;
  dependencies: Array<{ name: string; [key: string]: unknown }>;
}

// Golden comparison rules (see tests/fixtures/golden/README.md): path is
// machine-dependent and readdir order is filesystem-dependent.
export function normalizeScanResult(result: unknown): NormalizedScan {
  const clone = JSON.parse(JSON.stringify(result)) as NormalizedScan;
  clone.path = '<PATH>';
  clone.dependencies = [...clone.dependencies].sort((a, b) => a.name.localeCompare(b.name));
  return clone;
}

export function normalizeVersion(text: string): string {
  return text.replace(/v\d+\.\d+\.\d+/g, 'vX');
}

export function stubFetch(
  handler: (url: string, init?: RequestInit) => Response | Promise<Response>,
): () => void {
  const original = globalThis.fetch;
  globalThis.fetch = ((input: string | URL | Request, init?: RequestInit) =>
    Promise.resolve(handler(String(input), init))) as typeof fetch;
  return () => {
    globalThis.fetch = original;
  };
}

export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

export async function tempDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'lguard-test-'));
}

export async function removeDir(dir: string): Promise<void> {
  await rm(dir, { recursive: true, force: true });
}

export const FIXTURES = join(process.cwd(), 'tests', 'fixtures');
