# VSCode Task MCP

Expose VSCode tasks to AI coding assistants (Cline, etc.) via the Model Context Protocol.

## Features

- **`list_tasks`** — List all available VSCode tasks in the current window
- **`execute_task`** — Execute a task by name and wait for completion

## Installation

```bash
# Clone
git clone <your-repo-url>
cd mcp

# Install & compile
npm install
npm run compile
```

Then press **F5** in VSCode to start extension development, or package it:

```bash
npx vsce package
code --install-extension mcp-0.1.0.vsix
```

## Cline MCP Configuration

Add this to your Cline MCP settings (`cline_mcp_settings.json`):

```json
{
  "mcpServers": {
    "vscode-tasks": {
      "disabled": false,
      "timeout": 30,
      "type": "stdio",
      "command": "node",
      "args": [
        "~/.vscode/extensions/<publisher>.mcp-<version>/out/mcp-stdio-bridge.js"
      ]
    }
  }
}
```

> Replace `<publisher>` with the actual publisher name.

## Architecture

```
┌────────────────────────┐
│  Cline (AI Assistant)   │
│   │                     │
│   └─ stdio ──────────┐  │
├───────────────────────┼──┤
│  mcp-stdio-bridge.js  │  │  ← MCP bridge process
│   │                    │  │
│   └─ HTTP ─────────┐  │  │
├────────────────────┼──┼──┤
│  VSCode Extension   │  │  │
│  ┌─────────────────┘  │  │
│  │ mcpServer.ts        │  │  ← Built-in HTTP API
│  │ ├─ GET  /tasks      │  │
│  │ └─ POST /execute    │  │
│  └─────────────────────┘  │
│  ┌────────────────────────┤
│  │ vscode.tasks API        │
│  └────────────────────────┤
└────────────────────────────┘
```

1. Extension starts an embedded Express server on a random local port
2. Port info is written to `os.tmpdir()/vscode-task-mcp-{PID}.json`
3. Bridge process discovers the port via parent PID (`process.ppid`)
4. Bridge communicates with Cline over stdio MCP protocol

### Multi-window support

Each VSCode window's Extension Host has a unique PID. The port file is named with the Extension Host PID, and the bridge uses `process.ppid` to look up the correct port. Multiple VSCode windows work independently without interference.

## Development

```bash
npm run watch    # Watch & compile
npm run compile  # Compile once
npm run lint     # Lint
```

## License

MIT