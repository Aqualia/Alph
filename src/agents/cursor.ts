import { dirname, join } from 'path';
import { AgentProvider, AgentConfig, RemovalConfig } from './provider';
import { CursorConfig } from '../types/config';
import { BackupInfo } from '../utils/backup';
import { FileOperations } from '../utils/fileOps';
import { BackupManager } from '../utils/backup';
import { SafeEditManager } from '../utils/safeEdit';
import { AgentDetector } from './detector';
import { resolveConfigPath } from '../catalog/adapter';

/**
 * Cursor IDE provider for configuring Cursor's MCP server settings
 * 
 * This provider handles detection and configuration of Cursor IDE,
 * which stores its configuration in platform-specific locations:
 * - Windows: %APPDATA%\Cursor\User\settings.json
 * - macOS: ~/Library/Application Support/Cursor/User/settings.json
 * - Linux: ~/.config/Cursor/User/settings.json
 */
export class CursorProvider implements AgentProvider {
  public readonly name = 'Cursor';
  
  private configPath: string | null = null;
  private lastBackup: BackupInfo | null = null;

  /**
   * Creates a new Cursor provider instance
   */
  constructor() {
    // Initialize with default config path for current platform
    this.configPath = this.getDefaultConfigPath();
  }

  /**
   * Gets the default configuration path for Cursor based on the current platform
   * @param configDir - Optional custom configuration directory
   * @returns Default path to Cursor settings.json
   */
  protected getDefaultConfigPath(configDir?: string): string {
    if (configDir && configDir.trim()) {
      return resolveConfigPath('cursor', 'project', configDir) || join(configDir, '.cursor', 'mcp.json');
    }
    return resolveConfigPath('cursor', 'user') || AgentDetector.getDefaultConfigPath('cursor');
  }

  /**
   * Gets alternative configuration paths to check for Cursor installation
   * @returns Array of possible configuration paths, with ~/.cursor/mcp.json as the primary location
   */
  protected getAlternativeConfigPaths(): string[] {
    const home = require('os').homedir();
    const primaryPath = require('path').join(home, '.cursor', 'mcp.json');
    const otherPaths = AgentDetector.getDetectionCandidates('cursor').filter(p => p !== primaryPath);
    return [primaryPath, ...otherPaths];
  }

  /**
   * Determines if a given path points to a legacy settings.json-based location
   * rather than the preferred ~/.cursor/mcp.json file.
   */
  private isLegacySettingsPath(p: string | null | undefined): boolean {
    if (!p) return false;
    return /(^|[/\\])settings\.json$/i.test(p);
  }

  /**
   * Detects if Cursor IDE is installed and configured on the system
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
      throw new Error(`Failed to detect Cursor IDE: ${error}`);
    }
  }

  /**
   * Returns the active config path by scanning candidates and env overrides.
   * @param configDir - Optional custom configuration directory
   */
  async getActiveConfigPath(configDir?: string): Promise<string | null> {
    const p = await AgentDetector.detectActiveConfigPath('cursor', configDir);
    this.configPath = p;
    return p;
  }

  /**
   * Configures the detected Cursor IDE with the provided MCP server settings
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
    // Determine target config path. If a project-specific configDir is provided,
    // always use it to honor the user's choice, regardless of existing global configs.
    if (config.configDir && config.configDir.trim()) {
      this.configPath = this.getDefaultConfigPath(config.configDir);
    } else if (!this.configPath) {
      const detectedPath = await this.detect();
      this.configPath = detectedPath || this.getDefaultConfigPath();
    }

    // If no explicit configDir is provided, prefer the official ~/.cursor/mcp.json file
    // even if a legacy settings.json was detected. We do not migrate existing data here.
    if (!config.configDir || !config.configDir.trim()) {
      const preferredPath = this.getDefaultConfigPath();
      if (this.isLegacySettingsPath(this.configPath) && this.configPath !== preferredPath) {
        this.configPath = preferredPath;
      }
    }

    if (!this.configPath) {
      throw new Error('Unable to determine Cursor configuration path');
    }

    try {
      // Ensure the directory exists before attempting to write
      await FileOperations.ensureDirectory(dirname(this.configPath));
      
      // Use safe edit manager to perform the configuration update
      const result = await SafeEditManager.safeEdit<CursorConfig>(
        this.configPath,
        (cursorConfig) => this.injectMCPServerConfig(cursorConfig, config),
        {
          validator: (modifiedConfig) => this.validateCursorConfig(modifiedConfig, config),
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
      throw new Error(`Failed to configure Cursor IDE: ${error}`);
    }
  }

  /**
   * Validates the current Cursor configuration
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
      const config = await FileOperations.readJsonFile<CursorConfig>(this.configPath);
      
      // Basic structure validation
      return this.validateCursorConfig(config);

    } catch (error) {
      // Any error during validation means the configuration is invalid
      return false;
    }
  }

  /**
   * Removes an MCP server configuration from the detected Cursor IDE
   * 
   * This method implements the safe edit lifecycle:
   * 1. Create backup of existing configuration
   * 2. Parse current configuration safely
   * 3. Remove the specified MCP server settings
   * 4. Write updated configuration atomically
   * 5. Validate the new configuration
   * 
   * @param config - The MCP server removal configuration
   * @param backup - Whether to create a backup of the existing configuration
   * @returns Promise resolving to the backup file path if backup was created, undefined otherwise
   * @throws Error if removal fails or server not found, backup should be preserved
   */
  async remove(config: RemovalConfig, backup: boolean = true): Promise<string | undefined> {
    // Ensure we have a valid configuration path
    if (!this.configPath) {
      const detectedPath = await this.detect(config.configDir);
      if (!detectedPath) {
        throw new Error('Cursor IDE configuration not found');
      }
    }

    if (!this.configPath) {
      throw new Error('Unable to determine Cursor configuration path');
    }

    try {
      // Check if configuration file exists
      if (!(await FileOperations.fileExists(this.configPath))) {
        throw new Error(`Configuration file not found: ${this.configPath}`);
      }

      // Use safe edit manager to perform the removal
      const result = await SafeEditManager.safeEdit<CursorConfig>(
        this.configPath,
        (cursorConfig) => this.removeMCPServerConfig(cursorConfig, config),
        {
          validator: (modifiedConfig) => this.validateCursorConfig(modifiedConfig),
          createBackup: backup,
          autoRollback: true
        }
      );

      if (!result.success) {
        throw result.error || new Error('Configuration removal failed');
      }

      // Store backup info for potential rollback
      this.lastBackup = result.backupInfo || null;
      
      // Return backup path if backup was created
      return backup && result.backupInfo ? result.backupInfo.backupPath : undefined;

    } catch (error) {
      throw new Error(`Failed to remove MCP server from Cursor IDE: ${error}`);
    }
  }

  /**
   * Lists all MCP server configurations present in the Cursor IDE configuration
   * 
   * @param configDir - Optional custom configuration directory
   * @returns Promise resolving to an array of MCP server IDs, empty array if none found
   * @throws Error if reading configuration fails
   */
  async listMCPServers(configDir?: string): Promise<string[]> {
    try {
      // Get the active config path
      const configPath = configDir ? this.getDefaultConfigPath(configDir) : this.configPath;
      
      if (!configPath || !(await FileOperations.fileExists(configPath))) {
        return [];
      }

      // Read and parse the configuration
      const config = await FileOperations.readJsonFile<CursorConfig>(configPath);
      
      // Return the list of MCP server IDs
      if (!config.mcpServers || typeof config.mcpServers !== 'object') {
        return [];
      }

      return Object.keys(config.mcpServers);
    } catch (error) {
      throw new Error(`Failed to list MCP servers from Cursor IDE: ${error}`);
    }
  }

  /**
   * Checks if a specific MCP server configuration exists in the Cursor IDE
   * 
   * @param serverId - The MCP server ID to check for
   * @param configDir - Optional custom configuration directory
   * @returns Promise resolving to true if the server exists, false otherwise
   * @throws Error if reading configuration fails
   */
  async hasMCPServer(serverId: string, configDir?: string): Promise<boolean> {
    try {
      const servers = await this.listMCPServers(configDir);
      return servers.includes(serverId);
    } catch (error) {
      throw new Error(`Failed to check MCP server in Cursor IDE: ${error}`);
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
      throw new Error(`Failed to rollback Cursor configuration: ${error}`);
    }
  }

  /**
   * Injects MCP server configuration into the Cursor configuration
   * @param cursorConfig - Current Cursor configuration
   * @param config - MCP server configuration to inject
   * @returns Modified Cursor configuration
   */
  private async injectMCPServerConfig(cursorConfig: CursorConfig, config: AgentConfig): Promise<CursorConfig> {
    // Create a copy of the configuration to avoid mutations
    const modifiedConfig: CursorConfig = { ...cursorConfig };

    // Initialize mcpServers section if it doesn't exist
    if (!modifiedConfig.mcpServers) {
      modifiedConfig.mcpServers = {};
    }

    // Render protocol-aware shape and inject
    const { renderMcpServer } = await import('../renderers/mcp.js');
    const input: any = {
      agent: 'cursor',
      serverId: config.mcpServerId,
      transport: (config.transport as any) || 'http',
      headers: config.headers,
      command: config.command,
      args: config.args,
      env: config.env
    };
    if (config.mcpServerUrl) input.url = config.mcpServerUrl;
    const rendered = renderMcpServer(input);
    const serverEntry = (rendered as any)['mcpServers'][config.mcpServerId];
    modifiedConfig.mcpServers[config.mcpServerId] = serverEntry as any;

    return modifiedConfig;
  }

  /**
   * Removes MCP server configuration from the Cursor configuration
   * @param cursorConfig - Current Cursor configuration
   * @param config - MCP server removal configuration
   * @returns Modified Cursor configuration
   * @throws Error if the server is not found
   */
  private removeMCPServerConfig(cursorConfig: CursorConfig, config: RemovalConfig): CursorConfig {
    // Create a copy of the configuration to avoid mutations
    const modifiedConfig: CursorConfig = { ...cursorConfig };

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
   * Validates a Cursor configuration structure
   * @param config - Configuration to validate
   * @param expectedMCPConfig - Optional expected MCP configuration for validation
   * @returns True if configuration is valid, false otherwise
   */
  private validateCursorConfig(config: CursorConfig, expectedMCPConfig?: AgentConfig): boolean {
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

          // Validate URL fields
          if (serverConfig.url && typeof serverConfig.url !== 'string') {
            return false;
          }

          if (serverConfig.httpUrl && typeof serverConfig.httpUrl !== 'string') {
            return false;
          }

          // Validate optional fields
          if (serverConfig.headers && typeof serverConfig.headers !== 'object') {
            return false;
          }

          if (serverConfig.transport && !['http', 'sse', 'stdio'].includes(serverConfig.transport)) {
            return false;
          }

          // For stdio transport, command must be a non-empty string when present
          if (serverConfig.transport === 'stdio') {
            if (!serverConfig.command || typeof serverConfig.command !== 'string') {
              return false;
            }
            if (serverConfig.args && !Array.isArray(serverConfig.args)) {
              return false;
            }
          }

          if (serverConfig.disabled !== undefined && typeof serverConfig.disabled !== 'boolean') {
            return false;
          }

          if (serverConfig.autoApprove && !Array.isArray(serverConfig.autoApprove)) {
            return false;
          }
        }

        // If we have expected MCP config, validate it exists and is correct
        if (expectedMCPConfig) {
          const serverConfig = config.mcpServers[expectedMCPConfig.mcpServerId];
          if (!serverConfig) {
            return false;
          }

          // Validate based on expected transport
          if (expectedMCPConfig.transport === 'stdio') {
            // Require stdio transport and matching command when provided
            if (serverConfig.transport !== 'stdio') {
              return false;
            }
            if (expectedMCPConfig.command && serverConfig.command !== expectedMCPConfig.command) {
              return false;
            }
          } else {
            // http/sse: URL should match when provided
            if (expectedMCPConfig.mcpServerUrl &&
                serverConfig.url !== expectedMCPConfig.mcpServerUrl && 
                serverConfig.httpUrl !== expectedMCPConfig.mcpServerUrl) {
              return false;
            }
          // Determine effective transport: prefer explicit transport, then 'type', then infer
          const effectiveTransport = (serverConfig.transport as any)
            || ((serverConfig as any).type as any)
            || (serverConfig.command ? 'stdio' : (serverConfig.httpUrl || serverConfig.url ? 'http' : undefined));
          if (expectedMCPConfig.transport && effectiveTransport !== expectedMCPConfig.transport) {
            return false;
          }
          }
        }
      }

      return true;
    } catch (error) {
      return false;
    }
  }
}
