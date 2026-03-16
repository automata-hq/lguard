import { readFile } from 'fs/promises';
import { join } from 'path';

const FETCH_TIMEOUT = 10_000;
const GH_REPO_RE = /^[a-zA-Z0-9._-]+\/[a-zA-Z0-9._-]+$/;

export const swift = {
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
    let resolved;
    try {
      resolved = JSON.parse(await readFile(join(dir, 'Package.resolved'), 'utf-8'));
    } catch {
      throw new Error('Package.resolved not found — run swift package resolve first');
    }

    const pins = resolved.pins || resolved.object?.pins || [];
    const deps = [];

    for (const pin of pins) {
      const name = pin.identity || pin.package || extractName(pin.location || pin.repositoryURL || '');
      const version = pin.state?.version || pin.state?.revision?.slice(0, 8) || 'unknown';
      const url = pin.location || pin.repositoryURL || '';

      let license = null;
      const ghMatch = url.match(/github\.com\/([^/]+\/[^/.]+)/);
      if (ghMatch && GH_REPO_RE.test(ghMatch[1])) {
        license = await fetchGitHubLicense(ghMatch[1]);
      }

      deps.push({ name, version, license });
    }

    return deps;
  },
};

function extractName(url) {
  const match = url.match(/\/([^/]+?)(?:\.git)?$/);
  return match ? match[1] : url;
}

async function fetchGitHubLicense(repo) {
  try {
    const headers = { Accept: 'application/vnd.github.v3+json' };
    if (process.env.GITHUB_TOKEN) headers.Authorization = `token ${process.env.GITHUB_TOKEN}`;

    const res = await fetch(`https://api.github.com/repos/${encodeURIComponent(repo.split('/')[0])}/${encodeURIComponent(repo.split('/')[1])}/license`, {
      headers,
      signal: AbortSignal.timeout(FETCH_TIMEOUT),
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data.license?.spdx_id || null;
  } catch {
    return null;
  }
}
