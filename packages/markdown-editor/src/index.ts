// ── @prompt-studio/markdown-editor ────────────────────────────────────────────────────
// The universal content editor (ADR-096): one component for every multi-line
// editing surface. `mode="markdown"` = lazy Milkdown Crepe WYSIWYG;
// `mode="plain"` = byte-transparent textarea for Liquid templates / LLM
// prompts / raw HTML. Do not import `@milkdown/*` anywhere else.
// Round-trips a document to/from a local `.md` file via upload + download helpers below.

export { DownloadMarkdownButton, type DownloadMarkdownButtonProps } from './DownloadMarkdownButton';
// Markdown file download (button) — save editor text to a local `.md` file.
// A pure filename/blob helper plus one dependency-free UI primitive
// (icon/label supplied by the consumer), symmetric with the upload helpers below.
export { downloadMarkdownFile, markdownDownloadFilename } from './download-markdown-file';
export { MarkdownDropzone, type MarkdownDropzoneProps } from './MarkdownDropzone';
export { MarkdownEditor, type MarkdownEditorMode, type MarkdownEditorProps } from './MarkdownEditor';
// App-wide policy (flags are resolved by the app and passed in here; the package never reads flags).
export {
  type MarkdownEditorPolicy,
  MarkdownEditorPolicyProvider,
  useMarkdownEditorPolicy,
} from './markdown-editor-policy';
export type { Fidelity, RequiredFidelity } from './markdown-fidelity';
// Markdown file upload (drag-drop + button) and validation — load a prompt/ICP
// from a local `.md` file. A pure read/validate helper plus two dependency-free
// UI primitives (icon/label supplied by the consumer).
export {
  ACCEPTED_MARKDOWN_EXTENSIONS,
  ACCEPTED_MARKDOWN_MIME_TYPES,
  isAcceptedMarkdownFile,
  MAX_PROMPT_UPLOAD_BYTES,
  type MarkdownFileContent,
  MarkdownUploadError,
  type MarkdownUploadErrorCode,
  readMarkdownFile,
  suggestedLabelFromFilename,
} from './read-markdown-file';
export { UploadMarkdownButton, type UploadMarkdownButtonProps } from './UploadMarkdownButton';
