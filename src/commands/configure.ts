/**
 * Unified configuration command for Alph CLI
 * 
 * Implements Task 3: updated flags, agent filtering, confirmation, and dry-run.
 */
import { MCPServerConfig } from '../types/config';
import { defaultRegistry } from '../agents/registry';
import { AgentConfig } from '../agents/provider';
import { mapAliases, parseAgentNames, validateAgentNames } from '../utils/agents';
import { existsSync, statSync } from 'fs';
import { getInquirer } from '../utils/inquirer';

/**
 * Options for the configure command
 */
export interface ConfigureCommandOptions {
  /** MCP server endpoint URL (e.g., https://async.link/mcp/server-id) */
  mcpServerEndpoint?: string;
  /** Authentication token for Authorization header */
  bearer?: string;
  /** Transport type (http, sse, or stdio) */
  transport?: 'http' | 'sse' | 'stdio';
  /** Optional explicit MCP server id/name */
  name?: string;
  /** Run interactive wizard */
  interactive?: boolean;
  /** Agents filter (names or comma-separated list) */
  agents?: string[] | string;
  /** Custom config directory (default: use global agent config locations) */
  configDir?: string;
  /** Skip confirmation */
  yes?: boolean;
  /** Preview changes without writing */
  dryRun?: boolean;
  /** Command for stdio transport */
  command?: string;
  /** Working directory for stdio transport */
  cwd?: string;
  /** Command arguments for stdio transport */
  args?: string[];
  /** Environment variables for stdio transport */
  env?: Record<string, string>;
  /** HTTP headers for http/sse transport */
  headers?: Record<string, string>;
  /** Request timeout in milliseconds */
  timeout?: number;
  /** Whether to create backups when configuring (defaults to true) */
  backup?: boolean;
  /** Opt out of default-on STDIO tool installation */
  noInstall?: boolean;
  /** Preferred installer for STDIO tools */
  installManager?: 'npm' | 'brew' | 'pipx' | 'cargo' | 'auto';
  /** Quiet output (suppress info banners; show only final summary) */
  quiet?: boolean;

  // Proxy flags (Codex bridging to remote via local STDIO proxy)
  proxyRemoteUrl?: string;
  proxyTransport?: 'http' | 'sse';
  proxyBearer?: string;
  proxyHeader?: string[]; // repeated "K: V"
}

/**
 * Unified configuration command implementation
 */
export class ConfigureCommand {
  private options: Required<ConfigureCommandOptions>;
  
  constructor(options: ConfigureCommandOptions = {}) {
    // Optional argv fallback (disabled by default to avoid test interference).
    // Enable by setting ALPH_ARGV_FALLBACK=1 when invoking the CLI directly.
    const enableArgvFallback = process?.env?.['ALPH_ARGV_FALLBACK'] === '1';
    const argv = (enableArgvFallback && Array.isArray(process.argv)) ? process.argv.slice(2) : [];
    const getArgValue = (name: string): string | undefined => {
      if (!enableArgvFallback) return undefined;
      const idx = argv.indexOf(name);
      if (idx >= 0 && idx + 1 < argv.length) return argv[idx + 1];
      const pref = argv.find(a => a.startsWith(name + '='));
      if (pref) return pref.split('=').slice(1).join('=');
      return undefined;
    };

    const fallbackEndpoint = options.mcpServerEndpoint ? undefined : getArgValue('--mcp-server-endpoint');
    const fallbackBearer = options.bearer ? undefined : getArgValue('--bearer');
    const fallbackAgents = options.agents ? undefined : getArgValue('--agents');
    const fallbackCommand = options.command ? undefined : getArgValue('--command');
    const fallbackCwd = options.cwd ? undefined : getArgValue('--cwd');

    this.options = {
      mcpServerEndpoint: options.mcpServerEndpoint ?? fallbackEndpoint ?? '',
      bearer: options.bearer ?? fallbackBearer ?? '',
      transport: options.transport ?? 'http',
      name: options.name ?? '',
      interactive: options.interactive ?? false,
      agents: Array.isArray(options.agents)
        ? options.agents
        : (options.agents ?? fallbackAgents ?? ''),
      configDir: options.configDir ?? '',
      yes: options.yes ?? false,
      dryRun: options.dryRun ?? false,
      command: options.command ?? fallbackCommand ?? '',
      cwd: options.cwd ?? fallbackCwd ?? '',
      args: options.args ?? [],
      env: options.env ?? {},
      headers: options.headers ?? {},
      timeout: options.timeout ?? 0,
      backup: options.backup ?? true,
      noInstall: options.noInstall ?? (process.env['ALPH_NO_INSTALL'] === '1'),
      installManager: options.installManager ?? ((process.env['ALPH_INSTALL_MANAGER'] as any) || 'auto'),
      quiet: options.quiet ?? false,
      proxyRemoteUrl: options.proxyRemoteUrl,
      proxyTransport: options.proxyTransport,
      proxyBearer: options.proxyBearer,
      proxyHeader: options.proxyHeader
    } as Required<ConfigureCommandOptions>;
  }
  
  /**
   * Dynamically import inquirer to handle ESM/CommonJS compatibility
   * inquirer v9+ is ES Modules only, but this project uses CommonJS
   */
  
  
  /**
   * Executes the configure command
   */
  public async execute(): Promise<void> {
    this.validateOptions();
    const start = Date.now();
    if (!this.options.quiet) {
      const { logger } = await import('../logger.js');
      logger.logStructured('info', { message: 'configure:start', context: { transport: this.options.transport, agents: this.options.agents } });
    }

    // Interactive path or default with no flags
    const noFlags = !this.options.mcpServerEndpoint && !this.options.bearer && !this.options.agents && !this.options.dryRun && !this.options.yes;
    if (this.options.interactive || noFlags) {
      // Defer to interactive wizard
      const { startInteractiveConfig } = await import('./interactive.js');
      await startInteractiveConfig({
        mcpServerEndpoint: this.options.mcpServerEndpoint,
        transport: this.options.transport,
        // Pass bearer correctly so the wizard can reuse it
        bearer: this.options.bearer || undefined,
        agents: this.options.agents as any,
      } as any);
      return;
    }

    // Manual mode
    // 1) Detect available agents (with optional filter)
    const filterInput = mapAliases(parseAgentNames(this.options.agents));
    const { valid, invalid } = validateAgentNames(filterInput);
    if (invalid.length > 0) {
      throw new Error(`Unknown agent name(s): ${invalid.join(', ')}`);
    }
    const providerFilter = valid.length > 0 ? valid : undefined;
    
    // Only show detection message if not in interactive mode
    if (!this.options.interactive && !this.options.quiet) {
      console.log('\n[INFO] Detecting available AI agents...');
    }
    
    const detectionResults = await defaultRegistry.detectAvailableAgents(providerFilter, this.options.configDir);
    const detectedProviders = defaultRegistry.getDetectedProviders(detectionResults);
    if (detectedProviders.length === 0) {
      // Fallback: if the user explicitly requested agents, proceed to configure them
      // even if no existing config files were detected. Providers will create files.
      if (valid.length > 0) {
        console.log('\n[INFO] No existing configuration files detected; will create new ones for requested agents.');
      } else {
        this.handleNoAgentsDetected();
        return;
      }
    }

    // 2) Build MCP server configuration
    const mcpConfig = await this.getMCPConfig();
    if (!mcpConfig) {
      console.log('\n[CANCELLED] Configuration aborted by user');
      return;
    }

    // 3) Build AgentConfig for providers
    // Apply proxy flags when provided
    let transport = this.options.transport;
    let endpoint = this.options.mcpServerEndpoint;
    let bearer = this.options.bearer;
    let extraHeaders: Record<string, string> = {};
    if (this.options.proxyRemoteUrl) {
      endpoint = this.options.proxyRemoteUrl;
      if (this.options.proxyTransport) transport = this.options.proxyTransport;
      if (this.options.proxyBearer) bearer = this.options.proxyBearer;
      if (Array.isArray(this.options.proxyHeader)) {
        for (const h of this.options.proxyHeader) {
          const idx = h.indexOf(':');
          if (idx > 0) {
            const k = h.slice(0, idx).trim();
            const v = h.slice(idx + 1).trim();
            if (k) extraHeaders[k] = v;
          }
        }
      }
    }
    // Apply default header policy if bearer present
    const computedHeaders: Record<string, string> = { ...(this.options.headers || {}), ...extraHeaders };
    if (bearer && (transport === 'http' || transport === 'sse')) {
      if (!computedHeaders['Authorization']) {
        computedHeaders['Authorization'] = `Bearer ${bearer}`;
      }
    }
    
    const agentConfig: AgentConfig = {
      mcpServerId: (this.options.name && this.options.name.trim()) || this.extractServerId((endpoint || mcpConfig.httpUrl || '')),
      mcpServerUrl: (endpoint || mcpConfig.httpUrl || ''),
      mcpAccessKey: bearer,
      transport,
      headers: computedHeaders,
      env: this.options.env,
      command: this.options.command,
      args: this.options.args,
      cwd: this.options.cwd,
      ...(Number.isFinite(this.options.timeout) && this.options.timeout > 0 ? { timeout: this.options.timeout } : {}),
      configDir: this.options.configDir
    };

    // 4) Dry-run preview
    if (this.options.dryRun) {
      this.printDryRunPreview(detectedProviders.map(p => p.name), agentConfig);
      if (!this.options.quiet) {
        const { logger } = await import('../logger.js');
        logger.logStructured('info', { message: 'configure:dry-run', context: { providers: detectedProviders.map(p => p.name) } });
      }
      return;
    }

    // 5) Preview redacted diff and confirmation (unless --yes)
    if (!this.options.yes) {
      if ((agentConfig.transport || 'http') === 'stdio') {
        console.log('\n[INFO] STDIO selected: tool discovery/install and health checks will be handled in a later step.');
      }
      try {
        const { computeInstallPreview } = await import('../utils/preview.js');
        console.log('\n[INFO] Preview of changes (redacted):');
        for (const p of detectedProviders) {
          const effectiveConfig = await this.__mapConfigForPreview(p.name, agentConfig);
          const preview = await computeInstallPreview(p, effectiveConfig);
          if (!preview) continue;
          console.log(`\n— ${p.name} (${preview.configPath})`);
          console.log('Before (server snippet):');
          console.log(preview.snippetBefore);
          console.log('After (server snippet):');
          console.log(preview.snippetAfter);
        }
      } catch {
        // non-fatal if preview fails
      }

      const confirmed = await this.confirm(agentConfig, detectedProviders.map(p => p.name));
      if (!confirmed) {
        console.log('\n[CANCELLED] Configuration cancelled.');
        return;
      }
    }

    // 6) Configure agents with rollback on any failure
    try {
      await this.configureAgents(agentConfig, detectionResults);
      try {
        const { telemetry } = await import('../utils/telemetry.js');
        telemetry.recordConfigure(detectionResults.length, 0, Date.now() - start);
      } catch {}
    } catch (e) {
      try {
        const { telemetry } = await import('../utils/telemetry.js');
        telemetry.recordConfigure(0, 1, Date.now() - start);
      } catch {}
      throw e;
    }
  }
  
  /**
   * Validates command options
   */
  private validateOptions(): void {
    if (!this.options.interactive) {
      // In manual mode, endpoint is required for http/sse unless dry-run.
      const t = this.options.transport;
      const requiresUrl = (t === 'http' || t === 'sse');
      if (requiresUrl && !this.options.mcpServerEndpoint && !this.options.dryRun) {
        throw new Error('--mcp-server-endpoint is required for http/sse in non-interactive mode');
      }
    }

    // Validate URL only when provided and transport expects a URL
    if (this.options.mcpServerEndpoint && (this.options.transport === 'http' || this.options.transport === 'sse')) {
      try {
        new URL(this.options.mcpServerEndpoint);
      } catch (e) {
        throw new Error(`Invalid MCP server endpoint URL: ${this.options.mcpServerEndpoint}`);
      }
    }

    // Validate configDir when provided
    if (this.options.configDir && this.options.configDir.trim()) {
      const dir = this.options.configDir.trim();
      if (!existsSync(dir)) {
        throw new Error(`Configuration directory does not exist: ${dir}`);
      }
      try {
        const st = statSync(dir);
        if (!st.isDirectory()) {
          throw new Error(`Configuration path is not a directory: ${dir}`);
        }
      } catch (e) {
        if (e instanceof Error) throw e;
        throw new Error(`Unable to access configuration directory: ${dir}`);
      }
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
    console.log('  • Codex CLI: ~/.codex/config.toml');
    console.log('\nPlease install at least one supported AI agent and try again.');
  }
  
  /**
   * Gets MCP server configuration, either from options or interactively
   */
  private async getMCPConfig(): Promise<MCPServerConfig | null> {
    // If endpoint is already provided via options, use it directly without prompting
    if (this.options.mcpServerEndpoint) {
      return {
        name: (this.options.name && this.options.name.trim()) || this.extractServerId(this.options.mcpServerEndpoint),
        httpUrl: this.options.mcpServerEndpoint,
        transport: this.options.transport,
        disabled: false,
        autoApprove: []
      };
    }
    // If transport is stdio and no endpoint provided, return a minimal config without prompting
    if (this.options.transport === 'stdio') {
      return {
        name: (this.options.name && this.options.name.trim()) || 'default-server',
        transport: this.options.transport,
        disabled: false,
        autoApprove: []
      };
    }
    // If this is a dry-run and no endpoint was provided, avoid prompting
    if (this.options.dryRun && !this.options.mcpServerEndpoint) {
      return {
        name: (this.options.name && this.options.name.trim()) || 'default-server',
        httpUrl: '',
        transport: this.options.transport,
        disabled: false,
        autoApprove: []
      };
    }

    // Interactive prompt (fallback)
    const inquirer = await getInquirer();
    const { httpUrl } = await inquirer.prompt([
      {
        type: 'input',
        name: 'httpUrl',
        message: 'Enter the MCP server endpoint URL:',
        validate: (input: string) => {
          try { new URL(input); return true; } catch { return 'Please enter a valid URL.'; }
        }
      }
    ]);
    return {
      name: (this.options.name && this.options.name.trim()) || this.extractServerId(httpUrl),
      httpUrl,
      transport: this.options.transport,
      disabled: false,
      autoApprove: []
    };
  }
  
  /**
   * Extracts server ID from MCP server endpoint URL
   */
  private extractServerId(endpoint: string): string {
    try {
      const url = new URL(endpoint);
      // Extract the last path segment as the server ID
      const segments = url.pathname.split('/').filter(Boolean);
      return segments[segments.length - 1] || 'default-server';
    } catch (e) {
      return 'default-server';
    }
  }
  
  /**
   * Configures only the selected agents with the given configuration
   */
  private async configureAgents(
    agentConfig: AgentConfig,
    detectionResults: any
  ): Promise<void> {
    const detectedProviders = defaultRegistry.getDetectedProviders(detectionResults);

    // Filter providers based on user's agent selection. If none detected,
    // fallback to registered providers matching the request so we can create files.
    let selectedProviders = detectedProviders;
    if (this.options.agents && typeof this.options.agents === 'string' && this.options.agents.trim()) {
      const requestedAgents = mapAliases(parseAgentNames(this.options.agents));
      selectedProviders = detectedProviders.filter(provider => requestedAgents.includes(provider.name));
      if (selectedProviders.length === 0) {
        // Fallback: use registered providers matching the request
        const all = defaultRegistry.getAllProviders();
        selectedProviders = all.filter(p => requestedAgents.includes(p.name));
      }
      
      if (selectedProviders.length === 0) {
        console.log(`\n⚠️  None of the requested agents (${requestedAgents.join(', ')}) were detected.`);
        if (detectedProviders.length > 0) {
          console.log('Detected agents:', detectedProviders.map(p => p.name).join(', '));
        }
        console.log('Proceeding to create new configuration files for requested agents.');
      }
    }
    
    // Only show detailed configuration info if not in interactive mode
    if (!this.options.interactive) {
      console.log(`\n🔧 Configuring ${selectedProviders.length} selected agent(s)...`);
      selectedProviders.forEach(p => console.log(`  • ${p.name}`));
    }
    
    const configResults = await defaultRegistry.configureAllDetectedAgents(
      agentConfig,
      selectedProviders, // Use filtered providers, not all detected ones
      true, // Rollback on any failure
      this.options.backup
    );
    
    // Report results with detailed information only if not in interactive mode
    const configSummary = defaultRegistry.summarizeConfigurationResults(configResults);
    
    if (configSummary.successful > 0) {
      if (!this.options.interactive) {
        console.log(`\n✅ Successfully configured ${configSummary.successful} agent(s):`);
        for (const result of configResults.filter(r => r.success)) {
          console.log(`  • ${result.provider.name}`);
          // Try to get the configuration file path from the provider
          try {
            const configPath = await result.provider.detect(agentConfig.configDir);
            if (configPath) {
              console.log(`    └─ Config file: ${configPath}`);
            }
          } catch (e) {
            // Ignore errors in getting config path for display purposes
          }
          if (result.backupPath) {
            console.log(`    └─ Backup created: ${result.backupPath}`);
          }
        }
      } else {
        // In interactive mode, show a simpler success message
        console.log(`\n✅ Successfully configured ${configSummary.successful} agent(s)`);
      }
    }
    
    if (configSummary.failed > 0) {
      if (!this.options.interactive) {
        console.log(`\n❌ Failed to configure ${configSummary.failed} agent(s):`);
        for (const failed of configResults.filter(r => !r.success)) {
          console.log(`  • ${failed.provider.name}: ${failed.error || 'Unknown error'}`);
        }
      } else {
        // In interactive mode, show a simpler failure message
        console.log(`\n❌ Failed to configure ${configSummary.failed} agent(s)`);
      }

      // Propagate error so callers/tests can handle as a rejected promise
      const firstError = configResults.find(r => !r.success)?.error || 'Configuration failed';
      throw new Error(firstError);
    }
    
    if (!this.options.interactive) {
      console.log('\n✨ Configuration complete!');
      
      // Show summary of all configured agents
      if (configSummary.successful > 0) {
        console.log('\n📋 Configuration Summary:');
        console.log('='.repeat(40));
        console.log('The following agents have been configured with your MCP server:');
        for (const result of configResults.filter(r => r.success)) {
          console.log(`  • ${result.provider.name}`);
          // Try to get the configuration file path from the provider
          try {
            const configPath = await result.provider.detect(agentConfig.configDir);
            if (configPath) {
              console.log(`    └─ Configuration file: ${configPath}`);
            }
          } catch (e) {
            // Ignore errors in getting config path for display purposes
          }
        }
        
        // Show backup summary
        if (configSummary.backupPaths.length > 0) {
          console.log('\n💾 Backup Summary:');
          console.log('='.repeat(40));
          console.log('The following backup files were created:');
          for (const backup of configSummary.backupPaths) {
            console.log(`  • ${backup.provider}: ${backup.backupPath}`);
          }
        }
      }
    } else {
      // In interactive mode, show a simpler completion message
      console.log('\n✨ Configuration complete!');
    }
  }

  private redact(value?: string): string {
    if (!value) return '';
    const last4 = value.slice(-4);
    return `****${last4}`;
  }

  private printDryRunPreview(providers: string[], agentConfig: AgentConfig): void {
    console.log('\n🔎 Dry-run: planned configuration');
    console.log('='.repeat(40));
    console.log('Agents to configure:');
    providers.forEach(p => console.log(`  • ${p}`));
    console.log('\nMCP server:');
    const endpointDisplay = (agentConfig.transport === 'stdio') ? 'Local (STDIO)' : (agentConfig.mcpServerUrl || '');
    console.log(`  Endpoint: ${endpointDisplay}`);
    console.log(`  • ID: ${agentConfig.mcpServerId}`);
    console.log(`  • Transport: ${agentConfig.transport}`);
    if (agentConfig.mcpAccessKey) {
      console.log(`  • Access Key: ${this.redact(agentConfig.mcpAccessKey)} (redacted)`);
    }
    console.log('\nNote: this is a preview only. No files were modified.');
  }

  private async confirm(agentConfig: AgentConfig, providers: string[]): Promise<boolean> {
    console.log('\n🔍 Configuration Summary');
    console.log('='.repeat(40));
    console.log('The following agents will be configured:');
    providers.forEach(p => console.log(`  • ${p}`));
    console.log('\nMCP Server Configuration:');
    const endpointDisplay2 = (agentConfig.transport === 'stdio') ? 'Local (STDIO)' : (agentConfig.mcpServerUrl || '');
    console.log(`  Endpoint: ${endpointDisplay2}`);
    console.log(`  • ID: ${agentConfig.mcpServerId}`);
    console.log(`  • Transport: ${agentConfig.transport}`);
    if (agentConfig.mcpAccessKey) {
      console.log(`  • Access Key: ${this.redact(agentConfig.mcpAccessKey)} (redacted)`);
    }
    const inquirer = await getInquirer();
    const { confirmed } = await inquirer.prompt([
      { type: 'confirm', name: 'confirmed', message: 'Apply these changes?', default: true }
    ]);
    return confirmed;
  }

  // Provider-specific preview mapping: show Codex as STDIO via Supergateway when remote proxy flags are used
  private async __mapConfigForPreview(providerName: string, config: AgentConfig): Promise<AgentConfig> {
    if (providerName === 'Codex CLI' && (config.transport === 'http' || config.transport === 'sse')) {
      const { buildSupergatewayArgs } = await import('../utils/proxy.js');
      const headersRecord = config.headers || {};
      let bearer = config.mcpAccessKey;
      const authHeader = headersRecord['Authorization'] || (headersRecord as any)['authorization'];
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
      return {
        ...config,
        transport: 'stdio',
        command: 'npx',
        args: ['-y', 'supergateway', ...argv],
      };
    }
    return config;
  }
}

/**
 * Executes the configure command with the given options
 * 
 * This is the main entry point for the configure command.
 */
export async function executeConfigureCommand(options: ConfigureCommandOptions = {}): Promise<void> {
  try {
    const command = new ConfigureCommand(options);
    await command.execute();
  } catch (error) {
    console.error('\n❌ Error:', error instanceof Error ? error.message : 'Unknown error');
    // Re-throw so integration tests can assert on the failure instead of process exiting
    throw (error instanceof Error ? error : new Error(String(error)));
  }
}










