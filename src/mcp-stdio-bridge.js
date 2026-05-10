#!/usr/bin/env node
const { Server } = require('@modelcontextprotocol/sdk/server/index.js');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
const { CallToolRequestSchema, ListToolsRequestSchema } = require('@modelcontextprotocol/sdk/types.js');
const http = require('http');
const path = require('path');
const fs = require('fs');
const os = require('os');

// --- Scan tmpdir to discover VSCode extension ports ---
function discoverPorts() {
    const tmpDir = os.tmpdir();
    const files = fs.readdirSync(tmpDir).filter(f => /^vscode-task-mcp-\d+\.json$/.test(f));
    const entries = [];
    for (const file of files) {
        try {
            const fullPath = path.join(tmpDir, file);
            const raw = fs.readFileSync(fullPath, 'utf8');
            const data = JSON.parse(raw);
            if (data.port && data.workspace !== undefined) {
                entries.push(data);
            }
        } catch (_) {
            // Skip corrupted port files
        }
    }
    return entries;
}

function httpHealthCheck(port) {
    return new Promise((resolve) => {
        const req = http.get(`http://127.0.0.1:${port}/tasks`, (res) => {
            resolve(res.statusCode === 200);
        });
        req.on('error', () => resolve(false));
        req.setTimeout(2000, () => { req.destroy(); resolve(false); });
    });
}

async function findPort() {
    // Environment variable takes priority (explicit override)
    if (process.env.VSCODE_TASK_MCP_PORT) {
        return parseInt(process.env.VSCODE_TASK_MCP_PORT, 10);
    }

    // Match the current VSCode window via parent process PID
    const ppid = process.ppid;
    const directFile = path.join(os.tmpdir(), `vscode-task-mcp-${ppid}.json`);
    if (fs.existsSync(directFile)) {
        const { port } = JSON.parse(fs.readFileSync(directFile, 'utf8'));
        const ok = await httpHealthCheck(port);
        if (ok) {
            console.error(`Connected to port ${port} (VSCode PID ${ppid})`);
            return port;
        }
    }

    // Fallback: scan mode (for legacy port files that were not cleaned up)
    const candidates = discoverPorts();
    if (candidates.length === 0) {
        throw new Error(
            'No VSCode task MCP ports found. Is the extension active?\n' +
            'Checked directory: ' + os.tmpdir()
        );
    }

    for (const entry of candidates) {
        const ok = await httpHealthCheck(entry.port);
        if (ok) {
            console.error(`Discovered port ${entry.port} (PID ${entry.pid}, workspace: ${entry.workspace})`);
            return entry.port;
        }
    }

    throw new Error(
        `Found ${candidates.length} port file(s) but none responded. Is the extension active?`
    );
}

// --- Generic HTTP helpers ---
function httpGet(base, rpath) {
    return new Promise((resolve, reject) => {
        http.get(`${base}${rpath}`, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                if (res.statusCode !== 200) reject(new Error(`HTTP ${res.statusCode}: ${data}`));
                else resolve(JSON.parse(data));
            });
        }).on('error', reject);
    });
}

function httpPost(base, rpath, body) {
    return new Promise((resolve, reject) => {
        const req = http.request(`${base}${rpath}`, { method: 'POST', headers: { 'Content-Type': 'application/json' } }, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                if (res.statusCode !== 200) reject(new Error(`HTTP ${res.statusCode}: ${data}`));
                else resolve(JSON.parse(data));
            });
        });
        req.on('error', reject);
        req.write(JSON.stringify(body));
        req.end();
    });
}

// --- MCP Server (stdio) ---
const server = new Server(
    { name: 'vscode-task-bridge', version: '1.0.0' },
    { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
        {
            name: 'list_tasks',
            description: 'List all available VSCode tasks in the current window',
            inputSchema: { type: 'object', properties: {} }
        },
        {
            name: 'execute_task',
            description: 'Execute a task by name and wait for completion',
            inputSchema: {
                type: 'object',
                properties: { taskName: { type: 'string' } },
                required: ['taskName']
            }
        }
    ]
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    const PORT = await findPort();
    const BASE = `http://127.0.0.1:${PORT}`;
    switch (name) {
        case 'list_tasks': {
            const tasks = await httpGet(BASE, '/tasks');
            return { content: [{ type: 'text', text: JSON.stringify(tasks, null, 2) }] };
        }
        case 'execute_task': {
            const result = await httpPost(BASE, '/execute', { taskName: args.taskName });
            return { content: [{ type: 'text', text: result.message }] };
        }
        default:
            throw new Error(`Unknown tool: ${name}`);
    }
});

// Start stdio transport
const transport = new StdioServerTransport();
server.connect(transport);

console.error('Bridge started successfully');