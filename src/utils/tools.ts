import { spawnSync, execSync } from 'child_process';
import { ToolEntry, ToolsCatalog, defaultToolsCatalogLoader } from '../catalog/toolsLoader';

export type InstallManager = 'npm' | 'brew' | 'pipx' | 'cargo' | 'auto';

export interface DetectResult {
  installed: boolean;
  command?: string; // preferred command to run
}

function which(cmd: string): boolean {
  const isWin = process.platform === 'win32';
  try {
    if (isWin) {
      const r = spawnSync('where', [cmd], { stdio: 'ignore' });
      return r.status === 0;
    } else {
      const r = spawnSync('which', [cmd], { stdio: 'ignore' });
      return r.status === 0;
    }
  } catch {
    return false;
  }
}

function splitCommand(cmd: string): { command: string; args: string[] } {
  const parts = cmd.split(' ').filter(Boolean);
  const head = parts[0] || '';
  const rest = parts.length > 1 ? parts.slice(1) : [];
  return { command: head, args: rest };
}

export function detectTool(tool: ToolEntry): DetectResult {
  // Prefer the bin field
  if (tool.bin && which(tool.bin)) {
    return { installed: true, command: tool.bin };
  }
  // Try discovery commands: if first token exists, consider installed
  const cmds = tool.discovery?.commands ?? [];
  for (const c of cmds) {
    const { command } = splitCommand(c);
    if (which(command)) {
      return { installed: true, command: command };
    }
  }
  return { installed: false };
}

export function chooseDefaultInvocation(tool: ToolEntry, detected?: DetectResult): { command: string; args: string[] } {
  // If bin is present and installed, use bin
  if (detected?.installed && detected.command === tool.bin) {
    return { command: tool.bin, args: [] };
  }
  // Otherwise use the first discovery command, split into tokens
  const cmd = (tool.discovery?.commands && tool.discovery.commands.length > 0) ? tool.discovery.commands[0] : tool.bin;
  const { command, args } = splitCommand(cmd || tool.bin);
  return { command, args };
}

export async function installTool(tool: ToolEntry, preferred?: InstallManager): Promise<void> {
  const plat = process.platform;
  const mgr = (preferred && preferred !== 'auto') ? preferred : (process.env['ALPH_INSTALL_MANAGER'] as InstallManager | undefined) || 'auto';

  const installers = plat === 'win32' ? (tool.installers.windows || [])
                   : plat === 'darwin' ? (tool.installers.macos || [])
                   : (tool.installers.linux || []);

  let chosen = installers[0];
  if (mgr !== 'auto') {
    const cand = installers.find(i => i.type.toLowerCase() === mgr);
    if (cand) chosen = cand;
  }
  if (!chosen) throw new Error('No installer defined for this platform');

  console.log(`\n📦 Installing ${tool.id} using: ${chosen.command}`);
  execSync(chosen.command, { stdio: 'inherit', env: process.env });
}

export function runHealthCheck(tool: ToolEntry): { ok: boolean; message?: string } {
  try {
    if (tool.health?.version?.command) {
      execSync(tool.health.version.command, { stdio: 'ignore' });
    }
    if (tool.health?.probe?.command) {
      execSync(tool.health.probe.command, { stdio: 'ignore' });
    }
    return { ok: true };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, message: msg };
  }
}

export function loadToolsCatalog(): ToolsCatalog {
  return defaultToolsCatalogLoader.load();
}
