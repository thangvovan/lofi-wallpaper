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
  /* Two independent signals, kept apart on purpose.

     `docHidden` is never seeded from document.hidden and is only ever written by
     a real visibilitychange event. Some hosts report a wallpaper surface as
     hidden from the very first frame and never change it; folding that into the
     result would both silence the wallpaper at boot and make setPaused(false)
     unable to lift it, because the stuck value would win every time. */
  let enginePaused = false;
  let docHidden = false;
  let hidden = false;
  const listeners = [];

  function recompute() { set(enginePaused || docHidden); }

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
    enginePaused = !!isPaused;
    recompute();
  };

  // Outside Wallpaper Engine - a browser tab, a preview - this is all there is.
  document.addEventListener('visibilitychange', () => {
    docHidden = !!document.hidden;
    recompute();
  });

  /* setPaused(true) arrives; setPaused(false) does not always follow.

     Measured here: `wallpaper64.exe -control pause` pauses the wallpaper and the
     page is told, but `-control resume` brings it back without ever saying so. A
     page that trusts the callback alone therefore stays "hidden" for good - which
     is why the wallpaper came back after a sleep with no sound and nothing
     retrying, since every recovery path was gated on that flag.

     Frames are the honest signal. Wallpaper Engine does not draw a paused
     wallpaper, so requestAnimationFrame stops firing; if frames are arriving
     steadily while we still believe we are paused, we are not paused any more,
     whatever we were last told. */
  let frames = 0;
  (function count() { frames++; requestAnimationFrame(count); })();

  setInterval(() => {
    const drawn = frames;
    frames = 0;
    // Two seconds of real rendering. A handful of stray frames during teardown
    // must not be read as the wallpaper being back on screen.
    if (enginePaused && drawn > 20) {
      enginePaused = false;
      recompute();
    }
  }, 2000);

  window.Visibility = {
    get hidden() { return hidden; },
    onChange(fn) { listeners.push(fn); }
  };
})();
