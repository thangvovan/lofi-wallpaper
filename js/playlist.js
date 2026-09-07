/* The station list: read from Lofi Girl's playlist, in the page, at runtime.

   The list used to be generated offline and baked into the wallpaper, on the
   belief that a page could not call YouTube's API: the endpoint wants
   Content-Type: application/json, which forces a CORS preflight, and OPTIONS on
   it answers 403 from every origin.

   That was the wrong conclusion from a true measurement. InnerTube does not need
   that content type. Sent as text/plain the request is "simple", so no preflight
   is sent at all, and the response carries Access-Control-Allow-Origin: null -
   which is exactly the origin a file:// wallpaper has. Verified against this
   playlist: 200, 23 stations.

   None of this costs the audio server anything; the wallpaper talks to YouTube
   directly, and only the audio goes through java/.

   There is no baked copy to fall back on, so main.js retries until this works
   rather than leaving the wallpaper with an empty list. */
(function () {
  // The playlist behind the user's own lofi radio script.
  const PLAYLIST_ID = 'PL6NdkXsPL07Il2hEQGcLI4dg_LTg7xA2L';

  /* Where a title stops being a name and starts being a description. Lofi Girl
     titles are "<name> <emoji> <what it is for>", so the first symbol that is
     not a letter, digit or ordinary punctuation marks the end of the name. */
  const DESCRIPTION_STARTS = /[^\p{L}\p{N}\s/&'’,.-]/u;
  const VIDEO_ID = /^[\w-]{11}$/;

  function titleCase(s) {
    return s.replace(/\S+/g, w => w.charAt(0).toUpperCase() + w.slice(1));
  }

  /* Keeps the last `words` words of the name, which is where Lofi Girl puts the
     distinguishing part: "jazz lofi radio", "sad lofi radio", "bossa lofi radio". */
  function shorten(raw, words) {
    const name = String(raw).split(DESCRIPTION_STARTS)[0];
    const parts = name.trim().split(/\s+/).filter(Boolean);
    return titleCase(parts.slice(-words).join(' '));
  }

  /* The playlist gives no time-of-day information, so it is inferred from the
     title for the "auto" station mode. Anything unmatched is left for the day
     bucket, which is the safest default for background music. */
  const MOOD_RULES = [
    [/sleep|dream|ambient|night|dark/i, ['night']],
    [/synth|synthwave|evening|christmas|halloween/i, ['evening']],
    [/morning|sunrise|summer/i, ['morning']],
    [/study|focus|work|piano|classical|jazz|pomodoro/i, ['day']]
  ];

  function moodFor(rawTitle) {
    for (const [re, mood] of MOOD_RULES) if (re.test(rawTitle)) return mood;
    return ['day'];
  }

  function station(videoId, rawTitle, title) {
    return {
      videoId: videoId,
      title: title,
      mood: moodFor(rawTitle),
      // Straight from Google's CDN, never through the audio server: it is faster
      // and it keeps artwork off the server's bandwidth bill entirely.
      thumb: 'https://i.ytimg.com/vi/' + videoId + '/maxresdefault.jpg',
      thumbFallback: 'https://i.ytimg.com/vi/' + videoId + '/hqdefault.jpg'
    };
  }

  /* The playlist's first entry is the channel's flagship stream, and its title -
     "lofi hip hop radio" - is word for word the same as one further down. Left to
     the formula both want "Hip Hop Radio", and the flagship, being first, would
     take it and push the other to the clumsier "Lofi Hip Hop Radio".

     So the flagship is named after the channel instead, and the formula name is
     left to the entry that has nothing else to be called. The check is on the
     title rather than the position alone: if the playlist is reordered, or that
     stream is renamed, this stops applying rather than mislabelling whatever
     happens to be first. */
  const FLAGSHIP = 'Lofi Radio';

  function flagshipName(rawTitle) {
    return /lofi/i.test(rawTitle) && /radio/i.test(rawTitle) ? FLAGSHIP : null;
  }

  /* Three words names almost every other station. Where two would collide, the
     later one takes more words until it is unique.

     Ties are settled by playlist order, so the same playlist always produces the
     same names and a station does not get renamed just because another was added
     above it. */
  function nameAll(entries) {
    const taken = new Set();

    return entries.map((entry, i) => {
      if (i === 0) {
        const flag = flagshipName(entry.rawTitle);
        if (flag) {
          taken.add(flag);
          return flag;
        }
      }

      for (let words = 3; words <= 8; words++) {
        const title = shorten(entry.rawTitle, words);
        if (!taken.has(title)) {
          taken.add(title);
          return title;
        }
        // The whole name is already used, so widening further cannot help.
        if (title === shorten(entry.rawTitle, words + 1)) break;
      }

      // Two identical names in one playlist. Numbering is ugly but it is honest,
      // and it keeps the list from showing the same entry twice.
      const base = shorten(entry.rawTitle, 3);
      let n = 2;
      while (taken.has(base + ' ' + n)) n++;
      taken.add(base + ' ' + n);
      return base + ' ' + n;
    });
  }

  /* YouTube's newer layout wraps each entry in a lockupViewModel rather than the
     playlistVideoRenderer older code looked for, so this walks the tree for those
     instead of following a fixed path that a layout change would break. */
  function collect(node, out) {
    if (!node || typeof node !== 'object') return out;
    if (Array.isArray(node)) {
      node.forEach(n => collect(n, out));
      return out;
    }
    const lockup = node.lockupViewModel;
    if (lockup && VIDEO_ID.test(String(lockup.contentId || ''))) {
      // contentType is not always present - two of this playlist's entries come
      // back without it - so an entry is only rejected when YouTube says outright
      // that it is something other than a video. The id shape does the rest.
      const type = lockup.contentType;
      const isVideo = !type || type === 'LOCKUP_CONTENT_TYPE_VIDEO';
      const title = (((lockup.metadata || {}).lockupMetadataViewModel || {}).title || {}).content;
      if (isVideo && title && !out.some(e => e.videoId === lockup.contentId)) {
        out.push({ videoId: lockup.contentId, rawTitle: title });
      }
    }
    Object.keys(node).forEach(k => collect(node[k], out));
    return out;
  }

  async function load() {
    const res = await fetch('https://www.youtube.com/youtubei/v1/browse?prettyPrint=false', {
      method: 'POST',
      // text/plain on purpose: it keeps this a simple request, so the browser
      // sends no preflight. application/json would trigger one, and OPTIONS on
      // this endpoint answers 403.
      headers: { 'Content-Type': 'text/plain' },
      body: JSON.stringify({
        browseId: 'VL' + PLAYLIST_ID,
        context: {
          client: {
            clientName: 'WEB',
            clientVersion: '2.20240101.01.00',
            hl: 'en',
            gl: 'US'
          }
        }
      })
    });
    if (!res.ok) throw new Error('playlist http ' + res.status);

    const entries = collect(await res.json(), []);
    if (!entries.length) throw new Error('playlist returned no stations');

    const titles = nameAll(entries);
    return entries.map((e, i) => station(e.videoId, e.rawTitle, titles[i]));
  }

  /* Time-of-day buckets for the "auto" station mode. Lives here rather than with
     the list itself, because it is the other half of the same guesswork: moodFor
     labels a station, this decides which label the hour wants. */
  window.MOOD_FOR_HOUR = function (h) {
    if (h >= 5 && h < 10) return 'morning';
    if (h >= 10 && h < 17) return 'day';
    if (h >= 17 && h < 22) return 'evening';
    return 'night';
  };

  window.Playlist = { load: load };
})();
