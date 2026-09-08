/* Background layer.

   Default source is the current station's own artwork - the thumbnail URL that
   came out of the Downloads dump, at its 1280x720 size. Two stacked layers swap
   opacity so switching station crossfades instead of snapping.

   Fit is whatever the Fit property says, "cover" by default. There is no
   automatic switching: cover and contain are CSS values, so they re-evaluate on
   their own when the screen changes shape and JS never needs to hear about it.

   Each layer also holds a blurred copy of the same picture underneath the sharp
   one. Under cover it is invisible; it only shows if the user picks Contain,
   where it fills what would otherwise be black bars.

   Wallpaper Engine hands file properties over as a plain Windows path, so those
   need turning into file:// URLs before the browser will touch them. */
(function () {
  const stage = () => document.getElementById('bg');
  const layers = () => [document.getElementById('bg-a'), document.getElementById('bg-b')];
  let front = 0;
  let mediaEl = null;
  let lastUrl = '';
  let lastStation = null;   // what apply() last showed, so repaint() can redo it
  let token = 0;

  const BACKSLASH = String.fromCharCode(92);

  function toFileUrl(p) {
    if (!p) return '';
    if (/^(file|https?|data):/i.test(p)) return p;
    return 'file:///' + String(p)
      .split(BACKSLASH).join('/')
      .split('/').map(encodeURIComponent).join('/');
  }

  function sizeValue() {
    const fit = window.Settings.get('bgFit');
    return fit === 'fill' ? '100% 100%' : fit;      // 'cover' | 'contain'
  }

  /* Only needed when the Fit property changes - the CSS keeps itself right. */
  function refit() {
    if (mediaEl) {
      mediaEl.style.objectFit = window.Settings.get('bgFit') === 'fill'
        ? 'fill' : window.Settings.get('bgFit');
      return;
    }
    const size = sizeValue();
    layers().forEach(l => {
      const main = l.querySelector('.bg-main');
      if (main) main.style.backgroundSize = size;
    });
  }

  function clearMedia() {
    if (!mediaEl) return;
    if (mediaEl.tagName === 'VIDEO') {
      mediaEl.pause();
      mediaEl.removeAttribute('src');
      mediaEl.load();
    }
    mediaEl.remove();
    mediaEl = null;
  }

  function clearLayers() {
    layers().forEach(l => {
      l.classList.remove('on');
      l.querySelectorAll('.bg-main,.bg-blur').forEach(c => { c.style.backgroundImage = ''; });
    });
    lastUrl = '';
  }

  /* Redraws whatever is currently showing.

     Sleeping the machine can bring Chromium back having lost the GPU textures
     behind the layers. The element is still there and its background-image is
     still set, so nothing in the page looks wrong - but the layer paints nothing,
     and since the gradient is dropped once artwork is up, what is left on screen
     is #bg's own near-black colour. That is the black wallpaper after waking.

     Re-applying is enough. Clearing lastUrl stops showImageUrl short-circuiting
     on "same url", so the image is decoded and painted into a fresh layer. */
  function repaint() {
    lastUrl = '';
    apply(lastStation);
  }

  function showGradient() {
    clearMedia();
    clearLayers();
    stage().classList.add('gradient');
  }

  /* Crossfades to `url`, falling back to `alt` if the image will not load.

     Requests are sequenced: artwork loads at wildly different speeds, so without
     a token a slow earlier probe finishing late would paint over the station the
     user actually picked. */
  function showImageUrl(url, alt) {
    if (!url || url === lastUrl) return;
    clearMedia();

    const mine = ++token;
    const probe = new Image();

    /* A hanging request fires neither handler - which is what happens for a
       while after the machine wakes, before the network is up. Show the gradient
       so the wallpaper is never a blank near-black screen, and leave the probe
       running: if it completes later, onload still paints over it.

       Cancelled as soon as this attempt resolves. Leaving it armed was what
       broke switching: a station without a maxresdefault falls back to the
       smaller thumbnail, and the stale timer then wiped the artwork that
       fallback had just painted. */
    const timer = setTimeout(() => {
      if (mine === token) showGradient();
    }, 8000);

    probe.onload = () => {
      clearTimeout(timer);
      if (mine !== token) return;              // a newer station won the race
      const next = layers()[1 - front];
      const css = 'url("' + url + '")';
      next.querySelector('.bg-blur').style.backgroundImage = css;
      const main = next.querySelector('.bg-main');
      main.style.backgroundImage = css;
      main.style.backgroundSize = sizeValue();

      next.classList.add('on');
      layers()[front].classList.remove('on');
      front = 1 - front;
      lastUrl = url;
      /* Only now. Dropping the gradient before the image was painted left the
         bare #bg colour showing, which is almost black - exactly what the screen
         looked like after waking the machine. */
      stage().classList.remove('gradient');
    };

    probe.onerror = () => {
      clearTimeout(timer);
      if (mine !== token) return;
      // maxresdefault is missing for plenty of stations; the smaller thumbnail
      // is the same image and always exists. The retry takes the next token, so
      // this attempt's handlers stop mattering on their own.
      if (alt && alt !== url) showImageUrl(alt, null);
      else showGradient();
    };

    probe.src = url;
  }

  function showLocal(tag, path) {
    const url = toFileUrl(path);
    if (!url) return showGradient();
    clearMedia();
    clearLayers();
    const el = document.createElement(tag);
    el.src = url;
    // Same rule as the artwork above: the gradient stays until there is
    // something to replace it with, or a file that will not load leaves the
    // wallpaper showing the bare near-black background colour.
    el.addEventListener(tag === 'video' ? 'loadeddata' : 'load',
                        () => stage().classList.remove('gradient'), { once: true });
    el.style.objectFit = window.Settings.get('bgFit');
    if (tag === 'video') {
      el.loop = true;
      el.muted = true;              // a wallpaper should never make noise on its own
      el.autoplay = true;
      el.playsInline = true;
    }
    el.addEventListener('error', () => {
      console.warn('[lofi] background failed:', url);
      showGradient();
    });
    stage().appendChild(el);
    mediaEl = el;
    if (tag === 'video') el.play().catch(() => {});
  }

  /* Called on boot, on any background setting change, and on every switch. */
  function apply(station) {
    lastStation = station;
    const s = window.Settings.all;
    if (s.bgSource === 'video') return showLocal('video', s.bgVideo);
    if (s.bgSource === 'image') return showLocal('img', s.bgImage);
    if (s.bgSource === 'gradient') return showGradient();
    if (station && station.thumb) return showImageUrl(station.thumb, station.thumbFallback);
    showGradient();
  }

  function setPaused(paused) {
    if (!mediaEl || mediaEl.tagName !== 'VIDEO') return;
    if (paused) mediaEl.pause(); else mediaEl.play().catch(() => {});
  }

  window.Background = { apply, repaint, setPaused, refit, toFileUrl };
})();
