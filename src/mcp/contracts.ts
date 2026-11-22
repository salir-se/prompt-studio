export interface StudioMcpTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  schemaHash: string;
  canCall: boolean;
}
export interface StudioMcpServer {
  id: string;
  name: string;
  url: string;
  tools: StudioMcpTool[];
  credentialAvailable: boolean;
}
export interface ToolBinding {
  name: string;
  serverId: string;
  toolName: string;
  schemaHash: string;
  mode: 'mock' | 'real';
  mock?: string;
}
export interface CapturedToolDefinition {
  name: string;
  serverName: string;
  toolName: string;
  mode: 'mock' | 'real';
  inputSchema: Record<string, unknown>;
  schemaHash: string;
}
export interface ToolCallTrace {
  id: string;
  name: string;
  serverId: string;
  toolName: string;
  mode: 'mock' | 'real' | 'refused';
  serverName?: string;
  input: Record<string, unknown>;
  startedAt: string;
  finishedAt?: string;
  result?: unknown;
  error?: string;
}
