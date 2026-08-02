import { create } from 'zustand';

/** How long a "nothing found" line stays on the card before clearing itself. */
const NOTICE_MS = 6000;

type SourceState = {
  /** Which node is having sources or a video looked up, so its card can say so. */
  findingFor: string | null;
  /**
   * A short outcome shown on one card — "no good video for this".
   *
   * Not routed through the fallback banner: that banner means "the model could
   * not be reached and what you are reading is offline filler", and reusing it
   * for a search that worked and honestly found nothing would teach the learner
   * to distrust a warning that matters.
   */
  notice: { nodeId: string; text: string } | null;
};

type SourceActions = {
  begin: (nodeId: string) => void;
  end: () => void;
  note: (nodeId: string, text: string) => void;
  clearNote: () => void;
};

let noticeTimer: ReturnType<typeof setTimeout> | null = null;

export const useSourceStore = create<SourceState & SourceActions>()((set) => ({
  findingFor: null,
  notice: null,

  begin: (nodeId) => {
    if (noticeTimer !== null) clearTimeout(noticeTimer);
    set({ findingFor: nodeId, notice: null });
  },
  end: () => set({ findingFor: null }),

  note: (nodeId, text) => {
    if (noticeTimer !== null) clearTimeout(noticeTimer);
    noticeTimer = setTimeout(() => set({ notice: null }), NOTICE_MS);
    set({ notice: { nodeId, text } });
  },
  clearNote: () => {
    if (noticeTimer !== null) clearTimeout(noticeTimer);
    set({ notice: null });
  },
}));
