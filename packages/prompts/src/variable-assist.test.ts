// @module-tag pure
import { describe, expect, it } from 'vitest';
import { PROMPT_PLACEHOLDER_RE } from './engine';
import type { PromptToken } from './variable-assist';
import { extractPlaceholderNames, findUnknownPlaceholders, PROMPT_TAG_RE, tokenizePromptText } from './variable-assist';

const concatText = (tokens: PromptToken[]): string => tokens.map((t) => t.text).join('');

describe('extractPlaceholderNames', () => {
  it('extracts a single placeholder name', () => {
    expect(extractPlaceholderNames('Hello {{name}}!')).toEqual(['name']);
  });

  it('returns names in first-appearance order, deduplicated', () => {
    expect(extractPlaceholderNames('{{b}} {{a}} {{b}} {{c}} {{a}}')).toEqual(['b', 'a', 'c']);
  });

  it('returns an empty array when there are no placeholders', () => {
    expect(extractPlaceholderNames('no placeholders here')).toEqual([]);
  });

  it('returns an empty array for an empty string', () => {
    expect(extractPlaceholderNames('')).toEqual([]);
  });

  it('tolerates whitespace inside braces', () => {
    expect(extractPlaceholderNames('{{  name  }}')).toEqual(['name']);
  });

  it('ignores non-identifier placeholder-looking text', () => {
    expect(extractPlaceholderNames('{{ not-an-identifier }} {{1abc}} {x} {{}}')).toEqual([]);
  });
});

describe('findUnknownPlaceholders', () => {
  it('returns placeholder names absent from knownVariables', () => {
    expect(findUnknownPlaceholders('{{product_name}} {{mystery}}', ['product_name'])).toEqual(['mystery']);
  });

  it('returns an empty array when every placeholder is known', () => {
    expect(findUnknownPlaceholders('{{a}} {{b}}', ['a', 'b'])).toEqual([]);
  });

  it('returns an empty array when there are no placeholders', () => {
    expect(findUnknownPlaceholders('plain text', ['a'])).toEqual([]);
  });

  it('preserves first-appearance order and dedupes among the unknowns only', () => {
    expect(findUnknownPlaceholders('{{a}} {{x}} {{b}} {{x}} {{y}}', ['a', 'b'])).toEqual(['x', 'y']);
  });

  it('treats an empty knownVariables list as everything unknown', () => {
    expect(findUnknownPlaceholders('{{a}} {{b}}', [])).toEqual(['a', 'b']);
  });
});

describe('tokenizePromptText — kinds', () => {
  it('tokenizes plain text with no placeholders or tools as a single text token', () => {
    const tokens = tokenizePromptText('just plain text', { variables: [] });
    expect(tokens).toEqual([{ kind: 'text', text: 'just plain text' }]);
  });

  it('classifies a known placeholder as kind "variable"', () => {
    const tokens = tokenizePromptText('Hi {{product_name}}!', { variables: ['product_name'] });
    expect(tokens).toEqual([
      { kind: 'text', text: 'Hi ' },
      { kind: 'variable', text: '{{product_name}}', name: 'product_name' },
      { kind: 'text', text: '!' },
    ]);
  });

  it('classifies an unlisted placeholder as kind "unknown-variable"', () => {
    const tokens = tokenizePromptText('Hi {{mystery}}!', { variables: ['product_name'] });
    expect(tokens).toEqual([
      { kind: 'text', text: 'Hi ' },
      { kind: 'unknown-variable', text: '{{mystery}}', name: 'mystery' },
      { kind: 'text', text: '!' },
    ]);
  });

  it('preserves raw whitespace inside the placeholder braces verbatim', () => {
    const tokens = tokenizePromptText('{{ product_name }}', { variables: ['product_name'] });
    expect(tokens).toEqual([{ kind: 'variable', text: '{{ product_name }}', name: 'product_name' }]);
  });

  it('classifies a known tool word as kind "tool"', () => {
    const tokens = tokenizePromptText('Call web_search first.', { variables: [], tools: ['web_search'] });
    expect(tokens).toEqual([
      { kind: 'text', text: 'Call ' },
      { kind: 'tool', text: 'web_search', name: 'web_search' },
      { kind: 'text', text: ' first.' },
    ]);
  });

  it('does not tokenize tool words when known.tools is omitted', () => {
    const tokens = tokenizePromptText('Call web_search first.', { variables: [] });
    expect(tokens).toEqual([{ kind: 'text', text: 'Call web_search first.' }]);
  });

  it('does not tokenize tool words when known.tools is an empty array', () => {
    const tokens = tokenizePromptText('Call web_search first.', { variables: [], tools: [] });
    expect(tokens).toEqual([{ kind: 'text', text: 'Call web_search first.' }]);
  });

  it('tokenizes a realistic mixed prompt fragment', () => {
    const text = 'Use web_search to research {{company_name}} then save_lead if {{mystery}} scores high.';
    const tokens = tokenizePromptText(text, {
      variables: ['company_name'],
      tools: ['web_search', 'save_lead'],
    });
    expect(tokens).toEqual([
      { kind: 'text', text: 'Use ' },
      { kind: 'tool', text: 'web_search', name: 'web_search' },
      { kind: 'text', text: ' to research ' },
      { kind: 'variable', text: '{{company_name}}', name: 'company_name' },
      { kind: 'text', text: ' then ' },
      { kind: 'tool', text: 'save_lead', name: 'save_lead' },
      { kind: 'text', text: ' if ' },
      { kind: 'unknown-variable', text: '{{mystery}}', name: 'mystery' },
      { kind: 'text', text: ' scores high.' },
    ]);
  });

  it('finds multiple tool occurrences within a single gap', () => {
    const tokens = tokenizePromptText('web_search then web_search again', { variables: [], tools: ['web_search'] });
    expect(tokens).toEqual([
      { kind: 'tool', text: 'web_search', name: 'web_search' },
      { kind: 'text', text: ' then ' },
      { kind: 'tool', text: 'web_search', name: 'web_search' },
      { kind: 'text', text: ' again' },
    ]);
  });
});

describe('tokenizePromptText — tool word boundaries', () => {
  it('does not match a tool name embedded inside a longer underscored identifier', () => {
    const tokens = tokenizePromptText('my_web_search_x is unrelated', { variables: [], tools: ['web_search'] });
    expect(tokens).toEqual([{ kind: 'text', text: 'my_web_search_x is unrelated' }]);
  });

  it('does not match when the surrounding text merely resembles the tool name', () => {
    const tokens = tokenizePromptText('webs_search is not the tool', { variables: [], tools: ['web_search'] });
    expect(tokens).toEqual([{ kind: 'text', text: 'webs_search is not the tool' }]);
  });

  it('matches the tool name at the very start and end of the text', () => {
    const tokens = tokenizePromptText('web_search', { variables: [], tools: ['web_search'] });
    expect(tokens).toEqual([{ kind: 'tool', text: 'web_search', name: 'web_search' }]);
  });

  it('matches a standalone occurrence but skips a corrupted neighbor in the same string', () => {
    const tokens = tokenizePromptText('my_web_search_x calls web_search directly', {
      variables: [],
      tools: ['web_search'],
    });
    expect(tokens).toEqual([
      { kind: 'text', text: 'my_web_search_x calls ' },
      { kind: 'tool', text: 'web_search', name: 'web_search' },
      { kind: 'text', text: ' directly' },
    ]);
  });

  it('prefers the longest tool name when one is a prefix of another', () => {
    const tokens = tokenizePromptText('web_search', { variables: [], tools: ['web', 'web_search'] });
    expect(tokens).toEqual([{ kind: 'tool', text: 'web_search', name: 'web_search' }]);
  });

  it('prefers the longest tool name regardless of input ordering', () => {
    const tokens = tokenizePromptText('web_search', { variables: [], tools: ['web_search', 'web'] });
    expect(tokens).toEqual([{ kind: 'tool', text: 'web_search', name: 'web_search' }]);
  });

  it('still matches the shorter tool name when the longer one is absent from the text', () => {
    const tokens = tokenizePromptText('just web here', { variables: [], tools: ['web', 'web_search'] });
    expect(tokens).toEqual([
      { kind: 'text', text: 'just ' },
      { kind: 'tool', text: 'web', name: 'web' },
      { kind: 'text', text: ' here' },
    ]);
  });
});

describe('tokenizePromptText — tools never split placeholders', () => {
  it('classifies a tool-shaped name inside braces as a placeholder, not a tool token', () => {
    const tokens = tokenizePromptText('{{web_search}}', { variables: [], tools: ['web_search'] });
    expect(tokens).toEqual([{ kind: 'unknown-variable', text: '{{web_search}}', name: 'web_search' }]);
  });

  it('classifies a tool-shaped known variable inside braces as "variable", not "tool"', () => {
    const tokens = tokenizePromptText('{{web_search}}', { variables: ['web_search'], tools: ['web_search'] });
    expect(tokens).toEqual([{ kind: 'variable', text: '{{web_search}}', name: 'web_search' }]);
  });

  it('tokenizes the same name correctly on each side of the brace boundary', () => {
    const tokens = tokenizePromptText('Run web_search then {{web_search}}.', {
      variables: ['web_search'],
      tools: ['web_search'],
    });
    expect(tokens).toEqual([
      { kind: 'text', text: 'Run ' },
      { kind: 'tool', text: 'web_search', name: 'web_search' },
      { kind: 'text', text: ' then ' },
      { kind: 'variable', text: '{{web_search}}', name: 'web_search' },
      { kind: 'text', text: '.' },
    ]);
  });
});

describe('tokenizePromptText — tag tokens', () => {
  it('classifies a bare opening tag as kind "tag" with its bracket-free name', () => {
    const tokens = tokenizePromptText('<warning>', { variables: [] });
    expect(tokens).toEqual([{ kind: 'tag', text: '<warning>', name: 'warning' }]);
  });

  it('classifies a closing tag as kind "tag", text keeps the slash verbatim', () => {
    const tokens = tokenizePromptText('</special_skill>', { variables: [] });
    expect(tokens).toEqual([{ kind: 'tag', text: '</special_skill>', name: 'special_skill' }]);
  });

  it('classifies a self-closing tag as kind "tag"', () => {
    const tokens = tokenizePromptText('<br/>', { variables: [] });
    expect(tokens).toEqual([{ kind: 'tag', text: '<br/>', name: 'br' }]);
  });

  it('classifies a tag with attributes as one "tag" token; name excludes the attributes', () => {
    const tokens = tokenizePromptText('<skill name="x">', { variables: [] });
    expect(tokens).toEqual([{ kind: 'tag', text: '<skill name="x">', name: 'skill' }]);
  });

  it('tokenizes adjacent open/close tags with no gap text token between them', () => {
    const tokens = tokenizePromptText('<a></a>', { variables: [] });
    expect(tokens).toEqual([
      { kind: 'tag', text: '<a>', name: 'a' },
      { kind: 'tag', text: '</a>', name: 'a' },
    ]);
  });

  it('a tag can wrap a known and an unknown variable, each still classified independently', () => {
    const tokens = tokenizePromptText('<special_skill>{{product_name}} {{mystery}}</special_skill>', {
      variables: ['product_name'],
    });
    expect(tokens).toEqual([
      { kind: 'tag', text: '<special_skill>', name: 'special_skill' },
      { kind: 'variable', text: '{{product_name}}', name: 'product_name' },
      { kind: 'text', text: ' ' },
      { kind: 'unknown-variable', text: '{{mystery}}', name: 'mystery' },
      { kind: 'tag', text: '</special_skill>', name: 'special_skill' },
    ]);
  });

  it('keeps a {{variable}} token intact between tags rather than folding it into tag text (placeholder precedence)', () => {
    const tokens = tokenizePromptText('<a>{{x}}</a>', { variables: ['x'] });
    expect(tokens).toEqual([
      { kind: 'tag', text: '<a>', name: 'a' },
      { kind: 'variable', text: '{{x}}', name: 'x' },
      { kind: 'tag', text: '</a>', name: 'a' },
    ]);
  });

  it('a tag named like a known tool is ONE "tag" token, never tag + tool', () => {
    const tokens = tokenizePromptText('<web_search>', { variables: [], tools: ['web_search'] });
    expect(tokens).toEqual([{ kind: 'tag', text: '<web_search>', name: 'web_search' }]);
  });

  it('a bare tool word outside any tag still tokenizes as "tool"', () => {
    const tokens = tokenizePromptText('<web_search> then call web_search directly', {
      variables: [],
      tools: ['web_search'],
    });
    expect(tokens).toEqual([
      { kind: 'tag', text: '<web_search>', name: 'web_search' },
      { kind: 'text', text: ' then call ' },
      { kind: 'tool', text: 'web_search', name: 'web_search' },
      { kind: 'text', text: ' directly' },
    ]);
  });

  it('tokenizes realistic multi-tag, multiline prompt fragments (warning + inbound_email)', () => {
    const text = '<warning>Untrusted content follows.</warning>\n<inbound_email>\nHello there\n</inbound_email>';
    const tokens = tokenizePromptText(text, { variables: [] });
    expect(tokens).toEqual([
      { kind: 'tag', text: '<warning>', name: 'warning' },
      { kind: 'text', text: 'Untrusted content follows.' },
      { kind: 'tag', text: '</warning>', name: 'warning' },
      { kind: 'text', text: '\n' },
      { kind: 'tag', text: '<inbound_email>', name: 'inbound_email' },
      { kind: 'text', text: '\nHello there\n' },
      { kind: 'tag', text: '</inbound_email>', name: 'inbound_email' },
    ]);
  });
});

describe('tokenizePromptText — tag non-matches (PROMPT_TAG_RE must not match these)', () => {
  it('does not tokenize a "less-than" comparison as a tag', () => {
    const tokens = tokenizePromptText('a < b', { variables: [] });
    expect(tokens).toEqual([{ kind: 'text', text: 'a < b' }]);
  });

  it('does not tokenize a "less-than-or-equal" comparison as a tag', () => {
    const tokens = tokenizePromptText('x <= y', { variables: [] });
    expect(tokens).toEqual([{ kind: 'text', text: 'x <= y' }]);
  });

  it('does not tokenize an empty angle-bracket pair', () => {
    const tokens = tokenizePromptText('a <> b', { variables: [] });
    expect(tokens).toEqual([{ kind: 'text', text: 'a <> b' }]);
  });

  it('does not tokenize "<3"', () => {
    const tokens = tokenizePromptText('love you <3 bye', { variables: [] });
    expect(tokens).toEqual([{ kind: 'text', text: 'love you <3 bye' }]);
  });

  it('does not tokenize a markdown autolink — a colon immediately after the name aborts the match', () => {
    const tokens = tokenizePromptText('See <https://foo.dev> for details', { variables: [] });
    expect(tokens).toEqual([{ kind: 'text', text: 'See <https://foo.dev> for details' }]);
  });

  it('does not tokenize a name preceded by whitespace inside the brackets', () => {
    const tokens = tokenizePromptText('< spaced> text', { variables: [] });
    expect(tokens).toEqual([{ kind: 'text', text: '< spaced> text' }]);
  });
});

describe('tokenizePromptText — concatenation invariant', () => {
  const knownRich = { variables: ['name', 'a', 'b'], tools: ['web_search'] };

  const samples: Array<[string, string]> = [
    ['empty string', ''],
    ['plain text only', 'nothing special here'],
    ['unicode and box-drawing characters', 'café ☕ 日本語 ════════ emoji 🎉 done'],
    ['adjacent placeholders', '{{a}}{{b}}'],
    ['placeholder at the very start', '{{a}} tail text'],
    ['placeholder at the very end', 'head text {{a}}'],
    ['invalid identifier stays text', '{{ not-an-identifier }}'],
    ['leading-digit identifier stays text', '{{1abc}}'],
    ['single braces stay text', 'Return JSON: { "name": "{{name}}", "age": 30 }'],
    ['multiline text around a placeholder', 'line one\nline two {{name}}\nline three\nweb_search here'],
    ['unknown placeholder mixed with tool word', 'web_search {{unknown}} web_search'],
    ['tag pair wrapping a known variable', '<special_skill>{{name}}</special_skill>'],
    ['self-closing tag adjacent to a tool word', '<br/>web_search'],
    ['tag-shaped tool name plus a bare tool word', '<web_search>{{a}} web_search'],
    ['non-matching angle brackets stay text', 'a < b and x <= y and <> and <3'],
    ['markdown autolink inside a tag pair', '<warning>See <https://foo.dev> for details</warning>'],
  ];

  it.each(samples)('reproduces the input byte-for-byte: %s', (_label, sample) => {
    const tokens = tokenizePromptText(sample, knownRich);
    expect(concatText(tokens)).toBe(sample);
  });

  it('reproduces the input when no tools are configured', () => {
    const sample = '{{a}} plus web_search-like-text and {{unknown}}';
    const tokens = tokenizePromptText(sample, { variables: ['a'] });
    expect(concatText(tokens)).toBe(sample);
  });
});

describe('regex statefulness across calls', () => {
  it('extractPlaceholderNames gives identical results on repeated calls with the same input', () => {
    const text = '{{x}} middle {{y}}';
    expect(extractPlaceholderNames(text)).toEqual(['x', 'y']);
    expect(extractPlaceholderNames(text)).toEqual(['x', 'y']);
    expect(extractPlaceholderNames(text)).toEqual(['x', 'y']);
  });

  it('is unaffected by another consumer leaving PROMPT_PLACEHOLDER_RE.lastIndex dirty', () => {
    // Simulate a previous caller (e.g. engine.ts internals, or a future exec()-based
    // consumer) leaving the shared, exported global regex mid-iteration.
    PROMPT_PLACEHOLDER_RE.lastIndex = 15;
    try {
      const text = '{{first}} then {{second}}';
      expect(extractPlaceholderNames(text)).toEqual(['first', 'second']);

      PROMPT_PLACEHOLDER_RE.lastIndex = 999;
      expect(findUnknownPlaceholders(text, ['first'])).toEqual(['second']);

      PROMPT_PLACEHOLDER_RE.lastIndex = 3;
      const tokens = tokenizePromptText(text, { variables: ['first', 'second'] });
      expect(concatText(tokens)).toBe(text);
      expect(tokens.filter((t) => t.kind === 'variable').map((t) => t.name)).toEqual(['first', 'second']);
    } finally {
      PROMPT_PLACEHOLDER_RE.lastIndex = 0;
    }
  });

  it('tokenizePromptText gives identical results on repeated calls with the same input', () => {
    const text = 'web_search {{a}} web_search';
    const known = { variables: ['a'], tools: ['web_search'] };
    const first = tokenizePromptText(text, known);
    const second = tokenizePromptText(text, known);
    expect(second).toEqual(first);
  });

  it('is unaffected by another consumer leaving PROMPT_TAG_RE.lastIndex dirty', () => {
    // Same guard as PROMPT_PLACEHOLDER_RE above, for the shared, module-level
    // global PROMPT_TAG_RE.
    PROMPT_TAG_RE.lastIndex = 10;
    try {
      const text = '<warning>first</warning> <inbound_email>second</inbound_email>';
      const first = tokenizePromptText(text, { variables: [] });
      PROMPT_TAG_RE.lastIndex = 5;
      const second = tokenizePromptText(text, { variables: [] });
      expect(second).toEqual(first);
      expect(concatText(first)).toBe(text);
      expect(first.filter((t) => t.kind === 'tag').map((t) => t.name)).toEqual([
        'warning',
        'warning',
        'inbound_email',
        'inbound_email',
      ]);
    } finally {
      PROMPT_TAG_RE.lastIndex = 0;
    }
  });
});
