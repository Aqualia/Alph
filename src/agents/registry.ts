/**
 * Agent provider registry for managing multiple AI development tool providers.
 * 
 * This module provides centralized management of agent providers, including
 * automatic detection, registration, and configuration orchestration across
 * multiple providers simultaneously.
 */

import { AgentProvider, AgentConfig, ProviderDetectionResult, ProviderConfigurationResult, RemovalConfig, ProviderRemovalResult } from './provider';
import { buildSupergatewayArgs, ensureLocalSupergatewayBin } from '../utils/proxy';
import { GeminiProvider } from './gemini';
import { CursorProvider } from './cursor';
import { ClaudeProvider } from './claude';
import { WindsurfProvider } from './windsurf';
import { WarpProvider } from './warp';
import { CodexProvider } from './codex';
import { ui } from '../utils/ui';

/**
 * Configuration options for the agent registry
 */
export interface RegistryOptions {
  /** Whether to include built-in providers (default: true) */
  includeBuiltinProviders?: boolean;
  
  /** Custom providers to register */
  customProviders?: AgentProvider[];
  
  /** Whether to enable parallel detection (default: true) */
  parallelDetection?: boolean;
  
  /** Whether to enable parallel configuration (default: true) */
  parallelConfiguration?: boolean;
  
  /** Timeout for detection operations in milliseconds (default: 5000) */
  detectionTimeout?: number;
  
  /** Timeout for configuration operations in milliseconds (default: 10000) */
  configurationTimeout?: number;
}

/**
 * Registry for managing agent providers and orchestrating multi-provider operations.
 * 
 * The registry provides:
 * - Automatic detection of available AI development tools
 * - Centralized provider management and registration
 * - Parallel configuration of multiple providers
 * - Error handling and rollback coordination
 * - Provider filtering and selection logic
 */
export class AgentRegistry {
  private providers: Map<string, AgentProvider> = new Map();
  private options: Required<RegistryOptions>;

  /**
   * Creates a new agent registry instance
   * @param options - Configuration options for the registry
   */
  constructor(options: RegistryOptions = {}) {
    // Set default options
    this.options = {
      includeBuiltinProviders: true,
      customProviders: [],
      parallelDetection: true,
      parallelConfiguration: true,
      detectionTimeout: 5000,
      configurationTimeout: 10000,
      ...options
    };

    // Register built-in providers if enabled
    if (this.options.includeBuiltinProviders) {
      this.registerBuiltinProviders();
    }

    // Register custom providers
    if (this.options.customProviders.length > 0) {
      this.registerCustomProviders(this.options.customProviders);
    }
  }

  /**
   * Registers all built-in agent providers
   * @param configDir - Optional custom configuration directory
   * @private
   */
  private registerBuiltinProviders(): void {
    // Register core providers
    this.registerProvider(new GeminiProvider());
    this.registerProvider(new CursorProvider());
    this.registerProvider(new ClaudeProvider());
    // New: Windsurf and Warp
    this.registerProvider(new WindsurfProvider());
    this.registerProvider(new WarpProvider());
    // New: Codex CLI
    this.registerProvider(new CodexProvider());
  }

  /**
   * Registers custom providers from the options
   * @param customProviders - Array of custom providers to register
   * @private
   */
  private registerCustomProviders(customProviders: AgentProvider[]): void {
    for (const provider of customProviders) {
      this.registerProvider(provider);
    }
  }

  /**
   * Registers a single agent provider with the registry
   * @param provider - The provider to register
   * @throws Error if a provider with the same name is already registered
   */
  registerProvider(provider: AgentProvider): void {
    if (this.providers.has(provider.name)) {
      throw new Error(`Provider with name '${provider.name}' is already registered`);
    }

    this.providers.set(provider.name, provider);
  }

  /**
   * Unregisters a provider from the registry
   * @param providerName - Name of the provider to unregister
   * @returns True if the provider was found and removed, false otherwise
   */
  unregisterProvider(providerName: string): boolean {
    return this.providers.delete(providerName);
  }

  /**
   * Gets all registered providers
   * @returns Array of all registered agent providers
   */
  getAllProviders(): AgentProvider[] {
    return Array.from(this.providers.values());
  }

  /**
   * Gets a specific provider by name
   * @param providerName - Name of the provider to retrieve
   * @returns The provider if found, undefined otherwise
   */
  getProvider(providerName: string): AgentProvider | undefined {
    return this.providers.get(providerName);
  }

  /**
   * Gets all provider names
   * @returns Array of registered provider names
   */
  getProviderNames(): string[] {
    return Array.from(this.providers.keys());
  }

  /**
   * Detects all available agents on the current system
   * 
   * This method runs detection across all registered providers and returns
   * detailed results about which agents are available and their configuration paths.
   * 
   * @param providerFilter - Optional filter to limit detection to specific providers
   * @param configDir - Optional custom configuration directory
   * @returns Promise resolving to detection results for all providers
   */
  async detectAvailableAgents(providerFilter?: string[], configDir?: string): Promise<ProviderDetectionResult[]> {
    const providersToCheck = this.filterProviders(providerFilter);
    
    if (this.options.parallelDetection) {
      return this.detectProvidersParallel(providersToCheck, configDir);
    } else {
      return this.detectProvidersSequential(providersToCheck, configDir);
    }
  }

  /**
   * Detects providers in parallel with timeout handling
   * @param providers - Providers to detect
   * @param configDir - Optional custom configuration directory
   * @returns Promise resolving to detection results
   * @private
   */
  private async detectProvidersParallel(providers: AgentProvider[], configDir?: string): Promise<ProviderDetectionResult[]> {
    const detectionPromises = providers.map(provider => 
      this.detectSingleProviderWithTimeout(provider, configDir)
    );

    return Promise.all(detectionPromises);
  }

  /**
   * Detects providers sequentially
   * @param providers - Providers to detect
   * @param configDir - Optional custom configuration directory
   * @returns Promise resolving to detection results
   * @private
   */
  private async detectProvidersSequential(providers: AgentProvider[], configDir?: string): Promise<ProviderDetectionResult[]> {
    const results: ProviderDetectionResult[] = [];
    
    for (const provider of providers) {
      const result = await this.detectSingleProviderWithTimeout(provider, configDir);
      results.push(result);
    }

    return results;
  }

  /**
   * Detects a single provider with timeout handling
   * @param provider - Provider to detect
   * @param configDir - Optional custom configuration directory
   * @returns Promise resolving to detection result
   * @private
   */
  private async detectSingleProviderWithTimeout(provider: AgentProvider, configDir?: string): Promise<ProviderDetectionResult> {
    let timeoutId: NodeJS.Timeout | undefined;
    try {
      const detectionPromise = provider.detect(configDir);
      const timeoutPromise = new Promise<never>((_, reject) => {
        timeoutId = setTimeout(() => reject(new Error('Detection timeout')), this.options.detectionTimeout);
      });

      const configPath = await Promise.race([detectionPromise, timeoutPromise]);
      
      return {
        provider,
        detected: configPath !== null,
        ...(configPath && { configPath })
      };
    } catch (error) {
      return {
        provider,
        detected: false,
        error: error instanceof Error ? error.message : String(error)
      };
    } finally {
      if (timeoutId) clearTimeout(timeoutId);
    }
  }

  /**
   * Filters providers based on the provided filter criteria
   * @param providerFilter - Optional array of provider names to include
   * @returns Filtered array of providers
   * @private
   */
  private filterProviders(providerFilter?: string[]): AgentProvider[] {
    const allProviders = this.getAllProviders();
    
    if (!providerFilter || providerFilter.length === 0) {
      return allProviders;
    }

    return allProviders.filter(provider => 
      providerFilter.includes(provider.name)
    );
  }

  /**
   * Gets only the detected (available) providers from detection results
   * @param detectionResults - Results from detectAvailableAgents
   * @returns Array of providers that were successfully detected
   */
  getDetectedProviders(detectionResults: ProviderDetectionResult[]): AgentProvider[] {
    return detectionResults
      .filter(result => result.detected)
      .map(result => result.provider);
  }

  /**
   * Gets providers that failed detection
   * @param detectionResults - Results from detectAvailableAgents
   * @returns Array of providers that failed detection with error information
   */
  getFailedDetections(detectionResults: ProviderDetectionResult[]): ProviderDetectionResult[] {
    return detectionResults.filter(result => !result.detected);
  }

  /**
   * Creates a summary of detection results
   * @param detectionResults - Results from detectAvailableAgents
   * @returns Summary object with counts and lists
   */
  summarizeDetectionResults(detectionResults: ProviderDetectionResult[]): {
    total: number;
    detected: number;
    failed: number;
    detectedProviders: string[];
    failedProviders: string[];
  } {
    const detected = detectionResults.filter(r => r.detected);
    const failed = detectionResults.filter(r => !r.detected);

    return {
      total: detectionResults.length,
      detected: detected.length,
      failed: failed.length,
      detectedProviders: detected.map(r => r.provider.name),
      failedProviders: failed.map(r => r.provider.name)
    };
  }

  /**
   * Clears all registered providers
   * Useful for testing or when reconfiguring the registry
   */
  clearProviders(): void {
    this.providers.clear();
  }

  /**
   * Gets the current registry options
   * @returns Current configuration options
   */
  getOptions(): Required<RegistryOptions> {
    return { ...this.options };
  }

  /**
   * Updates registry options
   * @param newOptions - New options to merge with current options
   */
  updateOptions(newOptions: Partial<RegistryOptions>): void {
    this.options = { ...this.options, ...newOptions };
  }

  /**
   * Configures all detected agents with the provided MCP server settings
   * 
   * This method orchestrates configuration across multiple providers:
   * 1. Detects available agents if not already provided
   * 2. Configures each detected agent in parallel or sequentially
   * 3. Handles errors and provides detailed results
   * 4. Supports rollback coordination on failures
   * 
   * @param config - The MCP server configuration to apply
   * @param detectedProviders - Optional pre-detected providers to configure
   * @param rollbackOnAnyFailure - Whether to rollback all changes if any provider fails
   * @returns Promise resolving to configuration results for all providers
   */
  async configureAllDetectedAgents(
    config: AgentConfig,
    detectedProviders?: AgentProvider[],
    rollbackOnAnyFailure: boolean = false,
    backup: boolean = true
  ): Promise<ProviderConfigurationResult[]> {
    let providersToConfig: AgentProvider[];

    // Use provided providers or detect them
    if (detectedProviders) {
      providersToConfig = detectedProviders;
    } else {
      const detectionResults = await this.detectAvailableAgents();
      providersToConfig = this.getDetectedProviders(detectionResults);
    }

    if (providersToConfig.length === 0) {
      return [];
    }

    // Configure providers
    let configResults: ProviderConfigurationResult[];
    
    if (this.options.parallelConfiguration) {
      configResults = await this.configureProvidersParallel(providersToConfig, config, backup);
    } else {
      configResults = await this.configureProvidersSequential(providersToConfig, config, backup);
    }

    // Handle rollback if requested and any configuration failed
    if (rollbackOnAnyFailure && configResults.some(result => !result.success)) {
      await this.rollbackFailedConfigurations(configResults);
    }

    return configResults;
  }

  /**
   * Configures providers in parallel with timeout handling
   * @param providers - Providers to configure
   * @param config - Configuration to apply
   * @returns Promise resolving to configuration results
   * @private
   */
  private async configureProvidersParallel(
    providers: AgentProvider[],
    config: AgentConfig,
    backup: boolean
  ): Promise<ProviderConfigurationResult[]> {
    const configurationPromises = providers.map(provider => 
      this.configureSingleProviderWithTimeout(provider, config, backup)
    );

    return Promise.all(configurationPromises);
  }

  /**
   * Configures providers sequentially
   * @param providers - Providers to configure
   * @param config - Configuration to apply
   * @returns Promise resolving to configuration results
   * @private
   */
  private async configureProvidersSequential(
    providers: AgentProvider[],
    config: AgentConfig,
    backup: boolean
  ): Promise<ProviderConfigurationResult[]> {
    const results: ProviderConfigurationResult[] = [];
    
    for (const provider of providers) {
      const result = await this.configureSingleProviderWithTimeout(provider, config, backup);
      results.push(result);
      
      // If this configuration failed and we're doing sequential processing,
      // we might want to stop here depending on the strategy
      // For now, we continue to attempt all configurations
    }

    return results;
  }

  /**
   * Configures a single provider with timeout handling
   * @param provider - Provider to configure
   * @param config - Configuration to apply
   * @returns Promise resolving to configuration result
   * @private
   */
  private async configureSingleProviderWithTimeout(
    provider: AgentProvider,
    config: AgentConfig,
    backup: boolean
  ): Promise<ProviderConfigurationResult> {
    let timeoutId: NodeJS.Timeout | undefined;
    try {
      // Provider-specific mapping: Codex requires STDIO. If user selected http/sse, bridge via Supergateway.
      const effectiveConfig = this.__mapConfigForProvider(provider, config);
      const configurationPromise = provider.configure(effectiveConfig, backup);
      const timeoutPromise = new Promise<never>((_, reject) => {
        timeoutId = setTimeout(() => reject(new Error('Configuration timeout')), this.options.configurationTimeout);
      });

      const backupPath = await Promise.race([configurationPromise, timeoutPromise]);

      return {
        provider,
        success: true,
        ...(backupPath && { backupPath })
      };
    } catch (error) {
      return {
        provider,
        success: false,
        error: error instanceof Error ? error.message : String(error)
      };
    } finally {
      if (timeoutId) clearTimeout(timeoutId);
    }
  }

  // Map remote transports to local STDIO invocation for providers that require it (e.g., Codex CLI)
  private __mapConfigForProvider(provider: AgentProvider, config: AgentConfig): AgentConfig {
    if (provider.name === 'Codex CLI' && (config.transport === 'http' || config.transport === 'sse')) {
      const headersRecord = config.headers || {};
      // Prefer explicit access key; fallback to Authorization header if present
      let bearer = config.mcpAccessKey;
      const authHeader = headersRecord['Authorization'] || headersRecord['authorization'];
      if (!bearer && typeof authHeader === 'string') {
        const m = authHeader.match(/Bearer\s+(.+)/i);
        if (m) bearer = m[1];
      }
      const headers = Object.entries(headersRecord)
        .filter(([k]) => k.toLowerCase() !== 'authorization')
        .map(([key, value]) => ({ key, value: String(value) }));

      const argv = buildSupergatewayArgs({
        remoteUrl: config.mcpServerUrl || '',
        transport: config.transport,
        bearer,
        headers,
      });

      const pin = process?.env?.['ALPH_PROXY_VERSION'] || '3.4.0';
      const useDocker = (config.command || '').toLowerCase() === 'docker';

      // Prefer local binary on Windows by default or when explicitly requested
      const preferLocal = config.preferLocalProxyBin === true || (process.platform === 'win32' && config.preferLocalProxyBin !== false);

      if (useDocker) {
        // Docker mapping unchanged
        return {
          ...config,
          transport: 'stdio',
          command: 'docker',
          args: ['run', '--rm', `ghcr.io/supercorp-ai/supergateway:${pin}`, ...argv],
        };
      }

      if (preferLocal) {
        // Ensure local install and point directly to the .bin shim
        try {
          const binPath = ensureLocalSupergatewayBin(config.proxyInstallDir, pin);
          return {
            ...config,
            transport: 'stdio',
            command: binPath,
            args: argv,
          };
        } catch (e) {
          // Fall back to npx if local install fails for any reason
        }
      }

      // Default: npx invocation (cross-platform), will be normalized to npx.cmd on Windows by Codex provider
      return {
        ...config,
        transport: 'stdio',
        command: config.command || 'npx',
        args: ['-y', `supergateway@${pin}`, ...argv],
      };
    }
    return config;
  }

  /**
   * Rolls back configurations for providers that were successfully configured
   * @param configResults - Configuration results to process for rollback
   * @returns Promise resolving to rollback results
   * @private
   */
  private async rollbackFailedConfigurations(
    configResults: ProviderConfigurationResult[]
  ): Promise<void> {
    const successfulConfigurations = configResults.filter(result => result.success);
    
    if (successfulConfigurations.length === 0) {
      return;
    }

    // Attempt to rollback all successful configurations
    const rollbackPromises = successfulConfigurations.map(async (result) => {
      try {
        if (result.provider.rollback) {
          await result.provider.rollback();
        }
      } catch (rollbackError) {
        // Log rollback errors but don't throw - we want to attempt all rollbacks
        ui.error(`Failed to rollback ${result.provider.name}: ${rollbackError instanceof Error ? rollbackError.message : String(rollbackError)}`);
      }
    });

    await Promise.all(rollbackPromises);
  }

  /**
   * Configures specific providers by name
   * @param providerNames - Names of providers to configure
   * @param config - Configuration to apply
   * @returns Promise resolving to configuration results
   */
  async configureSpecificProviders(
    providerNames: string[],
    config: AgentConfig
  ): Promise<ProviderConfigurationResult[]> {
    const providers = providerNames
      .map(name => this.getProvider(name))
      .filter((provider): provider is AgentProvider => provider !== undefined);

    if (providers.length === 0) {
      return [];
    }

    return this.configureAllDetectedAgents(config, providers);
  }

  /**
   * Validates all detected agents
   * @param detectedProviders - Optional pre-detected providers to validate
   * @returns Promise resolving to validation results
   */
  async validateAllDetectedAgents(
    detectedProviders?: AgentProvider[]
  ): Promise<Array<{ provider: AgentProvider; valid: boolean; error?: string }>> {
    let providersToValidate: AgentProvider[];

    // Use provided providers or detect them
    if (detectedProviders) {
      providersToValidate = detectedProviders;
    } else {
      const detectionResults = await this.detectAvailableAgents();
      providersToValidate = this.getDetectedProviders(detectionResults);
    }

    if (providersToValidate.length === 0) {
      return [];
    }

    // Validate providers
    const validationPromises = providersToValidate.map(async (provider) => {
      try {
        if (provider.validate) {
          const valid = await provider.validate();
          return { provider, valid };
        } else {
          // If provider doesn't implement validation, assume it's valid
          return { provider, valid: true };
        }
      } catch (error) {
        return {
          provider,
          valid: false,
          error: error instanceof Error ? error.message : String(error)
        };
      }
    });

    return Promise.all(validationPromises);
  }

  /**
   * Rolls back all detected agents to their previous configurations
   * @param detectedProviders - Optional pre-detected providers to rollback
   * @returns Promise resolving to rollback results
   */
  async rollbackAllDetectedAgents(
    detectedProviders?: AgentProvider[]
  ): Promise<Array<{ provider: AgentProvider; success: boolean; backupPath?: string; error?: string }>> {
    let providersToRollback: AgentProvider[];

    // Use provided providers or detect them
    if (detectedProviders) {
      providersToRollback = detectedProviders;
    } else {
      const detectionResults = await this.detectAvailableAgents();
      providersToRollback = this.getDetectedProviders(detectionResults);
    }

    if (providersToRollback.length === 0) {
      return [];
    }

    // Rollback providers
    const rollbackPromises = providersToRollback.map(async (provider) => {
      try {
        if (provider.rollback) {
          const backupPath = await provider.rollback();
          return {
            provider,
            success: true,
            ...(backupPath && { backupPath })
          };
        } else {
          return {
            provider,
            success: false,
            error: 'Provider does not support rollback'
          };
        }
      } catch (error) {
        return {
          provider,
          success: false,
          error: error instanceof Error ? error.message : String(error)
        };
      }
    });

    return Promise.all(rollbackPromises);
  }

  /**
   * Gets configuration results summary
   * @param configResults - Configuration results to summarize
   * @returns Summary object with counts and details
   */
  summarizeConfigurationResults(configResults: ProviderConfigurationResult[]): {
    total: number;
    successful: number;
    failed: number;
    successfulProviders: string[];
    failedProviders: Array<{ name: string; error?: string }>;
    backupPaths: Array<{ provider: string; backupPath: string }>;
  } {
    const successful = configResults.filter(r => r.success);
    const failed = configResults.filter(r => !r.success);
    const backupPaths = configResults
      .filter(r => r.backupPath)
      .map(r => ({ provider: r.provider.name, backupPath: r.backupPath! }));

    return {
      total: configResults.length,
      successful: successful.length,
      failed: failed.length,
      successfulProviders: successful.map(r => r.provider.name),
      failedProviders: failed.map(r => ({
        name: r.provider.name,
        ...(r.error && { error: r.error })
      })),
      backupPaths
    };
  }

  /**
   * Removes MCP server configuration from all detected agents
   * 
   * This method orchestrates removal across multiple providers:
   * 1. Uses provided providers or detects available agents
   * 2. Removes MCP server from each detected agent in parallel or sequentially
   * 3. Handles errors and provides detailed results
   * 4. Supports rollback coordination on failures
   * 
   * @param config - The MCP server removal configuration
   * @param detectedProviders - Optional pre-detected providers to remove from
   * @param rollbackOnAnyFailure - Whether to rollback all changes if any provider fails
   * @returns Promise resolving to removal results for all providers
   */
  async removeFromAllDetectedAgents(
    config: RemovalConfig,
    detectedProviders?: AgentProvider[],
    rollbackOnAnyFailure: boolean = false
  ): Promise<ProviderRemovalResult[]> {
    let providersToRemoveFrom: AgentProvider[];

    // Use provided providers or detect them
    if (detectedProviders) {
      providersToRemoveFrom = detectedProviders;
    } else {
      const detectionResults = await this.detectAvailableAgents();
      providersToRemoveFrom = this.getDetectedProviders(detectionResults);
    }

    if (providersToRemoveFrom.length === 0) {
      return [];
    }

    // Remove from providers
    let removalResults: ProviderRemovalResult[];
    
    if (this.options.parallelConfiguration) {
      removalResults = await this.removeFromProvidersParallel(providersToRemoveFrom, config);
    } else {
      removalResults = await this.removeFromProvidersSequential(providersToRemoveFrom, config);
    }

    // Handle rollback if requested and any removal failed
    if (rollbackOnAnyFailure && removalResults.some(result => !result.success && result.found)) {
      await this.rollbackFailedRemovals(removalResults);
    }

    return removalResults;
  }

  /**
   * Removes from providers in parallel with timeout handling
   * @param providers - Providers to remove from
   * @param config - Removal configuration
   * @returns Promise resolving to removal results
   * @private
   */
  private async removeFromProvidersParallel(
    providers: AgentProvider[],
    config: RemovalConfig
  ): Promise<ProviderRemovalResult[]> {
    const removalPromises = providers.map(provider => 
      this.removeFromSingleProviderWithTimeout(provider, config)
    );

    return Promise.all(removalPromises);
  }

  /**
   * Removes from providers sequentially
   * @param providers - Providers to remove from
   * @param config - Removal configuration
   * @returns Promise resolving to removal results
   * @private
   */
  private async removeFromProvidersSequential(
    providers: AgentProvider[],
    config: RemovalConfig
  ): Promise<ProviderRemovalResult[]> {
    const results: ProviderRemovalResult[] = [];
    
    for (const provider of providers) {
      const result = await this.removeFromSingleProviderWithTimeout(provider, config);
      results.push(result);
      
      // Continue to attempt all removals regardless of individual failures
    }

    return results;
  }

  /**
   * Removes from a single provider with timeout handling
   * @param provider - Provider to remove from
   * @param config - Removal configuration
   * @returns Promise resolving to removal result
   * @private
   */
  private async removeFromSingleProviderWithTimeout(
    provider: AgentProvider,
    config: RemovalConfig
  ): Promise<ProviderRemovalResult> {
    let timeoutId: NodeJS.Timeout | undefined;
    try {
      // First check if the server exists
      const hasServer = await provider.hasMCPServer(config.mcpServerId, config.configDir);
      
      if (!hasServer) {
        return {
          provider,
          success: true, // Not an error if server doesn't exist
          serverId: config.mcpServerId,
          found: false
        };
      }

      // Perform the removal, honoring caller's backup preference (default: true)
      const backupFlag = config.backup !== false;
      const removalPromise = provider.remove(config, backupFlag);

      const timeoutPromise = new Promise<never>((_, reject) => {
        timeoutId = setTimeout(() => reject(new Error('Removal timeout')), this.options.configurationTimeout);
      });

      const backupPath = await Promise.race([removalPromise, timeoutPromise]);

      return {
        provider,
        success: true,
        serverId: config.mcpServerId,
        found: true,
        ...(backupPath && { backupPath })
      };
    } catch (error) {
      // Check if the error indicates the server wasn't found
      const errorMessage = error instanceof Error ? error.message : String(error);
      const serverNotFound = errorMessage.toLowerCase().includes('not found') || 
                            errorMessage.toLowerCase().includes('does not exist');
      
      return {
        provider,
        success: false,
        serverId: config.mcpServerId,
        found: !serverNotFound,
        error: errorMessage
      };
    } finally {
      if (timeoutId) clearTimeout(timeoutId);
    }
  }

  /**
   * Rolls back removals for providers that were successfully processed
   * @param removalResults - Removal results to process for rollback
   * @returns Promise resolving when rollback attempts complete
   * @private
   */
  private async rollbackFailedRemovals(
    removalResults: ProviderRemovalResult[]
  ): Promise<void> {
    const successfulRemovals = removalResults.filter(result => result.success && result.found);
    
    if (successfulRemovals.length === 0) {
      return;
    }

    // Attempt to rollback all successful removals
    const rollbackPromises = successfulRemovals.map(async (result) => {
      try {
        if (result.provider.rollback) {
          await result.provider.rollback();
        }
      } catch (rollbackError) {
    // Log rollback errors but don't throw - we want to attempt all rollbacks
    ui.error(`Failed to rollback ${result.provider.name}: ${rollbackError instanceof Error ? rollbackError.message : String(rollbackError)}`);
  }
    });

    await Promise.all(rollbackPromises);
  }

  /**
   * Removes MCP server from specific providers by name
   * @param providerNames - Names of providers to remove from
   * @param config - Removal configuration
   * @returns Promise resolving to removal results
   */
  async removeFromSpecificProviders(
    providerNames: string[],
    config: RemovalConfig
  ): Promise<ProviderRemovalResult[]> {
    const providers = providerNames
      .map(name => this.getProvider(name))
      .filter((provider): provider is AgentProvider => provider !== undefined);

    if (providers.length === 0) {
      return [];
    }

    return this.removeFromAllDetectedAgents(config, providers);
  }

  /**
   * Lists all MCP servers across all detected agents
   * @param detectedProviders - Optional pre-detected providers to list from
   * @param configDir - Optional custom configuration directory
   * @returns Promise resolving to server lists by provider
   */
  async listAllMCPServers(
    detectedProviders?: AgentProvider[],
    configDir?: string
  ): Promise<Array<{ provider: AgentProvider; servers: string[]; error?: string }>> {
    let providersToList: AgentProvider[];

    // Use provided providers or detect them
    if (detectedProviders) {
      providersToList = detectedProviders;
    } else {
      const detectionResults = await this.detectAvailableAgents(undefined, configDir);
      providersToList = this.getDetectedProviders(detectionResults);
    }

    if (providersToList.length === 0) {
      return [];
    }

    // List servers from providers
    const listingPromises = providersToList.map(async (provider) => {
      try {
        const servers = await provider.listMCPServers(configDir);
        return { provider, servers };
      } catch (error) {
        return {
          provider,
          servers: [],
          error: error instanceof Error ? error.message : String(error)
        };
      }
    });

    return Promise.all(listingPromises);
  }

  /**
   * Checks if a specific MCP server exists in any detected agent
   * @param serverId - The MCP server ID to check for
   * @param detectedProviders - Optional pre-detected providers to check
   * @param configDir - Optional custom configuration directory
   * @returns Promise resolving to providers that contain the server
   */
  async findMCPServerInAgents(
    serverId: string,
    detectedProviders?: AgentProvider[],
    configDir?: string
  ): Promise<AgentProvider[]> {
    let providersToCheck: AgentProvider[];

    // Use provided providers or detect them
    if (detectedProviders) {
      providersToCheck = detectedProviders;
    } else {
      const detectionResults = await this.detectAvailableAgents(undefined, configDir);
      providersToCheck = this.getDetectedProviders(detectionResults);
    }

    if (providersToCheck.length === 0) {
      return [];
    }

    // Check providers for the server
    const checkPromises = providersToCheck.map(async (provider) => {
      try {
        const hasServer = await provider.hasMCPServer(serverId, configDir);
        return hasServer ? provider : null;
      } catch (error) {
        // Ignore errors when checking individual providers
        return null;
      }
    });

    const results = await Promise.all(checkPromises);
    return results.filter((provider): provider is AgentProvider => provider !== null);
  }
}

/**
 * Default agent registry instance with built-in providers
 * This can be used directly for most common use cases
 */
export const defaultRegistry = new AgentRegistry();

/**
 * Creates a new agent registry with custom configuration
 * @param options - Configuration options for the registry
 * @returns New AgentRegistry instance
 */
export function createRegistry(options: RegistryOptions = {}): AgentRegistry {
  return new AgentRegistry(options);
}

/**
 * Creates a registry with only specific built-in providers
 * @param providerNames - Names of built-in providers to include
 * @returns New AgentRegistry instance with only specified providers
 */
export function createRegistryWithProviders(providerNames: string[]): AgentRegistry {
  const registry = new AgentRegistry({ includeBuiltinProviders: false });
  
  // Map provider names to their classes
  const providerMap: Record<string, () => AgentProvider> = {
    'Gemini CLI': () => new GeminiProvider(),
    'Cursor': () => new CursorProvider(),
    'Claude Code': () => new ClaudeProvider(),
    'Codex CLI': () => new CodexProvider(),
    'Windsurf': () => new WindsurfProvider(),
    'Warp': () => new WarpProvider()
  };

  // Register requested providers
  for (const name of providerNames) {
    const providerFactory = providerMap[name];
    if (providerFactory) {
      registry.registerProvider(providerFactory());
    }
  }

  return registry;
}
