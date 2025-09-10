/**
 * Banner utility for consistent ASCII art display across the CLI
 */
import { readFileSync } from 'fs';
import { join } from 'path';

// Main ALPH ASCII art banner
export const ALPH_BANNER = `
  █████╗ ██╗     ██████╗ ██╗  ██╗
 ██╔══██╗██║     ██╔══██╗██║  ██║
 ███████║██║     ██████╔╝███████║
 ██╔══██║██║     ██╔═══╝ ██╔══██║
 ██║  ██║███████╗██║     ██║  ██║
 ╚═╝  ╚═╝╚══════╝╚═╝     ╚═╝  ╚═╝
`;

// Interactive wizard banner
export const WIZARD_BANNER = `
  _   _ _   _ _   _ 
 | | | | | | | | | |
 | |_| | |_| | |_| |
 |  _  |  _  |  _  |
 | | | | | | | | | |
 |_| |_|_| |_|_| |_|
`;

/**
 * Apply gradient coloring to banner lines
 * @param lines Array of banner lines
 * @param style Color style ('main' or 'wizard')
 * @returns Colored banner string
 */
import * as colors from 'yoctocolors-cjs';

// 256-color ANSI helpers for richer palette (e.g., true orange)
function color256(code: number, text: string, bold = true): string {
  const b = bold ? '\x1b[1m' : '';
  return `${b}\x1b[38;5;${code}m${text}\x1b[0m`;
}

export function colorizeBanner(lines: string[], style: 'main' | 'wizard' = 'main'): string {
  if (style === 'main') {
    // Use lighter/brighter red and orange via 256-color palette
    // Bright red ~ 196; vivid orange ~ 214
    const BRIGHT_RED = 196;
    const ORANGE = 214;
    return lines.map((line, index) => {
      const code = (index % 2 === 0) ? BRIGHT_RED : ORANGE;
      return color256(code, line, true);
    }).join('\n');
  } else {
    // Apply cyan coloring for wizard
    return lines.map(line => colors.bold(colors.cyan(line))).join('\n');
  }
}

/**
 * Center banner text in the terminal
 * @param text Text to center
 * @param width Terminal width (defaults to process.stdout.columns)
 * @returns Centered text
 */
export function centerText(text: string, width?: number): string {
  const terminalWidth = width || process.stdout.columns || 80;
  const padding = Math.max(0, Math.floor((terminalWidth - text.length) / 2));
  return ' '.repeat(padding) + text;
}

/**
 * Get the main ALPH banner with coloring
 * @param width Terminal width for centering
 * @returns Formatted banner string
 */
export async function getMainBanner(): Promise<string> {
  const lines = ALPH_BANNER
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .split('\n')
    .filter(l => l.trim().length > 0)
    // Left-align banner (no centering per requested positioning)
    .map(l => l);

  return colorizeBanner(lines, 'main');
}

/**
 * Get the wizard banner with coloring
 * @param width Terminal width for centering
 * @returns Formatted banner string
 */
export async function getWizardBanner(): Promise<string> {
  const terminalWidth = process.stdout.columns || 80;
  const lines = WIZARD_BANNER
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .split('\n')
    .filter(l => l.trim().length > 0)
    .map(l => centerText(l, terminalWidth));

  return colorizeBanner(lines, 'wizard');
}

/**
 * Get the application version from package.json
 * @returns Version string
 */
export async function getAppVersion(): Promise<string> {
  try {
    const pkgPath = join(__dirname, '../../package.json');
    const raw = readFileSync(pkgPath, 'utf8');
    const pkg = JSON.parse(raw);
    return pkg.version || 'unknown';
  } catch (error) {
    return 'unknown';
  }
}

/**
 * Display the main application banner
 */
import { ui } from './ui';

export async function showMainBanner(): Promise<void> {
  ui.info('');
  ui.info(await getMainBanner());
  ui.info('');
  
  // Left-aligned description (avoid centering)
  const description = 'Universal Remote MCP Server Manager';
  ui.info(description);
  ui.info('');
}

/**
 * Display the interactive wizard banner
 */
export async function showWizardBanner(): Promise<void> {
  ui.info('');
  ui.info(await getWizardBanner());
  ui.info('');
  
  // Centered description
  const terminalWidth = process.stdout.columns || 80;
  const description = 'Universal Remote MCP Server Manager';
  ui.info(centerText(description, terminalWidth));
  ui.info('');
  ui.info('🚀 Welcome to the Alph Configuration Wizard');
  ui.info('─'.repeat(42));
  ui.info('Configure your AI agents to work with MCP servers');
  ui.info('');
}
