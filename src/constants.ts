export const FETCH_TIMEOUT_MS = 10_000;
export const FETCH_CONCURRENCY = 10;
export const FS_CONCURRENCY = 64;
export const EXEC_MAX_BUFFER = 50 * 1024 * 1024;

export const UNKNOWN_VERSION = 'unknown';

export const CARGO_OFFLINE_FLAG = '--offline';

export const GO_OFFLINE_ENV: Readonly<Record<string, string>> = {
  GOPROXY: 'off',
  GOSUMDB: 'off',
};
