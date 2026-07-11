// Minimal ambient declaration for the bun:test surface this suite uses.
// @types/bun is deliberately NOT installed: its global type definitions
// conflict with @types/node, which types the production code.
declare module 'bun:test' {
  export interface Matchers {
    toBe(expected: unknown): void;
    toEqual(expected: unknown): void;
    toBeNull(): void;
    toContain(expected: unknown): void;
    toHaveLength(expected: number): void;
    toThrow(expected?: string | RegExp): void;
    toEndWith(expected: string): void;
    toHaveBeenCalledWith(...args: unknown[]): void;
    readonly not: Matchers;
  }

  export interface ExpectResult extends Matchers {
    readonly rejects: Matchers;
  }

  export function expect(value: unknown): ExpectResult;

  export function describe(label: string, fn: () => void): void;
  export function test(label: string, fn: () => void | Promise<void>): void;
  export function beforeEach(fn: () => void | Promise<void>): void;
  export function afterEach(fn: () => void | Promise<void>): void;

  export interface SpyInstance {
    mockImplementation(fn: (...args: never[]) => unknown): SpyInstance;
    mockRestore(): void;
  }

  export function spyOn<T extends object, K extends keyof T>(target: T, property: K): SpyInstance;

  export const mock: {
    module(specifier: string, factory: () => unknown): void;
  };
}
