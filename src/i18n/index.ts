import { create } from 'zustand';
import { dict, type Lang, type Strings } from './dict';

export { LANGS, type Lang, type Strings } from './dict';

const STORAGE_KEY = 'nandedakke.lang';

/** Stored choice wins; otherwise follow the browser, falling back to Japanese. */
function initialLang(): Lang {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === 'ja' || stored === 'th' || stored === 'en') return stored;
  } catch {
    // private mode — fall through to detection
  }
  const nav = typeof navigator === 'undefined' ? '' : navigator.language.toLowerCase();
  if (nav.startsWith('th')) return 'th';
  if (nav.startsWith('en')) return 'en';
  return 'ja';
}

type LangState = { lang: Lang; setLang: (lang: Lang) => void };

export const useLangStore = create<LangState>()((set) => ({
  lang: initialLang(),
  setLang: (lang) => {
    try {
      localStorage.setItem(STORAGE_KEY, lang);
    } catch {
      // ignore storage failures
    }
    set({ lang });
  },
}));

/** UI strings for the active language. Components re-render on a language switch. */
export function useStrings(): Strings {
  return useLangStore((s) => dict[s.lang]);
}

/** Same strings, for code outside React (services, store actions). */
export function getStrings(): Strings {
  return dict[useLangStore.getState().lang];
}
