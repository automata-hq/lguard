import { readFile } from 'fs/promises';
import { join } from 'path';

const FETCH_TIMEOUT = 10_000;

export const ruby = {
  name: 'ruby',

  async detect(dir) {
    try {
      await readFile(join(dir, 'Gemfile.lock'));
      return true;
    } catch {
      return false;
    }
  },

  async scan(dir) {
    const content = await readFile(join(dir, 'Gemfile.lock'), 'utf-8');
    const { gems, graph } = parseGemfileLock(content);

    if (gems.length === 0) throw new Error('No gems found in Gemfile.lock');

    // Parse Gemfile for direct deps
    const directDeps = await parseGemfile(dir);

    const results = [];
    const BATCH = 10;

    for (let i = 0; i < gems.length; i += BATCH) {
      const batch = gems.slice(i, i + BATCH);
      const promises = batch.map(async ({ name, version }) => {
        try {
          const encodedName = encodeURIComponent(name);
          const encodedVersion = encodeURIComponent(version);
          const res = await fetch(
            `https://rubygems.org/api/v2/rubygems/${encodedName}/versions/${encodedVersion}.json`,
            { signal: AbortSignal.timeout(FETCH_TIMEOUT) },
          );
          if (!res.ok) return { name, version, license: null };
          const data = await res.json();
          const licenses = data.licenses || [];
          return { name, version, license: licenses.length > 0 ? licenses.join(' OR ') : null };
        } catch {
          return { name, version, license: null };
        }
      });
      results.push(...(await Promise.all(promises)));
    }

    return { deps: results, graph, directDeps };
  },
};

async function parseGemfile(dir) {
  const directDeps = new Set();
  try {
    const content = await readFile(join(dir, 'Gemfile'), 'utf-8');
    for (const line of content.split('\n')) {
      const match = line.match(/^\s*gem\s+['"]([^'"]+)['"]/);
      if (match) directDeps.add(match[1]);
    }
  } catch {}
  return directDeps;
}

function parseGemfileLock(content) {
  const gems = [];
  const graph = {};
  let inSpecs = false;
  let currentGem = null;

  for (const line of content.split('\n')) {
    if (line.trim() === 'specs:') {
      inSpecs = true;
      continue;
    }

    if (inSpecs) {
      // 4-space indent = gem entry
      const gemMatch = line.match(/^ {4}(\S+)\s+\(([^)]+)\)/);
      if (gemMatch) {
        currentGem = gemMatch[1];
        gems.push({ name: gemMatch[1], version: gemMatch[2] });
        graph[currentGem] = [];
      } else {
        // 6-space indent = dependency of current gem
        const depMatch = line.match(/^ {6}(\S+)/);
        if (depMatch && currentGem) {
          graph[currentGem].push(depMatch[1]);
        } else if (line.trim() === '' || !line.startsWith(' ')) {
          inSpecs = false;
          currentGem = null;
        }
      }
    }
  }

  return { gems, graph };
}
