import { Project, SourceFile, SyntaxKind, Node } from 'ts-morph';
import * as path from 'path';
import type { FileNode, ImportEdge, SymbolNode, CallEdge, ParsedFile } from './types.js';

export class Parser {
  private project: Project;
  private rootDir: string;

  constructor(rootDir: string) {
    this.rootDir = rootDir;
    this.project = new Project({
      tsConfigFilePath: this.findTsConfig(),
      skipAddingFilesFromTsConfig: true,
    });
  }

  private findTsConfig(): string | undefined {
    const candidate = path.join(this.rootDir, 'tsconfig.json');
    try {
      require('fs').accessSync(candidate);
      return candidate;
    } catch {
      return undefined;
    }
  }

  parseDirectory(dir: string): ParsedFile[] {
    const glob = path.join(dir, '**/*.{ts,tsx,js,jsx}');
    this.project.addSourceFilesAtPaths(glob);
    const sourceFiles = this.project.getSourceFiles();
    return sourceFiles.map((sf) => this.parseSourceFile(sf));
  }

  parseFile(filePath: string): ParsedFile {
    let sourceFile = this.project.getSourceFile(filePath);
    if (sourceFile) {
      sourceFile.refreshFromFileSystemSync();
    } else {
      sourceFile = this.project.addSourceFileAtPath(filePath);
    }
    return this.parseSourceFile(sourceFile);
  }

  parseFromString(filePath: string, content: string): ParsedFile {
    const inMemoryProject = new Project({ useInMemoryFileSystem: true });
    const sourceFile = inMemoryProject.createSourceFile(filePath, content);
    return this.parseSourceFile(sourceFile, filePath);
  }

  private parseSourceFile(sourceFile: SourceFile, overridePath?: string): ParsedFile {
    const fullPath = overridePath ?? sourceFile.getFilePath();
    const relPath = path.relative(this.rootDir, fullPath);
    const ext = path.extname(relPath);
    const label = path.basename(relPath, ext);
    const dir = path.dirname(relPath);
    const loc = sourceFile.getEndLineNumber();

    const file: FileNode = {
      id: relPath,
      label,
      dir,
      loc,
      parsedAt: new Date(),
    };

    const imports = this.extractImports(sourceFile, relPath);
    const symbols = this.extractSymbols(sourceFile, relPath);
    const calls = this.extractCalls(sourceFile, relPath, symbols);

    return { file, imports, symbols, calls };
  }

  private extractImports(sourceFile: SourceFile, fileId: string): ImportEdge[] {
    const edges: ImportEdge[] = [];
    const importDecls = sourceFile.getImportDeclarations();

    for (const decl of importDecls) {
      const moduleSpecifier = decl.getModuleSpecifierValue();

      // Skip external packages (non-relative imports)
      if (!moduleSpecifier.startsWith('.') && !moduleSpecifier.startsWith('/')) {
        continue;
      }

      const namedImports = decl.getNamedImports().map((ni) => ni.getName());
      const defaultImport = decl.getDefaultImport();
      if (defaultImport) {
        namedImports.unshift(defaultImport.getText());
      }

      // Resolve the import path relative to the root
      const sourceDir = path.dirname(path.join(this.rootDir, fileId));
      let resolvedPath = path.resolve(sourceDir, moduleSpecifier);
      let targetId = path.relative(this.rootDir, resolvedPath);

      // Try to resolve the actual file extension
      targetId = this.resolveImportPath(targetId);

      edges.push({
        from: fileId,
        to: targetId,
        namedImports,
        line: decl.getStartLineNumber(),
      });
    }

    return edges;
  }

  private resolveImportPath(targetId: string): string {
    const extensions = ['.ts', '.tsx', '.js', '.jsx'];
    const fs = require('fs');

    // If already has extension, return as-is
    if (extensions.some((ext) => targetId.endsWith(ext))) {
      return targetId;
    }

    const basePath = path.join(this.rootDir, targetId);

    // Try direct file with extensions
    for (const ext of extensions) {
      try {
        fs.accessSync(basePath + ext);
        return targetId + ext;
      } catch {}
    }

    // Try index files
    for (const ext of extensions) {
      try {
        fs.accessSync(path.join(basePath, `index${ext}`));
        return path.join(targetId, `index${ext}`);
      } catch {}
    }

    return targetId;
  }

  private extractSymbols(sourceFile: SourceFile, fileId: string): SymbolNode[] {
    const symbols: SymbolNode[] = [];

    // Functions
    for (const fn of sourceFile.getFunctions()) {
      const name = fn.getName();
      if (name) {
        symbols.push({
          id: `${fileId}::${name}`,
          name,
          kind: 'function',
          fileId,
        });
      }
    }

    // Classes
    for (const cls of sourceFile.getClasses()) {
      const name = cls.getName();
      if (name) {
        symbols.push({
          id: `${fileId}::${name}`,
          name,
          kind: 'class',
          fileId,
        });

        // Methods
        for (const method of cls.getMethods()) {
          const methodName = method.getName();
          symbols.push({
            id: `${fileId}::${name}.${methodName}`,
            name: `${name}.${methodName}`,
            kind: 'method',
            fileId,
          });
        }
      }
    }

    // Arrow functions assigned to variables
    for (const varDecl of sourceFile.getVariableDeclarations()) {
      const init = varDecl.getInitializer();
      if (init && Node.isArrowFunction(init)) {
        const name = varDecl.getName();
        symbols.push({
          id: `${fileId}::${name}`,
          name,
          kind: 'arrow',
          fileId,
        });
      }
    }

    return symbols;
  }

  private extractCalls(
    sourceFile: SourceFile,
    fileId: string,
    symbols: SymbolNode[]
  ): CallEdge[] {
    const calls: CallEdge[] = [];
    const symbolNames = new Set(symbols.map((s) => s.name));

    // Find all call expressions within functions/methods/arrows
    for (const symbol of symbols) {
      const node = this.findSymbolNode(sourceFile, symbol);
      if (!node) continue;

      const callExprs = node.getDescendantsOfKind(SyntaxKind.CallExpression);
      for (const call of callExprs) {
        const expr = call.getExpression();
        const calledName = expr.getText();

        // Only track calls to symbols defined in the same file
        if (symbolNames.has(calledName)) {
          calls.push({
            from: symbol.id,
            to: `${fileId}::${calledName}`,
            line: call.getStartLineNumber(),
          });
        }
      }
    }

    return calls;
  }

  private findSymbolNode(sourceFile: SourceFile, symbol: SymbolNode): Node | undefined {
    if (symbol.kind === 'function') {
      return sourceFile.getFunction(symbol.name);
    }
    if (symbol.kind === 'class') {
      return sourceFile.getClass(symbol.name);
    }
    if (symbol.kind === 'method') {
      const [className, methodName] = symbol.name.split('.');
      const cls = sourceFile.getClass(className);
      return cls?.getMethod(methodName);
    }
    if (symbol.kind === 'arrow') {
      return sourceFile.getVariableDeclaration(symbol.name);
    }
    return undefined;
  }
}
