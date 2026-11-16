import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { FETCH_CONCURRENCY, FETCH_TIMEOUT_MS } from '../constants.js';
import { mapLimit } from '../limit.js';
import type { Dep, Ecosystem } from '../types.js';

interface GemEntry {
  name: string;
  version: string;
}

export const ruby: Ecosystem = {
  name: 'ruby',

  async detect(dir) {
    try {
      await readFile(join(dir, 'Gemfile.lock'));
      return true;
    } catch {
      return false;
    }
  },

  async scan(dir, context) {
    const content = await readFile(join(dir, 'Gemfile.lock'), 'utf-8');
    const { gems, graph } = parseGemfileLock(content);

    if (gems.length === 0) throw new Error('No gems found in Gemfile.lock');

    // Parse Gemfile for direct deps
    const directDeps = await parseGemfile(dir);

    if (context?.offline) {
      return {
        deps: gems.map(({ name, version }) => ({ name, version, license: null })),
        graph,
        directDeps,
      };
    }

    const deps = await mapLimit(
      gems,
      FETCH_CONCURRENCY,
      async ({ name, version }): Promise<Dep> => {
        try {
          const encodedName = encodeURIComponent(name);
          const encodedVersion = encodeURIComponent(version);
          const res = await fetch(
            `https://rubygems.org/api/v2/rubygems/${encodedName}/versions/${encodedVersion}.json`,
            { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) },
          );
          if (!res.ok) return { name, version, license: null };
          const data = (await res.json()) as { licenses?: string[] | null };
          const licenses = data.licenses || [];
          return { name, version, license: licenses.length > 0 ? licenses.join(' OR ') : null };
        } catch {
          return { name, version, license: null };
        }
      },
    );

    return { deps, graph, directDeps };
  },
};

async function parseGemfile(dir: string): Promise<Set<string>> {
  const directDeps = new Set<string>();
  try {
    const content = await readFile(join(dir, 'Gemfile'), 'utf-8');
    for (const line of content.split('\n')) {
      const match = line.match(/^\s*gem\s+['"]([^'"]+)['"]/);
      if (match?.[1]) directDeps.add(match[1]);
    }
  } catch {}
  return directDeps;
}

function parseGemfileLock(content: string): {
  gems: GemEntry[];
  graph: Record<string, string[]>;
} {
  const gems: GemEntry[] = [];
  const graph: Record<string, string[]> = {};
  let inSpecs = false;
  let currentGem: string | null = null;

  for (const line of content.split('\n')) {
    if (line.trim() === 'specs:') {
      inSpecs = true;
      continue;
    }

    if (inSpecs) {
      // 4-space indent = gem entry
      const gemMatch = line.match(/^ {4}(\S+)\s+\(([^)]+)\)/);
      if (gemMatch?.[1] && gemMatch[2]) {
        currentGem = gemMatch[1];
        gems.push({ name: gemMatch[1], version: gemMatch[2] });
        graph[currentGem] = [];
      } else {
        // 6-space indent = dependency of current gem
        const depMatch = line.match(/^ {6}(\S+)/);
        if (depMatch?.[1] && currentGem) {
          graph[currentGem]?.push(depMatch[1]);
        } else if (line.trim() === '' || !line.startsWith(' ')) {
          inSpecs = false;
          currentGem = null;
        }
      }
    }
  }

  return { gems, graph };
}
