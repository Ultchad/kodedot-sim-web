import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { loadPref, savePref } from '../lib/prefs';
import { detectLocale, isLocale, makeFormatters, translate, type Formatters, type Locale, type TFn, type Vars, type TKey } from './core';

export type { Locale, MessageKey, TKey, TFn } from './core';
export { LOCALES } from './core';

const KEY = 'dotbench.lang';

interface I18n {
  locale: Locale;
  setLocale(l: Locale): void;
  t: TFn;
  fmt: Formatters;
}

const Ctx = createContext<I18n | null>(null);

function initialLocale(): Locale {
  const saved = loadPref<unknown>(KEY, null);
  if (isLocale(saved)) return saved;
  return detectLocale(typeof navigator !== 'undefined' ? (navigator.languages?.length ? navigator.languages : [navigator.language]) : []);
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLoc] = useState<Locale>(initialLocale);
  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);
  const setLocale = useCallback((l: Locale) => {
    setLoc(l);
    savePref(KEY, l);
  }, []);
  const value = useMemo<I18n>(
    () => ({ locale, setLocale, t: (key: TKey, vars?: Vars) => translate(locale, key, vars), fmt: makeFormatters(locale) }),
    [locale, setLocale],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useI18n(): I18n {
  const v = useContext(Ctx);
  if (!v) throw new Error('useI18n outside I18nProvider');
  return v;
}
