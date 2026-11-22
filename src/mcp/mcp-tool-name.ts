/** Provider-safe alias; the original MCP name remains the dispatch target. */
export function mcpToolName(name: string) {
  return (
    name
      .replace(/[^A-Za-z0-9_]/g, '_')
      .replace(/^[0-9]/, '_$&')
      .slice(0, 55) || 'tool'
  );
}
