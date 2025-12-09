import { Diagnostic, DocumentUri } from 'vscode-languageserver';
import { analyzer } from '../analyze';
import { documents, LineSpan, rangeOverlapsLineSpan } from '../document';
import { configHandlers } from '../config';
import { getDiagnosticsAsync } from './validate';
import { connection } from '../utils/startup';
import { logger } from '../logger';
import { config } from '../config';

/**
 * Buffered async diagnostic cache that:
 * 1. Debounces diagnostic updates to avoid recalculating on every keystroke
 * 2. Processes diagnostics asynchronously with yielding to avoid blocking main thread
 * 3. Supports cancellation of outdated diagnostic calculations
 * 4. Automatically sends diagnostics to the client when ready
 *
 * This provides a significant performance improvement over the synchronous
 * DiagnosticCache, especially for large documents.
 */
export class BufferedAsyncDiagnosticCache {
  private cache: Map<DocumentUri, Diagnostic[]> = new Map();
  private pendingCalculations: Map<DocumentUri, AbortController> = new Map();
  private debounceTimers: Map<DocumentUri, NodeJS.Timeout> = new Map();

  // Debounce delay in milliseconds
  // Diagnostics won't run until user stops typing for this duration
  private readonly DEBOUNCE_MS = 400;

  /**
   * Request a diagnostic update for a document.
   * If immediate=false, the update will be debounced.
   * If immediate=true, the update runs right away.
   *
   * @param uri - Document URI to update diagnostics for
   * @param immediate - If true, skip debouncing and run immediately
   */
  requestUpdate(uri: DocumentUri, immediate = false, changedSpan?: LineSpan): void {
    logger.debug({
      message: 'BufferedAsyncDiagnosticCache: Requesting diagnostic update',
      uri,
      immediate,
      changedSpan: {
        start: changedSpan?.start,
        end: changedSpan?.end,
        isFullDocument: changedSpan?.isFullDocument || false,
      },
      diagnostics: this.cache.get(uri)?.map(d => ({
        code: d.code,
        range: d.range.start.line + '-' + d.range.end.line,
      })),
      diagnosticsPending: this.isPending(uri),
      debounceTimer: {
        timer: this.debounceTimers.get(uri),
        has: this.debounceTimers.has(uri),
      },
    });
    if (config.fish_lsp_disabled_handlers.includes('diagnostic')) {
      return;
    }
    // Log the change span for debugging purposes
    if (changedSpan && !changedSpan.isFullDocument) {
      const prev = this.cache.get(uri);
      if (prev && prev.length > 0) {
        const filtered = prev.filter(
          (d) => !rangeOverlapsLineSpan(d.range, changedSpan, 1),
        );
        if (filtered.length !== prev.length && filtered.length > 0) {
          // We removed at least one diagnostic in the edited area.
          // Update cache & immediately send the reduced set so UI clears.
          this.cache.set(uri, filtered);
          connection.sendDiagnostics({ uri, diagnostics: filtered });

          logger.debug(
            'BufferedAsyncDiagnosticCache: Optimistically cleared stale diagnostics in edited span',
            { uri, removed: prev.length - filtered.length },
          );
        }
      }
    }

    // Clear any existing debounce timer for this URI
    const existingTimer = this.debounceTimers.get(uri);
    if (existingTimer) {
      clearTimeout(existingTimer);
      this.debounceTimers.delete(uri);
      logger.debug('BufferedAsyncDiagnosticCache: Cleared existing debounce timer', { uri });
    }

    if (immediate) {
      // Run immediately without debouncing
      this.update(uri);
    } else {
      // Debounce: wait DEBOUNCE_MS before running
      const timer = setTimeout(() => {
        this.update(uri);
        this.debounceTimers.delete(uri);
      }, this.DEBOUNCE_MS);

      this.debounceTimers.set(uri, timer);
    }
  }

  /**
   * Internal method to actually compute and update diagnostics.
   * Cancels any pending calculation for the same URI before starting a new one.
   *
   * @param uri - Document URI to compute diagnostics for
   */
  private async update(uri: DocumentUri): Promise<void> {
    // Cancel any existing diagnostic calculation for this URI
    const existingController = this.pendingCalculations.get(uri);
    if (existingController) {
      existingController.abort();
      this.pendingCalculations.delete(uri);
    }

    // Check if diagnostics are disabled
    if (!configHandlers.diagnostic) {
      connection.sendDiagnostics({ uri, diagnostics: [] });
      return;
    }

    const doc = documents.get(uri);
    if (!doc) {
      logger.debug('BufferedAsyncDiagnosticCache: Document not found', { uri });
      connection.sendDiagnostics({ uri, diagnostics: [] });
      return;
    }

    const cachedDoc = analyzer.ensureCachedDocument(doc);
    if (!cachedDoc?.root) {
      logger.debug('BufferedAsyncDiagnosticCache: Document has no syntax tree', { uri });
      connection.sendDiagnostics({ uri, diagnostics: [] });
      return;
    }

    // Create abort controller for this calculation
    // This allows us to cancel if the document changes again
    const controller = new AbortController();
    this.pendingCalculations.set(uri, controller);

    try {
      // Run async diagnostic calculation (non-blocking!)
      // This will yield to the event loop periodically
      const diagnostics = await getDiagnosticsAsync(
        cachedDoc.root,
        doc,
        controller.signal,
      );

      // Check if the calculation was aborted while running
      if (controller.signal.aborted) {
        logger.debug('BufferedAsyncDiagnosticCache: Calculation was cancelled', { uri });
        connection.sendDiagnostics({ uri, diagnostics: [] });
        return;
      }

      // Update cache
      this.cache.set(uri, diagnostics);

      // Send diagnostics to client
      connection.sendDiagnostics({ uri, diagnostics });

      logger.debug('BufferedAsyncDiagnosticCache: Diagnostics updated', {
        uri,
        count: diagnostics.length,
      });
    } catch (error) {
      // Only log errors if the calculation wasn't aborted
      if (!controller.signal.aborted) {
        logger.error('BufferedAsyncDiagnosticCache: Error calculating diagnostics', {
          uri,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    } finally {
      // Clean up the pending calculation
      this.pendingCalculations.delete(uri);
    }
  }

  /**
   * Delete diagnostics for a document.
   * Cancels any pending calculations and clears cached diagnostics.
   * Sends empty diagnostics array to client to clear UI.
   *
   * @param uri - Document URI to delete diagnostics for
   */
  delete(uri: DocumentUri): void {
    // Cancel debounce timer if exists
    const timer = this.debounceTimers.get(uri);
    if (timer) {
      clearTimeout(timer);
      this.debounceTimers.delete(uri);
    }

    // Cancel pending calculation if exists
    const controller = this.pendingCalculations.get(uri);
    if (controller) {
      controller.abort();
      this.pendingCalculations.delete(uri);
    }

    // Remove from cache
    this.cache.delete(uri);

    // Clear diagnostics in client UI
    connection.sendDiagnostics({ uri, diagnostics: [] });

    logger.debug('BufferedAsyncDiagnosticCache: Diagnostics deleted', { uri });
  }

  /**
   * Clear all diagnostics.
   * Cancels all pending calculations and timers.
   */
  clear(): void {
    // Cancel all debounce timers
    this.debounceTimers.forEach(timer => clearTimeout(timer));
    this.debounceTimers.clear();

    // Cancel all pending calculations
    this.pendingCalculations.forEach(controller => controller.abort());
    this.pendingCalculations.clear();

    // Clear cache
    this.cache.clear();

    logger.debug('BufferedAsyncDiagnosticCache: All diagnostics cleared');
  }

  /**
   * Get cached diagnostics for a document.
   * Returns undefined if not cached.
   * Note: This returns the cached value immediately, it does not trigger computation.
   *
   * @param uri - Document URI to get diagnostics for
   * @returns Cached diagnostics or undefined
   */
  get(uri: DocumentUri): Diagnostic[] | undefined {
    return this.cache.get(uri);
  }

  /**
   * Check if a document has cached diagnostics.
   *
   * @param uri - Document URI to check
   * @returns true if diagnostics are cached
   */
  has(uri: DocumentUri): boolean {
    return this.cache.has(uri);
  }

  /**
   * Get the number of pending diagnostic calculations.
   * Useful for debugging or status indicators.
   *
   * @returns Number of documents with pending calculations
   */
  get pendingCount(): number {
    return this.pendingCalculations.size;
  }

  /**
   * Check if diagnostics are currently being calculated for a document.
   *
   * @param uri - Document URI to check
   * @returns true if diagnostics are being calculated
   */
  isPending(uri: DocumentUri): boolean {
    return this.pendingCalculations.has(uri);
  }
}
