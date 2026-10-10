/* The visualizer beside the station name, driven by the radio itself.

   It reads AudioEngine's analyser, which hangs off the wallpaper's own <audio>
   element - not Wallpaper Engine's system audio listener - so it moves with the
   lofi stream only and ignores whatever else the machine is playing.

   Three looks, picked by the Visualizer setting:
     wave  the signal itself, smoothed into one line
     bars  the spectrum as columns
     dots  the same spectrum as columns of stacked dots */
(function () {
  const box = document.getElementById('viz');
  const canvas = document.getElementById('viz-canvas');
  const name = document.getElementById('np');
  if (!box || !canvas) return;
  const g = canvas.getContext('2d');
  const GAP = 14;               // between the name and where the drawing starts

  let active = false;

  /* The box starts where the name ends and is centred on it. The name is a box
     of its own whose width follows the station title, so CSS alone cannot place
     this; with the name hidden it falls back to the stylesheet's position. */
  function place() {
    // A hidden name measures 0 wide; offsetParent cannot tell, it is null for fixed boxes.
    const n = name ? name.getBoundingClientRect() : null;
    if (n && n.width) {
      box.style.left = Math.round(n.right + GAP) + 'px';
      box.style.top = Math.round(n.top + (n.height - box.offsetHeight) / 2) + 'px';
      box.style.bottom = 'auto';
    } else {
      box.style.left = box.style.top = box.style.bottom = '';
    }
  }

  // Returns the canvas width in CSS pixels, or 0 while the box is hidden.
  function fit() {
    place();
    const r = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const w = Math.round(r.width * dpr);
    const h = Math.round(r.height * dpr);
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    return r.width;
  }

  // The analyser, or null whenever the drawing should rest.
  function source() {
    const A = window.AudioEngine;
    const analyser = A && A.analyser;
    const quiet = !active || !analyser || window.Settings.get('muted') ||
                  (window.Visibility && window.Visibility.hidden);
    return quiet ? null : analyser;
  }

  /* ---------- wave ---------- */

  /* A raw oscilloscope trace is too nervous for a wallpaper: it carries every
     hiss and jumps sideways from frame to frame. So the samples are averaged into
     far fewer points, which keeps the slow shape of the music, the window is
     started on a rising zero crossing so the trace holds still, and each point
     eases towards its new value instead of snapping to it. */
  const POINT_PX = 6;           // one point per this many CSS pixels of width
  const SPAN = 4096;            // samples shown across the width, ~85 ms
  const WAVE_GAIN = 3.2;        // lofi is mixed quiet; this fills the height
  const WAVE_EASE = 0.35;       // how far a point moves towards its target each frame

  let samples = null;
  let wave = new Float32Array(0);

  function drawWave(analyser, cssWidth) {
    const points = Math.max(24, Math.min(400, Math.round(cssWidth / POINT_PX)));
    if (wave.length !== points) wave = new Float32Array(points);

    let want = null;
    if (analyser) {
      if (!samples || samples.length !== analyser.fftSize) samples = new Uint8Array(analyser.fftSize);
      analyser.getByteTimeDomainData(samples);

      const span = Math.min(SPAN, samples.length >> 1);
      let start = 0;
      for (let i = 1; i < samples.length - span; i++) {
        if (samples[i - 1] < 128 && samples[i] >= 128) { start = i; break; }
      }

      want = new Float32Array(points);
      const step = span / points;
      for (let p = 0; p < points; p++) {
        const from = start + Math.floor(p * step);
        const to = Math.max(from + 1, start + Math.floor((p + 1) * step));
        let sum = 0;
        for (let s = from; s < to; s++) sum += samples[s] - 128;
        want[p] = Math.max(-1, Math.min(1, sum / (to - from) / 128 * WAVE_GAIN));
      }
    }
    for (let i = 0; i < points; i++) wave[i] += ((want ? want[i] : 0) - wave[i]) * WAVE_EASE;

    const w = canvas.width;
    const h = canvas.height;
    const line = 2 * (window.devicePixelRatio || 1);
    const mid = h / 2;
    const reach = mid - line;       // keeps the stroke inside the canvas
    const dx = w / (points - 1);

    g.lineWidth = line;
    g.lineJoin = 'round';
    g.lineCap = 'round';

    // Curves through the midpoints, so the line bends instead of showing corners.
    g.beginPath();
    g.moveTo(0, mid - wave[0] * reach);
    for (let i = 1; i < points - 1; i++) {
      const x = i * dx;
      const y = mid - wave[i] * reach;
      const nx = (i + 1) * dx;
      const ny = mid - wave[i + 1] * reach;
      g.quadraticCurveTo(x, y, (x + nx) / 2, (y + ny) / 2);
    }
    g.lineTo(w, mid - wave[points - 1] * reach);
    g.stroke();
  }

  /* ---------- spectrum, shared by bars and dots ---------- */

  /* Columns are spaced on a log scale, because a linear FFT puts almost every bin
     above 5 kHz while lofi lives in the lows and mids. */
  const LOW_HZ = 40;
  const HIGH_HZ = 6000;         // lofi is low-passed; above this the columns just lie flat
  const REST = 0.08;            // column height when there is nothing to show
  const FLOOR = 0.12;           // analyser level drawn as empty
  const CEIL = 0.8;             // analyser level drawn as full

  let bins = null;
  let edges = null;
  let laidOut = '';
  let level = new Float32Array(0);

  function spectrum(analyser, columns) {
    if (level.length !== columns) level = new Float32Array(columns).fill(REST);

    let want = null;
    if (analyser) {
      const key = columns + '/' + analyser.fftSize + '/' + analyser.context.sampleRate;
      if (laidOut !== key) {
        const hzPerBin = analyser.context.sampleRate / analyser.fftSize;
        edges = [];
        for (let i = 0; i <= columns; i++) {
          const hz = LOW_HZ * Math.pow(HIGH_HZ / LOW_HZ, i / columns);
          edges.push(Math.max(1, Math.round(hz / hzPerBin)));
        }
        bins = new Uint8Array(analyser.frequencyBinCount);
        laidOut = key;
      }
      analyser.getByteFrequencyData(bins);

      want = new Float32Array(columns);
      for (let i = 0; i < columns; i++) {
        const from = edges[i];
        const to = Math.max(from + 1, edges[i + 1]);
        let peak = 0;
        for (let b = from; b < to && b < bins.length; b++) peak = Math.max(peak, bins[b]);
        // Highs carry less energy than lows; a gentle tilt keeps the right side alive.
        const tilt = 1 + 0.9 * (i / (columns - 1));
        /* Stretch the range the music actually uses. With bins this narrow a
           column's peak mostly sits between about 0.1 and 0.8 of full scale;
           drawn straight, everything but two or three columns lies flat, and
           lifted with a low exponent they all rise to the same height. */
        const x = Math.max(0, Math.min(1, (peak / 255 - FLOOR) / (CEIL - FLOOR)));
        want[i] = Math.max(REST, Math.min(1, x * tilt));
      }
    }
    for (let i = 0; i < columns; i++) {
      const to = want ? want[i] : REST;
      // Rise fast, fall slowly, so the columns read as a meter rather than flicker.
      level[i] += (to - level[i]) * (to > level[i] ? 0.55 : 0.12);
    }
    return level;
  }

  /* ---------- bars ---------- */

  const BAR_PX = 12;            // one bar per this many CSS pixels of width

  function drawBars(analyser, cssWidth) {
    const bars = Math.max(16, Math.min(160, Math.round(cssWidth / BAR_PX)));
    const lv = spectrum(analyser, bars);

    const w = canvas.width;
    const h = canvas.height;
    const gap = Math.max(1, Math.round(w / bars * 0.35));
    const bar = (w - gap * (bars - 1)) / bars;
    const radius = Math.min(bar / 2, 3 * (window.devicePixelRatio || 1));

    for (let i = 0; i < bars; i++) {
      const bh = Math.max(bar, lv[i] * h);
      g.beginPath();
      if (g.roundRect) g.roundRect(i * (bar + gap), h - bh, bar, bh, radius);
      else g.rect(i * (bar + gap), h - bh, bar, bh);
      g.fill();
    }
  }

  /* ---------- dots ---------- */

  const DOT_PX = 5;             // dot diameter in CSS pixels
  const DOT_GAP_PX = 4;         // space between dots, both ways

  function drawDots(analyser, cssWidth) {
    const dpr = window.devicePixelRatio || 1;
    const dot = DOT_PX * dpr;
    const pitch = (DOT_PX + DOT_GAP_PX) * dpr;
    const w = canvas.width;
    const h = canvas.height;

    const columns = Math.max(16, Math.min(240, Math.floor((w + DOT_GAP_PX * dpr) / pitch)));
    const rows = Math.max(1, Math.floor((h + DOT_GAP_PX * dpr) / pitch));
    const lv = spectrum(analyser, columns);

    // Spread the columns over the whole width, so the last one sits on the right edge.
    const stepX = columns > 1 ? (w - dot) / (columns - 1) : 0;

    for (let i = 0; i < columns; i++) {
      // The bottom dot is always lit, so a quiet stretch still reads as a row.
      const lit = Math.max(1, Math.round(lv[i] * rows));
      const cx = i * stepX + dot / 2;
      for (let r = 0; r < lit; r++) {
        g.beginPath();
        g.arc(cx, h - dot / 2 - r * pitch, dot / 2, 0, Math.PI * 2);
        g.fill();
      }
    }
  }

  /* ---------- loop ---------- */

  const STYLES = { wave: drawWave, bars: drawBars, dots: drawDots };

  function draw() {
    requestAnimationFrame(draw);

    const paint = STYLES[window.Settings.get('vizStyle')];
    if (!paint) return;                      // 'off': the box is hidden
    const cssWidth = fit();
    if (!cssWidth) return;

    g.clearRect(0, 0, canvas.width, canvas.height);
    g.fillStyle = g.strokeStyle = getComputedStyle(canvas).color;
    paint(source(), cssWidth);
  }

  requestAnimationFrame(draw);

  window.Visualizer = {
    setActive(on) { active = !!on; }
  };
})();
