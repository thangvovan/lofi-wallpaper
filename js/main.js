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

  /* Which station the wallpaper opens on: one draw from the list that was just
     fetched, so it is a different one each time and never the same station on
     every boot. Nothing steps on from here - picking is a start-up decision, not
     a mode the wallpaper stays in. */
  function randomStation() {
    return stations[Math.floor(Math.random() * stations.length)];
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

  function step(dir) {
    if (!stations.length) return;
    index = (index + dir + stations.length) % stations.length;
    switchTo(stations[index]);
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

  /* The playlist is the only source of stations: nothing is stored between runs
     and nothing is baked in. That keeps the list correct when Lofi Girl restarts
     a stream under a fresh video id, at the cost of about half a second before
     the first sound - and it means a failed fetch leaves the wallpaper with
     nothing to play, so this retries rather than settling for an empty list. */
  let listRetry = null;

  function adopt(list) {
    stations = list;
    window.UI.renderStations(stations, current && current.videoId, switchTo);

    // Keep playing whatever is playing. Only re-point at the fresh object, so a
    // renamed station or new artwork is picked up without interrupting audio.
    const same = current && stations.find(s => s.videoId === current.videoId);
    if (same) {
      current = same;
      index = stations.indexOf(same);
      window.UI.markActive(same.videoId);
      window.UI.setName(same);
    } else {
      switchTo(randomStation());     // first run, or the station we were on is gone
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
    window.UI.renderStations([], null, switchTo);
    await loadStations();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
