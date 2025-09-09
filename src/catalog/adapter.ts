import path from 'path';
import os from 'os';
import { defaultCatalogLoader } from './loader';
import { AgentEntry } from './loader';

export type AgentId = 'cursor' | 'gemini' | 'claude';
export type Scope = 'project' | 'user';

function findAgent(agentId: AgentId): AgentEntry | undefined {
  try {
    const catalog = defaultCatalogLoader.load({});
    return catalog.agents.find(a => a.id === agentId);
  } catch {
    return undefined;
  }
}

/**
 * Resolve a configuration file path for an agent/scope combination using the catalog.
 * Falls back to a sensible default when the catalog has no template for the scope.
 */
export function resolveConfigPath(
  agentId: AgentId,
  scope: Scope,
  projectDir?: string
): string | null {
  const agent = findAgent(agentId);
  if (!agent) return null;

  const tmpl = scope === 'project' ? agent.scopes?.project?.pathTemplate : agent.scopes?.user?.pathTemplate;
  if (tmpl && typeof tmpl === 'string') {
    // loader already expands ${home}/${projectDir}; normalize
    return path.normalize(tmpl);
  }

  // Fallbacks when the catalog intentionally omits a template (e.g., claude user scope)
  const home = os.homedir();
  switch (agentId) {
    case 'cursor':
      return scope === 'project'
        ? path.join(projectDir || process.cwd(), '.cursor', 'mcp.json')
        : path.join(home, '.cursor', 'mcp.json');
    case 'gemini':
      return scope === 'project'
        ? path.join(projectDir || process.cwd(), '.gemini', 'settings.json')
        : path.join(home, '.gemini', 'settings.json');
    case 'claude':
      // Claude user scope defaults to ~/.claude.json; project scope uses .claude/settings.local.json under project
      return scope === 'project'
        ? path.join(projectDir || process.cwd(), '.claude', 'settings.local.json')
        : path.join(home, '.claude.json');
    default:
      return null;
  }
}

