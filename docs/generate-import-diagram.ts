import * as fs from 'fs';
import * as path from 'path';
import * as ts from 'typescript';

interface FileNode {
  path: string;
  imports: string[];
  children: FileNode[];
}

const BLACKLIST = ['utils/completion', '.json', 'utils/fishProtocal.ts'];

function shouldIncludeFile(filePath: string): boolean {
  return filePath.endsWith('.ts') && !BLACKLIST.some(item => filePath.includes(item));
}

function buildFileTree(dir: string, baseDir: string): FileNode {
  const stats = fs.statSync(dir);
  const relativePath = path.relative(baseDir, dir);

  if (stats.isFile()) {
    if (!shouldIncludeFile(relativePath)) {
      return {
        path: relativePath,
        imports: [],
        children: []
      };
    }
    const sourceFile = ts.createSourceFile(
      dir,
      fs.readFileSync(dir, 'utf8'),
      ts.ScriptTarget.Latest,
      true
    );
    return {
      path: relativePath,
      imports: getImports(sourceFile),
      children: []
    };
  }

  const children = fs.readdirSync(dir)
    .map(file => buildFileTree(path.join(dir, file), baseDir));

  return {
    path: relativePath || '.',
    imports: [],
    children
  };
}

function getImports(sourceFile: ts.SourceFile): string[] {
  const imports: string[] = [];

  function visit(node: ts.Node) {
    if (ts.isImportDeclaration(node)) {
      const moduleSpecifier = node.moduleSpecifier;
      if (ts.isStringLiteral(moduleSpecifier)) {
        imports.push(moduleSpecifier.text);
      }
    }
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return imports;
}

function generateFlowchart(root: FileNode): string {
  let diagram = 'flowchart LR\n';
  const nodes = new Map<string, string>();
  const connections: string[] = [];
  const subgraphs = new Map<string, string[]>();

  function sanitizeNodeId(path: string): string {
    return path.replace(/[^a-zA-Z0-9]/g, '_');
  }

  function traverse(node: FileNode) {
    if (node.path.endsWith('.ts') && shouldIncludeFile(node.path)) {
      const nodeId = sanitizeNodeId(node.path);
      nodes.set(nodeId, node.path);
      
      const dir = path.dirname(node.path);
      if (!subgraphs.has(dir)) {
        subgraphs.set(dir, []);
      }
      subgraphs.get(dir)!.push(nodeId);

      node.imports.forEach(imp => {
        if (imp.startsWith('.')) {
          const importPath = path.join(path.dirname(node.path), imp).replace(/\.(js|ts)$/, '') + '.ts';
          if (shouldIncludeFile(importPath)) {
            const importId = sanitizeNodeId(importPath);
            connections.push(`${nodeId} --> ${importId}`);
          }
        }
      });
    }

    node.children.forEach(child => traverse(child));
  }

  traverse(root);

  // Add subgraphs
  subgraphs.forEach((nodeIds, dir) => {
    diagram += `  subgraph ${sanitizeNodeId(dir)}["${dir}"]\n`;
    nodeIds.forEach(nodeId => {
      diagram += `    ${nodeId}["${nodes.get(nodeId)}"]\n`;
    });
    diagram += `  end\n`;
  });

  // Add connections
  connections.forEach(connection => {
    diagram += `  ${connection}\n`;
  });

  return diagram;
}

// Define paths
const rootDir = path.resolve(__dirname, '..');
const srcDir = path.join(rootDir, 'src');
const outputDir = path.join(__dirname, 'import-diagram');

// Ensure output directory exists
if (!fs.existsSync(outputDir)) {
  fs.mkdirSync(outputDir, { recursive: true });
}

const root = buildFileTree(srcDir, srcDir);
const flowchart = generateFlowchart(root);

console.log('Flowchart:');
console.log(flowchart);

// Save output to file
fs.writeFileSync(path.join(outputDir, 'import-flowchart.mmd'), flowchart);

console.log('\nFlowchart generated successfully in docs/import-diagram/import-flowchart.mmd');
// import * as fs from 'fs';
// import * as path from 'path';
// import * as ts from 'typescript';
//
// interface FileNode {
//   path: string;
//   imports: string[];
//   children: FileNode[];
// }
//
// const BLACKLIST = ['utils/completion', '.json', 'src/utils/fishProtocal.ts'];
//
// function shouldIncludeFile(filePath: string): boolean {
//   return filePath.endsWith('.ts') && !BLACKLIST.some(item => filePath.includes(item));
// }
//
// function buildFileTree(dir: string, baseDir: string): FileNode {
//   const stats = fs.statSync(dir);
//   const relativePath = path.relative(baseDir, dir);
//
//   if (stats.isFile()) {
//     if (!shouldIncludeFile(relativePath)) {
//       return {
//         path: relativePath,
//         imports: [],
//         children: []
//       };
//     }
//     const sourceFile = ts.createSourceFile(
//       dir,
//       fs.readFileSync(dir, 'utf8'),
//       ts.ScriptTarget.Latest,
//       true
//     );
//     return {
//       path: relativePath,
//       imports: getImports(sourceFile),
//       children: []
//     };
//   }
//
//   const children = fs.readdirSync(dir)
//     .map(file => buildFileTree(path.join(dir, file), baseDir));
//
//   return {
//     path: relativePath || '.',
//     imports: [],
//     children
//   };
// }
//
// function getImports(sourceFile: ts.SourceFile): string[] {
//   const imports: string[] = [];
//
//   function visit(node: ts.Node) {
//     if (ts.isImportDeclaration(node)) {
//       const moduleSpecifier = node.moduleSpecifier;
//       if (ts.isStringLiteral(moduleSpecifier)) {
//         imports.push(moduleSpecifier.text);
//       }
//     }
//     ts.forEachChild(node, visit);
//   }
//
//   visit(sourceFile);
//   return imports;
// }
//
// function generateStateDiagram(root: FileNode): string {
//   let diagram = 'stateDiagram-v2\n  direction LR\n';
//   const nodes = new Set<string>();
//   const connections: string[] = [];
//
//   function traverse(node: FileNode) {
//     if (node.path.endsWith('.ts') && shouldIncludeFile(node.path)) {
//       nodes.add(node.path);
//       node.imports.forEach(imp => {
//         if (imp.startsWith('.')) {
//           const importPath = path.join(path.dirname(node.path), imp).replace(/\.(js|ts)$/, '') + '.ts';
//           if (shouldIncludeFile(importPath)) {
//             connections.push(`${node.path} --> ${importPath}`);
//           }
//         }
//       });
//     }
//
//     node.children.forEach(child => traverse(child));
//   }                                           ()
//
//
//   traverse(root);
//
//   // Add nodes
//   nodes.forEach(node => {
//     diagram += `  ${node}["${node}"]\n`;
//   });
//
//   // Add connections
//   connections.forEach(connection => {
//     diagram += `  ${connection}\n`;
//   });
//
//   return diagram;
// }
//
// // Define paths
// const rootDir = path.resolve(__dirname, '..');
// const srcDir = path.join(rootDir, 'src');
// const outputDir = path.join(__dirname, 'import-diagram');
//
// // Ensure output directory exists
// if (!fs.existsSync(outputDir)) {
//   fs.mkdirSync(outputDir, { recursive: true });
// }
//
// const root = buildFileTree(srcDir, srcDir);
// const stateDiagram = generateStateDiagram(root);
//
// console.log('State Diagram:');
// console.log(stateDiagram);
//
// // Save output to file
// fs.writeFileSync(path.join(outputDir, 'state-diagram.mmd'), stateDiagram);
//
// console.log('\nState diagram generated successfully in docs/import-diagram/state-diagram.mmd');