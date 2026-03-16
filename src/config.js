import { readFile, writeFile } from 'fs/promises';
import { join } from 'path';

const CONFIG_FILE = '.lguardrc';

const DEFAULT_CONFIG = {
  deny: [
    'AGPL-3.0', 'AGPL-3.0-only', 'AGPL-3.0-or-later',
    'GPL-2.0', 'GPL-2.0-only', 'GPL-2.0-or-later',
    'GPL-3.0', 'GPL-3.0-only', 'GPL-3.0-or-later',
    'SSPL-1.0',
  ],
  ignore: [],
  failOn: 'high',
  overrides: {},
};

export async function loadConfig(dir) {
  try {
    const raw = await readFile(join(dir, CONFIG_FILE), 'utf-8');
    const config = JSON.parse(raw);
    validate(config);
    return config;
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    throw new Error(`.lguardrc: ${err.message}`);
  }
}

export async function initConfig(dir) {
  const path = join(dir, CONFIG_FILE);
  try {
    await readFile(path);
    throw new Error('.lguardrc already exists');
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }
  await writeFile(path, JSON.stringify(DEFAULT_CONFIG, null, 2) + '\n');
  return path;
}

function validate(config) {
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
  if (config.overrides && typeof config.overrides !== 'object') {
    throw new Error('"overrides" must be an object mapping package names to reason strings');
  }
}
