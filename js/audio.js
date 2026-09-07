/* Audio: a single <audio> element pointed at the server in java/.

   The wallpaper used to drive a local process that put sound on the system
   device, which meant it also had to own a session id, a heartbeat and a watchdog
   just to work out when to stop. None of that is here: the audio belongs to the
   page, so Wallpaper Engine's own volume and pause apply to it, and closing the
   page ends the stream by closing the socket.

   What the server is for, all of it measured rather than assumed:
     * googlevideo sends no Access-Control-Allow-Origin, so fetch() cannot read
       the bytes - which also rules out ffmpeg.wasm, since it only works on bytes
       JavaScript already holds. A media element is exempt from CORS, but it
       cannot play a live HLS playlist either.
     * CEF here reports canPlayType "" for AAC and H.264, and a live radio serves
       nothing else. It reports "probably" for Opus in WebM, and a probe in the
       real wallpaper confirmed playback: currentTime ran 0.00 -> 2.10 -> 9.10.
   So the server resolves, downloads and transcodes; this plays the result. */
(function () {
  const audio = new Audio();
  audio.preload = 'none';
  audio.autoplay = false;

  let station = null;
  let live = false;
  let attempt = 0;
  let retryTimer = null;
  const handlers = {};

  const on = (e, fn) => (handlers[e] = handlers[e] || []).push(fn);
  const emit = (e, p) => (handlers[e] || []).forEach(fn => fn(p));

  function base() {
    const url = window.Settings.get('serverUrl') || 'http://127.0.0.1:8477';
    return String(url).trim().replace(/\/+$/, '');
  }

  function wantedVolume() {
    const s = window.Settings.all;
    if (s.muted) return 0;
    return Math.max(0, Math.min(1, (s.volume || 0) / 100));
  }

  /* A fresh query string on every attempt. Without it a reconnect can be served
     from whatever the last failed response left behind, and the retry silently
     replays the failure instead of opening a new stream. */
  function streamUrl(st) {
    return base() + '/stream?id=' + encodeURIComponent(st.videoId) +
           '&t=' + Date.now();
  }

  /* Pausing is not enough to stop the bytes: a paused media element holds its
     connection open and the server keeps sending. Detaching the source is what
     actually closes the socket, which is the difference between paying for the
     hours the wallpaper is visible and paying for all of them. */
  function detach() {
    clearTimeout(retryTimer);
    retryTimer = null;
    live = false;
    audio.pause();
    audio.removeAttribute('src');
    audio.load();
  }

  function attach() {
    if (!station) return;
    audio.volume = wantedVolume();
    audio.src = streamUrl(station);
    audio.play().catch(err => {
      /* AbortError is not a fault. play() returns a promise that only settles
         once playback actually begins, and pausing or changing the source before
         then rejects it - which is exactly what happens every time the wallpaper
         is covered while still connecting. Reporting it put an "AbortError" on
         screen for doing the right thing. */
      if (err.name === 'AbortError') return;

      // NotAllowedError is an autoplay block, not a stream problem - a different
      // fault with a different fix, so the two must not be reported alike.
      emit('error', {
        message: err.name === 'NotAllowedError'
          ? 'autoplay blocked by the browser'
          : err.name + ': ' + err.message,
        station: station
      });
    });
  }

  function scheduleRetry(why) {
    if (!station || retryTimer) return;
    attempt++;
    // 2s, 4s, 8s, 16s, then every 30s. Long enough not to hammer a server that is
    // down, short enough that a blip is invisible.
    const wait = Math.min(30000, 2000 * Math.pow(2, Math.min(attempt - 1, 3)));
    emit('reconnecting', { station: station, attempt: attempt, why: why });
    retryTimer = setTimeout(() => {
      retryTimer = null;
      if (station && !(window.Visibility && window.Visibility.hidden)) attach();
    }, wait);
  }

  audio.addEventListener('playing', () => {
    live = true;
    attempt = 0;
    emit('playing', station);
  });

  audio.addEventListener('waiting', () => emit('stalled', station));
  audio.addEventListener('stalled', () => emit('stalled', station));

  audio.addEventListener('error', () => {
    if (!audio.currentSrc) return;          // detach() clearing the source
    live = false;
    const e = audio.error || {};
    scheduleRetry('media error ' + e.code);
  });

  // A live stream should never end. If it does, the server let go - so reconnect
  // rather than sitting in silence.
  audio.addEventListener('ended', () => { live = false; scheduleRetry('ended'); });

  window.AudioEngine = {
    play(next) {
      if (!next) return false;
      const changed = !station || station.videoId !== next.videoId;
      station = next;
      attempt = 0;
      clearTimeout(retryTimer);
      retryTimer = null;

      if (window.Visibility && window.Visibility.hidden) {
        detach();                            // staged; resume() will start it
        return true;
      }
      if (changed || !live) attach();
      return true;
    },

    /* No restart needed, unlike the old external player: a media element can be
       re-levelled while it plays. */
    applyVolume() {
      audio.volume = wantedVolume();
    },

    async helperUp() {
      try {
        const r = await fetch(base() + '/api/health', { cache: 'no-store' });
        return r.ok;
      } catch (e) {
        return false;
      }
    },

    pause() { detach(); },
    resume() { if (station) attach(); },

    on: on,
    get playing() { return live; }
  };
})();
