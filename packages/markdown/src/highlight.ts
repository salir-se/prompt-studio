import { createHighlighter } from '@tanstack/highlight/core';
import { json } from '@tanstack/highlight/languages/json';
import { yaml } from '@tanstack/highlight/languages/yaml';
import { createTanStackMarkdownHighlighter } from '@tanstack/highlight/markdown';

export const codeHighlighter = createHighlighter({ languages: [json, yaml] });
export const highlightCodeHtml = createTanStackMarkdownHighlighter(codeHighlighter);
