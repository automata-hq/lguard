import { readdir, readFile } from 'fs/promises';
import { join } from 'path';

export const npm = {
  name: 'npm',

  async detect(dir) {
    try {
      await readFile(join(dir, 'package.json'));
      return true;
    } catch {
      return false;
    }
  },

  async scan(dir) {
    const nodeModules = join(dir, 'node_modules');
    const deps = [];

    let entries;
    try {
      entries = await readdir(nodeModules);
    } catch (err) {
      if (err.code === 'ENOENT') throw new Error('node_modules not found — run npm/bun/pnpm install first');
      throw err;
    }

    for (const entry of entries) {
      if (entry.startsWith('.')) continue;

      if (entry.startsWith('@')) {
        const scopedEntries = await readdir(join(nodeModules, entry)).catch(() => []);
        for (const scopedEntry of scopedEntries) {
          const pkg = await readPkg(join(nodeModules, entry, scopedEntry, 'package.json'));
          if (pkg) deps.push(pkg);
        }
      } else {
        const pkg = await readPkg(join(nodeModules, entry, 'package.json'));
        if (pkg) deps.push(pkg);
      }
    }

    return deps;
  },
};

async function readPkg(path) {
  try {
    const raw = await readFile(path, 'utf-8');
    const pkg = JSON.parse(raw);

    let license = pkg.license;

    // Handle { type: "MIT", url: "..." } format
    if (license && typeof license === 'object') license = license.type;

    // Handle legacy "licenses" array
    if (!license && Array.isArray(pkg.licenses)) {
      license = pkg.licenses.map(l => (typeof l === 'object' ? l.type : l)).join(' OR ');
    }

    return { name: pkg.name, version: pkg.version || 'unknown', license: license || null };
  } catch {
    return null;
  }
}
