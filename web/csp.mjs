// Content-Security-Policy, defined once. vercel.json must carry CSP_PROD verbatim (csp.test.ts checks it);
// vite.config.ts serves CSP_PROD from `vite preview` and CSP_DEV from `vite dev`.
//
// Why each source:
//  script-src blob: + 'wasm-unsafe-eval'  the adapter builds the app's Emscripten module and its pthread workers from blob URLs
//                                          and compiles the app's WebAssembly. No inline scripts, no eval.
//  worker-src blob:                        pthread workers are blob workers.
//  style-src-attr 'unsafe-inline'          React sets style="" on elements (positions, sizes); stylesheets stay 'self' only.
//  img-src data: blob:                     canvas/texture uploads, the favicon.
//  connect-src blob:                       the adapter fetches nothing, but module blobs are imported; the page fetches /apps and /device.
export const CSP_PROD = [
  "default-src 'none'",
  "script-src 'self' blob: 'wasm-unsafe-eval'",
  'worker-src blob:',
  "connect-src 'self' blob:",
  "style-src 'self'",
  "style-src-attr 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self'",
  "manifest-src 'self'",
  "base-uri 'none'",
  "form-action 'none'",
  "object-src 'none'",
  "frame-ancestors 'none'",
].join('; ');

// The dev server injects an inline preamble for React refresh and talks to Vite over a websocket.
export const CSP_DEV = CSP_PROD.replace("script-src 'self' blob:", "script-src 'self' 'unsafe-inline' blob:")
  .replace("connect-src 'self' blob:", "connect-src 'self' blob: ws: http:")
  .replace("style-src 'self';", "style-src 'self' 'unsafe-inline';");
