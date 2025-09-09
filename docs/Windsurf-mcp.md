Windsurf Cascade MCP – Integration with Alph
Overview: Windsurf (formerly Codeium’s editor) includes Cascade, an AI agent that can leverage external tools via the Model Context Protocol (MCP)[1]. To integrate Alph with Windsurf, Alph must configure Windsurf’s MCP client to recognize and launch Alph’s MCP server. This involves editing Windsurf’s MCP config file to add a new server entry, using the same JSON schema as Anthropic’s Claude Desktop config[2]. Alph should ensure the correct fields are set (depending on whether Alph’s server is a local process or a remote HTTP endpoint) and handle any platform-specific concerns.
Configuration File and Location
Windsurf persists MCP server settings in a JSON file named mcp_config.json, located in the user’s home directory. On Unix-like systems (macOS/Linux) this path is: ~/.codeium/windsurf/mcp_config.json[2]. (On Windows, it should reside under the user’s home, e.g. %USERPROFILE%\.codeium\windsurf\mcp_config.json – consistent with Codeium’s use of a .codeium folder.) Alph’s integration should detect this file. If not present, Alph can create it along with the necessary parent directories.
•	Detection: Alph can consider Windsurf “installed” or available if this config path exists or if other indicators of Windsurf are present (e.g. the Windsurf editor is installed). Since Windsurf is a VSCode-derivative, checking for its installation might be non-trivial; a safe approach is to assume the user has Windsurf if they request this integration. Alph should attempt to read ~/.codeium/windsurf/mcp_config.json. If the file is unreadable or missing, Alph should be prepared to initialize it with a proper JSON structure (at least {"mcpServers": {}}).
•	Backup and JSON Parsing: Before modifying, Alph should back up any existing config (consistent with Alph’s safe-edit practices). The JSON is expected to contain a top-level object with an mcpServers field mapping server IDs to config objects[2]. Alph must parse/merge rather than overwrite this JSON to preserve any user-defined servers. Use a robust JSON library to avoid syntax errors.
MCP Server Schema for Windsurf (Cascade)
Each server entry under mcpServers in Windsurf’s config follows the Claude Desktop schema[2]. Key properties include:
•	command (string) – The executable to run for a local MCP server (e.g. "npx", "docker", or a binary path).
•	args (string array) – Command-line arguments for the above command. For example, to run a Node-based MCP server via npx, args might include "-y" (yes to prompts) and the npm package name of the server[3]. If launching a Docker container, args would include Docker parameters and image name[4].
•	env (object, optional) – Environment variables to set for the MCP server process. Used for API keys or auth tokens (e.g., setting GITHUB_PERSONAL_ACCESS_TOKEN)[5]. Alph should insert any required secrets here (ensuring to redact them from logs/UI output).
•	serverUrl (string) – Used only for HTTP/SSE servers. This field specifies the base URL of a remote MCP server[6][7]. Windsurf expects the URL to include the MCP endpoint path (commonly /mcp or similar). If this field is present, Windsurf will treat the server as a remote HTTP-based MCP server instead of launching a local process.
Windsurf supports two transport types: stdio (for local processes run via command/args) and http/SSE (for remote endpoints)[8]. The presence of command vs. serverUrl in the JSON determines the mode. Alph should set either command+args or serverUrl, not both, for each server entry:
•	Local Example: To configure a local MCP server that Alph provides (e.g. a Node script or container), Alph might write an entry like:
{
  "mcpServers": {
    "alph-server": {
      "command": "npx",
      "args": ["-y", "my-mcp-server"],
      "env": {
        "MY_API_KEY": "your-api-key-here"
      }
    }
  }
}
This example (based on a Warp usage post) would tell Windsurf to run npx -y my-mcp-server and pass along an API key[9]. In practice, Alph will substitute the actual command and args for the Alph MCP server binary or script. Ensure any relative paths in args are handled (for local servers, absolute paths are safer in this Windsurf config because there’s no explicit working directory field).
•	Remote Example: If Alph’s MCP server is running remotely (or as a separate service that exposes an MCP endpoint), Alph should use serverUrl. For instance, to add a hypothetical Figma MCP server (as in Windsurf docs):
{
  "mcpServers": {
    "figma-dev": {
      "serverUrl": "https://<your-server-url>/mcp"
    }
  }
}
[10]. Windsurf will connect to this URL for tool access. Alph needs to ensure the URL is correct (including scheme and path). If the server requires authentication, Windsurf’s MCP implementation may support an authentication flow or might rely on environment variables/tokens – the Windsurf docs mention supporting MCP Authentication and treating certain URLs like passwords[11], but specifics aren’t given. Alph should check if the MCP server in question (for Alph) requires special config (e.g. an auth token in an env field or user login via Windsurf UI).
Platform notes: The JSON schema remains the same across OS. The location of the config file on Windows is likely in the user’s home directory under .codeium\windsurf (as Codeium historically used the home directory on Windows as well). Ensure Alph expands ~ correctly depending on OS. No environment-variable override for this path is documented (unlike Alph’s own ALPH_CLAUDE_CONFIG etc.), so Alph should use the default path unless instructed otherwise by the user.
Applying Configuration and Activation
Once Alph writes the new entry into mcp_config.json, Windsurf’s Cascade needs to load it:
•	Loading Changes: According to Windsurf documentation, if you manually edit the config file, you should refresh the Cascade plugins in the UI[12]. Alph cannot directly force the editor UI to refresh. Therefore, after configuring, Alph should prompt the user to manually refresh the Windsurf Cascade plugin list (via the Windsurf settings or a “Refresh” button in the Cascade panel)[12]. This will cause Windsurf to pick up the new MCP server entry. Without a refresh or restart, the new server may not be recognized immediately.
•	Tool Limits: Windsurf allows up to 100 MCP tools active at once[13]. This likely won’t be exceeded by a single Alph integration (most MCP servers expose far fewer tools), but if the user already has many MCP plugins, adding another could hit the limit. Alph might warn if adding Alph’s server would exceed this limit, although specifics on counting tools aren’t provided.
•	Team Policies: In enterprise settings, Windsurf teams can whitelist specific MCP servers. If a team admin has restricted MCP usage, a user’s custom server might be blocked unless whitelisted[14][15]. Alph should note: if integration doesn’t seem to work (server not being called), team policy could be the cause. The server’s “ID” (the key in mcp_config.json) must match a whitelisted pattern or it will be rejected[15][16]. Alph could query the user if they are on a managed team, but handling this automatically is likely out of scope. Instead, document this as a possible integration hurdle: “If you’re on Windsurf Enterprise and have MCP whitelisting, ensure your new server ID and config comply with your admin’s policies.”
•	Example Integration: Suppose Alph is helping configure a GitHub MCP tool via Alph’s own server. Windsurf’s Plugin Store might already offer an official “github-mcp-server” plugin. If Alph is adding a custom server (say, an improved GitHub integration), it should use a distinct server ID to avoid clashing with the official one. For instance, Alph might choose "alph-github" as the key instead of "github-mcp-server". Then insert Alph’s server details under that key. This prevents confusion with any existing plugin entry. The resulting snippet in mcp_config.json could look like:
{
  "mcpServers": {
    "alph-github": {
      "command": "docker",
      "args": [
        "run", "-i", "--rm",
        "-e", "GITHUB_PERSONAL_ACCESS_TOKEN",
        "ghcr.io/my-org/alph-github-mcp:latest"
      ],
      "env": {
        "GITHUB_PERSONAL_ACCESS_TOKEN": "<your_token>"
      }
    }
  }
}
This example uses Docker to run the MCP server (hypothetically hosted at ghcr.io). It follows the pattern shown in Windsurf docs for Docker-based servers[4]. Alph’s code should ensure the JSON structure merges correctly if other servers exist.
Verification and Troubleshooting
After Alph writes the config and the user refreshes Cascade, the new server should appear in Windsurf’s MCP plugin list (Windsurf UI shows installed plugins, possibly under Cascade > Plugins or a similar section). The user can then enable or disable specific tools from that server via the UI[17]. Alph can guide the user to verify that the server is running and tools are accessible:
•	Running State: Windsurf likely launches the MCP server on-demand. The documentation doesn’t explicitly state if Windsurf starts all configured stdio servers on launch or lazily when a tool is invoked. It’s implied that installing (enabling) a plugin will make its tools available; for local/stdio servers, Windsurf might start them immediately or when first needed. If the server is not running, the user may need to restart Windsurf or toggle the plugin. Alph should instruct: “If you don’t see the Alph server tools, try restarting Windsurf or toggling the plugin off and on.”
•	Logs and Errors: The Windsurf docs do not detail where MCP server output or errors go. Given it runs as a child process, errors might surface in the Windsurf UI or a log file. If integration isn’t working (tools failing), the user should check Windsurf’s logs or console for clues. Alph can only provide general advice here (e.g., ensure the server command is correct and accessible in PATH, environment variables are correct, etc.). If a misconfiguration is suspected (malformed JSON), Windsurf might overwrite or ignore the file. Thus, validating the JSON structure after editing (and maybe using Windsurf’s “Edit Config” in UI to see if it loads) is important.
•	Removal: If needed, Alph should support removing the server config (perhaps via an alph remove command). This would involve deleting the entry from mcp_config.json. Ensure to backup before removal. Removing a server should disable its tools in Cascade (the user might still need to refresh or see a notice that the plugin was removed).
Gap/Unknown: Windsurf does not document a programmatic interface (like a CLI) for managing MCP servers. We rely on file editing. One potential gap: knowing if Windsurf is running and needs a restart. The docs don’t say a restart is required; presumably a config reload happens on file change or on clicking refresh. If it turns out Windsurf only loads mcp_config.json on startup, the user would need to restart the editor. If our manual refresh advice isn’t sufficient, Alph should suggest a restart as a fallback.
In summary, integrating Alph with Windsurf involves editing ~/.codeium/windsurf/mcp_config.json to add a new server under mcpServers, using the Claude/Codeium JSON schema. Alph must handle local vs. remote server config properly (using command/args/env for local, or serverUrl for remote), then instruct the user to refresh or restart Windsurf to apply changes. With this in place, Cascade can invoke Alph’s MCP server tools seamlessly, extending Windsurf’s AI capabilities.
Sources:
•	Windsurf Cascade MCP integration docs (Codeium/Windsurf)[2][5][10]
•	Windsurf admin/whitelist rules (impacting custom servers)[15][16]
•	Example MCP server configurations (local vs. HTTP)[5][10]
•	Community example of adding a local MCP server (Reddit post)[9]
