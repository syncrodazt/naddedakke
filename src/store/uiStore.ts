import { create } from 'zustand';

// In-page dialogs that replace the browser's native alert/confirm/prompt.
// Promise-based so call sites read the same as the natives they replace:
//   if (await confirmDialog(msg)) { … }
//   const topic = await promptDialog(msg);   // string, or null if cancelled
//   await alertDialog(msg);
// A single <DialogHost /> (mounted once) renders whatever dialog is active.

type DialogBody =
  | { kind: 'alert'; message: string; resolve: () => void }
  | { kind: 'confirm'; message: string; danger?: boolean; resolve: (ok: boolean) => void }
  | {
      kind: 'prompt';
      message: string;
      defaultValue: string;
      placeholder?: string;
      resolve: (value: string | null) => void;
    };

// id lets the host key its inner view per dialog so prompt text initializes
// from props (no setState-in-effect).
export type Dialog = DialogBody & { id: number };

type UIState = {
  dialog: Dialog | null;
  open: (dialog: Dialog) => void;
  close: () => void;
};

export const useUIStore = create<UIState>()((set) => ({
  dialog: null,
  open: (dialog) => set({ dialog }),
  close: () => set({ dialog: null }),
}));

let nextId = 0;

function settle<T>(build: (resolve: (v: T) => void) => DialogBody): Promise<T> {
  return new Promise<T>((resolve) => {
    const body = build((value) => {
      useUIStore.getState().close();
      resolve(value);
    });
    useUIStore.getState().open({ ...body, id: nextId++ });
  });
}

export function alertDialog(message: string): Promise<void> {
  return settle<void>((resolve) => ({ kind: 'alert', message, resolve }));
}

export function confirmDialog(message: string, danger = false): Promise<boolean> {
  return settle<boolean>((resolve) => ({ kind: 'confirm', message, danger, resolve }));
}

export function promptDialog(
  message: string,
  defaultValue = '',
  placeholder?: string,
): Promise<string | null> {
  return settle<string | null>((resolve) => ({
    kind: 'prompt',
    message,
    defaultValue,
    placeholder,
    resolve,
  }));
}
