const mediaStore = new Map();
const downloadedIds = new Set();
const PHOTO_URL = /\/status\/(\d+)\/photo\/(\d+)/;
const DEFAULT_COLOR = "rgb(113, 118, 123)";
const HOVER_COLOR = "rgb(29, 155, 240)";
const HOVER_BG = "rgba(29, 155, 240, 0.1)";
const OK_COLOR = "rgb(0, 186, 124)";
const OK_BG = "rgba(0, 186, 124, 0.1)";
const FAIL_COLOR = "rgb(244, 33, 46)";
let scheduled = false;

function schedule() {
  if (scheduled) return;
  scheduled = true;
  requestAnimationFrame(() => {
    scheduled = false;
    injectButtons();
    injectLightbox();
  });
}

chrome.storage.local.get({ downloaded: {} }).then(({ downloaded }) => {
  Object.keys(downloaded).forEach((id) => downloadedIds.add(id));
  schedule();
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local" || !changes.downloaded) return;
  Object.keys(changes.downloaded.newValue || {}).forEach((id) =>
    downloadedIds.add(id)
  );
  schedule();
});

window.addEventListener("X_MEDIA_FOUND", (e) => {
  try {
    const data = JSON.parse(e.detail);
    for (const [tweetId, tweetData] of Object.entries(data)) {
      mediaStore.set(tweetId, tweetData);
    }
  } catch (err) {}
  schedule();
});

function getCandidateIds(article) {
  const ids = [];
  article.querySelectorAll('a[href*="/status/"]').forEach((a) => {
    const match = a.getAttribute("href").match(/\/status\/(\d+)/);
    if (match && !ids.includes(match[1])) ids.push(match[1]);
  });
  return ids;
}

function getTweetId(article) {
  const ids = getCandidateIds(article);
  return ids.find((id) => mediaStore.has(id)) || ids[0] || null;
}

function hasMedia(article, tweetId) {
  return (
    mediaStore.has(tweetId) ||
    !!article.querySelector(
      'img[src*="pbs.twimg.com/media/"], img[src*="_video_thumb/"], video'
    )
  );
}

function getPhotoContext() {
  const match = location.pathname.match(PHOTO_URL);
  return match ? { tweetId: match[1], index: Number(match[2]) - 1 } : null;
}

function isDone(tweetId, index) {
  if (downloadedIds.has(tweetId)) return true;
  return index !== null && downloadedIds.has(`${tweetId}:${index}`);
}

function findLightboxBars() {
  return Array.from(document.querySelectorAll('div[role="group"]')).filter(
    (group) =>
      !group.closest("article") &&
      group.children.length >= 4 &&
      group.getClientRects().length > 0
  );
}

function createDownloadIcon() {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("width", "18.75");
  svg.setAttribute("height", "18.75");
  svg.style.fill = "currentColor";

  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  path.setAttribute(
    "d",
    "M12 16l-5-5 1.41-1.41L11 12.17V4h2v8.17l2.59-2.58L17 11l-5 5zm-7 2h14v2H5v-2z"
  );
  svg.appendChild(path);
  return svg;
}

function restColor(btn) {
  return btn.dataset.done === "1" ? OK_COLOR : btn.dataset.base;
}

function setDone(btn, done) {
  btn.dataset.done = done ? "1" : "0";
  btn.style.color = restColor(btn);
}

function flashFail(btn) {
  btn.style.color = FAIL_COLOR;
  setTimeout(() => {
    btn.style.color = restColor(btn);
  }, 1200);
}

function resolveTarget(btn) {
  const article = btn.closest("article");
  if (article) {
    return { tweetId: getTweetId(article), index: null };
  }
  const photo = getPhotoContext();
  return photo ? { tweetId: photo.tweetId, index: photo.index } : null;
}

function createButton(baseColor) {
  const wrapper = document.createElement("div");
  wrapper.dataset.xdl = "1";
  wrapper.style.cssText = "display:flex;align-items:center;justify-content:center";

  const btn = document.createElement("button");
  btn.type = "button";
  btn.title = "Download Media";
  btn.dataset.base = baseColor;
  btn.dataset.done = "0";
  btn.style.cssText = [
    "background: transparent",
    "border: none",
    `color: ${baseColor}`,
    "cursor: pointer",
    "display: inline-flex",
    "align-items: center",
    "justify-content: center",
    "width: 34.75px",
    "height: 34.75px",
    "border-radius: 9999px",
    "padding: 0",
    "flex-shrink: 0",
    "transition: background-color 0.2s, color 0.2s"
  ].join(";");
  btn.appendChild(createDownloadIcon());

  btn.addEventListener("mouseenter", () => {
    const done = btn.dataset.done === "1";
    btn.style.backgroundColor = done ? OK_BG : HOVER_BG;
    btn.style.color = done ? OK_COLOR : HOVER_COLOR;
  });
  btn.addEventListener("mouseleave", () => {
    btn.style.backgroundColor = "transparent";
    btn.style.color = restColor(btn);
  });

  btn.addEventListener("click", async (e) => {
    e.preventDefault();
    e.stopPropagation();

    const target = resolveTarget(btn);
    if (!target || !target.tweetId) {
      flashFail(btn);
      return;
    }
    const { tweetId, index } = target;

    try {
      const res = await chrome.runtime.sendMessage({
        action: "download",
        tweetId,
        index,
        media: mediaStore.get(tweetId) || null
      });
      if (res && res.ok) {
        downloadedIds.add(index === null ? tweetId : `${tweetId}:${index}`);
        setDone(btn, true);
      } else {
        console.warn("[X-DL] download failed", tweetId, res && res.reason);
        flashFail(btn);
      }
    } catch (err) {
      flashFail(btn);
    }
  });

  wrapper.appendChild(btn);
  return wrapper;
}

function mountButton(bar, done) {
  const ref = bar.querySelector('button, [role="button"]');
  const color = ref ? getComputedStyle(ref).color : DEFAULT_COLOR;
  const wrapper = createButton(color);
  setDone(wrapper.firstChild, done);
  bar.appendChild(wrapper);
}

function syncDone(existing, done) {
  const btn = existing.firstChild;
  if ((btn.dataset.done === "1") !== done) setDone(btn, done);
}

function injectButtons() {
  document.querySelectorAll("article").forEach((article) => {
    const groups = article.querySelectorAll('div[role="group"]');
    const bar = groups[groups.length - 1];
    if (!bar) return;

    const existing = bar.querySelector("[data-xdl]");
    const tweetId = getTweetId(article);
    const show = !!tweetId && hasMedia(article, tweetId);

    if (show && !existing) {
      mountButton(bar, isDone(tweetId, null));
    } else if (show && existing) {
      syncDone(existing, isDone(tweetId, null));
    } else if (!show && existing) {
      existing.remove();
    }
  });
}

function injectLightbox() {
  const photo = getPhotoContext();
  const bars = photo ? findLightboxBars() : [];

  document.querySelectorAll("[data-xdl]").forEach((el) => {
    if (!el.closest("article") && !bars.includes(el.parentElement)) {
      el.remove();
    }
  });

  if (!photo) return;

  const done = isDone(photo.tweetId, photo.index);
  bars.forEach((bar) => {
    const existing = bar.querySelector("[data-xdl]");
    if (existing) {
      syncDone(existing, done);
    } else {
      mountButton(bar, done);
    }
  });
}

new MutationObserver(schedule).observe(document.body, {
  childList: true,
  subtree: true
});
schedule();