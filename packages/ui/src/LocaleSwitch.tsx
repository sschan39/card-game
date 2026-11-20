import { LOCALES, LOCALE_HTML_LANG, LOCALE_LABELS, LOCALE_SHORT_LABELS } from './i18n/locale';
import { useLocale, useSetLocale, useT } from './i18n/context';

/**
 * Language as two short text buttons.
 *
 * There are exactly two languages, so a dropdown would hide the choice behind a
 * click. The visible label is abbreviated (ENG / 繁中) so the header stays compact;
 * the full name stays in the tooltip and in the group label for screen readers.
 */
export function LocaleSwitch() {
  const locale = useLocale();
  const setLocale = useSetLocale();
  const t = useT();
  return <div className="workspace-locale" role="group" aria-label={t('locale.label')}>
    {LOCALES.map(code => <button
      key={code}
      type="button"
      lang={LOCALE_HTML_LANG[code]}
      className="workspace-locale-option"
      aria-pressed={locale === code}
      title={t('locale.switchTo', { language: LOCALE_LABELS[code] })}
      onClick={() => setLocale(code)}
    >{LOCALE_SHORT_LABELS[code]}</button>)}
  </div>;
}
