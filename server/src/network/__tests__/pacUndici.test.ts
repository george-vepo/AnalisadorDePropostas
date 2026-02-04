import { describe, expect, it } from 'vitest';
import { __test__ } from '../pacUndici';

const { createPacResolverFromScript, detectPacFormat, normalizePac, parseDirective } = __test__;

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
});
