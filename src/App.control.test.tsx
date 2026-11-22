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

  it('section commands edit one section through the editor: other sections stay byte-identical and the outline follows', async () => {
    // Given: Support Triage open in the editor
    await harness.renderBootedApp();
    harness.click(harness.byTestId(harness.starterRootTestId));
    const before = channel.surface!.loadedDocument!.text;
    const commands = () => buildAppCommands(channel.surface!);
    const listed = commands().listSections({ rootId: SUPPORT_TRIAGE_ID }) as { sections: Array<{ id: string }> };
    expect(listed.sections.map((section) => section.id)).toContain('urgency');

    // When: the agent replaces the urgency section's own body
    await act(async () => {
      commands().editSection({ rootId: SUPPORT_TRIAGE_ID, sectionId: 'urgency', body: '- high: money is at risk' });
    });

    // Then: only that section's body changed in the working text, and the read-back shows the new body
    const after = channel.surface!.loadedDocument!.text;
    const oldBody = (commands().readSection({ rootId: SUPPORT_TRIAGE_ID, sectionId: 'mission' }) as { body: string })
      .body;
    expect(before).toContain(oldBody);
    const urgency = /<urgency>\n[\s\S]*?<\/urgency>/;
    expect(after.replace(urgency, '')).toBe(before.replace(urgency, ''));
    expect(after).toContain('<urgency>\n- high: money is at risk\n</urgency>');

    // When: the agent inserts a section after mission and then moves output_format up (by its tag)
    await act(async () => {
      commands().insertSection({ rootId: SUPPORT_TRIAGE_ID, sectionId: 'mission', tag: 'examples', body: 'One.' });
    });
    await act(async () => {
      commands().moveSection({ rootId: SUPPORT_TRIAGE_ID, sectionId: 'output_format', direction: 'up' });
    });

    // Then: the editor's tree — what the outline and graph render — has the new order
    const ids = (
      commands().listSections({ rootId: SUPPORT_TRIAGE_ID }) as { sections: Array<{ id: string }> }
    ).sections.map((section) => section.id);
    expect(ids.indexOf('examples')).toBe(ids.indexOf('mission') + 1);
    expect(ids.indexOf('output-format')).toBe(ids.indexOf('customer-message') - 1);
    expect(channel.surface!.loadedDocument!.text).toContain('<examples>\nOne.\n</examples>');
  });
});
