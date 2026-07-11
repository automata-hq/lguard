import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { FETCH_TIMEOUT_MS } from '../constants.js';
import type { Dep, Ecosystem } from '../types.js';

const GH_REPO_RE = /^[a-zA-Z0-9._-]+\/[a-zA-Z0-9._-]+$/;

interface Pin {
  identity?: string;
  package?: string;
  location?: string;
  repositoryURL?: string;
  state?: { version?: string; revision?: string };
}

interface PackageResolved {
  pins?: Pin[];
  object?: { pins?: Pin[] };
}

export const swift: Ecosystem = {
  name: 'swift',

  async detect(dir) {
    try {
      await readFile(join(dir, 'Package.swift'));
      return true;
    } catch {
      return false;
    }
  },

  async scan(dir) {
    let resolved: PackageResolved;
    try {
      resolved = JSON.parse(await readFile(join(dir, 'Package.resolved'), 'utf-8'));
    } catch {
      throw new Error('Package.resolved not found — run swift package resolve first');
    }

    const pins = resolved.pins || resolved.object?.pins || [];
    const deps: Dep[] = [];

    // All SwiftPM resolved deps are considered direct (flat resolution)
    const directDeps = new Set<string>();

    for (const pin of pins) {
      const name =
        pin.identity || pin.package || extractName(pin.location || pin.repositoryURL || '');
      const version = pin.state?.version || pin.state?.revision?.slice(0, 8) || 'unknown';
      const url = pin.location || pin.repositoryURL || '';

      let license: string | null = null;
      const ghMatch = url.match(/github\.com\/([^/]+\/[^/.]+)/);
      if (ghMatch?.[1] && GH_REPO_RE.test(ghMatch[1])) {
        license = await fetchGitHubLicense(ghMatch[1]);
      }

      deps.push({ name, version, license });
      directDeps.add(name);
    }

    return { deps, graph: {}, directDeps };
  },
};

function extractName(url: string): string {
  const match = url.match(/\/([^/]+?)(?:\.git)?$/);
  return match?.[1] ? match[1] : url;
}

async function fetchGitHubLicense(repo: string): Promise<string | null> {
  try {
    const headers: Record<string, string> = { Accept: 'application/vnd.github.v3+json' };
    if (process.env.GITHUB_TOKEN) headers.Authorization = `token ${process.env.GITHUB_TOKEN}`;

    const [owner = '', name = ''] = repo.split('/');
    const res = await fetch(
      `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/license`,
      {
        headers,
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      },
    );
    if (!res.ok) return null;
    const data = (await res.json()) as { license?: { spdx_id?: string | null } };
    return data.license?.spdx_id || null;
  } catch {
    return null;
  }
}
