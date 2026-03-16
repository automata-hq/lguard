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
    const gems = parseGemfileLock(content);

    if (gems.length === 0) throw new Error('No gems found in Gemfile.lock');

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

    return results;
  },
};

function parseGemfileLock(content) {
  const gems = [];
  let inSpecs = false;

  for (const line of content.split('\n')) {
    if (line.trim() === 'specs:') {
      inSpecs = true;
      continue;
    }

    if (inSpecs) {
      const match = line.match(/^ {4}(\S+)\s+\(([^)]+)\)/);
      if (match) {
        gems.push({ name: match[1], version: match[2] });
      } else if (line.trim() === '' || !line.startsWith(' ')) {
        inSpecs = false;
      }
    }
  }

  return gems;
}
