import type {
  PromptBlueprint,
  PromptConfiguration,
  PromptSection,
  PromptSectionVersion,
  PromptVersionReference,
} from './composition-contracts';
import { PROMPT_PLACEHOLDER_RE } from './engine';
import type { PromptExtensionPoint } from './extension-contracts';
import { renderStrictPromptSections } from './strict-renderer';

const TAG_NAME = /^[a-z][a-z0-9_]*$/;
const MARKDOWN_HEADING = /^\s*#{1,6}\s/m;

export interface RenderPromptBlueprintInput {
  readonly blueprint: PromptBlueprint;
  readonly configuration: PromptConfiguration;
  readonly sectionVersions: readonly PromptSectionVersion[];
  readonly values: Record<string, unknown>;
}

export interface RenderedPromptBlueprint {
  readonly systemPrompt: string;
  readonly sectionIds: readonly string[];
}

interface PositionedSection {
  readonly node: PromptSection;
  readonly depth: number;
  readonly parentIndex?: number;
}

interface SelectedSection extends PositionedSection {
  readonly version: PromptSectionVersion;
}

function sameReference(left: PromptVersionReference, right: PromptVersionReference): boolean {
  return left.id === right.id && left.version === right.version;
}

function exactKeys(expected: readonly string[], actual: readonly string[]): boolean {
  const left = [...expected].sort();
  const right = [...actual].sort();
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function selectSections(
  blueprint: PromptBlueprint,
  configuration: PromptConfiguration,
  versions: readonly PromptSectionVersion[],
): readonly SelectedSection[] {
  if (!sameReference(configuration.blueprint, blueprint)) {
    throw new TypeError('Prompt configuration selects another blueprint');
  }
  if (!Number.isInteger(blueprint.maxDepth) || blueprint.maxDepth < 1 || blueprint.maxDepth > 5) {
    throw new TypeError('Prompt blueprint maxDepth must be between 1 and 5');
  }

  const positioned: PositionedSection[] = [];
  const ids = new Set<string>();
  const tags = new Set<string>();
  const visit = (node: PromptSection, depth: number, parentIndex?: number): void => {
    if (!node.id || ids.has(node.id)) throw new TypeError(`Prompt section ID must be non-empty and unique: ${node.id}`);
    if (!TAG_NAME.test(node.tag) || tags.has(node.tag)) {
      throw new TypeError(`Prompt section tag must be lowercase snake_case and unique: ${node.tag}`);
    }
    if (depth > blueprint.maxDepth) throw new TypeError(`Prompt blueprint exceeds maxDepth at section ${node.id}`);
    ids.add(node.id);
    tags.add(node.tag);
    const index = positioned.length;
    positioned.push({ node, depth, ...(parentIndex === undefined ? {} : { parentIndex }) });
    for (const child of node.children) visit(child, depth + 1, index);
  };
  visit(blueprint.root, 1);

  const sectionIds = positioned.map(({ node }) => node.id);
  if (!exactKeys(sectionIds, Object.keys(configuration.sectionVersions))) {
    throw new TypeError('Prompt configuration section versions must exactly match blueprint sections');
  }

  const structuralTags = positioned.map(({ node }) => node.tag);
  return positioned.map(({ node, depth, parentIndex }) => {
    const reference = configuration.sectionVersions[node.id];
    const matches = versions.filter(
      (version) =>
        reference &&
        version.id === reference.id &&
        version.version === reference.version &&
        version.sectionId === node.id,
    );
    if (matches.length !== 1) throw new TypeError(`Prompt section ${node.id} must select exactly one matching version`);
    const version = matches[0];
    if (!version.heading.trim()) throw new TypeError(`Prompt section ${node.id} requires a heading`);
    if (MARKDOWN_HEADING.test(version.template)) {
      throw new TypeError(`Prompt section ${node.id} templates must not contain Markdown headings`);
    }
    if (structuralTags.some((tag) => version.template.includes(`<${tag}`) || version.template.includes(`</${tag}>`))) {
      throw new TypeError(`Prompt section ${node.id} templates must not contain structural tags`);
    }
    const declaredVariables = new Set(version.variables.map(({ name }) => name));
    const placeholderPattern = new RegExp(PROMPT_PLACEHOLDER_RE.source, PROMPT_PLACEHOLDER_RE.flags);
    for (const match of version.template.matchAll(placeholderPattern)) {
      const name = match[1];
      if (name && !declaredVariables.has(name)) {
        throw new TypeError(`Placeholder ${name} is not declared by section ${node.id}`);
      }
    }
    return { node, version, depth, ...(parentIndex === undefined ? {} : { parentIndex }) };
  });
}

function renderSelectedSections(
  selected: readonly SelectedSection[],
  bodies: readonly string[],
): RenderedPromptBlueprint {
  const render = (index: number): string => {
    const { node, version, depth } = selected[index];
    const children = selected
      .map((section, childIndex) => ({ section, childIndex }))
      .filter(({ section }) => section.parentIndex === index)
      .map(({ childIndex }) => render(childIndex));
    return [
      `${'#'.repeat(depth)} ${version.heading}`,
      `<${node.tag}>`,
      bodies[index].trim(),
      ...children.flatMap((child) => ['', child]),
      `</${node.tag}>`,
    ]
      .filter((line, lineIndex, lines) => line !== '' || (lineIndex > 0 && lines[lineIndex - 1] !== ''))
      .join('\n');
  };

  return { systemPrompt: render(0), sectionIds: selected.map(({ node }) => node.id) };
}

/** Render the exact configuration-selected tree. Headings and tags are generated, never user-authored. */
export function renderPromptBlueprint(input: RenderPromptBlueprintInput): RenderedPromptBlueprint {
  const selected = selectSections(input.blueprint, input.configuration, input.sectionVersions);
  const bodies = renderStrictPromptSections(
    selected.map(({ version }) => version),
    input.values,
  );
  return renderSelectedSections(selected, bodies);
}

/** Render the canonical editable projection without resolving its declared variables. */
export function renderPromptBlueprintTemplate(
  input: Omit<RenderPromptBlueprintInput, 'values'>,
): RenderedPromptBlueprint {
  const selected = selectSections(input.blueprint, input.configuration, input.sectionVersions);
  return renderSelectedSections(
    selected,
    selected.map(({ version }) => version.template),
  );
}

/** Generate the documentation tree from the same executable blueprint and selected section headings. */
export function renderPromptBlueprintMermaid(
  blueprint: PromptBlueprint,
  sectionVersions: readonly PromptSectionVersion[],
  extensionPoints: readonly PromptExtensionPoint[] = [],
): string {
  const headings = new Map(sectionVersions.map((section) => [section.sectionId, section.heading]));
  const lines = ['flowchart TD'];
  const sectionIndexes = new Map<string, number>();
  let index = 0;
  const visit = (node: PromptSection, depth: number, parent?: number): void => {
    const current = index++;
    sectionIndexes.set(node.id, current);
    const heading = headings.get(node.id);
    if (!heading) throw new TypeError(`Prompt section ${node.id} has no documented heading`);
    const label = `H${depth} ${heading}<br/>${node.tag}`.replaceAll('"', '&quot;');
    lines.push(`  section${current}["${label}"]`);
    if (parent !== undefined) lines.push(`  section${parent} --> section${current}`);
    for (const child of node.children) visit(child, depth + 1, current);
  };
  visit(blueprint.root, 1);

  for (const [extensionIndex, reference] of (blueprint.extensionPoints ?? []).entries()) {
    const point = extensionPoints.find(
      (candidate) => candidate.id === reference.id && candidate.version === reference.version,
    );
    if (!point) throw new TypeError(`Prompt extension ${reference.id}@${reference.version} has no definition`);
    const detail = point.delivery === 'inline' ? `<br/>${point.tag}` : '';
    lines.push(`  extension${extensionIndex}["extension:${point.delivery} ${point.id}@${point.version}${detail}"]`);
    for (const sectionId of point.allowedSectionIds) {
      const sectionIndex = sectionIndexes.get(sectionId);
      if (sectionIndex === undefined)
        throw new TypeError(`Prompt extension ${point.id} references unknown section ${sectionId}`);
      lines.push(`  section${sectionIndex} -.-> extension${extensionIndex}`);
    }
  }
  return lines.join('\n');
}
