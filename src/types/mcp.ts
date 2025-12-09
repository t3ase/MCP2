export type ToolInput = Record<string, unknown>;

export type ToolDefinition = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
};

export type ToolHandler = (input: ToolInput) => Promise<unknown>;

export type ToolRegistry = {
  definitions: ToolDefinition[];
  handlers: Record<string, ToolHandler>;
};



