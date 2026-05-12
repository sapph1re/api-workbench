import * as vscode from 'vscode';
import { parseHttpFile, getRequestAtCursor, resolveVariables } from './parser';
import { executeRequest, HttpResponse, ExecutorOptions } from './executor';
import { EnvironmentManager } from './environment';
import { ResponsePanel } from './responsePanel';
import { CollectionTreeProvider, EnvironmentTreeProvider } from './collectionTree';
import { HttpCodeLensProvider } from './codeLens';

let envManager: EnvironmentManager;
let responsePanel: ResponsePanel;
let collectionTree: CollectionTreeProvider;
let envTree: EnvironmentTreeProvider;
let statusBarItem: vscode.StatusBarItem;

export function activate(context: vscode.ExtensionContext): void {
  envManager = new EnvironmentManager();
  responsePanel = new ResponsePanel(context);
  collectionTree = new CollectionTreeProvider();
  envTree = new EnvironmentTreeProvider(
    () => envManager.getEnvironments(),
    () => envManager.getCurrentName()
  );

  statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  statusBarItem.command = 'apiWorkbench.selectEnvironment';
  updateStatusBar();
  statusBarItem.show();

  envManager.onDidChange(() => {
    updateStatusBar();
    envTree.refresh();
  });

  context.subscriptions.push(
    vscode.window.registerTreeDataProvider('apiWorkbench.collections', collectionTree),
    vscode.window.registerTreeDataProvider('apiWorkbench.environments', envTree),
    vscode.languages.registerCodeLensProvider({ language: 'http' }, new HttpCodeLensProvider()),
    vscode.commands.registerCommand('apiWorkbench.sendRequest', sendRequestCommand),
    vscode.commands.registerCommand('apiWorkbench.sendAllRequests', sendAllRequestsCommand),
    vscode.commands.registerCommand('apiWorkbench.selectEnvironment', () => envManager.selectEnvironment()),
    vscode.commands.registerCommand('apiWorkbench.refreshCollections', () => collectionTree.refresh()),
    statusBarItem,
    envManager,
    collectionTree,
  );
}

export function deactivate(): void {}

function updateStatusBar(): void {
  const env = envManager.getCurrentName();
  statusBarItem.text = `$(globe) ${env || 'No Env'}`;
  statusBarItem.tooltip = env ? `Active environment: ${env}` : 'Click to select environment';
}

function getExecutorOptions(): Partial<ExecutorOptions> {
  const config = vscode.workspace.getConfiguration('apiWorkbench');
  return {
    timeout: config.get<number>('timeout', 30000),
    followRedirects: config.get<boolean>('followRedirects', true),
    maxResponseSize: config.get<number>('maxResponseSize', 10 * 1024 * 1024),
  };
}

async function sendRequestCommand(uri?: vscode.Uri, position?: vscode.Position): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor && !uri) {
    vscode.window.showErrorMessage('No active .http file');
    return;
  }

  const doc = uri ? await vscode.workspace.openTextDocument(uri) : editor!.document;
  const pos = position || editor?.selection.active || new vscode.Position(0, 0);

  const request = getRequestAtCursor(doc, pos);
  if (!request) {
    vscode.window.showErrorMessage('No HTTP request found at cursor position');
    return;
  }

  await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: `Sending ${request.method} ${truncate(request.url, 40)}...` },
    async () => {
      const envVars = envManager.getActiveVariables();
      const response = await executeRequest(request, envVars, getExecutorOptions());
      responsePanel.show(response);

      const outputChannel = getOutputChannel();
      writeAgentOutput(outputChannel, response);
    }
  );
}

async function sendAllRequestsCommand(): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    vscode.window.showErrorMessage('No active .http file');
    return;
  }

  const requests = parseHttpFile(editor.document.getText());
  if (requests.length === 0) {
    vscode.window.showInformationMessage('No HTTP requests found in file');
    return;
  }

  const envVars = envManager.getActiveVariables();
  const opts = getExecutorOptions();
  const outputChannel = getOutputChannel();
  outputChannel.clear();
  outputChannel.show(true);

  let lastResponse: HttpResponse | undefined;

  await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: `Running ${requests.length} requests...`, cancellable: true },
    async (progress, token) => {
      for (let i = 0; i < requests.length; i++) {
        if (token.isCancellationRequested) break;
        progress.report({ message: `(${i + 1}/${requests.length}) ${requests[i].method} ${truncate(requests[i].url, 30)}`, increment: 100 / requests.length });
        const response = await executeRequest(requests[i], envVars, opts);
        writeAgentOutput(outputChannel, response);
        lastResponse = response;
      }
    }
  );

  if (lastResponse) {
    responsePanel.show(lastResponse);
  }
}

let _outputChannel: vscode.OutputChannel | undefined;
function getOutputChannel(): vscode.OutputChannel {
  if (!_outputChannel) {
    _outputChannel = vscode.window.createOutputChannel('API Workbench');
  }
  return _outputChannel;
}

function writeAgentOutput(channel: vscode.OutputChannel, response: HttpResponse): void {
  channel.appendLine('---');
  channel.appendLine(`REQUEST: ${response.request.method} ${response.request.url}`);
  channel.appendLine(`STATUS: ${response.status} ${response.statusText}`);
  channel.appendLine(`DURATION: ${response.timing.durationMs}ms`);
  channel.appendLine(`SIZE: ${response.size.totalBytes} bytes`);
  if (response.error) {
    channel.appendLine(`ERROR: ${response.error}`);
  }

  const contentType = response.headers['content-type'] || '';
  if (contentType.includes('json') || response.body.trimStart().startsWith('{') || response.body.trimStart().startsWith('[')) {
    try {
      const parsed = JSON.parse(response.body);
      channel.appendLine(`BODY_JSON: ${JSON.stringify(parsed)}`);
    } catch {
      channel.appendLine(`BODY: ${response.body.slice(0, 2000)}`);
    }
  } else {
    channel.appendLine(`BODY: ${response.body.slice(0, 2000)}`);
  }
  channel.appendLine('---');
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n) + '...' : s;
}
