# X Media Downloader

A small Chrome extension (Manifest V3) that adds a download button to tweets on X and saves the original photos and MP4 videos with one click.

## Features

- Download button next to Share on every tweet that contains media
- Original quality photos (`name=orig`) and the highest bitrate MP4 for videos and GIFs
- Single photo download from the photo viewer (`/status/<id>/photo/<n>`): only the photo you are looking at is saved
- Downloaded items turn green and stay green across reloads
- Popup menu to save everything into a dedicated folder inside your Downloads folder
- Works without any login tokens or external services for tweets the page already loaded

## Install

1. Download or clone this repository.
2. Open `chrome://extensions` (or the equivalent page in your Chromium based browser).
3. Turn on **Developer mode**.
4. Click **Load unpacked** and select the project folder.
5. Open x.com and hard refresh the tab (Ctrl+Shift+R).

After updating the files, click the reload button on the extension card and hard refresh x.com again.

## Usage

- **Download everything in a tweet:** click the download icon in the tweet's action bar.
- **Download one photo:** open the photo, then click the download icon in the viewer's action bar.
- **Choose the folder:** click the extension icon in the toolbar, type a folder name, and press Save. The default is `X Media`. Use `X Media/Photos` for nested folders, or leave it empty to save directly in Downloads.

Files are named `<username>_<date>_<tweetId>_<n>.<ext>`.

Icon colors: gray means not downloaded, green means downloaded, red (briefly) means the download failed. When a download fails, the reason is printed in the browser console with the `[X-DL]` prefix.

## How it works

| File | Role |
| --- | --- |
| `interceptor.js` | Runs in the page context and hooks `fetch` and `XMLHttpRequest`. It reads media URLs from X API responses and passes them to the content script. |
| `content.js` | Injects the download buttons, resolves which tweet or photo a click refers to, and tracks the green state. |
| `background.js` | Service worker that performs the downloads, applies the folder setting, and falls back to the public syndication endpoint when the page data has no media for a tweet. |
| `popup.html`, `popup.js` | The folder setting menu. |
| `manifest.json` | Permissions and script registration. |

### Permissions

- `downloads`: save files.
- `storage`: remember the folder setting and which tweets were downloaded.
- Host access to `x.com`, `twitter.com`, `pbs.twimg.com`, `video.twimg.com`, and `cdn.syndication.twimg.com`.

Nothing is sent anywhere except the requests to X's own domains.

## Limitations

- X changes its markup and API often. When it does, buttons may disappear or downloads may fail until the selectors are updated.
- Videos that X only serves as HLS (`.m3u8`) playlists cannot be downloaded, because the extension only looks for MP4 variants.
- Protected, age restricted, or sensitive tweets may not expose their media. If your account hides sensitive media, enable **Display media that may contain sensitive content** in X settings.
- The save folder is always relative to the browser's Downloads folder. Extensions cannot write to arbitrary locations. Change the browser's default download location if you need a different parent folder.
- The green marker is stored in the browser's extension storage and is set when a download starts, not when it finishes. Clearing the extension's data resets it.

## Disclaimer

This project is intended for personal use. Downloading content may be subject to X's terms of service and to the copyright of the original authors. You are responsible for how you use it. This project is not affiliated with X Corp.

## License

MIT. See `LICENSE`.