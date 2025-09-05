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

export async function formatDocumentWithIndentComments(doc: LspDocument): Promise<string> {
  const content = doc.getText();
  const formatRanges = getEnabledIndentRanges(doc);

  // If full document formatting is allowed, use regular formatting
  if (formatRanges.fullDocumentFormatting) {
    return formatDocumentContent(content);
  }

  // Split content into lines for processing
  const lines = content.split('\n');
  const formattedLines = [...lines]; // Clone array

  // Format each allowed range
  for (const range of formatRanges.formatRanges) {
    if (range.start > range.end || range.start < 0 || range.end >= lines.length) {
      continue; // Skip invalid ranges
    }

    // Extract the range content
    const rangeLines = lines.slice(range.start, range.end + 1);
    const rangeContent = rangeLines.join('\n');

    try {
      // Format the range content
      const formattedRangeContent = await formatDocumentContent(rangeContent);
      const formattedRangeLines = formattedRangeContent.split('\n');

      // Replace the original lines with formatted ones
      for (let i = 0; i < formattedRangeLines.length && i < rangeLines.length; i++) {
        formattedLines[range.start + i] = formattedRangeLines[i];
      }
    } catch (error) {
      logger.log('Error formatting range:', error);
      // Keep original content for this range on error
    }
  }

  return formattedLines.join('\n');
}

export async function formatDocumentRangeWithIndentComments(
  doc: LspDocument,
  startLine: number,
  endLine: number,
): Promise<string> {
  const content = doc.getText();
  const formatRanges = getEnabledIndentRanges(doc);

  // Check if the requested range intersects with any allowed formatting ranges
  const allowedRanges = formatRanges.formatRanges.filter(range =>
    !(range.end < startLine || range.start > endLine),
  );

  if (allowedRanges.length === 0) {
    // No intersection with allowed ranges - return original content
    return content;
  }

  // Split content into lines
  const lines = content.split('\n');
  const formattedLines = [...lines];

  // Format only the intersecting allowed ranges within the requested range
  for (const allowedRange of allowedRanges) {
    const actualStart = Math.max(startLine, allowedRange.start);
    const actualEnd = Math.min(endLine, allowedRange.end);

    if (actualStart <= actualEnd) {
      const rangeLines = lines.slice(actualStart, actualEnd + 1);
      const rangeContent = rangeLines.join('\n');

      try {
        const formattedRangeContent = await formatDocumentRangeContent(rangeContent);
        const formattedRangeLines = formattedRangeContent.split('\n');

        for (let i = 0; i < formattedRangeLines.length && i < rangeLines.length; i++) {
          formattedLines[actualStart + i] = formattedRangeLines[i];
        }
      } catch (error) {
        logger.log('Error formatting range:', error);
      }
    }
  }

  return formattedLines.join('\n');
}
