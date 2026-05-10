import * as vscode from 'vscode';
import express from 'express';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

// Fetch all tasks
async function listAllTasks() {
    const tasks = await vscode.tasks.fetchTasks();
    return tasks.map(t => ({
        name: t.name,
        source: t.source,
        scope: t.scope,
        definition: {
            type: t.definition.type,
            command: (t.definition as any).command,
            args: (t.definition as any).args,
            script: (t.definition as any).script,
        }
    }));
}

// Execute a task by name
async function executeTaskByName(taskName: string) {
    const tasks = await vscode.tasks.fetchTasks();
    const task = tasks.find(t => t.name === taskName);
    if (!task) {
        throw new Error(`Task not found: "${taskName}". Available: ${tasks.map(t => t.name).join(', ')}`);
    }
    const execution = await vscode.tasks.executeTask(task);
    // Wait for task completion via onDidEndTaskProcess / onDidEndTask events
    const message = await new Promise<string>((resolve, reject) => {
        const disposable = vscode.tasks.onDidEndTaskProcess((e) => {
            if (e.execution === execution) {
                disposable.dispose();
                if (e.exitCode === 0) {
                    resolve(`Task "${taskName}" completed successfully (exit code 0).`);
                } else {
                    resolve(`Task "${taskName}" finished with exit code ${e.exitCode}.`);
                }
            }
        });
        // Timeout guard (5 minutes)
        const timeout = setTimeout(() => {
            disposable.dispose();
            reject(new Error(`Task "${taskName}" timed out after 5 minutes.`));
        }, 5 * 60 * 1000);
        // Clear timeout when task ends
        const endDisposable = vscode.tasks.onDidEndTask((e) => {
            if (e.execution === execution) {
                clearTimeout(timeout);
                endDisposable.dispose();
            }
        });
    });
    return message;
}

export function startMCPServer(context: vscode.ExtensionContext) {
    const outputChannel = vscode.window.createOutputChannel('Task MCP');
    outputChannel.show();
    context.subscriptions.push(outputChannel);

    const app = express();
    app.use(express.json());

    // —— Internal API endpoints ——
    app.get('/tasks', async (req, res) => {
        try {
            const tasks = await listAllTasks();
            res.json(tasks);
        } catch (e: any) {
            console.error(e);
            res.status(500).json({ error: e.message });
        }
    });

    app.post('/execute', async (req, res) => {
        try {
            const { taskName } = req.body;
            const message = await executeTaskByName(taskName);
            res.json({ message });
        } catch (e: any) {
            console.error(e);
            res.status(500).json({ error: e.message });
        }
    });

    // —— Dynamic port binding ——
    const pid = process.pid;
    const portFile = path.join(os.tmpdir(), `vscode-task-mcp-${pid}.json`);

    const server = app.listen(0, '127.0.0.1', () => {
        const port = (server.address() as any).port;
        outputChannel.appendLine(`✅ Internal API listening on http://127.0.0.1:${port}`);

        const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || '';
        // Write to tmpdir, PID distinguishes multiple windows
        fs.writeFileSync(portFile, JSON.stringify({ port, workspace: workspaceRoot, pid }));

        // Cleanup: delete port file and close server on extension deactivation
        context.subscriptions.push({
            dispose: () => {
                if (fs.existsSync(portFile)) {
                    fs.unlinkSync(portFile);
                }
                server.close();
            }
        });
    });
}
