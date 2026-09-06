"""Builds js/stations.js from the yt-dlp playlist dump in the Downloads folder.

Source: "%USERPROFILE%/Downloads/lofi radio/urls.py" - a literal dict written by
`lofi radio.py`, holding the 19 Lofi Girl radio stations with their ids, watch
URLs and thumbnails.

Titles are shortened the way the mobile app does it
(lofi-audio/lib/services/youtube_service.dart::_filterChannelTitle): cut at the
first emoji, keep the last three words, widen to four if two stations collide.

Run:  python tools/import_stations.py [--source PATH]
"""
import argparse
import ast
import io
import json
import os
import re

ROOT = os.path.normpath(os.path.join(os.path.dirname(__file__), ".."))
OUT = os.path.join(ROOT, "js", "stations.js")
PROJECT = os.path.join(ROOT, "project.json")
DEFAULT_SOURCE = os.path.join(os.path.expanduser("~"), "Downloads", "lofi radio", "urls.py")

EMOJI = re.compile(
    "[\U0001F300-\U0001F9FF☀-⛿✀-➿"
    "\U0001F600-\U0001F64F\U0001F680-\U0001F6FF]"
)


def title_case(s):
    return " ".join(w[:1].upper() + w[1:].lower() if w else w for w in s.split(" "))


def short_title(raw, used):
    """Cut at the first emoji, keep the last three words, widen on a collision."""
    head = EMOJI.split(raw)[0]
    words = [w for w in head.strip().split() if w]
    if not words:
        return title_case(raw)
    out = title_case(" ".join(words[-min(3, len(words)):]))
    if out in used and len(words) > 3:
        out = title_case(" ".join(words[-4:]))
    used.add(out)
    return out


def mood_of(raw):
    t = raw.lower()
    if re.search(r"sleep|dream|ambient|night|rain|fireplace|deep", t):
        return ["night"]
    if re.search(r"jazz|sad|synthwave|game|christmas|halloween", t):
        return ["evening"]
    if re.search(r"piano|classical|pomodoro|study with me", t):
        return ["morning", "work"]
    return ["day"]


# Audio streams. Lofi Girl's own audio is unreachable without a local helper
# (see README), so each wallpaper is paired with a public radio stream instead.
# Every URL here was checked two ways: the bytes must be a real MP3/AAC frame,
# and they must be identical with and without a Range header - SomaFM answers a
# ranged request with ASCII junk, and a media element always sends one.
STREAMS = {
    "lofi":         ("https://stream.laut.fm/lofi",         "laut.fm lofi"),
    "chillout":     ("https://stream.laut.fm/chillout",     "laut.fm chillout"),
    "jazz":         ("https://stream.laut.fm/jazz",         "laut.fm jazz"),
    "ambient":      ("https://stream.laut.fm/ambient",      "laut.fm ambient"),
    "nature":       ("https://stream.laut.fm/nature",       "laut.fm nature"),
    "meditation":   ("https://stream.laut.fm/meditation",   "laut.fm meditation"),
    "instrumental": ("https://stream.laut.fm/instrumental", "laut.fm instrumental"),
    "relax":        ("https://stream.laut.fm/relax",        "laut.fm relax"),
}

# First match wins, so the specific patterns come before the broad ones. Note
# what is NOT here: a bare "study". Nearly every Lofi Girl title ends in
# "beats to relax/study to", so matching it would drag half the list onto one
# stream - only the actual study station says "study with me".
STREAM_FOR = [
    (r"rain|forest|nature|fireplace",   "nature"),
    (r"sleep|dream|deep sleep|nap",     "meditation"),
    (r"jazz|bossa",                     "jazz"),
    (r"piano|classical",                "instrumental"),
    (r"study with me|pomodoro",         "instrumental"),
    (r"synthwave|dark ambient|ambient|space", "ambient"),
    (r"guitar|medieval|christmas|halloween|sad", "relax"),
    (r"lofi|hip hop|chill|summer|asian", "lofi"),
]


def stream_for(raw):
    t = raw.lower()
    for pattern, key in STREAM_FOR:
        if re.search(pattern, t):
            return STREAMS[key]
    return STREAMS["lofi"]


def best_dump_thumb(entry):
    """Largest thumbnail the dump actually carries (they top out around 336px)."""
    thumbs = entry.get("thumbnails") or []
    if not thumbs:
        return ""
    return max(thumbs, key=lambda t: (t.get("width") or 0) * (t.get("height") or 0))["url"]


PLAYLIST_ID = "PL6NdkXsPL07Il2hEQGcLI4dg_LTg7xA2L"


def current_playlist():
    """Live ids straight from the playlist, keyed by full title.

    Lofi Girl restarts a stream with a fresh video id every so often, so ids in a
    saved dump go stale - the dump's "lofi hip hop radio" entry is already dead.
    This runs outside the browser, where the InnerTube endpoint answers fine (a
    page cannot call it: the CORS preflight is refused with 403).
    """
    import urllib.request

    body = json.dumps({
        "browseId": "VL" + PLAYLIST_ID,
        "context": {"client": {"clientName": "WEB", "clientVersion": "2.20240101.01.00",
                               "hl": "en", "gl": "US"}},
    }).encode()
    req = urllib.request.Request(
        "https://www.youtube.com/youtubei/v1/browse?prettyPrint=false", data=body,
        headers={"Content-Type": "application/json",
                 "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0"})
    with urllib.request.urlopen(req, timeout=30) as r:
        data = json.loads(r.read().decode("utf-8"))

    items = (data["contents"]["twoColumnBrowseResultsRenderer"]["tabs"][0]["tabRenderer"]
             ["content"]["sectionListRenderer"]["contents"][0]["itemSectionRenderer"]["contents"])
    out = {}
    for it in items:
        lv = it.get("lockupViewModel")
        if lv and lv.get("contentId"):
            raw = (lv.get("metadata", {}).get("lockupMetadataViewModel", {})
                   .get("title", {}).get("content", ""))
            out[raw] = lv["contentId"]
    return out


def refresh_ids(rows):
    """Swaps stale ids for the ones the playlist serves today, matching on title.

    Matching uses each station's *raw* title, not the display one: the first entry
    is forced to "Lofi Radio", which would never line up with the playlist's own
    "lofi hip hop radio ..." wording."""
    try:
        live = current_playlist()
    except Exception as e:
        print("  ! could not reach the playlist (%s) - keeping the dump's ids" % str(e)[:60])
        return rows

    live_ids = set(live.values())
    # Match on the shortened title, which survives Lofi Girl's title tweaks better
    # than the raw one with its emoji and slash-separated tail.
    # A fresh `used` set per title keeps this the plain last-three-words form,
    # with no dedupe widening, so both sides shorten identically.
    by_short = {}
    for raw, vid in live.items():
        by_short.setdefault(short_title(raw, set()), vid)

    swapped = 0
    for r in rows:
        if r["videoId"] in live_ids:
            continue
        replacement = by_short.get(short_title(r["_raw"], set()))
        if replacement and replacement != r["videoId"]:
            print("  ~ %s: %s -> %s (stream restarted)" % (r["title"], r["videoId"], replacement))
            r["videoId"] = replacement
            r["url"] = "https://www.youtube.com/watch?v=" + replacement
            r["thumb"] = "https://i.ytimg.com/vi/%s/maxresdefault.jpg" % replacement
            r["thumbFallback"] = ""      # the dump's signed URL belongs to the old id
            swapped += 1
        else:
            print("  ! %s (%s) is gone and has no match in the playlist" % (r["title"], r["videoId"]))
    print("  refreshed %d stale id(s)" % swapped)
    return rows


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--source", default=DEFAULT_SOURCE)
    ap.add_argument("--verify", action="store_true",
                    help="check ids against the live playlist and replace stale ones")
    args = ap.parse_args()

    if not os.path.exists(args.source):
        raise SystemExit("cannot find the dump at %s" % args.source)

    data = ast.literal_eval(io.open(args.source, encoding="utf-8").read())
    entries = data.get("entries") or []
    if not entries:
        raise SystemExit("no entries in the dump")

    used, rows = set(), []
    for e in entries:
        vid = e.get("id")
        if not vid:
            continue
        raw = e.get("title") or vid
        if not rows:
            used.add("Lofi Radio")
            title = "Lofi Radio"
        else:
            title = short_title(raw, used)
        rows.append({
            "videoId": vid,
            "title": title,
            "url": e.get("url") or ("https://www.youtube.com/watch?v=" + vid),
            # The dump's own thumbnails cap at ~336x188, far too small to fill a
            # desktop, so the wallpaper uses the 1280x720 variant of the same
            # image and keeps the dump's URL as a fallback.
            "thumb": "https://i.ytimg.com/vi/%s/maxresdefault.jpg" % vid,
            "thumbFallback": best_dump_thumb(e),
            "mood": mood_of(raw),
            "stream": stream_for(raw)[0],
            "streamName": stream_for(raw)[1],
            "_raw": raw,
        })

    if args.verify:
        print("verifying ids against the live playlist...")
        rows = refresh_ids(rows)

    lines = []
    for r in rows:
        r.pop("_raw", None)
        lines.append(
            "  {\n"
            "    videoId: '%s',\n"
            "    title: '%s',\n"
            "    mood: %s,\n"
            "    stream: '%s',\n"
            "    streamName: '%s',\n"
            "    url: '%s',\n"
            "    thumb: '%s',\n"
            "    thumbFallback: '%s'\n"
            "  }" % (
                r["videoId"], r["title"].replace("'", "\\'"),
                json.dumps(r["mood"]).replace('"', "'"),
                r["stream"], r["streamName"],
                r["url"], r["thumb"], r["thumbFallback"]))

    js = ("/* Lofi Girl radio stations, imported from the yt-dlp playlist dump.\n"
          "   Regenerate with:  python tools/import_stations.py\n\n"
          "   Titles are shortened with the mobile app's rule (last three words,\n"
          "   title case). `thumb` doubles as the wallpaper background. */\n"
          "window.STATIONS = [\n" + ",\n".join(lines) + "\n];\n\n"
          "/* Time-of-day buckets used by the \"auto\" station mode. */\n"
          "window.MOOD_FOR_HOUR = function (h) {\n"
          "  if (h >= 5  && h < 10) return 'morning';\n"
          "  if (h >= 10 && h < 17) return 'day';\n"
          "  if (h >= 17 && h < 22) return 'evening';\n"
          "  return 'night';\n"
          "};\n")
    with io.open(OUT, "w", encoding="utf-8", newline="\n") as f:
        f.write(js)
    print("wrote %s (%d stations)" % (OUT, len(rows)))

    with io.open(PROJECT, encoding="utf-8") as f:
        project = json.load(f)
    prop = project["general"]["properties"]["stationid"]
    prop["options"] = [{"label": r["title"], "value": r["videoId"]} for r in rows]
    if all(o["value"] != prop.get("value") for o in prop["options"]):
        prop["value"] = rows[0]["videoId"]
    with io.open(PROJECT, "w", encoding="utf-8", newline="\n") as f:
        json.dump(project, f, indent=2, ensure_ascii=False)
        f.write("\n")
    print("synced %s (%d dropdown entries)" % (PROJECT, len(rows)))


if __name__ == "__main__":
    main()
