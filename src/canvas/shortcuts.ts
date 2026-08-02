import type { Strings } from '../i18n';

// Every keyboard shortcut in the app, in one list.
//
// This is the source the Settings panel renders from, so the list cannot drift
// out of date the way a hand-written help page does: adding a key without
// adding it here means it is not discoverable, which is close to it not
// existing — nobody guesses Shift+T.

export type ShortcutGroupId = 'canvas' | 'notebook' | 'replay' | 'palette' | 'library';

export type Shortcut = {
  /** Rendered as separate key caps. `Mod` becomes ⌘ or Ctrl per platform. */
  keys: string[];
  /** Which string describes it — a key of the dictionary, so it stays translated. */
  label: keyof Strings;
};

export type ShortcutGroup = { id: ShortcutGroupId; title: keyof Strings; items: Shortcut[] };

export const SHORTCUTS: ShortcutGroup[] = [
  {
    id: 'canvas',
    title: 'scCanvas',
    items: [
      { keys: ['←', '↑', '↓', '→'], label: 'scArrows' },
      { keys: ['Shift', '1'], label: 'scFitAll' },
      { keys: ['Shift', '2'], label: 'scZoomNode' },
      { keys: ['Shift', 'T'], label: 'scTidy' },
      { keys: ['Esc'], label: 'scClearFocus' },
    ],
  },
  {
    id: 'notebook',
    title: 'scNotebook',
    items: [
      { keys: ['Mod', 'K'], label: 'scPalette' },
      { keys: ['Mod', 'B'], label: 'scSidebar' },
      { keys: ['Mod', ','], label: 'scSettings' },
      { keys: ['Mod', 'Z'], label: 'scUndo' },
      { keys: ['Mod', 'Shift', 'Z'], label: 'scRedo' },
    ],
  },
  {
    id: 'replay',
    title: 'scReplayGroup',
    items: [
      { keys: ['↑', '↓'], label: 'scReplayStep' },
      { keys: ['Space'], label: 'scReplayPlay' },
      { keys: ['Esc'], label: 'scReplayExit' },
    ],
  },
  {
    id: 'palette',
    title: 'scPaletteGroup',
    items: [
      { keys: ['↑', '↓'], label: 'scPaletteMove' },
      { keys: ['Enter'], label: 'scPaletteOpen' },
      { keys: ['1', '–', '9'], label: 'scPaletteJump' },
      { keys: ['Esc'], label: 'scPaletteClose' },
    ],
  },
  {
    id: 'library',
    title: 'scLibrary',
    items: [
      { keys: ['Mod', 'Click'], label: 'scLibraryToggle' },
      { keys: ['Shift', 'Click'], label: 'scLibraryRange' },
      { keys: ['Mod', 'A'], label: 'scLibraryAll' },
      { keys: ['Esc'], label: 'scLibraryClear' },
    ],
  },
];

/**
 * What the modifier is called on this machine. Showing Ctrl to a Mac user is a
 * shortcut that does not work; the labels have to match their keyboard.
 */
export function modLabel(platform = typeof navigator === 'undefined' ? '' : navigator.userAgent) {
  return /Mac|iPhone|iPad/i.test(platform) ? '⌘' : 'Ctrl';
}

/** Key caps with `Mod` resolved for display. */
export function keyCaps(shortcut: Shortcut, mod = modLabel()): string[] {
  return shortcut.keys.map((k) => (k === 'Mod' ? mod : k));
}
