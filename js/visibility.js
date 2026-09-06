/* Tells the rest of the wallpaper whether it should be making noise.

   Wallpaper Engine calls setPaused(true) when it pauses a wallpaper, which is
   what happens when something covers it. That is the supported signal - the
   engine's own author states that detecting focus from inside the page is not
   possible, so there is nothing cleverer to reach for here.

   WHEN THIS FIRES IS A WALLPAPER ENGINE SETTING, not something the page decides:
   Settings -> Performance -> "Other applications maximized" / "fullscreen".
   On "Keep running" the engine never pauses anything and the music keeps going,
   which is exactly what that option asks for. Set those to Pause (or Mute) for
   the wallpaper to go quiet behind other windows. */
(function () {
  let hidden = false;
  const listeners = [];

  function set(next) {
    if (next === hidden) return;
    hidden = next;
    listeners.forEach(fn => fn(hidden));
  }

  // settings.js creates this object first; augment it rather than replacing it,
  // or whichever script ran last would silently win.
  const listener = window.wallpaperPropertyListener =
    window.wallpaperPropertyListener || {};

  listener.setPaused = function (isPaused) {
    set(!!isPaused || document.hidden);
  };

  // Outside Wallpaper Engine - a browser tab, a preview - this is all there is.
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) set(true);
    else set(false);
  });

  window.Visibility = {
    get hidden() { return hidden; },
    onChange(fn) { listeners.push(fn); }
  };
})();
