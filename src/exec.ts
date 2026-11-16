import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export interface RunOptions {
  cwd?: string;
  maxBuffer?: number;
  env?: NodeJS.ProcessEnv;
}

export function runCommand(
  cmd: string,
  args: string[],
  opts: RunOptions = {},
): Promise<{ stdout: string; stderr: string }> {
  return execFileAsync(cmd, args, opts);
}
