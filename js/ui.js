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
    $('np-sub').textContent = sub !== undefined ? sub : 'lofi girl';
  }

  function setPlayingState(isPlaying) {
    $('np-eq').classList.toggle('paused', !isPlaying);
  }

  /* ---------- audio status ---------- */
  function setNotice(text) {
    const n = $('notice');
    if (!n) return;
    if (!text) { n.classList.add('hidden'); return; }
    $('notice-text').textContent = text;
    n.classList.remove('hidden');
  }

  /* ---------- wallpaper list ---------- */

  /* How many entries the panel shows before it starts scrolling. The playlist
     runs to 23 stations, and a list that long buries the artwork it exists to
     choose between. */
  const VISIBLE_ROWS = 10;

  /* Sized from a real row rather than a guess in CSS, so the panel still cuts off
     at ten entries if the font or padding changes. Measured after the rows are in
     the document, because an unrendered element has no height. */
  function capHeight(box) {
    const first = box.firstElementChild;
    if (!first || box.children.length <= VISIBLE_ROWS) {
      box.style.maxHeight = '';
      return;
    }
    const row = first.getBoundingClientRect().height;
    if (!row) return;
    const padding = parseFloat(getComputedStyle(box).paddingTop) || 0;
    // Half a row of the eleventh entry stays visible: nothing else says "there is
    // more below" as plainly, and Wallpaper Engine may not draw a scrollbar.
    box.style.maxHeight = (row * (VISIBLE_ROWS + 0.5) + padding * 2) + 'px';
  }

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
    capHeight(box);
    markEdges();
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

  /* Scrolling the list.

     Wallpaper Engine delivers mousemove, pointermove, mousedown and click to a
     wallpaper, but NOT wheel - probed inside the real surface, where a wheel over
     the list produced no event of any kind. So there is nothing to hook: the list
     scrolls by hovering its top or bottom edge instead, faster the closer the
     pointer gets to the edge.

     The wheel handler below is still worth having because the same page opens in
     an ordinary browser during development, where the wheel does work. */
  let markEdges = () => {};

  (function enableScrolling() {
    const box = $('station-list');
    const panel = $('stations');
    if (!box) return;

    const room = () => box.scrollHeight - box.clientHeight;

    /* Tells the reader which way there is more to go. Wallpaper Engine may draw no
       scrollbar at all, so without this a capped list looks like the whole list. */
    markEdges = function () {
      if (!panel) return;
      panel.classList.toggle('more-up', box.scrollTop > 2);
      panel.classList.toggle('more-down', box.scrollTop < room() - 2);
    };

    let speed = 0;
    let frame = null;

    function step() {
      if (!speed || room() <= 0) { frame = null; return; }
      box.scrollTop = Math.max(0, Math.min(room(), box.scrollTop + speed));
      markEdges();
      frame = requestAnimationFrame(step);
    }

    box.addEventListener('mousemove', e => {
      const r = box.getBoundingClientRect();
      // A band at each end, never more than about a row and a half, so the middle
      // of the list stays a safe place to aim at an entry.
      const band = Math.min(48, r.height * 0.22);
      const top = e.clientY - r.top;
      const bottom = r.bottom - e.clientY;

      if (top < band) speed = -9 * (1 - top / band);
      else if (bottom < band) speed = 9 * (1 - bottom / band);
      else speed = 0;

      if (speed && !frame) frame = requestAnimationFrame(step);
    });

    box.addEventListener('mouseleave', () => { speed = 0; });
    box.addEventListener('scroll', markEdges);

    // Works in a browser; never fires under Wallpaper Engine.
    box.addEventListener('wheel', e => {
      if (room() <= 0) return;
      const before = box.scrollTop;
      box.scrollTop = Math.max(0, Math.min(room(), before + e.deltaY * 0.6));
      if (box.scrollTop !== before) e.preventDefault();
    }, { passive: false });

  })();

  setInterval(tickClock, 1000);
  tickClock();

  window.UI = { setName, setPlayingState, setNotice, renderStations, markActive, tickClock };
})();
