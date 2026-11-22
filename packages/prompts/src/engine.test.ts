// @module-tag pure
import { describe, expect, it } from 'vitest';
import { renderPrompt, renderTemplate } from './engine';

describe('renderTemplate (strict)', () => {
  it('substitutes a single placeholder', () => {
    expect(renderTemplate('Hello {{name}}!', { name: 'World' })).toBe('Hello World!');
  });

  it('substitutes multiple placeholders', () => {
    const out = renderTemplate('{{greeting}}, {{name}}!', { greeting: 'Hi', name: 'Alice' });
    expect(out).toBe('Hi, Alice!');
  });

  it('throws ReferenceError on missing key', () => {
    // Given: a template with a placeholder not provided in data
    // When: renderTemplate is called (strict mode)
    // Then: a ReferenceError is thrown indicating the missing key
    expect(() => renderTemplate('Hello {{missing}}!', {})).toThrow(ReferenceError);
    expect(() => renderTemplate('Hello {{missing}}!', {})).toThrow('missing is not defined');
  });

  it('handles null and undefined values as empty string', () => {
    // Given: data containing null and undefined values
    // When: renderTemplate is called with those values
    // Then: both null and undefined render as empty string
    expect(renderTemplate('a={{x}},b={{y}}', { x: null, y: undefined })).toBe('a=,b=');
  });

  it('leaves single-brace JSON examples untouched', () => {
    const template = 'Return JSON: { "name": "{{name}}", "age": 30 }';
    const out = renderTemplate(template, { name: 'Bob' });
    expect(out).toBe('Return JSON: { "name": "Bob", "age": 30 }');
  });

  it('does not HTML-escape values (LLM prompts are not HTML)', () => {
    const out = renderTemplate('{{value}}', { value: '<script>alert("x")</script>' });
    expect(out).toBe('<script>alert("x")</script>');
  });
});

describe('renderPrompt (forgiving)', () => {
  it('substitutes provided keys', () => {
    expect(renderPrompt('Hello {{name}}!', { name: 'World' })).toBe('Hello World!');
  });

  it('renders missing keys as empty string instead of throwing', () => {
    expect(renderPrompt('Hello {{missing}}!', {})).toBe('Hello !');
  });

  it('substitutes some keys and empties others when partially filled', () => {
    const template = '{{a}}/{{b}}/{{c}}';
    expect(renderPrompt(template, { a: '1', c: '3' })).toBe('1//3');
  });

  it('accepts an empty data object and renders all placeholders as empty', () => {
    expect(renderPrompt('[{{x}}][{{y}}]')).toBe('[][]');
  });

  it('preserves non-placeholder content including curly braces', () => {
    const template = 'Code: { foo: {{value}} }';
    expect(renderPrompt(template, { value: 'bar' })).toBe('Code: { foo: bar }');
  });

  it('handles spreading multiple context objects (brand + per-call)', () => {
    const brand = { product_name: 'Acme', company_name: 'Acme Inc' };
    const perCall = { signal_text: 'hiring React devs' };
    const template = '{{product_name}} found a signal: {{signal_text}} ({{company_name}})';
    expect(renderPrompt(template, { ...brand, ...perCall })).toBe('Acme found a signal: hiring React devs (Acme Inc)');
  });

  it('handles numeric and boolean values by coercing to string', () => {
    expect(renderPrompt('count={{n}}, ok={{flag}}', { n: 42, flag: true })).toBe('count=42, ok=true');
  });

  it('escapes {{ in data values to prevent template injection', () => {
    const result = renderPrompt('Hello {{name}}', { name: '}} INJECTED {{' });
    expect(result).toContain('} } INJECTED { {');
    expect(result).not.toContain('INJECTED {{');
  });

  it('renders normal data without escaping', () => {
    expect(renderPrompt('Hello {{name}}', { name: 'World' })).toBe('Hello World');
  });

  it('handles data with single braces normally', () => {
    expect(renderPrompt('Hello {{name}}', { name: 'JSON {key: val}' })).toBe('Hello JSON {key: val}');
  });

  it('escapes nested template patterns in data', () => {
    const result = renderPrompt('Hello {{name}}', { name: '{{secret_key}}' });
    expect(result).toBe('Hello { {secret_key} }');
  });

  // ── S2-16 regression: prompt injection prevention ─────────────────────────

  it('prevents multi-level injection: data containing {{other_key}}', () => {
    // Given: a template with one placeholder {{name}}, and a second key
    //        {{secret}} that is NOT in the template. The data value for name
    //        contains "{{secret}}" trying to reference the other data key.
    // When: renderPrompt resolves the template
    // Then: the injected {{secret}} in the data value is escaped to "{ {secret} }"
    //       and does NOT get resolved — the actual secret value never appears in output
    const result = renderPrompt('Name: {{name}}', {
      name: '{{secret}}',
      secret: 'TOP_SECRET_VALUE',
    });
    expect(result).toContain('{ {secret} }');
    expect(result).not.toContain('TOP_SECRET_VALUE');
    expect(result).toBe('Name: { {secret} }');
  });

  it('handles data with }} at end of string', () => {
    // Given: a data value that ends with }} (closing delimiter)
    // When: renderPrompt processes the template
    // Then: the }} is escaped to } } to prevent delimiter confusion
    const result = renderPrompt('Value: {{val}}', { val: 'data}}' });
    expect(result).toBe('Value: data} }');
    expect(result).not.toContain('data}}');
  });

  it('escapes in renderTemplate strict mode too', () => {
    // Given: a data value containing {{injection}} in strict mode
    // When: renderTemplate processes the template
    // Then: the injection pattern is escaped just like in forgiving mode
    const result = renderTemplate('Hello {{name}}', { name: '{{injection}}' });
    expect(result).toBe('Hello { {injection} }');
    expect(result).not.toContain('{{injection}}');
  });
});
