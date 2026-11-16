export type Limiter = <T>(task: () => Promise<T>) => Promise<T>;

export function limiter(max: number): Limiter {
  let active = 0;
  const waiting: Array<() => void> = [];

  return async (task) => {
    while (active >= max) {
      await new Promise<void>((resolve) => waiting.push(resolve));
    }
    active++;
    try {
      return await task();
    } finally {
      active--;
      waiting.shift()?.();
    }
  };
}

export function mapLimit<T, R>(
  items: readonly T[],
  max: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const run = limiter(max);
  return Promise.all(items.map((item) => run(() => fn(item))));
}
