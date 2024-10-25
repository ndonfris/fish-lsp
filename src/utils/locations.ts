// https://github.com/typescript-language-server/typescript-language-server/blob/5a39c1f801ab0cad725a2b8711c0e0d46606a08b/src/utils/typeConverters.ts#L12

import * as LSP from 'vscode-languageserver';
import { FishProtocol } from './fishProtocol';
import { Point, SyntaxNode } from 'web-tree-sitter';
import { URI } from 'vscode-uri';

export namespace Range {

  export const create = (start: LSP.Position, end: LSP.Position): LSP.Range => LSP.Range.create(start, end);
  export const is = (value: any): value is LSP.Range => LSP.Range.is(value);

  export const fromTextSpan = (span: FishProtocol.TextSpan): LSP.Range => fromLocations(span.start, span.end);

  export const toString = (range: LSP.Range): string => `${range.start.line}:${range.start.character} - ${range.end.line}:${range.end.character}`;

  export const toTextSpan = (range: LSP.Range): FishProtocol.TextSpan => ({
    start: Position.toLocation(range.start),
    end: Position.toLocation(range.end),
  });

  /**
   * Converts a tree-sitter SyntaxNode to an LSP Range.
   * @param node The tree-sitter SyntaxNode to convert
   * @returns An LSP Range
   */
  export function fromSynatxNode(node: SyntaxNode): LSP.Range {
    return LSP.Range.create(
      node.startPosition.row,
      node.startPosition.column,
      node.endPosition.row,
      node.endPosition.column,
    );
  }

  /**
   * Converts an LSP Range to a pair of tree-sitter Points.
   * @param range The LSP Range to convert
   * @returns An object with start and end tree-sitter Points
   */
  export function toTreeSitterRange(range: LSP.Range): { startPosition: Point; endPosition: Point; } {
    return {
      startPosition: Position.toTreeSitterPosition(range.start),
      endPosition: Position.toTreeSitterPosition(range.end),
    };
  }

  /**
   * Converts a pair of tree-sitter Points to an LSP Range.
   * @param startPosition The start Point
   * @param endPosition The end Point
   * @returns An LSP Range
   */
  export function fromTreeSitterRange(startPosition: Point, endPosition: Point): LSP.Range {
    return LSP.Range.create(
      Position.fromTreeSitterPosition(startPosition),
      Position.fromTreeSitterPosition(endPosition),
    );
  }

  export const fromLocations = (start: FishProtocol.Location, end: FishProtocol.Location): LSP.Range =>
    LSP.Range.create(
      Math.max(0, start.line - 1), Math.max(start.offset - 1, 0),
      Math.max(0, end.line - 1), Math.max(0, end.offset - 1));

  export const toFileRangeRequestArgs = (file: string, range: LSP.Range): FishProtocol.FileRangeRequestArgs => ({
    file,
    startLine: range.start.line + 1,
    startOffset: range.start.character + 1,
    endLine: range.end.line + 1,
    endOffset: range.end.character + 1,
  });

  export const toFormattingRequestArgs = (file: string, range: LSP.Range): FishProtocol.FormatRequestArgs => ({
    file,
    line: range.start.line + 1,
    offset: range.start.character + 1,
    endLine: range.end.line + 1,
    endOffset: range.end.character + 1,
  });

  /**
   * Joins two ranges into a single `LSP.Range`
   * Comprised of the LARGEST `Range.start` and SMALLEST `Range.end` in the params.
   * ---
   * @param one - `LSP.Range` that might overlap with `two`
   * @param two - `LSP.Range` that might overlap with `one`
   * @returns `LSP.Range` if there is an overlap, `undefined` otherwise
   */
  export function intersection(one: LSP.Range, two: LSP.Range): LSP.Range | undefined {
    const start = Position.Max(two.start, one.start);
    const end = Position.Min(two.end, one.end);
    if (Position.isAfter(start, end)) {
      // this happens when there is no overlap:
      // |-----|
      //          |----|
      return undefined;
    }
    return LSP.Range.create(start, end);
  }

  /**
   * @param range - `LSP.Range` to use as enclosing value
   * @param position - `LSP.Position` used for comparing against specified `LSP.Range`
   * @returns boolean (`true` if position is within range, `false` otherwise)
   */
  export function containsPosition(range: LSP.Range, position: LSP.Position): boolean {
    if (position.line < range.start.line || position.line > range.end.line) {
      return false;
    }

    if (position.line === range.start.line && position.character < range.start.character) {
      return false;
    }

    if (position.line === range.end.line && position.character > range.end.character) {
      return false;
    }

    return true;
  }

  export function containsRange(one: LSP.Range, other: LSP.Range): boolean {
    return containsPosition(one, other.start) && containsPosition(one, other.end);
  }

  /**
   * Checks if the ranges passed in are equal.
   * @param one - first range
   * @param others - other ranges
   * @returns boolean (true if all ranges are equal, false otherwise)
   */
  export function isEqual(one: LSP.Range, ...others: LSP.Range[]): boolean {
    /**
     * @param one - first range
     * @param two - second range
     * @returns boolean
     */
    function _isEqual(one: LSP.Range, two: LSP.Range): boolean {
      return Position.isBeforeOrEqual(one.start, two.start) && Position.isBeforeOrEqual(two.end, one.end);
    }
    return others.every(other => _isEqual(one, other));
  }

  export function isBefore(one: LSP.Range, two: LSP.Range): boolean {
    return Position.isBefore(one.end, two.start) && !Position.isEqual(one.end, two.start);
  }

  export function isBeforeOrEqual(one: LSP.Range, two: LSP.Range): boolean {
    return Position.isBeforeOrEqual(one.end, two.start);
  }

  export function isAfter(one: LSP.Range, two: LSP.Range): boolean {
    return Position.isAfter(one.start, two.end) && !Position.isEqual(one.start, two.end);
  }

  export function isAfterOrEqual(one: LSP.Range, two: LSP.Range): boolean {
    return Position.isAfterOrEqual(one.start, two.end);
  }

  export function isEmpty(range: LSP.Range): boolean {
    return Position.isEqual(range.start, range.end);
  }

  // New function to merge overlapping ranges
  export function merge(ranges: LSP.Range[]): LSP.Range[] {
    if (ranges.length <= 1) return ranges;

    const sortedRanges = ranges.sort((a, b) =>
      Position.isBefore(a.start, b.start) ? -1 : 1,
    );

    const mergedRanges: LSP.Range[] = [];
    let currentRange = sortedRanges[0]!;

    for (let i = 1; i < sortedRanges.length; i++) {
      if (isBeforeOrEqual(currentRange, sortedRanges[i]!)) {
        currentRange = create(
          currentRange.start,
          Position.Max(currentRange.end, sortedRanges[i]!.end),
        );
      } else {
        mergedRanges.push(currentRange);
        currentRange = sortedRanges[i]!;
      }
    }

    mergedRanges.push(currentRange);
    return mergedRanges;
  }

  export function fromNode(SyntaxNode: SyntaxNode): LSP.Range {
    return LSP.Range.create(
      SyntaxNode.startPosition.row,
      SyntaxNode.startPosition.column,
      SyntaxNode.endPosition.row,
      SyntaxNode.endPosition.column,
    );
  }

  /**
   * Returns the number of lines in the range.
   */
  export function lineCount(range: LSP.Range): number {
    return range.end.line - range.start.line + 1;
  }

  /**
   * Checks if the range spans multiple lines.
   */
  export function isMultiLine(range: LSP.Range): boolean {
    return range.start.line !== range.end.line;
  }

  /**
   * Returns the range that includes both input ranges.
   */
  export function union(one: LSP.Range, other: LSP.Range): LSP.Range {
    return LSP.Range.create(
      Position.Min(one.start, other.start) || one.start,
      Position.Max(one.end, other.end) || one.end,
    );
  }

  /**
   * Splits a range into an array of single-line ranges.
   */
  export function splitIntoLines(range: LSP.Range): LSP.Range[] {
    const lines: LSP.Range[] = [];
    for (let line = range.start.line; line <= range.end.line; line++) {
      const start = line === range.start.line ? range.start.character : 0;
      const end = line === range.end.line ? range.end.character : 1;
      lines.push(LSP.Range.create(line, start, line, end));
    }
    return lines;
  }

  /**
   * Checks if the range contains a single character position.
   */
  export function containsCharacter(range: LSP.Range, line: number, character: number): boolean {
    const pos = LSP.Position.create(line, character);
    return containsPosition(range, pos);
  }

  /**
   * Checks if the ranges contains the newRange (protects duplicating ranges).
   * Two ranges are considered the same if they have the same start and end positions.
   * DOES NOT EDIT THE \`ranges\` ARRAY
   * @param ranges The array of ranges to check
   * @param newRange The new range to check
   * @returns True if the range is already present, false otherwise
   */
  export function rangesHasRange(ranges: LSP.Range[], newRange: LSP.Range): boolean {
    return !ranges.some(range =>
      Position.isEqual(range.start, newRange.start) && Position.isEqual(range.end, newRange.end),
    );
  }

  /**
 * Pushes a new range into the array if it's not already present.
 * Two ranges are considered the same if they have the same start and end positions.
 * @param ranges The array of ranges to push into
 * @param newRange The new range to push
 * @returns True if the range was added, false if it was already present
 */
  export function pushUniqueRange(ranges: LSP.Range[], newRange: LSP.Range): boolean {
    const isUnique = !ranges.some(range =>
      Position.isEqual(range.start, newRange.start) && Position.isEqual(range.end, newRange.end),
    );

    if (isUnique) {
      ranges.push(newRange);
      return true;
    }

    return false;
  }

  /**
  * Removes any range from the array that contains the given searchRange.
  * This function modifies the array in-place and uses constant memory.
  * @param ranges The array of ranges to modify
  * @param searchRange The range to search for in the `ranges` array
  * @returns The number of ranges removed from `ranges` array
  */
  export function removeContainingRange(ranges: LSP.Range[], searchRange: LSP.Range): number {
    let writeIndex = 0;
    let removedCount = 0;

    for (let readIndex = 0; readIndex < ranges.length; readIndex++) {
      const currentRange = ranges[readIndex];
      if (currentRange && !containsRange(currentRange, searchRange)) {
        ranges[writeIndex] = currentRange;
        writeIndex++;
      } else {
        removedCount++;
      }
    }

    ranges.length = writeIndex;
    return removedCount;
  }

  /**
 * Calculates the distance between two ranges.
 * @param range1 The first range
 * @param range2 The second range
 * @param options Options for distance calculation
 * @returns The calculated distance
 */
  export function distance(
    range1: LSP.Range,
    range2: LSP.Range,
    options: {
      method?: 'start' | 'end' | 'both';
      positionDistanceOptions?: Parameters<typeof Position.distance>[2];
    } = {},
  ): number {
    const { method = 'both', positionDistanceOptions } = options;

    switch (method) {
      case 'start':
        return Position.distance(range1.start, range2.start, positionDistanceOptions);
      case 'end':
        return Position.distance(range1.end, range2.end, positionDistanceOptions);
      case 'both':
        return Math.max(
          Position.distance(range1.start, range2.start, positionDistanceOptions),
          Position.distance(range1.end, range2.end, positionDistanceOptions));
      default:
        throw new Error(`Unknown distance calculation method: ${method}`);
    }
  }

  export function equals(symbolRange: LSP.Range, selectionRange: LSP.Range) {
    return Position.isEqual(symbolRange.start, selectionRange.start) && Position.isEqual(symbolRange.end, selectionRange.end);
  }
}

export namespace Position {

  export const create = (line: number, character: number): LSP.Position => LSP.Position.create(line, character);
  export const is = (value: any): value is LSP.Position => LSP.Position.is(value);

  export const fromLocation = (fishlocation: FishProtocol.Location): LSP.Position => {
    // Clamping on the low side to 0 since Typescript returns 0, 0 when creating new file
    // even though position is supposed to be 1-based.
    return {
      line: Math.max(fishlocation.line - 1, 0),
      character: Math.max(fishlocation.offset - 1, 0),
    };
  };

  export const toLocation = (position: LSP.Position): FishProtocol.Location => ({
    line: position.line + 1,
    offset: position.character + 1,
  });

  export const toFileLocationRequestArgs = (file: string, position: LSP.Position): FishProtocol.FileLocationRequestArgs => ({
    file,
    line: position.line + 1,
    offset: position.character + 1,
  });

  /**
 * Converts an LSP Position to a tree-sitter Point.
 * @param position The LSP Position to convert
 * @returns A tree-sitter Point
 */
  export function toTreeSitterPosition(position: LSP.Position): Point {
    return {
      row: position.line,
      column: position.character,
    };
  }

  /**
   * Converts a tree-sitter Point to an LSP Position.
   * @param point The tree-sitter Point to convert
   * @returns An LSP Position
   */
  export function fromTreeSitterPosition(point: Point): LSP.Position {
    return LSP.Position.create(point.row, point.column);
  }

  export function fromSyntaxNode(node: SyntaxNode): LSP.Position {
    return LSP.Position.create(node.startPosition.row, node.startPosition.column);
  }

  export function Min(): undefined;
  export function Min(...positions: LSP.Position[]): LSP.Position;
  export function Min(...positions: LSP.Position[]): LSP.Position | undefined {
    if (positions.length === 0) return undefined;
    return positions.reduce((min, p) =>
      isBefore(p, min) ? p : min,
    );
  }

  export function Max(): undefined;
  export function Max(...positions: LSP.Position[]): LSP.Position;
  export function Max(...positions: LSP.Position[]): LSP.Position | undefined {
    if (positions.length === 0) return undefined;
    return positions.reduce((max, p) =>
      isAfter(p, max) ? p : max,
    );
  }

  export function isBefore(one: LSP.Position, other: LSP.Position): boolean {
    if (one.line < other.line) {
      return true;
    }
    if (other.line < one.line) {
      return false;
    }
    return one.character < other.character;
  }

  export function isBeforeOrEqual(one: LSP.Position, other: LSP.Position): boolean {
    if (one.line < other.line) {
      return true;
    }
    if (other.line < one.line) {
      return false;
    }
    return one.character <= other.character;
  }

  export function isAfter(one: LSP.Position, other: LSP.Position): boolean {
    return !isBeforeOrEqual(one, other);
  }

  export function isAfterOrEqual(one: LSP.Position, other: LSP.Position): boolean {
    if (other.line > one.line) {
      return true;
    }
    if (one.line > other.line) {
      return false;
    }
    return one.character >= other.character;
  }

  export function isEqual(one: LSP.Position, other: LSP.Position): boolean {
    return one.line === other.line && one.character === other.character;
  }

  export function distance(
    pos1: LSP.Position,
    pos2: LSP.Position,
    options: {
      /**
       * The method to use for distance calculation.
       * - 'character': Counts total characters, considering line breaks as one character.
       * - 'manhattan': Calculates Manhattan distance (sum of line and character differences).
       * - 'euclidean': Calculates Euclidean distance (straight line between points).
       * Default is 'character'.
       */
      method?: 'character' | 'manhattan' | 'euclidean';
      /**
       * Average number of characters per line. Used for 'euclidean' method.
       * Default is 80.
       */
      averageLineLength?: number;
      /**
       * Function to get the actual length of a specific line.
       * If provided, it will be used instead of averageLineLength for more accurate calculations.
       */
      getLineLength?: (line: number) => number;
    } = {},
  ): number {
    /** set default options */
    const {
      method = 'character',
      averageLineLength = 80,
      getLineLength,
    } = options;

    /** Ensure start is always the earlier position */
    const [start, end] = isBefore(pos1, pos2) ? [pos1, pos2] : [pos2, pos1];

    const lineDiff = end.line - start.line;
    const charDiff = end.character - start.character;

    switch (method) {
      case 'character': {
        let distance = 0;
        for (let line = start.line; line <= end.line; line++) {
          const lineLength = getLineLength ? getLineLength(line) : averageLineLength;
          if (line === start.line && line === end.line) {
            distance += charDiff;
          } else if (line === start.line) {
            distance += lineLength - start.character;
          } else if (line === end.line) {
            distance += end.character;
          } else {
            distance += lineLength;
          }
        }
        return distance;
      }
      case 'manhattan':
        return Math.abs(lineDiff) + Math.abs(charDiff);
      case 'euclidean': {
        const effectiveCharDiff = charDiff + lineDiff * averageLineLength;
        return Math.sqrt(lineDiff * lineDiff + effectiveCharDiff * effectiveCharDiff);
      }
      default:
        throw new Error(`Unknown distance calculation method: ${method}`);
    }
  }
}

export namespace Location {
  export const create = (uri: string, range: LSP.Range): LSP.Location => LSP.Location.create(uri, range);
  export const is = (value: any): value is LSP.Location => LSP.Location.is(value);
  export const fromTextSpan = (resource: LSP.DocumentUri, fishTextSpan: FishProtocol.TextSpan): LSP.Location =>
    LSP.Location.create(resource, Range.fromTextSpan(fishTextSpan));

  // New function to compare locations
  export function compare(a: LSP.Location, b: LSP.Location): number {
    if (a.uri < b.uri) return -1;
    if (a.uri > b.uri) return 1;
    return Range.isEqual(a.range, b.range)
      ? 0
      : Position.isBefore(a.range.start, b.range.start) ? -1 : 1;
  }

  /**
   * Checks if two locations are equal.
   * @param a The first location
   * @param b The second location
   * @returns True if the locations are equal, false otherwise
   */
  export function isEqual(a: LSP.Location, b: LSP.Location): boolean {
    return a.uri === b.uri && Range.isEqual(a.range, b.range);
  }

  // New function to check if two locations overlap
  export function overlaps(a: LSP.Location, b: LSP.Location): boolean {
    return a.uri === b.uri && !!Range.intersection(a.range, b.range);
  }

  /**
 * Converts a tree-sitter compatible location to an LSP Location.
 * @param uri The document URI
 * @param startPosition The start Point
 * @param endPosition The end Point
 * @returns An LSP Location
 */
  export function fromTreeSitterCompatible(uri: string, startPosition: Point, endPosition: Point): LSP.Location {
    return LSP.Location.create(uri, Range.fromTreeSitterRange(startPosition, endPosition));
  }

  /**
   * Calculates the distance between two locations.
   * @param loc1 The first location
   * @param loc2 The second location
   * @param options Options for distance calculation
   * @returns The calculated distance, or undefined if the locations are in different files
   */
  export function distance(
    loc1: LSP.Location,
    loc2: LSP.Location,
    options: {
      rangeDistanceOptions?: Parameters<typeof Range.distance>[2];
      uriDistanceWeight?: number;
    } = {},
  ): number | undefined {
    const { rangeDistanceOptions, uriDistanceWeight = 1000 } = options;

    // If URIs are different, calculate URI distance
    if (loc1.uri !== loc2.uri) {
      const uri1 = URI.parse(loc1.uri);
      const uri2 = URI.parse(loc2.uri);

      // If the schemes or authorities are different, return undefined
      if (uri1.scheme !== uri2.scheme || uri1.authority !== uri2.authority) {
        return undefined;
      }

      // Calculate the distance between paths
      const path1 = uri1.path.split('/').filter(Boolean); // Remove empty segments
      const path2 = uri2.path.split('/').filter(Boolean);

      // Find the index where paths start to differ
      const commonPrefixLength = path1.findIndex((segment, index) => segment !== path2[index]);

      // If commonPrefixLength is -1, it means one path is a prefix of the other
      // In this case, we set it to the length of the shorter path
      const effectiveCommonLength = commonPrefixLength === -1
        ? Math.min(path1.length, path2.length)
        : commonPrefixLength;

      // Calculate the number of different segments
      const differentSegments =
        path1.length - effectiveCommonLength === 1 && path2.length - effectiveCommonLength === 1
          ? 1
          : path1.length - effectiveCommonLength + path2.length - effectiveCommonLength;

      // URI distance is the number of different segments multiplied by the weight
      const uriDistance = differentSegments * uriDistanceWeight;

      // Add range distance to URI distance
      return uriDistance + Range.distance(loc1.range, loc2.range, rangeDistanceOptions);
    }

    // If URIs are the same, just calculate range distance
    return Range.distance(loc1.range, loc2.range, rangeDistanceOptions);
  }
}