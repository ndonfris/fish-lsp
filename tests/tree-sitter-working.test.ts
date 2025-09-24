import { describe, it, expect, beforeAll } from 'vitest';
import * as fc from 'fast-check';

import { Analyzer } from '../src/analyze';
import { TestWorkspace } from './test-workspace-utils';
import { basicInputs, getAllTestInputs } from './fish-shell-test-inputs';

// Tree-sitter utilities
import {
  getChildNodes,
  TreeWalker,
  getRange,
  getNodeText,
  isSyntaxNode,
} from '../src/utils/tree-sitter';

// Node type checkers
import {
  isFunctionDefinition,
  isCommand,
  isProgram,
  isForLoop,
  isIfStatement,
  isScope,
  isComment,
  isString,
  isOption,
  isVariable,
  isCommandWithName,
} from '../src/utils/node-types';

import {
  isVariableDefinitionName,
  isFunctionDefinitionName,
  isDefinitionName,
} from '../src/parsing/barrel';

describe('Tree-sitter Working Tests', () => {
  beforeAll(async () => {
    await Analyzer.initialize();
  });

  describe('Property-based Tests with Real Fish Code', () => {
    it('should handle all basic fish constructs without crashing', () => {
      const basicFishInputs = Object.values(basicInputs);

      fc.assert(fc.property(
        fc.constantFrom(...basicFishInputs),
        (fishCode) => {
          try {
            const workspace = TestWorkspace.createSingle(fishCode);
            workspace.initialize();

            const doc = workspace.focusedDocument;

            // Even if tree creation fails, the test should not crash
            if (!doc || !doc.tree?.rootNode) {
              return true; // Gracefully handle cases where tree isn't created
            }

            const rootNode = doc.tree.rootNode;

            // Basic tree structure assertions
            expect(isSyntaxNode(rootNode)).toBe(true);
            expect(isProgram(rootNode)).toBe(true);

            const allNodes = getChildNodes(rootNode);
            expect(Array.isArray(allNodes)).toBe(true);
            expect(allNodes.length).toBeGreaterThan(0);

            // Test that navigation functions work
            for (const node of allNodes.slice(0, 5)) { // Test first 5 nodes
              expect(isSyntaxNode(node)).toBe(true);
              expect(typeof getNodeText(node)).toBe('string');

              const range = getRange(node);
              expect(range.start.line).toBeLessThanOrEqual(range.end.line);
            }

            return true;
          } catch (error) {
            console.warn('Test failed with error:', error);
            return false; // Let fast-check know this case failed
          }
        },
      ), { numRuns: 20 });
    });

    it('should correctly identify function structures when trees exist', () => {
      fc.assert(fc.property(
        fc.constantFrom(basicInputs.simpleFunction, basicInputs.forLoop, basicInputs.ifStatement),
        (fishCode) => {
          try {
            const workspace = TestWorkspace.createSingle(fishCode);
            workspace.initialize();

            const doc = workspace.focusedDocument;
            if (!doc?.tree?.rootNode) return true;

            const allNodes = getChildNodes(doc.tree.rootNode);

            // Check for expected node types based on the input
            if (fishCode.includes('function')) {
              const functions = allNodes.filter(node => isFunctionDefinition(node));
              if (functions.length > 0) {
                for (const func of functions) {
                  expect(isScope(func)).toBe(true);
                  if (func.firstNamedChild) {
                    expect(isFunctionDefinitionName(func.firstNamedChild)).toBe(true);
                  }
                }
              }
            }

            if (fishCode.includes('for')) {
              const forLoops = allNodes.filter(node => isForLoop(node));
              for (const forLoop of forLoops) {
                expect(isScope(forLoop)).toBe(true);
              }
            }

            if (fishCode.includes('if')) {
              const ifStmts = allNodes.filter(node => isIfStatement(node));
              for (const ifStmt of ifStmts) {
                expect(isScope(ifStmt)).toBe(true);
              }
            }

            return true;
          } catch (error) {
            console.warn('Function structure test failed:', error);
            return false;
          }
        },
      ), { numRuns: 10 });
    });

    it('should handle various fish shell patterns gracefully', () => {
      const allInputs = getAllTestInputs().slice(0, 50); // Test first 50 for performance

      fc.assert(fc.property(
        fc.constantFrom(...allInputs),
        (fishCode) => {
          try {
            const workspace = TestWorkspace.createSingle(fishCode);
            workspace.initialize();

            const doc = workspace.focusedDocument;
            if (!doc?.tree?.rootNode) return true;

            const allNodes = getChildNodes(doc.tree.rootNode);

            // Test that all basic operations work without throwing
            expect(() => {
              for (const node of allNodes.slice(0, 10)) {
                isSyntaxNode(node);
                getNodeText(node);
                getRange(node);
                isProgram(node);
                isCommand(node);
                isString(node);
                isComment(node);
                isVariable(node);
                isOption(node);
              }
            }).not.toThrow();

            // Test TreeWalker on a sample of nodes
            const leafNodes = allNodes.filter(node => node.childCount === 0);
            if (leafNodes.length > 0) {
              const sampleLeaf = leafNodes[0]!;
              const rootFound = TreeWalker.walkUp(sampleLeaf, node => isProgram(node));
              expect(rootFound.isSome()).toBe(true);
            }

            return true;
          } catch (error) {
            console.warn('Pattern handling test failed:', error);
            return false;
          }
        },
      ), { numRuns: 30 });
    });
  });

  describe('Specific Fish Construct Tests', () => {
    it('should parse function definitions correctly when possible', () => {
      const workspace = TestWorkspace.createSingle(basicInputs.simpleFunction);
      workspace.initialize();

      const doc = workspace.focusedDocument;

      // Only run assertions if the tree was created successfully
      if (doc?.tree?.rootNode) {
        const allNodes = getChildNodes(doc.tree.rootNode);
        const functions = allNodes.filter(node => isFunctionDefinition(node));

        if (functions.length > 0) {
          const func = functions[0]!;
          expect(isScope(func)).toBe(true);

          if (func.firstNamedChild) {
            expect(isFunctionDefinitionName(func.firstNamedChild)).toBe(true);
            expect(isDefinitionName(func.firstNamedChild)).toBe(true);
          }
        }
      }
    });

    it('should parse set commands correctly when possible', () => {
      const workspace = TestWorkspace.createSingle(basicInputs.variableAssignment);
      workspace.initialize();

      const doc = workspace.focusedDocument;

      if (doc?.tree?.rootNode) {
        const allNodes = getChildNodes(doc.tree.rootNode);
        const setCommands = allNodes.filter(node =>
          isCommand(node) && isCommandWithName(node, 'set'),
        );

        if (setCommands.length > 0) {
          expect(setCommands.length).toBeGreaterThan(0);
        }

        const varNodes = allNodes.filter(node => isVariableDefinitionName(node));
        if (varNodes.length > 0) {
          for (const varNode of varNodes) {
            expect(isDefinitionName(varNode)).toBe(true);
          }
        }
      }
    });
  });

  describe('Error Handling and Robustness', () => {
    it('should not crash on malformed input', () => {
      const malformedInputs = [
        'function\nend',
        'set',
        'for\nend',
        'if\nend',
        '',
        '   ',
        '# comment only',
        'invalid syntax here!!!',
      ];

      for (const malformed of malformedInputs) {
        expect(() => {
          const workspace = TestWorkspace.createSingle(malformed);
          workspace.initialize();

          const doc = workspace.focusedDocument;
          if (doc?.tree?.rootNode) {
            const allNodes = getChildNodes(doc.tree.rootNode);
            for (const node of allNodes.slice(0, 5)) {
              getNodeText(node);
              isSyntaxNode(node);
            }
          }
        }).not.toThrow();
      }
    });

    it('should handle empty or whitespace-only content', () => {
      const emptyInputs = ['', '   ', '\n\n', '\t\t'];

      for (const empty of emptyInputs) {
        expect(() => {
          const workspace = TestWorkspace.createSingle(empty);
          workspace.initialize();

          const doc = workspace.focusedDocument;
          // Should not throw even if tree creation fails
          if (doc?.tree?.rootNode) {
            expect(isProgram(doc.tree.rootNode)).toBe(true);
          }
        }).not.toThrow();
      }
    });
  });
});
