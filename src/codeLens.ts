import * as vscode from 'vscode';
import { parseHttpFile } from './parser';

export class HttpCodeLensProvider implements vscode.CodeLensProvider {
  private _onDidChangeCodeLenses = new vscode.EventEmitter<void>();
  readonly onDidChangeCodeLenses = this._onDidChangeCodeLenses.event;

  constructor() {
    vscode.workspace.onDidChangeTextDocument(() => this._onDidChangeCodeLenses.fire());
  }

  provideCodeLenses(document: vscode.TextDocument): vscode.CodeLens[] {
    const requests = parseHttpFile(document.getText());
    return requests.map(req => {
      const range = new vscode.Range(req.line, 0, req.line, 0);
      return new vscode.CodeLens(range, {
        title: '$(play) Send Request',
        command: 'apiWorkbench.sendRequest',
        arguments: [document.uri, new vscode.Position(req.line, 0)],
      });
    });
  }
}
