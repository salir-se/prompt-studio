// @testing-library/jest-dom 6.10 still augments Vitest's pre-v5 one-parameter Assertion type.
// Keep the runtime setup import and bridge its matcher types until jest-dom supports Vitest 5.
import type { TestingLibraryMatchers } from '@testing-library/jest-dom/matchers';

declare module 'vitest' {
  interface Assertion<R extends void | Promise<void> = void, T = unknown> extends TestingLibraryMatchers<R, T> {}
}
