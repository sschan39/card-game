import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { DEFAULT_LOCALE, type LocaleCode } from './locale';
import { resolveInitialLocale, writeStoredLocale } from './storage';
import { translate, type MessageKey, type Translate, type TranslateParams } from './runtime';

export interface LocaleContextValue {
  locale: LocaleCode;
  setLocale: (next: LocaleCode) => void;
  t: Translate;
}

const LocaleContext = createContext<LocaleContextValue | null>(null);

/**
 * Keep the document honest about its language.
 *
 * `lang` drives the browser's spell checking, hyphenation and screen-reader
 * pronunciation, and the `data-locale` attribute lets a stylesheet react to the
 * language without reading React state.
 */
export function applyDocumentLocale(locale: LocaleCode): void {
  if (typeof document === 'undefined') return;
  document.documentElement.lang = locale;
  document.body.dataset.locale = locale;
}

/**
 * One provider per document.
 *
 * The initial value is a remembered choice, else the browser's preference. A
 * switch updates the document, persists the choice, and notifies the app so a
 * seated player's card text can be re-projected by the server.
 */
export function LocaleProvider({ children, initialLocale, onLocaleChange }: {
  children: ReactNode;
  initialLocale?: LocaleCode;
  onLocaleChange?: (locale: LocaleCode) => void;
}) {
  const [locale, setLocaleState] = useState<LocaleCode>(() => initialLocale ?? resolveInitialLocale());
  useEffect(() => {
    applyDocumentLocale(locale);
  }, [locale]);
  const setLocale = useCallback((next: LocaleCode) => {
    setLocaleState(next);
    writeStoredLocale(next);
    onLocaleChange?.(next);
  }, [onLocaleChange]);
  const value = useMemo<LocaleContextValue>(() => ({
    locale,
    setLocale,
    t: (key: MessageKey, params?: TranslateParams) => translate(locale, key, params),
  }), [locale, setLocale]);
  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>;
}

/** Current locale. A component rendered outside the provider keeps English. */
export function useLocale(): LocaleCode {
  return useContext(LocaleContext)?.locale ?? DEFAULT_LOCALE;
}

function ignoreLocale(): void {
  /* A switch without a provider has nowhere to go; rendering stays English. */
}

/** Switch language. Outside the provider this is a no-op, not a crash. */
export function useSetLocale(): (next: LocaleCode) => void {
  return useContext(LocaleContext)?.setLocale ?? ignoreLocale;
}

/** Translation function for the current locale, safe to call outside a provider. */
export function useT(): Translate {
  const context = useContext(LocaleContext);
  const locale = context?.locale ?? DEFAULT_LOCALE;
  return useMemo<Translate>(
    () => context?.t ?? ((key: MessageKey, params?: TranslateParams) => translate(locale, key, params)),
    [context, locale],
  );
}
