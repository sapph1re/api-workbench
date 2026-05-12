import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { parseHttpFile, ParsedRequest } from './parser';

type TreeItem = CollectionItem | RequestItem;

class CollectionItem extends vscode.TreeItem {
  constructor(
    public readonly filePath: string,
    public readonly requests: ParsedRequest[],
    private resultMap?: Map<number, boolean>
  ) {
    super(
      path.basename(filePath),
      requests.length > 0 ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.None
    );
    this.tooltip = filePath;
    this.contextValue = 'collection';
    this.command = {
      command: 'vscode.open',
      title: 'Open Collection',
      arguments: [vscode.Uri.file(filePath)],
    };

    if (resultMap && resultMap.size > 0) {
      const total = requests.length;
      const tested = [...resultMap.values()];
      const passed = tested.filter(v => v).length;
      const failed = tested.filter(v => !v).length;
      this.description = failed > 0
        ? `${passed}/${total} passed, ${failed} failed`
        : `${passed}/${total} passed`;
      this.iconPath = new vscode.ThemeIcon(
        failed > 0 ? 'error' : 'pass',
        new vscode.ThemeColor(failed > 0 ? 'testing.iconFailed' : 'testing.iconPassed')
      );
    } else {
      this.description = `${requests.length} request${requests.length !== 1 ? 's' : ''}`;
      this.iconPath = new vscode.ThemeIcon('file');
    }
  }
}

class RequestItem extends vscode.TreeItem {
  constructor(
    public readonly request: ParsedRequest,
    public readonly filePath: string,
    private result?: boolean
  ) {
    super(request.name, vscode.TreeItemCollapsibleState.None);
    this.description = request.method;
    this.tooltip = `${request.method} ${request.url}`;
    this.contextValue = 'request';
    this.command = {
      command: 'vscode.open',
      title: 'Open Request',
      arguments: [
        vscode.Uri.file(filePath),
        { selection: new vscode.Range(request.line, 0, request.line, 0) },
      ],
    };

    if (result === true) {
      this.iconPath = new vscode.ThemeIcon('pass', new vscode.ThemeColor('testing.iconPassed'));
    } else if (result === false) {
      this.iconPath = new vscode.ThemeIcon('error', new vscode.ThemeColor('testing.iconFailed'));
    } else {
      this.iconPath = new vscode.ThemeIcon(getMethodIcon(request.method));
    }
  }
}

function getMethodIcon(method: string): string {
  switch (method) {
    case 'GET': return 'arrow-down';
    case 'POST': return 'arrow-up';
    case 'PUT': return 'arrow-swap';
    case 'DELETE': return 'trash';
    case 'PATCH': return 'edit';
    default: return 'globe';
  }
}

export class CollectionTreeProvider implements vscode.TreeDataProvider<TreeItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<TreeItem | undefined>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;
  private watchers: vscode.FileSystemWatcher[] = [];
  private runResults = new Map<string, Map<number, boolean>>();

  constructor() {
    const watcher = vscode.workspace.createFileSystemWatcher('**/*.{http,rest}');
    watcher.onDidCreate(() => this.refresh());
    watcher.onDidChange(() => this.refresh());
    watcher.onDidDelete(() => this.refresh());
    this.watchers.push(watcher);
  }

  dispose(): void {
    this._onDidChangeTreeData.dispose();
    this.watchers.forEach(w => w.dispose());
  }

  refresh(): void {
    this._onDidChangeTreeData.fire(undefined);
  }

  setResults(filePath: string, results: Map<number, boolean>): void {
    this.runResults.set(filePath, results);
    this.refresh();
  }

  clearResults(filePath?: string): void {
    if (filePath) {
      this.runResults.delete(filePath);
    } else {
      this.runResults.clear();
    }
    this.refresh();
  }

  getTreeItem(element: TreeItem): vscode.TreeItem {
    return element;
  }

  async getChildren(element?: TreeItem): Promise<TreeItem[]> {
    if (element instanceof CollectionItem) {
      const resultMap = this.runResults.get(element.filePath);
      return element.requests.map(r => new RequestItem(r, element.filePath, resultMap?.get(r.line)));
    }

    const httpFiles = await vscode.workspace.findFiles('**/*.{http,rest}', '**/node_modules/**');
    const items: CollectionItem[] = [];

    for (const file of httpFiles.sort((a, b) => a.fsPath.localeCompare(b.fsPath))) {
      try {
        const content = fs.readFileSync(file.fsPath, 'utf-8');
        const requests = parseHttpFile(content);
        const resultMap = this.runResults.get(file.fsPath);
        items.push(new CollectionItem(file.fsPath, requests, resultMap));
      } catch {
        items.push(new CollectionItem(file.fsPath, []));
      }
    }

    return items;
  }
}

export class EnvironmentTreeProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<vscode.TreeItem | undefined>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  constructor(private getEnvs: () => Array<{ name: string; variables: Record<string, string> }>, private getActive: () => string | undefined) {}

  refresh(): void {
    this._onDidChangeTreeData.fire(undefined);
  }

  getTreeItem(element: vscode.TreeItem): vscode.TreeItem {
    return element;
  }

  getChildren(): vscode.TreeItem[] {
    const envs = this.getEnvs();
    const active = this.getActive();

    return envs.map(env => {
      const isActive = env.name === active;
      const item = new vscode.TreeItem(
        env.name,
        vscode.TreeItemCollapsibleState.None
      );
      item.description = isActive ? '(active)' : `${Object.keys(env.variables).length} vars`;
      item.iconPath = new vscode.ThemeIcon(isActive ? 'check' : 'symbol-variable');
      item.command = {
        command: 'apiWorkbench.selectEnvironment',
        title: 'Select Environment',
      };
      return item;
    });
  }
}
