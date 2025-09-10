import os from 'os';
import path from 'path';

export interface PathContext {
  projectDir?: string;
  platform?: NodeJS.Platform;
  env?: NodeJS.ProcessEnv;
}

/**
 * Expand supported tokens in a path template.
 * Supported tokens:
 * - ${home}
 * - ${projectDir}
 * Additionally, helpers for XDG/APPDATA can be used by callers if needed.
 */
export function expandPathTemplate(template: string | null | undefined, ctx: PathContext = {}): string | null {
  if (!template) return template ?? null;
  const home = os.homedir();
  const projectDir = ctx.projectDir ?? process.cwd();

  let result = template;
  result = result.replace(/\$\{home\}/g, home);
  result = result.replace(/\$\{projectDir\}/g, projectDir);

  // Normalize using posix to keep forward slashes for display and tests;
  // downstream callers that need OS-specific paths can re-normalize.
  return path.posix.normalize(result.replace(/\\/g, '/'));
}

export function getXdgConfigHome(env: NodeJS.ProcessEnv = process.env): string | null {
  const xdg = env['XDG_CONFIG_HOME'];
  if (xdg && xdg.trim() !== '') return xdg;
  // default per spec
  const home = os.homedir();
  return path.join(home, '.config');
}

export function getMacOsAppSupportDir(): string {
  const home = os.homedir();
  return path.join(home, 'Library', 'Application Support');
}

export function getWindowsAppData(env: NodeJS.ProcessEnv = process.env): string | null {
  return env['APPDATA'] || null;
}
