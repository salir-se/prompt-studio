// @module-tag dom
import { act } from 'react';
import { expect, it, vi } from 'vitest';
import { appTests } from './App.test-harness';
import { type AppCommandSurface, buildAppCommands } from './control/app-commands';
import { RELEASE_NOTES_ID, SUPPORT_TRIAGE_ID } from './test-fixtures/starter-catalog';

const channel = vi.hoisted(() => ({ surface: null as AppCommandSurface | null }));
vi.mock('./control/use-app-control-channel', () => ({
  useAppControlChannel: (surface: AppCommandSurface) => {
    channel.surface = surface;
  },
}));

appTests((harness) => {
  it.each(['editDocument', 'resetDocument', 'openDocument', 'createConfiguration', 'switchConfiguration'] as const)(
    '%s reports cancellation and preserves unapplied writing when the user declines discard',
    async (command) => {
      // Given: Support Triage open in the writer with unapplied writing
      await harness.renderBootedApp();
      harness.click(harness.byTestId(harness.starterRootTestId));
      harness.click(harness.findButtonByAccessibleName(document.body, 'Write'));
      const textarea = document.querySelector<HTMLTextAreaElement>('textarea[aria-label="Prompt markdown"]')!;
      const draft = `${textarea.value}\nKeep this unapplied writing.`;
      harness.setTextareaValue(textarea, draft);
      vi.stubGlobal(
        'confirm',
        vi.fn(() => false),
      );
      // When: a control command that would replace the writing runs and the user declines the discard
      const commands = buildAppCommands(channel.surface!);
      const args = {
        rootId: command === 'openDocument' ? RELEASE_NOTES_ID : SUPPORT_TRIAGE_ID,
        text: 'Replacement',
        name: 'Cancelled configuration',
        projectId: channel.surface!.activeProjectId,
      };

      act(() => {
        expect(() => commands[command](args)).toThrow(/cancelled/i);
      });

      // Then: the command reports cancellation and the writing and loaded document are untouched
      expect(window.confirm).toHaveBeenCalled();
      expect(textarea.value).toBe(draft);
      expect(channel.surface?.loadedDocument?.rootId).toBe(SUPPORT_TRIAGE_ID);
      expect(channel.surface?.loadedDocument?.text).not.toBe('Replacement');
    },
  );
});
