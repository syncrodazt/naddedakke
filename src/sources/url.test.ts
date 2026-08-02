import { describe, expect, it } from 'vitest';
import {
  displayHost,
  embedUrl,
  formatTime,
  isVideoId,
  kindOf,
  parseSeconds,
  safeUrl,
  watchUrl,
  youtubeRef,
} from './url';

describe('safeUrl', () => {
  it('passes an ordinary https link through', () => {
    expect(safeUrl('https://arxiv.org/abs/1706.03762')).toBe('https://arxiv.org/abs/1706.03762');
  });

  it('refuses the schemes that turn a link into code', () => {
    // These are the whole reason this function exists. A source comes from a
    // model, and an href is somewhere the learner is invited to click.
    expect(safeUrl('javascript:alert(1)')).toBeNull();
    expect(safeUrl('  JavaScript:alert(1)')).toBeNull();
    expect(safeUrl('data:text/html,<script>alert(1)</script>')).toBeNull();
    expect(safeUrl('vbscript:msgbox(1)')).toBeNull();
    expect(safeUrl('file:///etc/passwd')).toBeNull();
  });

  it('refuses plain http rather than silently downgrading', () => {
    expect(safeUrl('http://example.com/page')).toBeNull();
  });

  it('refuses anything that is not a URL', () => {
    expect(safeUrl('')).toBeNull();
    expect(safeUrl('see the paper by Vaswani et al.')).toBeNull();
    expect(safeUrl('example.com')).toBeNull();
  });

  it('strips credentials out of the authority', () => {
    // Either meaningless or someone else's; never ours to forward.
    expect(safeUrl('https://user:pw@example.com/x')).toBe('https://example.com/x');
  });

  it('keeps the query, which often IS the address', () => {
    expect(safeUrl('https://www.youtube.com/watch?v=aircAruvnKk')).toContain('v=aircAruvnKk');
  });
});

describe('parseSeconds', () => {
  it('reads the forms YouTube actually uses', () => {
    expect(parseSeconds('90')).toBe(90);
    expect(parseSeconds('90s')).toBe(90);
    expect(parseSeconds('1m30s')).toBe(90);
    expect(parseSeconds('1h2m3s')).toBe(3723);
    expect(parseSeconds('2h')).toBe(7200);
  });

  it('is null for anything it cannot read', () => {
    // Not 0: "could not read the timestamp" and "starts at the beginning" are
    // different answers, and one of them should not send the learner to 0:00.
    expect(parseSeconds('')).toBeNull();
    expect(parseSeconds('soon')).toBeNull();
    expect(parseSeconds('1x2y')).toBeNull();
  });
});

describe('youtubeRef', () => {
  it('reads the watch, short, embed and shorts forms', () => {
    expect(youtubeRef('https://www.youtube.com/watch?v=aircAruvnKk')).toEqual({
      videoId: 'aircAruvnKk',
    });
    expect(youtubeRef('https://youtu.be/aircAruvnKk')).toEqual({ videoId: 'aircAruvnKk' });
    expect(youtubeRef('https://www.youtube.com/embed/aircAruvnKk')).toEqual({
      videoId: 'aircAruvnKk',
    });
    expect(youtubeRef('https://www.youtube.com/shorts/aircAruvnKk')).toEqual({
      videoId: 'aircAruvnKk',
    });
    expect(youtubeRef('https://m.youtube.com/watch?v=aircAruvnKk')).toEqual({
      videoId: 'aircAruvnKk',
    });
  });

  it('picks up the timestamp in either parameter', () => {
    expect(youtubeRef('https://youtu.be/aircAruvnKk?t=451')).toEqual({
      videoId: 'aircAruvnKk',
      at: 451,
    });
    expect(youtubeRef('https://www.youtube.com/watch?v=aircAruvnKk&t=7m31s')).toEqual({
      videoId: 'aircAruvnKk',
      at: 451,
    });
    expect(youtubeRef('https://www.youtube.com/embed/aircAruvnKk?start=451')).toEqual({
      videoId: 'aircAruvnKk',
      at: 451,
    });
  });

  it('is null for a host that merely looks like YouTube', () => {
    // This is the attack the id grammar alone would not stop: the path is a
    // perfectly good video id, and only the host gives it away.
    expect(youtubeRef('https://youtube.com.evil.test/watch?v=aircAruvnKk')).toBeNull();
    expect(youtubeRef('https://notyoutube.com/watch?v=aircAruvnKk')).toBeNull();
  });

  it('is null when the id is not one', () => {
    // Whatever ends up here ends up in an iframe src, so the grammar is the
    // gate: 11 characters of [A-Za-z0-9_-], or there is no video.
    expect(youtubeRef('https://www.youtube.com/watch?v=short')).toBeNull();
    expect(youtubeRef('https://www.youtube.com/watch?v=../../etc/passwd')).toBeNull();
    expect(youtubeRef('https://www.youtube.com/watch?v=abc"onload="x')).toBeNull();
    expect(youtubeRef('https://www.youtube.com/')).toBeNull();
  });

  it('is null for a non-YouTube link', () => {
    expect(youtubeRef('https://vimeo.com/12345678')).toBeNull();
  });
});

describe('embedUrl', () => {
  it('builds a nocookie embed at the right start time', () => {
    expect(embedUrl('aircAruvnKk', 451)).toBe(
      'https://www.youtube-nocookie.com/embed/aircAruvnKk?rel=0&start=451',
    );
  });

  it('leaves the start off when there is nowhere in particular to start', () => {
    expect(embedUrl('aircAruvnKk')).toBe(
      'https://www.youtube-nocookie.com/embed/aircAruvnKk?rel=0',
    );
    expect(embedUrl('aircAruvnKk', 0)).not.toContain('start');
  });

  it('is always on the nocookie host', () => {
    // The learner did not ask to be tracked for reading a lesson.
    expect(embedUrl('aircAruvnKk')).toContain('youtube-nocookie.com');
  });
});

describe('watchUrl', () => {
  it('carries the timestamp in the form YouTube reads', () => {
    expect(watchUrl('aircAruvnKk', 451)).toBe('https://www.youtube.com/watch?v=aircAruvnKk&t=451s');
    expect(watchUrl('aircAruvnKk')).toBe('https://www.youtube.com/watch?v=aircAruvnKk');
  });
});

describe('isVideoId', () => {
  it('accepts exactly YouTube ids', () => {
    expect(isVideoId('aircAruvnKk')).toBe(true);
    expect(isVideoId('_-Ab12cd34E')).toBe(true);
    expect(isVideoId('tooshort')).toBe(false);
    expect(isVideoId('waytoolongtobeanid')).toBe(false);
    expect(isVideoId('has space11')).toBe(false);
  });
});

describe('kindOf', () => {
  it('lets the host overrule the model', () => {
    // The host is evidence; the hint is a claim. Where they disagree and the
    // host knows, the host wins.
    expect(kindOf('https://arxiv.org/abs/1706.03762', 'web')).toBe('paper');
    expect(kindOf('https://github.com/pytorch/pytorch', 'web')).toBe('repo');
    expect(kindOf('https://www.youtube.com/watch?v=aircAruvnKk', 'web')).toBe('video');
  });

  it('never takes "video" from the hint', () => {
    // A video is something we can embed, and we can only embed a host we
    // recognised. Believing the hint would produce a video node with no video.
    expect(kindOf('https://someblog.test/post', 'video')).toBe('web');
  });

  it('falls back to the hint only where the host settles nothing', () => {
    // A real paper can live on a host no list has: a university PDF, a journal.
    // Refusing every hint would file all of those as plain web pages, which is
    // its own kind of wrong.
    expect(kindOf('https://dl.acm.org/doi/10.1145/3292500', 'web')).toBe('paper');
    expect(kindOf('https://unknown.test/x', 'repo')).toBe('repo');
    expect(kindOf('https://unknown.test/x', 'nonsense')).toBe('web');
    expect(kindOf('https://unknown.test/x')).toBe('web');
  });

  it('is not fooled by a lookalike domain', () => {
    expect(kindOf('https://github.com.evil.test/x')).toBe('web');
    expect(kindOf('https://arxiv.org.evil.test/x')).toBe('web');
  });
});

describe('displayHost', () => {
  it('shows where the link goes, without the www', () => {
    expect(displayHost('https://www.youtube.com/watch?v=aircAruvnKk')).toBe('youtube.com');
    expect(displayHost('https://arxiv.org/abs/1706.03762')).toBe('arxiv.org');
  });
});

describe('formatTime', () => {
  it('writes a timestamp the way a video does', () => {
    expect(formatTime(451)).toBe('7:31');
    expect(formatTime(59)).toBe('0:59');
    expect(formatTime(3727)).toBe('1:02:07');
    expect(formatTime(0)).toBe('0:00');
  });
});
