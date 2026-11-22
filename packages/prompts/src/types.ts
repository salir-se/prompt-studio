// ── Tool Definition Types ────────────────────────────────────────────────────

/** Array `items` schema. Expand-only: `properties`/`required` support object-item arrays. */
export interface ToolItemsSchema {
  type: string;
  description?: string;
  properties?: Record<string, ToolPropertySchema>;
  required?: string[];
  /** `false` closes an object item to the listed properties. Expand-only. */
  additionalProperties?: boolean;
}

/**
 * A single property in a tool's `input_schema`. Expand-only: `enum` constrains a
 * string property to a closed value list, and `properties`/`required` describe an
 * object-typed property (for example an `evidence` block).
 */
export interface ToolPropertySchema {
  type: string;
  description?: string;
  items?: ToolItemsSchema;
  enum?: string[];
  properties?: Record<string, ToolPropertySchema>;
  required?: string[];
}

export interface ToolInputSchema {
  additionalProperties?: boolean;
  type: 'object';
  properties: Record<string, ToolPropertySchema>;
  required?: string[];
}

export interface WebSearchTool {
  name: string;
  type: string;
}

export interface CustomTool {
  name: string;
  description: string;
  input_schema: ToolInputSchema;
}

export type ToolDefinition = WebSearchTool | CustomTool;
