import { LANGS, type Lang } from './dict';
import { useLangStore } from './index';

/**
 * The active language under its own name ("日本語", "ไทย"), for prompts.
 *
 * The model is told the language rather than the code: a two-letter code is
 * easy to misread, and "write this in ไทย" is unambiguous in a way that
 * "write this in th" is not.
 */
export function langLabel(lang: Lang = useLangStore.getState().lang): string {
  return LANGS.find((l) => l.id === lang)?.label ?? 'English';
}
