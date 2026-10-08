/* The meter beside the station name, driven by the radio itself.

   It reads AudioEngine's analyser, which hangs off the wallpaper's own <audio>
   element - not Wallpaper Engine's system audio listener - so it moves with the
   lofi stream only and ignores whatever else the machine is playing.

   It stretches to the right edge, so the bar count follows its width instead of
   being fixed. Bars are spaced on a log scale, because a linear FFT puts almost
   every bin above 5 kHz while lofi lives in the lows and mids. */
(function () {
  const box = document.getElementById('viz');
  const canvas = document.getElementById('viz-canvas');
  const name = document.getElementById('np');
  if (!box || !canvas) return;
  const g = canvas.getContext('2d');
  const GAP = 14;               // between the name and the first bar

  const BAR_PX = 12;            // one bar per this many CSS pixels of width
  const LOW_HZ = 40;
  const HIGH_HZ = 10000;
  const REST = 0.08;            // bar height when there is nothing to show

  let active = false;
  let bars = 0;
  let bins = null;
  let edges = null;
  let laidOutFor = null;
  let level = new Float32Array(0);

  function setBars(n) {
    if (n === bars) return;
    bars = n;
    level = new Float32Array(bars).fill(REST);
    laidOutFor = null;
  }

  // Which FFT bins each bar covers, worked out again when the bar count changes.
  function layout(analyser) {
    const hzPerBin = analyser.context.sampleRate / analyser.fftSize;
    edges = [];
    for (let i = 0; i <= bars; i++) {
      const hz = LOW_HZ * Math.pow(HIGH_HZ / LOW_HZ, i / bars);
      edges.push(Math.max(1, Math.round(hz / hzPerBin)));
    }
    bins = new Uint8Array(analyser.frequencyBinCount);
    laidOutFor = analyser;
  }

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
    setBars(Math.max(16, Math.min(160, Math.round(r.width / BAR_PX))));
  }

  function targets() {
    const A = window.AudioEngine;
    const analyser = A && A.analyser;
    const quiet = !active || !analyser || window.Settings.get('muted') ||
                  (window.Visibility && window.Visibility.hidden);
    if (quiet) return null;

    if (laidOutFor !== analyser) layout(analyser);
    analyser.getByteFrequencyData(bins);

    const out = new Float32Array(bars);
    for (let i = 0; i < bars; i++) {
      const from = edges[i];
      const to = Math.max(from + 1, edges[i + 1]);
      let peak = 0;
      for (let b = from; b < to && b < bins.length; b++) peak = Math.max(peak, bins[b]);
      // Highs carry less energy than lows; a gentle tilt keeps the right side alive.
      const tilt = 1 + 0.6 * (i / (bars - 1));
      out[i] = Math.max(REST, Math.min(1, Math.pow(peak / 255, 1.6) * tilt));
    }
    return out;
  }

  function draw() {
    requestAnimationFrame(draw);
    fit();
    if (!bars) return;

    const t = targets();
    for (let i = 0; i < bars; i++) {
      const want = t ? t[i] : REST;
      // Rise fast, fall slowly, so the bars read as a meter rather than flicker.
      level[i] += (want - level[i]) * (want > level[i] ? 0.55 : 0.12);
    }

    const w = canvas.width;
    const h = canvas.height;
    const gap = Math.max(1, Math.round(w / bars * 0.35));
    const bar = (w - gap * (bars - 1)) / bars;
    const radius = Math.min(bar / 2, 3 * (window.devicePixelRatio || 1));

    g.clearRect(0, 0, w, h);
    g.fillStyle = getComputedStyle(canvas).color;
    for (let i = 0; i < bars; i++) {
      const bh = Math.max(bar, level[i] * h);
      const x = i * (bar + gap);
      const y = h - bh;
      g.beginPath();
      if (g.roundRect) g.roundRect(x, y, bar, bh, radius);
      else g.rect(x, y, bar, bh);
      g.fill();
    }
  }

  requestAnimationFrame(draw);

  window.Visualizer = {
    setActive(on) { active = !!on; }
  };
})();
