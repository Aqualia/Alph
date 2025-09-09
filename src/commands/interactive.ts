// Dynamic import helper for inquirer to handle ESM/CommonJS compatibility
// inquirer v9+ is ES Modules only, but this project uses CommonJS
import { defaultRegistry } from '../agents/registry';
import { ConfigureCommand, ConfigureCommandOptions } from './configure';
import { MCPServerConfig } from '../types/config';
import { mapAliases, parseAgentNames, validateAgentNames } from '../utils/agents';
import AgentSelector from '../components/AgentSelector';
import { existsSync, statSync } from 'fs';
import { getInquirer } from '../utils/inquirer';

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
        console.log('\nUsing pre-selected agents:');
        selectedAgents.forEach(a => console.log(`  • ${a}`));
      }
    } else {
      selectedAgents = await this.selectAgents(detectedAgents);
    }
    if (selectedAgents.length === 0) {
      console.log('\n❌ No agents selected. Exiting.');
      return;
    }
    
    // 3. Get MCP server configuration (supports pre-filled endpoint & access key)
    const mcpConfig = await this.getMCPConfig(selectedAgents);
    if (!mcpConfig) {
      console.log('\n❌ Configuration aborted.');
      return;
    }

    // 3.5. Ask about config directory preference
    const configDirChoice = await this.getConfigDirectoryChoice();
    if (configDirChoice.cancelled) {
      console.log('\n❌ Configuration cancelled.');
      return;
    }
    
    // 3.6. Ask about backup preference
    const backupPref = await this.getBackupPreference();

    // 4. Confirm configuration
    const confirmed = await this.confirmConfiguration(selectedAgents, mcpConfig, backupPref);
    if (!confirmed) {
      console.log('\n❌ Configuration cancelled.');
      return;
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
    console.log('🚀 Welcome to the Alph Configuration Wizard');
    console.log('─'.repeat(42));
    console.log('Configure your AI agents to work with MCP servers');
    console.log();
  }
  
  /**
   * Detects available agents on the system
   */
  private async detectAgents(): Promise<string[]> {
    console.log('🔍 Detecting available AI agents...');
    
    const detectionResults = await defaultRegistry.detectAvailableAgents();
    const detectionSummary = defaultRegistry.summarizeDetectionResults(detectionResults);
    
    if (detectionSummary.detected === 0) {
      return [];
    }
    
    console.log(`\n✅ Found ${detectionSummary.detected} AI agent(s):`);
    detectionSummary.detectedProviders.forEach(provider => {
      console.log(`  • ${provider}`);
    });
    
    // Only show failed detections if there are any, but don't include them in the return
    if (detectionSummary.failed > 0) {
      console.log(`\n⚠️  ${detectionSummary.failed} agent(s) could not be detected:`);
      const failedDetections = defaultRegistry.getFailedDetections(detectionResults);
      failedDetections.forEach(failed => {
        console.log(`  • ${failed.provider.name}: ${failed.error || 'Detection failed'}`);
      });
    }
    
    // Return only the successfully detected agents
    return detectionSummary.detectedProviders;
  }
  
  /**
   * Handles case when no agents are detected
   */
  private showNoAgentsDetected(): void {
    console.log('\n🔍 No Supported AI Agents Detected');
    console.log('='.repeat(40));
    console.log('We couldn\'t detect any supported AI agents on your system.');
    console.log('\n📋 Supported agents and their default locations:');
    console.log('  • Gemini CLI: ~/.gemini/settings.json');
    console.log('  • Cursor: Platform-specific configuration');
    console.log('  • Claude Code: Platform-specific configuration');
    console.log('  • Codex CLI: ~/.codex/config.toml');
    console.log('\n💡 To proceed, please:');
    console.log('   1. Install one of the supported AI agents listed above');
    console.log('   2. Ensure the agent is properly configured');
    console.log('   3. Re-run this configuration wizard');
    console.log('\nFor installation instructions, visit: https://github.com/Aqualia/Alph#installation');
  }
  
  /**
   * Gets a description for an agent
   */
  private getAgentDescription(agent: string): string {
    const key = (agent || '').trim().toLowerCase();
    const descMap: Record<string, string> = {
      // Exact provider names
      'gemini cli': 'Google Gemini CLI — Command‑line access to Gemini models for coding, reasoning, and web tasks',
      'cursor': 'Cursor IDE — AI‑powered code editor with inline assistance and automations',
      'claude code': 'Claude Code — Anthropic’s coding assistant for generating, explaining, and refactoring code',
      'windsurf': 'Windsurf (Codeium) — AI IDE with MCP integration for custom tools',
      'codex cli': 'OpenAI Codex CLI — Terminal coding assistant; MCP via STDIO (TOML at ~/.codex/config.toml)',
      'warp': 'Warp Terminal — AI‑assisted terminal with MCP server support',
      // Common aliases
      'gemini': 'Google Gemini CLI — Command‑line access to Gemini models for coding, reasoning, and web tasks',
      'claude': 'Claude Code — Anthropic’s coding assistant for generating, explaining, and refactoring code',
      'codex': 'OpenAI Codex CLI — Terminal coding assistant; MCP via STDIO (TOML at ~/.codex/config.toml)',
      'codeium-windsurf': 'Windsurf (Codeium) — AI IDE with MCP integration for custom tools',
      'warp-terminal': 'Warp Terminal — AI‑assisted terminal with MCP server support'
    };
    return descMap[key] || 'AI agent with MCP server integration support';
  }
  
  /**
   * Prompts the user to select which agent to configure (one at a time)
   */
  private async selectAgents(availableAgents: string[]): Promise<string[]> {
    // Prefill from CLI-provided agents if present
    let prefill: string | undefined;
    if (this.options.agents) {
      const requested = mapAliases(parseAgentNames(this.options.agents));
      const { valid } = validateAgentNames(requested);
      // Intersect with available and take first
      const matched = valid.filter(v => availableAgents.includes(v));
      if (matched.length > 0) {
        prefill = matched[0]; // fallback to first available
      }
    }

    const selectedAgent = await AgentSelector({
      message: 'Select an agent to configure:',
      choices: availableAgents.map(agent => ({
        name: agent,
        value: agent,
        description: this.getAgentDescription(agent)
      })),
      default: prefill || availableAgents[0]
    });
    
    return [selectedAgent];
  }
  
  /**
   * Gets MCP server configuration through interactive prompts
   */
  private async getMCPConfig(selectedAgents?: string[]): Promise<MCPServerConfig | null> {
    console.log('\n🌐 MCP Server Configuration');
    console.log('='.repeat(50));
    console.log('Configure your Model Context Protocol (MCP) server connection.');
    console.log('This will enable your AI agents to communicate with your MCP server.\n');
    const includesCodex = Array.isArray(selectedAgents) && selectedAgents.includes('Codex CLI');
    
    if (includesCodex) {
      console.log('ℹ️  Codex CLI: Remote HTTP/SSE MCP servers are not supported.');
      console.log('   We will configure a local STDIO MCP server (command + args).');
    }
    const prompts: any[] = [
      {
        type: 'input',
        name: 'name',
        message: 'Configuration Name:',
        default: 'my-mcp-server',
        prefix: '🏷️ '
      },
      // URL prompt is conditionally included
      ...(!this.options.mcpServerEndpoint && !includesCodex
        ? [{
            type: 'input',
            name: 'httpUrl',
            message: 'MCP Server Endpoint URL:',
            default: 'https://',
            prefix: '🔗 ',
            validate: (input: string) => {
              if (!input) return 'URL is required.';
              // Automatically add https:// prefix if missing
              let urlToTest = input;
              if (!input.startsWith('http://') && !input.startsWith('https://')) {
                urlToTest = `https://${input}`;
              }
              try { new URL(urlToTest); return true; } catch { return 'Please enter a valid URL.'; }
            },
            transformer: (input: string) => {
              // Add https:// prefix if missing when user starts typing
              if (input && !input.startsWith('http://') && !input.startsWith('https://')) {
                return `https://${input}`;
              }
              return input;
            }
          }]
        : []),
      {
        type: 'list',
        name: 'transport',
        message: 'Transport Protocol:',
        prefix: '📡 ',
        choices: includesCodex
          ? [ { name: 'STDIO (Local command)', value: 'stdio' } ]
          : [
              { name: 'HTTP (Standard)', value: 'http' },
              { name: 'SSE (Server-Sent Events)', value: 'sse' },
              { name: 'STDIO (Local command)', value: 'stdio' }
            ],
        // Default transport
        default: includesCodex ? 'stdio' : (this.options.transport || 'http')
      },
      // Authentication token prompt is conditionally included; input masked
      ...(!this.options.bearer && !includesCodex
        ? [{
            type: 'password',
            name: 'bearer',
            message: 'Authentication Token (Optional):',
            prefix: '🔑 ',
            mask: '*',
            validate: () => true,
            suffix: ' (Leave blank for public servers)'
          }]
        : [])
    ];

    const inquirer = await getInquirer();
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
      const customChoice = { name: 'Custom command…', value: '__custom__' } as const;
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
        prefix: '🧰 '
      });
      if (toolId === '__custom__') {
        const custom = await inquirer.prompt([
          { type: 'input', name: 'cmd', message: 'Command (e.g., npx):', prefix: '💻 ', validate: (s: string) => !!s || 'Command is required.' },
          { type: 'input', name: 'args', message: 'Arguments (comma or space separated):', prefix: '➕ ', default: '' }
        ]);
        const args = (custom.args as string)
          .split(/[\s,]+/)
          .map(s => s.trim())
          .filter(Boolean);
        return {
          name: answers['name'],
          command: custom.cmd,
          args,
          transport: 'stdio',
          disabled: false,
          autoApprove: []
        };
      }

      const tool = catalog.tools.find(t => t.id === toolId)!;
      let det = detectTool(tool);
      if (!det.installed) {
        const optOut = (this.options as any)['noInstall'] === true || process.env['ALPH_NO_INSTALL'] === '1';
        if (optOut) {
          console.log('\n⚠️  STDIO tool not found and installation is disabled (--no-install or ALPH_NO_INSTALL=1).');
          throw new Error('Aborting: STDIO tool is not installed. Re-run without --no-install to install automatically.');
        }
        await installTool(tool, (this.options as any)['installManager']);
        det = detectTool(tool);
        if (!det.installed) {
          throw new Error('STDIO tool installation appears to have failed; command not found after install.');
        }
      }
      let invoke = chooseDefaultInvocation(tool, det);
      // Offer customization of command/args after detection
      const { customize } = await inquirer.prompt({ type: 'confirm', name: 'customize', message: 'Customize command/args?', default: (Array.isArray(selectedAgents) && selectedAgents.includes('Codex CLI')) });
      if (customize) {
        const edited = await inquirer.prompt([
          { type: 'input', name: 'cmd', message: 'Command:', prefix: '💻 ', default: invoke.command, validate: (s: string) => !!s || 'Command is required.' },
          { type: 'input', name: 'args', message: 'Arguments (comma or space separated):', prefix: '➕ ', default: (invoke.args || []).join(' ') }
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
      return {
        name: answers['name'],
        command: invoke.command,
        args: invoke.args,
        transport: 'stdio',
        disabled: false,
        autoApprove: []
      };
    } else {
      // Ensure HTTPS prefix is added to the URL if missing
      let httpUrl = this.options.mcpServerEndpoint || answers['httpUrl'];
      if (httpUrl && !httpUrl.startsWith('http://') && !httpUrl.startsWith('https://')) {
        httpUrl = `https://${httpUrl}`;
      }
      return {
        name: answers['name'],
        httpUrl: httpUrl,
        transport: answers['transport'],
        disabled: false,
        autoApprove: []
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
        { name: '🌍 Global (default agent config locations)', value: 'global' },
        { name: '📁 Project-specific directory', value: 'project' }
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
    console.log('\n📋 Configuration Summary');
    console.log('='.repeat(50));
    console.log('Review your configuration before applying changes:');
    
    console.log('\n🤖 Selected AI Agents:');
    agents.forEach(agent => console.log(`  • ${agent}`));
    
    console.log('\n🌐 MCP Server Configuration:');
    console.log(`  • Name: ${mcpConfig.name}`);
    console.log(`  • Endpoint: ${mcpConfig.httpUrl}`);
    console.log(`  • Transport: ${mcpConfig.transport}`);
    if (this.options.bearer) {
      const token = this.options.bearer;
      const last4 = token.slice(-4);
      console.log(`  • Authentication Token: ****${last4} (redacted)`);
    }
    
    // Configuration details
    console.log('\n📋 Configuration Details:');
    console.log('  • Changes are atomic with automatic rollback support');
    console.log(`  • Backups: ${backup ? 'Enabled' : 'Disabled'}`);
    
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
console.log('\n🔄 Applying configuration...');
// Default transport
  let transport = mcpConfig.transport || 'http';
  
  const commandOptions: ConfigureCommandOptions = {
    ...(mcpConfig.httpUrl ? { mcpServerEndpoint: mcpConfig.httpUrl } : {}),
    name: mcpConfig.name, // Pass the user-provided name
    transport: transport,
    agents: agents.join(','), // Convert array to comma-separated string
    // Skip secondary confirmation since wizard already confirmed
    yes: true,
    // Explicitly set interactive to false to prevent loop
    interactive: false
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
    console.log('\n\n👋 Setup cancelled. Goodbye!');
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
      console.log('\n\n👋 Setup cancelled. Goodbye!');
      process.exit(0);
    }

    console.error('\n❌ Error during interactive configuration:');
    console.error(error instanceof Error ? error.message : 'Unknown error');

    // Re-throw so integration tests and callers can handle failures
    throw (error instanceof Error ? error : new Error(String(error)));
  } finally {
    // Clean up event listeners
    process.removeListener('SIGINT', handleExit);
    process.removeListener('SIGTERM', handleExit);
  }
}
