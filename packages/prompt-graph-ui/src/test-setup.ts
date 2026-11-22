// Turnkey shared harness: silent-on-pass console capture (dumped to stderr on fail), the
// mandatory network guard (throws on any un-stubbed fetch), and a logger reset per test — see
// `docs/architecture/testing-strategy.md`'s Tooling Matrix ("Rules of thumb").
import '@prompt-studio/observability/test/setup';
import '@testing-library/jest-dom';
