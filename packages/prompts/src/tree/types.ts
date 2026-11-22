/**
 * Type-only contract for the prompt composition tree model and its graph
 * projection (ADR-200).
 *
 * Today every agent prompt (`packages/prompts/src/scout.ts`, `researcher.ts`,
 * `closer.ts`, `critic.ts`, …) is a single flat template string. Structure
 * exists only implicitly, expressed through three unrelated conventions that
 * grew organically rather than by design (see `SectionDelimiterKind` below).
 * ADR-200 defines a future authoring model where a prompt is a genuine tree of
 * addressable sections with stable ids and `{{variable}}` bindings; before we
 * migrate any prompt source we need a read-only visualizer that can parse
 * TODAY's strings into that shape, so engineers can see the tree that is
 * already there — implicitly — before committing to a rewrite.
 *
 * This file defines ONLY the shapes that parser and projection tasks are
 * built against; it intentionally contains no logic. Splitting the contract
 * out like this lets the parser, the graph projector, and any renderer be
 * implemented in parallel against a single frozen surface.
 *
 * RELATIONSHIP TO `../composition-contracts.ts` — these two models are
 * deliberately distinct and must not be merged. `composition-contracts.ts`
 * is the AUTHORING model: what a prompt should become under ADR-200, with a
 * `PromptBlueprint`, immutable `PromptSectionVersion`s, a `PromptConfiguration`
 * pinning exact versions, and a rich `PromptVariablePolicy` carrying schema,
 * lifecycle, encoding, and editor presentation. This file is the OBSERVED
 * model: what today's un-migrated strings demonstrably ARE, best-effort, with
 * delimiter provenance, tag classifications, and parse diagnostics.
 *
 * The distinction is not redundancy — it is direction. Lifecycle, encoding,
 * and an ArkType schema cannot be inferred from a raw prompt string; they are
 * authored decisions. So `PromptTreeNode.variables` deliberately holds bare
 * `{{name}}` identifiers rather than a weaker imitation of
 * `PromptVariablePolicy`. Migration runs parse → observe → author: a parsed
 * node is eventually LIFTED into a `PromptSectionVersion` by a human deciding
 * the policy fields. Anything needing a variable's policy must import it from
 * `composition-contracts.ts`; do not grow a second variable model here.
 *
 * Two families of types live here:
 *   - "Tree" types (`PromptTree`, `PromptTreeNode`, …) — the parsed
 *     structure, one node per addressable section, nested to mirror nesting
 *     in the source text.
 *   - "Graph" types (`PromptGraphModel`, `PromptGraphNode`, …) — a pure,
 *     framework-free projection of a `PromptTree` into a flat node/edge list
 *     suitable for feeding to *any* graph-rendering library. This module
 *     must never import React, the DOM lib, or a graph-rendering package
 *     (react-flow/xyflow, etc.) — those concerns belong to the renderer that
 *     consumes this projection, not to the projection's shape.
 */

// ── Tree ─────────────────────────────────────────────────────────────────────

/**
 * The three section-delimiter dialects a parser can encounter in prompt
 * source text, tagged explicitly on every parsed node so a consumer never
 * has to re-derive "how was this section spelled" from the raw text:
 *
 * - `'caps-label'` — an ALL-CAPS line ending in a colon, e.g. `YOUR MISSION:`
 *   or `SEARCH STRATEGY — 5 QUERY GROUPS:`. This is the dominant, load-bearing
 *   dialect in every prompt source today. Labels may contain digits, spaces,
 *   `/`, `&`, apostrophes, em-dash `—`, and hyphens.
 * - `'atx-heading'` — a standard markdown `#`/`##`/`###`/`####` heading. Zero
 *   occurrences exist in current prompt sources; it is the dialect ADR-200
 *   migrates prompts TO, so the type must support it even though the parser
 *   will not find any until that migration happens.
 * - `'xml-tag'` — a balanced, block-level XML-ish tag pair such as
 *   `<inbound_email>...</inbound_email>` or `<warning>...</warning>`.
 *
 * Kept as an explicit provenance tag (rather than inferring dialect from
 * shape at every call site) because the three dialects can appear
 * side-by-side in one prompt and a renderer or diagnostic often needs to
 * treat them differently (e.g. flag a mix of dialects as worth normalizing
 * ahead of an ADR-200 migration).
 */
export type SectionDelimiterKind = 'caps-label' | 'atx-heading' | 'xml-tag';

/**
 * A half-open `[start, end)` character offset pair into the *original*
 * source string a node (or diagnostic) was parsed from.
 *
 * Kept as raw offsets — not line/column, not a text slice copy — so a
 * consumer (an editor overlay, a highlighter, a "jump to source" link) can
 * always recover the exact source location without the parser needing to
 * track line numbers, and so a range stays valid as long as the caller still
 * holds the same source string the parser was given.
 */
export interface PromptSourceRange {
  /** Inclusive start offset, 0-based, into the source string. */
  start: number;
  /** Exclusive end offset into the source string. */
  end: number;
}

/**
 * One addressable section of a parsed prompt — the fundamental unit of the
 * tree. Every heading/label/tag occurrence the parser recognizes as a
 * section (as opposed to incidental text) becomes exactly one node.
 *
 * `id` is deliberately a *derived, stable* identifier (for example, a slug of
 * the title plus positional disambiguation) rather than an array index or a
 * random uuid: other tasks (a future editor, a diff view, a "link to this
 * section" URL) need a node's identity to survive edits to *sibling* or
 * *descendant* body text — an index-based id would silently repoint to a
 * different section the moment an earlier sibling is added or removed, and a
 * random id would defeat any diffing between two parses of the same prompt
 * across a source edit.
 */
export interface PromptTreeNode {
  /** Stable, derived identifier — see the type-level doc for why it must not be an index. */
  id: string;
  /** Human-readable heading/label text, with delimiter syntax (`#`, trailing `:`, `<tag>`) stripped. */
  title: string;
  /** Which of the three delimiter dialects produced this node — see `SectionDelimiterKind`. */
  delimiter: SectionDelimiterKind;
  /** Nesting depth, 1-based (a top-level/root-sibling section is depth 1). */
  depth: number;
  /**
   * The section's own raw body text, exclusive of nested children's text and
   * exclusive of the delimiter syntax itself (no leading `#`s, no trailing
   * `:`, no wrapping `<tag>`/`</tag>`). Kept raw (not re-rendered/trimmed of
   * meaningful whitespace) so `range` below always locates it exactly.
   */
  text: string;
  /** Character offsets of this node's full extent (delimiter + body + nested children) in the source string. */
  range: PromptSourceRange;
  /**
   * The XML tag name (without angle brackets or slash), present only when
   * `delimiter === 'xml-tag'`. Absent for `'caps-label'`/`'atx-heading'`
   * nodes, which have no tag name to carry.
   */
  tag?: string;
  /**
   * `{{name}}` variable identifiers referenced directly within this node's
   * OWN `text` (not inherited from, and not aggregated across, descendant
   * nodes) — mirrors the `{{ identifier }}` grammar already tokenized by
   * `PROMPT_PLACEHOLDER_RE` in `engine.ts` / consumed by `variable-assist.ts`.
   * Kept per-node rather than only at the tree root so a graph projection
   * can draw a `declares` edge from the exact section that introduces each
   * binding.
   */
  variables: string[];
  /**
   * Bare, whole-word occurrences of *known* tool names (e.g. `web_search`,
   * `save_lead`) found directly within this node's own `text` — mirrors how
   * `buildToolWordRegex`/`tokenizeTools` in `variable-assist.ts` match tools:
   * a whole-word, longest-name-first alternation built from a caller-supplied
   * list of known tool names. The set of known names is therefore an input
   * the parser must be given; it is not derivable from the prompt text alone.
   * A tag-shaped occurrence such as `<web_search>` is deliberately EXCLUDED
   * here — `variable-assist.ts`'s `tokenizeSegment` matches tags before
   * tools precisely so a tag never double-counts as a tool mention, and this
   * field preserves that same precedence: a `<name>` occurrence is always
   * classified as a tag (see `PromptTagClassification`), never as a tool
   * mention, even when `name` also happens to be a known tool. Scoped
   * per-node for the same reason as `variables`.
   */
  toolMentions: string[];
  /** Nested sections, in source order. Empty for a leaf section. */
  children: PromptTreeNode[];
}

/**
 * Why the parser classified a single tag occurrence the way it did — the
 * machine-readable counterpart to `PromptTagClassification.treatedAsSection`.
 * String-literal union (not an enum) covering every case the brief calls
 * out by name:
 *
 * - `'balanced-block-promoted'` — a well-formed opening/closing pair
 *   (`<inbound_email>...</inbound_email>`) that starts and ends its own
 *   line(s), so it was promoted to a `PromptTreeNode` with `delimiter:
 *   'xml-tag'`.
 * - `'unbalanced-open'` — an opening tag (or closing tag) with no matching
 *   counterpart anywhere in the source; never promoted to a section.
 * - `'inline-not-block-level'` — the tag occurs mid-line, sharing its line
 *   with other prose/tags rather than delimiting a block on its own — e.g.
 *   type/example notation like `<string>`, `<a>`, `<script>` written inline
 *   in instruction text. Never promoted, regardless of whether it happens to
 *   be balanced elsewhere in the string.
 * - `'known-tool-name'` — the tag's name matches a caller-supplied known
 *   tool name (e.g. `<web_search>`), so it is treated as a tool reference,
 *   not a structural delimiter, even if it is otherwise balanced and
 *   block-level.
 */
export type PromptTagClassificationReason =
  'balanced-block-promoted' | 'unbalanced-open' | 'inline-not-block-level' | 'known-tool-name';

/**
 * A single tag occurrence found anywhere in a prompt's source text, together
 * with the parser's verdict on whether it was promoted to a `PromptTreeNode`
 * section.
 *
 * Exists because prompt sources genuinely mix two unrelated uses of `<...>`
 * syntax: real block-level section delimiters (`<inbound_email>`,
 * `<warning>`) alongside tag-shaped tool names (`<web_search>`) and
 * type/example notation embedded in prose (`<string>`, `<a>`, `<script>`).
 * `PromptTreeNode.tag` alone cannot express this — it only exists on nodes
 * that already made it into the tree, so a tag the parser rejected as
 * inline notation or a tool reference would otherwise vanish with no trace.
 * Recording every occurrence here — accepted AND rejected — makes the
 * rejection an inspectable, recoverable fact instead of silently dropped
 * information, which is exactly the inventory a developer planning an
 * ADR-200 migration needs to see.
 */
export interface PromptTagClassification {
  /** The tag name, without angle brackets or slash (e.g. `'inbound_email'`, `'web_search'`, `'string'`). */
  name: string;
  /** Character offsets of the specific occurrence being classified (the opening tag when the pair is balanced). */
  range: PromptSourceRange;
  /** `true` only for `reason === 'balanced-block-promoted'` — i.e. this occurrence became a `PromptTreeNode`. */
  treatedAsSection: boolean;
  /** Machine-readable classification reason — see `PromptTagClassificationReason`. */
  reason: PromptTagClassificationReason;
}

/**
 * Severity of a `PromptParseDiagnostic`, following the conventional
 * info/warning/error ladder so a consumer can decide, without inspecting
 * `code`, whether a diagnostic merely informs, deserves a visual nudge, or
 * indicates the parse could not fully trust the resulting tree.
 */
export type PromptParseDiagnosticSeverity = 'info' | 'warning' | 'error';

/**
 * A single parse-time observation surfaced alongside the tree rather than
 * thrown — parsing today's ad hoc, un-specified prompt strings is inherently
 * best-effort (there is no schema the source text was written against), so
 * the parser must be able to report "here is what I noticed, and here is my
 * best guess at the tree anyway" instead of failing the whole parse.
 *
 * Examples this type must cover: a skipped markdown heading level (`#` then
 * `###` with no intervening `##`), an XML tag that never closes (or closes
 * without ever opening) — i.e. "unbalanced" — and a delimiter that is
 * ambiguous between dialects (e.g. an ALL-CAPS line that also happens to be
 * wrapped in a tag).
 *
 * `code` is a stable machine-readable identifier (screaming-snake or
 * kebab-case string, e.g. `'unbalanced-xml-tag'`) — stable across parser
 * versions so a consumer can filter/suppress by code without string-matching
 * `message`, which is free-text and may change wording at any time.
 */
export interface PromptParseDiagnostic {
  /** Stable, machine-matchable diagnostic identifier — see the type-level doc. */
  code: string;
  /** Free-text, human-readable explanation. Not stable — do not match against this. */
  message: string;
  severity: PromptParseDiagnosticSeverity;
  /** Where in the source the diagnostic applies, when it can be pinned to a location. */
  range?: PromptSourceRange;
}

/**
 * The root of one parsed prompt: the full parse result for a single prompt
 * source string (one `*_PROMPT` export such as `SCOUT_PROMPT`).
 *
 * Carries the original `text` verbatim (not just the parsed nodes) so a
 * renderer can always fall back to showing raw source for any byte range
 * `PromptTreeNode.range`/`PromptParseDiagnostic.range` did not account for,
 * and so downstream consumers never need a second round-trip to the prompt
 * source just to display it.
 */
export interface PromptTree {
  /** The prompt's identifying key/name (e.g. `'scout'`, matching its exported constant's origin). */
  key: string;
  /** The complete, unmodified prompt source string this tree was parsed from. */
  text: string;
  /** The greatest `depth` value present anywhere in `children` (0 if the tree has no sections). */
  maxDepth: number;
  /** Root-level sections, in source order. */
  children: PromptTreeNode[];
  /**
   * Every tag occurrence the parser found anywhere in `text`, whether or not
   * it was promoted to a section — see `PromptTagClassification` for why
   * rejected occurrences (inline notation, unbalanced tags, tool-name tags)
   * must be recorded here rather than dropped once parsing decides they are
   * not sections.
   */
  tagClassifications: PromptTagClassification[];
  /** Parse-time observations — see `PromptParseDiagnostic`. Empty when the parse was unambiguous. */
  diagnostics: PromptParseDiagnostic[];
}

// ── Graph projection ─────────────────────────────────────────────────────────
//
// Everything below is a pure, renderer-agnostic projection of a `PromptTree`
// into a flat node/edge list. It must stay free of any React, DOM, or
// graph-library (react-flow/xyflow) type so that projecting a tree into a
// graph never forces a dependency choice onto this Tier 1 package; the actual
// rendering library's node/edge shape is adapted from these types at the
// integration boundary, not defined here.

/**
 * The kind of entity a `PromptGraphNode` represents. Kept as an open-ended
 * union (not just `'section'`) because the graph is not simply "the tree
 * flattened" — it also surfaces `{{variable}}` bindings and tool mentions as
 * first-class nodes so a viewer can see, at a glance, which sections
 * introduce which variables/tools and where else they might be reused.
 */
export type PromptGraphNodeKind = 'root' | 'section' | 'variable' | 'tool' | 'file';

/**
 * A payload describing what a `PromptGraphNode` is projected from. Modeled
 * as a discriminated union keyed by `kind` (mirroring `PromptGraphNodeKind`)
 * so a consumer can narrow on `data.kind` and get the exact source detail for
 * that node type, instead of an untyped bag of optional fields.
 */
export type PromptGraphNodeData =
  | { kind: 'root'; tree: PromptTree }
  | { kind: 'section'; node: PromptTreeNode }
  | { kind: 'variable'; name: string }
  | { kind: 'tool'; name: string }
  | { kind: 'file'; path: string; loadBeforeBody: boolean };

/**
 * One node in the flattened graph projection. `id` is independent of, but
 * SHOULD be derivable from, the originating `PromptTreeNode.id` /
 * variable / tool name so a graph node can always be traced back to its
 * source; `parentId` is optional because the `'root'` node (and any node the
 * projector chooses to treat as a graph root) has none.
 */
export interface PromptGraphNode {
  /** Stable identifier, unique within one `PromptGraphModel`. */
  id: string;
  kind: PromptGraphNodeKind;
  /** Display label — the node's title for a section, or the bare name for a variable/tool. */
  label: string;
  /** The id of this node's structural parent in the projection, when it has one. */
  parentId?: string;
  /** The source detail this node was projected from — see `PromptGraphNodeData`. */
  data: PromptGraphNodeData;
}

/**
 * The relationship an edge represents, kept distinct from structural nesting
 * (which is `parentId` on `PromptGraphNode`) because a graph view commonly
 * wants to render "this section contains this child section" differently
 * from "this section declares this variable binding" (e.g. different line
 * style or color) even though both are, mechanically, parent → child links.
 *
 * - `'contains'` — a section node containing another section node (or the
 *   root containing its top-level sections): mirrors `PromptTreeNode.children`.
 * - `'declares'` — a section node declaring a `{{variable}}` binding or a
 *   tool mention that occurs directly within its own body text: mirrors
 *   `PromptTreeNode.variables` / `PromptTreeNode.toolMentions`.
 */
export type PromptGraphEdgeKind = 'contains' | 'declares' | 'references';

/** One directed edge in the flattened graph projection, connecting two `PromptGraphNode.id`s. */
export interface PromptGraphEdge {
  /** Stable identifier, unique within one `PromptGraphModel`. */
  id: string;
  /** Source node id (the "from" / structurally-outer end). */
  source: string;
  /** Target node id (the "to" / structurally-inner end). */
  target: string;
  kind: PromptGraphEdgeKind;
  /**
   * Human-readable name of the WHY behind this edge's existence — the reason
   * the target node was created, not just that a connection exists. Populated
   * only for `'declares'` edges, where there genuinely is a name to surface:
   * `{{name}}` (braces included, matching prompt source syntax and the
   * canvas's violet variable-chip vocabulary) for a variable target, or the
   * bare tool name (e.g. `web_search`) for a tool target. Deliberately absent
   * (not an empty string) for `'contains'` edges — structural nesting is
   * already named by the child section's own `title`/card, so labeling every
   * containment line would just repeat that title as noise on the canvas.
   */
  label?: string;
}

/**
 * The complete graph projection of one `PromptTree`: a flat node list plus a
 * flat edge list, with no implied nesting beyond what `parentId` and the
 * edges encode. This is the shape handed to a graph-rendering layer —
 * intentionally the *only* shape it is handed, so that layer never needs to
 * know about `PromptTreeNode`/`PromptTree` directly.
 */
export interface PromptGraphModel {
  nodes: PromptGraphNode[];
  edges: PromptGraphEdge[];
}
