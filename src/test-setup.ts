// Turnkey vitest setup: silence-on-pass/dump-on-fail console capture + the fleet-wide network
// guard (@prompt-studio/observability/test/setup) plus @testing-library/jest-dom's DOM matchers. Wired as a
// LOCAL file (rather than listing both bare package specifiers directly in `setupFiles`) so Vite's
// dep optimizer treats these as ordinary transitive imports instead of top-level setupFiles entries
// — see `docs/architecture/testing-strategy.md`'s "Rules of thumb" for the shared-setup convention.
import '@prompt-studio/observability/test/setup';
import '@testing-library/jest-dom';
