export type Transport = 'http' | 'sse' | 'stdio';

export interface RenderInput {
  agent: 'cursor' | 'gemini' | 'claude';
  serverId: string;
  transport: Transport;
  url?: string;
  headers?: Record<string, string>;
  command?: string;
  args?: string[];
  cwd?: string;
  env?: Record<string, string>;
  timeout?: number;
}

export interface RenderOutput {
  [containerKey: string]: Record<string, Record<string, unknown>>;
}

function nonEmpty(obj?: Record<string, unknown>): Record<string, unknown> | undefined {
  if (!obj) return undefined;
  const keys = Object.keys(obj);
  return keys.length > 0 ? obj : undefined;
}

export function renderMcpServer(input: RenderInput): RenderOutput {
  const { agent, serverId, transport } = input;

  let server: Record<string, unknown> = {};

  if (agent === 'cursor') {
    if (transport === 'stdio') {
      server = {
        ...(input.command ? { command: input.command } : {}),
        ...(input.args ? { args: input.args } : {}),
        ...(input.env ? { env: input.env } : {})
      };
    } else if (transport === 'sse') {
      server = {
        type: 'sse',
        ...(input.url ? { url: input.url } : {}),
        ...(nonEmpty(input.headers) ? { headers: input.headers } : {})
      };
    } else {
      server = {
        type: 'http',
        ...(input.url ? { url: input.url } : {}),
        ...(nonEmpty(input.headers) ? { headers: input.headers } : {})
      };
    }
  } else if (agent === 'gemini') {
    if (transport === 'stdio') {
      server = {
        transport: 'stdio',
        ...(input.command ? { command: input.command } : {}),
        ...(input.args ? { args: input.args } : {}),
        ...(input.cwd ? { cwd: input.cwd } : {}),
        ...(nonEmpty(input.env) ? { env: input.env } : {}),
        ...(typeof input.timeout === 'number' ? { timeout: input.timeout } : {})
      };
    } else if (transport === 'sse') {
      server = {
        transport: 'sse',
        ...(input.url ? { url: input.url } : {}),
        ...(nonEmpty(input.headers) ? { headers: input.headers } : {}),
        ...(nonEmpty(input.env) ? { env: input.env } : {}),
        ...(typeof input.timeout === 'number' ? { timeout: input.timeout } : {})
      };
    } else {
      server = {
        ...(input.url ? { httpUrl: input.url } : {}),
        ...(nonEmpty(input.headers) ? { headers: input.headers } : {}),
        ...(nonEmpty(input.env) ? { env: input.env } : {}),
        ...(typeof input.timeout === 'number' ? { timeout: input.timeout } : {})
      };
    }
  } else if (agent === 'claude') {
    if (transport === 'stdio') {
      server = {
        ...(input.command ? { command: input.command } : {}),
        ...(input.args ? { args: input.args } : {}),
        ...(nonEmpty(input.env) ? { env: input.env } : {})
      };
    } else if (transport === 'sse') {
      server = {
        type: 'sse',
        ...(input.url ? { url: input.url } : {}),
        ...(nonEmpty(input.headers) ? { headers: input.headers } : {})
      };
    } else {
      server = {
        type: 'http',
        ...(input.url ? { url: input.url } : {}),
        ...(nonEmpty(input.headers) ? { headers: input.headers } : {})
      };
    }
  } else {
    // Fallback: generic shape similar to gemini
    server = transport === 'stdio'
      ? { command: input.command, ...(input.args ? { args: input.args } : {}), ...(nonEmpty(input.env) ? { env: input.env } : {}) }
      : { url: input.url, ...(nonEmpty(input.headers) ? { headers: input.headers } : {}) };
  }

  return {
    mcpServers: {
      [serverId]: server
    }
  };
}

