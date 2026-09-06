/* Clock, current-wallpaper label and the glass wallpaper list. */
(function () {
  const $ = id => document.getElementById(id);

  /* ---------- clock ---------- */
  function tickClock() {
    const s = window.Settings.all;
    const d = new Date();
    let h = d.getHours();
    let suffix = '';
    if (!s.clock24h) {
      suffix = h >= 12 ? ' PM' : ' AM';
      h = h % 12 || 12;
    }
    const hh = s.clock24h ? String(h).padStart(2, '0') : String(h);
    $('clock-time').textContent = hh + ':' + String(d.getMinutes()).padStart(2, '0') + suffix;
    $('clock-date').textContent = d.toLocaleDateString(undefined,
      { weekday: 'long', month: 'short', day: 'numeric' });
  }

  /* ---------- current wallpaper + what is playing ---------- */
  function setName(station, sub) {
    $('np-title').textContent = station ? station.title : '—';
    $('np-sub').textContent = sub !== undefined ? sub
      : (station && station.streamName ? station.streamName : 'lofi girl');
  }

  function setPlayingState(isPlaying) {
    $('np-eq').classList.toggle('paused', !isPlaying);
  }

  /* ---------- wallpaper list ---------- */
  function renderStations(list, activeId, onPick) {
    const box = $('station-list');
    box.innerHTML = '';
    list.forEach(st => {
      const li = document.createElement('li');
      li.className = 'st' + (st.videoId === activeId ? ' active' : '');
      li.dataset.id = st.videoId;
      li.title = st.title;
      li.innerHTML = '<span class="st-name"></span><span class="st-dot"></span>';
      li.querySelector('.st-name').textContent = st.title;
      li.onclick = () => onPick(st);
      box.appendChild(li);
    });
  }

  function markActive(videoId) {
    let active = null;
    document.querySelectorAll('.st').forEach(el => {
      const on = el.dataset.id === videoId;
      el.classList.toggle('active', on);
      if (on) active = el;
    });
    if (active) active.scrollIntoView({ block: 'nearest' });
  }

  setInterval(tickClock, 1000);
  tickClock();

  window.UI = { setName, setPlayingState, renderStations, markActive, tickClock };
})();
