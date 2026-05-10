import * as vscode from 'vscode';
import { startMCPServer } from './mcpServer';

export function activate(context: vscode.ExtensionContext) {
	const outputChannel = vscode.window.createOutputChannel('Task MCP');
	outputChannel.append('vscode Task MCP extension is now active!');
	startMCPServer(context);
}

export function deactivate() { }