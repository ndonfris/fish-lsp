import { analyzer, Analyzer } from '../src/analyze';
import { ErrorCodes } from '../src/diagnostics/error-codes';
import { getDiagnostics } from '../src/diagnostics/validate';
import { createFakeLspDocument, setLogger } from './helpers';


describe('Unreachable Code Detection', () => {
  setLogger();

  beforeEach(async () => {
    await Analyzer.initialize();
  });


  it('should detect code after return statement', () => {
    const fishCode = `
function test_func
    return 0
    echo "unreachable"
    set var "also unreachable"
end`;
    const fakeDoc = createFakeLspDocument('config.fish', fishCode);
    const { root } = analyzer.analyze(fakeDoc);

    const diagnostics = getDiagnostics(root, fakeDoc);
    const unreachableDiagnostics = diagnostics.filter(d => d.code === ErrorCodes.unreachableCode);
    expect(unreachableDiagnostics).toHaveLength(2);
  });

  it('should detect code after exit statement', () => {
    const fishCode = `
function test_func
    exit 1
    echo "this will never run"
end`;
    const fakeDoc = createFakeLspDocument('config.fish', fishCode);
    const { root } = analyzer.analyze(fakeDoc);

    const diagnostics = getDiagnostics(root, fakeDoc);
    const unreachableDiagnostics = diagnostics.filter(d => d.code === ErrorCodes.unreachableCode);
    expect(unreachableDiagnostics).toHaveLength(1);
  });

  it('should detect code after complete if-else with returns', () => {
    const fishCode = `
function test_func
    if test $argv[1] = "yes"
        return 0
    else
        return 1
    end
    echo "unreachable after complete if-else"
end`;

    const fakeDoc = createFakeLspDocument('config.fish', fishCode);
    const { root } = analyzer.analyze(fakeDoc);

    const diagnostics = getDiagnostics(root, fakeDoc);
    const unreachableDiagnostics = diagnostics.filter(d => d.code === ErrorCodes.unreachableCode);
    expect(unreachableDiagnostics).toHaveLength(1);
  });

  it('should NOT detect code after incomplete if statement', () => {
    const fishCode = `
function test_func
    if test $argv[1] = "yes"
        return 0
    end
    echo "reachable - no else clause"
end`;

    const fakeDoc = createFakeLspDocument('config.fish', fishCode);
    const { root } = analyzer.analyze(fakeDoc);

    const diagnostics = getDiagnostics(root, fakeDoc);
    const unreachableDiagnostics = diagnostics.filter(d => d.code === ErrorCodes.unreachableCode);
    expect(unreachableDiagnostics).toHaveLength(0);
  });

  it('should detect code after switch with default case', () => {
    const fishCode = `
function test_func
    switch $argv[1]
        case "a"
            return 1
        case "b"
            return 2
        case "*"
            return 0
    end
    echo "unreachable after complete switch"
end`;

    const fakeDoc = createFakeLspDocument('config.fish', fishCode);
    const { root } = analyzer.analyze(fakeDoc);

    const diagnostics = getDiagnostics(root, fakeDoc);
    const unreachableDiagnostics = diagnostics.filter(d => d.code === ErrorCodes.unreachableCode);
    expect(unreachableDiagnostics).toHaveLength(1);
  });

  it('should NOT detect code after incomplete switch', () => {
    const fishCode = `
function test_func
    switch $argv[1]
        case "a"
            return 1
        case "b"
            return 2
    end
    echo "reachable - no default case"
end`;

    const fakeDoc = createFakeLspDocument('config.fish', fishCode);
    const { root } = analyzer.analyze(fakeDoc);

    const diagnostics = getDiagnostics(root, fakeDoc);
    const unreachableDiagnostics = diagnostics.filter(d => d.code === ErrorCodes.unreachableCode);
    expect(unreachableDiagnostics).toHaveLength(0);
  });

  it('should allow comments after terminal statements', () => {
    const fishCode = `
function test_func
    return 0
    # This comment should be allowed
    echo "but this is unreachable"
end`;

    const fakeDoc = createFakeLspDocument('config.fish', fishCode);
    const { root } = analyzer.analyze(fakeDoc);

    const diagnostics = getDiagnostics(root, fakeDoc);
    const unreachableDiagnostics = diagnostics.filter(d => d.code === ErrorCodes.unreachableCode);
    expect(unreachableDiagnostics).toHaveLength(1); // Only the echo statement
  });

  it('should handle break and continue in loops', () => {
    const fishCode = `function test_func
    for i in (seq 10)
        if test "$i" = "5"
            break
            echo "unreachable after break"
        end
        if test "$i" = "3"
            continue
            echo "unreachable after continue"
        end
        echo "this is reachable"
    end
end`;

    const fakeDoc = createFakeLspDocument('config.fish', fishCode);
    const { root } = analyzer.analyze(fakeDoc);

    const diagnostics = getDiagnostics(root, fakeDoc);
    const unreachableDiagnostics = diagnostics.filter(d => d.code === ErrorCodes.unreachableCode);
    expect(unreachableDiagnostics).toHaveLength(2); // after break and after continue
  });


  it('should detect code after switch with default case 2', () => {
    const fishCode = `
function test_func
    switch $argv[1]
        case "a"
            return 1
        case "b"
            return 2
        case \\*
            return 0
    end
    echo "unreachable after complete switch"
end`;

    const fakeDoc = createFakeLspDocument('config.fish', fishCode);
    const { root } = analyzer.analyze(fakeDoc);
    console.log(fishCode);

    const diagnostics = getDiagnostics(root, fakeDoc);
    const unreachableDiagnostics = diagnostics.filter(d => d.code === ErrorCodes.unreachableCode);
    expect(unreachableDiagnostics).toHaveLength(1);
  });

  it('should detect code after conditional execution with and/or', () => {
    const fishCode = `function asdf
  set -q PATH
  and return 1
  or return 0

  echo hi # unreachable 
end`;

    const fakeDoc = createFakeLspDocument('config.fish', fishCode);
    const { root } = analyzer.analyze(fakeDoc);

    const diagnostics = getDiagnostics(root, fakeDoc);
    const unreachableDiagnostics = diagnostics.filter(d => d.code === ErrorCodes.unreachableCode);
    expect(unreachableDiagnostics).toHaveLength(1); // Should detect the echo statement
  });

  it('should NOT detect unreachable code after incomplete conditional execution', () => {
    const fishCode = `function test_func
  set -q PATH
  and return 1
  # no 'or' clause - execution can continue

  echo "this is reachable"
end`;

    const fakeDoc = createFakeLspDocument('config.fish', fishCode);
    const { root } = analyzer.analyze(fakeDoc);

    const diagnostics = getDiagnostics(root, fakeDoc);
    const unreachableDiagnostics = diagnostics.filter(d => d.code === ErrorCodes.unreachableCode);
    expect(unreachableDiagnostics).toHaveLength(0);
  });

//   it('should handle complex conditional chains', () => {
//     const fishCode = `function test_func
//   test -f /some/file
//   and echo "found"
//   and return 0
//   or echo "not found"
//   or return 1
//
//   echo "unreachable because both paths terminate"
// end`;
//
//     const fakeDoc = createFakeLspDocument('config.fish', fishCode);
//     const { root } = analyzer.analyze(fakeDoc);
//
//     const diagnostics = getDiagnostics(root, fakeDoc);
//     const unreachableDiagnostics = diagnostics.filter(d => d.code === ErrorCodes.unreachableCode);
//     expect(unreachableDiagnostics).toHaveLength(1);
//   });

});
