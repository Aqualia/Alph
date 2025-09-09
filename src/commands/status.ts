/**
 * Alph status command: detect installed agents, read MCP server configuration,
 * redact sensitive fields, and print results as a table or JSON.
 */

import { defaultRegistry } from '../agents/registry';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const TOML = require('@iarna/toml');
import { FileOperations } from '../utils/fileOps';
import type { GeminiConfig, CursorConfig, ClaudeConfig, GenericConfig } from '../types/config';
import type { ProviderDetectionResult } from '../agents/provider';

export interface StatusCommandOptions {
  // Simplified - no agents or output options
}

type AnyConfig = GeminiConfig | CursorConfig | ClaudeConfig | GenericConfig | Record<string, unknown>;

interface RedactedServerEntry {
  id: string;
  config: Record<string, unknown>;
}

interface ProviderStatus {
  name: string;
  detected: boolean;
  configPath?: string;
  error?: string;
  servers?: RedactedServerEntry[];
}

export async function executeStatusCommand(_options: StatusCommandOptions = {}): Promise<void> {
  // Simplified - detect all available agents without filtering
  const detectionResults = await defaultRegistry.detectAvailableAgents();

  // Read configuration files for detected providers in parallel
  const providerStatuses: ProviderStatus[] = await buildProviderStatuses(detectionResults);

  // Always use table output
  printTable(providerStatuses);
}

async function buildProviderStatuses(detections: ProviderDetectionResult[]): Promise<ProviderStatus[]> {
  // Kick off parallel reads for detected ones
  const readPromises = detections.map(async (det) => {
    // Providers like Warp don't have a config file path but can be detected.
    if (!det.detected) {
      return <ProviderStatus>{ name: det.provider.name, detected: false, ...(det.error && { error: det.error }) };
    }
    if (!det.configPath) {
      return <ProviderStatus>{ name: det.provider.name, detected: true };
    }

    try {
      // Codex CLI uses TOML at ~/.codex/config.toml
      if (det.provider.name === 'Codex CLI') {
        const fs = await import('fs/promises');
        const raw = await fs.readFile(det.configPath, 'utf-8');
        let servers: RedactedServerEntry[] = [];
        if (raw && raw.trim().length > 0) {
          try {
            const parsed = TOML.parse(raw) as any;
            const mcp = parsed?.mcp_servers;
            if (mcp && typeof mcp === 'object') {
              servers = Object.entries(mcp).map(([id, cfg]) => ({
                id,
                config: redactSensitive(cfg as Record<string, unknown>)
              }));
            }
          } catch {
            // fallthrough to generic error below
          }
        }
        return <ProviderStatus>{
          name: det.provider.name,
          detected: true,
          configPath: det.configPath,
          servers
        };
      }

      const config = await FileOperations.readJsonFile<AnyConfig>(det.configPath);
      const servers = extractMCPServers(config).map(({ id, config }) => ({
        id,
        config: redactSensitive(config)
      }));

      return <ProviderStatus>{
        name: det.provider.name,
        detected: true,
        configPath: det.configPath,
        servers
      };
    } catch (err) {
      return <ProviderStatus>{
        name: det.provider.name,
        detected: true,
        configPath: det.configPath,
        error: err instanceof Error ? err.message : String(err)
      };
    }
  });

  return Promise.all(readPromises);
}

function extractMCPServers(cfg: AnyConfig): Array<{ id: string; config: Record<string, unknown> }> {
  const mcp = (cfg as any)?.mcpServers;
  if (!mcp || typeof mcp !== 'object') return [];
  const entries: Array<{ id: string; config: Record<string, unknown> }> = [];
  for (const [id, value] of Object.entries(mcp as Record<string, any>)) {
    if (value && typeof value === 'object') {
      entries.push({ id, config: value as Record<string, unknown> });
    }
  }
  return entries;
}

function redactSensitive(obj: Record<string, unknown>): Record<string, unknown> {
  const SENSITIVE_KEYS = /^(authorization|access[-_]?key|api[-_]?key|token|secret|password|pass)$/i;
  const ENV_SENSITIVE = /(token|secret|key|password|pass|auth)/i;

  const clone = structuredCloneSafe(obj);

  const maskLast4 = (v: unknown) => {
    if (typeof v !== 'string' || v.length === 0) return v;
    const last4 = v.slice(-4);
    return `****${last4}`;
  };

  // headers
  if ((clone as any).headers && typeof (clone as any).headers === 'object') {
    for (const [k, v] of Object.entries((clone as any).headers as Record<string, unknown>)) {
      if (SENSITIVE_KEYS.test(k)) {
        ((clone as any).headers as Record<string, unknown>)[k] = maskLast4(v);
      }
    }
  }

  // env
  if ((clone as any).env && typeof (clone as any).env === 'object') {
    for (const [k, v] of Object.entries((clone as any).env as Record<string, unknown>)) {
      if (ENV_SENSITIVE.test(k)) {
        ((clone as any).env as Record<string, unknown>)[k] = maskLast4(v);
      }
    }
  }

  // top-level sensitive fields
  for (const [k, v] of Object.entries(clone)) {
    if (SENSITIVE_KEYS.test(k)) {
      (clone as Record<string, unknown>)[k] = maskLast4(v);
    }
  }

  return clone;
}

function structuredCloneSafe<T>(v: T): T {
  try {
    // Node 17+ has structuredClone; fall back to JSON copy
    // @ts-ignore
    if (typeof structuredClone === 'function') return structuredClone(v);
  } catch {
    // ignore
  }
  return JSON.parse(JSON.stringify(v));
}

function printTable(statuses: ProviderStatus[]): void {
  console.log('\nAlph MCP Configuration Status');
  console.log('----------------------------------------\n');

  if (statuses.length === 0) {
    // eslint-disable-next-line no-console
    console.log('No AI agents found.');
    return;
  }

  // Separate detected and non-detected providers
  const detectedProviders = statuses.filter(s => s.detected);
  const notDetectedProviders = statuses.filter(s => !s.detected);

  // Display detected providers with their configurations
  if (detectedProviders.length > 0) {
    // eslint-disable-next-line no-console
    console.log('\x1b[1;32m✓ CONFIGURED AGENTS\x1b[0m');
    console.log('─────────────────');
    for (const s of detectedProviders) {
      const count = s.servers?.length ?? 0;
      const serverText = count === 1 ? '1 server' : `${count} servers`;
      
      // eslint-disable-next-line no-console
      console.log(`\n\x1b[1m${s.name}\x1b[0m (${serverText})`);
      // eslint-disable-next-line no-console
      console.log(`  Config file: ${s.configPath || 'N/A'}`);

      if (count > 0) {
    console.log('  MCP Servers:');
        for (const entry of s.servers!) {
          const c = entry.config as any;
          const url = c.httpUrl || c.url || c.endpoint || c.command || 'N/A';
          const disabled = c.disabled === true ? 'disabled' : 'enabled';

          // Determine transport: prefer explicit, else infer; map stdio to N/A for display
          const explicit: string | undefined = c.transport || c.config?.transport;
          let inferred: 'http' | 'sse' | 'stdio' | 'N/A' = 'N/A';
          if (!explicit) {
            if (typeof c.command === 'string' && c.command.length > 0) inferred = 'stdio';
            else if (typeof c.httpUrl === 'string' && c.httpUrl.length > 0) inferred = 'http';
            else if (typeof c.url === 'string' && c.url.length > 0) inferred = 'sse';
          }
          const rawTransport = (explicit as string | undefined) || inferred;
          const transportDisplay = rawTransport === 'stdio' || rawTransport === 'N/A' || !rawTransport ? 'N/A' : rawTransport;
          
          // eslint-disable-next-line no-console
          console.log(`    • \x1b[1m${entry.id}\x1b[0m: ${url}`);
          // eslint-disable-next-line no-console
          console.log(`      Status: ${disabled} | Transport: ${transportDisplay}`);
        }
      } else {
        // eslint-disable-next-line no-console
        console.log('  MCP Servers: None configured');
      }
    }
  }

  // Display non-detected providers
  if (notDetectedProviders.length > 0) {
    if (detectedProviders.length > 0) {
      // eslint-disable-next-line no-console
      console.log('\n');
    }
    
    // eslint-disable-next-line no-console
    console.log('\x1b[1;33m⚠️  UNAVAILABLE AGENTS\x1b[0m');
    console.log('───────────────────');
    for (const s of notDetectedProviders) {
      const errorText = s.error ? ` (${s.error})` : '';
      // eslint-disable-next-line no-console
      console.log(`\n\x1b[1m${s.name}\x1b[0m: Not detected${errorText}`);
    }
  }

  // eslint-disable-next-line no-console
  console.log('\n');
}
