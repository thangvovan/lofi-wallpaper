# Lofi wallpaper

A Wallpaper Engine web wallpaper that plays Lofi Girl's live radio stations, with
the artwork, a clock and a station list.

```
css/     the wallpaper's styling
js/      the wallpaper itself - clock, station list, artwork, audio
java/    the server that turns a YouTube live radio into playable audio
```

The wallpaper cannot play a YouTube live stream on its own. Everything below is a
consequence of that, and each claim was measured rather than assumed.

## Why there is a server

Four things had to be true for the wallpaper to do this alone. Two turned out not
to be obstacles at all; two are.

| | Measured | Blocking? |
|---|---|---|
| CORS on YouTube's API | `Content-Type: text/plain` skips the preflight, and the response carries `Access-Control-Allow-Origin: null` | no |
| A PO token is required | `PO Token Providers: none` in yt-dlp's own log. The earlier `FAILED_PRECONDITION` was a stale `clientVersion`; `21.02.35` answers `OK` for every station | no |
| CORS on googlevideo | Segments answer `206` with **no** `Access-Control-Allow-Origin`, so `fetch()` cannot read them - which also rules out ffmpeg.wasm, since it only works on bytes JavaScript already holds | **yes** |
| Codecs in Wallpaper Engine's CEF | `canPlayType` answers `""` for AAC and H.264, and a live radio serves only `avc1 + mp4a`. Opus in WebM answers `"probably"` | **yes** |

A media element is exempt from CORS, but it cannot play a live HLS playlist, and
even if it could there is no AAC decoder behind it. So the server resolves the
stream, downloads it, throws the video away and transcodes the audio to Opus; the
wallpaper plays the result with a plain `<audio>` element.

That split is also why Wallpaper Engine's own volume and pause work: the audio
belongs to the page, not to a separate process.

## Running the server

Locally:

```bash
cd java
mvn package -DskipTests
java -jar target/lofi-server.jar
```

Or in Docker, which brings its own ffmpeg:

```bash
docker compose up -d --build      # in java/
```

Then set **Audio server URL** in the wallpaper's properties. It defaults to
`http://127.0.0.1:8477`; point it at your server to move the work off the machine
running the wallpaper.

| Endpoint | |
|---|---|
| `GET /stream?id=<videoId>&q=<kbps>` | the audio, as WebM/Opus |
| `GET /api/health` | ffmpeg version and the live stations |
| `GET /api/resolve?id=<videoId>` | resolving on its own, for diagnosis |

`/api/resolve` is the first thing to run against a new host: it is the call that
fails when an IP sits in a range YouTube treats as a datacenter, and it costs no
bandwidth worth counting.

## Deploying

`.github/workflows/deploy.yml` rsyncs `java/` to a VM over SSH and rebuilds the
container there. Set `SSH_HOST`, `SSH_USER` and `SSH_KEY` as repository secrets.

Plain HTTP is the default. The wallpaper is a `file://` page rather than an
`https://` one, so it is not subject to mixed-content blocking and can pull audio
from an `http://` origin. If you own a domain and would rather not stream in the
clear, `docker compose --profile tls up -d` puts Caddy in front and it obtains its
own certificate.

### Bandwidth

One listener, measured at steady state on a warm station:

| `?q=` | Audio | HTTP requests | Total | 16 h/day, 31-day month |
|---|---|---|---|---|
| 32 (default) | 16.1 MB/h | 4.0 MB/h | 20.1 MB/h | **10.0 GB** |
| 48 | 19.4 | 4.0 | 23.4 | 11.6 GB |
| 96 | ~37 | 4.0 | ~41 | 20.3 GB |

The request line is not noise: ffmpeg issues about 2,340 requests an hour, each
carrying a googlevideo URL around 1,241 characters long. The ~93 GB/month of
segments coming *down* is inbound, which hosts generally do not bill.

That rules out several free tiers. Render's Hobby workspace includes 5 GB of
outbound a month, which is about 8 hours of listening a day. Oracle Cloud's
Always Free tier includes 10 TB, which this does not come close to.

## How the server works

One ffmpeg per station, not per listener. On a small host the CPU limit binds long
before bandwidth does, and sharing doubles as the latency fix: joining a station
that is already running costs about one cluster (~1 s) against the ~3.8 s a cold
start takes - 0.65 s to resolve, then ~3.1 s before ffmpeg emits anything.

Sharing a live WebM stream means new listeners cannot simply be handed the current
bytes: they need the EBML header and Tracks first. `StationStream` keeps that init
segment and splices each new listener in at the next cluster boundary.

A station is stopped 15 seconds after its last listener leaves. The delay is not
politeness - starting one makes ffmpeg pull the whole HLS window at once, costing
roughly twice the steady rate for the first twenty seconds, so riding out a brief
reconnect is cheaper than paying that again.

## The station list

`js/playlist.js` reads Lofi Girl's playlist in the page, at runtime, and nothing
is baked into the wallpaper. That keeps the list correct when a stream restarts
under a fresh video id, which happens often enough that a saved list goes stale.

It works because the same measurement that unblocked resolving applies here:
InnerTube does not need `Content-Type: application/json`. Sent as `text/plain`
the request is "simple", no preflight is sent, and the response carries
`Access-Control-Allow-Origin: null` - the origin a `file://` page has. None of it
touches the audio server.

Nothing is stored between runs, so the wallpaper waits about half a second for
the list on every start and has nothing to fall back on if the fetch fails -
`main.js` retries every 15 seconds rather than leaving an empty panel.

## Input inside Wallpaper Engine

Probed in the real surface, because it is not what a browser would suggest:

| Event | Delivered to the page |
|---|---|
| `mousemove`, `pointermove` | yes |
| `mousedown`, `click` | yes |
| **`wheel`, `mousewheel`** | **no** |

So the station list cannot be scrolled with the wheel, whatever the CSS says -
the event never arrives. It scrolls by hovering its top or bottom edge instead,
faster the nearer the pointer gets to the edge, and fades at the edges show which
way there is more to go. The wheel handler is kept only because the same page
opens in an ordinary browser during development.

Pausing works through `wallpaperPropertyListener.setPaused`, which Wallpaper
Engine calls according to **its own** Performance settings - "Other application
maximized" and so on, per monitor. If the wallpaper keeps playing behind other
windows, that is the engine's setting rather than the page ignoring anything:
calling `setPaused` by hand was verified to stop and restart the audio correctly.
