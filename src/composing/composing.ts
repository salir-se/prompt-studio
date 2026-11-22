import {
  insertChildSection,
  insertSiblingSectionAfter,
  maskPromptSourceLiterals,
  parsePromptTree,
  type PromptTreeNode,
  uniqueSectionTagName,
} from '@prompt-studio/prompts';
import { sectionEditBody } from '../hooks/section-edit';
import { patternSteps } from './pattern-steps';

export interface DraftEdit {
  text: string;
  selectionStart: number;
  selectionEnd: number;
  selectionDirection?: 'forward' | 'backward' | 'none';
}
export interface Completion {
  label: string;
  detail: string;
  from: number;
  to: number;
  text: string;
  caret: number;
}
function xmlTokens(source: string) {
  return source.matchAll(/<(\/?)([A-Za-z_][\w-]*)(?:\s+(?:"[^"]*"|'[^']*'|[^'"<>])*)?\s*\/?>/g);
}

function insideTag(source: string) {
  let tag = false;
  let quote = '';
  for (let index = 0; index < source.length; index++) {
    const character = source[index];
    if (quote) {
      if (character === quote) quote = '';
    } else if (tag) {
      if (character === '"' || character === "'") quote = character;
      else if (character === '>') tag = false;
    } else if (character === '<' && /[A-Za-z_/]/.test(source[index + 1] ?? '')) tag = true;
  }
  return tag;
}

const COMMON_TAGS = ['mission', 'context', 'instructions', 'constraints', 'workflow', 'output', 'examples'];

function syntaxSource(text: string) {
  return maskPromptSourceLiterals(text).replace(/[<]!--[\s\S]*?(?:-->|$)|(`+)(?:[^\n]*?\1|[^\n]*$)/g, (match) =>
    match.replace(/[^\n]/g, ' '),
  );
}

export function completionsAt(
  text: string,
  caret: number,
  variables: readonly string[],
  tags: readonly string[],
): Completion[] {
  const before = text.slice(0, caret);
  const variable = /\{\{\s*([A-Za-z_][\w]*)?$/.exec(before);
  if (variable) {
    const suffix = /^\w*(?:\s*\}\}?)?/.exec(text.slice(caret))?.[0].length ?? 0;
    return [...new Set(variables)]
      .filter((name) => /^[A-Za-z_]\w*$/.test(name) && name.startsWith(variable[1] ?? ''))
      .map((name) => ({
        label: `{{${name}}}`,
        detail: 'Variable',
        from: caret - variable[0].length,
        to: caret + suffix,
        text: `{{${name}}}`,
        caret: name.length + 4,
      }));
  }
  const source = syntaxSource(text);
  const match = /<(\/?)(([A-Za-z_][\w-]*)?)$/.exec(before);
  if (!match || source.slice(caret - match[0].length, caret) !== match[0]) return [];
  const from = caret - match[0].length;
  if (insideTag(source.slice(0, from))) return [];
  const stack: string[] = [];
  for (const token of xmlTokens(source.slice(0, from))) {
    if (token[1]) {
      if (stack.at(-1) === token[2]) stack.pop();
    } else if (!/\/\s*>$/.test(token[0])) stack.push(token[2]);
  }
  const prefix = match[2];
  const names = match[1]
    ? [...new Set(stack.reverse())]
    : [...new Set([...tags, ...COMMON_TAGS, ...(prefix ? [prefix] : [])])];
  const suffix = /^[\w-]*(?:[ \t]*>)?/.exec(text.slice(caret))?.[0] ?? '';
  if (/^(?:[ \t]+[^>\r\n]|\/)/.test(text.slice(caret + suffix.length))) return [];
  const to = caret + suffix.length;
  return names
    .filter((name) => name.startsWith(prefix))
    .map((name) => {
      const opening = `<${name}>`;
      const closing = `</${name}>`;
      let balance = 0;
      let unmatchedClosings = 0;
      for (const token of xmlTokens(source.slice(to))) {
        if (token[2] !== name || /\/\s*>$/.test(token[0])) continue;
        balance += token[1] ? -1 : 1;
        unmatchedClosings = Math.max(unmatchedClosings, -balance);
      }
      const paired = !match[1] && unmatchedClosings <= stack.filter((open) => open === name).length;
      return {
        label: match[1] ? closing : opening,
        detail: match[1] ? 'Close open tag' : paired ? 'Paired section' : 'Opening tag',
        from,
        to,
        text: match[1] ? closing : paired ? `${opening}\n\n${closing}` : opening,
        caret: match[1] ? closing.length : opening.length + (paired ? 1 : 0),
      };
    });
}

export function draftSections(text: string): PromptTreeNode[] {
  const flatten = (nodes: PromptTreeNode[]): PromptTreeNode[] =>
    nodes.flatMap((node) => [node, ...flatten(node.children)]);
  return flatten(parsePromptTree({ key: 'draft', text }).children);
}

export function sectionAt(sections: readonly PromptTreeNode[], caret: number) {
  return sections.filter((node) => node.range.start <= caret && node.range.end >= caret).at(-1);
}

export function sectionSelection(text: string, section: PromptTreeNode): DraftEdit {
  const body = sectionEditBody(text, section);
  if (!body) {
    const start = Math.min(text.length, Math.max(0, section.range.start));
    return { text, selectionStart: start, selectionEnd: start };
  }
  const start = body.start;
  if (!section.text.trim()) return { text, selectionStart: start, selectionEnd: start };
  const leading = section.text.length - section.text.trimStart().length;
  return {
    text,
    selectionStart: start + leading,
    selectionEnd: Math.max(start + leading, start + section.text.trimEnd().length),
  };
}

export function insertDraftSection(
  text: string,
  parent: PromptTreeNode | undefined,
  child: boolean,
  requestedName: string,
): DraftEdit {
  const tree = parsePromptTree({ key: 'draft', text });
  const normalize = (name: string) => name.toLowerCase().replace(/\s+/g, '_');
  const titles = new Set(draftSections(text).map((section) => normalize(section.title)));
  let name = uniqueSectionTagName(tree, requestedName);
  for (let counter = 2; titles.has(normalize(name)); counter++)
    name = uniqueSectionTagName(tree, `${requestedName}_${counter}`);
  const next = parent
    ? (child ? insertChildSection : insertSiblingSectionAfter)(text, parent, name)
    : `${text}${text ? '\n\n' : ''}<${name}>\nDescribe this section.\n</${name}>`;
  const added = draftSections(next).find(
    (node) => node.tag === name || node.title === name || node.title === name.replace(/_/g, ' ').toUpperCase(),
  );
  return added ? sectionSelection(next, added) : { text: next, selectionStart: next.length, selectionEnd: next.length };
}

export function instructionStep(text: string, workflow: string, stepId: string): DraftEdit | null {
  const guide = patternSteps(workflow);
  const step = guide?.steps.find((item) => item.id === stepId);
  if (!guide || !step) return null;
  let sections = draftSections(text);
  const existing = sections.find((section) => section.tag === step.tag);
  if (existing) return sectionSelection(text, existing);
  const wrapperTag = `workflow_instructions_${guide.pattern.id}`;
  let wrapper = sections.find((section) => section.tag === wrapperTag || section.tag?.startsWith(`${wrapperTag}_`));
  if (!wrapper) {
    const name = uniqueSectionTagName(parsePromptTree({ key: 'draft', text }), wrapperTag);
    text += `${text ? '\n\n' : ''}<${name}>\nFollow these workflow instructions.\n</${name}>`;
    sections = draftSections(text);
    wrapper = sections.find((section) => section.tag === name)!;
  }
  const preceding = guide.steps
    .slice(0, guide.steps.indexOf(step))
    .reverse()
    .map((item) => wrapper.children.find((section) => section.tag === item.tag))
    .find((section) => section !== undefined);
  // Existing instructions stay untouched; newly authored steps are ordered peers in their own wrapper.
  return insertDraftSection(text, preceding ?? wrapper, !preceding, step.tag);
}
