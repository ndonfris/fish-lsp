import { Diagnostic, PublishDiagnosticsParams } from 'vscode-languageserver';

export class DiagnosticQueue {
  private diagnostics: Map<string, Diagnostic[]> = new Map();

  get uris(): string[] {
    return Array.from(this.diagnostics.keys());
  }

  public set(uri: string, diagnostics: Diagnostic[]): void {
    if (!this.diagnostics.has(uri)) {
      this.diagnostics.set(uri, []);
    }
    this.diagnostics.get(uri)?.push(...diagnostics);
  }

  public get(uri: string): Diagnostic[] {
    //const fishDiagnostic = this.getFishLspDiagnostics(uri);
    return this.diagnostics.get(uri) || [];
  }

  public getAll(): PublishDiagnosticsParams[] {
    return this.uris.map(uri => ({
      uri,
      diagnostics: this.get(uri),
    }));
  }

  public clear(uri: string): void {
    this.diagnostics.delete(uri);
  }

  public clearAll(): void {
    this.diagnostics.clear();
  }
}
