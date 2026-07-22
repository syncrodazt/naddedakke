import { create } from 'zustand';

export type ReplaySpeed = 0.5 | 1 | 2;

export const BEAT_MS = 1200;

type ReplayState = {
  active: boolean;
  playing: boolean;
  cursor: number; // number of nodes revealed (0 = empty canvas)
  speed: ReplaySpeed;
};

type ReplayActions = {
  start: () => void;
  exit: () => void;
  setPlaying: (playing: boolean) => void;
  setCursor: (cursor: number) => void;
  setSpeed: (speed: ReplaySpeed) => void;
};

export const useReplayStore = create<ReplayState & ReplayActions>()((set) => ({
  active: false,
  playing: false,
  cursor: 0,
  speed: 1,

  start: () => set({ active: true, playing: true, cursor: 1 }),
  exit: () => set({ active: false, playing: false, cursor: 0 }),
  setPlaying: (playing) => set({ playing }),
  setCursor: (cursor) => set({ cursor: Math.max(0, cursor), playing: false }),
  setSpeed: (speed) => set({ speed }),
}));
