import { dirname, join } from 'path';
import { AgentProvider, AgentConfig, RemovalConfig } from './provider';
import { FileOperations } from '../utils/fileOps';
import { SafeEditManager } from '../utils/safeEdit';

interface WindsurfConfig {
  mcpServers?: {
    [name: string]: {
      command?: string;
      args?: string[];
      env?: Record<string, string>;
      serverUrl?: string;
      headers?: Record<string, string>;
      disabled?: boolean;
    }
  };
  [key: string]: unknown;
}

export class WindsurfProvider implements AgentProvider {
  public readonly name = 'Windsurf';

  private configPath: string | null = null;

  constructor() {
    this.configPath = this.getDefaultConfigPath();
  }

  private getDefaultConfigPath(configDir?: string): string {
    const home = require('os').homedir();
    if (configDir && configDir.trim()) {
      return join(configDir, '.codeium', 'windsurf', 'mcp_config.json');
    }
    return join(home, '.codeium', 'windsurf', 'mcp_config.json');
  }

  async detect(configDir?: string): Promise<string | null> {
    const p = this.getDefaultConfigPath(configDir);
    try {
      if (await FileOperations.fileExists(p)) {
        // Sanity: ensure readable JSON
        await FileOperations.readJsonFile<unknown>(p);
        this.configPath = p;
        return p;
      }
      // If file not present, we still consider Windsurf available upon request
      // but return null so status won't try to read it.
      this.configPath = p;
      return p; // allow configuration to create it
    } catch {
      this.configPath = p;
      return p;
    }
  }

  async configure(config: AgentConfig, backup: boolean = true): Promise<string | undefined> {
    if (!this.configPath) this.configPath = this.getDefaultConfigPath(config.configDir);
    if (!this.configPath) throw new Error('Unable to determine Windsurf configuration path');

    // Ensure directory exists
    await FileOperations.ensureDirectory(dirname(this.configPath));

    const result = await SafeEditManager.safeEdit<WindsurfConfig>(
      this.configPath,
      async (cfg) => this.inject(cfg, config),
      { createBackup: backup, autoRollback: true, validator: (c) => this.validateConfig(c, config) }
    );

    if (!result.success) throw result.error || new Error('Configuration update failed');
    return backup && result.backupInfo ? result.backupInfo.backupPath : undefined;
  }

  async remove(removal: RemovalConfig, backup: boolean = true): Promise<string | undefined> {
    if (!this.configPath) this.configPath = this.getDefaultConfigPath(removal.configDir);
    if (!this.configPath) throw new Error('Unable to determine Windsurf configuration path');
    if (!(await FileOperations.fileExists(this.configPath))) {
      throw new Error(`Configuration file not found: ${this.configPath}`);
    }

    const result = await SafeEditManager.safeEdit<WindsurfConfig>(
      this.configPath,
      (cfg) => this.removeEntry(cfg, removal),
      { createBackup: backup, autoRollback: true, validator: (c) => this.validateConfig(c) }
    );
    if (!result.success) throw result.error || new Error('Configuration removal failed');
    return backup && result.backupInfo ? result.backupInfo.backupPath : undefined;
  }

  async listMCPServers(configDir?: string): Promise<string[]> {
    const p = configDir ? this.getDefaultConfigPath(configDir) : this.configPath;
    if (!p || !(await FileOperations.fileExists(p))) return [];
    const cfg = await FileOperations.readJsonFile<WindsurfConfig>(p);
    return cfg.mcpServers ? Object.keys(cfg.mcpServers) : [];
  }

  async hasMCPServer(serverId: string, configDir?: string): Promise<boolean> {
    const list = await this.listMCPServers(configDir);
    return list.includes(serverId);
  }

  private async inject(cfg: WindsurfConfig, ac: AgentConfig): Promise<WindsurfConfig> {
    const next: WindsurfConfig = { ...cfg, mcpServers: { ...(cfg.mcpServers || {}) } };
    const { renderMcpServer } = await import('../renderers/mcp.js');
    const input: any = {
      agent: 'windsurf',
      serverId: ac.mcpServerId,
      transport: (ac.transport as any) || 'http',
      headers: ac.headers,
      command: ac.command,
      args: ac.args,
      env: ac.env
    };
    if (ac.mcpServerUrl) input.url = ac.mcpServerUrl;
    const rendered = renderMcpServer(input);
    const entry = (rendered as any).mcpServers[ac.mcpServerId];
    (next.mcpServers as any)[ac.mcpServerId] = entry;
    return next;
  }

  private removeEntry(cfg: WindsurfConfig, rem: RemovalConfig): WindsurfConfig {
    if (!cfg.mcpServers || !(rem.mcpServerId in cfg.mcpServers)) {
      throw new Error(`MCP server '${rem.mcpServerId}' not found`);
    }
    const { [rem.mcpServerId]: _removed, ...rest } = cfg.mcpServers;
    return { ...cfg, mcpServers: rest };
  }

  private validateConfig(cfg: WindsurfConfig, expected?: AgentConfig): boolean {
    if (cfg && typeof cfg === 'object' && cfg.mcpServers && typeof cfg.mcpServers === 'object') {
      for (const [, s] of Object.entries(cfg.mcpServers)) {
        if (typeof s !== 'object' || s === null) return false;
        if ((s as any).serverUrl && typeof (s as any).serverUrl !== 'string') return false;
        if ((s as any).command && typeof (s as any).command !== 'string') return false;
        if ((s as any).args && !Array.isArray((s as any).args)) return false;
        if ((s as any).env && typeof (s as any).env !== 'object') return false;
        if ((s as any).headers && typeof (s as any).headers !== 'object') return false;
      }

      if (expected) {
        const s = (cfg.mcpServers as any)[expected.mcpServerId];
        if (!s) return false;
        if (expected.transport === 'stdio' && expected.command && s.command !== expected.command) return false;
        if (expected.mcpServerUrl && s.serverUrl !== expected.mcpServerUrl) return false;
      }
      return true;
    }
    // If no servers yet, still valid
    return true;
  }
}
