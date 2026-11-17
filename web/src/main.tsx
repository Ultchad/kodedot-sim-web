import { inject } from '@vercel/analytics';
import { createRoot } from 'react-dom/client';
import App from './App';
import { I18nProvider } from './i18n';
import { HostProvider } from './state/host';
import './index.css';

/**
 * The first frame is painted with the real typefaces, so no text reflows when they arrive: the fonts are self-hosted
 * and small, and the wait is capped so a slow connection still gets the page (with the fallback font, swapped later).
 */
const FIRST_PAINT_FACES = ['400 15px "DM Sans"', '500 15px "DM Sans"', '600 15px "DM Sans"', '700 26px "Outfit"', '400 12.5px "DM Mono"'];
const FONT_WAIT_MS = 400;

function fontsReady(): Promise<unknown> {
  if (typeof document === 'undefined' || !document.fonts?.load) return Promise.resolve();
  const all = Promise.all(FIRST_PAINT_FACES.map((f) => document.fonts.load(f))).catch(() => undefined);
  return Promise.race([all, new Promise((r) => setTimeout(r, FONT_WAIT_MS))]);
}

// Visit counts (Vercel Web Analytics: no cookies; the script and its reports stay on this site's own address, which the CSP allows).
// Only the production site counts; it does nothing until Web Analytics is turned on for the project.
if (import.meta.env.PROD && /(^|\.)murilogp\.dev$/.test(location.hostname)) inject();

void fontsReady().then(() => {
  createRoot(document.getElementById('root')!).render(
    <I18nProvider>
      <HostProvider>
        <App />
      </HostProvider>
    </I18nProvider>,
  );
});
