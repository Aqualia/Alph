/**
 * Unified command system for Alph CLI
 *
 * This refactors the CLI to a subcommand-based architecture with
 * `configure` and `status` subcommands. Root with no subcommand
 * shows banner and help information.
 */

import { Command } from 'commander';
import { readFileSync } from 'fs';
import { join } from 'path';
import { executeConfigureCommand, ConfigureCommandOptions } from './configure';
import { executeStatusCommand } from './status';
import { executeRemoveCommand, RemoveCommandOptions } from './remove';
import { startInteractiveConfig } from './interactive';
import { proxyRun, proxyHealth } from './proxy';

/**
 * Unified command implementation
 */
export class UnifiedCommand {
  private program: Command;

  private setupPromise: Promise<void>;

  constructor() {
    this.program = new Command();
    // Initialize commands asynchronously
    this.setupPromise = this.setupCommands();
  }

  /**
   * Shows the ASCII banner and help information
   */
  private async showBanner(): Promise<void> {
    const { showMainBanner } = await import('../utils/banner.js');
    await showMainBanner();
  }

  /**
   * Sets up subcommands and handles root command behavior
   */
  private async setupCommands(): Promise<void> {
    const pkgPath = join(__dirname, '../../package.json');
    const packageJson = JSON.parse(readFileSync(pkgPath, 'utf8'));
    this.program
      .name('alph')
      .description('')
      .version(packageJson.version, '-v, --version', 'Show version')
      .option('--verbose', 'Enable verbose logging', false)
      .hook('preAction', (thisCommand) => {
        // Commander v11: prefer optsWithGlobals when available
        const anyCmd: any = thisCommand as any;
        const opts = typeof anyCmd.optsWithGlobals === 'function' ? anyCmd.optsWithGlobals() : thisCommand.opts();
        if (opts && opts.verbose) {
          process.env['ALPH_VERBOSE'] = '1';
        }
      });

    // Removed global interactive flag (-i). Use 'setup' command for interactive flow.

    // configure subcommand (now called 'setup')
    this.program
      .command('setup')
      .description('🔧 Configure agents with an MCP server')
      .option('--mcp-server-endpoint <url>', 'MCP server endpoint URL')
      .option('--bearer [token]', 'Authentication token for Authorization (optional, will be redacted in output)')
      .option('--transport <type>', 'Transport protocol (http|sse|stdio)')
      .option('--command <cmd>', 'Command to execute for stdio transport')
      .option('--cwd <path>', 'Working directory for command execution')
      .option('--args <list>', 'Comma-separated arguments for command execution')
      .option('--env <list>', 'Environment variables (key=value pairs)')
      .option('--headers <list>', 'HTTP headers (key=value pairs)')
      .option('--proxy-remote-url <url>', 'Remote MCP URL for local proxy (Codex)')
      .option('--proxy-transport <type>', 'Proxy transport (http|sse)')
      .option('--proxy-bearer <token>', 'Proxy Authorization bearer (redacted)')
      .option('--proxy-header <K: V...>', 'Proxy header (repeatable)', (val, acc: string[]) => { acc.push(val); return acc; }, [])
      .option('--timeout <ms>', 'Command execution timeout in milliseconds')
      .option('--install-manager <mgr>', 'Preferred installer for STDIO tools (npm|brew|pipx|cargo|auto)')
      .option('--atomic-mode <mode>', 'Atomic write strategy (auto|copy|rename)')
      .option('--no-install', 'Do not auto-install missing STDIO tools (opt-out)')
      .option('--agents <list>', 'Comma-separated agent names to filter')
      .option('--dir <path>', 'Custom config directory (default: use global agent config locations)')
      .option('--dry-run', 'Preview changes without writing', false)
      .option('--no-backup', 'Do not create backups before configuration (advanced)')
      .option('--name <id>', 'Name of the MCP server (optional)')
      .action(async (opts: { mcpServerEndpoint?: string; bearer?: string; transport?: 'http'|'sse'|'stdio'; command?: string; cwd?: string; args?: string; env?: string; headers?: string; timeout?: string; agents?: string; dir?: string; dryRun?: boolean; backup?: boolean; name?: string; install?: boolean; installManager?: string; atomicMode?: 'auto'|'copy'|'rename'; proxyRemoteUrl?: string; proxyTransport?: 'http'|'sse'; proxyBearer?: string; proxyHeader?: string[] }) => {
        // If no options provided, default to interactive wizard (simplified UX)
        const hasAnyOption = opts.mcpServerEndpoint || opts.bearer || opts.transport || opts.command || opts.cwd || opts.args || opts.env || opts.headers || opts.timeout || opts.agents || opts.dir || opts.dryRun || opts.name || opts.backup === false || opts.proxyRemoteUrl || opts.proxyTransport || opts.proxyBearer || (opts.proxyHeader && opts.proxyHeader.length > 0);
        if (!hasAnyOption) {
          await startInteractiveConfig({});
          return;
        }

        // For manual setup runs, display the main banner for brand consistency
        try {
          const { showMainBanner } = await import('../utils/banner.js');
          await showMainBanner();
        } catch {
          // non-fatal if banner fails to render
        }

        const forwarded = __normalizeConfigureForwarding(opts as any, (process && process.argv) ? process.argv.slice(2) : []);

        const configureOptions: ConfigureCommandOptions = {
          mcpServerEndpoint: forwarded.mcpServerEndpoint,
          agents: forwarded.agents,
          yes: true,
          dryRun: !!opts.dryRun
        };
        
        // Add optional properties only if they have values
        if (opts.bearer !== undefined) {
          configureOptions.bearer = opts.bearer;
        }
        if (opts.transport !== undefined) {
          configureOptions.transport = opts.transport as 'http' | 'sse' | 'stdio';
        }
        if (opts.command !== undefined) {
          configureOptions.command = opts.command;
        }
        if (opts.cwd !== undefined) {
          configureOptions.cwd = opts.cwd;
        }
        if (opts.args !== undefined) {
          configureOptions.args = opts.args.split(',').map(arg => arg.trim()).filter(arg => arg.length > 0);
        }
        if (opts.env !== undefined) {
          configureOptions.env = opts.env.split(',').reduce((acc, pair) => {
            const [key, value] = pair.split('=');
            if (key && value) acc[key.trim()] = value.trim();
            return acc;
          }, {} as Record<string, string>);
        }
        if (opts.headers !== undefined) {
          configureOptions.headers = opts.headers.split(',').reduce((acc, pair) => {
            const [key, value] = pair.split('=');
            if (key && value) acc[key.trim()] = value.trim();
            return acc;
          }, {} as Record<string, string>);
        }
        // Proxy flags forwarding
        if (opts.proxyRemoteUrl !== undefined) (configureOptions as any).proxyRemoteUrl = opts.proxyRemoteUrl;
        if (opts.proxyTransport !== undefined) (configureOptions as any).proxyTransport = opts.proxyTransport as any;
        if (opts.proxyBearer !== undefined) (configureOptions as any).proxyBearer = opts.proxyBearer;
        if (opts.proxyHeader !== undefined) (configureOptions as any).proxyHeader = opts.proxyHeader;
        if (opts.timeout !== undefined) {
          configureOptions.timeout = parseInt(opts.timeout, 10);
        }
        if (opts.dir !== undefined) {
          configureOptions.configDir = opts.dir;
        }
        if (opts.backup !== undefined) {
          configureOptions.backup = opts.backup;
        }
        if (opts.name !== undefined) {
          configureOptions.name = opts.name;
        }
        
        if (opts.install === false) {
          (configureOptions as any).noInstall = true;
        }
        if (opts.installManager) {
          (configureOptions as any).installManager = opts.installManager as any;
        }
        if (opts.atomicMode) {
          process.env['ALPH_ATOMIC_MODE'] = opts.atomicMode;
        }

        await executeConfigureCommand(configureOptions);
      });

    // proxy subcommands
    const proxy = this.program
      .command('proxy')
      .description('Local MCP proxy helpers (Supergateway wrapper)');

    proxy
      .command('run')
      .description('Run a local STDIO↔HTTP/SSE proxy for Codex')
      .requiredOption('--remote-url <url>', 'Remote MCP URL')
      .requiredOption('--transport <type>', 'Transport protocol (http|sse)')
      .option('--bearer <token>', 'Authorization bearer token (redacted in logs)')
      .option('--header <K: V...>', 'Additional header (repeatable)', (val, acc: string[]) => { acc.push(val); return acc; }, [])
      .option('--proxy-version <ver>', 'Supergateway version (default: v3.4.0)')
      .option('--docker', 'Use Docker image instead of npx', false)
      .action(async (opts: { remoteUrl: string; transport: 'http'|'sse'; bearer?: string; header?: string[]; proxyVersion?: string; docker?: boolean }) => {
        const runOpts: any = {
          remoteUrl: opts.remoteUrl,
          transport: opts.transport,
        };
        if (opts.bearer !== undefined) runOpts.bearer = opts.bearer;
        if (opts.header !== undefined) runOpts.header = opts.header;
        if (opts.proxyVersion !== undefined) runOpts.proxyVersion = opts.proxyVersion;
        if (opts.docker !== undefined) runOpts.docker = opts.docker;
        const code = await proxyRun(runOpts);
        if (code !== 0) process.exit(code);
      });

    proxy
      .command('health')
      .description('Validate remote MCP URL and transport inputs')
      .requiredOption('--remote-url <url>', 'Remote MCP URL')
      .requiredOption('--transport <type>', 'Transport protocol (http|sse)')
      .option('--bearer <token>', 'Authorization bearer token (redacted in logs)')
      .option('--header <K: V...>', 'Additional header (repeatable)', (val, acc: string[]) => { acc.push(val); return acc; }, [])
      .option('--proxy-version <ver>', 'Supergateway version for preview (default: v3.4.0)')
      .action(async (opts: { remoteUrl: string; transport: 'http'|'sse'; bearer?: string; header?: string[] }) => {
        const healthOpts: any = { remoteUrl: opts.remoteUrl, transport: opts.transport };
        if (opts.bearer !== undefined) healthOpts.bearer = opts.bearer;
        if (opts.header !== undefined) healthOpts.header = opts.header;
        if ((opts as any).proxyVersion !== undefined) healthOpts.proxyVersion = (opts as any).proxyVersion;
        const code = await proxyHealth(healthOpts);
        if (code !== 0) process.exit(code);
      });

    // status subcommand
    this.program
      .command('status')
      .description('Show detected agents and current MCP entries')
      .option('--format <fmt>', 'Output format (list|json)', 'list')
      .option('--agent <name>', 'Filter by agent name (contains)')
      .option('--problems', 'Show only agents with issues', false)
      .action(async (opts: { format?: 'list'|'json'; agent?: string; problems?: boolean }) => {
        await executeStatusCommand({ format: (opts.format as any) || 'list', agent: (opts.agent || ''), problems: !!opts.problems });
      });

    // remove subcommand
    this.program
      .command('remove')
      .description('🗑️  Remove MCP server configurations from agents')
      .option('--server-name <name>', 'MCP server name to remove')
      .option('--agents <list>', 'Comma-separated agent names to filter')
      .option('--dir <path>', 'Custom config directory (default: use global agent config locations)')
      .option('--dry-run', 'Preview changes without removing', false)
      .option('-y, --yes', 'Skip confirmation prompt', false)
      .option('-i, --interactive', 'Launch interactive removal wizard', false)
      .option('--no-backup', 'Do not create backups before removal (advanced)')
      .action(async (opts: { serverName?: string; agents?: string; dir?: string; dryRun?: boolean; yes?: boolean; interactive?: boolean; backup?: boolean }) => {
        // Check if user ran remove with no options - show interactive wizard
        const hasAnyOption = opts.serverName || opts.agents || opts.dir || opts.dryRun || opts.yes || opts.interactive || opts.backup === false;
        if (!hasAnyOption) {
          // Default to interactive mode when no options provided
          opts.interactive = true;
        }

        const removeOptions: RemoveCommandOptions = {
          dryRun: opts.dryRun || false,
          yes: opts.yes || false,
          interactive: opts.interactive || false
        };
        
        // Add optional properties only if they have values
        if (opts.serverName !== undefined) {
          removeOptions.serverName = opts.serverName;
        }
        if (opts.agents !== undefined) {
          removeOptions.agents = opts.agents;
        }
        if (opts.dir !== undefined) {
          removeOptions.configDir = opts.dir;
        }
        if (opts.backup !== undefined) {
          removeOptions.backup = opts.backup;
        }
        
        await executeRemoveCommand(removeOptions);
      });

    // Root command action
    this.program
      .action(async (_options: any) => {
    const noSubcommand = process.argv.length <= 2 || !['setup', 'status', 'remove', 'proxy'].some(sub => process.argv.includes(sub));

        // Default behavior: show banner and help when no subcommand
        if (noSubcommand) {
          await this.showBanner();
          this.program.help();
        }
      });
  }

  /**
   * Parse and execute CLI
   */
  public async parse(argv: string[] = process.argv): Promise<void> {
    // Wait for setup to complete before parsing
    await this.setupPromise;
    await this.program.parseAsync(argv);
  }
}

/**
 * Creates and executes the unified command
 */
export async function executeUnifiedCommand(argv: string[] = process.argv): Promise<void> {
  const command = new UnifiedCommand();
  await command.parse(argv);
}

// Export for testing
export default {
  UnifiedCommand,
  executeUnifiedCommand
};

// Exported for tests: normalize dashed vs camel-case options and argv fallback
export function __normalizeConfigureForwarding(rawOpts: any, argv: string[]) {
  // Convert kebab-case to camelCase for all options
  const normalizeKey = (key: string): string => {
    if (key.includes('-')) {
      return key.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
    }
    return key;
  };

  // Create a normalized options object with camelCase keys
  const normalizedOpts = Object.entries(rawOpts).reduce((acc, [key, value]) => {
    acc[normalizeKey(key)] = value;
    return acc;
  }, {} as Record<string, any>);

  // Get values with fallbacks
  let endpoint = normalizedOpts['mcpServerEndpoint'] ?? '';
  let agents = normalizedOpts['agents'] ?? '';

  // Optional argv fallback (disabled by default to avoid test interference).
  // Enable by setting ALPH_ARGV_FALLBACK=1 when invoking the CLI directly.
  const enableArgvFallback = process?.env?.['ALPH_ARGV_FALLBACK'] === '1';
  
  if (enableArgvFallback && (!endpoint || !agents)) {
    const getArgValue = (name: string): string | undefined => {
      // Try exact match first
      const idx = argv.indexOf(name);
      if (idx >= 0 && idx + 1 < argv.length) return argv[idx + 1];
      
      // Try with equals sign
      const pref = argv.find(a => a.startsWith(name + '='));
      if (pref) return pref.split('=').slice(1).join('=');
      
      return '';
    };
    
    if (!endpoint) {
      endpoint = getArgValue('--mcp-server-endpoint') || '';
    }
    
    if (!agents) {
      agents = getArgValue('--agents') || '';
    }
  }

  return {
    mcpServerEndpoint: endpoint,
    agents,
  };
}





