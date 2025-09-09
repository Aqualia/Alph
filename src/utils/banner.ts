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
 * @param chalk Chalk instance
 * @returns Colored banner string
 */
export function colorizeBanner(lines: string[], style: 'main' | 'wizard' = 'main', chalk: any): string {
  if (style === 'main') {
    // Apply red to orange gradient coloring
    return lines.map((line, index) => {
      // Alternate between red and orange for a gradient effect
      if (index % 2 === 0) {
        return chalk.red.bold(line);
      } else {
        return chalk.hex('#FFA500').bold(line); // Orange color
      }
    }).join('\n');
  } else {
    // Apply cyan coloring for wizard
    return lines.map(line => chalk.bold.cyan(line)).join('\n');
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
  // Dynamically import ESM-only chalk in CJS context
  const { default: chalk } = await import('chalk');

  const lines = ALPH_BANNER
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .split('\n')
    .filter(l => l.trim().length > 0)
    // Left-align banner (no centering per requested positioning)
    .map(l => l);

  return colorizeBanner(lines, 'main', chalk);
}

/**
 * Get the wizard banner with coloring
 * @param width Terminal width for centering
 * @returns Formatted banner string
 */
export async function getWizardBanner(): Promise<string> {
  const { default: chalk } = await import('chalk');

  const terminalWidth = process.stdout.columns || 80;
  const lines = WIZARD_BANNER
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .split('\n')
    .filter(l => l.trim().length > 0)
    .map(l => centerText(l, terminalWidth));

  return colorizeBanner(lines, 'wizard', chalk);
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
export async function showMainBanner(): Promise<void> {
  console.log();
  console.log(await getMainBanner());
  console.log();
  
  // Left-aligned description (avoid centering)
  const description = 'Universal Remote MCP Server Manager';
  console.log(description);
  console.log();
}

/**
 * Display the interactive wizard banner
 */
export async function showWizardBanner(): Promise<void> {
  console.log();
  console.log(await getWizardBanner());
  console.log();
  
  // Centered description
  const terminalWidth = process.stdout.columns || 80;
  const description = 'Universal Remote MCP Server Manager';
  console.log(centerText(description, terminalWidth));
  console.log();
  console.log('🚀 Welcome to the Alph Configuration Wizard');
  console.log('─'.repeat(42));
  console.log('Configure your AI agents to work with MCP servers');
  console.log();
}
