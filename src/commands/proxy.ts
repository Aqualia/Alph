import { spawn } from 'child_process';
import { buildSupergatewayArgs, redactForLogs, ProxyHeader } from '../utils/proxy';
import { ui } from '../utils/ui';

export interface ProxyRunOptions {
  remoteUrl: string;
  transport: 'http' | 'sse';
  bearer?: string | undefined;
  header?: string[] | undefined; // repeated "K: V"
  proxyVersion?: string | undefined; // informational; not used for argv composition here
  docker?: boolean | undefined;
}

export interface ProxyHealthOptions {
  remoteUrl: string;
  transport: 'http' | 'sse';
  bearer?: string | undefined;
  header?: string[] | undefined;
  proxyVersion?: string | undefined;
}

function parseHeaderList(header?: string[]): ProxyHeader[] {
  const out: ProxyHeader[] = [];
  if (!header) return out;
  for (const h of header) {
    const idx = h.indexOf(':');
    if (idx <= 0) continue;
    const key = h.slice(0, idx).trim();
    const value = h.slice(idx + 1).trim();
    out.push({ key, value });
  }
  return out;
}

function getPinnedVersion(override?: string): string {
  return override || (process?.env?.['ALPH_PROXY_VERSION'] as string | undefined) || '3.4.0';
}

export async function proxyRun(opts: ProxyRunOptions): Promise<number> {
  const headers = parseHeaderList(opts.header);
  const argv = buildSupergatewayArgs({
    remoteUrl: opts.remoteUrl,
    transport: opts.transport,
    bearer: opts.bearer,
    headers,
    version: opts.proxyVersion,
  });

  const pinned = getPinnedVersion(opts.proxyVersion);
  const command = opts.docker ? 'docker' : 'npx';
  const args = opts.docker
    ? ['run', '--rm', `ghcr.io/supercorp-ai/supergateway:${pinned}`, ...argv]
    : ['-y', `supergateway@${pinned}`, ...argv];

  const redacted = redactForLogs([command, ...args]).join(' ');
  ui.info(`[alph] launching proxy (pin ${pinned}): ${redacted}`);

  return new Promise<number>((resolve) => {
    const child = spawn(command, args, { stdio: 'inherit' });
    child.on('close', (code) => resolve(code ?? 0));
    child.on('error', () => resolve(1));
  });
}

export async function proxyHealth(opts: ProxyHealthOptions): Promise<number> {
  // Compose a dry-run preview including pinned version
  const headers = parseHeaderList(opts.header);
  const argv = buildSupergatewayArgs({
    remoteUrl: opts.remoteUrl,
    transport: opts.transport,
    bearer: opts.bearer,
    headers,
  });
  const pinned = getPinnedVersion(opts.proxyVersion);
  const preview = redactForLogs(['npx', '-y', `supergateway@${pinned}`, ...argv]).join(' ');
  ui.info(`[alph] health probe: ${preview}`);

  try {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), 2500);
    const url = opts.remoteUrl;
    const hdrs: Record<string, string> = {};
    for (const h of headers) hdrs[h.key] = h.value;
    if (opts.bearer && !hdrs['Authorization']) hdrs['Authorization'] = `Bearer ${opts.bearer}`;

    if (opts.transport === 'http') {
      const resp = await fetch(url, { method: 'GET', headers: hdrs, signal: controller.signal as any });
      clearTimeout(t);
      if (resp.ok) return 0;
      ui.error(`[alph] health: HTTP status ${resp.status}`);
      return 2;
    } else {
      hdrs['Accept'] = 'text/event-stream';
      const resp = await fetch(url, { method: 'GET', headers: hdrs, signal: controller.signal as any });
      const ct = resp.headers.get('content-type') || '';
      clearTimeout(t);
      if (!resp.ok || !ct.toLowerCase().includes('text/event-stream')) {
        ui.error(`[alph] health: SSE handshake failed (status ${resp.status}, content-type ${ct})`);
        return 3;
      }
      // Consider headers sufficient for health
      return 0;
    }
  } catch (e) {
    ui.error(`[alph] health error: ${e instanceof Error ? e.message : String(e)}`);
    return 1;
  }
}
