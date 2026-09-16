import { config, Config, ConfigSchema, getConfigFromEnvironmentVariables } from '../src/config';

describe('snippet configuration', () => {
  const originalEnableSnippets = config.fish_lsp_enable_snippets;

  afterEach(() => {
    vi.unstubAllEnvs();
    config.fish_lsp_enable_snippets = originalEnableSnippets;
  });

  it('enables snippets by default and documents the setting', () => {
    vi.stubEnv('fish_lsp_enable_snippets', undefined);
    expect(ConfigSchema.parse({}).fish_lsp_enable_snippets).toBe(true);
    expect(getConfigFromEnvironmentVariables().config.fish_lsp_enable_snippets).toBe(true);
    expect(Config.getDocsForKey('fish_lsp_enable_snippets')).toContain('snippet');
  });

  it.each([['true', true], ['false', false], ['1', true], ['0', false]])('reads the environment value %s', (value, expected) => {
    vi.stubEnv('fish_lsp_enable_snippets', value);
    const result = getConfigFromEnvironmentVariables();
    expect(result.config.fish_lsp_enable_snippets).toBe(expected);
    expect(result.environmentVariablesUsed).toContain('fish_lsp_enable_snippets');
  });

  it('allows initializationOptions to override the environment', () => {
    vi.stubEnv('fish_lsp_enable_snippets', 'false');
    config.fish_lsp_enable_snippets = getConfigFromEnvironmentVariables().config.fish_lsp_enable_snippets;
    Config.updateFromInitializationOptions({ fish_lsp_enable_snippets: true } as Config);
    expect(config.fish_lsp_enable_snippets).toBe(true);
  });
});
