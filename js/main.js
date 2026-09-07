/* Boot sequence, wallpaper switching and the radio that goes with it.

   Picking an entry changes two things: the artwork behind everything, and the
   station the audio server is asked for. The list itself is read from YouTube at
   runtime by js/playlist.js rather than baked into the wallpaper. */
(function () {
  const S = window.Settings;
  const A = window.AudioEngine;
  let stations = [];
  let index = 0;
  let current = null;
  let shuffleBag = [];

  /* ---------- choosing a wallpaper ---------- */

  function pickAuto() {
    const mood = window.MOOD_FOR_HOUR(new Date().getHours());
    const pool = stations.filter(s => (s.mood || []).includes(mood));
    return (pool.length ? pool : stations)[0];
  }

  function pickShuffle() {
    if (!shuffleBag.length) {
      shuffleBag = stations.slice();
      for (let i = shuffleBag.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [shuffleBag[i], shuffleBag[j]] = [shuffleBag[j], shuffleBag[i]];
      }
      if (current && shuffleBag[0].videoId === current.videoId && shuffleBag.length > 1) {
        shuffleBag.push(shuffleBag.shift());
      }
    }
    return shuffleBag.shift();
  }

  function resolveStation() {
    const mode = S.get('stationMode');
    if (mode === 'shuffle') return pickShuffle();
    if (mode === 'fixed') {
      return stations.find(s => s.videoId === S.get('stationId')) || stations[0];
    }
    return pickAuto();
  }

  /* ---------- switching ---------- */

  function switchTo(st) {
    if (!st) return;
    current = st;
    index = Math.max(0, stations.findIndex(s => s.videoId === st.videoId));
    // Artwork first - it is local work and should not wait on the network.
    window.Background.apply(st);
    window.UI.markActive(st.videoId);
    window.UI.setName(st, 'connecting…');
    window.UI.setPlayingState(false);
    A.play(st);
  }

  /* Setting mode and id is two writes, and each one fires onChange. Between them
     the pair is inconsistent - mode "fixed" with the id not yet written resolves
     to stations[0] - so the listener is muted while we write both, and the switch
     happens once, here. */
  let picking = false;

  function pick(st) {
    picking = true;
    S.set('stationMode', 'fixed');
    S.set('stationId', st.videoId);
    picking = false;
    switchTo(st);
  }

  function step(dir) {
    if (!stations.length) return;
    if (S.get('stationMode') === 'shuffle') return switchTo(pickShuffle());
    index = (index + dir + stations.length) % stations.length;
    pick(stations[index]);
  }

  /* ---------- player availability ---------- */

  let helperPoll = null;

  async function ensureHelper() {
    if (await A.helperUp()) {
      clearInterval(helperPoll);
      helperPoll = null;
      window.UI.setNotice('');
      return true;
    }
    window.UI.setNotice('Cannot reach the audio server at ' + S.get('serverUrl') +
                        ' - check it is running, and that Server URL is set correctly.');
    if (!helperPoll) {
      helperPoll = setInterval(async () => {
        if (!await A.helperUp()) return;
        clearInterval(helperPoll);
        helperPoll = null;
        window.UI.setNotice('');
        if (current) switchTo(current);
      }, 5000);
    }
    return false;
  }

  /* ---------- wiring ---------- */

  S.onChange(key => {
    if (key === 'bgSource' || key === 'bgVideo' || key === 'bgImage' ||
        key === 'bgFit' || key === 'bgFade') {
      window.Background.apply(current);
    }
    if ((key === 'stationMode' || key === 'stationId') && !picking) {
      const st = resolveStation();
      if (st && st.videoId !== (current && current.videoId)) switchTo(st);
    }
    if (key === 'volume' || key === 'muted') A.applyVolume();
    if (key === 'clock24h') window.UI.tickClock();
    if (key === 'serverUrl') ensureHelper();
  });

  A.on('playing', st => {
    window.UI.setPlayingState(true);
    window.UI.setName(st);
    window.UI.setNotice('');
  });

  A.on('stalled', st => window.UI.setName(st, 'buffering…'));
  /* Coming back from being covered always costs a reconnect, so the first couple
     of attempts are ordinary life rather than news. Only a run of failures means
     something is actually wrong and is worth a notice. */
  A.on('reconnecting', info => {
    window.UI.setPlayingState(false);
    window.UI.setName(info.station, 'reconnecting…');
    if (info.attempt >= 3) {
      window.UI.setNotice('Cannot reach the audio server (' + info.why +
                          ') - retry ' + info.attempt);
    }
  });
  A.on('error', err => {
    console.warn('[lofi] audio:', err.message);
    window.UI.setPlayingState(false);
    window.UI.setName(err.station, 'audio unavailable');
    if (err.helper) ensureHelper();
    else window.UI.setNotice(err.message);
  });

  /* Only make noise while the wallpaper is actually on screen. Visibility comes
     from the frame clock, because Wallpaper Engine stops rendering a covered
     wallpaper without telling the page anything. */
  window.Visibility.onChange(hidden => {
    if (hidden) A.pause(); else A.resume();
    window.Background.setPaused(hidden);
    // The meter has to follow, or it keeps bouncing over silence.
    window.UI.setPlayingState(!hidden && A.playing);
  });

  /* Keyboard, for when Wallpaper Engine passes input through. */
  document.addEventListener('keydown', e => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowRight') step(1);
    else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') step(-1);
    else if (e.key === 'm') { S.set('muted', !S.get('muted')); A.applyVolume(); }
  });

  /* "Auto" means by time of day, so it has to re-check as the day moves on.
     Once an hour is plenty and costs nothing while nothing changes. */
  function watchClockBucket() {
    let bucket = window.MOOD_FOR_HOUR(new Date().getHours());
    setInterval(() => {
      const now = window.MOOD_FOR_HOUR(new Date().getHours());
      if (now === bucket) return;
      bucket = now;
      if (S.get('stationMode') === 'auto') switchTo(pickAuto());
    }, 5 * 60 * 1000);
  }

  /* The playlist is the only source of stations: nothing is stored between runs
     and nothing is baked in. That keeps the list correct when Lofi Girl restarts
     a stream under a fresh video id, at the cost of about half a second before
     the first sound - and it means a failed fetch leaves the wallpaper with
     nothing to play, so this retries rather than settling for an empty list. */
  let listRetry = null;

  function adopt(list) {
    stations = list;
    shuffleBag = [];                 // built from the old list; ids may have gone
    window.UI.renderStations(stations, current && current.videoId, pick);

    // Keep playing whatever is playing. Only re-point at the fresh object, so a
    // renamed station or new artwork is picked up without interrupting audio.
    const same = current && stations.find(s => s.videoId === current.videoId);
    if (same) {
      current = same;
      index = stations.indexOf(same);
      window.UI.markActive(same.videoId);
      window.UI.setName(same);
    } else {
      switchTo(resolveStation());    // first run, or the station we were on is gone
    }
  }

  async function loadStations() {
    let live;
    try {
      live = await window.Playlist.load();
    } catch (e) {
      console.warn('[lofi] playlist:', e.message);
      if (!stations.length) {
        window.UI.setNotice('Cannot load the station list from YouTube - retrying');
      }
      if (!listRetry) listRetry = setInterval(loadStations, 15000);
      return;
    }
    if (!live.length) return;

    clearInterval(listRetry);
    listRetry = null;
    if (!stations.length) window.UI.setNotice('');
    adopt(live);
  }

  async function start() {
    S.applyVisuals();
    window.Background.apply(null);
    ensureHelper();                  // deliberately not awaited
    window.UI.renderStations([], null, pick);
    await loadStations();
    watchClockBucket();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
