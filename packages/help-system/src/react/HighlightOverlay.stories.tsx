// Plain CSF3 — no `@storybook/react-vite` import so the package's typecheck stays
// dependency-free (Storybook types are wired by the host app, not this package).
//
// HighlightOverlay stories — the AI spotlight with its anchored step-box caption.
// The callout must sit AT the highlighted element (below, flipping above near the
// viewport bottom) like a Joyride tooltip; the corner fallback only appears when
// the target is missing.
import { HighlightOverlay, type HighlightOverlayProps } from './HighlightOverlay';

function PageScaffold({ targetAtBottom = false }: { targetAtBottom?: boolean }) {
  return (
    <div style={{ minHeight: '100vh', padding: 24, display: 'flex', flexDirection: 'column' }}>
      <nav style={{ display: 'flex', gap: 12, justifyContent: 'center' }}>
        <button type="button">Dashboard</button>
        <button type="button">Scout</button>
        <button type="button" data-help-id={targetAtBottom ? undefined : 'nav.Settings'}>
          Settings
        </button>
      </nav>
      <p style={{ marginTop: 24, maxWidth: 480 }}>
        Page content that gets dimmed while the assistant spotlights a control and explains what to do with it.
      </p>
      {targetAtBottom && (
        <button type="button" data-help-id="nav.Settings" style={{ marginTop: 'auto', alignSelf: 'flex-start' }}>
          Save changes
        </button>
      )}
    </div>
  );
}

const meta = {
  component: HighlightOverlay,
  title: 'Help/HighlightOverlay',
  parameters: { layout: 'fullscreen' },
  args: {
    helpIds: ['nav.Settings'],
    label: 'Settings tab — open it to manage LLM provider API keys.',
    onClear: () => {},
  },
};
export default meta;

// Default: callout anchored BELOW the highlighted nav tab, arrow pointing up at it.
export const AnchoredBelowTarget = {
  render: (args: HighlightOverlayProps) => (
    <>
      <PageScaffold />
      <HighlightOverlay {...args} />
    </>
  ),
};

// Target near the viewport bottom: the callout flips ABOVE the spotlight.
export const FlipsAboveNearBottom = {
  render: (args: HighlightOverlayProps) => (
    <>
      <PageScaffold targetAtBottom />
      <HighlightOverlay {...args} />
    </>
  ),
};

// Missing target: no spotlight hole; the caption falls back to the corner.
export const CornerFallbackWhenTargetMissing = {
  args: { helpIds: ['nav.DoesNotExist'], label: 'That control is not on this page — navigate to Settings first.' },
  render: (args: HighlightOverlayProps) => (
    <>
      <PageScaffold />
      <HighlightOverlay {...args} />
    </>
  ),
};

// Warn emphasis + mobile viewport: box clamps inside 375 px without clipping.
export const MobileWarn = {
  args: { intent: 'warn' as const },
  parameters: { viewport: { defaultViewport: 'iphoneSE' } },
  render: (args: HighlightOverlayProps) => (
    <>
      <PageScaffold />
      <HighlightOverlay {...args} />
    </>
  ),
};
