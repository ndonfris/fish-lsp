import { exec } from 'child_process';
import { logger } from './logger';
import { LspDocument } from './document';
import { getEnabledIndentRanges } from './parsing/comments';

export async function formatDocumentContent(content: string): Promise<string> {
  return new Promise((resolve, _reject) => {
    const process = exec('fish_indent', (error, stdout, stderr) => {
      if (error) {
        // reject(stderr);
        logger.log('Formatting Error:', stderr);
      } else {
        resolve(stdout);
      }
    });
    if (process.stdin) {
      process.stdin.write(content);
      process.stdin.end();
    }
  });
}

export async function formatDocumentRangeContent(content: string): Promise<string> {
  return new Promise((resolve, _reject) => {
    const process = exec('fish_indent --only-indent --only-unindent', (error, stdout, stderr) => {
      if (error) {
        // reject(stderr);
        logger.log('Formatting Error:', stderr);
      } else {
        resolve(stdout);
      }
    });
    if (process.stdin) {
      process.stdin.write(content);
      process.stdin.end();
    }
  });
}

interface OriginalRange {
  startMarker: string;
  endMarker: string;
  originalContent: string;
  originalStartComment: string;
  originalEndComment: string;
}

export async function formatDocumentWithIndentComments(doc: LspDocument): Promise<string> {
  const content = doc.getText();
  const formatRanges = getEnabledIndentRanges(doc);

  // If full document formatting is allowed, use regular formatting
  if (formatRanges.fullDocumentFormatting) {
    return formatDocumentContent(content);
  }

  const lines = content.split('\n');

  // Step 1: Replace @fish_indent comments with position markers and collect original content
  const originalRanges: OriginalRange[] = [];
  let modifiedContent = '';
  let currentUnformattedContent = '';
  let isInUnformattedRange = false;
  let rangeId = 0;
  let currentStartMarker = '';
  let currentOriginalStartComment = '';

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line === undefined || line === null) break;
    const trimmedLine = line.trim();
    const isIndentComment = /^#\s*@fish_indent(?::\s*(off|on)?)?$/.test(trimmedLine);
    const hasInlineIndentComment = /#\s*@fish_indent(?::\s*(off|on)?)?/.test(line);

    if (isIndentComment || hasInlineIndentComment) {
      // Extract the @fish_indent directive from either standalone or inline comment
      const match = isIndentComment
        ? trimmedLine.match(/^#\s*@fish_indent(?::\s*(off|on)?)?$/)
        : line.match(/#\s*@fish_indent(?::\s*(off|on)?)?/);
      const directive = match?.[1] || 'on'; // Default to 'on' if no directive specified

      if (directive === 'off' && !isInUnformattedRange) {
        // Start of unformatted range
        isInUnformattedRange = true;
        currentUnformattedContent = '';
        currentStartMarker = `# @fish_indent_marker_start_${rangeId}`;

        if (isIndentComment) {
          // Standalone comment - preserve the whole line as the comment
          currentOriginalStartComment = line;
          modifiedContent += currentStartMarker + '\n';
        } else {
          // Inline comment - the code before the comment should be formatted
          const codeBeforeComment = line.substring(0, line.indexOf('#')).trimEnd();
          currentOriginalStartComment = '# @fish_indent: off'; // Store just the directive

          // Add the code part to formatted content, then start unformatted range
          modifiedContent += codeBeforeComment + '\n';
          modifiedContent += currentStartMarker + '\n';
        }
      } else if (directive === 'on' && isInUnformattedRange) {
        // End of unformatted range
        isInUnformattedRange = false;
        const endMarker = `# @fish_indent_marker_end_${rangeId}`;
        modifiedContent += endMarker + '\n';

        if (!isIndentComment) {
          // Inline comment - add the code part after the marker
          const codeBeforeComment = line.substring(0, line.indexOf('#')).trimEnd();
          if (codeBeforeComment.trim()) {
            modifiedContent += codeBeforeComment + '\n';
          }
        }

        originalRanges.push({
          startMarker: currentStartMarker,
          endMarker,
          originalContent: currentUnformattedContent,
          originalStartComment: currentOriginalStartComment,
          originalEndComment: isIndentComment ? line : '# @fish_indent: on',
        });

        rangeId++;
      } else {
        // Not a directive that changes state, treat as regular line
        if (isInUnformattedRange) {
          currentUnformattedContent += (currentUnformattedContent ? '\n' : '') + line;
        } else {
          modifiedContent += line + '\n';
        }
      }
    } else {
      if (isInUnformattedRange) {
        // Collect original content for later restoration
        currentUnformattedContent += (currentUnformattedContent ? '\n' : '') + line;
      }
      // Always add the line to modifiedContent (it will be formatted if not in unformatted range)
      modifiedContent += line + '\n';
    }
  }

  // Handle case where document ends with an unformatted range (missing @fish_indent: on)
  if (isInUnformattedRange) {
    const endMarker = `# @fish_indent_marker_end_${rangeId}`;
    modifiedContent += endMarker + '\n';
    originalRanges.push({
      startMarker: currentStartMarker,
      endMarker,
      originalContent: currentUnformattedContent,
      originalStartComment: currentOriginalStartComment,
      originalEndComment: '', // No end comment if document ends with unformatted range
    });
  }

  // Step 2: Format the modified content with fish_indent
  const formattedContent = await formatDocumentContent(modifiedContent.trim());

  // Step 3: Restore original unformatted content between markers, including original comments
  let result = formattedContent;

  for (const range of originalRanges) {
    const startIndex = result.indexOf(range.startMarker);
    const endIndex = result.indexOf(range.endMarker);

    if (startIndex !== -1 && endIndex !== -1) {
      // Replace everything between (and including) the markers with original content
      const beforeMarker = result.substring(0, startIndex);
      const afterMarker = result.substring(endIndex + range.endMarker.length);

      // Reconstruct with original comments and content
      // Extract the indentation context from the formatted content around the markers
      const beforeLines = beforeMarker.split('\n');
      const lastFormattedLine = beforeLines[beforeLines.length - 2] || ''; // Line before the marker

      const startIndentation = lastFormattedLine.match(/^(\s*)/)?.[1] || '';

      // For the end comment, we need to determine what indentation level it should have
      // The end comment should maintain the same indentation level as the context it's in
      // In most cases, this should match the start comment's indentation since they're in the same block

      // However, we need to check if we're inside a function or other block structure
      // by looking at the original comment's indentation level
      const originalStartIndent = range.originalStartComment.match(/^(\s*)/)?.[1] || '';

      // Use the original start comment's indentation level for the end comment
      // This preserves the user's intended structure
      const endIndentation = originalStartIndent;

      // Preserve the comment text but adjust indentation to match context
      // Extract original comment content without leading whitespace, but preserve trailing whitespace
      const startCommentText = range.originalStartComment.replace(/^\s*/, '');
      const endCommentText = range.originalEndComment.replace(/^\s*/, '');

      let replacement = startIndentation + startCommentText + '\n';
      if (range.originalContent.trim()) {
        replacement += range.originalContent + '\n';
      }
      if (endCommentText) {
        replacement += endIndentation + endCommentText;
      }

      result = beforeMarker + replacement + afterMarker;
    }
  }

  return result;
}

export async function formatDocumentRangeWithIndentComments(
  doc: LspDocument,
  startLine: number,
  endLine: number,
): Promise<string> {
  // For range formatting, we need to use the same marker-based approach
  // but only apply it to the specific range requested

  // If the range doesn't intersect with any @fish_indent comments,
  // we can use a simpler approach
  const formatRanges = getEnabledIndentRanges(doc);

  if (formatRanges.fullDocumentFormatting) {
    // No @fish_indent comments, just format the range normally
    const content = doc.getText();
    const lines = content.split('\n');
    const rangeLines = lines.slice(startLine, endLine + 1);
    const rangeContent = rangeLines.join('\n');

    const formattedRangeContent = await formatDocumentContent(rangeContent);
    const formattedLines = [...lines];
    const newLines = formattedRangeContent.split('\n');

    // Replace the range, handling potential line count changes
    formattedLines.splice(startLine, endLine - startLine + 1, ...newLines);

    return formattedLines.join('\n');
  }

  // If there are @fish_indent comments, we need to format the entire document
  // using our marker approach, then extract only the requested range
  const fullFormattedContent = await formatDocumentWithIndentComments(doc);
  // const fullFormattedLines = fullFormattedContent.split('\n');

  // Find the corresponding lines in the formatted content
  // This is tricky because line numbers may have changed due to fish_indent
  // For now, return the full formatted content (which preserves all functionality)
  // A more sophisticated approach would map the original range to the formatted range

  return fullFormattedContent;
}
