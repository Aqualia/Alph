// Dynamic import helper for inquirer to handle ESM/CommonJS compatibility
// inquirer v9+ is ES Modules only, but this project uses CommonJS
import { defaultRegistry } from '../agents/registry';
import { execSync } from 'child_process';
import { ConfigureCommand, ConfigureCommandOptions } from './configure';
import { MCPServerConfig } from '../types/config';
import { mapAliases, parseAgentNames, validateAgentNames } from '../utils/agents';
import { existsSync, statSync } from 'fs';
import { getInquirer } from '../utils/inquirer';
import { ui } from '../utils/ui';

/**
 * Interactive CLI interface for Alph configuration
 */
export class InteractiveConfigurator {
  private options: ConfigureCommandOptions;
  
  constructor(options: ConfigureCommandOptions = {}) {
    this.options = options;
  }
  
  /**
   * Dynamically import inquirer to handle ESM/CommonJS compatibility
   * inquirer v9+ is ES Modules only, but this project uses CommonJS
   */
  
  
  /**
   * Starts the interactive configuration process
   */
  public async start(): Promise<void> {
    await this.showWelcomeMessage();
    ui.info('🧭 Step 1 of 3: Select agents');
    
    // 1. Detect available agents
    const detectedAgents = await this.detectAgents();
    if (detectedAgents.length === 0) {
      this.showNoAgentsDetected();
      return;
    }
    
    // 2. Select agents to configure (skip prompt if pre-filled)
    let selectedAgents: string[];
    if (this.options.agents) {
      const requested = mapAliases(parseAgentNames(this.options.agents));
      const { valid } = validateAgentNames(requested);
      // Intersect with detected agents
      selectedAgents = valid.filter(v => detectedAgents.includes(v));
      if (selectedAgents.length === 0) {
        // If prefill resulted in empty set, fall back to prompting
        selectedAgents = await this.selectAgents(detectedAgents);
      } else {
        ui.info('\nUsing pre-selected agents:');
        selectedAgents.forEach(a => ui.info(`  - ${a}`));
      }
    } else {
      selectedAgents = await this.selectAgents(detectedAgents);
    }
    if (selectedAgents.length === 0) {
      ui.info('\nNo agents selected. Exiting.');
      return;
    }
    
    // 3. Get MCP server configuration (supports pre-filled endpoint & access key)
    ui.info('\n🧰 Step 2 of 3: Configure server');
    const mcpConfig = await this.getMCPConfig(selectedAgents);
    if (!mcpConfig) {
      ui.info('\nConfiguration aborted.');
      return;
    }

    // 3.5. Ask about config directory preference
    const configDirChoice = await this.getConfigDirectoryChoice();
    if (configDirChoice.cancelled) {
      ui.info('\nConfiguration cancelled.');
      return;
    }
    
    // 3.6. Ask about backup preference
    const backupPref = await this.getBackupPreference();

    // 4. Confirm configuration
    ui.info('\n📝 Step 3 of 3: Review & apply');
    const confirmed = await this.confirmConfiguration(selectedAgents, mcpConfig, backupPref);
    if (!confirmed) {
      ui.info('\nConfiguration cancelled.');
      return;
    }
    
    // Optional pre-warm for Supergateway to reduce first-run latency (Windows/Linux/macOS)
    try {
      if (selectedAgents.includes('Codex CLI') && mcpConfig.transport !== 'stdio') {
        ui.info('\n[INFO] Pre-warming local proxy (supergateway) ...');
        const { execSync } = await import('child_process');
        execSync('npx -y supergateway --help', { stdio: 'ignore' });
      }
    } catch {
      // non-fatal; continue
    }

    // 5. Apply configuration
    await this.applyConfiguration(selectedAgents, mcpConfig, configDirChoice.configDir, backupPref);
  }
  
  /**
   * Shows the welcome message and instructions
   */
  private async showWelcomeMessage(): Promise<void> {
    const { showMainBanner } = await import('../utils/banner.js');
    await showMainBanner();
    ui.info('Welcome to the Alph Configuration Wizard');
    ui.info('-'.repeat(42));
    ui.info('Configure your AI agents to work with MCP servers');
    ui.info('');
  }
  
  /**
   * Detects available agents on the system
   */
  private async detectAgents(): Promise<string[]> {
    ui.info('Detecting available AI agents...');
    
    const detectionResults = await defaultRegistry.detectAvailableAgents();
    const detectionSummary = defaultRegistry.summarizeDetectionResults(detectionResults);
    
    if (detectionSummary.detected === 0) {
      return [];
    }
    
    ui.info(`\nFound ${detectionSummary.detected} AI agent(s):`);
    detectionSummary.detectedProviders.forEach(provider => {
      ui.info(`  - ${provider}`);
    });
    
    // Only show failed detections if there are any, but don't include them in the return
    if (detectionSummary.failed > 0) {
      ui.warn(`\n${detectionSummary.failed} agent(s) could not be detected:`);
      const failedDetections = defaultRegistry.getFailedDetections(detectionResults);
      failedDetections.forEach(failed => {
        ui.warn(`  - ${failed.provider.name}: ${failed.error || 'Detection failed'}`);
      });
    }

    return detectionSummary.detectedProviders;
  }
  
  /**
   * Shows a helpful message when no agents are detected
   */
  private showNoAgentsDetected(): void {
    ui.info('\n? No supported AI agents detected on this system.');
    ui.info('\nSupported agents and their default locations:');
    ui.info('  \u0007 Gemini CLI: ~/.gemini/settings.json');
    ui.info('  \u0007 Cursor: Platform-specific configuration');
    ui.info('  \u0007 Claude Code: Platform-specific configuration');
    ui.info('  \u0007 Codex CLI: ~/.codex/config.toml');
    ui.info('\nPlease install at least one supported AI agent and try again.');
  }
  
  /**
   * Prompts the user to select agents
   */
  private async selectAgents(detectedAgents: string[]): Promise<string[]> {
    const inquirer = await getInquirer();
    const { selected } = await inquirer.prompt([
      {
        type: 'checkbox',
        name: 'selected',
        message: 'Select which agents to configure.\nAll detected agents are preselected; deselect any you don\'t want to configure.\nKeys: Space=toggle, Enter=continue, A=all, I=invert.',
        choices: detectedAgents.map(a => ({ name: a, value: a, checked: true })),
        pageSize: Math.min(10, detectedAgents.length),
        prefix: '?? '
      }
    ]);
    if (!Array.isArray(selected) || selected.length === 0) return [];
    return selected as string[];
  }
  
  /**
   * Gets MCP server configuration from user inputs
   */
  private async getMCPConfig(selectedAgents: string[]): Promise<MCPServerConfig | null> {
    const supportsBearer = true; // generic prompt for bearer across HTTP/SSE
    const inquirer = await getInquirer();
    
    const prompts: any[] = [
      {
        type: 'input',
        name: 'name',
        message: 'Give this MCP configuration a name:',
        default: 'default-server',
        prefix: '> ',
        validate: (s: string) => !!s && /[A-Za-z0-9-_]/.test(s) || 'Name cannot be empty.'
      },
      {
        type: 'list',
        name: 'transport',
        message: 'How do you want to connect to the MCP server?',
        choices: [
          { name: 'Local tool (STDIO)', value: 'stdio' },
          { name: 'Remote over HTTP', value: 'http' },
          { name: 'Remote over SSE', value: 'sse' }
        ],
        default: (Array.isArray(selectedAgents) && selectedAgents.includes('Codex CLI')) ? 'stdio' : 'http',
        prefix: '> '
      },
      {
        type: 'input',
        name: 'httpUrl',
        message: 'Enter the MCP server endpoint URL:',
        when: (ans: any) => ans.transport !== 'stdio',
        prefix: '?? ',
        validate: (input: string) => {
          try { new URL(input); return true; } catch { return 'Please enter a valid URL.'; }
        }
      },
      ...(supportsBearer
        ? [{
            type: 'password',
            name: 'bearer',
            message: 'Authentication Token (Optional):',
            prefix: '> ',
            mask: '*',
            validate: () => true,
            suffix: ' (Leave blank for public servers)'
          }]
        : [])
    ];
    
    const answers = await inquirer.prompt(prompts);
    
    // If user provided a bearer token interactively, store it for later application
    if (!this.options.bearer && answers['bearer']) {
      this.options.bearer = answers['bearer'];
    }
    
    if (answers['transport'] === 'stdio') {
      // STDIO flow: pick tool, ensure installed, health check, set command/args
      const { loadToolsCatalog, detectTool, installTool, runHealthCheck, chooseDefaultInvocation } = await import('../utils/tools.js');
      const catalog = loadToolsCatalog();
      if (!catalog.tools || catalog.tools.length === 0) {
        throw new Error('No STDIO tools found in catalog');
      }
      const customChoice = { name: 'Custom command.', value: '__custom__' } as const;
      // Deduplicate tools by id
      const uniqueIds = new Set<string>();
      const uniqueTools = catalog.tools.filter(t => {
        if (uniqueIds.has(t.id)) return false;
        uniqueIds.add(t.id);
        return true;
      });
      // Show custom at top always
      const toolChoices = [customChoice, ...uniqueTools.map(t => ({ name: t.id, value: t.id }))];
      const { toolId } = await inquirer.prompt({
        type: 'list',
        name: 'toolId',
        message: 'Select a local MCP server tool to use:',
        choices: toolChoices,
        default: (Array.isArray(selectedAgents) && selectedAgents.includes('Codex CLI')) ? customChoice.value : (toolChoices[0]?.value ?? customChoice.value),
        prefix: '> '
      });
      if (toolId === '__custom__') {
        const custom = await inquirer.prompt([
          { type: 'input', name: 'cmd', message: 'Command (e.g., npx):', prefix: '> ', validate: (s: string) => !!s || 'Command is required.' },
          { type: 'input', name: 'args', message: 'Arguments (comma or space separated):', prefix: '> ', default: '' }
        ]);
        const args = (custom.args as string)
          .split(/[\s,]+/)
          .map(s => s.trim())
          .filter(Boolean);
        // Advanced options (optional)
        const { showAdvanced } = await inquirer.prompt({ type: 'confirm', name: 'showAdvanced', message: 'Configure advanced options (timeout, working directory, extra environment variables)?', default: false });
        let advEnv: Record<string, string> | undefined;
        let advCwd: string | undefined;
        let advTimeout: number | undefined;
        if (showAdvanced) {
          const adv = await inquirer.prompt([
            { type: 'input', name: 'cwd', message: 'Working directory (optional):', prefix: '> ', default: '' },
            { type: 'input', name: 'timeout', message: 'Timeout ms (optional, e.g., 60000):', prefix: '> ', default: '' },
            { type: 'input', name: 'envPairs', message: 'Extra env (key=value,comma-separated):', prefix: '> ', default: 'EXAMPLE_KEY=example' }
          ]);
          advCwd = String(adv.cwd || '').trim() || undefined;
          const t = Number(String(adv.timeout || '').trim());
          advTimeout = Number.isFinite(t) && t > 0 ? t : undefined;
          const envPairs = String(adv.envPairs || '').split(',').map(s => s.trim()).filter(Boolean);
          const env: Record<string, string> = {};
          for (const pair of envPairs) {
            const [k, v] = pair.split('=');
            if (k && v) env[k.trim()] = v.trim();
          }
          advEnv = Object.keys(env).length > 0 ? env : undefined;
        }
        return {
          name: answers['name'],
          command: custom.cmd,
          args,
          transport: 'stdio',
          disabled: false,
          autoApprove: [],
          ...(advEnv ? { env: advEnv } : {}),
          ...(advCwd ? { cwd: advCwd } : {}),
          ...(advTimeout ? { timeout: advTimeout } : {})
        };
      }
      
      const tool = catalog.tools.find(t => t.id === toolId)!;
      let det = detectTool(tool);
      if (!det.installed) {
        const optOut = (this.options as any)['noInstall'] === true || process.env['ALPH_NO_INSTALL'] === '1';
        if (optOut) {
          console.log('\nSTDIO tool not found and installation is disabled (--no-install or ALPH_NO_INSTALL=1).');
          throw new Error('Aborting: STDIO tool is not installed. Re-run without --no-install to install automatically.');
        }
        await installTool(tool, (this.options as any)['installManager']);
        det = detectTool(tool);
        if (!det.installed) {
          throw new Error('STDIO tool installation appears to have failed; command not found after install.');
        }
      }
      let invoke = chooseDefaultInvocation(tool, det);
      // Offer quick recommended settings path if a tool is selected and detected
      const { quick } = await inquirer.prompt({ type: 'confirm', name: 'quick', message: 'Use recommended settings?', default: true });
      if (quick) {
        return {
          name: answers['name'],
          command: invoke.command,
          args: invoke.args,
          transport: 'stdio',
          disabled: false,
          autoApprove: []
        };
      }
      // Offer customization of command/args after detection
      const { customize } = await inquirer.prompt({ type: 'confirm', name: 'customize', message: 'Customize command/args?', default: (Array.isArray(selectedAgents) && selectedAgents.includes('Codex CLI')) });
      if (customize) {
        const edited = await inquirer.prompt([
          { type: 'input', name: 'cmd', message: 'Command:', prefix: '> ', default: invoke.command, validate: (s: string) => !!s || 'Command is required.' },
          { type: 'input', name: 'args', message: 'Arguments (comma or space separated):', prefix: '> ', default: (invoke.args || []).join(' ') }
        ]);
        const args = (edited.args as string)
          .split(/[\s,]+/)
          .map(s => s.trim())
          .filter(Boolean);
        invoke = { command: edited.cmd, args };
      } else {
        // Run health check only if using dedicated binary; skip when falling back to generic runners/npx
        const usingDedicatedBin = invoke.command === tool.bin && !['npx','node','php','python','python3'].includes(tool.bin);
        if (usingDedicatedBin) {
          const health = runHealthCheck(tool);
          if (!health.ok) {
            // Offer automatic fallback to a discovery command (e.g., npx) if available
            const fallback = (tool.discovery?.commands || []).map(c => c).find(c => c.startsWith('npx ') || c.startsWith('node ') || c.startsWith('php '));
            if (fallback) {
              const { acceptFallback } = await inquirer.prompt({ type: 'confirm', name: 'acceptFallback', message: `Health check failed for '${tool.bin}'. Use fallback invocation '${fallback}' instead?`, default: true });
              if (acceptFallback) {
                const parts = fallback.split(' ').filter(Boolean);
                const head = parts[0] ?? '';
                const rest = parts.length > 1 ? parts.slice(1) : [];
                if (!head) {
                  throw new Error('Invalid fallback invocation');
                }
                invoke = { command: head, args: rest };
              } else {
                throw new Error(`STDIO tool health check failed: ${health.message || 'unknown error'}`);
              }
            } else {
              throw new Error(`STDIO tool health check failed: ${health.message || 'unknown error'}`);
            }
          }
        }
      }

      // Pre-warm generic runners (like npx/yarn dlx/pnpm dlx) so Codex doesn't hit first-run timeouts
      try {
        const cmdLower = (invoke.command || '').toLowerCase();
        const argsLower = (invoke.args || []).map(a => (a || '').toLowerCase());
        const isNPX = cmdLower.endsWith('npx') || cmdLower.endsWith('npx.cmd');
        const isYarnDLX = (cmdLower === 'yarn' || cmdLower.endsWith('yarn.cmd')) && argsLower[0] === 'dlx';
        const isPnpmDLX = (cmdLower === 'pnpm' || cmdLower.endsWith('pnpm.cmd')) && argsLower[0] === 'dlx';
        if (isNPX || isYarnDLX || isPnpmDLX) {
          const warmArgs = [...(invoke.args || []), '--help'];
          ui.info('\nPreparing the tool for first use. This first run can take a minute.');
          execSync([invoke.command, ...warmArgs].join(' '), { stdio: 'ignore' });
        }
      } catch {
        // Non-fatal; continue without blocking if pre-warm fails
      }

      // Prompt for tool-specific env vars if defined
      if (tool.meta?.envPrompts && Array.isArray(tool.meta.envPrompts) && tool.meta.envPrompts.length > 0) {
        const envAnswers: Record<string, string> = {};
        for (const e of tool.meta.envPrompts) {
          const ans = await inquirer.prompt({
            type: e.secret ? 'password' : 'input',
            name: 'val',
            message: e.label || e.key,
            mask: e.secret ? '*' : undefined,
            validate: (v: string) => (e.optional || (v && v.trim().length > 0)) ? true : `${e.key} is required.`
          });
          if (ans.val && String(ans.val).trim().length > 0) envAnswers[e.key] = String(ans.val).trim();
        }
        return {
          name: answers['name'],
          command: invoke.command,
          args: invoke.args,
          transport: 'stdio',
          disabled: false,
          autoApprove: [],
          env: envAnswers
        } as any;
      }
      // Advanced options (optional)
      const { showAdvanced } = await inquirer.prompt({ type: 'confirm', name: 'showAdvanced', message: 'Configure advanced options (timeout, working directory, extra environment variables)?', default: false });
      let advEnv2: Record<string, string> | undefined;
      let advCwd2: string | undefined;
      let advTimeout2: number | undefined;
      if (showAdvanced) {
        const adv = await inquirer.prompt([
          { type: 'input', name: 'cwd', message: 'Working directory (optional):', prefix: '> ', default: '' },
          { type: 'input', name: 'timeout', message: 'Timeout ms (optional, e.g., 60000):', prefix: '> ', default: '' },
          { type: 'input', name: 'envPairs', message: 'Extra env (key=value,comma-separated):', prefix: '> ', default: 'EXAMPLE_KEY=example' }
        ]);
        advCwd2 = String(adv.cwd || '').trim() || undefined;
        const t = Number(String(adv.timeout || '').trim());
        advTimeout2 = Number.isFinite(t) && t > 0 ? t : undefined;
        const envPairs = String(adv.envPairs || '').split(',').map(s => s.trim()).filter(Boolean);
        const env: Record<string, string> = {};
        for (const pair of envPairs) {
          const [k, v] = pair.split('=');
          if (k && v) env[k.trim()] = v.trim();
        }
        advEnv2 = Object.keys(env).length > 0 ? env : undefined;
      }
      return {
        name: answers['name'],
        command: invoke.command,
        args: invoke.args,
        transport: 'stdio',
        disabled: false,
        autoApprove: [],
        ...(advEnv2 ? { env: advEnv2 } : {}),
        ...(advCwd2 ? { cwd: advCwd2 } : {}),
        ...(advTimeout2 ? { timeout: advTimeout2 } : {})
      };
    } else {
      // Ensure HTTPS prefix is added to the URL if missing
      let httpUrl = this.options.mcpServerEndpoint || answers['httpUrl'];
      if (httpUrl && !httpUrl.startsWith('http://') && !httpUrl.startsWith('https://')) {
        httpUrl = `https://${httpUrl}`;
      }
      // Advanced options for HTTP/SSE (optional)
      const { showAdvanced } = await inquirer.prompt({ type: 'confirm', name: 'showAdvanced', message: 'Configure advanced options (timeout, extra HTTP headers)?', default: false });
      let advHeaders: Record<string, string> | undefined;
      let advTimeout3: number | undefined;
      if (showAdvanced) {
        const adv = await inquirer.prompt([
          { type: 'input', name: 'timeout', message: 'Timeout ms (optional, e.g., 30000):', prefix: '> ', default: '' },
          { type: 'input', name: 'headersPairs', message: 'Extra headers (key=value,comma-separated):', prefix: '> ', default: 'X-Example=1' }
        ]);
        const t = Number(String(adv.timeout || '').trim());
        advTimeout3 = Number.isFinite(t) && t > 0 ? t : undefined;
        const headerPairs = String(adv.headersPairs || '').split(',').map(s => s.trim()).filter(Boolean);
        const headers: Record<string, string> = {};
        for (const pair of headerPairs) {
          const [k, v] = pair.split('=');
          if (k && v) headers[k.trim()] = v.trim();
        }
        advHeaders = Object.keys(headers).length > 0 ? headers : undefined;
      }
      return {
        name: answers['name'],
        httpUrl: httpUrl,
        transport: answers['transport'],
        disabled: false,
        autoApprove: [],
        ...(advHeaders ? { headers: advHeaders } : {}),
        ...(advTimeout3 ? { timeout: advTimeout3 } : {})
      };
    }
  }
  
  /**
   * Gets user preference for config directory location
   */
  private async getConfigDirectoryChoice(): Promise<{ configDir?: string; cancelled: boolean }> {
    const inquirer = await getInquirer();
    const { choice } = await inquirer.prompt({
      type: 'list',
      name: 'choice',
      message: 'Where would you like to store the MCP server configuration?',
      choices: [
        { name: 'Global (default agent config locations)', value: 'global' },
        { name: 'Project-specific directory', value: 'project' }
      ],
      default: 'global'
    });
    
    if (choice === 'project') {
      const { customDir } = await inquirer.prompt({
        type: 'input',
        name: 'customDir',
        message: 'Enter the project directory path:',
        default: process.cwd(),
        validate: (input: string) => {
          const trimmed = input.trim();
          if (!trimmed) return 'Directory path cannot be empty.';
          if (!existsSync(trimmed)) return 'Directory does not exist. Please create it first.';
          try {
            const st = statSync(trimmed);
            if (!st.isDirectory()) return 'Path is not a directory.';
          } catch {
            return 'Unable to access the directory path.';
          }
          return true;
        }
      });
      return { configDir: customDir, cancelled: false };
    }
    
    return { cancelled: false };
  }
  
  /**
   * Prompt for backup preference
   */
  private async getBackupPreference(): Promise<boolean> {
    const inquirer = await getInquirer();
    const { backup } = await inquirer.prompt({
      type: 'confirm',
      name: 'backup',
      message: 'Create backup files before applying changes?',
      default: true
    });
    return !!backup;
  }
  
  /**
   * Shows a summary of the configuration and asks for confirmation
   */
  private async confirmConfiguration(
    agents: string[],
    mcpConfig: MCPServerConfig,
    backup: boolean
  ): Promise<boolean> {
    ui.info('\nConfiguration Summary');
    ui.info('='.repeat(50));
    ui.info('Review your settings before applying changes:');
    
    ui.info('\nSelected AI Agents:');
    agents.forEach(agent => ui.info(`  - ${agent}`));
    
    ui.info('\nMCP Server Configuration:');
    ui.info(`  - Name: ${mcpConfig.name}`);
    const endpointDisplay = mcpConfig.transport === 'stdio' ? 'Local (STDIO)' : (mcpConfig.httpUrl || '');
    ui.info(`  - Endpoint: ${endpointDisplay}`);
    ui.info(`  - Transport: ${mcpConfig.transport}`);
    if (this.options.bearer) {
      const token = this.options.bearer;
      const last4 = token.slice(-4);
      ui.info(`  - Authentication Token: ****${last4} (redacted)`);
    }
    
    // Configuration details
    ui.info('\nConfiguration Details:');
    ui.info('  - Changes are atomic with automatic rollback support');
    ui.info(`  - Backups: ${backup ? 'Enabled' : 'Disabled'}`);
    
    const inquirer = await getInquirer();
    const { confirmed } = await inquirer.prompt({
      type: 'confirm',
      name: 'confirmed',
      message: 'Apply these changes?',
      default: true
    });
    
    return confirmed;
  }

/**
 * Applies the configuration to the selected agents
 */
private async applyConfiguration(
  agents: string[],
  mcpConfig: MCPServerConfig,
  configDir?: string,
  backup?: boolean
): Promise<void> {
// Default transport
  const transport = mcpConfig.transport || 'http';
  
  const commandOptions: ConfigureCommandOptions = {
    ...(mcpConfig.httpUrl ? { mcpServerEndpoint: mcpConfig.httpUrl } : {}),
    name: mcpConfig.name, // Pass the user-provided name
    transport: transport,
    agents: agents.join(','), // Convert array to comma-separated string
    // Skip secondary confirmation since wizard already confirmed
    yes: true,
    // Explicitly set interactive to false to prevent loop
    interactive: false,
    // Quiet output: show only the final summary
    quiet: true
  };
  // For STDIO flows, pass command/args to provider configuration
  if (transport === 'stdio') {
    (commandOptions as any).command = (mcpConfig as any).command;
    (commandOptions as any).args = (mcpConfig as any).args;
  }
  
  // Add optional properties only if they have values
  if (this.options.bearer !== undefined) {
    commandOptions.bearer = this.options.bearer;
  }
  if (configDir !== undefined) {
    commandOptions.configDir = configDir;
  }
  if (backup !== undefined) {
    commandOptions.backup = backup;
  }
  
  const command = new ConfigureCommand(commandOptions);
  
  await command.execute();
}
}

/**
 * Starts the interactive configuration process
 */
export async function startInteractiveConfig(
options: ConfigureCommandOptions = {}
): Promise<void> {
  // Set up graceful exit handling
  const handleExit = () => {
    ui.info('\n\nSetup cancelled. Goodbye!');
    process.exit(0);
  };

  // Handle Ctrl+C and other signals
  process.on('SIGINT', handleExit);
  process.on('SIGTERM', handleExit);

  try {
    const configurator = new InteractiveConfigurator(options);
    await configurator.start();
  } catch (error) {
    // Check if it's a user cancellation (inquirer throws specific errors)
    if (error instanceof Error && (
      error.message.includes('User force closed') ||
      error.message.includes('canceled') ||
      error.message.includes('cancelled')
    )) {
      ui.info('\n\nSetup cancelled. Goodbye!');
      process.exit(0);
    }

    ui.error('\nError during interactive configuration:');
    ui.error(error instanceof Error ? error.message : 'Unknown error');

    // Re-throw so integration tests and callers can handle failures
    throw (error instanceof Error ? error : new Error(String(error)));
  } finally {
    // Clean up event listeners
    process.removeListener('SIGINT', handleExit);
    process.removeListener('SIGTERM', handleExit);
  }
}
