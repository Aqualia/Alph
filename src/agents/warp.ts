import { tmpdir } from 'os';
import { join } from 'path';
import { AgentProvider, AgentConfig, RemovalConfig } from './provider';
import { FileOperations } from '../utils/fileOps';

export class WarpProvider implements AgentProvider {
  public readonly name = 'Warp';

  async detect(): Promise<string | null> {
    // Detect warp CLI availability
    try {
      const { execSync } = require('child_process');
      try {
        execSync('warp --version', { stdio: 'ignore' });
      } catch {
        execSync('warp-terminal --version', { stdio: 'ignore' });
      }
      // No config file path; return empty string so registry marks as detected
      return '';
    } catch {
      return null;
    }
  }

  async configure(config: AgentConfig): Promise<string | undefined> {
    // Prepare JSON snippet for Warp CLI import
    const { renderMcpServer } = await import('../renderers/mcp.js');
    const input: any = {
      agent: 'warp',
      serverId: config.mcpServerId,
      transport: (config.transport as any) || 'http',
      headers: config.headers,
      command: config.command,
      args: config.args,
      env: config.env
    };
    if (config.mcpServerUrl) input.url = config.mcpServerUrl;
    const rendered = renderMcpServer(input);

    const tempPath = join(tmpdir(), `alph-warp-mcp-${Date.now()}.json`);
    await FileOperations.writeJsonFile(tempPath, rendered);

    // Invoke warp CLI to add server(s)
    const { execSync } = require('child_process');
    try {
      try {
        execSync(`warp mcp add-server --config "${tempPath}"`, { stdio: 'inherit' });
      } catch {
        execSync(`warp-terminal mcp add-server --config "${tempPath}"`, { stdio: 'inherit' });
      }
    } catch (e: any) {
      throw new Error(`Failed to register MCP server with Warp CLI: ${e?.message || e}`);
    }
    return undefined;
  }

  async remove(removal: RemovalConfig): Promise<string | undefined> {
    // Attempt to remove via Warp CLI if available; fall back to no-op with guidance
    const { execSync } = require('child_process');
    try {
      try {
        execSync(`warp mcp remove-server --name "${removal.mcpServerId}"`, { stdio: 'inherit' });
      } catch {
        execSync(`warp-terminal mcp remove-server --name "${removal.mcpServerId}"`, { stdio: 'inherit' });
      }
    } catch (e: any) {
      throw new Error(`Failed to remove MCP server from Warp CLI. You can remove it from Warp > MCP Servers UI. Details: ${e?.message || e}`);
    }
    return undefined;
  }

  async listMCPServers(): Promise<string[]> {
    // Best-effort: Warp CLI may not support machine-readable output; return []
    return [];
  }

  async hasMCPServer(_serverId: string): Promise<boolean> {
    // Cannot reliably check without CLI JSON; assume false
    return false;
  }
}
