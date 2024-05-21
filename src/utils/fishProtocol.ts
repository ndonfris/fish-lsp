// @see $HOME/repos/typescript-language-server/src/utils/typeConverters.ts

import { CodeAction } from 'vscode-languageserver';

// @see $HOME/repos/typescript-language-server/node_modules/typescript/lib/protocol.d.ts

/**
 * OUTLINE Protocol types in this namespace
 *      (i.e., format client options, CommandNames, etc.)
 *
 *
 */

export declare namespace FishProtocol {
  /////////////////////////////////////////////////////////////////////////////////////
  // COMMANDS
  /////////////////////////////////////////////////////////////////////////////////////
  const enum CommandTypes {
    GetOutliningSpans = 'getOutliningSpans',
    GetSpanOfEnclosingComment = 'getSpanOfEnclosingComment',
    Rename = 'rename',
    GetCodeFixes = 'getCodeFixes',
    GetCombinedCodeFix = 'getCombinedCodeFix',
    GetApplicableRefactors = 'getApplicableRefactors',
  }

  enum ScriptElementKind {
    unknown = '',
    warning = 'warning',
    /** predefined type (void) or keyword (class) */
    keyword = 'keyword',
    /** top level script node */
    scriptElement = 'script',
    /** module foo {} */
    moduleElement = 'module',
    /** class X {} */
    classElement = 'class',
    /** var x = class X {} */
    localClassElement = 'local class',
    /** interface Y {} */
    interfaceElement = 'interface',
    /** type T = ... */
    typeElement = 'type',
    /** enum E */
    enumElement = 'enum',
    enumMemberElement = 'enum member',
    /**
         * Inside module and script only
         * const v = ..
         */
    variableElement = 'var',
    /** Inside function */
    localVariableElement = 'local var',
    /**
         * Inside module and script only
         * function f() { }
         */
    functionElement = 'function',
    /** Inside function */
    localFunctionElement = 'local function',
    /** class X { [public|private]* foo() {} } */
    memberFunctionElement = 'method',
    /** class X { [public|private]* [get|set] foo:number; } */
    memberGetAccessorElement = 'getter',
    memberSetAccessorElement = 'setter',
    /**
         * class X { [public|private]* foo:number; }
         * interface Y { foo:number; }
         */
    memberVariableElement = 'property',
    /**
         * class X { constructor() { } }
         * class X { static { } }
         */
    constructorImplementationElement = 'constructor',
    /** interface Y { ():number; } */
    callSignatureElement = 'call',
    /** interface Y { []:number; } */
    indexSignatureElement = 'index',
    /** interface Y { new():Y; } */
    constructSignatureElement = 'construct',
    /** function foo(*Y*: string) */
    parameterElement = 'parameter',
    typeParameterElement = 'type parameter',
    primitiveType = 'primitive type',
    label = 'label',
    alias = 'alias',
    constElement = 'const',
    letElement = 'let',
    directory = 'directory',
    externalModuleName = 'external module name',
    /**
         * <JsxTagName attribute1 attribute2={0} />
         * @deprecated
         */
    jsxAttribute = 'JSX attribute',
    /** String literal */
    string = 'string',
    /** Jsdoc @link: in `{@link C link text}`, the before and after text "{@link " and "}" */
    link = 'link',
    /** Jsdoc @link: in `{@link C link text}`, the entity name "C" */
    linkName = 'link name',
    /** Jsdoc @link: in `{@link C link text}`, the link text "link text" */
    linkText = 'link text',
  }

  /////////////////////////////////////////////////////////////////////////////////////
  // LOCATION INTERFACEs
  /////////////////////////////////////////////////////////////////////////////////////

  /**
     * Object found in response messages defining a span of text in source code.
     */
  interface TextSpan {
    /**
         * First character of the definition.
         */
    start: Location;
    /**
         * One character past last character of the definition.
         */
    end: Location;
  }

  /**
     * Object found in response messages defining a span of text in a specific source file.
     */
  interface FileSpan extends TextSpan {
    /**
         * File containing text span.
         */
    file: string;
  }

  interface TextSpanWithContext extends TextSpan {
    contextStart?: Location;
    contextEnd?: Location;
  }

  interface Location {
    line: number;
    offset: number;
  }

  /**
     * Request to obtain outlining spans in file.
     */
  interface OutliningSpansRequest extends FileRequest {
    command: CommandTypes.GetOutliningSpans;
  }

  enum OutliningSpanKind {
    /** Single or multi-line comments */
    Comment = 'comment',
    /** Sections marked by '// #region' and '// #endregion' comments */
    Region = 'region',
    /** Declarations and expressions */
    Code = 'code',
    /** Contiguous blocks of import declarations */
    Imports = 'imports',
  }

  interface OutliningSpan {
    /** The span of the document to actually collapse. */
    textSpan: TextSpan;
    /** The span of the document to display when the user hovers over the collapsed span. */
    hintSpan: TextSpan;
    /** The text to display in the editor for the collapsed region. */
    bannerText: string;
    /**
         * Whether or not this region should be automatically collapsed when
         * the 'Collapse to Definitions' command is invoked.
         */
    autoCollapse: boolean;
    /**
         * Classification of the contents of the span
         */
    kind: OutliningSpanKind;
  }

  /////////////////////////////////////////////////////////////////////////////////////
  // FORMATTING INTERFACEs
  /////////////////////////////////////////////////////////////////////////////////////
  interface EditorSettings {
    baseIndentSize?: number;
    indentSize?: number;
    tabSize?: number;
    newLineCharacter?: string;
    convertTabsToSpaces?: boolean;
    trimTrailingWhitespace?: boolean;
  }

  interface FormatCodeSettings extends EditorSettings {
    insertSpaceAfterCommaDelimiter?: boolean;
    insertSpaceAfterSemicolonInForStatements?: boolean;
    insertSpaceBeforeAndAfterBinaryOperators?: boolean;
    insertSpaceAfterConstructor?: boolean;
    insertSpaceAfterKeywordsInControlFlowStatements?: boolean;
    insertSpaceAfterFunctionKeywordForAnonymousFunctions?: boolean;
    insertSpaceAfterOpeningAndBeforeClosingEmptyBraces?: boolean;
    insertSpaceAfterOpeningAndBeforeClosingNonemptyParenthesis?: boolean;
    insertSpaceAfterOpeningAndBeforeClosingNonemptyBrackets?: boolean;
    insertSpaceAfterOpeningAndBeforeClosingNonemptyBraces?: boolean;
    insertSpaceAfterOpeningAndBeforeClosingTemplateStringBraces?: boolean;
    insertSpaceAfterOpeningAndBeforeClosingJsxExpressionBraces?: boolean;
    insertSpaceAfterTypeAssertion?: boolean;
    insertSpaceBeforeFunctionParenthesis?: boolean;
    placeOpenBraceOnNewLineForFunctions?: boolean;
    placeOpenBraceOnNewLineForControlBlocks?: boolean;
    insertSpaceBeforeTypeAnnotation?: boolean;
  }
  /////////////////////////////////////////////////////////////////////////////////////
  // FileRequest INTERFACEs (for commands)
  /////////////////////////////////////////////////////////////////////////////////////

  /**
     * Arguments for FileRequest messages.
     */
  interface FileRequestArgs {
    /**
         * The file for the request (absolute pathname required).
         */
    file: string;
    projectFileName?: string;
  }

  interface FileRangeRequestArgs extends FileRequestArgs {
    /**
         * The line number for the request (1-based).
         */
    startLine: number;
    /**
         * The character offset (on the line) for the request (1-based).
         */
    startOffset: number;
    /**
         * The line number for the request (1-based).
         */
    endLine: number;
    /**
         * The character offset (on the line) for the request (1-based).
         */
    endOffset: number;
  }

  /**
     * Request whose sole parameter is a file name.
     */
  interface FileRequest extends Request {
    arguments: FileRequestArgs;
  }

  /**
     * A request whose arguments specify a file location (file, line, col).
     */
  interface FileLocationRequest extends FileRequest {
    arguments: FileLocationRequestArgs;
  }

  interface FileLocationRequestArgs extends FileRequestArgs {
    /**
         * The line number for the request (1-based).
         */
    line: number;
    /**
         * The character offset (on the line) for the request (1-based).
         */
    offset: number;
  }

  interface FormatRequestArgs extends FileLocationRequestArgs {
    /**
         * Last line of range for which to format text in file.
         */
    endLine: number;
    /**
         * Character offset on last line of range for which to format text in file.
         */
    endOffset: number;
    /**
         * Format options to be used.
         */
    options?: FormatCodeSettings;
  }

  /**
     * Request whose sole parameter is a file name.
     */
  interface FileRequest extends Request {
    arguments: FileRequestArgs;
  }

  /**
     * Client-initiated request message
     */
  interface Request extends Message {
    type: 'request';
    /**
         * The command to execute
         */
    command: string;
    /**
         * Object containing arguments for the command
         */
    arguments?: any;
  }

  /**
     * A Fish Server message
     */
  interface Message {
    /**
         * Sequence number of the message
         */
    seq: number;
    /**
         * One of "request", "response", or "event"
         */
    type: 'request' | 'response' | 'event';
  }

  /**
     * Response by server to client request message.
     */
  interface Response extends Message {
    type: 'response';
    /**
         * Sequence number of the request message.
         */
    request_seq: number;
    /**
         * Outcome of the request.
         */
    success: boolean;
    /**
         * The command requested.
         */
    command: string;
    /**
         * If success === false, this should always be provided.
         * Otherwise, may (or may not) contain a success message.
         */
    message?: string;
    /**
         * Contains message body if success === true.
         */
    body?: any;
    /**
         * Contains extra information that plugin can include to be passed on
         */
    metadata?: unknown;
    /**
         * Exposes information about the performance of this request-response pair.
         */
    //performanceData?: PerformanceData;
  }
  /////////////////////////////////////////////////////////////////////////////////////
  /////////////////////////////////////////////////////////////////////////////////////
  /////////////////////////////////////////////////////////////////////////////////////

  interface CodeEdit {
    /**
         * First character of the text span to edit.
         */
    start: Location;
    /**
         * One character past last character of the text span to edit.
         */
    end: Location;
    /**
         * Replace the span defined above with this string (may be
         * the empty string).
         */
    newText: string;
  }
  interface FileCodeEdits {
    fileName: string;
    textChanges: CodeEdit[];
  }

  /**
     * Rename request; value of command field is "rename". Return
     * response giving the file locations that reference the symbol
     * found in file at location line, col. Also return full display
     * name of the symbol so that client can print it unambiguously.
     */
  interface RenameRequest extends FileLocationRequest {
    command: CommandTypes.Rename;
    arguments: FileLocationRequestArgs;
  }

  /**
     *  A group of text spans, all in 'file'.
     */
  interface SpanGroup {
    /** The file to which the spans apply */
    file: string;
    /** The text spans in this group */
    locs: RenameTextSpan[];
  }
  interface RenameTextSpan extends TextSpanWithContext {
    readonly prefixText?: string;
    readonly suffixText?: string;
  }

    type RenameInfo = RenameInfoSuccess | RenameInfoFailure;
    interface RenameInfoSuccess {
      /**
         * True if item can be renamed.
         */
      canRename: true;
      /**
         * File or directory to rename.
         * If set, `getEditsForFileRename` should be called instead of `findRenameLocations`.
         */
      fileToRename?: string;
      /**
         * Display name of the item to be renamed.
         */
      displayName: string;
      /**
         * Full display name of item to be renamed.
         */
      fullDisplayName: string;
      /**
         * The items's kind (such as 'className' or 'parameterName' or plain 'text').
         */
      kind: ScriptElementKind;
      /**
         * Optional modifiers for the kind (such as 'public').
         */
      kindModifiers: string;
      /** Span of text to rename. */
      triggerSpan: TextSpan;
    }
    interface RenameInfoFailure {
      canRename: false;
      /**
         * Error message if item can not be renamed.
         */
      localizedErrorMessage: string;
    }
    interface RenameResponseBody {
      /**
         * Information about the item to be renamed.
         */
      info: RenameInfo;
      /**
         * An array of span groups (one per file) that refer to the item to be renamed.
         */
      locs: readonly SpanGroup[];
    }
    /**
     * Rename response message.
     */
    interface RenameResponse extends Response {
      body?: RenameResponseBody;
    }
    /**
     * Request refactorings at a given position or selection area.
     */
    type FileLocationOrRangeRequestArgs = FileLocationRequestArgs | FileRangeRequestArgs;
    interface GetApplicableRefactorsRequest extends Request {
      command: CommandTypes.GetApplicableRefactors;
      arguments: GetApplicableRefactorsRequestArgs;
    }
    type GetApplicableRefactorsRequestArgs = FileLocationOrRangeRequestArgs & {
      triggerReason?: RefactorTriggerReason;
      kind?: string;
    };
    type RefactorTriggerReason = 'implicit' | 'invoked';
    /**
     * A set of one or more available refactoring actions, grouped under a parent refactoring.
     */
    interface ApplicableRefactorInfo {
      /**
         * The programmatic name of the refactoring
         */
      name: string;
      /**
         * A description of this refactoring category to show to the user.
         * If the refactoring gets inlined (see below), this text will not be visible.
         */
      description: string;
      /**
         * Inlineable refactorings can have their actions hoisted out to the top level
         * of a context menu. Non-inlineanable refactorings should always be shown inside
         * their parent grouping.
         *
         * If not specified, this value is assumed to be 'true'
         */
      inlineable?: boolean;
      actions: RefactorActionInfo[];
    }
    /**
     * Represents a single refactoring action - for example, the "Extract Method..." refactor might
     * offer several actions, each corresponding to a surround class or closure to extract into.
     */
    interface RefactorActionInfo {
      /**
         * The programmatic name of the refactoring action
         */
      name: string;
      /**
         * A description of this refactoring action to show to the user.
         * If the parent refactoring is inlined away, this will be the only text shown,
         * so this description should make sense by itself if the parent is inlineable=true
         */
      description: string;
      /**
         * A message to show to the user if the refactoring cannot be applied in
         * the current context.
         */
      notApplicableReason?: string;
      /**
         * The hierarchical dotted name of the refactor action.
         */
      kind?: string;
    }
    interface GetApplicableRefactorsResponse extends Response {
      body?: ApplicableRefactorInfo[];
    }
    /**
     * Response is a list of available refactorings.
     * Each refactoring exposes one or more "Actions"; a user selects one action to invoke a refactoring
     */

    interface FileSpanWithContext extends FileSpan, TextSpanWithContext {}
    interface DefinitionInfo extends FileSpanWithContext {
      /**
         * When true, the file may or may not exist.
         */
      unverified?: boolean;
    }

    interface CodeAction {
      /** Description of the code action to display in the UI of the editor */
      description: string;
      /** Text changes to apply to each file as part of the code action */
      changes: FileCodeEdits[];
      /** A command is an opaque object that should be passed to `ApplyCodeActionCommandRequestArgs` without modification.  */
      commands?: object[];
    }

    /**
     * Instances of this interface specify errorcodes on a specific location in a sourcefile.
     */
    interface CodeFixRequestArgs extends FileRangeRequestArgs {
      /**
         * Errorcodes we want to get the fixes for.
         */
      errorCodes: readonly number[];
    }
    interface GetCombinedCodeFixRequestArgs {
      scope: GetCombinedCodeFixScope;
      fixId: object;
    }
    interface GetCombinedCodeFixScope {
      type: 'file';
      args: FileRequestArgs;
    }
    interface GetCodeFixesResponse extends Response {
      body?: CodeAction[];
    }

}
