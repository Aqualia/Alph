import { AgentProvider, AgentConfig, RemovalConfig } from '../agents/provider';
import { redactForLogs } from './proxy';
import { FileOperations } from './fileOps';

function clone<T>(obj: T): T {
  return JSON.parse(JSON.stringify(obj));
}

function isSensitiveKey(key: string): boolean {
  return /(authorization|token|secret|key|password|bearer)/i.test(key);
}

function redactValue(val: any): any {
  if (typeof val === 'string') {
    if (val.length <= 8) return '***REDACTED***';
    return `${val.slice(0, 2)}***REDACTED***${val.slice(-2)}`;
  }
  return '***REDACTED***';
}

function redactObjectDeep(obj: any): any {
  if (obj === null || obj === undefined) return obj;
  if (Array.isArray(obj)) return obj.map(v => typeof v === 'string' ? redactForLogs(v) : redactObjectDeep(v));
  if (typeof obj === 'object') {
    const out: Record<string, any> = {};
    for (const [k, v] of Object.entries(obj)) {
      if (isSensitiveKey(k)) {
        out[k] = redactValue(v);
      } else if (typeof v === 'object') {
        out[k] = redactObjectDeep(v);
      } else {
        out[k] = typeof v === 'string' ? redactForLogs(v) : v;
      }
    }
    return out;
  }
  return obj;
}

function renderServerEntry(cfg: AgentConfig): Record<string, any> {
  const transport = (cfg as any)['transport'] || 'http';
  const entry: Record<string, any> = {};
  if (transport !== 'http') {
    entry['transport'] = transport;
  }
  if (transport === 'stdio') {
    if ((cfg as any)['command']) entry['command'] = (cfg as any)['command'];
    if ((cfg as any)['args']) entry['args'] = (cfg as any)['args'];
    if ((cfg as any)['cwd']) entry['cwd'] = (cfg as any)['cwd'];
  }
  if (transport === 'http') {
    if ((cfg as any)['mcpServerUrl']) entry['httpUrl'] = (cfg as any)['mcpServerUrl'];
    if ((cfg as any)['headers'] && Object.keys((cfg as any)['headers']).length > 0) entry['headers'] = { ...(cfg as any)['headers'] };
  }
  if (transport === 'sse') {
    if ((cfg as any)['mcpServerUrl']) entry['url'] = (cfg as any)['mcpServerUrl'];
    if ((cfg as any)['headers'] && Object.keys((cfg as any)['headers']).length > 0) entry['headers'] = { ...(cfg as any)['headers'] };
  }
  if ((cfg as any)['env'] && Object.keys((cfg as any)['env']).length > 0) entry['env'] = { ...(cfg as any)['env'] };
  const t = (cfg as any)['timeout'];
  if (typeof t === 'number' && Number.isFinite(t) && t > 0) entry['timeout'] = t;
  return entry;
}

export async function computeInstallPreview(
  provider: AgentProvider,
  agentConfig: AgentConfig
): Promise<{ configPath: string; before: string; after: string; snippetBefore: string; snippetAfter: string } | null> {
  const configPath = (await provider.detect(agentConfig.configDir)) || null;
  const targetPath = configPath || null;
  const pathToUse = targetPath ?? (agentConfig.configDir ? '' : '');
  // If we still don't have a target path, we cannot preview
  const effectivePath = pathToUse || (agentConfig.configDir || '(agent default path)');

  let existing: Record<string, any> = {};
  try {
    if (configPath) {
      existing = await FileOperations.readJsonFile<Record<string, any>>(configPath);
    }
  } catch {
    existing = {};
  }

  const beforeObj = redactObjectDeep(clone(existing));

  const next = clone(existing);
  if (!next['mcpServers'] || typeof next['mcpServers'] !== 'object') next['mcpServers'] = {};
  next['mcpServers'][ (agentConfig as any)['mcpServerId'] ] = renderServerEntry(agentConfig);
  const afterObj = redactObjectDeep(clone(next));

  const beforeStr = JSON.stringify(beforeObj, null, 2);
  const afterStr = JSON.stringify(afterObj, null, 2);

  const sid = (agentConfig as any)['mcpServerId'];
  const beforeSnippet = JSON.stringify(redactObjectDeep((beforeObj as any)?.['mcpServers']?.[sid] ?? {}), null, 2);
  const afterSnippet = JSON.stringify(redactObjectDeep((afterObj as any)?.['mcpServers']?.[sid] ?? {}), null, 2);

  return { configPath: effectivePath, before: beforeStr, after: afterStr, snippetBefore: beforeSnippet, snippetAfter: afterSnippet };
}

export async function computeRemovalPreview(
  provider: AgentProvider,
  removal: RemovalConfig
): Promise<{ configPath: string; before: string; after: string; snippetBefore: string; snippetAfter: string } | null> {
  const configPath = (await provider.detect(removal.configDir)) || null;
  const effectivePath = configPath || (removal.configDir || '(agent default path)');
  let existing: Record<string, any> = {};
  try {
    if (configPath) {
      existing = await FileOperations.readJsonFile<Record<string, any>>(configPath);
    }
  } catch {
    existing = {};
  }
  const beforeObj = redactObjectDeep(clone(existing));

  const next = clone(existing);
  if (next['mcpServers'] && typeof next['mcpServers'] === 'object') {
    if ((removal as any)['mcpServerId'] in next['mcpServers']) {
      const { [(removal as any)['mcpServerId']]: _removed, ...rest } = next['mcpServers'];
      next['mcpServers'] = rest;
    }
  }
  const afterObj = redactObjectDeep(clone(next));

  const beforeStr = JSON.stringify(beforeObj, null, 2);
  const afterStr = JSON.stringify(afterObj, null, 2);
  const rId = (removal as any)['mcpServerId'];
  const beforeSnippet = JSON.stringify(redactObjectDeep((beforeObj as any)?.['mcpServers']?.[rId] ?? {}), null, 2);
  const afterSnippet = JSON.stringify(redactObjectDeep((afterObj as any)?.['mcpServers']?.[rId] ?? {}), null, 2);

  return { configPath: effectivePath, before: beforeStr, after: afterStr, snippetBefore: beforeSnippet, snippetAfter: afterSnippet };
}
