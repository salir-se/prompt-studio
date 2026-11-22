/** One tool discovered on an MCP server. */
export interface McpTool {
  serverId: string;
  /** Configured display name; older callers may only provide the stable ID. */
  serverName?: string;
  name: string;
  description?: string;
  inputSchema: Record<string, unknown>;
}
