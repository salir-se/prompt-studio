import { CfWorkerJsonSchemaValidator } from '@modelcontextprotocol/sdk/validation/cfworker';
import type { CustomTool, ToolInputSchema } from '@prompt-studio/prompts';
import type { McpTool } from './mcp-types';

/** Mock and live MCP calls enforce the same discovered input contract, without eval. */
export function validateMcpToolInput(schema: Record<string, unknown>, input: unknown): void {
  const result = new CfWorkerJsonSchemaValidator().getValidator(schema)(input);
  if (!result.valid) throw new Error(`Invalid tool input: ${result.errorMessage}`);
}

/** Convert MCP tool definitions to the agent ToolDefinition format */
// ZAI-62: Built-in tool names that MCP tools must not shadow
const BUILTIN_TOOL_NAMES = new Set([
  'web_search',
  'check_exists',
  'verify_url',
  'save_lead',
  'guess_email',
  'verify_email',
  'save_contact',
  'save_company_brief',
  'draft_email',
  'get_conversation',
  'get_lead_context',
  'get_catalog',
  'update_status',
  'update_stage',
  'stop_outreach',
  'publish_order',
  'record_won',
  'save_discovery_data',
  'report_data_gap',
  // Booking-link tools — advertised only behind `outreach.closer.booking-pages`; the names stay reserved.
  'list_booking_links',
  'request_booking_link',
  // ADR-281 Learning tools — registered only behind
  // `research.scout.learning-capture`, but shadow protection is unconditional:
  // an MCP server must never be able to claim one of these names.
  'recall_learnings',
  'record_learning',
  'rate_learning',
]);

const AGENT_BLOCKED_MCP_TOOL_NAMES = new Set([
  // Email MCP write/send tools bypass ADR-012's human approval boundary when
  // exposed to autonomous agents. Manual UI and scheduler paths call MCP
  // directly; agent dispatch must stay read-only for email.
  'email_send_message',
  'email_create_draft',
  'email_send_draft',
  'email_create_label',
  'email_modify_message',
]);

export function isAgentBlockedMcpToolName(name: string): boolean {
  return AGENT_BLOCKED_MCP_TOOL_NAMES.has(name);
}

export function mcpToolsToDefinitions(mcpTools: McpTool[]): CustomTool[] {
  return mcpTools
    .filter((t) => !BUILTIN_TOOL_NAMES.has(t.name) && !isAgentBlockedMcpToolName(t.name))
    .map((t) => ({
      name: t.name,
      description: t.description || `MCP tool: ${t.name}`,
      input_schema: t.inputSchema as unknown as ToolInputSchema,
    }));
}
