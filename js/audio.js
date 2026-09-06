/* Audio: plays a public radio stream straight from a plain <audio> element.

   No local server and no embedded player. A media element does not need CORS to
   play a cross-origin resource, so the stream URL goes into `src` and that is the
   whole mechanism.

   The one thing that decides whether a given stream works is how its server
   answers a Range request, because a media element always sends one. Streams
   whose ranged response differs from the plain one - SomaFM returns ASCII junk -
   fail with an opaque MEDIA_ERR_SRC_NOT_SUPPORTED. Every URL in stations.js was
   checked on that point. */
(function () {
  const el = new Audio();
  el.preload = 'none';
  let station = null;
  let retries = 0;
  let reconnectTimer = null;
  let blockedByAutoplay = false;
  const handlers = {};

  const on   = (e, fn) => (handlers[e] = handlers[e] || []).push(fn);
  const emit = (e, p)  => (handlers[e] || []).forEach(fn => fn(p));

  function applyVolume() {
    const s = window.Settings.all;
    el.volume = (s.muted || s.volume <= 0) ? 0 : Math.max(0, Math.min(1, s.volume / 100));
  }

  function stop() {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
    el.pause();
    el.removeAttribute('src');
    el.load();
  }

  async function play(next) {
    if (!next || !next.stream) return false;
    clearTimeout(reconnectTimer);
    reconnectTimer = null;

    station = next;
    retries = 0;
    stop();
    // Icecast connections are long-lived; the cache-buster stops the browser
    // reusing one that has already gone stale.
    el.src = next.stream + (next.stream.indexOf('?') < 0 ? '?' : '&') + 't=' + Date.now();
    applyVolume();

    // Nothing to play while the wallpaper is buried behind something. Staging the
    // src and stopping here also avoids starting a connection that resume() would
    // immediately have to tear down.
    if (window.Visibility && window.Visibility.hidden) {
      emit('staged', station);
      return true;
    }

    try {
      await el.play();
      blockedByAutoplay = false;
    } catch (e) {
      if (e && e.name === 'NotAllowedError') {
        // Wallpaper Engine allows autoplay; a plain browser tab may not.
        blockedByAutoplay = true;
        emit('blocked', station);
        return false;
      }
      // AbortError just means something paused us mid-start - the wallpaper got
      // covered, or the user picked another station. Not a failure.
      if (e && e.name === 'AbortError') return false;
      emit('error', { message: e.message, station: next });
      return false;
    }
    emit('playing', station);
    return true;
  }

  function reconnect() {
    if (!station) return;
    const wait = Math.min(30000, 2000 * Math.pow(2, retries));
    emit('reconnecting', { station, attempt: retries + 1 });
    clearTimeout(reconnectTimer);
    reconnectTimer = setTimeout(() => play(station), wait);
  }

  // A radio stream never ends on its own, so 'ended' means the connection dropped.
  el.addEventListener('ended', () => {
    if (station && retries++ < 8) reconnect();
    else emit('error', { message: 'stream ended', station });
  });

  el.addEventListener('error', () => {
    if (!station || !el.src) return;
    if (retries++ < 8) reconnect();
    else emit('error', { message: 'stream failed', station });
  });

  el.addEventListener('playing', () => { retries = 0; emit('playing', station); });
  el.addEventListener('waiting', () => emit('stalled', station));
  el.addEventListener('stalled', () => emit('stalled', station));

  /* If autoplay was refused, the first click or key press starts it. */
  function unblock() {
    if (blockedByAutoplay && station) play(station);
  }
  document.addEventListener('click', unblock);
  document.addEventListener('keydown', unblock);

  window.AudioEngine = {
    play, on, applyVolume, stop,
    pause()  { el.pause(); },
    resume() { if (station && el.src) el.play().catch(() => {}); },
    get current() { return station; },
    get playing() { return !!station && !el.paused; },
    get position() { return el.currentTime || 0; },
    get blocked() { return blockedByAutoplay; }
  };
})();
