import { join } from 'path';
import { AgentProvider, AgentConfig, RemovalConfig } from './provider';
import { GeminiConfig } from '../types/config';
import { BackupInfo } from '../utils/backup';
import { FileOperations } from '../utils/fileOps';
import { BackupManager } from '../utils/backup';
import { SafeEditManager } from '../utils/safeEdit';
import { AgentDetector } from './detector';
import { resolveConfigPath } from '../catalog/adapter';
import { ui } from '../utils/ui';

/**
 * Gemini CLI provider for configuring Google's Gemini CLI tool
 * 
 * This provider handles detection and configuration of the Gemini CLI tool,
 * which stores its configuration in ~/.gemini/settings.json
 */
export class GeminiProvider implements AgentProvider {
  public readonly name = 'Gemini CLI';
  
  private configPath: string | null = null;
  private lastBackup: BackupInfo | null = null;
  private lastValidationReason: string | null = null;

  /**
   * Creates a new Gemini provider instance
   */
  constructor() {
    // Initialize with default config path
    this.configPath = this.getDefaultConfigPath();
  }

  /**
   * Gets the default configuration path for Gemini CLI
   * @returns Default path to Gemini settings.json
   */
  protected getDefaultConfigPath(configDir?: string): string {
    // Prefer explicit env override when set
    const envOverride = AgentDetector.getEnvOverridePath('gemini');
    if (envOverride) return envOverride;
    // Prefer catalog-derived path
    if (configDir && configDir.trim()) {
      return resolveConfigPath('gemini', 'project', configDir) || join(configDir, '.gemini', 'settings.json');
    }
    return resolveConfigPath('gemini', 'user') || AgentDetector.getDefaultConfigPath('gemini');
  }

  /**
   * Gets alternative configuration paths to check for Gemini CLI installation
   * @returns Array of possible configuration paths
   */
  protected getAlternativeConfigPaths(): string[] {
    return AgentDetector.getDetectionCandidates('gemini');
  }

  /**
   * Detects if Gemini CLI is installed and configured on the system
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
      
      // First try to detect existing config file
      const detectedPath = await AgentDetector.detectConfigFile(possiblePaths);
      if (detectedPath) {
        this.configPath = detectedPath;
        return detectedPath;
      }
      
      // If no config file exists, check if gemini command is available
      // This allows detection of installed but unconfigured Gemini CLI
      try {
        const { execSync } = require('child_process');
        execSync('which gemini', { stdio: 'ignore' });
        // If gemini command exists, return default config path
        // The config file will be created when configured
        const defaultPath = this.getDefaultConfigPath(configDir);
        this.configPath = defaultPath;
        return defaultPath;
      } catch (commandError) {
        // Gemini command not found
        this.configPath = null;
        return null;
      }
    } catch (error) {
      if (error instanceof Error) {
        throw error;
      }
      throw new Error(`Failed to detect Gemini CLI: ${error}`);
    }
  }

  /**
   * Returns the active config path by scanning candidates and env overrides.
   * @param configDir - Optional custom configuration directory
   */
  async getActiveConfigPath(configDir?: string): Promise<string | null> {
    const p = await AgentDetector.detectActiveConfigPath('gemini', configDir);
    this.configPath = p;
    return p;
  }

  /**
   * Configures the detected Gemini CLI with the provided MCP server settings
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

    if (!this.configPath) {
      throw new Error('Unable to determine Gemini configuration path');
    }

    try {
      // Ensure the directory exists and is accessible before attempting to write
      await AgentDetector.ensureConfigDirectory(this.configPath);
      
      // Use safe edit manager to perform the configuration update
      const result = await SafeEditManager.safeEdit<GeminiConfig>(
        this.configPath,
        (geminiConfig) => this.injectMCPServerConfig(geminiConfig, config),
        {
          validator: (modifiedConfig) => this.validateGeminiConfig(modifiedConfig, config),
          createBackup: backup,
          autoRollback: true
        }
      );

      if (!result.success) {
        const reason = this.lastValidationReason ? `: ${this.lastValidationReason}` : '';
        if (result.error) {
          throw new Error((result.error.message || String(result.error)) + reason);
        }
        throw new Error('Configuration update failed' + reason);
      }

      // Store backup info for potential rollback
      this.lastBackup = result.backupInfo || null;
      
      // Return backup path if backup was created
      return backup && result.backupInfo ? result.backupInfo.backupPath : undefined;

    } catch (error) {
      throw new Error(`Failed to configure Gemini CLI: ${error}`);
    }
  }

  /**
   * Validates the current Gemini configuration
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
      const config = await FileOperations.readJsonFile<GeminiConfig>(this.configPath);
      
      // Basic structure validation
      return this.validateGeminiConfig(config);

    } catch (error) {
      // Any error during validation means the configuration is invalid
      return false;
    }
  }

  /**
   * Removes an MCP server configuration from the detected Gemini CLI
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
        throw new Error('Gemini CLI configuration not found');
      }
    }

    if (!this.configPath) {
      throw new Error('Unable to determine Gemini configuration path');
    }

    try {
      // Check if configuration file exists
      if (!(await FileOperations.fileExists(this.configPath))) {
        throw new Error(`Configuration file not found: ${this.configPath}`);
      }

      // Use safe edit manager to perform the removal
      const result = await SafeEditManager.safeEdit<GeminiConfig>(
        this.configPath,
        (geminiConfig) => this.removeMCPServerConfig(geminiConfig, config),
        {
          validator: (modifiedConfig) => this.validateGeminiConfig(modifiedConfig),
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
      throw new Error(`Failed to remove MCP server from Gemini CLI: ${error}`);
    }
  }

  /**
   * Lists all MCP server configurations present in the Gemini CLI configuration
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
      const config = await FileOperations.readJsonFile<GeminiConfig>(configPath);
      
      // Return the list of MCP server IDs
      if (!config.mcpServers || typeof config.mcpServers !== 'object') {
        return [];
      }

      return Object.keys(config.mcpServers);
    } catch (error) {
      throw new Error(`Failed to list MCP servers from Gemini CLI: ${error}`);
    }
  }

  /**
   * Checks if a specific MCP server configuration exists in the Gemini CLI
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
      throw new Error(`Failed to check MCP server in Gemini CLI: ${error}`);
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
      throw new Error(`Failed to rollback Gemini configuration: ${error}`);
    }
  }

  /**
   * Injects MCP server configuration into the Gemini configuration
   * @param geminiConfig - Current Gemini configuration
   * @param config - MCP server configuration to inject
   * @returns Modified Gemini configuration
   */
  private async injectMCPServerConfig(geminiConfig: GeminiConfig, config: AgentConfig): Promise<GeminiConfig> {
    const modifiedConfig: GeminiConfig = { ...geminiConfig };
    if (!modifiedConfig.mcpServers) modifiedConfig.mcpServers = {};
    const { renderMcpServer } = await import('../renderers/mcp.js');
    const input: any = {
      agent: 'gemini',
      serverId: config.mcpServerId,
      transport: (config.transport as any) || 'http',
      headers: config.headers,
      command: config.command,
      args: config.args,
      cwd: config.cwd,
      env: config.env,
      timeout: config.timeout
    };
    if (config.mcpServerUrl) input.url = config.mcpServerUrl;
    const rendered = renderMcpServer(input);
    const serverEntry = (rendered as any)['mcpServers'][config.mcpServerId];
    modifiedConfig.mcpServers[config.mcpServerId] = serverEntry as any;
    return modifiedConfig;
  }

  /**
   * Removes MCP server configuration from the Gemini configuration
   * @param geminiConfig - Current Gemini configuration
   * @param config - MCP server removal configuration
   * @returns Modified Gemini configuration
   * @throws Error if the server is not found
   */
  private removeMCPServerConfig(geminiConfig: GeminiConfig, config: RemovalConfig): GeminiConfig {
    // Create a copy of the configuration to avoid mutations
    const modifiedConfig: GeminiConfig = { ...geminiConfig };

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
   * Validates a Gemini configuration structure
   * @param config - Configuration to validate
   * @param expectedMCPConfig - Optional expected MCP configuration for validation
   * @returns True if configuration is valid, false otherwise
   */
  private validateGeminiConfig(config: GeminiConfig, expectedMCPConfig?: AgentConfig): boolean {
    try {
      const DBG = process?.env?.['ALPH_DEBUG_GEMINI'] === '1';
      const log = (reason: string, extra?: unknown) => {
        if (DBG) {
          try {
            ui.debug(`[Gemini.validate] ${reason}` + (extra !== undefined ? ` :: ${JSON.stringify(extra)}` : ''));
          } catch {
            // noop
          }
        }
      };
      const fail = (reason: string, extra?: unknown) => {
        try {
          this.lastValidationReason = extra !== undefined ? `${reason} ${JSON.stringify(extra)}` : reason;
        } catch {
          this.lastValidationReason = reason;
        }
        log(reason, extra);
        return false as const;
      };

      // Basic structure validation
      if (typeof config !== 'object' || config === null) {
        return fail('config is not an object or is null');
      }

      // If mcpServers exists, validate its structure
      if (config.mcpServers) {
        if (typeof config.mcpServers !== 'object' || config.mcpServers === null) {
          return fail('mcpServers is not an object');
        }

        // Validate each MCP server configuration
        for (const [serverId, serverConfig] of Object.entries(config.mcpServers)) {
          if (typeof serverConfig !== 'object' || serverConfig === null) {
            return fail('serverConfig is not an object', { serverId });
          }

          // Validate required fields for HTTP-based servers
          if (serverConfig.httpUrl && typeof serverConfig.httpUrl !== 'string') {
            return fail('httpUrl present but not a string', { serverId, httpUrl: serverConfig.httpUrl });
          }
          // Accept alternative http 'url' when transport explicitly set to http
          if ((serverConfig as any).transport === 'http') {
            const altUrl = (serverConfig as any).url;
            if (altUrl !== undefined && typeof altUrl !== 'string') {
              return fail('http transport with non-string url', { serverId, url: altUrl });
            }
          }

          // Validate SSE url if present
          if ((serverConfig as any).url && typeof (serverConfig as any).url !== 'string') {
            return fail('url present but not a string', { serverId, url: (serverConfig as any).url });
          }

          // Validate optional fields
          if (serverConfig.env && typeof serverConfig.env !== 'object') {
            return fail('env present but not an object', { serverId });
          }

          // Validate headers if present (support generic and transport-specific keys)
          if ((serverConfig as any).headers && typeof (serverConfig as any).headers !== 'object') {
            return fail('headers present but not an object', { serverId });
          }
          if ((serverConfig as any).httpHeaders && typeof (serverConfig as any).httpHeaders !== 'object') {
            return fail('httpHeaders present but not an object', { serverId });
          }
          if ((serverConfig as any).sseHeaders && typeof (serverConfig as any).sseHeaders !== 'object') {
            return fail('sseHeaders present but not an object', { serverId });
          }

          if (serverConfig.disabled !== undefined && typeof serverConfig.disabled !== 'boolean') {
            return fail('disabled present but not boolean', { serverId, disabled: serverConfig.disabled });
          }

          if (serverConfig.autoApprove && !Array.isArray(serverConfig.autoApprove)) {
            return fail('autoApprove present but not an array', { serverId });
          }
          
          // Transport is inferred from presence of fields; if present, validate value but do not require it
          if ((serverConfig as any).transport && !['http', 'sse', 'stdio'].includes((serverConfig as any).transport)) {
            return fail('transport invalid', { serverId, transport: (serverConfig as any).transport });
          }
          
          // For stdio transport, command must be a non-empty string when present
          if (serverConfig.transport === 'stdio') {
            if (serverConfig.command !== undefined && (typeof serverConfig.command !== 'string' || serverConfig.command.length === 0)) {
              return fail('stdio.command present but invalid', { serverId, command: serverConfig.command });
            }
            if (serverConfig.args && !Array.isArray(serverConfig.args)) {
              return fail('stdio.args present but not array', { serverId });
            }
          }
        }

        // If we have expected MCP config, validate it exists and is correct
        if (expectedMCPConfig) {
          const serverConfig = config.mcpServers[expectedMCPConfig.mcpServerId];
          if (!serverConfig) {
            return fail('expected serverId not found', { serverId: expectedMCPConfig.mcpServerId });
          }

          // Compare URL according to expected transport
          if (expectedMCPConfig.mcpServerUrl) {
            if (expectedMCPConfig.transport === 'http') {
              const actual = serverConfig.httpUrl || (serverConfig as any).url;
              if (actual !== expectedMCPConfig.mcpServerUrl) {
                return fail('expected http url mismatch', { expected: expectedMCPConfig.mcpServerUrl, actual });
              }
            } else if (expectedMCPConfig.transport === 'sse') {
              const actualUrl = (serverConfig as any).url;
              if (actualUrl !== expectedMCPConfig.mcpServerUrl) {
                return fail('expected url mismatch', { expected: expectedMCPConfig.mcpServerUrl, actual: actualUrl });
              }
            }
          }

          // Validate transport if specified: prefer inferred transport
          if (expectedMCPConfig.transport) {
            const inferred = serverConfig.command ? 'stdio' : (serverConfig.httpUrl ? 'http' : ((serverConfig as any).url ? 'sse' : undefined));
            if (inferred && inferred !== expectedMCPConfig.transport) {
              return fail('expected transport mismatch (inferred)', { expected: expectedMCPConfig.transport, actual: inferred });
            }
          }

          // For stdio transport, validate command matches if provided
          if (expectedMCPConfig.transport === 'stdio' && expectedMCPConfig.command) {
            if (serverConfig.command !== expectedMCPConfig.command) {
              return fail('expected stdio.command mismatch', { expected: expectedMCPConfig.command, actual: serverConfig.command });
            }
          }
        }
      }

      log('validation passed');
      return true;
    } catch (error) {
      const DBG = process?.env?.['ALPH_DEBUG_GEMINI'] === '1';
      if (DBG) {
        ui.debug('[Gemini.validate] exception during validation ' + (error instanceof Error ? error.message : String(error)));
      }
      return false;
    }
  }
}
