# Lofi Girl Wallpaper Radio

Wallpaper Engine web wallpaper dùng artwork các kênh Lofi Girl làm nền, kèm đồng
hồ và list kính ở góc trên bên phải. Bấm vào list là đổi **cả wallpaper lẫn
nhạc**.

Không cần localhost, không tiến trình nền, không nhúng player.

## Cài đặt

Copy thư mục này vào
`...\Steam\steamapps\common\wallpaper_engine\projects\myprojects\lofi-wallpaper`,
mở Wallpaper Engine → wallpaper hiện trong tab *Installed* → Apply.

Không cài gì thêm. Chỉ cần mạng.

## Nhạc chạy kiểu gì mà không cần server

Thẻ `<audio>` **không cần CORS** để phát tài nguyên cross-origin — phát không
phải là fetch. Nên URL luồng radio đưa thẳng vào `src`, hết. Đó là toàn bộ cơ chế.

Điều duy nhất quyết định một luồng có dùng được hay không là **server trả lời
Range request thế nào**, vì media element luôn gửi Range ở request đầu tiên:

| Đài | Không Range | Có Range | Kết quả trong browser |
|---|---|---|---|
| laut.fm | `ff fb …` MP3 | giống hệt | phát được |
| Radio Paradise | `ff f1 …` AAC | giống hệt | phát được |
| SomaFM | `ff fb …` MP3 | `46 46 46 46` = ASCII "FFFF" | `MEDIA_ERR_SRC_NOT_SUPPORTED` |

SomaFM trả rác cho request có Range, nên trình duyệt báo lỗi format dù luồng
hoàn toàn bình thường khi tải bằng `curl` không Range. Mọi URL trong
`js/stations.js` đều đã được kiểm cả hai cách, và kiểm lại lần nữa bằng
`<audio>` thật trong Chromium.

Mỗi wallpaper Lofi Girl ghép với một luồng hợp gu, chọn theo chính tên kênh:

| Luồng | Wallpaper |
|---|---|
| laut.fm lofi | Lofi Radio, Asian Lofi Radio |
| laut.fm jazz | Jazz Lofi Radio, Bossa Lofi Radio, Relaxing Jazz Music |
| laut.fm instrumental | Relaxing Piano Radio, Classical Music Radio, Study With Me |
| laut.fm meditation | Hip Hop Radio, Sleep Ambient Music, Dark Ambient Radio |
| laut.fm nature | Sad Lofi Radio, Gentle Rain Ambience, Fireplace Ambience |
| laut.fm relax | Chill Guitar Radio, Medieval Lofi Radio, Christmas Lofi Music, Halloween Lofi Radio |
| laut.fm ambient | Synthwave Radio |

**Đây không phải audio của Lofi Girl.** Nhạc của họ chỉ lấy được qua một trong
hai đường đã bị loại — nhúng IFrame player, hoặc helper chạy nền. Xem
[Vì sao không lấy được nhạc Lofi Girl](#vì-sao-không-lấy-được-nhạc-lofi-girl).
Hình nền thì vẫn là artwork Lofi Girl.

## Nhạc chỉ chạy khi thấy wallpaper

Wallpaper Engine gọi `setPaused(true)` khi nó tạm dừng wallpaper. Đó là tín hiệu
chính thức duy nhất — chính tác giả WE nói rõ **không thể** phát hiện focus từ
bên trong trang, nên không có cách nào khôn hơn:

```js
window.wallpaperPropertyListener.setPaused = isPaused => { ... };
```

**Nhưng khi nào nó bắn là do cài đặt của Wallpaper Engine, không phải do trang
quyết định.** Vào **Settings → Performance**:

| Mục | Đặt thành |
|---|---|
| Other applications maximized | `Pause` (hoặc `Mute`) |
| Other applications fullscreen | `Pause` |

Để `Keep running` thì WE không bao giờ tạm dừng gì cả, nên nhạc cứ chạy — đúng
như tuỳ chọn đó yêu cầu. Nếu nhạc vẫn chạy khi có app đè lên, kiểm hai mục này
trước.

`js/visibility.js` bổ sung `setPaused` vào listener mà `settings.js` đã tạo, chứ
không gán đè — nếu gán đè thì script chạy sau sẽ âm thầm xoá mất phần kia.

## Màn hình dọc

Fit luôn là **cover**. Trên màn dọc, ảnh 16:9 bị cắt mạnh và điều đó là không
tránh được — đã đo cụ thể:

| Biến thể | Kích thước | Tỉ lệ | Nội dung |
|---|---|---|---|
| 4 ảnh trong `urls.py` | 168×94 → 336×188 | **đều 1.78** | cùng một khung |
| `mqdefault` | 320×180 | 1.778 | full-bleed |
| `maxresdefault` / `hq720` | 1280×720 | 1.778 | full-bleed |
| `default` / `hqdefault` / `sddefault` | 4:3 | 1.333 | **letterbox — thêm viền đen, không thêm cảnh** |

Với `cover`, phần bị cắt do **tỉ lệ khung** quyết định chứ không phải kích thước:
mọi ảnh 1.78 sẽ cắt y hệt nhau dù to hay nhỏ. Mấy bản 4:3 tuy "cao" hơn nhưng chỉ
là cùng khung hình đó cộng viền đen, nên dùng chúng chỉ tổ hiện viền đen.

Vì vậy wallpaper luôn dùng `maxresdefault` — bản lớn nhất, để khi `cover` phóng
to trên màn dọc thì ảnh còn nét (1280 → hơn 3400px chiều ngang).

Điều duy nhất làm được cho màn dọc là nhường chỗ: list thu hẹp và thấp lại để
không nuốt mất phần cảnh còn thấy được.

## Nguồn dữ liệu

Danh sách lấy từ dump yt-dlp trong `Downloads/lofi radio/urls.py` — 19 kênh kèm
id, link watch và thumbnail. Mỗi kênh lưu trong `js/stations.js`:

| Trường | Dùng để |
|---|---|
| `videoId`, `url` | định danh, link gốc |
| `title` | tên rút gọn hiện trên list |
| `thumb` | **wallpaper** (bản 1280×720) |
| `thumbFallback` | thumbnail gốc trong dump, dự phòng |
| `stream`, `streamName` | **luồng nhạc** ghép với wallpaper đó |
| `mood` | phân nhóm cho chế độ auto theo giờ |

Thumbnail trong dump cao nhất chỉ 336×188 — quá nhỏ để phủ màn hình — nên dùng
bản `maxresdefault` (1280×720) của **cùng ảnh đó**, giữ URL trong dump làm dự
phòng. Đã kiểm: cả 19 kênh đều có bản maxres.

Tên rút gọn theo đúng quy tắc của app mobile
(`lofi-audio/lib/services/youtube_service.dart::_filterChannelTitle`): cắt từ
emoji đầu tiên, lấy 3 từ cuối, title case, trùng thì nới ra 4 từ. Ví dụ
`lofi hip hop radio 📚 beats to relax/study to` → `Lofi Radio`.

Cập nhật lại danh sách:

```bash
python tools/import_stations.py --verify
```

`--verify` đối chiếu id với playlist hiện tại và thay id đã chết (lúc import
`EWrX250Zhko` đã chết, được thay bằng `rFZHOHl-L8A`). Với wallpaper thì id chết
vẫn còn artwork dùng được, nên `--verify` là tuỳ chọn.

## Tuỳ chọn (Properties)

| Nhóm | Tuỳ chọn |
|---|---|
| Wallpaper | Pick mode (`Auto theo giờ` / `Shuffle` / `Chọn tay`), Wallpaper, Source (`Lofi Girl artwork` / `Built-in gradient` / `Local video` / `Local image`), file, Fit (Cover / Contain / Stretch), Crossfade |
| Audio | Volume, Mute |
| Look | Dim, Blur, Saturation, Vignette, Film grain |
| Overlay | List + độ trong của kính, Clock (12/24h), Wallpaper name, Overlay opacity, Accent colour |

**Auto mode** chọn theo giờ và tự đổi khi sang khung giờ mới: sáng →
piano/classical/study, ngày → lofi/bossa, tối → jazz/synthwave, đêm →
sleep/ambient/rain.

Phím tắt (khi Wallpaper Engine truyền input): `↑`/`↓` đổi wallpaper, `m` mute.

## Vì sao không lấy được nhạc Lofi Girl

Wallpaper là JS thuần trong CEF. Đã test cụ thể:

| Thử | Kết quả |
|---|---|
| `youtubei/v1/player` client `WEB` | `UNPLAYABLE` |
| client `ANDROID_VR` | `LOGIN_REQUIRED` (đòi PO token) |
| client `IOS` / `TVHTML5` / `MWEB` / `WEB_EMBEDDED` | `UNPLAYABLE` / `ERROR` |
| Gọi `/player` hay `/browse` bằng `fetch()` | CORS preflight → `OPTIONS` trả **403 với mọi origin** |
| `<audio src>` trỏ thẳng googlevideo | `403` — range mở bị từ chối, chỉ range có giới hạn mới `206` |
| Live stream | không có format audio-only, mọi variant đều muxed HLS mà Chromium không phát natively |

Hai đường từng chạy được, cả hai đều nằm trong git history:

- **Nhúng YouTube IFrame player** — đúng ToS, nhưng vẫn decode video.
- **Helper chạy nền** (Python + yt-dlp + ffmpeg transmux, ~49 kbps AAC) — cần
  giữ một tiến trình chạy cùng Wallpaper Engine.

## Cấu trúc

```
project.json            # manifest + user properties của Wallpaper Engine
index.html
css/style.css
js/stations.js          # 19 kênh + luồng ghép, sinh từ dump trong Downloads
js/settings.js          # defaults + wallpaperPropertyListener
js/background.js        # artwork crossfade / gradient / video / ảnh local
js/audio.js             # <audio> trỏ thẳng luồng radio, tự reconnect
js/visibility.js        # cầu nối setPaused của Wallpaper Engine
js/ui.js                # đồng hồ, nhãn, list kính
js/main.js              # boot, chọn wallpaper, auto theo giờ
tools/import_stations.py
```

## Ghi chú

- **Không có `preview.jpg`**, nên Wallpaper Engine hiện ô trống ở gallery. Muốn
  có lại thì bỏ ảnh tên `preview.jpg` vào thư mục gốc và thêm
  `"preview": "preview.jpg"` vào `project.json`.
- List chỉ bấm được khi Wallpaper Engine cho phép chuột tương tác với wallpaper.
  Không có chuột thì đổi bằng Properties.
- Nếu trình duyệt chặn autoplay, nhãn hiện "click to start audio" và click đầu
  tiên sẽ bật nhạc. Wallpaper Engine thì cho autoplay nên thường không gặp.
- Luồng radio rớt sẽ tự kết nối lại, giãn dần tối đa 8 lần.
- Trên màn dọc, list thu hẹp và thấp lại để không nuốt mất ảnh.
- Artwork thuộc về Lofi Girl; nhạc thuộc về các đài laut.fm tương ứng.
