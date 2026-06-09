import * as fc from 'fast-check';
import { Analyzer } from '../src/analyze';
import { createFakeLspDocument } from './helpers';
import {
  getChildNodes,
  getNamedChildNodes,
  findChildNodes,
  collectNodesByTypes,
  getParentNodes,
  getParentNodesGen,
  nodesGen,
  namedNodesGen,
  findFirstParent,
  getLeafNodes,
  getLastLeafNode,
  getNamedNeighbors,
  getSiblingNodes,
  findFirstNamedSibling,
  findFirstSibling,
  findEnclosingScope,
  firstAncestorMatch,
  ancestorMatch,
  descendantMatch,
  getNodesTextAsSingleLine,
  getPrecedingComments,
  getRangeWithPrecedingComments,
  findNodeAt,
  rangeToPoint,
  isSyntaxNode,
  isFishExtension,
  isPositionAfter,
  hasNode,
  containsNode,
  getRange,
  positionToPoint,
  pointToPosition,
  isNodeWithinRange,
  equalRanges,
  containsRange,
  precedesRange,
  getNodeAtPosition,
  getNodeAtRange,
  getNodeAt,
  isPositionInNode,
  isPositionWithinRange,
  isNodeWithinOtherNode,
  TreeWalker,
} from '../src/utils/tree-sitter';
import { isProgram } from '../src/utils/node-types';

/**
 * tree-sitter fast-check — v2 (rebuilt incrementally)
 *
 * The original `tree-sitter-fast-check.test.ts` was structurally broken:
 *   - it called `TestWorkspace.createSingle(...).initialize()` INSIDE each
 *     property, but `initialize()` only registers describe-level hooks, so at
 *     runtime the document was never loaded → `doc.tree` was undefined → every
 *     property silently `return true`'d (tested nothing).
 *
 * This file rebuilds the same ideas with a setup that actually works:
 *   - one real `Analyzer` created once in `beforeAll`
 *   - each property builds a document synchronously with `createFakeLspDocument`
 *     and parses it via `analyzer.analyze(doc).ensureParsed().root`
 *
 * It is built up STEP BY STEP so each piece can be verified before the next.
 */
describe('tree-sitter fast-check v2', () => {
  let analyzer: Analyzer;

  beforeAll(async () => {
    analyzer = await Analyzer.initialize();
  });

  // Helper: turn a generated fish-source string into its parsed root SyntaxNode.
  // (`LspDocument` has no `.tree`; the analyzer owns parsing.)
  const parse = (code: string) =>
    analyzer.analyze(createFakeLspDocument('functions/fast_check.fish', code)).ensureParsed().root;

  // Some helpers (the `getNodeAt*` family) need the parsed `Tree`, not just the
  // root node, so this variant returns both.
  const parseFull = (code: string) => {
    const a = analyzer.analyze(createFakeLspDocument('functions/fast_check.fish', code)).ensureParsed();
    return { root: a.root, tree: a.tree };
  };

  // ── Reusable generators (built up from Step 4's composition ideas) ─────────
  // A fish identifier and a simple safe value.
  const identifier = fc.stringMatching(/^[a-zA-Z_][a-zA-Z0-9_]*$/);
  const word = fc.stringMatching(/^[a-zA-Z0-9]+$/);

  // `fc.oneof(...)` randomly picks ONE of several arbitraries — here, several
  // shapes of valid fish statement. Each branch `.map`s its raw pieces into a
  // statement string.
  const statement = fc.oneof(
    fc.tuple(identifier, word).map(([n, v]) => `set -l ${n} ${v}`),
    word.map((w) => `echo ${w}`),
    fc.tuple(identifier, word).map(([n, v]) => `function ${n}; echo ${v}; end`),
    identifier.map((v) => `for ${v} in 1 2 3; echo $${v}; end`),
    word.map((w) => `if test -n "${w}"; echo yes; end`),
  );

  // `fc.array(arb, {minLength,maxLength})` makes a random-length list of
  // statements; `.map(join)` glues them into one multi-line program. This is
  // the v2 equivalent of the original's `fishProgram` generator.
  const fishProgram = fc
    .array(statement, { minLength: 1, maxLength: 8 })
    .map((statements) => statements.join('\n'));

  // ──────────────────────────────────────────────────────────────────────────
  // STEP 1 — Just OBSERVE what fast-check generates. No assertions yet.
  //
  // `fc.constantFrom(...)` is the simplest arbitrary: it randomly picks one of
  // the listed values. The property logs each pick and returns `true`, so the
  // test always passes — we only want to see the generated inputs in the output.
  // ──────────────────────────────────────────────────────────────────────────
  it('STEP 1: observe generated fish snippets', () => {
    const fishStatement = fc.constantFrom(
      'echo hello',
      'set -l x 1',
      'function foo; echo hi; end',
      'for i in 1 2 3; echo $i; end',
    );

    fc.assert(
      fc.property(fishStatement, (code) => {
        console.log('STEP1 generated:', JSON.stringify(code));
        return true; // always passes — observation only
      }),
      { numRuns: 5 },
    );
  });

  // ──────────────────────────────────────────────────────────────────────────
  // STEP 2 — Parse a generated snippet and OBSERVE the resulting tree.
  // Still no hard assertions; we just confirm parsing works and log the shape.
  // ──────────────────────────────────────────────────────────────────────────
  it('STEP 2: parse a snippet and observe the tree', () => {
    const fishStatement = fc.constantFrom(
      'echo hello',
      'set -l x 1',
      'function foo; echo hi; end',
    );

    fc.assert(
      fc.property(fishStatement, (code) => {
        const root = parse(code);
        const nodeCount = getChildNodes(root).length;

        console.log('STEP2', JSON.stringify(code), '-> rootType:', root.type, 'nodeCount:', nodeCount);
        return true;
      }),
      { numRuns: 3 },
    );
  });

  // ──────────────────────────────────────────────────────────────────────────
  // STEP 3 — First REAL property/invariant.
  // Invariant: parsing ANY of these snippets yields a `program` root node, and
  // the flattened tree always contains at least that root.
  // ──────────────────────────────────────────────────────────────────────────
  it('STEP 3: root is always a program node', () => {
    const fishStatement = fc.constantFrom(
      'echo hello',
      'set -l x 1',
      'function foo; echo hi; end',
      'for i in 1 2 3; echo $i; end',
      'if true; echo yes; end',
    );

    fc.assert(
      fc.property(fishStatement, (code) => {
        const root = parse(code);
        // A property "asserts" by either returning a boolean or throwing.
        // Returning false (or a failing expect) tells fast-check this input failed.
        expect(isProgram(root)).toBe(true);
        expect(getChildNodes(root).length).toBeGreaterThan(0);
      }),
      { numRuns: 20 },
    );
  });

  // ──────────────────────────────────────────────────────────────────────────
  // STEP 4 — COMPOSING generators (the real power of fast-check).
  //
  // Instead of a fixed list, we BUILD random-but-valid fish code from smaller
  // arbitraries. This is what the original's `fishCodeGenerators` object did.
  //
  //   fc.constantFrom(...)              pick one of N literals
  //   fc.stringMatching(/regex/)        a string matching a pattern
  //   arbitrary.map(fn)                 transform a generated value
  //   fc.tuple(a, b).map(...)           combine several arbitraries into one value
  //
  // Here: a valid identifier + a value → a `set -l <name> <value>` command.
  // ──────────────────────────────────────────────────────────────────────────
  it('STEP 4: compose a generator for `set` commands and observe', () => {
    // A fish variable name: a letter/underscore followed by word chars.
    const identifier = fc.stringMatching(/^[a-zA-Z_][a-zA-Z0-9_]*$/);
    // A simple value: a non-empty run of safe chars (no quotes/spaces/specials).
    const simpleValue = fc.stringMatching(/^[a-zA-Z0-9]+$/);

    // Combine name + value into one `set -l name value` string.
    const setCommand = fc
      .tuple(identifier, simpleValue)
      .map(([name, value]) => `set -l ${name} ${value}`);

    fc.assert(
      fc.property(setCommand, (code) => {
        console.log('STEP4 generated:', JSON.stringify(code));
        return true;
      }),
      { numRuns: 8 },
    );
  });

  // ──────────────────────────────────────────────────────────────────────────
  // STEP 5 — Assert a real invariant against the composed generator.
  // Invariant: every generated `set` command parses without producing an
  // ERROR node (i.e. it's syntactically valid fish). This is the kind of
  // property that catches generator bugs AND parser/edge-case bugs.
  // ──────────────────────────────────────────────────────────────────────────
  it('STEP 5: composed `set` commands parse without ERROR nodes', () => {
    const identifier = fc.stringMatching(/^[a-zA-Z_][a-zA-Z0-9_]*$/);
    const simpleValue = fc.stringMatching(/^[a-zA-Z0-9]+$/);
    const setCommand = fc
      .tuple(identifier, simpleValue)
      .map(([name, value]) => `set -l ${name} ${value}`);

    fc.assert(
      fc.property(setCommand, (code) => {
        const root = parse(code);
        const hasError = getChildNodes(root).some((n) => n.isError || n.type === 'ERROR');
        // If this ever fails, fast-check prints the SHRUNK minimal `code` that
        // produced an ERROR node — that's how it pinpoints the edge case.
        expect(hasError).toBe(false);
      }),
      { numRuns: 50 },
    );
  });

  // ──────────────────────────────────────────────────────────────────────────
  // STEP 6 — Port the original "Node Navigation Properties" category, now over
  // the composed `fishProgram` generator.
  //
  // CRASH-SAFE RULE (the fix for the original file's worker crash): only ever
  // pass PRIMITIVES/booleans to `expect`. Never `expect(syntaxNode)...` — a
  // SyntaxNode has circular parent/child refs, and on failure vitest tries to
  // serialize the received value across its worker IPC and blows the stack.
  // Use `.equals(...)`, `.exists()`, `.length`, `.type`, etc. so a failure
  // reports the shrunk SOURCE STRING instead.
  // ──────────────────────────────────────────────────────────────────────────
  describe('STEP 6: Node Navigation Properties', () => {
    it('tree structure invariants (parent/child consistency)', () => {
      fc.assert(
        fc.property(fishProgram, (code) => {
          const root = parse(code);
          expect(isProgram(root)).toBe(true);

          const allNodes = getChildNodes(root);
          for (const node of allNodes) {
            if (node.equals(root)) continue;
            // every non-root node has a parent...
            expect(node.parent !== null).toBe(true);
            // ...and that parent lists it as a child (assert on a boolean!)
            const parentListsChild = !!node.parent?.children.some((c) => c.equals(node));
            expect(parentListsChild).toBe(true);
          }
        }),
        { numRuns: 40 },
      );
    });

    it('getParentNodes(node)[0] is the node itself', () => {
      fc.assert(
        fc.property(fishProgram, (code) => {
          const allNodes = getChildNodes(parse(code));
          for (const node of allNodes) {
            const parents = getParentNodes(node);
            expect(parents[0]?.equals(node)).toBe(true);
          }
        }),
        { numRuns: 40 },
      );
    });

    it('TreeWalker: walkUp reaches the program root from any node', () => {
      fc.assert(
        fc.property(fishProgram, (code) => {
          const root = parse(code);
          const allNodes = getChildNodes(root);
          for (const node of allNodes) {
            // The root has no ancestors, and `walkUp` excludes the start node
            // itself (it begins at `node.parent`), so only non-root nodes can
            // reach a `program` ancestor. (fast-check caught this spec gap by
            // shrinking to a single `for` loop whose failing node was the root.)
            if (node.equals(root)) continue;
            // walkUp returns a Maybe<SyntaxNode>; `.exists()` is a boolean.
            const reachedProgram = TreeWalker.walkUp(node, (n) => isProgram(n));
            expect(reachedProgram.exists()).toBe(true);
          }
        }),
        { numRuns: 30 },
      );
    });

    it('range/position round-trip and ordering', () => {
      fc.assert(
        fc.property(fishProgram, (code) => {
          const allNodes = getChildNodes(parse(code));
          for (const node of allNodes) {
            const range = getRange(node);
            // start never after end
            expect(range.start.line).toBeLessThanOrEqual(range.end.line);
            if (range.start.line === range.end.line) {
              expect(range.start.character).toBeLessThanOrEqual(range.end.character);
            }
            // Position -> Point -> Position is lossless (plain objects, safe to compare)
            expect(pointToPosition(positionToPoint(range.start))).toEqual(range.start);
            expect(pointToPosition(positionToPoint(range.end))).toEqual(range.end);
            // a node is within its own range
            expect(isNodeWithinRange(node, range)).toBe(true);
          }
        }),
        { numRuns: 30 },
      );
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // STEP 7 — Traversal & collection helpers in src/utils/tree-sitter.ts.
  //
  // The theme here is "two ways of doing the same thing must agree" — a very
  // effective property style: it pins down behavior without hard-coding exact
  // node counts (which depend on the random input). All assertions stay on
  // primitives (lengths, booleans, `.equals`) per the crash-safe rule.
  // ──────────────────────────────────────────────────────────────────────────
  describe('STEP 7: traversal & collection helpers', () => {
    it('getNamedChildNodes ⊆ getChildNodes, and all are named', () => {
      fc.assert(
        fc.property(fishProgram, (code) => {
          const root = parse(code);
          const all = getChildNodes(root);
          const named = getNamedChildNodes(root);
          expect(named.length).toBeLessThanOrEqual(all.length);
          expect(named.every((n) => n.isNamed)).toBe(true);
          expect(named.every((n) => hasNode(all, n))).toBe(true);
        }),
        { numRuns: 30 },
      );
    });

    it('findChildNodes: `() => true` equals getChildNodes; `isProgram` equals [root]', () => {
      fc.assert(
        fc.property(fishProgram, (code) => {
          const root = parse(code);
          expect(findChildNodes(root, () => true).length).toBe(getChildNodes(root).length);
          const programs = findChildNodes(root, isProgram);
          expect(programs.length).toBe(1);
          expect(programs[0]?.equals(root)).toBe(true);
        }),
        { numRuns: 30 },
      );
    });

    it('generators agree with their array counterparts (nodesGen / namedNodesGen)', () => {
      fc.assert(
        fc.property(fishProgram, (code) => {
          const root = parse(code);
          expect([...nodesGen(root)].length).toBe(getChildNodes(root).length);
          expect([...namedNodesGen(root)].length).toBe(getNamedChildNodes(root).length);
        }),
        { numRuns: 30 },
      );
    });

    it('getParentNodesGen(node, includeSelf) matches getParentNodes(node)', () => {
      fc.assert(
        fc.property(fishProgram, (code) => {
          for (const node of getChildNodes(parse(code))) {
            const viaArray = getParentNodes(node);
            const viaGen = [...getParentNodesGen(node, true)];
            expect(viaGen.length).toBe(viaArray.length);
            expect(viaGen.every((n, i) => n.equals(viaArray[i]!))).toBe(true);
          }
        }),
        { numRuns: 25 },
      );
    });

    it('findFirstParent(node, isProgram) is the root for every non-root node', () => {
      fc.assert(
        fc.property(fishProgram, (code) => {
          const root = parse(code);
          for (const node of getChildNodes(root)) {
            if (node.equals(root)) continue;
            expect(findFirstParent(node, isProgram)?.equals(root)).toBe(true);
          }
        }),
        { numRuns: 25 },
      );
    });

    it('collectNodesByTypes returns only nodes of the requested types', () => {
      fc.assert(
        fc.property(fishProgram, (code) => {
          const types = ['program', 'command', 'function_definition', 'word', 'for_statement'];
          const collected = collectNodesByTypes(parse(code), types);
          expect(collected.every((n) => types.includes(n.type))).toBe(true);
        }),
        { numRuns: 25 },
      );
    });

    it('getLeafNodes are childless & non-empty; getLastLeafNode is the last of them', () => {
      fc.assert(
        fc.property(fishProgram, (code) => {
          const root = parse(code);
          const leaves = getLeafNodes(root);
          expect(leaves.every((n) => n.childCount === 0 && n.text !== '')).toBe(true);
          if (leaves.length > 0) {
            expect(getLastLeafNode(root).equals(leaves[leaves.length - 1]!)).toBe(true);
          }
        }),
        { numRuns: 25 },
      );
    });

    it('containsNode: root contains every node; getNamedNeighbors includes a named node', () => {
      fc.assert(
        fc.property(fishProgram, (code) => {
          const root = parse(code);
          for (const node of getChildNodes(root)) {
            expect(containsNode(root, node)).toBe(true);
            if (node.isNamed && node.parent) {
              expect(getNamedNeighbors(node).some((n) => n.equals(node))).toBe(true);
            }
          }
        }),
        { numRuns: 25 },
      );
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // STEP 8 — Range / position helpers and the `getNodeAt*` lookup family.
  //
  // These are the functions most likely to regress silently (off-by-one in a
  // range, a point/position swap), so they're worth pinning down. The lookup
  // family needs the parsed `Tree` (via `parseFull`).
  // ──────────────────────────────────────────────────────────────────────────
  describe('STEP 8: range / position helpers', () => {
    it('equalRanges is reflexive and getRange is deterministic', () => {
      fc.assert(
        fc.property(fishProgram, (code) => {
          for (const node of getChildNodes(parse(code))) {
            expect(equalRanges(getRange(node), getRange(node))).toBe(true);
          }
        }),
        { numRuns: 25 },
      );
    });

    it('containsRange: the root range contains every node range', () => {
      fc.assert(
        fc.property(fishProgram, (code) => {
          const root = parse(code);
          const rootRange = getRange(root);
          for (const node of getChildNodes(root)) {
            expect(containsRange(rootRange, getRange(node))).toBe(true);
          }
        }),
        { numRuns: 25 },
      );
    });

    it('a node contains its own start position (isPositionInNode / isPositionWithinRange)', () => {
      fc.assert(
        fc.property(fishProgram, (code) => {
          for (const node of getChildNodes(parse(code))) {
            const range = getRange(node);
            expect(isPositionInNode(range.start, node)).toBe(true);
            expect(isPositionWithinRange(range.start, range)).toBe(true);
            // a node is trivially within itself
            expect(isNodeWithinOtherNode(node, node)).toBe(true);
          }
        }),
        { numRuns: 25 },
      );
    });

    it('precedesRange: document-order leaves never start before an earlier leaf', () => {
      fc.assert(
        fc.property(fishProgram, (code) => {
          const leaves = getLeafNodes(parse(code));
          for (let i = 0; i + 1 < leaves.length; i++) {
            const earlier = getRange(leaves[i]!);
            const later = getRange(leaves[i + 1]!);
            // the later leaf must not precede the earlier one
            expect(precedesRange(later, earlier)).toBe(false);
          }
        }),
        { numRuns: 25 },
      );
    });

    it('getNodeAtRange(root, getRange(node)) returns a node spanning that range', () => {
      fc.assert(
        fc.property(fishProgram, (code) => {
          const root = parse(code);
          for (const node of getChildNodes(root)) {
            const found = getNodeAtRange(root, getRange(node));
            expect(found !== null).toBe(true);
            // the located node's range must contain the queried node's range
            expect(containsRange(getRange(found!), getRange(node))).toBe(true);
          }
        }),
        { numRuns: 25 },
      );
    });

    it('getNodeAtPosition / getNodeAt locate a node covering a node start position', () => {
      fc.assert(
        fc.property(fishProgram, (code) => {
          const { root, tree } = parseFull(code);
          for (const node of getChildNodes(root)) {
            const pos = getRange(node).start;
            const viaPosition = getNodeAtPosition(tree, pos);
            const viaLineCol = getNodeAt(tree, pos.line, pos.character);
            expect(viaPosition !== null).toBe(true);
            expect(viaLineCol !== null).toBe(true);
            // the located node actually covers the queried position
            expect(isPositionInNode(pos, viaPosition!)).toBe(true);
          }
        }),
        { numRuns: 25 },
      );
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // STEP 9 — Siblings, ancestor matchers, and scope resolution.
  //
  // Note `findEnclosingScope` is exercised on EVERY node and only asserted to
  // return a valid node — this is deliberately a "does it ever throw on weird
  // input?" guard (catches the null-deref class of bug on unexpected node types).
  // ──────────────────────────────────────────────────────────────────────────
  describe('STEP 9: siblings, ancestors & scope', () => {
    it('getSiblingNodes returns true siblings, excluding the node itself', () => {
      fc.assert(
        fc.property(fishProgram, (code) => {
          for (const node of getChildNodes(parse(code))) {
            if (!node.parent) continue;
            const before = getSiblingNodes(node, () => true, 'before');
            const after = getSiblingNodes(node, () => true, 'after');
            for (const s of [...before, ...after]) {
              expect(s.parent?.equals(node.parent)).toBe(true); // same parent
              expect(s.equals(node)).toBe(false); // never the node itself
            }
          }
        }),
        { numRuns: 25 },
      );
    });

    it('findFirstNamedSibling is the first of getSiblingNodes (same direction)', () => {
      fc.assert(
        fc.property(fishProgram, (code) => {
          for (const node of getChildNodes(parse(code))) {
            for (const dir of ['before', 'after'] as const) {
              const all = getSiblingNodes(node, () => true, dir);
              const first = findFirstNamedSibling(node, () => true, dir);
              if (all.length > 0) {
                expect(first?.equals(all[0]!)).toBe(true);
              } else {
                expect(first).toBeNull();
              }
            }
          }
        }),
        { numRuns: 25 },
      );
    });

    it('findFirstSibling (named-or-unnamed) returns a node sharing the parent', () => {
      fc.assert(
        fc.property(fishProgram, (code) => {
          for (const node of getChildNodes(parse(code))) {
            if (!node.parent) continue;
            const sib = findFirstSibling(node, () => true, 'after');
            if (sib) expect(sib.parent?.equals(node.parent)).toBe(true);
          }
        }),
        { numRuns: 25 },
      );
    });

    it('firstAncestorMatch(node, isProgram) is always the root', () => {
      fc.assert(
        fc.property(fishProgram, (code) => {
          const root = parse(code);
          for (const node of getChildNodes(root)) {
            // getParentNodes includes the node itself, and the program is always
            // an ancestor-or-self, so this resolves to the root for EVERY node.
            expect(firstAncestorMatch(node, isProgram)?.equals(root)).toBe(true);
          }
        }),
        { numRuns: 25 },
      );
    });

    it('ancestorMatch(node, isProgram) includes the root and only programs', () => {
      fc.assert(
        fc.property(fishProgram, (code) => {
          const root = parse(code);
          for (const node of getChildNodes(root)) {
            const matches = ancestorMatch(node, isProgram);
            expect(matches.every((n) => isProgram(n))).toBe(true);
            expect(matches.some((n) => n.equals(root))).toBe(true);
          }
        }),
        { numRuns: 20 },
      );
    });

    it('descendantMatch from root: isProgram == [root]; identity == getChildNodes', () => {
      fc.assert(
        fc.property(fishProgram, (code) => {
          const root = parse(code);
          const programs = descendantMatch(root, isProgram);
          expect(programs.length).toBe(1);
          expect(programs[0]?.equals(root)).toBe(true);
          expect(descendantMatch(root, () => true).length).toBe(getChildNodes(root).length);
          // inclusive=false drops the start node (root), leaving no programs
          expect(descendantMatch(root, isProgram, false).length).toBe(0);
        }),
        { numRuns: 25 },
      );
    });

    it('findEnclosingScope returns a valid node for every node (never throws/null)', () => {
      fc.assert(
        fc.property(fishProgram, (code) => {
          for (const node of getChildNodes(parse(code))) {
            expect(isSyntaxNode(findEnclosingScope(node))).toBe(true);
          }
        }),
        { numRuns: 25 },
      );
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // STEP 10 — TreeWalker.walkDown family, text/comment helpers, and the pure
  // path/position predicates (these last ones are tested with PURE generated
  // inputs — no parsing needed, the cleanest kind of property).
  // ──────────────────────────────────────────────────────────────────────────
  describe('STEP 10: TreeWalker walkDown family + text/pure helpers', () => {
    it('walkDown finds every node reachable via namedChildren from root', () => {
      fc.assert(
        fc.property(fishProgram, (code) => {
          const root = parse(code);
          // walkDownAll(..., () => true) is exactly the set reachable by walkDown,
          // so each of those must be findable by an equality walkDown.
          for (const node of TreeWalker.walkDownAll(root, () => true)) {
            expect(TreeWalker.walkDown(root, (n) => n.equals(node)).exists()).toBe(true);
          }
        }),
        { numRuns: 20 },
      );
    });

    it('walkUpAll(node, isProgram) is [root] for non-root, [] for root; findHighest agrees', () => {
      fc.assert(
        fc.property(fishProgram, (code) => {
          const root = parse(code);
          for (const node of getChildNodes(root)) {
            const ups = TreeWalker.walkUpAll(node, isProgram);
            expect(ups.every((n) => isProgram(n))).toBe(true);
            expect(ups.length).toBe(node.equals(root) ? 0 : 1);
            // findHighest is the topmost match of walkUpAll
            const highest = TreeWalker.findHighest(node, isProgram);
            expect(highest.exists()).toBe(!node.equals(root));
            if (!node.equals(root)) expect(highest.get()?.equals(root)).toBe(true);
          }
        }),
        { numRuns: 20 },
      );
    });

    it('findFirstChild returns the first namedChild when one exists', () => {
      fc.assert(
        fc.property(fishProgram, (code) => {
          for (const node of getChildNodes(parse(code))) {
            const first = TreeWalker.findFirstChild(node, () => true);
            expect(first.exists()).toBe(node.namedChildren.length > 0);
            if (node.namedChildren.length > 0) {
              expect(first.get()?.equals(node.namedChildren[0]!)).toBe(true);
            }
          }
        }),
        { numRuns: 20 },
      );
    });

    it('getNodesTextAsSingleLine never contains a newline', () => {
      fc.assert(
        fc.property(fishProgram, (code) => {
          const text = getNodesTextAsSingleLine(getChildNodes(parse(code)));
          expect(typeof text).toBe('string');
          expect(text.includes('\n')).toBe(false);
        }),
        { numRuns: 20 },
      );
    });

    it('getPrecedingComments/getRangeWithPrecedingComments are well-formed', () => {
      fc.assert(
        fc.property(fishProgram, (code) => {
          const root = parse(code);
          expect(getPrecedingComments(null)).toBe('');
          for (const node of getChildNodes(root)) {
            expect(typeof getPrecedingComments(node)).toBe('string');
            const rwc = getRangeWithPrecedingComments(node);
            const nodeRange = getRange(node);
            // end is the node's own end; start never starts AFTER the node start
            // (it only extends backward over preceding comment siblings).
            expect(rwc.end).toEqual(nodeRange.end);
            // start only extends backward over preceding comment siblings, so it
            // is never AFTER the node's own start position.
            expect(isPositionAfter(rwc.start, nodeRange.start)).toBe(false);
          }
        }),
        { numRuns: 20 },
      );
    });

    it('findNodeAt + rangeToPoint locate/convert a node start', () => {
      fc.assert(
        fc.property(fishProgram, (code) => {
          const { root, tree } = parseFull(code);
          for (const node of getChildNodes(root)) {
            const r = getRange(node);
            expect(findNodeAt(tree, r.start.line, r.start.character) !== null).toBe(true);
            const point = rangeToPoint(r);
            expect(point.row).toBe(r.start.line);
            expect(point.column).toBe(r.start.character);
          }
        }),
        { numRuns: 20 },
      );
    });

    it('isSyntaxNode: true for nodes, false for non-nodes', () => {
      fc.assert(
        fc.property(fishProgram, (code) => {
          for (const node of getChildNodes(parse(code))) {
            expect(isSyntaxNode(node)).toBe(true);
          }
        }),
        { numRuns: 10 },
      );
      expect(isSyntaxNode(null)).toBe(false);
      expect(isSyntaxNode(undefined)).toBe(false);
      expect(isSyntaxNode('echo')).toBe(false);
      expect(isSyntaxNode({ type: 'program' })).toBe(false);
    });

    it('isFishExtension: a `.fish` path is fish, others are not (pure input)', () => {
      const word = fc.stringMatching(/^[a-zA-Z0-9_]+$/);
      fc.assert(
        fc.property(word, (name) => {
          expect(isFishExtension(`${name}.fish`)).toBe(true);
          expect(isFishExtension(`${name}.txt`)).toBe(false);
          expect(isFishExtension(`/some/dir/${name}.fish`)).toBe(true);
        }),
        { numRuns: 30 },
      );
    });

    it('isPositionAfter is irreflexive and antisymmetric (pure input)', () => {
      const position = fc.record({
        line: fc.nat({ max: 200 }),
        character: fc.nat({ max: 200 }),
      });
      fc.assert(
        fc.property(position, position, (a, b) => {
          expect(isPositionAfter(a, a)).toBe(false); // irreflexive
          if (isPositionAfter(a, b)) {
            expect(isPositionAfter(b, a)).toBe(false); // antisymmetric
          }
        }),
        { numRuns: 100 },
      );
    });
  });
});
