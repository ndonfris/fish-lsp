
// @see $HOME/repos/typescript-language-server/src/utils/typeConverters.ts 
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
        GetOutliningSpans = "getOutliningSpans",
        GetSpanOfEnclosingComment = "getSpanOfEnclosingComment",
        Rename = "rename",
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
        Comment = "comment",
        /** Sections marked by '// #region' and '// #endregion' comments */
        Region = "region",
        /** Declarations and expressions */
        Code = "code",
        /** Contiguous blocks of import declarations */
        Imports = "imports"
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
        type: "request";
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
        type: "request" | "response" | "event";
    }
    
    /////////////////////////////////////////////////////////////////////////////////////
    /////////////////////////////////////////////////////////////////////////////////////
    /////////////////////////////////////////////////////////////////////////////////////

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



}

