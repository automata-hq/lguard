import { ecosystems } from './ecosystems/index.js';
import { classifyExpression, isExpressionAllowed, isExpressionDenied } from './licenses.js';
import type { Config, Ecosystem, ScannedDependency, ScanResult, Summary } from './types.js';

export interface ScanOptions {
  ecosystem?: string;
  ignore?: string[];
  config?: Config | null;
}

export async function scanProject(
  targetPath: string,
  options: ScanOptions = {},
): Promise<ScanResult> {
  const detected: Ecosystem[] = [];

  if (options.ecosystem) {
    const eco = ecosystems.find((e) => e.name === options.ecosystem);
    if (!eco)
      throw new Error(
        `Unknown ecosystem: ${options.ecosystem}. Supported: ${ecosystems.map((e) => e.name).join(', ')}`,
      );
    detected.push(eco);
  } else {
    for (const eco of ecosystems) {
      if (await eco.detect(targetPath)) detected.push(eco);
    }
  }

  if (detected.length === 0) {
    throw new Error(
      `No supported package ecosystem detected. Supported: ${ecosystems.map((e) => e.name).join(', ')}`,
    );
  }

  const allDeps: ScannedDependency[] = [];
  const ignoreSet = new Set([...(options.ignore || []), ...(options.config?.ignore || [])]);
  const config = options.config;
  const overrides = config?.overrides || {};
  const errors: string[] = [];

  for (const eco of detected) {
    try {
      const result = await eco.scan(targetPath);
      const { deps, graph = {}, directDeps = new Set<string>() } = result;

      for (const dep of deps) {
        if (ignoreSet.has(dep.name)) continue;

        const { risk } = classifyExpression(dep.license);
        const isDirect = directDeps.has(dep.name);
        const isOverridden = dep.name in overrides;

        // Policy violation check
        let violation = false;
        let violationReason: string | null = null;
        if (config && !isOverridden) {
          if (config.deny && config.deny.length > 0) {
            if (isExpressionDenied(dep.license, config.deny)) {
              violation = true;
              violationReason = 'denied by policy';
            }
          } else if (config.allow && config.allow.length > 0) {
            if (!dep.license) {
              violation = true;
              violationReason = 'no license specified';
            } else if (!isExpressionAllowed(dep.license, config.allow)) {
              violation = true;
              violationReason = 'not in allow list';
            }
          }
        }

        // Compute chain for transitive deps
        let chain: string[] | null = null;
        if (!isDirect && Object.keys(graph).length > 0) {
          chain = findChain(graph, directDeps, dep.name);
        }

        allDeps.push({
          ...dep,
          risk,
          ecosystem: eco.name,
          direct: isDirect,
          chain,
          violation,
          violationReason,
          overrideReason: isOverridden ? (overrides[dep.name] ?? null) : null,
        });
      }
    } catch (err) {
      if (options.ecosystem) throw err;
      errors.push(`Warning: ${eco.name} scan failed — ${(err as Error).message}`);
    }
  }

  for (const e of errors) console.error(e);

  const summary: Summary = {
    total: allDeps.length,
    high: 0,
    medium: 0,
    low: 0,
    unknown: 0,
    violations: 0,
    overrides: 0,
  };
  for (const dep of allDeps) {
    summary[dep.risk]++;
    if (dep.violation) summary.violations++;
    if (dep.overrideReason) summary.overrides++;
  }

  return {
    path: targetPath,
    ecosystems: detected.map((e) => e.name),
    dependencies: allDeps,
    summary,
    hasConfig: !!config,
  };
}

export function findChain(
  graph: Record<string, string[]>,
  directDeps: Set<string>,
  target: string,
): string[] | null {
  if (directDeps.size === 0) return null;

  const queue = [...directDeps].map((d) => [d]);
  const visited = new Set<string>();

  while (queue.length) {
    const path = queue.shift();
    if (!path) break;
    const current = path[path.length - 1];
    if (current === undefined) continue;
    if (current === target) return path;
    if (visited.has(current)) continue;
    visited.add(current);

    for (const child of graph[current] || []) {
      if (!visited.has(child)) {
        queue.push([...path, child]);
      }
    }
  }

  return null;
}
