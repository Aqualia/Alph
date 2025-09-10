/**
 * Core interfaces and types for agent providers in the alph-cli package.
 * 
 * This module defines the fundamental contracts that all agent providers must implement,
 * including configuration structures and provider capabilities.
 */

/**
 * Configuration structure for MCP (Model Context Protocol) server setup.
 * Contains all necessary information to configure an agent with MCP server access.
 */
export interface AgentConfig {
  /** The unique identifier for the MCP server */
  mcpServerId: string;
  
  /** The base URL for the MCP server endpoint */
  mcpServerUrl?: string;
  
  /** Access key for authenticating with the MCP server */
  mcpAccessKey?: string;
  
  /** Transport protocol for MCP communication (defaults to 'http') */
  transport?: 'http' | 'sse' | 'stdio';
  
  /** Optional additional headers for MCP server requests */
  headers?: Record<string, string>;
  
  /** Optional environment variables for the MCP server configuration */
  env?: Record<string, string>;

  /** Command to execute for stdio transport */
  command?: string;

  /** Arguments to pass to the stdio command */
  args?: string[];

  /** Working directory for the stdio command */
  cwd?: string;
 
  /** Request timeout in milliseconds for HTTP/SSE transports */
  timeout?: number;
  
  /** Optional custom configuration directory path */
  configDir?: string;

  /**
   * Prefer installing/using a local Supergateway binary instead of invoking via npx.
   * Primarily intended to improve startup reliability on Windows (avoids npx timeouts/ENOENT).
   */
  preferLocalProxyBin?: boolean;

  /**
   * Optional directory to install proxy binaries (e.g., Supergateway) when preferLocalProxyBin is true.
   * Defaults to ~/.alph-mcp (or %USERPROFILE%\.alph-mcp on Windows) if not provided.
   */
  proxyInstallDir?: string;
}

/**
 * Configuration structure for MCP server removal operations.
 * Contains the information needed to identify and remove specific MCP server configurations.
 */
export interface RemovalConfig {
  /** The unique identifier for the MCP server to remove */
  mcpServerId: string;
  
  /** Optional custom configuration directory path */
  configDir?: string;
  
  /** Optional: whether to create a backup during removal (defaults to true if unspecified) */
  backup?: boolean;
}

/**
 * Core interface that all agent providers must implement.
 * 
 * Agent providers are responsible for detecting, configuring, and managing
 * specific AI development tools (like Gemini CLI, Cursor, Claude Code, etc.).
 * Each provider handles the platform-specific configuration format and file locations.
 */
export interface AgentProvider {
  /** Unique name for the agent */
  readonly name: string;
  
  /**
   * Detects if this agent is installed and available on the current system.
   * 
   * @param configDir - Optional custom configuration directory
   * @returns Promise resolving to the configuration file path if detected, null if not found
   * @throws Error if detection fails due to permission or system issues
   */
  detect(configDir?: string): Promise<string | null>;
  
  /**
   * Configures the detected agent with the provided MCP server settings.
   * 
   * This method should:
   * - Create a backup of the existing configuration
   * - Parse the current configuration safely
   * - Inject the new MCP server settings
   * - Write the updated configuration atomically
   * - Validate the new configuration
   * 
   * @param config - The MCP server configuration to apply
   * @param backup - Whether to create a backup of the existing configuration
   * @returns Promise resolving to the backup file path if backup was created, undefined otherwise
   * @throws Error if configuration fails, backup should be preserved
   */
  configure(config: AgentConfig, backup: boolean): Promise<string | undefined>;
  
  /**
   * Removes an MCP server configuration from the detected agent.
   * 
   * This method should:
   * - Create a backup of the existing configuration
   * - Parse the current configuration safely
   * - Remove the specified MCP server settings
   * - Write the updated configuration atomically
   * - Validate the new configuration
   * 
   * @param config - The MCP server removal configuration
   * @param backup - Whether to create a backup of the existing configuration
   * @returns Promise resolving to the backup file path if backup was created, undefined otherwise
   * @throws Error if removal fails or server not found, backup should be preserved
   */
  remove(config: RemovalConfig, backup: boolean): Promise<string | undefined>;
  
  /**
   * Lists all MCP server configurations present in the agent's configuration.
   * 
   * @param configDir - Optional custom configuration directory
   * @returns Promise resolving to an array of MCP server IDs, empty array if none found
   * @throws Error if reading configuration fails
   */
  listMCPServers(configDir?: string): Promise<string[]>;
  
  /**
   * Checks if a specific MCP server configuration exists in the agent.
   * 
   * @param serverId - The MCP server ID to check for
   * @param configDir - Optional custom configuration directory
   * @returns Promise resolving to true if the server exists, false otherwise
   * @throws Error if reading configuration fails
   */
  hasMCPServer(serverId: string, configDir?: string): Promise<boolean>;
  
  /**
   * Optional method to validate the current configuration.
   * 
   * Implementations should verify:
   * - Configuration file exists and is readable
   * - JSON structure is valid
   * - MCP server configuration is present and correctly formatted
   * 
   * @returns Promise resolving to true if configuration is valid, false otherwise
   */
  validate?(): Promise<boolean>;
  
  /**
   * Optional method to rollback to the most recent backup.
   * 
   * This method should:
   * - Locate the most recent backup file
   * - Restore the backup to the original location
   * - Verify the restoration was successful
   * 
   * @returns Promise resolving to the backup file path that was restored, null if no backup found
   * @throws Error if rollback fails
   */
  rollback?(): Promise<string | null>;
}

/**
 * Result structure for provider detection operations.
 * Used by the registry to track which providers are available and their status.
 */
export interface ProviderDetectionResult {
  /** The provider instance */
  provider: AgentProvider;
  
  /** Whether the provider was successfully detected */
  detected: boolean;
  
  /** Path to the configuration file if detected */
  configPath?: string;
  
  /** Error message if detection failed */
  error?: string;
}

/**
 * Result structure for provider configuration operations.
 * Used to track the success/failure of configuration attempts across multiple providers.
 */
export interface ProviderConfigurationResult {
  /** The provider that was configured */
  provider: AgentProvider;
  
  /** Whether the configuration was successful */
  success: boolean;
  
  /** Backup file path if a backup was created */
  backupPath?: string;
  
  /** Error message if configuration failed */
  error?: string;
}

/**
 * Result structure for provider removal operations.
 * Used to track the success/failure of removal attempts across multiple providers.
 */
export interface ProviderRemovalResult {
  /** The provider that performed the removal */
  provider: AgentProvider;
  
  /** Whether the removal was successful */
  success: boolean;
  
  /** The MCP server ID that was removed */
  serverId: string;
  
  /** Backup file path if a backup was created */
  backupPath?: string;
  
  /** Error message if removal failed */
  error?: string;
  
  /** Whether the server was found before removal attempt */
  found: boolean;
}