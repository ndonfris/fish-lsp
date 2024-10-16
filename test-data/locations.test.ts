
import * as LSP from 'vscode-languageserver';
import { Range, Position, Location } from '../src/utils/locations';
// import { setLogger } from './helpers';
// setLogger();
describe('Range', () => {
  const range1 = LSP.Range.create(1, 2, 3, 4);
  const range2 = LSP.Range.create(2, 3, 4, 5);

  test('fromTextSpan', () => {
    const textSpan = { start: { line: 2, offset: 3 }, end: { line: 4, offset: 5 } };
    expect(Range.fromTextSpan(textSpan)).toEqual(LSP.Range.create(1, 2, 3, 4));
  });

  test('toTextSpan', () => {
    const range = LSP.Range.create(1, 2, 3, 4);
    expect(Range.toTextSpan(range)).toEqual({ start: { line: 2, offset: 3 }, end: { line: 4, offset: 5 } });
  });

  test('intersection', () => {
    const intersectingRange = LSP.Range.create(2, 0, 3, 0);
    const nonIntersectingRange = LSP.Range.create(4, 0, 5, 0);
    expect(Range.intersection(range1, intersectingRange)).toEqual(LSP.Range.create(2, 0, 3, 0));
    expect(Range.intersection(range1, range2)).toEqual(LSP.Range.create(2, 3, 3, 4));
    expect(Range.intersection(intersectingRange, nonIntersectingRange)).toBeUndefined();
  });

  test('containsPosition', () => {
    expect(Range.containsPosition(range1, LSP.Position.create(2, 3))).toBe(true);
    expect(Range.containsPosition(range1, LSP.Position.create(0, 0))).toBe(false);
  });

  test('containsRange', () => {
    const innerRange = LSP.Range.create(2, 0, 2, 5);
    expect(Range.containsRange(range1, innerRange)).toBe(true);
    expect(Range.containsRange(range1, range2)).toBe(false);
  });

  test('equals', () => {
    expect(Range.isEqual(range1, range1)).toBe(true);
    expect(Range.isEqual(range1, range2)).toBe(false);
  });

  test('isEmpty', () => {
    expect(Range.isEmpty(LSP.Range.create(1, 2, 1, 2))).toBe(true);
    expect(Range.isEmpty(range1)).toBe(false);
  });

  test('merge', () => {
    const ranges = [
      LSP.Range.create(1, 0, 2, 0),
      LSP.Range.create(2, 0, 3, 0),
      LSP.Range.create(4, 0, 5, 0),
    ];
    expect(Range.merge(ranges)).toEqual([
      LSP.Range.create(1, 0, 5, 0),
    ]);
  });

  test('lineCount', () => {
    expect(Range.lineCount(range1)).toBe(3);
  });

  test('isMultiLine', () => {
    expect(Range.isMultiLine(range1)).toBe(true);
    expect(Range.isMultiLine(LSP.Range.create(1, 0, 1, 5))).toBe(false);
  });

  test('union', () => {
    expect(Range.union(range1, range2)).toEqual(LSP.Range.create(1, 2, 4, 5));
  });

  test('splitIntoLines', () => {
    expect(Range.splitIntoLines(range1)).toEqual([
      LSP.Range.create(1, 2, 1, 1),
      LSP.Range.create(2, 0, 2, 1),
      LSP.Range.create(3, 0, 3, 4),
    ]);
  });

  test('containsCharacter', () => {
    expect(Range.containsCharacter(range1, 2, 3)).toBe(true);
    expect(Range.containsCharacter(range1, 0, 0)).toBe(false);
  });

  test('pushUniqueRange', () => {
    const ranges: LSP.Range[] = [
      LSP.Range.create(1, 0, 2, 0),
      LSP.Range.create(3, 0, 4, 0),
    ];

    // Should add a new unique range
    expect(Range.pushUniqueRange(ranges, LSP.Range.create(5, 0, 6, 0))).toBe(true);
    expect(ranges).toHaveLength(3);

    // Should not add a duplicate range
    expect(Range.pushUniqueRange(ranges, LSP.Range.create(1, 0, 2, 0))).toBe(false);
    expect(ranges).toHaveLength(3);

    // Should add a range with the same start but different end
    expect(Range.pushUniqueRange(ranges, LSP.Range.create(1, 0, 3, 0))).toBe(true);
    expect(ranges).toHaveLength(4);

    // Should add a range with the same end but different start
    expect(Range.pushUniqueRange(ranges, LSP.Range.create(0, 0, 2, 0))).toBe(true);
    expect(ranges).toHaveLength(5);
  });

  describe('removeContainingRange', () => {
    test('removes ranges that contain the search range', () => {
      const ranges = [
        LSP.Range.create(0, 0, 10, 0),
        LSP.Range.create(2, 0, 5, 0),
        LSP.Range.create(3, 0, 4, 0),
        LSP.Range.create(6, 0, 8, 0),
      ];
      const searchRange = LSP.Range.create(3, 5, 3, 10);

      const removedCount = Range.removeContainingRange(ranges, searchRange);

      // console.log(JSON.stringify({ removedCount, ranges }, null, 2));
      expect(removedCount).toBe(3);
      expect(ranges).toEqual([LSP.Range.create(6, 0, 8, 0)]);
    });

    test('does not remove ranges that do not contain the search range', () => {
      const ranges = [
        LSP.Range.create(0, 0, 1, 0),
        LSP.Range.create(2, 0, 3, 0),
        LSP.Range.create(4, 0, 5, 0),
      ];
      const searchRange = LSP.Range.create(6, 0, 7, 0);

      const removedCount = Range.removeContainingRange(ranges, searchRange);

      expect(removedCount).toBe(0);
      expect(ranges).toEqual([
        LSP.Range.create(0, 0, 1, 0),
        LSP.Range.create(2, 0, 3, 0),
        LSP.Range.create(4, 0, 5, 0),
      ]);
    });

    test('handles empty array', () => {
      const ranges: LSP.Range[] = [];
      const searchRange = LSP.Range.create(0, 0, 1, 0);

      const removedCount = Range.removeContainingRange(ranges, searchRange);

      expect(removedCount).toBe(0);
      expect(ranges).toEqual([]);
    });

    test('removes all ranges if they all contain the search range', () => {
      const ranges = [
        LSP.Range.create(0, 0, 10, 0),
        LSP.Range.create(0, 0, 5, 0),
        LSP.Range.create(1, 0, 4, 0),
      ];
      const searchRange = LSP.Range.create(2, 0, 3, 0);

      const removedCount = Range.removeContainingRange(ranges, searchRange);

      expect(removedCount).toBe(3);
      expect(ranges).toEqual([]);
    });

    test('handles ranges with identical start and end', () => {
      const ranges = [
        LSP.Range.create(1, 0, 1, 0),
        LSP.Range.create(2, 0, 3, 0),
        LSP.Range.create(3, 0, 3, 0),
      ];
      const searchRange = LSP.Range.create(2, 5, 2, 10);

      const removedCount = Range.removeContainingRange(ranges, searchRange);

      expect(removedCount).toBe(1);
      expect(ranges).toEqual([
        LSP.Range.create(1, 0, 1, 0),
        LSP.Range.create(3, 0, 3, 0),
      ]);
    });
  });
});

describe('Position', () => {
  const pos1 = LSP.Position.create(1, 2);
  const pos2 = LSP.Position.create(2, 3);

  test('fromLocation', () => {
    expect(Position.fromLocation({ line: 2, offset: 3 })).toEqual(LSP.Position.create(1, 2));
  });

  test('toLocation', () => {
    expect(Position.toLocation(pos1)).toEqual({ line: 2, offset: 3 });
  });

  test('Min', () => {
    expect(Position.Min(pos1, pos2)).toEqual(pos1);
  });

  test('Max', () => {
    expect(Position.Max(pos1, pos2)).toEqual(pos2);
  });

  test('isBefore', () => {
    expect(Position.isBefore(pos1, pos2)).toBe(true);
    expect(Position.isBefore(pos2, pos1)).toBe(false);
  });

  test('isAfter', () => {
    expect(Position.isAfter(pos2, pos1)).toBe(true);
    expect(Position.isAfter(pos1, pos2)).toBe(false);
  });

  test('isEqual', () => {
    expect(Position.isEqual(pos1, LSP.Position.create(1, 2))).toBe(true);
    expect(Position.isEqual(pos1, pos2)).toBe(false);
  });

  describe('distance', () => {
    const pos1 = LSP.Position.create(1, 5);
    const pos2 = LSP.Position.create(3, 10);

    test('character method', () => {
      expect(Position.distance(pos1, pos2)).toBe(165); // Default method
      expect(Position.distance(pos1, pos2, { method: 'character' })).toBe(165);
      expect(Position.distance(pos1, pos2, {
        method: 'character',
        getLineLength: (line) => line === 2 ? 100 : 80,
      })).toBe(185);
    });

    test('manhattan method', () => {
      expect(Position.distance(pos1, pos2, { method: 'manhattan' })).toBe(7);
    });

    test('euclidean method', () => {
      // console.log('euclidean', Position.distance(pos1, pos2, { method: 'euclidean' }));
      expect(Position.distance(pos1, pos2, { method: 'euclidean' })).toBeCloseTo(165.01, 2);
      // console.log('euclidean', Position.distance(pos1, pos2, { method: 'euclidean', averageLineLength: 100 }));
      expect(Position.distance(pos1, pos2, {
        method: 'euclidean',
        averageLineLength: 100,
      })).toBeCloseTo(205.009, 2);
    });

    test('same position', () => {
      expect(Position.distance(pos1, pos1)).toBe(0);
    });

    test('reverse direction', () => {
      // console.log('rev', Position.distance(pos2, pos1));
      expect(Position.distance(pos2, pos1)).toBe(165);
    });

    test('custom getLineLength', () => {
      const getLineLength = jest.fn().mockReturnValue(50);
      Position.distance(pos1, pos2, { getLineLength });
      expect(getLineLength).toHaveBeenCalledTimes(3);
      expect(getLineLength).toHaveBeenCalledWith(1);
      expect(getLineLength).toHaveBeenCalledWith(2);
      expect(getLineLength).toHaveBeenCalledWith(3);
    });

    test('invalid method', () => {
      expect(() => Position.distance(pos1, pos2, { method: 'invalid' as any })).toThrow();
    });
  });
});

describe('Location', () => {
  const loc1 = LSP.Location.create('file:///path/to/file1.ts', LSP.Range.create(1, 2, 3, 4));
  const loc2 = LSP.Location.create('file:///path/to/file2.ts', LSP.Range.create(2, 3, 4, 5));

  test('fromTextSpan', () => {
    const textSpan = { start: { line: 2, offset: 3 }, end: { line: 4, offset: 5 } };
    expect(Location.fromTextSpan('file:///path/to/file.ts', textSpan)).toEqual(
      LSP.Location.create('file:///path/to/file.ts', LSP.Range.create(1, 2, 3, 4)),
    );
  });

  test('compare', () => {
    expect(Location.compare(loc1, loc2)).toBe(-1);
    expect(Location.compare(loc2, loc1)).toBe(1);
    expect(Location.compare(loc1, loc1)).toBe(0);
  });

  test('overlaps', () => {
    const overlappingLoc = LSP.Location.create('file:///path/to/file1.ts', LSP.Range.create(2, 0, 4, 0));
    expect(Location.overlaps(loc1, overlappingLoc)).toBe(true);
    expect(Location.overlaps(loc1, loc2)).toBe(false);
  });

  describe('distance', () => {
    const loc1 = LSP.Location.create('file:///path/to/file1.ts', LSP.Range.create(1, 5, 2, 10));
    const loc2 = LSP.Location.create('file:///path/to/file2.ts', LSP.Range.create(3, 0, 4, 15));
    const loc3 = LSP.Location.create('file:///different/path/file3.ts', LSP.Range.create(1, 0, 1, 5));

    test('distance within same file', () => {
      const sameFileLoc = LSP.Location.create('file:///path/to/file1.ts', LSP.Range.create(3, 0, 4, 15));
      expect(Location.distance(loc1, sameFileLoc)).toBeCloseTo(165.00, 2); // Assuming default Range.distance method
    });

    test('distance between files in same directory', () => {
      const distance = Location.distance(loc1, loc2);
      expect(distance).toBeDefined();
      expect(distance).toBeGreaterThan(1000); // URI distance weight + range distance
    });

    test('distance between files in different directories', () => {
      const distance = Location.distance(loc1, loc3);
      expect(distance).toBeDefined();
      expect(distance).toBeGreaterThan(2000); // Larger URI distance + range distance
    });

    test('distance with custom options', () => {
      const distance = Location.distance(loc1, loc2, {
        rangeDistanceOptions: { method: 'start' },
        uriDistanceWeight: 500,
      });
      const longerDistance = Location.distance(loc1, loc3, {
        rangeDistanceOptions: { method: 'start' },
        uriDistanceWeight: 500,
      });
      // console.log(JSON.stringify({ distance, longerDistance }, null, 2));
      expect(distance).toBeDefined();
      expect(distance).toBe(655);
      expect(longerDistance).toBeDefined();
      expect(longerDistance).toBe(3005);
    });

    test('distance between locations with different schemes', () => {
      const httpLoc = LSP.Location.create('http://example.com/file.ts', LSP.Range.create(1, 0, 1, 5));
      expect(Location.distance(loc1, httpLoc)).toBeUndefined();
    });
  });
});