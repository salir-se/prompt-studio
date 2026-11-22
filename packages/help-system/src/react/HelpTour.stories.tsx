// Plain CSF3 — no `@storybook/react-vite` import so the package's typecheck stays
// dependency-free (Storybook types are wired by the host app, not this package).
import { HelpTour } from './HelpTour';

const meta = { title: 'Help/HelpTour', component: HelpTour };
export default meta;

export const Default = {
  args: {
    run: true,
    steps: [{ targetHelpId: 'scout.run-button', title: 'Run Scout', body: 'Click here to start a search.' }],
  },
};

/**
 * The tour spotlight over a REAL on-page control. The decorator renders a mock app
 * toolbar (one button carries `data-help-id="scout.run-button"`) so joyride dims the
 * surroundings and rings the target instead of falling back to a centered tooltip.
 *
 * Flip Storybook's Theme toolbar to **Dark** to verify the dark-mode contrast fix:
 * the bright inset ring + glow keeps the highlighted control clearly visible, where
 * the old default-styled spotlight washed out against a dark surface.
 */
export const OnPageTarget = {
  args: {
    run: true,
    // `waitForTargetMs` lets the tour re-resolve after the decorator's target commits
    // (the tour reads the DOM on first render, before the toolbar below is mounted).
    steps: [
      {
        targetHelpId: 'scout.run-button',
        title: 'Run Scout',
        body: 'Click here to start a search.',
        waitForTargetMs: 300,
      },
    ],
  },
  decorators: [
    (Story: () => React.ReactElement) => (
      <div style={{ minHeight: 360, padding: 24 }}>
        <div
          style={{
            display: 'flex',
            gap: 12,
            alignItems: 'center',
            padding: 16,
            borderRadius: 12,
            border: '1px solid var(--border, #e4e4e7)',
            background: 'var(--card, transparent)',
          }}
        >
          <strong style={{ marginRight: 'auto' }}>Scout</strong>
          <button type="button" data-help-id="scout.filters" className="px-3 py-2 rounded-md border">
            Filters
          </button>
          <button
            type="button"
            data-help-id="scout.run-button"
            className="px-3 py-2 rounded-md"
            style={{ background: 'var(--primary, #2563eb)', color: 'var(--primary-foreground, #fff)' }}
          >
            Run Scout
          </button>
        </div>
        <Story />
      </div>
    ),
  ],
};
