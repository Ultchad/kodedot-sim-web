import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { CSP_DEV, CSP_PROD } from '../../csp.mjs';

const directive = (csp: string, name: string) => csp.split(';').map((s) => s.trim()).find((s) => s.startsWith(name + ' '));

describe('Content-Security-Policy', () => {
  it('vercel.json carries exactly the production policy, plus COOP and COEP', () => {
    const v = JSON.parse(readFileSync(new URL('../../vercel.json', import.meta.url), 'utf8'));
    const h = Object.fromEntries(v.headers[0].headers.map((x: { key: string; value: string }) => [x.key, x.value]));
    expect(h['Content-Security-Policy']).toBe(CSP_PROD);
    expect(h['Cross-Origin-Opener-Policy']).toBe('same-origin');
    expect(h['Cross-Origin-Embedder-Policy']).toBe('require-corp');
  });
  it('production allows what the runtime needs and nothing inline', () => {
    expect(directive(CSP_PROD, 'script-src')).toBe("script-src 'self' blob: 'wasm-unsafe-eval'");
    expect(directive(CSP_PROD, 'worker-src')).toBe('worker-src blob:');
    expect(directive(CSP_PROD, 'default-src')).toBe("default-src 'none'");
    expect(CSP_PROD).not.toMatch(/(?<!wasm-)unsafe-eval|\*|http:/);
    expect(directive(CSP_PROD, 'style-src')).toBe("style-src 'self'");
  });
  it('dev only adds what Vite needs', () => {
    expect(directive(CSP_DEV, 'script-src')).toContain("'unsafe-inline'");
    expect(directive(CSP_DEV, 'worker-src')).toBe('worker-src blob:');
  });
});
