export type RiskLevel = 'high' | 'medium' | 'low' | 'unknown';
export type FailLevel = 'high' | 'medium' | 'unknown';

export interface Dep {
  name: string;
  version: string;
  license: string | null;
}

export interface EcosystemScanResult {
  deps: Dep[];
  graph?: Record<string, string[]>;
  directDeps?: Set<string>;
}

export interface Ecosystem {
  name: string;
  detect(dir: string): Promise<boolean>;
  scan(dir: string): Promise<EcosystemScanResult>;
}

export interface Config {
  deny?: string[];
  allow?: string[];
  ignore?: string[];
  failOn?: FailLevel;
  overrides?: Record<string, string>;
}

// ---------------------------------------------------------------------------
// Public --json schema. These field names are serialized verbatim and consumed
// by downstream tooling — do NOT rename them.
// ---------------------------------------------------------------------------

export interface ScannedDependency extends Dep {
  risk: RiskLevel;
  ecosystem: string;
  direct: boolean;
  chain: string[] | null;
  violation: boolean;
  violationReason: string | null;
  overrideReason: string | null;
}

export interface Summary {
  total: number;
  high: number;
  medium: number;
  low: number;
  unknown: number;
  violations: number;
  overrides: number;
}

export interface ScanResult {
  path: string;
  ecosystems: string[];
  dependencies: ScannedDependency[];
  summary: Summary;
  hasConfig: boolean;
}
