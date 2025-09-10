# Troubleshooting Guide

This document provides solutions to common issues you may encounter while using alph-cli.

## Table of Contents

- [Installation Issues](#installation-issues)
- [Command Issues](#command-issues)
- [Configuration Problems](#configuration-problems)
- [Platform-Specific Issues](#platform-specific-issues)
- [Getting Help](#getting-help)

## Codex & Proxy Integration

- Codex requires a local STDIO proxy for remote servers
  - Symptom: HTTP/SSE entries are ignored by Codex.
  - Fix: Use proxy flags: `--proxy-transport http|sse` and `--proxy-remote-url <URL>`. Alph writes a STDIO entry that runs Supergateway.

- First-run latency with `npx`
  - Symptom: Timeout on first proxy launch.
  - Fix: Alph pre-warms `npx -y supergateway --help` and sets `startup_timeout_ms = 60000` for generic runners unless customized.

- Transport mismatch (SSE vs HTTP)
  - Symptom: Connection opens but streaming fails or hangs.
  - Fix: Prefer Streamable HTTP; use `--proxy-transport http` unless server is SSE-only.

- Version pinning
  - Symptom: Regression with newer proxy release.
  - Fix: Set `ALPH_PROXY_VERSION=<version>` or pass `--proxy-version <version>`.

- Rollback and backups
  - Symptom: Corrupted or invalid TOML.
  - Fix: Alph writes atomically with a timestamped backup and rolls back on validation failure. See `npm run drills:rollback`.

## Installation Issues

### "Command not found" after installation

**Cause**: NPM global bin directory is not in your PATH.

**Solution**:
```bash
# Check NPM global bin directory
npm config get prefix

# Add to your PATH (add to ~/.bashrc, ~/.zshrc, or ~/.profile)
export PATH="$PATH:$(npm config get prefix)/bin"

# Reload your shell configuration
source ~/.bashrc  # or ~/.zshrc
```

### Permission errors during installation

**Cause**: NPM doesn't have permission to install globally.

**Solution**:
```bash
# Option 1: Fix NPM permissions (recommended)
sudo chown -R $(whoami) $(npm config get prefix)/{lib/node_modules,bin,share}

# Option 2: Use a different prefix
npm config set prefix ~/.local
export PATH="$PATH:~/.local/bin"

## Codex CLI doesn’t see my STDIO MCP server

Symptoms:
- You added an `[mcp_servers.<name>]` entry in `~/.codex/config.toml`, but tools don’t appear or the server seems to never start.

Common causes and fixes:
- First‑run timeouts with `npx`/`yarn dlx`/`pnpm dlx`:
  - On first run these commands may download packages, exceeding Codex’s 10s default. Alph now pre‑warms such invocations and sets `startup_timeout_ms = 60000` automatically. If you customized timeouts earlier, increase them to at least 60000.
- Package not present on PATH when using a dedicated binary:
  - Use Alph’s installer flow or install the tool globally (e.g., `npm i -g <pkg>`), then re‑run Alph.
- Invalid TOML shape:
  - Ensure the top‑level key is `mcp_servers` (not `mcpServers`) per Codex docs.

Manual refresh tip:
- Codex lazily starts MCP servers. Triggering a tool that uses the server forces a launch; restarting Codex also reloads config.

---

# Option 3: Use npx (no global install)
npx --yes -p @aqualia/alph-cli alph setup --mcp-server-endpoint https://askhuman.net/mcp/ID --bearer KEY -y
```

### Node.js version issues

**Cause**: Node.js version is too old (requires 18.0.0+).

**Solution**:
```bash
# Check Node.js version
node --version

# Update Node.js using your preferred method:
# - Download from nodejs.org
# - Use nvm: nvm install node
# - Use package manager: brew install node (macOS)
```

## Command Issues

### "No AI agents detected"

**Cause**: The tool cannot find configuration files for supported AI agents.

**Solution**:
- Ensure at least one supported AI agent is installed:
  - **Gemini CLI**: Check if `~/.gemini/settings.json` exists
  - **Cursor**: Check if Cursor IDE is installed
  - **Claude Code**: Check if Claude is installed

### "Required option missing"

**Cause**: Missing required command-line flags.

**Solution**:
```bash
# Check command help
alph setup --help

# Ensure required flags are provided
alph setup --mcp-server-endpoint https://askhuman.net/mcp/YOUR_ID --bearer YOUR_TOKEN -y
```

### "Invalid transport type"

**Cause**: Invalid value for `--transport` flag.

**Solution**:
```bash
# Use valid transport types only
alph setup --mcp-server-endpoint https://askhuman.net/mcp/ID --bearer KEY --transport http -y
alph setup --mcp-server-endpoint https://askhuman.net/mcp/ID --bearer KEY --transport sse -y
```

## Configuration Problems

### Configuration file corruption

**Cause**: JSON configuration file is invalid or corrupted.

**Solution**:
```bash
# Check JSON validity
cat ~/.gemini/settings.json | jq .

# Restore from backup if available (backups are timestamped like settings.bak.YYYYMMDDTHHMMSSZ.json)
ls ~/.gemini/settings.bak.*.json
# Example: restore a specific backup
cp ~/.gemini/settings.bak.20250101T120000Z.json ~/.gemini/settings.json
```

### Automatic backup restoration failed

**Cause**: Backup file is corrupted or validation failed during restore.

**Solution**:
```bash
# Check backup integrity
ls -la ~/.gemini/settings.bak.*.json

# Manually validate backup content (pick a specific timestamp)
cat ~/.gemini/settings.bak.20250101T120000Z.json | jq .

# If backup is valid, manually restore
cp ~/.gemini/settings.bak.20250101T120000Z.json ~/.gemini/settings.json

# If all backups are corrupted, recreate configuration
alph setup --mcp-server-endpoint https://askhuman.net/mcp/YOUR_ID --bearer YOUR_TOKEN -y
```

### Secret masking issues

**Cause**: Sensitive information appears in logs or output.

**Solution**:
- Sensitive tokens and headers are redacted in CLI output (e.g., `****last4`).
- If you observe unredacted secrets, open an issue with minimal repro. Do not paste secrets.

```bash
# Check if secrets are properly masked in output
alph setup --mcp-server-endpoint https://askhuman.net/mcp/ID --bearer sk-your-key -y --dry-run
```

### Permission denied on config files

**Cause**: Configuration files or directories have incorrect permissions.

**Solution**:
```bash
# Check permissions
ls -la ~/.gemini/
ls -la ~/.cursor/

# Fix permissions
chmod 755 ~/.gemini/
chmod 644 ~/.gemini/settings.json
```

### Backup files not created

**Cause**: No write permissions or insufficient disk space.

**Solution**:
```bash
# Check disk space
df -h

# Check directory permissions
ls -la ~/.gemini/
ls -la ~/.cursor/

# Ensure write permissions
chmod 755 ~/.gemini/ ~/.cursor/
```

## Platform-Specific Issues

### Windows

**NPM installation issues**
```powershell
# Run as Administrator if needed
npm install -g @aqualia/alph-cli

# Or use Windows Package Manager
winget install nodejs
npm install -g @aqualia/alph-cli
```

**Path issues**
```powershell
# Check if NPM global directory is in PATH
echo $env:PATH

# Add NPM global directory to PATH
$npmPath = npm config get prefix
[Environment]::SetEnvironmentVariable("Path", $env:Path + ";$npmPath", "User")
```

### macOS

**Permission issues with NPM**
```bash
# Fix NPM permissions
sudo chown -R $(whoami) $(npm config get prefix)/{lib/node_modules,bin,share}

# Or use Homebrew Node.js
brew install node
npm install -g @aqualia/alph-cli
```

**Command not found**
```bash
# Add NPM global bin to PATH
echo 'export PATH="$PATH:$(npm config get prefix)/bin"' >> ~/.zshrc
source ~/.zshrc
```

### Linux

**NPM not installed**
```bash
# Ubuntu/Debian
sudo apt update
sudo apt install nodejs npm

# CentOS/RHEL
sudo yum install nodejs npm

# Arch Linux
sudo pacman -S nodejs npm

# Then install alph-cli
npm install -g @aqualia/alph-cli
```

**Permission issues**
```bash
# Create NPM global directory in home
mkdir ~/.npm-global
npm config set prefix '~/.npm-global'
echo 'export PATH="$PATH:~/.npm-global/bin"' >> ~/.bashrc
source ~/.bashrc
```

## Getting Help

### Self-Help Resources

Use the `--help` flag with any command:
```bash
alph --help
alph setup --help
```

Check your installation:
```bash
# Check if alph is installed
which alph

# Check version
alph --version

# Check Node.js version
node --version
npm --version
```

### Diagnostic Information

When reporting issues, please include:

1. **Operating System**: Version and architecture
2. **Node.js Version**: `node --version`
3. **NPM Version**: `npm --version`
4. **alph-cli Version**: `alph --version`
5. **Command Used**: Exact command that failed
6. **Error Message**: Complete error output
7. **Installation Method**: How you installed alph-cli

### Reporting Issues

Create an issue on [GitHub](https://github.com/Aqualia/Alph/issues) with:
- Clear description of the problem
- Steps to reproduce
- Expected vs actual behavior
- System information (see above)

### Recovery Procedures

**Restore configuration from backup**:
```bash
# Find backup files
ls ~/.gemini/settings.bak.*.json
ls ~/.cursor/*

# Restore a chosen backup (example timestamp)
cp ~/.gemini/settings.bak.20250101T120000Z.json ~/.gemini/settings.json
```

**Complete reinstall**:
```bash
# Uninstall
npm uninstall -g @aqualia/alph-cli

# Clear NPM cache
npm cache clean --force

# Reinstall
npm install -g @aqualia/alph-cli
```
