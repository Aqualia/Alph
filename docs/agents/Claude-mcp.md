Claude Code MCP Integration
 
Alph CLI Integration Notes
•  Detection is read-only: Alph only considers Claude detected when an existing config file is present and readable. It will not create files during `alph status`.
•  Status project view: `alph status --dir "/absolute/path/to/project"` lists Claude’s global and project-level MCP servers and shows a Scope column.
•  Removal scopes: `alph remove --server-name <id> --scope <auto|global|project|all>` allows targeted deletion from global, specific project(s), all projects, or auto (global + likely project roots).
•  Restart hint: After removal operations affecting Claude, restart Claude Desktop/CLI to apply changes.
Overview: Claude Code (Anthropic’s coding assistant, available via Claude Desktop and CLI) can be extended with MCP servers to give Claude tools beyond its built-in capabilities[127][128]. For Alph CLI, integrating with Claude Code’s MCP system means understanding two modes: (1) configuring Claude (Desktop or CLI) to use external MCP servers, and (2) potentially using Claude Code itself as an MCP server for other clients[129]. Claude Code supports local and remote MCP servers similarly to Cursor/Gemini, with standard JSON-RPC protocol and three transports (stdio, SSE, HTTP) selectable[130][91]. However, its configuration spans multiple possible files and a slightly different schema.
Platform Context and Configuration Files
•	Claude Desktop (GUI) vs Claude CLI: Claude Code is accessible through a GUI application (Claude Desktop, for Mac and Windows) and a headless CLI (claude CLI, which runs on Mac/Linux and WSL). The underlying engine is the same, and both support MCP servers. The primary difference is how they are configured:
•	Claude Desktop: Uses a config file typically located at:
o	macOS: ~/Library/Application Support/Claude/claude_desktop_config.json
o	Windows: %APPDATA%\Claude\claude_desktop_config.json (e.g., C:\Users\<User>\AppData\Roaming\Claude\claude_desktop_config.json)
 	These are created/edited via the Desktop app’s Developer Settings UI[131][132]. The user can click “Edit Config” in Claude Desktop, which opens this JSON file in a text editor[133][132].
•	Claude CLI / Claude Code (headless): There is a user-level config usually at ~/.claude.json (as recommended by ClaudeLog)[134][135]. This file can contain both global settings and project-specific entries. Alternative supported locations include:
o	Project-specific: .claude/settings.local.json within a project directory (if you want settings that apply only to that project)[136].
o	User-specific (local override): ~/.claude/settings.local.json[137].
o	User-specific (global): ~/.claude/settings.json[138].
o	Dedicated MCP config: ~/.claude/mcp_servers.json[139].
 	The priority may be: project settings override user local, which override global. However, the Claude team has indicated using ~/.claude.json as a unified config is simplest for consistent behavior across versions[140][141]. Indeed, the example in ClaudeLog nests project paths inside ~/.claude.json under a "projects": { "/path/to/project": { ... } } structure[142]. This suggests ~/.claude.json can hold multiple project configs keyed by path.
 	For Alph CLI integration, it’s recommended to use the global config (~/.claude.json) approach, as it’s explicitly encouraged for reliability[140]. Project-specific config files may be useful for advanced users but add complexity. Alph CLI can document how to edit ~/.claude.json to add MCP servers globally, which Claude will then apply to all projects (unless overridden).
•	Config Schema: In Claude’s config (regardless of file), MCP servers are typically under an "mcpServers" key. The exact schema in official docs isn’t fully shown, but community sources and Claude’s CLI behaviors give us:
•	Each server entry may include a "type" field indicating transport: "stdio", "sse", or "http"[91][143].
•	Fields similar to Cursor/Gemini:
o	STDIO: Requires "command" and optional "args", "env", "cwd". For example:
 	"filesystem": {
  "type": "stdio",
  "command": "npx",
  "args": ["-y", "@modelcontextprotocol/server-filesystem", "/Users/alice/Documents", "/Users/alice/Downloads"]
}
 	This matches the official example for adding a Filesystem server on macOS (with two allowed directories)[144][145]. (Replace paths with Windows paths when on Windows.)
 	Windows note: If using npx or similar on Windows, because the Claude Desktop app likely spawns via a Node environment, it might work without explicit cmd /c. But if running in WSL or Docker, ensure the command is correct in that context. In one Docker/WSL case for browser-tools, a user had to adjust environment variable keys and use cmd differently[11][12]. For pure Claude Desktop on Windows, one might simply use "command": "npx" and let it resolve.
o	SSE: Uses "type": "sse" and a "url" field. e.g.:
 	"asana": {
  "type": "sse",
  "url": "https://mcp.asana.com/sse"
}
 	After adding such an entry (and saving config), the user would go to Claude Desktop’s /mcp menu to authenticate (Claude will detect the 401 and open a browser as needed).
o	HTTP: Uses "type": "http" and likely uses "url" as well (Anthropic unified the endpoint, so even HTTP-streaming might just be listed as type http with a url). For example,
 	"notion": {
  "type": "http",
  "url": "https://mcp.notion.com/mcp"
}
 	(This is inferred since Anthropic docs list notion’s command-line addition as claude mcp add --transport http notion https://mcp.notion.com/mcp[146][146], which presumably populates the config accordingly.)
 	In community config dumps, we don’t explicitly see "type": "http" examples, but it stands to reason given how SSE is handled. The absence of a separate httpUrl key in Claude’s schema implies that url is used for both, distinguished by the "type" field. Indeed, a user’s config snippet shows "tidewave": { "type": "sse", "url": "http://localhost:4000/tidewave/mcp" }[91] – interestingly the URL path is “/mcp” but type is sse. Possibly that server was SSE despite the path. For HTTP, one would put "type": "http".
•	Additional flags:
o	"enabled": true/false – some config dumps show an "enabled": true for servers[147]. It’s likely that if a server is disabled via UI, the config flips this to false, rather than removing it. Claude Desktop has toggles in the UI under Developer settings to enable/disable each configured server. Alph CLI should note this but it’s primarily for Claude’s internal use. If you want to temporarily disable a server, setting enabled to false (or prefixing name with something) might stop it from connecting.
o	We do not see a "trust" flag in Claude’s config. Claude’s design is to always ask user permission for actions like file writes (the Desktop app always prompts the user for dangerous actions, and there’s currently no “auto-approve” mode exposed). So unlike Gemini, Claude Code does not provide an official trust bypass in config. All MCP tool actions will go through Claude’s existing confirmation UX (which in Desktop means the user has to click “Allow” in a prompt for things like file deletion, etc.). Alph CLI can assume tool calls require user approval through Claude’s interface – there’s no programmatic override.
o	Scopes and Projects: If using ~/.claude.json with the "projects" mapping as per ClaudeLog[142], an MCP server can be under a specific path. For instance,
 	{
  "projects": {
    "/path/to/your/project": {
      "mcpServers": { ... }
    }
  }
}
 	ensures that server is only active when Claude is open in that project directory. This is advanced usage; for simplicity, one can put all servers under the top-level "mcpServers" in ~/.claude.json to make them globally available, as ClaudeLog recommends[140].
•	Adding Servers (CLI method): If using the claude CLI, commands mirror Gemini’s:
•	claude mcp add <name> <options> -- <command> for stdio, or --transport sse/http <name> <url> for remote[107][148]. E.g., claude mcp add weather-api --transport sse weather https://api.weather.com/sse would add an SSE server.
•	claude mcp add-json <name> '<json_blob>' allows directly injecting a JSON config snippet via command line[149][150]. This is useful for scripting setup. For instance:
 	claude mcp add-json local-tool '{"type":"stdio","command":"/usr/bin/tool","args":["--mode","demo"]}'
 	This updates the config without manual editing. Alph CLI could use this approach in a setup script to register known MCP servers for Claude users.
•	claude mcp list to list servers, and claude mcp remove <name> to remove. There’s also an import command:
•	claude mcp add-from-claude-desktop will read Claude Desktop’s config and import servers into the CLI’s config[151][152]. This only works on macOS and WSL (where it knows how to find the Desktop config file)[153]. For integration, if a user has already set up servers in the Desktop app, running this in their CLI environment (with --scope user if needed) can save re-entering them. It’s a nice convenience to mention.
Using Claude Code with MCP (Local & Remote)
Once configured, Claude Code gains new abilities from MCP servers:
•	Local (STDIO) Servers: Claude Desktop will automatically spawn any stdio servers on startup. In the Filesystem example, after adding the config and restarting Claude, it launches the npx @modelcontextprotocol/server-filesystem process, granting Claude a suite of file management tools[154][155]. Users can then ask Claude to read or modify files, and Claude will use the MCP tool (with user approval for each action). Alph CLI can leverage this by ensuring any necessary servers (like filesystem access) are configured – essentially acting like enabling plugins. Note that if the command is not found or errors, Claude will log an error (Claude Desktop has a hidden log console, and Claude CLI will output errors to stderr). It won’t crash Claude; the server just won’t be available.
•	Remote Servers (HTTP/SSE): Claude Code will connect to remote endpoints in the background. The user might need to authenticate via browser if not already. For example, if you configure the Notion MCP (HTTP)[156][157] and then type a query like “Summarize our project plan from Notion”, Claude will see an MCP tool for Notion and attempt to call it, which triggers an OAuth prompt on first use. Once authed, Claude can fetch data from Notion and include it in its response. Performance: remote calls incur network latency, and Claude Code may be slightly slower to respond when using them (it’s waiting on the HTTP round-trip). If an MCP server is slow or unresponsive, Claude will eventually timeout (Anthropic hasn’t published exact timeout, but presumably similar 30-60s defaults for each tool call). Claude will warn in the conversation if a tool fails. For integration, advise users to ensure remote endpoints are reachable (no VPN blocking, correct credentials) and possibly increase Claude’s timeout if needed. Anthropic allows adjusting MAX_MCP_OUTPUT_TOKENS but not directly the time – large outputs could be truncated even if the server succeeded, see below.
•	Claude Code as an MCP Server: A unique capability – you can run claude mcp serve to expose Claude’s own tools as an MCP server[129]. This essentially turns Claude Code into a backend that other MCP clients (like Cursor or Alph CLI) could connect to. For instance, after running claude mcp serve, Claude listens (likely on stdio by default, since it’s serving via the CLI process). You could then register it in Cursor’s config as:
 	{
  "mcpServers": {
    "claude-code": {
      "command": "claude",
      "args": ["mcp", "serve"],
      "env": {}
    }
  }
}
 	as shown in Anthropic docs[158][159]. This allows Cursor (or any client) to use Claude’s built-in tools like code editing, reading, etc. Essentially, Claude becomes a general MCP-compliant “super tool” with abilities like reading files (view), writing (edit), listing directories (ls), etc. Integration-wise, this is powerful: Alph CLI could connect to a running Claude instance and offload certain tasks. However, it requires the user to have Claude (and appropriate access) running. It’s more of a niche scenario – the Anthropic docs suggest using it within Claude Desktop itself to chain Claude instances for advanced workflows[160]. For Alph CLI, you might simply note that this is possible if someone wants to leverage Claude’s capabilities in another client.
•	Tool Invocation and Confirmation: Claude Code will incorporate MCP tools similarly to Gemini. In Claude’s chat, tools are used when the AI deems it necessary or when the user explicitly references a resource or uses a slash command:
•	Claude automatically provides tools to list and read resources from servers that support resources[161][162]. For instance, if a server exposes a resource file://api/authentication (as in the docs example)[49], the user can type @docs:file://api/authentication and Claude will fetch it behind the scenes.
•	Prompts from servers become slash commands: e.g., a server named “github” with a prompt “list_prs” yields /mcp__github__list_prs in Claude’s interface[163][51].
•	Every action requiring a change (like file write via filesystem server) will prompt the user “Allow or Deny”. This is a core safety feature of Claude; there is no known config to disable it (no Yolo mode). Alph CLI should expect that human approval is part of the loop for Claude, and not attempt to circumvent it.
•	Resource Limits – Output Size: Claude Code has built-in limits to avoid overwhelming the context with MCP outputs. By default:
•	It will warn if a tool’s output exceeds 10,000 tokens[164][165].
•	It will truncate (hard limit) at 25,000 tokens by default[165][166]. Both are configurable via the environment variable MAX_MCP_OUTPUT_TOKENS[167][168]. For example, a user dealing with large database dumps might set:
 	export MAX_MCP_OUTPUT_TOKENS=50000
claude
 	to raise the limit[169].
Alph CLI integrators should be aware of this when expecting large outputs from a server (like reading a huge file). If Claude is truncating, the results might be incomplete. In such cases, adjusting the env var or redesigning the server to paginate output is recommended[170]. This is a notable difference from Gemini, which doesn’t explicitly document token limits for MCP, likely because it relies on the model’s context length indirectly. Claude’s context is large, but Anthropic is cautious about giant inserts.
•	Concurrent Agents: If a user has multiple Claude sub-agents or threads, each will have their own set of MCP connections. Typically, Claude Code runs as a single agent per session (in Desktop, each window corresponds to one conversation). The config is shared, so all sessions can use the servers. There isn’t a direct concurrency issue since each tool call is synchronous within a conversation. But if two Claude windows tried to use the same local MCP server simultaneously, that server would receive interwoven JSON-RPC calls from both (assuming it supports it; many stdio servers might not expect multi-client usage). Remote servers usually can handle it by design (multiple SSE streams, etc.). It’s an edge case, but integrators should ensure that local servers are either stateless or properly handle one client at a time. If not, maybe advise to run separate instances per conversation if needed.
•	Stability and Error Handling: Claude Desktop doesn’t have a visible “MCP log” like Cursor, but errors do appear in its interface (usually as assistant messages if a tool fails). For Claude CLI, errors are printed to stderr or indicated in the CLI output (e.g., “Server X failed to respond”). If an MCP server is misconfigured (bad command or wrong URL), Claude might show a message in the chat like “Tool not available” or similar. It’s important to test each configured server. A common pitfall is a wrong path to a binary – e.g., one user struggled with WSL paths and environment for a browser tool until they set it up correctly[171][172]. The integration plan should include a testing checklist: after adding a server, ask Claude to use it in a simple way and verify it works (for remote, maybe a list operation; for local, a harmless read).
Missing Data & Filling Gaps: Unlike Cursor and Gemini, Anthropic hasn’t published a formal doc solely on the MCP JSON schema; they focus on CLI commands and general usage. As integrators, some reverse-engineering is from community blogs (ClaudeLog, Reddit posts). For absolute certainty on schema: - Consider running claude mcp add for each transport type and then inspecting ~/.claude.json to see how it recorded it. This would confirm the exact keys. For instance, run claude mcp add test-sse --transport sse test https://example.com/sse && cat ~/.claude.json to see the entry (it should show "type": "sse", "url": ...). - Check Anthropic’s official CLI reference for any mention of config structure. The Anthropic API docs site has a Claude Code settings reference[173] which might list mcpServers usage. It might not be very detailed though. - If certain advanced features (like adjusting timeouts or disabling confirmations) are not documented, assume they are not available unless found experimentally. E.g., no mention of a timeout setting per server in Claude – likely it’s fixed internally, so if a tool is timing out often, the workaround might be to split the task or increase any server-side timeout rather than something in config.
•	Another gap: Linux support for Desktop. They said “Linux support is coming soon” for Claude Desktop[174]. In the interim, Linux users run Claude in CLI or possibly in Docker. Alph CLI should clarify that if users are on Linux, they’ll be using Claude CLI (which indeed works, as evidenced by WSL usage and Docker). The functionality is the same, just no GUI.
•	Maintaining Config across versions: The config file locations or formats could change as Claude evolves (ClaudeLog suggests using ~/.claude.json for consistency across versions[140], implying there might have been changes). It’s wise for Alph CLI to caution users that if they update Claude, they should check if their MCP config still applies. For example, an older version may have required separate files but the latest consolidates them. Staying updated via ClaudeLog or Anthropic’s release notes is advisable.
In summary, Claude Code’s MCP integration is powerful, bringing the full range of tools to Claude’s AI. Alph CLI can integrate by helping users correctly configure their Claude environment: - Provide sample config snippets for each OS (with correct file paths and JSON examples). - Emphasize the need to restart Claude Desktop after editing the config (changes take effect on restart). - Suggest using the claude mcp CLI for easier setup where appropriate. - Highlight differences: e.g., no auto-run/trust – user will always approve, and output size limits.
By aligning with Claude’s way of doing things, Alph CLI ensures that any enhancements it orchestrates (like connecting Claude to a new MCP server for a user’s workflow) will be reliable and safe. If any uncertainties remain (like an undocumented config key), a quick experiment or reaching out on the Claude user community (ClaudeLog Discord or Reddit) often yields an answer, as many have tread this path and shared solutions.
