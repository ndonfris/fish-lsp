import { vi } from 'vitest';
import { createTestServer, setLogger, setupStartupMock, type TestServerHandle } from './helpers';
import * as startupConfig from '../src/utils/completion/startup-config';

setupStartupMock();

// Locks in the 5→2 fish-spawn reduction: FishServer.create() must issue exactly
// ONE `runSetupItems()` fish spawn and share its result with both the completion
// map and the documentation cache. If the sharing regresses (each initializer
// fetches its own), this count jumps to 2+.
describe('FishServer.create shares a single runSetupItems() spawn', () => {
  setLogger();

  let handle: TestServerHandle | undefined;

  afterEach(async () => {
    await handle?.shutdown();
    handle = undefined;
    vi.restoreAllMocks();
  });

  it('calls runSetupItems exactly once (completion map + doc cache share it)', async () => {
    const spy = vi.spyOn(startupConfig, 'runSetupItems');

    handle = await createTestServer();

    expect(spy).toHaveBeenCalledTimes(1);
  });
});
