/* Settings bridge: defaults + Wallpaper Engine user properties.
   Every key here has a matching entry in project.json -> general.properties. */
(function () {
  const defaults = {
    stationMode: 'auto',     // 'auto' (by time of day) | 'shuffle' | 'fixed'
    stationId  : '',
    volume     : 100,
    muted      : false,
    serverUrl  : 'http://127.0.0.1:8477',

    bgSource   : 'thumb',    // 'thumb' | 'gradient' | 'video' | 'image'
    bgVideo    : '',
    bgImage    : '',
    bgFit      : 'cover',   // 'cover' | 'contain' | 'fill'
    bgFade     : 1.2,        // seconds

    dim        : 35,         // 0-100
    blur       : 0,          // 0-40 px
    saturation : 100,        // 40-140 %
    vignette   : 55,         // 0-100
    grain      : 5,          // 0-30

    showList   : true,
    listOpacity: 42,         // 10-90, drives the glass panel's alpha
    showClock  : true,
    clock24h   : true,
    showName   : true,
    hudOpacity : 100,
    accent     : '216,199,168'
  };

  const S = Object.assign({}, defaults);
  const listeners = [];

  function set(key, value) {
    if (!(key in S) || S[key] === value) return;
    S[key] = value;
    listeners.forEach(fn => fn(key, value));
  }

  function applyVisuals() {
    const r = document.documentElement.style;
    r.setProperty('--grade-opacity', (S.dim / 100 * 2).toFixed(3));
    r.setProperty('--vignette', (S.vignette / 100).toFixed(3));
    r.setProperty('--grain', (S.grain / 100).toFixed(3));
    r.setProperty('--ui-opacity', (S.hudOpacity / 100).toFixed(3));
    r.setProperty('--accent', 'rgb(' + S.accent + ')');
    r.setProperty('--glass', 'rgba(14,12,20,' + (S.listOpacity / 100).toFixed(2) + ')');
    r.setProperty('--bg-fade', S.bgFade + 's');

    const bg = document.getElementById('bg');
    if (bg) {
      const f = [];
      if (S.blur > 0) f.push('blur(' + S.blur + 'px)');
      if (S.saturation !== 100) f.push('saturate(' + S.saturation + '%)');
      bg.style.filter = f.join(' ');
      if (window.Background) window.Background.refit();
    }

    const toggle = (id, on) => {
      const el = document.getElementById(id);
      if (el) el.classList.toggle('off', !on);
    };
    toggle('stations', S.showList);
    toggle('clock', S.showClock);
    toggle('np', S.showName);
  }

  /* Wallpaper Engine hands colours over as "r g b" floats in 0..1 */
  function weColor(str) {
    return String(str).split(' ').map(c => Math.round(parseFloat(c) * 255)).join(',');
  }

  window.Settings = {
    get all() { return S; },
    get(k) { return S[k]; },
    set,
    onChange(fn) { listeners.push(fn); },
    applyVisuals
  };

  const MAP = {
    stationmode: 'stationMode', stationid: 'stationId',
    volume: 'volume', muted: 'muted', serverurl: 'serverUrl',
    bgsource: 'bgSource', bgvideo: 'bgVideo', bgimage: 'bgImage',
    bgfit: 'bgFit', bgfade: 'bgFade',
    dim: 'dim', blur: 'blur', saturation: 'saturation', vignette: 'vignette',
    grain: 'grain', showlist: 'showList', listopacity: 'listOpacity',
    showclock: 'showClock', clock24h: 'clock24h',
    showname: 'showName', hudopacity: 'hudOpacity'
  };

  window.wallpaperPropertyListener = {
    applyUserProperties(p) {
      for (const weKey in MAP) {
        if (p[weKey] !== undefined) set(MAP[weKey], p[weKey].value);
      }
      if (p.accent !== undefined) set('accent', weColor(p.accent.value));
      applyVisuals();
    },
    applyGeneralProperties() { /* nothing needed yet */ }
  };
})();
