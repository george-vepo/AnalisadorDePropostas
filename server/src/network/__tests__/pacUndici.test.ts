import { describe, expect, it } from 'vitest';
import { __test__ } from '../pacUndici';

const {
  createPacResolverFromScript,
  detectPacFormat,
  normalizePac,
  parseDirective,
  matchesNoProxy,
  parseNoProxyEnv,
} = __test__;

describe('pacUndici PAC handling', () => {
  it('resolves a PAC with FindProxyForURL declaration', async () => {
    const pacScript = `
      function FindProxyForURL(url, host) {
        return "PROXY proxy.local:8080; DIRECT";
      }
    `;
    const { script } = normalizePac(pacScript);
    const { resolver } = createPacResolverFromScript(script, 'declaration');
    const result = await resolver('https://example.com', 'example.com');
    expect(result).toContain('PROXY');
  });

  it('resolves a PAC with FindProxyForURL assignment', async () => {
    const pacScript = `
      FindProxyForURL = function(url, host) {
        return "DIRECT";
      };
    `;
    const { script } = normalizePac(pacScript);
    const { resolver } = createPacResolverFromScript(script, 'assignment-function');
    const result = await resolver('https://example.com', 'example.com');
    expect(result).toBe('DIRECT');
  });

  it('detects missing FindProxyForURL safely', () => {
    const pacScript = `
      function NotProxy(url, host) { return "DIRECT"; }
    `;
    const detected = detectPacFormat(pacScript);
    expect(detected.hasFindProxyForURL).toBe(false);
    expect(detected.format).toBe('missing');
  });

  it('parses PROXY directives with DIRECT fallback', () => {
    const directive = 'PROXY proxy.local:8080; DIRECT';
    const parsed = parseDirective(directive.split(';')[0]);
    expect(parsed).toEqual({
      type: 'PROXY',
      proxyUrl: 'http://proxy.local:8080',
    });
  });

  it('matches NO_PROXY wildcard', () => {
    const entries = parseNoProxyEnv('*');
    expect(matchesNoProxy('api.openai.com', '443', entries)).toBe('*');
  });

  it('matches NO_PROXY suffix entries', () => {
    const entries = parseNoProxyEnv('.openai.com');
    expect(matchesNoProxy('api.openai.com', '443', entries)).toBe('.openai.com');
  });

  it('matches NO_PROXY exact hostname only', () => {
    const entries = parseNoProxyEnv('api.openai.com');
    expect(matchesNoProxy('api.openai.com', '443', entries)).toBe('api.openai.com');
    expect(matchesNoProxy('foo.api.openai.com', '443', entries)).toBeNull();
  });

  it('matches NO_PROXY entries with port', () => {
    const entries = parseNoProxyEnv('api.openai.com:443');
    expect(matchesNoProxy('api.openai.com', '443', entries)).toBe(
      'api.openai.com:443',
    );
    expect(matchesNoProxy('api.openai.com', '80', entries)).toBeNull();
  });

  it('matches NO_PROXY <local> entries', () => {
    const entries = parseNoProxyEnv('<local>');
    expect(matchesNoProxy('localhost', '3000', entries)).toBe('<local>');
    expect(matchesNoProxy('intranet', '80', entries)).toBe('<local>');
  });

  it('parses NO_PROXY lists with comma/semicolon separators', () => {
    const entries = parseNoProxyEnv(' api.openai.com ; .openai.com, localhost ');
    expect(matchesNoProxy('api.openai.com', '443', entries)).toBe('api.openai.com');
    expect(matchesNoProxy('foo.openai.com', '443', entries)).toBe('.openai.com');
    expect(matchesNoProxy('localhost', '80', entries)).toBe('localhost');
  });
});
