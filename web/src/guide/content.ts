import type { Locale } from '../i18n/core';
import { APP_PACKAGE_EXT } from '../lib/appPackage';
import { en } from './content.en';
import { es } from './content.es';
import { ptBR } from './content.pt-BR';

/** `en` defines the keys; the other languages are typed against it, so a missing or extra key does not compile. */
export type GuideKey = keyof typeof en;
export type GuideMessages = Record<GuideKey, string>;
export const GUIDE_DICTS: Record<Locale, GuideMessages> = { en, 'pt-BR': ptBR, es };

export const SITE_URL = 'https://kodedot.murilogp.dev';
export const REPO_URL = 'https://github.com/murilogpapa/kodedot-sim';
export const ISSUES_URL = `${REPO_URL}/issues`;

/** What the texts may name: `{ext}` and the project's addresses. `{origin}` is the address this very page was opened from. */
export function guideVars(): Record<string, string> {
  return { ext: APP_PACKAGE_EXT, site: SITE_URL, repo: REPO_URL, issues: ISSUES_URL, origin: typeof location === 'undefined' ? SITE_URL : location.origin };
}

export const fillVars = (text: string, vars: Record<string, string>): string => text.replace(/\{(\w+)\}/g, (m, name: string) => vars[name] ?? m);

export function guideText(locale: Locale, key: GuideKey, extra?: Record<string, string>): string {
  return fillVars(GUIDE_DICTS[locale][key] ?? en[key], { ...guideVars(), ...extra });
}
