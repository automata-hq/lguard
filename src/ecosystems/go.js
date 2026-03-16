import { readFile } from 'fs/promises';
import { join } from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';

const exec = promisify(execFile);

export const go = {
  name: 'go',

  async detect(dir) {
    try {
      await readFile(join(dir, 'go.mod'));
      return true;
    } catch {
      return false;
    }
  },

  async scan(dir) {
    let stdout;
    try {
      ({ stdout } = await exec('go', ['list', '-m', '-json', 'all'], {
        cwd: dir,
        maxBuffer: 50 * 1024 * 1024,
      }));
    } catch (err) {
      if (err.code === 'ENOENT') throw new Error('go not found — install Go toolchain');
      throw new Error(`go list failed: ${err.message}`);
    }

    const modules = parseGoListOutput(stdout);

    let modCache = '';
    try {
      ({ stdout: modCache } = await exec('go', ['env', 'GOMODCACHE'], { cwd: dir }));
      modCache = modCache.trim();
    } catch {}

    const deps = [];
    for (const mod of modules) {
      if (mod.Main) continue;
      const license = modCache ? await findLicense(modCache, mod.Path, mod.Version) : null;
      deps.push({ name: mod.Path, version: mod.Version || 'unknown', license });
    }

    return deps;
  },
};

function parseGoListOutput(stdout) {
  const modules = [];
  let depth = 0;
  let current = '';

  for (const char of stdout) {
    if (char === '{') depth++;
    if (depth > 0) current += char;
    if (char === '}') {
      depth--;
      if (depth === 0) {
        try {
          modules.push(JSON.parse(current));
        } catch {}
        current = '';
      }
    }
  }

  return modules;
}

async function findLicense(modCache, modPath, version) {
  if (!version) return null;
  const modDir = join(modCache, `${modPath}@${version}`);
  const names = ['LICENSE', 'LICENSE.md', 'LICENSE.txt', 'LICENCE', 'LICENCE.md', 'LICENCE.txt', 'COPYING', 'COPYING.md'];

  for (const name of names) {
    try {
      const content = await readFile(join(modDir, name), 'utf-8');
      return identifyLicense(content);
    } catch {}
  }

  return null;
}

function identifyLicense(content) {
  const t = content.toLowerCase();
  if (t.includes('gnu affero general public license')) return 'AGPL-3.0';
  if (t.includes('gnu general public license') && t.includes('version 3')) return 'GPL-3.0';
  if (t.includes('gnu general public license') && t.includes('version 2')) return 'GPL-2.0';
  if (t.includes('gnu lesser general public license') && t.includes('version 3')) return 'LGPL-3.0';
  if (t.includes('gnu lesser general public license') && t.includes('version 2')) return 'LGPL-2.1';
  if (t.includes('mozilla public license') && t.includes('2.0')) return 'MPL-2.0';
  if (t.includes('eclipse public license') && t.includes('2.0')) return 'EPL-2.0';
  if (t.includes('eclipse public license') && t.includes('1.0')) return 'EPL-1.0';
  if (t.includes('apache license') && t.includes('version 2.0')) return 'Apache-2.0';
  if (t.includes('mit license') || t.includes('permission is hereby granted, free of charge')) return 'MIT';
  if (t.includes('isc license')) return 'ISC';
  if (t.includes('redistribution and use in source and binary forms') && t.includes('3. neither the name')) return 'BSD-3-Clause';
  if (t.includes('redistribution and use in source and binary forms')) return 'BSD-2-Clause';
  if (t.includes('the unlicense') || t.includes('this is free and unencumbered software')) return 'Unlicense';
  if (t.includes('boost software license')) return 'BSL-1.0';
  if (t.includes('creative commons') && t.includes('cc0')) return 'CC0-1.0';
  if (t.includes('do what the fuck you want')) return 'WTFPL';
  return null;
}
