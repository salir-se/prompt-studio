// ── @prompt-studio/prompt-graph-ui ────────────────────────────────────────────────────
// Components for the prompt graph studio (ADR-200 / ADR-202).
//
// Two deliberately separate layers, and the split is load-bearing:
//
//   1. LEAF COMPONENTS (`FragmentNode`) render from props alone and import no
//      graph library. This is what makes their later promotion into
//      `www/app.salir.se` cheap — the operator SPA can adopt them without
//      taking on `@xyflow/react`.
//   2. THE CANVAS (`PromptGraphCanvas`) is the only place `@xyflow/react` is
//      imported anywhere in the monorepo. Keep it that way: a stray import
//      elsewhere would pull the canvas into every bundle that touches
//      `@prompt-studio/ui`, which is the exact failure ADR-096 avoided for Milkdown.
//
// `layoutGraph` is pure and renderer-agnostic — it carries the real logic and
// is exhaustively testable without mounting anything, which is why it lives
// apart from the canvas rather than inside it.

export { FragmentEditDialog, type FragmentEditDialogProps } from './FragmentEditDialog';
export { FragmentNode, type FragmentNodeProps } from './FragmentNode';
export { HighlightedPromptText, type HighlightedPromptTextProps, HighlightedTokenSpans } from './HighlightedPromptText';
export { LabelChip, type LabelChipProps } from './LabelChip';
export {
  LAYOUT_COLLAPSED_ROW_HEIGHT,
  LAYOUT_COLUMN_WIDTH,
  LAYOUT_ROW_HEIGHT,
  type LayoutPosition,
  layoutGraph,
} from './layout';
export {
  MarkdownWithMermaid,
  type MarkdownWithMermaidProps,
  MermaidDiagram,
  type MermaidDiagramProps,
  validateMermaidDiagram,
} from './MarkdownWithMermaid';
export { PromptGraphCanvas, type PromptGraphCanvasProps } from './PromptGraphCanvas';
export { SkillMountNode, type SkillMountNodeProps } from './SkillMountNode';
export { ToolDefinitionNode, type ToolDefinitionNodeProps } from './ToolDefinitionNode';
export {
  type OpenSectionVerification,
  type SectionVerificationCoverage,
  type VerificationCheckStatus,
  VerificationCoverage,
} from './VerificationCoverage';
export { VerificationNode, type VerificationNodeProps } from './VerificationNode';
