import * as vscode from 'vscode';
import * as path from 'path';
import { parseHttpFile, getRequestAtCursor, resolveVariables } from './parser';
import { executeRequest, HttpResponse, ExecutorOptions } from './executor';
import { EnvironmentManager } from './environment';
import { ResponsePanel } from './responsePanel';
import { CollectionTreeProvider, EnvironmentTreeProvider } from './collectionTree';
import { HttpCodeLensProvider } from './codeLens';
import { runCollection, CollectionResult } from './runner';
import { generateMarkdownReport, generateJsonReport } from './report';

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
    vscode.commands.registerCommand('apiWorkbench.runCollection', runCollectionCommand),
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

async function runCollectionCommand(): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    vscode.window.showErrorMessage('No active .http file');
    return;
  }

  const doc = editor.document;
  const requests = parseHttpFile(doc.getText());
  if (requests.length === 0) {
    vscode.window.showInformationMessage('No HTTP requests found in file');
    return;
  }

  const collectionName = path.basename(doc.fileName, path.extname(doc.fileName));
  const envVars = envManager.getActiveVariables();
  const opts = getExecutorOptions();
  const outputChannel = getOutputChannel();
  outputChannel.clear();

  let result: CollectionResult | undefined;

  await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: `Running collection: ${collectionName}`, cancellable: true },
    async (progress, token) => {
      result = await runCollection(
        collectionName,
        requests,
        envVars,
        opts,
        (index, total, req) => {
          progress.report({
            message: `(${index + 1}/${total}) ${req.method} ${truncate(req.url, 30)}`,
            increment: 100 / total,
          });
        },
        () => token.isCancellationRequested,
      );
    }
  );

  if (!result) return;

  const resultMap = new Map<number, boolean>();
  for (const r of result.results) {
    resultMap.set(r.request.line, r.passed);
  }
  collectionTree.setResults(doc.fileName, resultMap);

  outputChannel.show(true);
  writeCollectionSummary(outputChannel, result);

  const mdReport = generateMarkdownReport(result);
  const mdDoc = await vscode.workspace.openTextDocument({ content: mdReport, language: 'markdown' });
  await vscode.window.showTextDocument(mdDoc, vscode.ViewColumn.Beside, true);

  const jsonReport = generateJsonReport(result);
  const jsonDir = path.dirname(doc.fileName);
  const jsonFileName = `${collectionName}.report.json`;
  const jsonPath = path.join(jsonDir, jsonFileName);
  const jsonUri = vscode.Uri.file(jsonPath);
  const encoder = new TextEncoder();
  await vscode.workspace.fs.writeFile(jsonUri, encoder.encode(JSON.stringify(jsonReport, null, 2)));

  const passedAll = result.failedRequests === 0;
  if (passedAll) {
    vscode.window.showInformationMessage(
      `Collection passed: ${result.passedRequests}/${result.totalRequests} requests, ${result.passedAssertions}/${result.totalAssertions} assertions`
    );
  } else {
    vscode.window.showWarningMessage(
      `Collection failed: ${result.failedRequests} request(s) failed, ${result.failedAssertions} assertion(s) failed`
    );
  }
}

function writeCollectionSummary(channel: vscode.OutputChannel, result: CollectionResult): void {
  channel.appendLine('=== COLLECTION RUN REPORT ===');
  channel.appendLine(`Collection: ${result.name}`);
  channel.appendLine(`Timestamp: ${result.timestamp}`);
  channel.appendLine(`Duration: ${result.totalDurationMs}ms`);
  channel.appendLine(`Requests: ${result.passedRequests}/${result.totalRequests} passed`);
  channel.appendLine(`Assertions: ${result.passedAssertions}/${result.totalAssertions} passed`);
  channel.appendLine(`Result: ${result.failedRequests === 0 ? 'PASS' : 'FAIL'}`);
  channel.appendLine('');

  for (const r of result.results) {
    const icon = r.passed ? 'PASS' : 'FAIL';
    channel.appendLine(`[${icon}] ${r.request.name} — ${r.response.request.method} ${r.response.request.url}`);
    channel.appendLine(`  Status: ${r.response.status} | Duration: ${r.response.timing.durationMs}ms`);
    if (r.response.error) {
      channel.appendLine(`  Error: ${r.response.error}`);
    }
    for (const a of r.assertionResults) {
      const aIcon = a.passed ? 'PASS' : 'FAIL';
      channel.appendLine(`  [${aIcon}] ${a.message}`);
    }
    channel.appendLine('');
  }
  channel.appendLine('=== END REPORT ===');
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
