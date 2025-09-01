import { dirname, join } from 'path';
import { AgentProvider, AgentConfig, RemovalConfig } from './provider';
import { ClaudeConfig } from '../types/config';
import { BackupInfo } from '../utils/backup';
import { FileOperations } from '../utils/fileOps';
import { BackupManager } from '../utils/backup';
import { SafeEditManager } from '../utils/safeEdit';
import { AgentDetector } from './detector';

/**
 * Claude Code provider for configuring Claude Code's MCP server settings
 * 
 * This provider handles detection and configuration of Claude Code,
 * which stores its MCP configuration in platform-specific locations:
 * - Windows: %APPDATA%\Claude\mcp.json
 * - macOS: ~/Library/Application Support/Claude/mcp.json
 * - Linux: ~/.config/claude/mcp.json
 */
export class ClaudeProvider implements AgentProvider {
  public readonly name = 'Claude Code';
  
  private configPath: string | null = null;
  private lastBackup: BackupInfo | null = null;

  /**
   * Creates a new Claude provider instance
   */
  constructor() {
    // Initialize with default config path for current platform
    this.configPath = this.getDefaultConfigPath();
  }

  /**
   * Gets the default configuration path for Claude Code based on the current platform
   * @param configDir - Optional custom configuration directory
   * @returns Default path to Claude mcp.json
   */
  protected getDefaultConfigPath(configDir?: string): string {
    if (configDir) {
      return join(configDir, '.claude', 'mcp.json');
    }
    return AgentDetector.getDefaultConfigPath('claude');
  }

  /**
   * Gets alternative configuration paths to check for Claude Code installation
   * @returns Array of possible configuration paths
   */
  protected getAlternativeConfigPaths(): string[] {
    return AgentDetector.getDetectionCandidates('claude');
  }

  /**
   * Detects if Claude Code is installed and configured on the system
   * 
   * @param configDir - Optional custom configuration directory
   * @returns Promise resolving to the configuration file path if detected, null if not found
   * @throws Error if detection fails due to permission or system issues
   */
  async detect(configDir?: string): Promise<string | null> {
    try {
      // If custom config directory is provided, check it first
      if (configDir) {
        const customPath = this.getDefaultConfigPath(configDir);
        try {
          if (await FileOperations.fileExists(customPath) && await FileOperations.isReadable(customPath)) {
            // Validate it is JSON
            await FileOperations.readJsonFile<unknown>(customPath);
            this.configPath = customPath;
            return customPath;
          }
        } catch (err) {
          // If custom path is invalid, continue with normal detection
        }
      }
      
      const possiblePaths = this.getAlternativeConfigPaths();
      // If any candidate exists but is not readable, throw (tests expect this behavior)
      for (const p of possiblePaths) {
        try {
          if (await FileOperations.fileExists(p)) {
            const readable = await FileOperations.isReadable(p);
            if (!readable) {
              throw new Error(`Configuration file exists but is not readable: ${p}`);
            }
          }
        } catch (innerErr) {
          if (innerErr instanceof Error) throw innerErr;
          throw new Error(String(innerErr));
        }
      }
      const detectedPath = await AgentDetector.detectConfigFile(possiblePaths);
      this.configPath = detectedPath;
      return detectedPath;
    } catch (error) {
      if (error instanceof Error) {
        throw error;
      }
      throw new Error(`Failed to detect Claude Code: ${error}`);
    }
  }

  /**
   * Returns the active config path by scanning candidates and env overrides.
   * @param configDir - Optional custom configuration directory
   */
  async getActiveConfigPath(configDir?: string): Promise<string | null> {
    const p = await AgentDetector.detectActiveConfigPath('claude', configDir);
    this.configPath = p;
    return p;
  }

  /**
   * Configures the detected Claude Code with the provided MCP server settings
   * 
   * This method implements the safe edit lifecycle:
   * 1. Create backup of existing configuration
   * 2. Parse current configuration safely
   * 3. Inject new MCP server settings
   * 4. Write updated configuration atomically
   * 5. Validate the new configuration
   * 
   * @param config - The MCP server configuration to apply
   * @param backup - Whether to create a backup of the existing configuration
   * @returns Promise resolving to the backup file path if backup was created, undefined otherwise
   * @throws Error if configuration fails, backup should be preserved
   */
  async configure(config: AgentConfig, backup: boolean = true): Promise<string | undefined> {
    // Ensure we have a valid configuration path
    if (!this.configPath) {
      const detectedPath = await this.detect(config.configDir);
      if (!detectedPath) {
        // Create new configuration file if it doesn't exist
        this.configPath = this.getDefaultConfigPath(config.configDir);
      }
    }

    if (!this.configPath) {
      throw new Error('Unable to determine Claude Code configuration path');
    }

    try {
      // Ensure the directory exists before attempting to write
      await FileOperations.ensureDirectory(dirname(this.configPath));
      
      // Use safe edit manager to perform the configuration update
      const result = await SafeEditManager.safeEdit<ClaudeConfig>(
        this.configPath,
        (claudeConfig) => this.injectMCPServerConfig(claudeConfig, config),
        {
          validator: (modifiedConfig) => this.validateClaudeConfig(modifiedConfig, config),
          createBackup: backup,
          autoRollback: true
        }
      );

      if (!result.success) {
        throw result.error || new Error('Configuration update failed');
      }

      // Store backup info for potential rollback
      this.lastBackup = result.backupInfo || null;
      
      // Return backup path if backup was created
      return backup && result.backupInfo ? result.backupInfo.backupPath : undefined;

    } catch (error) {
      throw new Error(`Failed to configure Claude Code: ${error}`);
    }
  }

  /**
   * Validates the current Claude Code configuration
   * 
   * Verifies:
   * - Configuration file exists and is readable
   * - JSON structure is valid
   * - MCP server configuration is present and correctly formatted
   * 
   * @returns Promise resolving to true if configuration is valid, false otherwise
   */
  async validate(): Promise<boolean> {
    try {
      if (!this.configPath) {
        return false;
      }

      // Check if file exists and is readable
      if (!(await FileOperations.fileExists(this.configPath))) {
        return false;
      }

      if (!(await FileOperations.isReadable(this.configPath))) {
        return false;
      }

      // Try to parse the configuration
      const config = await FileOperations.readJsonFile<ClaudeConfig>(this.configPath);
      
      // Basic structure validation
      return this.validateClaudeConfig(config);

    } catch (error) {
      // Any error during validation means the configuration is invalid
      return false;
    }
  }

  /**
   * Removes an MCP server configuration from the detected Claude Code
   */
  async remove(config: RemovalConfig, backup: boolean = true): Promise<string | undefined> {
    if (!this.configPath) {
      const detectedPath = await this.detect(config.configDir);
      if (!detectedPath) {
        throw new Error('Claude Code configuration not found');
      }
    }

    if (!this.configPath) {
      throw new Error('Unable to determine Claude Code configuration path');
    }

    try {
      if (!(await FileOperations.fileExists(this.configPath))) {
        throw new Error(`Configuration file not found: ${this.configPath}`);
      }

      const result = await SafeEditManager.safeEdit<ClaudeConfig>(
        this.configPath,
        (claudeConfig) => this.removeMCPServerConfig(claudeConfig, config),
        {
          validator: (modifiedConfig) => this.validateClaudeConfig(modifiedConfig),
          createBackup: backup,
          autoRollback: true
        }
      );

      if (!result.success) {
        throw result.error || new Error('Configuration removal failed');
      }

      this.lastBackup = result.backupInfo || null;
      return backup && result.backupInfo ? result.backupInfo.backupPath : undefined;

    } catch (error) {
      throw new Error(`Failed to remove MCP server from Claude Code: ${error}`);
    }
  }

  /**
   * Lists all MCP server configurations present in Claude Code
   */
  async listMCPServers(configDir?: string): Promise<string[]> {
    try {
      const configPath = configDir ? this.getDefaultConfigPath(configDir) : this.configPath;
      
      if (!configPath || !(await FileOperations.fileExists(configPath))) {
        return [];
      }

      const config = await FileOperations.readJsonFile<ClaudeConfig>(configPath);
      
      if (!config.mcpServers || typeof config.mcpServers !== 'object') {
        return [];
      }

      return Object.keys(config.mcpServers);
    } catch (error) {
      throw new Error(`Failed to list MCP servers from Claude Code: ${error}`);
    }
  }

  /**
   * Checks if a specific MCP server configuration exists in Claude Code
   */
  async hasMCPServer(serverId: string, configDir?: string): Promise<boolean> {
    try {
      const servers = await this.listMCPServers(configDir);
      return servers.includes(serverId);
    } catch (error) {
      throw new Error(`Failed to check MCP server in Claude Code: ${error}`);
    }
  }

  /**
   * Rolls back to the most recent backup
   * 
   * This method:
   * - Locates the most recent backup file
   * - Restores the backup to the original location
   * - Verifies the restoration was successful
   * 
   * @returns Promise resolving to the backup file path that was restored, null if no backup found
   * @throws Error if rollback fails
   */
  async rollback(): Promise<string | null> {
    try {
      if (!this.lastBackup) {
        // Try to find the most recent backup
        if (!this.configPath) {
          return null;
        }

        try {
          const backups = await BackupManager.listBackups(this.configPath);
          if (backups.length === 0) {
            return null;
          }
          this.lastBackup = backups[0] || null; // Most recent backup
        } catch (error) {
          // If we can't list backups (e.g., directory doesn't exist), no backups exist
          return null;
        }
      }

      // Restore the backup
      if (!this.lastBackup) {
        return null;
      }
      
      await BackupManager.restoreBackup(this.lastBackup);
      
      // Verify the restoration was successful
      if (await this.validate()) {
        const restoredBackupPath = this.lastBackup.backupPath;
        this.lastBackup = null; // Clear the backup reference
        return restoredBackupPath;
      } else {
        throw new Error('Backup restoration verification failed');
      }

    } catch (error) {
      throw new Error(`Failed to rollback Claude Code configuration: ${error}`);
    }
  }

  /**
   * Injects MCP server configuration into the Claude Code configuration
   * @param claudeConfig - Current Claude Code configuration
   * @param config - MCP server configuration to inject
   * @returns Modified Claude Code configuration
   */
  private injectMCPServerConfig(claudeConfig: ClaudeConfig, config: AgentConfig): ClaudeConfig {
    // Create a copy of the configuration to avoid mutations
    const modifiedConfig: ClaudeConfig = { ...claudeConfig };

    // Initialize mcpServers section if it doesn't exist
    if (!modifiedConfig.mcpServers) {
      modifiedConfig.mcpServers = {};
    }

    // Create the MCP server configuration for Claude Code format
    const serverConfig: Exclude<ClaudeConfig['mcpServers'], undefined>[string] = {};

    // Handle different transport types
    if (config.transport === 'stdio' || config.command) {
      // Command-based MCP server
      if (config.command) {
        serverConfig.command = config.command;
      }
      if (config.args && config.args.length > 0) {
        serverConfig.args = config.args;
      }
      if (config.env && Object.keys(config.env).length > 0) {
        serverConfig.env = config.env;
      }
    } else {
      // HTTP-based MCP server
      if (config.mcpServerUrl) {
        serverConfig.url = config.mcpServerUrl;
      }
      if (config.headers && Object.keys(config.headers).length > 0) {
        serverConfig.headers = config.headers;
      }
      if (config.mcpAccessKey) {
        if (!serverConfig.headers) {
          serverConfig.headers = {};
        }
        serverConfig.headers['Authorization'] = `Bearer ${config.mcpAccessKey}`;
      }
    }

    // Set transport if specified
    if (config.transport) {
      serverConfig.transport = config.transport;
    }

    // Set disabled state
    serverConfig.disabled = false;

    // Inject the server configuration
    modifiedConfig.mcpServers[config.mcpServerId] = serverConfig;

    return modifiedConfig;
  }

  /**
   * Removes MCP server configuration from the Claude Code configuration
   * @param claudeConfig - Current Claude Code configuration
   * @param config - MCP server removal configuration
   * @returns Modified Claude Code configuration
   * @throws Error if the server is not found
   */
  private removeMCPServerConfig(claudeConfig: ClaudeConfig, config: RemovalConfig): ClaudeConfig {
    // Create a copy of the configuration to avoid mutations
    const modifiedConfig: ClaudeConfig = { ...claudeConfig };

    // Check if mcpServers section exists
    if (!modifiedConfig.mcpServers || typeof modifiedConfig.mcpServers !== 'object') {
      throw new Error(`MCP server '${config.mcpServerId}' not found - no MCP servers configured`);
    }

    // Check if the specific server exists
    if (!(config.mcpServerId in modifiedConfig.mcpServers)) {
      throw new Error(`MCP server '${config.mcpServerId}' not found`);
    }

    // Create a new mcpServers object without the specified server
    const { [config.mcpServerId]: removedServer, ...remainingServers } = modifiedConfig.mcpServers;
    modifiedConfig.mcpServers = remainingServers;

    return modifiedConfig;
  }

  /**
   * Validates a Claude Code configuration structure
   * @param config - Configuration to validate
   * @param expectedMCPConfig - Optional expected MCP configuration for validation
   * @returns True if configuration is valid, false otherwise
   */
  private validateClaudeConfig(config: ClaudeConfig, expectedMCPConfig?: AgentConfig): boolean {
    try {
      // Basic structure validation
      if (typeof config !== 'object' || config === null) {
        return false;
      }

      // If mcpServers exists, validate its structure
      if (config.mcpServers) {
        if (typeof config.mcpServers !== 'object' || config.mcpServers === null) {
          return false;
        }

        // Validate each MCP server configuration
        for (const [, serverConfig] of Object.entries(config.mcpServers)) {
          if (typeof serverConfig !== 'object' || serverConfig === null) {
            return false;
          }

          // Validate command fields for stdio transport
          if (serverConfig.command && typeof serverConfig.command !== 'string') {
            return false;
          }

          if (serverConfig.args && !Array.isArray(serverConfig.args)) {
            return false;
          }

          if (serverConfig.env && typeof serverConfig.env !== 'object') {
            return false;
          }

          // Validate URL field for HTTP transport
          if (serverConfig.url && typeof serverConfig.url !== 'string') {
            return false;
          }

          // Validate optional fields
          if (serverConfig.headers && typeof serverConfig.headers !== 'object') {
            return false;
          }

          if (serverConfig.transport && !['http', 'sse', 'stdio'].includes(serverConfig.transport)) {
            return false;
          }

          if (serverConfig.disabled !== undefined && typeof serverConfig.disabled !== 'boolean') {
            return false;
          }
        }

        // If we have expected MCP config, validate it exists and is correct
        if (expectedMCPConfig) {
          const serverConfig = config.mcpServers[expectedMCPConfig.mcpServerId];
          if (!serverConfig) {
            return false;
          }

          // Validate based on transport type
          if (expectedMCPConfig.transport === 'stdio' || expectedMCPConfig.command) {
            // For stdio transport, validate command
            if (expectedMCPConfig.command && serverConfig.command !== expectedMCPConfig.command) {
              return false;
            }
          } else {
            // For HTTP transport, validate URL
            if (expectedMCPConfig.mcpServerUrl && serverConfig.url !== expectedMCPConfig.mcpServerUrl) {
              return false;
            }
          }

          // Validate transport if specified
          if (expectedMCPConfig.transport && serverConfig.transport !== expectedMCPConfig.transport) {
            return false;
          }
        }
      }

      return true;
    } catch (error) {
      return false;
    }
  }
}