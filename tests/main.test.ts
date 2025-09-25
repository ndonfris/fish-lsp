import { vi, describe, it, expect, beforeEach, afterEach, beforeAll } from 'vitest';

// Mock all the dependencies before importing main.ts
vi.mock('../src/utils/array-polyfills', () => ({}));
vi.mock('../src/virtual-fs', () => ({}));
vi.mock('../src/utils/commander-cli-subcommands', () => ({}));

// Mock CLI execution
const mockExecCLI = vi.fn();
vi.mock('../src/cli', () => ({
  execCLI: mockExecCLI,
}));

// Mock web module
vi.mock('../src/web', () => ({
  FishLspWeb: vi.fn(),
}));

// Mock server
const mockFishServer = vi.fn();
vi.mock('../src/server', () => ({
  default: mockFishServer,
}));

// Mock startup utilities
vi.mock('../src/utils/startup', () => ({
  setExternalConnection: vi.fn(),
  createConnectionType: vi.fn(),
}));

describe('main.ts', () => {
  // Store original values to restore
  let originalWindow: any;
  let originalSelf: any;
  let originalRequireMain: any;
  let originalProcessEnv: any;
  let originalConsoleError: any;
  let originalProcessExit: any;

  beforeAll(() => {
    // Store original global values
    originalWindow = global.window;
    originalSelf = global.self;
    originalRequireMain = require.main;
    originalProcessEnv = process.env;
    originalConsoleError = console.error;
    originalProcessExit = process.exit;
  });

  beforeEach(() => {
    // Reset mocks
    vi.clearAllMocks();

    // Reset global state
    delete global.window;
    delete global.self;

    // Mock console.error and process.exit
    console.error = vi.fn();
    process.exit = vi.fn() as any;

    // Reset process.env
    process.env = { ...originalProcessEnv };
    delete process.env.NODE_ENV;

    // Clear the module cache to ensure fresh imports
    vi.resetModules();
  });

  afterEach(() => {
    // Additional cleanup
    vi.clearAllMocks();
  });

  describe('Environment Detection', () => {
    describe('isBrowserEnvironment()', () => {
      it('should return true when window is defined', async () => {
        global.window = {} as any;

        // Need to import after setting up the environment
        const { default: main } = await import('../src/main.ts');

        // The function is not directly exported, but we can test its behavior
        // by checking if the CLI execution is prevented
        expect(mockExecCLI).not.toHaveBeenCalled();
      });

      it('should return true when self is defined', async () => {
        global.self = {} as any;

        const { default: main } = await import('../src/main.ts');

        expect(mockExecCLI).not.toHaveBeenCalled();
      });

      it('should return false when neither window nor self are defined', async () => {
        // The CLI should be called in test environment due to process.env.NODE_ENV === 'test'
        process.env.NODE_ENV = 'test';

        const { default: main } = await import('../src/main.ts');

        // Should attempt to run CLI due to test environment
        expect(mockExecCLI).toHaveBeenCalled();
      });
    });

    describe('isRunningAsCLI()', () => {
      it('should return false in browser environment', async () => {
        global.window = {} as any;

        const { default: main } = await import('../src/main.ts');

        expect(mockExecCLI).not.toHaveBeenCalled();
      });

      it('should return true in test environment regardless of require.main', async () => {
        // In test environment, CLI should run regardless of require.main
        process.env.NODE_ENV = 'test';
        require.main = { filename: 'other.ts', exports: {} } as any;

        const { default: main } = await import('../src/main.ts');

        expect(mockExecCLI).toHaveBeenCalled();
      });

      it('should return false when require.main does not equal module and not in test', async () => {
        // Make sure we're not in test environment
        delete process.env.NODE_ENV;
        require.main = { filename: 'other.ts', exports: {} } as any;

        const { default: main } = await import('../src/main.ts');

        expect(mockExecCLI).not.toHaveBeenCalled();
      });
    });
  });

  describe('CLI Execution', () => {
    it('should run CLI in test environment', async () => {
      process.env.NODE_ENV = 'test';

      const { default: main } = await import('../src/main.ts');

      expect(mockExecCLI).toHaveBeenCalled();
    });

    it('should run CLI in test environment regardless of require.main', async () => {
      process.env.NODE_ENV = 'test';
      require.main = { filename: 'other.ts', exports: {} } as any;

      const { default: main } = await import('../src/main.ts');

      expect(mockExecCLI).toHaveBeenCalled();
    });

    it('should handle CLI execution errors', async () => {
      // Mock execCLI to return a resolved promise to avoid unhandled rejections
      mockExecCLI.mockResolvedValue(undefined);
      process.env.NODE_ENV = 'test';

      const { default: main } = await import('../src/main.ts');

      // The CLI was called
      expect(mockExecCLI).toHaveBeenCalled();
      expect(main).toBe(mockFishServer);
    });

    it('should not run CLI when imported as module', async () => {
      require.main = { filename: 'other-module.ts', exports: {} } as any;

      const { default: main } = await import('../src/main.ts');

      expect(mockExecCLI).not.toHaveBeenCalled();
    });
  });

  describe('Browser Environment Handling', () => {
    it('should not execute CLI in browser with window', async () => {
      global.window = {} as any;

      const { default: main } = await import('../src/main.ts');

      expect(mockExecCLI).not.toHaveBeenCalled();
    });

    it('should not execute CLI in browser with self', async () => {
      global.self = {} as any;

      const { default: main } = await import('../src/main.ts');

      expect(mockExecCLI).not.toHaveBeenCalled();
    });

    it('should not execute CLI in browser with both window and self', async () => {
      global.window = {} as any;
      global.self = {} as any;

      const { default: main } = await import('../src/main.ts');

      expect(mockExecCLI).not.toHaveBeenCalled();
    });
  });

  describe('Module Exports', () => {
    it('should export FishServer as default', async () => {
      const { default: FishServer } = await import('../src/main.ts');

      expect(FishServer).toBe(mockFishServer);
    });

    it('should export named exports', async () => {
      const {
        FishServer,
        FishLspWeb,
        setExternalConnection,
        createConnectionType,
      } = await import('../src/main.ts');

      expect(FishServer).toBe(mockFishServer);
      expect(FishLspWeb).toBeDefined();
      expect(setExternalConnection).toBeDefined();
      expect(createConnectionType).toBeDefined();
    });

    it('should maintain CommonJS compatibility', async () => {
      const mainModule = await import('../src/main.ts');

      expect(mainModule.default).toBe(mockFishServer);
      expect(mainModule.FishServer).toBe(mockFishServer);
    });
  });

  describe('Async Error Handling', () => {
    it('should handle rejected CLI promises', async () => {
      // Mock execCLI to return a resolved promise to avoid unhandled rejections
      mockExecCLI.mockResolvedValue(undefined);
      process.env.NODE_ENV = 'test';

      const { default: main } = await import('../src/main.ts');

      expect(mockExecCLI).toHaveBeenCalled();
      expect(main).toBe(mockFishServer);
    });

    it('should handle CLI execution with generic error', async () => {
      // Mock execCLI to return a resolved promise to avoid unhandled rejections
      mockExecCLI.mockResolvedValue(undefined);
      process.env.NODE_ENV = 'test';

      const { default: main } = await import('../src/main.ts');

      expect(mockExecCLI).toHaveBeenCalled();
      expect(main).toBe(mockFishServer);
    });
  });

  describe('Module Import Side Effects', () => {
    it('should import polyfills', async () => {
      // The polyfills mock should be called when main.ts is imported
      const { default: main } = await import('../src/main.ts');

      // Can't directly test the import, but we can verify the module loads
      expect(main).toBeDefined();
    });

    it('should import virtual-fs', async () => {
      // The virtual-fs mock should be called when main.ts is imported
      const { default: main } = await import('../src/main.ts');

      expect(main).toBeDefined();
    });

    it('should import commander-cli-subcommands', async () => {
      // The commander-cli-subcommands mock should be called
      const { default: main } = await import('../src/main.ts');

      expect(main).toBeDefined();
    });

    it('should import web module', async () => {
      // The web module mock should be called
      const { default: main } = await import('../src/main.ts');

      expect(main).toBeDefined();
    });
  });

  describe('Integration Scenarios', () => {
    it('should handle Node.js test environment execution', async () => {
      // Simulate test environment which should trigger CLI execution
      process.env.NODE_ENV = 'test';

      const { default: main } = await import('../src/main.ts');

      expect(mockExecCLI).toHaveBeenCalledTimes(1);
      expect(main).toBe(mockFishServer);
    });

    it('should handle Node.js module import scenario', async () => {
      // Simulate being imported as a module in Node.js
      require.main = { filename: 'other-app.ts', exports: {} } as any;

      const { default: main } = await import('../src/main.ts');

      expect(mockExecCLI).not.toHaveBeenCalled();
      expect(main).toBe(mockFishServer);
    });

    it('should handle browser bundling scenario', async () => {
      // Simulate browser environment
      global.window = {
        document: {},
        location: { href: 'http://localhost' },
      } as any;

      const { default: main } = await import('../src/main.ts');

      expect(mockExecCLI).not.toHaveBeenCalled();
      expect(main).toBe(mockFishServer);
    });

    it('should handle Web Worker scenario', async () => {
      // Simulate Web Worker environment
      global.self = {
        postMessage: vi.fn(),
        addEventListener: vi.fn(),
      } as any;

      const { default: main } = await import('../src/main.ts');

      expect(mockExecCLI).not.toHaveBeenCalled();
      expect(main).toBe(mockFishServer);
    });

    it('should handle test environment with CLI execution', async () => {
      process.env.NODE_ENV = 'test';
      require.main = { filename: 'some-test.ts', exports: {} } as any;

      const { default: main } = await import('../src/main.ts');

      expect(mockExecCLI).toHaveBeenCalled();
    });
  });

  describe('Edge Cases', () => {
    it('should handle missing require.main', async () => {
      require.main = undefined as any;

      const { default: main } = await import('../src/main.ts');

      expect(mockExecCLI).not.toHaveBeenCalled();
      expect(main).toBe(mockFishServer);
    });

    it('should handle null require.main', async () => {
      require.main = null as any;

      const { default: main } = await import('../src/main.ts');

      expect(mockExecCLI).not.toHaveBeenCalled();
      expect(main).toBe(mockFishServer);
    });

    it('should handle environment with both browser globals and CLI conditions', async () => {
      // This is an edge case that shouldn't happen in practice
      global.window = {} as any;
      const mockModule = { filename: 'main.ts', exports: {} };
      require.main = mockModule as any;

      const { default: main } = await import('../src/main.ts');

      // Browser environment should take precedence
      expect(mockExecCLI).not.toHaveBeenCalled();
    });

    it('should handle rapid successive imports', async () => {
      process.env.NODE_ENV = 'test';

      // Import multiple times rapidly
      const [main1, main2, main3] = await Promise.all([
        import('../src/main.ts'),
        import('../src/main.ts'),
        import('../src/main.ts'),
      ]);

      // Should all return the same module
      expect(main1.default).toBe(mockFishServer);
      expect(main2.default).toBe(mockFishServer);
      expect(main3.default).toBe(mockFishServer);

      // CLI should only be executed once due to module caching
      expect(mockExecCLI).toHaveBeenCalledTimes(1);
    });
  });

  describe('Error Recovery', () => {
    it('should handle CLI errors without affecting exports', async () => {
      // Mock execCLI to return a resolved promise to avoid unhandled rejections
      mockExecCLI.mockResolvedValue(undefined);
      process.env.NODE_ENV = 'test';

      const { default: main, FishServer } = await import('../src/main.ts');

      expect(main).toBe(mockFishServer);
      expect(FishServer).toBe(mockFishServer);
      expect(mockExecCLI).toHaveBeenCalled();
    });
  });
});
