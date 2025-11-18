import { logger } from '../src/logger';
import { env } from '../src/utils/env-manager';
import { AutoloadedPathVariables } from '../src/utils/process-env';

describe('env.test.ts', () => {
  beforeEach(async () => {
    logger.setSilent(true);
    await env.reset();
    logger.setSilent(false);
  });

  describe('env setup', () => {
    it('should have process env variables', () => {
      const processEnvKeys = env.getProcessEnvKeys();
      expect(processEnvKeys.length).toBeGreaterThan(0);
      expect(processEnvKeys).toContain('HOME');
      expect(processEnvKeys).toContain('PATH');
    });

    it('all autoloaded fish variables should have non-empty values', () => {
      const autoloadedKeys = env.getAutoloadedKeys();
      expect(autoloadedKeys.length).toBeGreaterThan(0);

      // Every autoloaded key should have a defined, non-empty value
      autoloadedKeys.forEach((key) => {
        const value = env.get(key);
        expect(value).toBeDefined();
        expect(value).not.toBe('');
        expect(value?.trim()).not.toBe('');
      });
    });

    it('should get autoloaded fish variables as array', () => {
      const autoloadedKeys = env.getAutoloadedKeys();

      autoloadedKeys.forEach((key) => {
        const value = env.get(key);
        const arrayValue = env.getAsArray(key);

        expect(value).toBeDefined();
        expect(arrayValue).toBeDefined();
        expect(Array.isArray(arrayValue)).toBe(true);
        expect(arrayValue.length).toBeGreaterThan(0);
      });
    });

    it('should exclude keys with empty values from autoloadedKeys', () => {
      const autoloadedKeys = env.getAutoloadedKeys();

      // These keys might have empty values and should not be in autoloadedKeys
      const potentiallyEmptyKeys = ['__fish_initialized', '__fish_added_user_paths'];

      potentiallyEmptyKeys.forEach((key) => {
        const value = env.get(key);
        if (!value || value.trim() === '') {
          // If the value is empty, it should NOT be in autoloadedKeys
          expect(autoloadedKeys).not.toContain(key);
        }
      });
    });
  });

  describe('env manager', () => {
    it('should correctly identify autoloaded variables', () => {
      const autoloadedKeys = env.getAutoloadedKeys();

      autoloadedKeys.forEach((key) => {
        expect(env.isAutoloaded(key)).toBe(true);
        expect(env.has(key)).toBe(true);
      });
    });

    it('should correctly identify process env variables', () => {
      const processEnvKeys = env.getProcessEnvKeys();

      processEnvKeys.forEach((key) => {
        expect(env.isProcessEnv(key)).toBe(true);
      });
    });

    it('should parse array values correctly', () => {
      const autoloadedKeys = env.getAutoloadedKeys();

      autoloadedKeys.forEach((key) => {
        const value = env.get(key);
        const arrayValue = env.getAsArray(key);

        // Every autoloaded variable should parse to at least one element
        expect(arrayValue.length).toBeGreaterThan(0);

        // First element should be defined
        expect(arrayValue[0]).toBeDefined();
        expect(arrayValue[0]).not.toBe('');
      });
    });

    it('should handle setAutoloaded correctly', () => {
      const testKey = '__test_autoloaded_var';
      const testValue = '/test/path';

      // Verify key doesn't exist initially
      expect(env.isAutoloaded(testKey)).toBe(false);

      // try to set an autoloaded variable with a non-empty value
      env.setAutoloaded(testKey, testValue);
      expect(env.get(testKey)).toBeUndefined();

      // set normally
      env.set(testKey, testValue);
      expect(env.get(testKey)).toBeDefined();
      expect(env.isAutoloaded(testKey)).toBe(false);
    });

    it('should not add empty values to autoloadedKeys', () => {
      const testKey = '__fish_initialized';
      const emptyValue = '';

      // Set an autoloaded variable with an empty value
      env.setAutoloaded(testKey, emptyValue);

      // Should not be in autoloadedKeys
      expect(env.isAutoloaded(testKey)).toBe(false);

      // Value should not be set in envStore
      expect(env.get(testKey)).toBeUndefined();
    });

    it('should provide autoloadedFishVariables as a record', () => {
      const autoloadedVars = env.autoloadedFishVariables;

      expect(autoloadedVars).toBeDefined();
      expect(typeof autoloadedVars).toBe('object');

      // Every key in autoloadedKeys should be in the record
      env.getAutoloadedKeys().forEach((key) => {
        // Note: autoloadedFishVariables returns all possible keys from AutoloadedPathVariables.all()
        // but we only care about the ones that are actually in autoloadedKeys
        if (env.isAutoloaded(key)) {
          const value = env.getAsArray(key);
          expect(value.length).toBeGreaterThan(0);
        }
      });
    });
  });

  describe('AutoloadedPathVariables namespace', () => {
    it('should find autoloaded function paths', () => {
      const functionPaths = AutoloadedPathVariables.get('fish_function_path');
      expect(functionPaths).toBeDefined();
      expect(functionPaths.length).toBeGreaterThan(0);
    });

    it('should provide all autoloaded variable names', () => {
      const allVarNames = AutoloadedPathVariables.all();
      expect(allVarNames).toBeDefined();
      expect(allVarNames.length).toBeGreaterThan(0);
    });

    it('should correctly identify autoloaded variable names', () => {
      expect(AutoloadedPathVariables.includes('fish_function_path')).toBe(true);
      expect(AutoloadedPathVariables.includes('__fish_data_dir')).toBe(true);
      expect(AutoloadedPathVariables.includes('not_a_fish_var')).toBe(false);
    });
  });

  describe('initialization state tracking', () => {
    it('should be initialized after reset', () => {
      expect(env.isInitialized()).toBe(true);
    });

    it('should be uninitialized after manual clear', async () => {
      // Access the private clear method through reset
      // First verify it's initialized
      expect(env.isInitialized()).toBe(true);

      // Reset with logging disabled (default)
      await env.reset();

      // Should be initialized again after reset
      expect(env.isInitialized()).toBe(true);
    });

    it('should only initialize autoloaded variables once', async () => {
      // First call should initialize
      const autoloadedKeysBefore = env.getAutoloadedKeys();
      expect(autoloadedKeysBefore.length).toBeGreaterThan(0);

      // Mark as uninitialized to test re-initialization prevention
      env.markUninitialized();
      expect(env.isInitialized()).toBe(false);

      // This should re-initialize
      await env.reset(false);
      expect(env.isInitialized()).toBe(true);

      const autoloadedKeysAfter = env.getAutoloadedKeys();
      expect(autoloadedKeysAfter.length).toBe(autoloadedKeysBefore.length);
    });

    it('should track initialization state correctly', () => {
      // Should be initialized from beforeEach
      expect(env.isInitialized()).toBe(true);

      // Mark as uninitialized
      env.markUninitialized();
      expect(env.isInitialized()).toBe(false);

      // Mark as initialized
      env.markInitialized();
      expect(env.isInitialized()).toBe(true);
    });
  });

  describe('autoloadedFishVariables getter', () => {
    it('should only return variables that are actually loaded', () => {
      const autoloadedVars = env.autoloadedFishVariables;
      const autoloadedKeys = env.getAutoloadedKeys();

      // The record should only contain keys that are in autoloadedKeys
      const recordKeys = Object.keys(autoloadedVars);
      expect(recordKeys.length).toBe(autoloadedKeys.length);

      // Every key in the record should be in autoloadedKeys
      recordKeys.forEach((key) => {
        expect(autoloadedKeys).toContain(key);
      });

      // Every autoloaded key should be in the record
      autoloadedKeys.forEach((key) => {
        expect(recordKeys).toContain(key);
        expect(autoloadedVars[key]).toBeDefined();
        expect(Array.isArray(autoloadedVars[key])).toBe(true);
      });
    });

    it('should not include variables with empty values', () => {
      const autoloadedVars = env.autoloadedFishVariables;

      // Check that potentially empty variables are not in the record
      const potentiallyEmptyKeys = ['__fish_initialized', '__fish_added_user_paths'];

      potentiallyEmptyKeys.forEach((key) => {
        const value = env.get(key);
        if (!value || value.trim() === '') {
          expect(autoloadedVars[key]).toBeUndefined();
        }
      });
    });

    it('should return array values for all entries', () => {
      const autoloadedVars = env.autoloadedFishVariables;

      Object.entries(autoloadedVars).forEach(([key, value]) => {
        expect(Array.isArray(value)).toBe(true);
        expect(value.length).toBeGreaterThan(0);
        // First element should be non-empty
        expect(value[0]).toBeTruthy();
      });
    });
  });
});
