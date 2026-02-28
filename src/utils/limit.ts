// src/utils/limit.ts
/**
 * Simple async concurrency limiter (similar to p‑limit).
 * Usage:
 *   const limited = limit(8);
 *   await limited(() => doSomeFetch());
 */
type Fn<T> = () => Promise<T>;

export function limit<T>(max: number) {
  if (max < 1) throw new Error("Concurrency limit must be >= 1");
  const queue: (() => void)[] = [];
  let active = 0;

  const next = () => {
    if (active >= max || queue.length === 0) return;
    active++;
    const run = queue.shift()!;
    run();
  };

  return async (fn: Fn<T>): Promise<T> => {
    return new Promise<T>((resolve, reject) => {
      const task = async () => {
        try {
          const result = await fn();
          resolve(result);
        } catch (e) {
          reject(e);
        } finally {
          active--;
          next();
        }
      };
      queue.push(task);
      next();
    });
  };
}
