import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Config } from './types.js';

const CONFIG_FILE = '.lguardrc';

const DEFAULT_CONFIG: Config = {
  deny: [
    'AGPL-3.0',
    'AGPL-3.0-only',
    'AGPL-3.0-or-later',
    'GPL-2.0',
    'GPL-2.0-only',
    'GPL-2.0-or-later',
    'GPL-3.0',
    'GPL-3.0-only',
    'GPL-3.0-or-later',
    'SSPL-1.0',
  ],
  ignore: [],
  failOn: 'high',
  overrides: {},
};

export async function loadConfig(dir: string): Promise<Config | null> {
  try {
    const raw = await readFile(join(dir, CONFIG_FILE), 'utf-8');
    const config = JSON.parse(raw) as Config;
    validate(config);
    return config;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw new Error(`.lguardrc: ${(err as Error).message}`);
  }
}

export async function initConfig(dir: string): Promise<string> {
  const path = join(dir, CONFIG_FILE);
  try {
    await readFile(path);
    throw new Error('.lguardrc already exists');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
  }
  await writeFile(path, `${JSON.stringify(DEFAULT_CONFIG, null, 2)}\n`);
  return path;
}

function validate(config: Config): void {
  if (config.allow && config.deny) {
    throw new Error('Cannot set both "allow" and "deny" — use one or the other');
  }
  if (config.allow && !Array.isArray(config.allow)) {
    throw new Error('"allow" must be an array of license identifiers');
  }
  if (config.deny && !Array.isArray(config.deny)) {
    throw new Error('"deny" must be an array of license identifiers');
  }
  if (config.ignore && !Array.isArray(config.ignore)) {
    throw new Error('"ignore" must be an array of package names');
  }
  if (config.failOn && !['high', 'medium', 'unknown'].includes(config.failOn)) {
    throw new Error('"failOn" must be one of: high, medium, unknown');
  }
  if (config.overrides != null) {
    if (typeof config.overrides !== 'object' || Array.isArray(config.overrides)) {
      throw new Error('"overrides" must be an object mapping package names to reason strings');
    }
    for (const [key, val] of Object.entries(config.overrides)) {
      if (typeof val !== 'string') {
        throw new Error(`"overrides.${key}" must be a string reason`);
      }
    }
  }
}
