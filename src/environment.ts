import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';

export interface Environment {
  name: string;
  filePath: string;
  variables: Record<string, string>;
}

export class EnvironmentManager {
  private currentEnv: string | undefined;
  private environments: Map<string, Environment> = new Map();
  private _onDidChange = new vscode.EventEmitter<void>();
  readonly onDidChange = this._onDidChange.event;
  private watchers: vscode.FileSystemWatcher[] = [];

  constructor() {
    this.scanEnvironments();
    const watcher = vscode.workspace.createFileSystemWatcher('**/.env*');
    watcher.onDidCreate(() => this.scanEnvironments());
    watcher.onDidChange(() => this.scanEnvironments());
    watcher.onDidDelete(() => this.scanEnvironments());
    this.watchers.push(watcher);
  }

  dispose(): void {
    this._onDidChange.dispose();
    this.watchers.forEach(w => w.dispose());
  }

  getActiveVariables(): Record<string, string> {
    if (!this.currentEnv) return {};
    const env = this.environments.get(this.currentEnv);
    return env ? { ...env.variables } : {};
  }

  getCurrentName(): string | undefined {
    return this.currentEnv;
  }

  getEnvironments(): Environment[] {
    return Array.from(this.environments.values());
  }

  setActive(name: string): void {
    if (this.environments.has(name)) {
      this.currentEnv = name;
      this._onDidChange.fire();
    }
  }

  async selectEnvironment(): Promise<void> {
    const envs = this.getEnvironments();
    if (envs.length === 0) {
      vscode.window.showInformationMessage('No .env files found in workspace. Create a .env file to define variables.');
      return;
    }

    const items = envs.map(e => ({
      label: e.name,
      description: e.filePath,
      picked: e.name === this.currentEnv,
    }));

    items.unshift({ label: '(none)', description: 'No environment', picked: !this.currentEnv });

    const picked = await vscode.window.showQuickPick(items, {
      placeHolder: 'Select environment',
    });

    if (picked) {
      if (picked.label === '(none)') {
        this.currentEnv = undefined;
      } else {
        this.currentEnv = picked.label;
      }
      this._onDidChange.fire();
    }
  }

  private scanEnvironments(): void {
    this.environments.clear();
    const folders = vscode.workspace.workspaceFolders;
    if (!folders) return;

    for (const folder of folders) {
      this.scanFolder(folder.uri.fsPath);
    }
    this._onDidChange.fire();
  }

  private scanFolder(folderPath: string): void {
    try {
      const entries = fs.readdirSync(folderPath);
      for (const entry of entries) {
        if (entry.startsWith('.env')) {
          const filePath = path.join(folderPath, entry);
          if (!fs.statSync(filePath).isFile()) continue;
          const name = entry === '.env' ? 'default' : entry.replace(/^\.env\.?/, '');
          const variables = this.parseEnvFile(filePath);
          this.environments.set(name, { name, filePath, variables });
        }
      }
    } catch {
      // folder not readable
    }
  }

  private parseEnvFile(filePath: string): Record<string, string> {
    const vars: Record<string, string> = {};
    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      for (const line of content.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (trimmed === '' || trimmed.startsWith('#')) continue;
        const match = trimmed.match(/^([^=]+?)\s*=\s*(.*)$/);
        if (match) {
          let value = match[2].trim();
          if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
            value = value.slice(1, -1);
          }
          vars[match[1].trim()] = value;
        }
      }
    } catch {
      // file not readable
    }
    return vars;
  }
}
