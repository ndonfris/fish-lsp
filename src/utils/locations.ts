// https://github.com/typescript-language-server/typescript-language-server/blob/5a39c1f801ab0cad725a2b8711c0e0d46606a08b/src/utils/typeConverters.ts#L12

import * as LSP from 'vscode-languageserver';
import { FishProtocol } from './fishProtocol';

export namespace Range {

  export const create = (start: LSP.Position, end: LSP.Position): LSP.Range => LSP.Range.create(start, end);
  export const is = (value: any): value is LSP.Range => LSP.Range.is(value);

  export const fromTextSpan = (span: FishProtocol.TextSpan): LSP.Range => fromLocations(span.start, span.end);

  export const toTextSpan = (range: LSP.Range): FishProtocol.TextSpan => ({
    start: Position.toLocation(range.start),
    end: Position.toLocation(range.end),
  });

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

  export function intersection(one: LSP.Range, other: LSP.Range): LSP.Range | undefined {
    const start = Position.Max(other.start, one.start);
    const end = Position.Min(other.end, one.end);
    if (Position.isAfter(start, end)) {
      // this happens when there is no overlap:
      // |-----|
      //          |----|
      return undefined;
    }
    return LSP.Range.create(start, end);
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

  export function Min(): undefined;
  export function Min(...positions: LSP.Position[]): LSP.Position;
  export function Min(...positions: LSP.Position[]): LSP.Position | undefined {
    if (!positions.length) {
      return undefined;
    }
    let result = positions.pop()!;
    for (const p of positions) {
      if (isBefore(p, result)) {
        result = p;
      }
    }
    return result;
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
  export function Max(): undefined;
  export function Max(...positions: LSP.Position[]): LSP.Position;
  export function Max(...positions: LSP.Position[]): LSP.Position | undefined {
    if (!positions.length) {
      return undefined;
    }
    let result = positions.pop()!;
    for (const p of positions) {
      if (isAfter(p, result)) {
        result = p;
      }
    }
    return result;
  }
  export function isAfter(one: LSP.Position, other: LSP.Position): boolean {
    return !isBeforeOrEqual(one, other);
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
}

export namespace Location {
  export const create = (uri: string, range: LSP.Range): LSP.Location => LSP.Location.create(uri, range);
  export const is = (value: any): value is LSP.Location => LSP.Location.is(value);
  export const fromTextSpan = (resource: LSP.DocumentUri, fishTextSpan: FishProtocol.TextSpan): LSP.Location =>
    LSP.Location.create(resource, Range.fromTextSpan(fishTextSpan));
}
