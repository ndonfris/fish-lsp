import { SyntaxNode } from 'web-tree-sitter';
import { getNamedChildNodes } from '../utils/tree-sitter';
import { isConditional } from '../utils/node-types';

/**
 * Code Action utility function to convert an if_statement node into a sequence of combiner commands.
 * ___
 * ```fish
 * if test -f file
 *   echo "file exists"
 * else
 *   echo "file does not exist"
 * end
 * ```
 * ___
 * Would Become:
 * ___
 * ```fish
 * test -f file
 * and echo "file exists"
 *
 * or echo "file does not exist"
 * ```
 * ___
 * @param node the if_statement node to convert into a sequence of combiner commands.
 * @returns a string representation of the if_statement node, with the if/else-if/else blocks combined.
 */
export function convertIfToCombinersString(node: SyntaxNode) {
  const combiner = new StatementCombiner();
  const queue: SyntaxNode[] = getNamedChildNodes(node);
  while (queue.length > 0) {
    const n = queue.shift();
    if (!n) break;
    switch (true) {
      case isConditional(n):
        combiner.newBlock(n.type as BlockKeywordType);
        break;
      case n.type === 'conditional_execution':
        combiner.appendCommand(n);
        skipChildren(n, queue);
        break;
      case n.type === 'comment':
      case n.type === 'command':
        combiner.appendCommand(n);
        break;
    }
  }
  return combiner.build();
}

/**
 * Utility function to skip children nodes that are not part of the current node.
 */
function skipChildren(node: SyntaxNode, queue: SyntaxNode[]) {
  while (queue.length > 0) {
    const peek = queue.at(0);
    if (!peek) break;
    if (peek.endIndex > node.endIndex || peek.startIndex < node.startIndex) break;
    queue.shift();
  }
}

/** Types of conditional blocks, defined in tree-sitter-fish grammar **/
type BlockKeywordType = 'if_statement' | 'else_if_clause' | 'else_clause';

/**
 * Data structure to represent a conditional block in the fish language.
 * A conditional block is a series of commands that are executed based on a condition.
 * ___
 * ```fish
 * if test -f file
 *   echo "file exists"
 * end
 * ```
 * ___
 * Would become:
 * ___
 * ```typescript
 * {
 *    keyword: 'if_statement',
 *    body: [
 *      { type: 'command', text: 'test -f file' },
 *      { type: 'command', text: 'echo "file exists"' }
 *    ],
 * }
 * ```
 */
interface ConditionalBlock {
  /** the type of conditional block */
  keyword: BlockKeywordType;
  /** the commands that make up the conditional block */
  body: SyntaxNode[];
}

namespace ConditionalBlock {
  /**
   * Creates a new conditional block. Typically the body will be empty, since
   * a `if`/`else-if`/`else` block will always come before the body it contains.
   * @param keyword The type of conditional block
   * @param body The commands that make up the conditional block
   * @returns The new conditional block
   */
  export function create(keyword: BlockKeywordType, body: SyntaxNode[] = []) {
    return { keyword, body };
  }
}

/**
 * Helper class to combine statements together, based on their conditional blocks.
 *
 * This class converts if/else-if/else blocks into a single string, with the
 * appropriate combiners (and/or) between each block. Ideally, output from
 * this class should keep the original control flow, while removing the
 * if/else-if/else statements.
 */
class StatementCombiner {
  private blocks: ConditionalBlock[] = [];

  get currentBlock(): undefined | ConditionalBlock {
    if (this.blocks.length === 0) {
      return undefined;
    }
    return this.blocks[this.blocks.length - 1];
  }

  /**
   * Creates a new block, based on the keyword type.
   */
  newBlock(keywordType: 'if_statement' | 'else_if_clause' | 'else_clause') {
    this.blocks.push(ConditionalBlock.create(keywordType));
  }

  /**
   * Appends a node to the current block. Nodes should be non-leaf nodes for the
   * most part because the `build()` method will use the `node.text` property to
   * build combined strings. More specifically, the node's that are appended
   * should group together child sections of each segment of the conditional
   * sequence per if/else-if/else block.
   * ___
   * The supported possibilities for `node.type` are: `command`, `comment`, or `conditional_execution`
   * ___
   * NOTE: not calling `newBlock()` before this method will throw an error.
   * ___
   * @param node the node to append on the block's body.
   */
  appendCommand(node: SyntaxNode) {
    if (!this.currentBlock) {
      throw new Error('Cannot append command to non-existent block, please create a new block first');
    }
    this.currentBlock.body.push(node);
  }

  /**
   * Helper for retrieving the prefix combiner for a block, based on its keyword.
   * The prefix is then used to combine the if/else-if/else blocks together.
   * ___
   * `if_statement`   -> ''
   * `else_if_clause` -> 'or '
   * `else_clause`    -> 'or '
   * ___
   * @param block The block to get the combiner for (which is the prefix )
   * @returns The prefix/combiner for the block
   */
  private getCombinerFromKeyword(block: ConditionalBlock) {
    switch (block.keyword) {
      case 'if_statement':
        return '';
      case 'else_if_clause':
      case 'else_clause':
        return 'or ';
    }
  }

  /**
   * Builds the string representation of a block, including the combiner and the comments
   * @param block The block to build the string for
   * @returns The string representation of the block
   */
  private buildBlockString(block: ConditionalBlock) {
    let str = this.getCombinerFromKeyword(block);
    block.body.forEach((node, idx) => {
      const nextNode = block.body.length - 1 >= idx
        ? block.body[idx + 1]
        : undefined;

      if (nextNode && nextNode.type === 'comment') {
        str += node.text + '\n';
      } else if (nextNode && nextNode.type === 'command') {
        str += node.text + '\nand ';
      } else {
        str += node.text + '\n';
      }
    });
    return str;
  }

  /**
   * Builds the combined string of all the blocks
   */
  build() {
    return this.blocks
      .map(block => this.buildBlockString(block))
      .join('\n')
      .trim();
  }
}
