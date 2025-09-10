import { join, dirname } from 'path';
import { AgentProvider, AgentConfig, RemovalConfig } from './provider';
import { FileOperations } from '../utils/fileOps';
import { BackupManager } from '../utils/backup';

// Use CJS require pattern for broad compatibility
// eslint-disable-next-line @typescript-eslint/no-var-requires
const TOML = require('@iarna/toml');

interface CodexTomlServer {
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  startup_timeout_ms?: number;
}

interface CodexTomlConfig {
  mcp_servers?: Record<string, CodexTomlServer>;
  // Preserve other unknown keys if present
  [key: string]: unknown;
}

export class CodexProvider implements AgentProvider {
  public readonly name = 'Codex CLI';

  private configPath: string | null = null;

  constructor() {
    this.configPath = this.getDefaultConfigPath();
  }

  private getDefaultConfigPath(configDir?: string): string {
    const home = require('os').homedir();
    if (configDir && configDir.trim()) {
      return join(configDir, '.codex', 'config.toml');
    }
    return join(home, '.codex', 'config.toml');
  }

  async detect(configDir?: string): Promise<string | null> {
    const p = this.getDefaultConfigPath(configDir);
    this.configPath = p;
    try {
      if (await FileOperations.fileExists(p)) {
        // Ensure it is readable text TOML by attempting parse
        const fs = await import('fs/promises');
        const raw = await fs.readFile(p, 'utf-8');
        // Best-effort parse (do not throw if empty)
        if (raw && raw.trim().length > 0) {
          TOML.parse(raw);
        }
        return p;
      }
      // Not present yet; still return the path so we can create it on configure
      return p;
    } catch (e) {
      // If parse fails, still consider detected (file exists), but return path
      return p;
    }
  }

  async configure(config: AgentConfig, backup: boolean = true): Promise<string | undefined> {
    if (!this.configPath) this.configPath = this.getDefaultConfigPath(config.configDir);
    if (!this.configPath) throw new Error('Unable to determine Codex configuration path');

    // Enforce Codex transport constraints: only STDIO supported (no HTTP/SSE)
    const t = (config.transport || 'stdio');
    if (t !== 'stdio') {
      throw new Error('Codex CLI only supports local MCP servers via STDIO. Remote HTTP/SSE endpoints are not supported in ~/.codex/config.toml.');
    }
    if (!config.command || config.command.trim().length === 0) {
      throw new Error('STDIO transport for Codex requires a command (e.g., npx, node, php).');
    }

    // Read existing TOML (if present)
    const fs = await import('fs/promises');
    let current: CodexTomlConfig = {};
    const path = this.configPath;
    const dir = dirname(path);

    // Create backup if requested and file exists
    let backupPath: string | undefined;
    if (backup && await FileOperations.fileExists(path)) {
      const info = await BackupManager.createBackup(path);
      backupPath = info.backupPath;
    }

    if (await FileOperations.fileExists(path)) {
      const raw = await fs.readFile(path, 'utf-8');
      if (raw && raw.trim().length > 0) {
        try { current = TOML.parse(raw); } catch (e) { /* proceed with empty on parse error */ }
      }
    }

    const next: CodexTomlConfig = { ...(current || {}) };
    const servers: Record<string, CodexTomlServer> = {
      ...(next.mcp_servers || {})
    };
    // Normalize command for cross-platform compatibility (notably Windows)
    // Many MCP clients spawn processes without a shell. On Windows, shims like
    // npx/yarn/pnpm are distributed as .cmd files. If the command is provided
    // as "npx" (or similar) without the .cmd extension, the child process may
    // fail to locate the program and error with "program not found".
    let normalizedCommand = config.command?.trim() || '';
    if (process.platform === 'win32') {
      const lower = normalizedCommand.toLowerCase();
      // Add .cmd if missing for common package runners
      if (lower === 'npx') normalizedCommand = 'npx.cmd';
      if (lower === 'yarn') normalizedCommand = 'yarn.cmd';
      if (lower === 'pnpm') normalizedCommand = 'pnpm.cmd';
    }

    const entry: CodexTomlServer = { command: normalizedCommand };
    if (config.args && config.args.length > 0) entry.args = config.args;
    if (config.env && Object.keys(config.env).length > 0) entry.env = config.env;
    if (typeof config.timeout === 'number' && config.timeout > 0) entry.startup_timeout_ms = config.timeout;

    // Heuristic: npx/yarn dlx/pnpm dlx may need extra time on first run
    const cmd = (normalizedCommand || '').toLowerCase();
    const firstArg = (config.args && config.args[0] || '').toLowerCase();
    const isNPX = cmd.endsWith('npx') || cmd.endsWith('npx.cmd');
    const isDLX = (cmd === 'yarn' || cmd.endsWith('yarn.cmd') || cmd === 'pnpm' || cmd.endsWith('pnpm.cmd')) && firstArg === 'dlx';
    if ((isNPX || isDLX) && (entry.startup_timeout_ms === undefined || entry.startup_timeout_ms < 60000)) {
      // Default to 60s if not explicitly set (Codex default is 10s)
      entry.startup_timeout_ms = 60000;
    }
    servers[config.mcpServerId] = entry;

    next.mcp_servers = servers;

    // Validate final shape before writing
    if (!this.validateToml(next, config)) {
      throw new Error('Generated Codex TOML configuration failed validation');
    }

    await FileOperations.ensureDirectory(dir);
    const serialized = TOML.stringify(next);
    await FileOperations.atomicWrite(path, serialized);

    // Post-write validation: re-read and parse
    try {
      const check = await fs.readFile(path, 'utf-8');
      TOML.parse(check);
    } catch (e) {
      // Attempt rollback if we had a backup
      if (backupPath) {
        try {
          await BackupManager.restoreBackup({ originalPath: path, backupPath, timestamp: new Date() });
        } catch {
          // If rollback also fails, surface original error
        }
      }
      throw new Error('Failed to write valid TOML configuration for Codex');
    }

    return backupPath;
  }

  async remove(removal: RemovalConfig, backup: boolean = true): Promise<string | undefined> {
    if (!this.configPath) this.configPath = this.getDefaultConfigPath(removal.configDir);
    if (!this.configPath) throw new Error('Unable to determine Codex configuration path');
    const fs = await import('fs/promises');
    const path = this.configPath;

    if (!(await FileOperations.fileExists(path))) {
      throw new Error(`Configuration file not found: ${path}`);
    }

    const raw = await fs.readFile(path, 'utf-8');
    let current: CodexTomlConfig = {};
    if (raw && raw.trim().length > 0) {
      try { current = TOML.parse(raw); } catch (e) { throw new Error('Invalid TOML in Codex configuration'); }
    }
    if (!current.mcp_servers || !(removal.mcpServerId in current.mcp_servers)) {
      throw new Error(`MCP server '${removal.mcpServerId}' not found`);
    }

    let backupPath: string | undefined;
    if (backup) {
      const info = await BackupManager.createBackup(path);
      backupPath = info.backupPath;
    }

    const { [removal.mcpServerId]: _removed, ...rest } = current.mcp_servers;
    const next: CodexTomlConfig = { ...current, mcp_servers: rest };

    // Write back
    const serialized = TOML.stringify(next);
    await FileOperations.atomicWrite(path, serialized);
    return backupPath;
  }

  async listMCPServers(configDir?: string): Promise<string[]> {
    const p = configDir ? this.getDefaultConfigPath(configDir) : this.configPath;
    if (!p) return [];
    const fs = await import('fs/promises');
    try {
      if (!(await FileOperations.fileExists(p))) return [];
      const raw = await fs.readFile(p, 'utf-8');
      if (!raw || raw.trim().length === 0) return [];
      const parsed: CodexTomlConfig = TOML.parse(raw);
      return parsed.mcp_servers ? Object.keys(parsed.mcp_servers) : [];
    } catch {
      return [];
    }
  }

  async hasMCPServer(serverId: string, configDir?: string): Promise<boolean> {
    const ids = await this.listMCPServers(configDir);
    return ids.includes(serverId);
  }

  // Lightweight self-check validator
  private validateToml(cfg: CodexTomlConfig, expected?: AgentConfig): boolean {
    try {
      if (cfg.mcp_servers && typeof cfg.mcp_servers === 'object') {
        for (const [name, entry] of Object.entries(cfg.mcp_servers)) {
          if (!name || typeof entry !== 'object' || entry === null) return false;
          if (entry.command !== undefined && typeof entry.command !== 'string') return false;
          if (entry.args !== undefined && !Array.isArray(entry.args)) return false;
          if (entry.env !== undefined && typeof entry.env !== 'object') return false;
          if (entry.startup_timeout_ms !== undefined && typeof entry.startup_timeout_ms !== 'number') return false;
        }
      }
      if (expected) {
        const s = cfg.mcp_servers?.[expected.mcpServerId];
        if (!s) return false;
        if (expected.transport && expected.transport !== 'stdio') return false;
        if (expected.command && s.command !== expected.command) return false;
      }
      return true;
    } catch {
      return false;
    }
  }
}
