import * as vscode from 'vscode';
import { HttpResponse } from './executor';

export class ResponsePanel {
  private panel: vscode.WebviewPanel | undefined;

  constructor(private context: vscode.ExtensionContext) {}

  show(response: HttpResponse): void {
    if (!this.panel) {
      this.panel = vscode.window.createWebviewPanel(
        'apiWorkbench.response',
        'API Response',
        vscode.ViewColumn.Beside,
        { enableScripts: true, retainContextWhenHidden: true }
      );
      this.panel.onDidDispose(() => {
        this.panel = undefined;
      });
    }

    this.panel.title = `${response.request.method} ${response.status} — ${formatDuration(response.timing.durationMs)}`;
    this.panel.webview.html = this.buildHtml(response);
  }

  private buildHtml(response: HttpResponse): string {
    const statusClass = response.error ? 'error' :
      response.status < 300 ? 'success' :
      response.status < 400 ? 'redirect' : 'error';

    const headersHtml = Object.entries(response.headers)
      .map(([k, v]) => `<tr><td class="header-name">${escapeHtml(k)}</td><td>${escapeHtml(v)}</td></tr>`)
      .join('');

    const bodyFormatted = formatBody(response.body, response.headers['content-type'] || '');

    return `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline';">
<style>
  :root { --bg: var(--vscode-editor-background); --fg: var(--vscode-editor-foreground); --border: var(--vscode-panel-border); }
  body { font-family: var(--vscode-font-family); color: var(--fg); background: var(--bg); padding: 12px; margin: 0; }
  .status-bar { display: flex; gap: 16px; align-items: center; padding: 8px 12px; border-radius: 4px; margin-bottom: 12px; font-weight: 600; }
  .success { background: rgba(40,167,69,0.15); color: #28a745; }
  .redirect { background: rgba(255,193,7,0.15); color: #ffc107; }
  .error { background: rgba(220,53,69,0.15); color: #dc3545; }
  .meta { font-size: 0.85em; opacity: 0.8; font-weight: 400; }
  .tabs { display: flex; border-bottom: 1px solid var(--border); margin-bottom: 8px; }
  .tab { padding: 6px 16px; cursor: pointer; border-bottom: 2px solid transparent; opacity: 0.7; }
  .tab.active { border-bottom-color: var(--vscode-focusBorder); opacity: 1; }
  .tab-content { display: none; }
  .tab-content.active { display: block; }
  pre { white-space: pre-wrap; word-break: break-all; font-family: var(--vscode-editor-font-family); font-size: var(--vscode-editor-font-size); line-height: 1.5; margin: 0; padding: 8px; background: var(--vscode-textCodeBlock-background); border-radius: 4px; overflow: auto; max-height: 70vh; }
  table { width: 100%; border-collapse: collapse; }
  td { padding: 4px 8px; border-bottom: 1px solid var(--border); vertical-align: top; }
  .header-name { font-weight: 600; white-space: nowrap; width: 1%; }
  .copy-btn { cursor: pointer; padding: 4px 8px; background: var(--vscode-button-background); color: var(--vscode-button-foreground); border: none; border-radius: 3px; font-size: 0.8em; float: right; }
</style>
</head>
<body>
  <div class="status-bar ${statusClass}">
    <span>${response.error ? 'ERROR' : response.status + ' ' + escapeHtml(response.statusText)}</span>
    <span class="meta">${formatDuration(response.timing.durationMs)}</span>
    <span class="meta">${formatSize(response.size.totalBytes)}</span>
    <span class="meta">${escapeHtml(response.request.method)} ${escapeHtml(truncate(response.request.url, 60))}</span>
  </div>
  ${response.error ? `<pre>${escapeHtml(response.error)}</pre>` : `
  <div class="tabs">
    <div class="tab active" data-tab="body">Body</div>
    <div class="tab" data-tab="headers">Headers (${Object.keys(response.headers).length})</div>
    <div class="tab" data-tab="raw">Raw</div>
  </div>
  <div class="tab-content active" id="tab-body">
    <button class="copy-btn" onclick="copyBody()">Copy</button>
    <pre id="body-content">${escapeHtml(bodyFormatted)}</pre>
  </div>
  <div class="tab-content" id="tab-headers">
    <table>${headersHtml}</table>
  </div>
  <div class="tab-content" id="tab-raw">
    <pre>${escapeHtml(buildRawResponse(response))}</pre>
  </div>`}
  <script>
    document.querySelectorAll('.tab').forEach(tab => {
      tab.addEventListener('click', () => {
        document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
        document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
        tab.classList.add('active');
        document.getElementById('tab-' + tab.dataset.tab).classList.add('active');
      });
    });
    function copyBody() {
      const text = document.getElementById('body-content').textContent;
      const vscode = acquireVsCodeApi();
      navigator.clipboard.writeText(text).catch(() => {});
    }
  </script>
</body>
</html>`;
  }
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatBody(body: string, contentType: string): string {
  if (!body) return '(empty)';
  if (contentType.includes('json') || body.trimStart().startsWith('{') || body.trimStart().startsWith('[')) {
    try {
      return JSON.stringify(JSON.parse(body), null, 2);
    } catch {
      return body;
    }
  }
  return body;
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n) + '...' : s;
}

function buildRawResponse(response: HttpResponse): string {
  let raw = `HTTP/1.1 ${response.status} ${response.statusText}\n`;
  for (const [k, v] of Object.entries(response.headers)) {
    raw += `${k}: ${v}\n`;
  }
  raw += `\n${response.body}`;
  return raw;
}
