/**
 * Agent filtering utilities
 */
import { defaultRegistry } from '../agents/registry';

const ALIASES: Record<string, string> = {
  gemini: 'Gemini CLI',
  geminicli: 'Gemini CLI',
  'gemini-cli': 'Gemini CLI',
  cursor: 'Cursor',
  claude: 'Claude Code',
  claudecode: 'Claude Code',
  'claude-code': 'Claude Code',
  codex: 'Codex CLI',
  'codex-cli': 'Codex CLI',
  codexcli: 'Codex CLI',
  windsurf: 'Windsurf',
  'codeium-windsurf': 'Windsurf',
  warp: 'Warp',
  'warp-terminal': 'Warp'
};

export function parseAgentNames(agentList?: string | string[]): string[] {
  if (!agentList) return [];
  const items = Array.isArray(agentList)
    ? agentList
    : agentList.split(',');
  return items
    .map(s => s.trim())
    .filter(Boolean);
}

export function mapAliases(agents: string[]): string[] {
  const set = new Set<string>();
  for (const a of agents) {
    const key = a.toLowerCase();
    set.add(ALIASES[key] || a);
  }
  return Array.from(set);
}

export function validateAgentNames(agents: string[]): { valid: string[]; invalid: string[] } {
  if (!agents || agents.length === 0) return { valid: [], invalid: [] };
  const registered = new Set(defaultRegistry.getProviderNames());
  const valid: string[] = [];
  const invalid: string[] = [];
  for (const a of agents) {
    if (registered.has(a)) valid.push(a);
    else invalid.push(a);
  }
  return { valid, invalid };
}
