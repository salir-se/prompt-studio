import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { primeBaselineContentSource } from './catalog/baseline-content-source';
import { primeCanonicalPromptSource } from './catalog/canonical-prompt-source';
import { primeContentSource } from './catalog/prompt-content-source';
import './index.css';

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error('Root element #root not found');
}

// `createRoot` itself stays synchronous (and out of the async closure below) so its `Container`
// argument keeps the plain non-null narrowing from the guard above — only `.render()` waits.
const root = createRoot(rootElement);

/**
 * `primeContentSource()` is a no-op for the normal (bundled) build — see
 * `./catalog/prompt-content-source.ts`. For the container build (`./catalog/prompt-content-source.container.ts`,
 * swapped in by `vite.config.ts`'s alias) it fetches every prompt-text symbol through the bridge ONCE;
 * skipping this await would render every prompt root's text empty on first paint. Safe fallback: a
 * rejected prime (network/bridge failure) logs and renders the app anyway rather than hanging the
 * boot — `App` itself already degrades gracefully to `null` prompt text per root.
 *
 * `primeBaselineContentSource()` follows the same seam discipline (ADR-235): no-op bundled, a
 * single bridge fetch of `docs/prompts/generated/sales-mode-baselines.json` in the container.
 * Failure degrades to "reference configurations unavailable", never a blocked boot.
 * `primeCanonicalPromptSource()` likewise loads the generated prompt/profile projection used by
 * section verification in the container build; the normal build derives it from the registry.
 */
async function bootstrap(): Promise<void> {
  try {
    await primeContentSource();
    await primeBaselineContentSource();
    await primeCanonicalPromptSource();
  } catch (error) {
    console.warn('[main] content-source priming failed; rendering with whatever content is available', error);
  }
  root.render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}

void bootstrap();
