const DEFAULT_FOLDER = "X Media";
let writeQueue = Promise.resolve();

function cleanFolder(raw) {
  return String(raw || "")
    .split(/[\\/]+/)
    .map((part) =>
      part
        .replace(/[<>:"|?*\x00-\x1f]/g, "")
        .trim()
        .replace(/^\.+|\.+$/g, "")
    )
    .filter(Boolean)
    .join("/");
}

function markDownloaded(tweetId) {
  writeQueue = writeQueue
    .then(async () => {
      const { downloaded } = await chrome.storage.local.get({ downloaded: {} });
      downloaded[tweetId] = 1;
      await chrome.storage.local.set({ downloaded });
    })
    .catch(() => {});
  return writeQueue;
}

function syndicationToken(tweetId) {
  return ((Number(tweetId) / 1e15) * Math.PI).toString(36).replace(/(0+|\.)/g, "");
}

function formatDate(createdAt) {
  if (!createdAt) return "unknown-date";
  const d = new Date(createdAt);
  return isNaN(d.getTime()) ? "unknown-date" : d.toISOString().split("T")[0];
}

function isHttpsUrl(url) {
  return typeof url === "string" && url.startsWith("https://");
}

function isUsable(media, allowGaps = false) {
  const items = media?.items || [];
  const present = allowGaps ? items.filter(Boolean) : items;
  return present.length > 0 && present.every((i) => isHttpsUrl(i?.url));
}

async function fetchSyndication(tweetId) {
  const url =
    `https://cdn.syndication.twimg.com/tweet-result?id=${tweetId}` +
    `&lang=en&token=${syndicationToken(tweetId)}`;
  const res = await fetch(url);
  if (!res.ok) return { reason: `syndication-${res.status}` };

  const data = await res.json().catch(() => null);
  if (!data) return { reason: "syndication-empty" };
  const items = (data.mediaDetails || [])
    .map((m) => {
      if (m.type === "video" || m.type === "animated_gif") {
        const mp4s = (m.video_info?.variants || [])
          .filter((v) => v.content_type === "video/mp4")
          .sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0));
        return { type: "mp4", url: mp4s[0]?.url };
      }
      const photo = m.media_url_https;
      return { type: "jpg", url: isHttpsUrl(photo) ? `${photo}?name=orig` : null };
    })
    .filter((item) => isHttpsUrl(item.url));

  if (items.length === 0) {
    return {
      reason: data.tombstone ? "syndication-tombstone" : "syndication-no-media"
    };
  }

  return {
    media: {
      username: (data.user?.screen_name || "x_user").replace(/[^a-zA-Z0-9_]/g, ""),
      date: formatDate(data.created_at),
      items
    }
  };
}

async function handleDownload(msg) {
  let media = isUsable(msg.media) ? msg.media : null;
  if (!media) {
    const found = await fetchSyndication(msg.tweetId).catch((err) => ({
      reason: `syndication-error: ${err?.message || err}`
    }));
    media = found.media || (isUsable(msg.fallback, true) ? msg.fallback : null);
    if (!media) return { ok: false, reason: found.reason };
  }

  const { folder } = await chrome.storage.local.get({ folder: DEFAULT_FOLDER });
  const dir = cleanFolder(folder);
  const prefix = dir ? `${dir}/` : "";

  const { username, date, items } = media;
  const single = Number.isInteger(msg.index);
  const targets = single
    ? [[msg.index, items[msg.index]]]
    : items.map((item, i) => [i, item]).filter(([, item]) => item);

  if (targets.some(([, item]) => !item)) {
    return { ok: false, reason: "index-out-of-range" };
  }

  for (const [i, item] of targets) {
    await chrome.downloads.download({
      url: item.url,
      filename: `${prefix}${username}_${date}_${msg.tweetId}_${i + 1}.${item.type}`,
      conflictAction: "uniquify",
      saveAs: false
    });
  }

  await markDownloaded(single ? `${msg.tweetId}:${msg.index}` : msg.tweetId);
  return { ok: true };
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.action !== "download" || !msg.tweetId) return;
  handleDownload(msg)
    .then(sendResponse)
    .catch((err) => {
      console.error("[X-DL]", msg.tweetId, err);
      sendResponse({ ok: false, reason: `error: ${err?.message || err}` });
    });
  return true;
});