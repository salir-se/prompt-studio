// Side-effect CSS imports (this app's own `index.css`, plus `@xyflow/react/dist/style.css` and the
// Milkdown theme CSS pulled in transitively through `@prompt-studio/prompt-graph-ui`) — resolved by Vite at
// build time. Matches `packages/markdown-editor/src/types.d.ts`'s identical declaration, needed here
// too because `apps/tsconfig.json` excludes `**/vite-env.d.ts` (so `/// <reference types="vite/client" />`
// isn't picked up) and is a separate `tsc` program from `packages/tsconfig.json`, which never sees
// this app's files.
declare module '*.css';
// Vite `?raw` imports (the tools-literal-parser contract test reads the REAL prompt-package
// sources as text). Vitest understands these natively through its Vite pipeline; tsgo needs the
// ambient declaration below.
declare module '*?raw' {
  const source: string;
  export default source;
}
