// @module-tag dom
import { createBlankPromptDesign, parsePromptDesign } from '@prompt-studio/prompts';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { PromptDesignPanel } from './PromptDesignPanel';

describe('PromptDesignPanel', () => {
  it('saves the current workflow through the familiar save shortcut', async () => {
    // Given: a valid design draft and its existing save boundary.
    const created = createBlankPromptDesign({ id: 'demo', title: 'Demo' });
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(<PromptDesignPanel design={created.design} text={created.text} onSave={onSave} onClose={vi.fn()} />);
    const field = screen.getByLabelText('Major workflow Mermaid');
    fireEvent.change(field, { target: { value: 'flowchart LR\n  Request --> Result' } });
    // When: the author saves from the workflow field.
    fireEvent.keyDown(field, { key: 's', ctrlKey: true });
    // Then: the same validated design reaches persistence.
    await waitFor(() => expect(onSave).toHaveBeenCalledOnce());
    expect(onSave.mock.calls[0][0].workflow).toContain('Request --> Result');
  });
  it('switches to structured output and verifies a real payload', () => {
    const created = createBlankPromptDesign({ id: 'demo', title: 'Demo' });
    render(<PromptDesignPanel design={created.design} text={created.text} onSave={vi.fn()} onClose={vi.fn()} />);
    fireEvent.change(screen.getByLabelText('Output'), { target: { value: 'json' } });
    fireEvent.change(screen.getByLabelText('JSON sample to verify'), { target: { value: '{}' } });
    fireEvent.click(screen.getByRole('button', { name: 'Verify sample' }));
    expect(screen.getByRole('status')).toHaveTextContent('Sample matches the JSON schema.');
  });

  it('defines a structured output schema without editing the complete design JSON', () => {
    const created = createBlankPromptDesign({ id: 'demo', title: 'Demo' });
    render(<PromptDesignPanel design={created.design} text={created.text} onSave={vi.fn()} onClose={vi.fn()} />);

    fireEvent.change(screen.getByLabelText('Output'), { target: { value: 'json' } });
    fireEvent.change(screen.getByLabelText('Output JSON schema'), {
      target: {
        value: JSON.stringify({
          type: 'object',
          required: ['summary'],
          properties: { summary: { type: 'string' } },
        }),
      },
    });
    fireEvent.blur(screen.getByLabelText('Output JSON schema'));
    fireEvent.change(screen.getByLabelText('JSON sample to verify'), { target: { value: '{}' } });
    fireEvent.click(screen.getByRole('button', { name: 'Verify sample' }));

    expect(screen.getByRole('status')).toHaveTextContent('required');
    expect((screen.getByLabelText('Prompt design JSON') as HTMLTextAreaElement).value).toContain('summary');

    fireEvent.change(screen.getByLabelText('JSON sample to verify'), {
      target: { value: '{"summary":"Expansion opportunity"}' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Verify sample' }));
    fireEvent.click(screen.getByRole('button', { name: 'Use verified sample as example' }));

    expect(screen.getByLabelText('Readiness')).toHaveTextContent('Structurally ready');
  });

  it('can verify structured input when both contracts use JSON', () => {
    const created = createBlankPromptDesign({ id: 'demo', title: 'Demo' });
    render(<PromptDesignPanel design={created.design} text={created.text} onSave={vi.fn()} onClose={vi.fn()} />);

    fireEvent.change(screen.getByLabelText('Input'), { target: { value: 'json' } });
    fireEvent.change(screen.getByLabelText('Output'), { target: { value: 'json' } });
    fireEvent.change(screen.getByLabelText('Input JSON schema'), {
      target: {
        value: JSON.stringify({
          type: 'object',
          required: ['customer'],
          properties: { customer: { type: 'string' } },
        }),
      },
    });
    fireEvent.blur(screen.getByLabelText('Input JSON schema'));
    fireEvent.change(screen.getByLabelText('JSON contract to verify'), { target: { value: 'input' } });
    fireEvent.change(screen.getByLabelText('JSON sample to verify'), { target: { value: '{}' } });
    fireEvent.click(screen.getByRole('button', { name: 'Verify sample' }));

    expect(screen.getByRole('status')).toHaveTextContent('required');
  });

  it('promotes a verified input sample when input is the only JSON contract', () => {
    const created = createBlankPromptDesign({ id: 'demo', title: 'Demo' });
    render(<PromptDesignPanel design={created.design} text={created.text} onSave={vi.fn()} onClose={vi.fn()} />);

    fireEvent.change(screen.getByLabelText('Input'), { target: { value: 'json' } });
    fireEvent.change(screen.getByLabelText('Input JSON schema'), {
      target: {
        value: JSON.stringify({
          type: 'object',
          required: ['customer'],
          properties: { customer: { type: 'string' } },
        }),
      },
    });
    fireEvent.blur(screen.getByLabelText('Input JSON schema'));
    fireEvent.change(screen.getByLabelText('JSON sample to verify'), { target: { value: '{"customer":"Acme"}' } });
    fireEvent.click(screen.getByRole('button', { name: 'Verify sample' }));
    fireEvent.click(screen.getByRole('button', { name: 'Use verified sample as example' }));

    expect(screen.getByLabelText('Readiness')).toHaveTextContent('Structurally ready');
  });

  it('defines the terminal tool used by a tool-call output', () => {
    const created = createBlankPromptDesign({ id: 'demo', title: 'Demo' });
    render(<PromptDesignPanel design={created.design} text={created.text} onSave={vi.fn()} onClose={vi.fn()} />);

    fireEvent.change(screen.getByLabelText('Available tools'), { target: { value: 'search_accounts, save_account' } });
    fireEvent.change(screen.getByLabelText('Output'), { target: { value: 'tool-call' } });
    fireEvent.change(screen.getByLabelText('Required tool name'), { target: { value: 'save_account' } });

    expect((screen.getByLabelText('Prompt design JSON') as HTMLTextAreaElement).value).toContain('save_account');
  });

  it('shows invalid authored examples in readiness', () => {
    const created = createBlankPromptDesign({ id: 'demo', title: 'Demo' });
    const design = parsePromptDesign(
      JSON.stringify({
        ...created.design,
        output: {
          kind: 'json',
          description: 'Result',
          jsonSchema: { type: 'object', required: ['name'], properties: { name: { type: 'string' } } },
          examples: [{}],
        },
      }),
    );
    render(<PromptDesignPanel design={design} text={created.text} onSave={vi.fn()} onClose={vi.fn()} />);
    expect(screen.getByLabelText('Readiness')).toHaveTextContent('Output example 1');
  });

  it('edits a graph section as an independent sub-prompt design', () => {
    const created = createBlankPromptDesign({ id: 'demo', title: 'Demo' });
    render(
      <PromptDesignPanel
        design={created.design}
        text={created.text}
        sectionId="demo.mission"
        onSave={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    fireEvent.change(screen.getByLabelText('Sub-prompt workflow Mermaid'), {
      target: { value: 'mindmap\n  root((Prompt))' },
    });

    expect(screen.getByRole('heading', { name: 'Sub-prompt design' })).toBeInTheDocument();
    expect((screen.getByLabelText('Prompt design JSON') as HTMLTextAreaElement).value).toContain('mindmap');
    expect(screen.queryByText('Section workflows')).not.toBeInTheDocument();
  });

  it('does not save Mermaid that cannot render', async () => {
    const created = createBlankPromptDesign({ id: 'demo', title: 'Demo' });
    const onSave = vi.fn();
    render(<PromptDesignPanel design={created.design} text={created.text} onSave={onSave} onClose={vi.fn()} />);

    fireEvent.change(screen.getByLabelText('Major workflow Mermaid'), { target: { value: 'flowchart LR\n  A -->' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save prompt design' }));

    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Major workflow cannot render'));
    expect(onSave).not.toHaveBeenCalled();
  });

  it('starts a design and verification profile for a newly added graph section', async () => {
    const created = createBlankPromptDesign({ id: 'demo', title: 'Demo' });
    const text = `${created.text}\n## Details\n\n<details>\nExplain the evidence.\n</details>\n`;
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(
      <PromptDesignPanel
        design={created.design}
        text={text}
        sectionId="demo.details"
        onSave={onSave}
        onClose={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Save prompt design' }));

    await waitFor(() => expect(onSave).toHaveBeenCalledOnce());
    const saved = onSave.mock.calls[0]?.[0];
    expect(saved?.sectionDesigns).toEqual(
      expect.arrayContaining([expect.objectContaining({ sectionId: 'demo.details' })]),
    );
    expect(saved?.verificationProfiles).toEqual(
      expect.arrayContaining([expect.objectContaining({ scope: 'section', sectionId: 'demo.details' })]),
    );
  });
  it.each([
    ['Input', undefined],
    ['Output', undefined],
    ['Input', 'demo.mission'],
    ['Output', 'demo.mission'],
  ])('blocks saving an invalid visible %s schema at %s, then saves the repaired schema', async (axis, sectionId) => {
    const created = createBlankPromptDesign({ id: 'demo', title: 'Demo' });
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(
      <PromptDesignPanel
        design={created.design}
        sectionId={sectionId}
        text={created.text}
        onSave={onSave}
        onClose={vi.fn()}
      />,
    );
    fireEvent.change(screen.getByLabelText(axis!), { target: { value: 'json' } });
    fireEvent.change(screen.getByLabelText(`${axis} JSON schema`), { target: { value: '{"type":' } });
    fireEvent.blur(screen.getByLabelText(`${axis} JSON schema`));
    fireEvent.click(screen.getByRole('button', { name: 'Save prompt design' }));
    expect(screen.getByRole('button', { name: 'Save prompt design' })).toBeDisabled();
    expect(onSave).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText(`${axis} JSON schema`), {
      target: { value: '{"type":"object","additionalProperties":false}' },
    });
    // Saving consumes the current field even when a keyboard action does not blur it first.
    fireEvent.click(screen.getByRole('button', { name: 'Save prompt design' }));
    await waitFor(() => expect(onSave).toHaveBeenCalledOnce());
    expect(
      (sectionId
        ? onSave.mock.calls[0][0].sectionDesigns.find(
            (section: { sectionId: string }) => section.sectionId === sectionId,
          )
        : onSave.mock.calls[0][0])[axis!.toLowerCase()].jsonSchema,
    ).toEqual({
      type: 'object',
      additionalProperties: false,
    });
  });
  it('keeps controls disabled until a design save finishes', async () => {
    const created = createBlankPromptDesign({ id: 'demo', title: 'Demo' });
    let finish!: () => void;
    const onSave = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    render(<PromptDesignPanel design={created.design} text={created.text} onSave={onSave} onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Save prompt design' }));
    await waitFor(() => expect(onSave).toHaveBeenCalledOnce());
    expect(screen.getByLabelText('Input description')).toBeDisabled();
    expect(screen.getByLabelText('Prompt design JSON')).toBeDisabled();
    finish();
    await waitFor(() => expect(screen.getByLabelText('Input description')).toBeEnabled());
  });

  it('keeps the separator while an author types multiple available tools', () => {
    const created = createBlankPromptDesign({ id: 'tools', title: 'Tools' });
    render(<PromptDesignPanel design={created.design} text={created.text} onSave={vi.fn()} onClose={vi.fn()} />);
    const field = screen.getByLabelText('Available tools') as HTMLInputElement;
    fireEvent.focus(field);
    for (const character of 'search_accounts, save_account') {
      fireEvent.change(field, { target: { value: field.value + character } });
    }
    expect(field).toHaveValue('search_accounts, save_account');
    expect(JSON.parse((screen.getByLabelText('Prompt design JSON') as HTMLTextAreaElement).value).tools).toEqual([
      'search_accounts',
      'save_account',
    ]);
  });
});
