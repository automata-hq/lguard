// Registered via bunfig.toml [test].preload, BEFORE any module under test loads.
// src/exec.ts captures promisify(execFile) at module load, so the mock must be
// in place first. When no handler is set, calls delegate to the real execFile —
// tests that never touch exec are unaffected.
import { mock } from 'bun:test';
import * as actualChildProcess from 'node:child_process';
import { promisify } from 'node:util';

export interface ExecResult {
  stdout: string;
  stderr: string;
}

export type ExecHandler = (cmd: string, args: string[], opts: unknown) => Promise<ExecResult>;

export const execMock: { handler: ExecHandler | null } = { handler: null };

const realExecFile = promisify(actualChildProcess.execFile);

const fakeExecFile = (...args: unknown[]) =>
  (actualChildProcess.execFile as (...a: unknown[]) => unknown)(...args);

(fakeExecFile as unknown as Record<symbol, unknown>)[promisify.custom] = (
  cmd: string,
  cmdArgs: string[],
  opts: unknown,
) => {
  if (execMock.handler) return execMock.handler(cmd, cmdArgs, opts);
  return realExecFile(cmd, cmdArgs, opts as never);
};

mock.module('node:child_process', () => ({
  ...actualChildProcess,
  execFile: fakeExecFile,
}));
