export type SourceKind = 'web' | 'video' | 'paper' | 'repo';

/**
 * Somewhere the claim in a node can be checked, or watched.
 *
 * The point of the app is first-principles understanding, and until now every
 * word of it came out of one model with nothing behind it — you could not tell
 * a well-established explanation from a confident invention. A source is the
 * thing that makes the difference visible: the claim is still the model's, but
 * now it points somewhere you can go and disagree with it.
 *
 * Which is exactly why the URL is never taken on trust. `url` is re-derived
 * from a parsed URL rather than echoed, `kind` is read off the host rather than
 * believed, and `videoId` matches YouTube's id grammar or the source is not a
 * video. A fabricated link that renders as a real one would be worse than no
 * sources at all.
 */
export type Source = {
  id: string;
  kind: SourceKind;
  /** Normalized https URL. Never the raw string the model wrote. */
  url: string;
  title: string;
  /** One line on why this is worth opening. The model's words, shown beside its link. */
  note?: string;
  /** YouTube video id, when this is a video: exactly 11 chars of [A-Za-z0-9_-]. */
  videoId?: string;
  /** Seconds into the video the relevant part starts. */
  at?: number;
  /**
   * Whether the link came from a real search result rather than the model's
   * memory. Recorded, and shown, because an unverified link is a different kind
   * of object from a cited one and the learner has to be able to tell.
   */
  searched?: boolean;
};
