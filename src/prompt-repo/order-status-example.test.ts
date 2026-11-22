// @module-tag pure
import {
  parsePromptTree,
  validatePromptDesign,
  verifyStructuredJsonInput,
  verifyStructuredJsonOutput,
} from '@prompt-studio/prompts';
import { describe, expect, it } from 'vitest';
import projectJson from '../../examples/order-status/.prompt-studio/project.json';
import orderStatusFile from '../../examples/order-status/prompts/order-status.md?raw';
import { workflowProblems } from '../design/design-scope';
import { validateProjectDefinitions } from './project-definitions';
import { readWorkspacePrompt } from './workspace-document';

/**
 * The finished project of the "zero to hero" course (`examples/order-status`) must open with its design:
 * the course video and the written guide show these sections, contracts and checks.
 */
describe('examples/order-status', () => {
  const loaded = readWorkspacePrompt(orderStatusFile);

  it('opens with its embedded design and no structural issues', () => {
    // Given: the committed prompt file
    // When: the editor reads its design comment
    // Then: the design parses and validates against the Markdown without issues
    expect(loaded).not.toBeNull();
    expect(validatePromptDesign(loaded!.design, loaded!.text)).toEqual([]);
    expect(parsePromptTree({ key: 'order-status', text: loaded!.text }).diagnostics).toEqual([]);
  });

  it('has workflows that Mermaid can render, so the course can save them through set_design', async () => {
    // Given: the major workflow and every sub-prompt workflow of the finished design
    // When: each one is checked the way Save and set_design check it
    // Then: none fails (a node id such as `call` is a Mermaid keyword and breaks the diagram)
    expect(await workflowProblems(loaded!.design)).toEqual([]);
  });

  it('keeps one design per tagged section, in reading order', () => {
    // Given: the loaded design
    // Then: each of the six teaching sections has a sub-prompt design
    expect(loaded!.design.sectionDesigns.map((section) => section.sectionId)).toEqual([
      'order-status.mission',
      'order-status.rules',
      'order-status.tool_use',
      'order-status.examples',
      'order-status.output_format',
      'order-status.customer_message',
    ]);
  });

  it('shares its variables and the lookup_order tool through valid project definitions', () => {
    // Given: the project definitions file
    // When: it is validated like an import
    const definitions = validateProjectDefinitions(projectJson);
    // Then: the variables match the design and the tool the prompt names is defined
    expect(definitions.variables).toEqual(loaded!.design.variables);
    expect(definitions.tools.map((tool) => tool.name)).toEqual(loaded!.design.tools);
  });

  it('accepts the course sample that passes and rejects the one that fails', () => {
    // Given: the output contract taught in episode 4
    const output = loaded!.design.output;
    // When: the failing and the fixed samples are verified
    const failing = verifyStructuredJsonOutput(
      output,
      '{"reply":"Refund issued.","next_action":"refund","order_id":"10423"}',
    );
    const passing = verifyStructuredJsonOutput(
      output,
      '{"reply":"ORD-10423 shipped on 18 November.","next_action":"none","order_id":"ORD-10423"}',
    );
    // Then: only the fixed sample passes, and the input example is valid too
    expect(failing.valid).toBe(false);
    expect(passing.valid).toBe(true);
    expect(
      verifyStructuredJsonInput(
        loaded!.design.input,
        '{"customer_message":"Where is ORD-10423?","company_name":"Northwind Outfitters"}',
      ).valid,
    ).toBe(true);
  });
});
