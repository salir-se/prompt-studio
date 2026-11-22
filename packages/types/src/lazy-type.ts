/**
 * A schema that is built on first use instead of at module load.
 *
 * Every top-level arktype `type()` call runs when its module is imported, and a Worker pays all of them at startup,
 * before any request: on 2026-10-28 the scheduler Worker spent about half of its 917 ms startup building schemas
 * that the wake-up at hand never touched (Worker startup budget, `scripts/ci/worker-startup-budget.ts`).
 * `lazyType(() => type({...}))` returns a stand-in with the same shape: it is callable, every property and method
 * reaches the real Type, it can be embedded in another definition and composed with `.or()` / `.array()`, and
 * `typeof schema.infer` is unchanged. The Type is built once, on the first access, and cached.
 */

/** Build `build()` once, on first use, behind a stand-in with the same callable shape. */
export function lazyType<T extends object>(build: () => T): T {
  let built: T | undefined;
  const bound = new Map<PropertyKey, unknown>();
  const resolve = (): T => {
    if (built === undefined) built = build();
    return built;
  };
  // A function target keeps `typeof` and `apply` working for arktype's callable Type.
  const target = function lazySchema() {} as unknown as T;
  return new Proxy(target, {
    apply: (_target, thisArg, args) =>
      Reflect.apply(resolve() as unknown as (...a: unknown[]) => unknown, thisArg, args),
    get: (_target, key) => {
      const real = resolve();
      const value = Reflect.get(real, key, real);
      // Only a plain method is bound. A nested Type (`.in`, `.out`, a prop) is callable too, but it carries its own
      // properties and no `bind`; it is handed out as is.
      if (typeof value !== 'function' || typeof (value as { bind?: unknown }).bind !== 'function') return value;
      // Methods see the real Type as `this`; one bound function per method, so hot validation paths allocate nothing.
      let fn = bound.get(key);
      if (fn === undefined) {
        fn = (value as (...a: unknown[]) => unknown).bind(real);
        bound.set(key, fn);
      }
      return fn;
    },
    set: (_target, key, value) => Reflect.set(resolve(), key, value),
    has: (_target, key) => Reflect.has(resolve(), key),
    getPrototypeOf: () => Object.getPrototypeOf(resolve()),
    ownKeys: () => Reflect.ownKeys(resolve()),
    getOwnPropertyDescriptor: (_target, key) => {
      const descriptor = Reflect.getOwnPropertyDescriptor(resolve(), key);
      // A proxy may only report a non-configurable property that its target really has; the target has none.
      return descriptor ? { ...descriptor, configurable: true } : undefined;
    },
  });
}
