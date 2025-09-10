/**
 * Remove command for Alph CLI
 * 
 * Implements safe removal of MCP server configurations from AI agents.
 * Follows the safety-first principles with backup, validation, and rollback capabilities.
 */

import { RemovalConfig, ProviderRemovalResult, type AgentProvider } from '../agents/provider';
import { defaultRegistry } from '../agents/registry';
import { mapAliases, parseAgentNames, validateAgentNames } from '../utils/agents';
import { getInquirer } from '../utils/inquirer';
import { ui } from '../utils/ui';

/**
 * Options for the remove command
 */
export interface RemoveCommandOptions {
  /** MCP server name to remove */
  serverName?: string;
  /** Agents filter (names or comma-separated list) */
  agents?: string[] | string;
  /** Custom config directory (default: use global agent config locations) */
  configDir?: string;
  /** Skip confirmation */
  yes?: boolean;
  /** Preview changes without removing */
  dryRun?: boolean;
  /** Run interactive wizard */
  interactive?: boolean;
  /** Whether to create a backup before removal (default: true). Use --no-backup to disable. */
  backup?: boolean;
}

/**
 * Summary of removal operations across multiple providers
 */
export interface RemovalSummary {
  /** Total number of successful removals */
  successful: number;
  /** Total number of failed removals */
  failed: number;
  /** Total number of servers not found */
  notFound: number;
  /** Array of backup file paths created */
  backupPaths: Array<{ provider: string; backupPath: string }>;
  /** Detailed results for each provider */
  results: ProviderRemovalResult[];
}

/**
 * Unified remove command implementation
 */
export class RemoveCommand {
  private options: RemoveCommandOptions & {
    agents: string | string[];
    configDir: string;
    yes: boolean;
    dryRun: boolean;
    interactive: boolean;
    backup: boolean;
  };
  
  constructor(options: RemoveCommandOptions = {}) {
    // Set up default options
    this.options = {
      serverName: options.serverName ?? '',
      agents: Array.isArray(options.agents) 
        ? options.agents 
        : (options.agents ?? ''),
      configDir: options.configDir ?? '',
      yes: options.yes ?? false,
      dryRun: options.dryRun ?? false,
      interactive: options.interactive ?? false,
      backup: options.backup ?? true
    };
  }
  
  /**
   * Dynamically import inquirer to handle ESM/CommonJS compatibility
   */
  
  
  /**
   * Executes the remove command
   */
  public async execute(): Promise<void> {
    this.validateOptions();

    // Interactive path or default with no flags
    const noFlags = !this.options.serverName && !this.options.agents && !this.options.dryRun && !this.options.yes;
    if (this.options.interactive || noFlags) {
      // Handle interactive selection inline to avoid deprecated delegation loops
      const inquirer = await getInquirer();

      // Detect available agents
      ui.info('\n🔍 Detecting available AI agents...');
      const detectionResults = await defaultRegistry.detectAvailableAgents(undefined, this.options.configDir);
      const detectedProviders = defaultRegistry.getDetectedProviders(detectionResults);
      if (detectedProviders.length === 0) {
        this.handleNoAgentsDetected();
        return;
      }

      // Build map of provider -> servers and union of server IDs
      const providerServers: Record<string, string[]> = {};
      const serverIdSet = new Set<string>();
      for (const p of detectedProviders) {
        try {
          const ids = await p.listMCPServers(this.options.configDir);
          providerServers[p.name] = ids;
          ids.forEach(id => serverIdSet.add(id));
        } catch {
          providerServers[p.name] = [];
        }
      }

      const allServerIds = Array.from(serverIdSet.values());
      if (allServerIds.length === 0) {
        ui.info('\n❌ No MCP servers found in detected agents.');
        return;
      }

      // Choose server name if not provided
      let chosenServerName = this.options.serverName;
      if (!chosenServerName) {
        const { serverName } = await inquirer.prompt([
          {
            type: 'list',
            name: 'serverName',
            message: 'Select the MCP server to remove:',
            choices: allServerIds.sort().map(id => ({ name: id, value: id }))
          }
        ]);
        chosenServerName = serverName;
      }

      // Determine providers that have the chosen server
      const providersWithServer = Object.entries(providerServers)
        .filter(([, ids]) => ids.includes(chosenServerName!))
        .map(([name]) => name);

      if (providersWithServer.length === 0) {
        ui.info(`\n❌ MCP server '${chosenServerName}' not found in any detected agent.`);
        return;
      }

      // Allow user to pick which agents to remove from (default: all that contain it)
      const { selectedProviders } = await inquirer.prompt([
        {
          type: 'checkbox',
          name: 'selectedProviders',
          message: 'Select agents to remove from:',
          choices: providersWithServer.map(n => ({ name: n, value: n })),
          default: providersWithServer
        }
      ]);

      if (!Array.isArray(selectedProviders) || selectedProviders.length === 0) {
        ui.info('\n❌ No agents selected. Exiting.');
        return;
      }

      // Ask user if they want to create backups (default: yes)
      const { createBackup } = await inquirer.prompt([
        {
          type: 'confirm',
          name: 'createBackup',
          message: 'Create backup files before removal?',
          default: true
        }
      ]);

      // Persist selections into options and fall through to manual flow
      this.options.serverName = chosenServerName!;
      this.options.agents = selectedProviders.join(',');
      this.options.backup = createBackup;
      // Ensure we don't re-enter interactive branch
      this.options.interactive = false;
    }

    // Manual mode
    // 1) Validate server name is provided
    if (!this.options.serverName) {
      throw new Error('--server-name is required in non-interactive mode');
    }

    // 2) Detect available agents (with optional filter)
    const filterInput = mapAliases(parseAgentNames(this.options.agents));
    const { valid, invalid } = validateAgentNames(filterInput);
    if (invalid.length > 0) {
      throw new Error(`Unknown agent name(s): ${invalid.join(', ')}`);
    }
    const providerFilter = valid.length > 0 ? valid : undefined;
    
    ui.info('\n🔍 Detecting available AI agents...');
    const detectionResults = await defaultRegistry.detectAvailableAgents(providerFilter, this.options.configDir);
    const detectedProviders = defaultRegistry.getDetectedProviders(detectionResults);
    
    if (detectedProviders.length === 0) {
      this.handleNoAgentsDetected();
      return;
    }

    // 3) Check if the server exists in any detected provider
    const serversFound = await this.findMCPServerInProviders(detectedProviders, this.options.serverName);
    if (serversFound.length === 0) {
      ui.info(`\n❌ MCP server '${this.options.serverName}' not found in any detected agent.`);
      return;
    }

    // 4) Build removal configuration
    const removalConfig: RemovalConfig = {
      mcpServerId: this.options.serverName,
      configDir: this.options.configDir,
      backup: this.options.backup
    };

    // 5) Dry-run preview
    if (this.options.dryRun) {
      this.printDryRunPreview(serversFound, removalConfig);
      return;
    }

    // 6) Preview redacted diff and confirmation (unless --yes)
    if (!this.options.yes) {
      try {
        const { computeRemovalPreview } = await import('../utils/preview.js');
        ui.info('\n🧪 Preview of changes (redacted):');
        for (const entry of serversFound) {
          const preview = await computeRemovalPreview(entry.provider, removalConfig);
          if (!preview) continue;
          ui.info(`\n— ${entry.provider.name} (${preview.configPath})`);
          ui.info('Before (server snippet):');
          ui.info(preview.snippetBefore);
          ui.info('After (server snippet):');
          ui.info(preview.snippetAfter);
        }
      } catch {
        // preview failures are non-fatal
      }

      const confirmed = await this.confirm(serversFound, removalConfig);
      if (!confirmed) {
        ui.info('\n❌ Removal cancelled.');
        return;
      }
    }

    // 7) Remove server from agents with rollback on any failure
    await this.removeFromAgents(removalConfig, serversFound);
  }
  
  /**
   * Validates command options
   */
  private validateOptions(): void {
    if (!this.options.interactive && !this.options.serverName && !this.options.dryRun) {
      throw new Error('--server-name is required in non-interactive mode (unless using --dry-run)');
    }
  }
  
  /**
   * Handles case when no agents are detected
   */
  private handleNoAgentsDetected(): void {
    console.log('\n❌ No supported AI agents detected on this system.');
    console.log('\nSupported agents and their default locations:');
    console.log('  • Gemini CLI: ~/.gemini/settings.json');
    console.log('  • Cursor: Platform-specific configuration');
    console.log('  • Claude Code: Platform-specific configuration');
    console.log('\nPlease install at least one supported AI agent and try again.');
  }
  
  /**
   * Finds which providers contain the specified MCP server
   */
  private async findMCPServerInProviders(providers: AgentProvider[], serverName: string): Promise<Array<{ provider: AgentProvider; serverId: string }>> {
    const found: Array<{ provider: AgentProvider; serverId: string }> = [];
    
    for (const provider of providers) {
      try {
        const hasServer = await provider.hasMCPServer(serverName, this.options.configDir);
        if (hasServer) {
          found.push({ provider, serverId: serverName });
        }
      } catch (error) {
        // Ignore errors when checking individual providers
        ui.warn(`⚠️  Warning: Could not check ${provider.name} for server '${serverName}': ${error}`);
      }
    }
    
    return found;
  }
  
  /**
   * Prints dry-run preview of the removal operation
   */
  private printDryRunPreview(providersWithServer: Array<{provider: AgentProvider; serverId: string}>, removalConfig: RemovalConfig): void {
    ui.info('\n🔎 Dry-run: planned removal operation');
    ui.info('='.repeat(40));
    ui.info('MCP server to remove:');
    ui.info(`  • Server ID: ${removalConfig.mcpServerId}`);
    ui.info('\nAgents that will be affected:');
    providersWithServer.forEach(({provider}) => ui.info(`  • ${provider.name}`));
    ui.info('\nBackup behavior:');
    ui.info(`  • Backups ${this.options.backup ? 'will' : 'will not'} be created before removal`);
    ui.info('\nNote: this is a preview only. No files will be modified.');
  }
  
  /**
   * Confirms the removal operation with the user
   */
  private async confirm(providersWithServer: Array<{provider: AgentProvider; serverId: string}>, removalConfig: RemovalConfig): Promise<boolean> {
    ui.info('\n🗑️  Removal Summary');
    ui.info('='.repeat(40));
    ui.info('The following MCP server configuration will be removed:');
    ui.info(`  • Server ID: ${removalConfig.mcpServerId}`);
    ui.info('\nFrom these agents:');
    providersWithServer.forEach(({provider}) => ui.info(`  • ${provider.name}`));
    
    ui.info('\n⚠️  Important:');
    if (this.options.backup) {
      ui.info('  • Backup files will be created before removal');
      ui.info('  • This operation can be rolled back if needed');
    } else {
      ui.info('  • No backup files will be created (explicitly requested)');
      ui.info('  • Rollback will be limited or unavailable');
    }
    ui.info('  • Other MCP servers in these agents will not be affected');
    
    const inquirer = await getInquirer();
    const { confirmed } = await inquirer.prompt([
      { 
        type: 'confirm', 
        name: 'confirmed', 
        message: 'Apply these changes?', 
        default: true 
      }
    ]);
    return confirmed;
  }
  
  /**
   * Removes the MCP server from the specified agents
   */
  private async removeFromAgents(
    removalConfig: RemovalConfig,
    providersWithServer: Array<{provider: AgentProvider; serverId: string}>
  ): Promise<void> {
    ui.info(`\n🗑️  Removing MCP server '${removalConfig.mcpServerId}' from ${providersWithServer.length} agent(s)...`);
    
    // Get the actual provider instances
    const providersToRemoveFrom = providersWithServer.map(({provider}) => provider);
    
    const removalResults = await defaultRegistry.removeFromAllDetectedAgents(
      removalConfig,
      providersToRemoveFrom,
      true // Enable rollback on any failure
    );
    
    // Report results
    const removalSummary = this.summarizeRemovalResults(removalResults);
    
    if (removalSummary.successful > 0) {
      ui.info(`\n✅ Successfully removed from ${removalSummary.successful} agent(s):`);
      for (const result of removalResults.filter(r => r.success)) {
        ui.info(`  • ${result.provider.name}`);
        if (result.backupPath) {
          ui.info(`    └─ Backup created: ${result.backupPath}`);
        }
      }
    }
    
    if (removalSummary.notFound > 0) {
      ui.info(`\n⚠️  Server not found in ${removalSummary.notFound} agent(s):`);
      for (const result of removalResults.filter(r => !r.found)) {
        ui.info(`  • ${result.provider.name}`);
      }
    }
    
    if (removalSummary.failed > 0) {
      ui.info(`\n❌ Failed to remove from ${removalSummary.failed} agent(s):`);
      for (const failed of removalResults.filter(r => !r.success && r.found)) {
        ui.info(`  • ${failed.provider.name}: ${failed.error || 'Unknown error'}`);
      }
      
      // Propagate error so callers/tests can handle as a rejected promise
      const firstError = removalResults.find(r => !r.success && r.found)?.error || 'Removal failed';
      throw new Error(firstError);
    }
    
    ui.info('\n✨ Removal complete!');
    
    // Show summary if any operations succeeded
    if (removalSummary.successful > 0) {
      ui.info('\n📋 Removal Summary:');
      ui.info('='.repeat(40));
      ui.info(`MCP server '${removalConfig.mcpServerId}' has been removed from:`);
      for (const result of removalResults.filter(r => r.success)) {
        ui.info(`  • ${result.provider.name}`);
      }
      
      // Show backup summary
      if (removalSummary.backupPaths.length > 0) {
        ui.info('\n💾 Backup Summary:');
        ui.info('='.repeat(40));
        ui.info('The following backup files were created:');
        for (const backup of removalSummary.backupPaths) {
          ui.info(`  • ${backup.provider}: ${backup.backupPath}`);
        }
      }
    }
  }
  
  /**
   * Summarizes removal results for reporting
   */
  private summarizeRemovalResults(results: ProviderRemovalResult[]): RemovalSummary {
    const successful = results.filter(r => r.success).length;
    const failed = results.filter(r => !r.success && r.found).length;
    const notFound = results.filter(r => !r.found).length;
    
    const backupPaths = results
      .filter(r => r.backupPath)
      .map(r => ({ provider: r.provider.name, backupPath: r.backupPath! }));
    
    return {
      successful,
      failed,
      notFound,
      backupPaths,
      results
    };
  }
}

/**
 * Executes the remove command with the given options
 * 
 * This is the main entry point for the remove command.
 */
export async function executeRemoveCommand(options: RemoveCommandOptions = {}): Promise<void> {
  try {
    const command = new RemoveCommand(options);
    await command.execute();
  } catch (error) {
    console.error('\n❌ Error:', error instanceof Error ? error.message : 'Unknown error');
    // Re-throw so integration tests can assert on the failure instead of process exiting
    throw (error instanceof Error ? error : new Error(String(error)));
  }
}
