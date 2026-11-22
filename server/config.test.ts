// @vitest-environment node
// @module-tag pure
// Pure server-side config parsing — no DOM dependency, so this runs under plain Node rather than
// the app's default happy-dom environment (see main.test.ts for why that distinction matters here).
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { ConfigError, parseAllowedOrigins, parsePort, resolveConfig } from './config';

const APP_ROOT = '/app/prompt-studio';

describe('resolveConfig', () => {
  it('accepts an optional public GitHub App client ID and rejects malformed IDs', () => {
    expect(resolveConfig({}, APP_ROOT).githubClientId).toBe('Iv23liSWVNoHWL8Onr5s');
    expect(resolveConfig({ STUDIO_GITHUB_CLIENT_ID: 'Iv1.public' }, APP_ROOT).githubClientId).toBe('Iv1.public');
    for (const value of ['', 'https://example.com', 'x'.repeat(101)]) {
      expect(() => resolveConfig({ STUDIO_GITHUB_CLIENT_ID: value }, APP_ROOT)).toThrow(ConfigError);
    }
  });

  it('applies every documented default when the environment is empty', () => {
    const config = resolveConfig({}, APP_ROOT);
    expect(config).toEqual({
      repoRoot: '/repo',
      staticDir: path.resolve(APP_ROOT, 'dist'),
      host: '0.0.0.0',
      port: 5273,
      allowedOrigins: ['http://127.0.0.1:5273', 'http://localhost:5273'],
      zaiApiKey: undefined,
      zaiBaseUrl: undefined,
      verifyBudget: 20,
      githubClientId: 'Iv23liSWVNoHWL8Onr5s',
    });
  });

  it('honours an override for every variable', () => {
    const config = resolveConfig(
      {
        STUDIO_REPO_ROOT: '/srv/repo',
        STUDIO_STATIC_DIR: './public',
        STUDIO_HOST: '127.0.0.1',
        STUDIO_PORT: '8080',
        STUDIO_ALLOWED_ORIGINS: 'https://studio.example.com',
        ZAI_API_KEY: 'sk-zai-test-key',
        ZAI_BASE_URL: 'https://zai.example.com',
        STUDIO_VERIFY_BUDGET: '5',
      },
      APP_ROOT,
    );
    expect(config).toEqual({
      repoRoot: '/srv/repo',
      staticDir: path.resolve(APP_ROOT, 'public'),
      host: '127.0.0.1',
      port: 8080,
      allowedOrigins: ['https://studio.example.com'],
      zaiApiKey: 'sk-zai-test-key',
      zaiBaseUrl: 'https://zai.example.com',
      verifyBudget: 5,
      githubClientId: 'Iv23liSWVNoHWL8Onr5s',
    });
  });

  it('leaves zaiApiKey/zaiBaseUrl undefined when unset — a normal, valid "unconfigured" state', () => {
    const config = resolveConfig({}, APP_ROOT);
    expect(config.zaiApiKey).toBeUndefined();
    expect(config.zaiBaseUrl).toBeUndefined();
  });

  it('rejects an explicitly-blank ZAI_API_KEY rather than silently treating it as unset', () => {
    expect(() => resolveConfig({ ZAI_API_KEY: '' }, APP_ROOT)).toThrow(ConfigError);
  });

  it('never includes the ZAI_API_KEY value in the ConfigError message when it is malformed', () => {
    try {
      resolveConfig({ ZAI_API_KEY: '' }, APP_ROOT);
      expect.unreachable('expected resolveConfig to throw');
    } catch (error) {
      expect(error).toBeInstanceOf(ConfigError);
      expect((error as ConfigError).message).toContain('ZAI_API_KEY');
    }
  });

  it('rejects a non-numeric STUDIO_VERIFY_BUDGET', () => {
    expect(() => resolveConfig({ STUDIO_VERIFY_BUDGET: 'not-a-number' }, APP_ROOT)).toThrow(ConfigError);
  });

  it('rejects a negative STUDIO_VERIFY_BUDGET', () => {
    expect(() => resolveConfig({ STUDIO_VERIFY_BUDGET: '-1' }, APP_ROOT)).toThrow(ConfigError);
  });

  it('accepts STUDIO_VERIFY_BUDGET "0" as a valid always-exhausted override', () => {
    expect(resolveConfig({ STUDIO_VERIFY_BUDGET: '0' }, APP_ROOT).verifyBudget).toBe(0);
  });

  it('resolves an absolute STUDIO_STATIC_DIR as-is, ignoring appRoot', () => {
    const config = resolveConfig({ STUDIO_STATIC_DIR: '/var/www/studio' }, APP_ROOT);
    expect(config.staticDir).toBe('/var/www/studio');
  });

  it('rejects a relative STUDIO_REPO_ROOT', () => {
    expect(() => resolveConfig({ STUDIO_REPO_ROOT: 'relative/repo' }, APP_ROOT)).toThrow(ConfigError);
  });

  it('never includes the offending value in the ConfigError message', () => {
    try {
      resolveConfig({ STUDIO_REPO_ROOT: 'relative/repo/with-a-secret-looking-segment' }, APP_ROOT);
      expect.unreachable('expected resolveConfig to throw');
    } catch (error) {
      expect(error).toBeInstanceOf(ConfigError);
      expect((error as ConfigError).message).not.toContain('relative/repo/with-a-secret-looking-segment');
      expect((error as ConfigError).message).toContain('STUDIO_REPO_ROOT');
    }
  });

  it('rejects an empty STUDIO_HOST', () => {
    expect(() => resolveConfig({ STUDIO_HOST: '   ' }, APP_ROOT)).toThrow(ConfigError);
  });

  it('rejects a non-numeric STUDIO_PORT', () => {
    expect(() => resolveConfig({ STUDIO_PORT: 'not-a-port' }, APP_ROOT)).toThrow(ConfigError);
  });

  it('rejects an out-of-range STUDIO_PORT', () => {
    expect(() => resolveConfig({ STUDIO_PORT: '70000' }, APP_ROOT)).toThrow(ConfigError);
  });

  it('rejects STUDIO_PORT "0" — unlike the standalone parsePort helper, 0 is not a usable bind port', () => {
    expect(() => resolveConfig({ STUDIO_PORT: '0' }, APP_ROOT)).toThrow(ConfigError);
  });

  it('never includes the offending STUDIO_PORT value in the ConfigError message', () => {
    try {
      resolveConfig({ STUDIO_PORT: 'super-secret-looking-value' }, APP_ROOT);
      expect.unreachable('expected resolveConfig to throw');
    } catch (error) {
      expect(error).toBeInstanceOf(ConfigError);
      expect((error as ConfigError).message).not.toContain('super-secret-looking-value');
      expect((error as ConfigError).message).toContain('STUDIO_PORT');
    }
  });

  it('rejects an explicitly empty STUDIO_ALLOWED_ORIGINS as a misconfiguration, not a silent deny-all', () => {
    expect(() => resolveConfig({ STUDIO_ALLOWED_ORIGINS: '' }, APP_ROOT)).toThrow(ConfigError);
  });

  it('rejects an all-separator STUDIO_ALLOWED_ORIGINS (parses to an empty list)', () => {
    expect(() => resolveConfig({ STUDIO_ALLOWED_ORIGINS: ' , , ,' }, APP_ROOT)).toThrow(ConfigError);
  });

  it('never includes the offending STUDIO_ALLOWED_ORIGINS value in the ConfigError message', () => {
    try {
      resolveConfig({ STUDIO_ALLOWED_ORIGINS: '' }, APP_ROOT);
      expect.unreachable('expected resolveConfig to throw');
    } catch (error) {
      expect(error).toBeInstanceOf(ConfigError);
      expect((error as ConfigError).message).toContain('STUDIO_ALLOWED_ORIGINS');
    }
  });

  it('names every invalid variable at once when several are malformed', () => {
    try {
      resolveConfig({ STUDIO_REPO_ROOT: 'relative', STUDIO_PORT: '0' }, APP_ROOT);
      expect.unreachable('expected resolveConfig to throw');
    } catch (error) {
      expect(error).toBeInstanceOf(ConfigError);
      expect((error as ConfigError).message).toContain('STUDIO_REPO_ROOT');
      expect((error as ConfigError).message).toContain('STUDIO_PORT');
    }
  });
});

describe('parsePort', () => {
  it('parses a valid port', () => {
    expect(parsePort('5273')).toBe(5273);
    expect(parsePort('0')).toBe(0);
    expect(parsePort('65535')).toBe(65535);
  });

  it('rejects a non-numeric value without echoing it in the message', () => {
    try {
      parsePort('not-a-port');
      expect.unreachable('expected parsePort to throw');
    } catch (error) {
      expect(error).toBeInstanceOf(ConfigError);
      expect((error as ConfigError).message).not.toContain('not-a-port');
    }
  });

  it('rejects a negative number', () => {
    expect(() => parsePort('-1')).toThrow(ConfigError);
  });

  it('rejects a value above 65535', () => {
    expect(() => parsePort('70000')).toThrow(ConfigError);
  });

  it('rejects a decimal value', () => {
    expect(() => parsePort('5273.5')).toThrow(ConfigError);
  });
});

describe('parseAllowedOrigins', () => {
  it('splits, trims, and drops empty entries', () => {
    expect(parseAllowedOrigins('http://a.example.com, http://b.example.com ,,')).toEqual([
      'http://a.example.com',
      'http://b.example.com',
    ]);
  });

  it('returns an empty (deny-all-cross-origin) list for an empty string', () => {
    expect(parseAllowedOrigins('')).toEqual([]);
  });

  it('returns a single-entry list for a value with no commas', () => {
    expect(parseAllowedOrigins('http://127.0.0.1:5273')).toEqual(['http://127.0.0.1:5273']);
  });
});
