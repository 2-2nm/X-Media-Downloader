(function () {
  function isApiUrl(url) {
    return url.includes("/graphql/") || url.includes("/i/api/");
  }

  function formatDate(createdAt) {
    if (!createdAt) return "unknown-date";
    const d = new Date(createdAt);
    return isNaN(d.getTime()) ? "unknown-date" : d.toISOString().split("T")[0];
  }

  function isHttpsUrl(url) {
    return typeof url === "string" && url.startsWith("https://");
  }

  function pickItems(mediaList) {
    const items = mediaList
      .map((m) => {
        if (m.type === "video" || m.type === "animated_gif") {
          const mp4s = (m.video_info?.variants || [])
            .filter((v) => v.content_type === "video/mp4")
            .sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0));
          return { type: "mp4", url: mp4s[0]?.url };
        }
        const photo = m.media_url_https;
        return { type: "jpg", url: isHttpsUrl(photo) ? `${photo}?name=orig` : null };
      });

    if (items.every((item) => isHttpsUrl(item.url))) return items;
    return [];
  }

  function findFileUrls(node, path, out) {
    if (typeof node === "string") {
      if (/video\.twimg\.com|pbs\.twimg\.com\/(media|\w*video\w*)/.test(node)) {
        out.push(`${path} = ${node}`);
      }
    } else if (node && typeof node === "object") {
      for (const key of Object.keys(node)) {
        findFileUrls(node[key], path ? `${path}.${key}` : key, out);
      }
    }
    return out;
  }

  const reported = new Set();

  function reportStructure(tweet) {
    const opened = window.location?.pathname.match(/\/status\/(\d+)/)?.[1];
    if (tweet.rest_id !== opened || reported.has(tweet.rest_id)) return;
    reported.add(tweet.rest_id);
    console.warn(
      [
        `[X-DL] struktur ${tweet.rest_id}`,
        `keys: ${Object.keys(tweet).join(", ")}`,
        `legacy: ${Object.keys(tweet.legacy || {}).join(", ")}`,
        ...findFileUrls(tweet, "", []).slice(0, 30)
      ].join("\n")
    );
  }

  const NESTED_TWEETS = /^(quoted_status_result|retweeted_status_result|quotedPostResults|repostedPostResults)$/;

  function scanItems(tweet, mediaList) {
    const found = new Map();

    (function walk(node) {
      if (typeof node === "string") {
        addAsset(node, found);
      } else if (node && typeof node === "object") {
        for (const key of Object.keys(node)) {
          if (!NESTED_TWEETS.test(key)) walk(node[key]);
        }
      }
    })(tweet);

    let assets = Array.from(found.values());
    const onlyVideos = mediaList.every((m) =>
      String(m.expanded_url || "").includes("/video/")
    );
    if (onlyVideos) assets = assets.filter((a) => a.type === "mp4");

    if (assets.length !== mediaList.length) return [];
    return assets.map(({ type, url }) => ({ type, url }));
  }

  function addAsset(text, found) {
    let url;
    try {
      url = new URL(text);
    } catch (e) {
      return;
    }
    if (url.protocol !== "https:") return;

    if (url.hostname === "video.twimg.com" && url.pathname.endsWith(".mp4")) {
      const id = url.pathname.match(/_video\/(\d+)\//);
      const key = id ? id[1] : url.pathname;
      const res = url.pathname.match(/\/(\d+)x(\d+)\//);
      const size = res ? res[1] * res[2] : 0;
      const prev = found.get(key);
      if (!prev || size > prev.size) {
        found.set(key, { type: "mp4", url: url.href, size });
      }
    } else if (url.hostname === "pbs.twimg.com") {
      const photo = url.pathname.match(/^\/media\/([\w-]+)(?:\.(\w+))?/);
      if (!photo) return;
      const type = url.searchParams.get("format") || photo[2] || "jpg";
      found.set(photo[1], {
        type,
        url: `https://pbs.twimg.com/media/${photo[1]}?format=${type}&name=orig`
      });
    }
  }

  function extractMedia(obj, map) {
    if (!obj || typeof obj !== "object") return;

    const mediaList =
      obj.legacy?.extended_entities?.media || obj.legacy?.entities?.media;
    if (obj.rest_id && obj.legacy && !Array.isArray(mediaList)) {
      reportStructure(obj);
    }
    if (obj.rest_id && Array.isArray(mediaList)) {
      const user = obj.core?.user_results?.result;
      const rawUsername =
        user?.core?.screen_name ||
        user?.legacy?.screen_name ||
        String(mediaList[0]?.expanded_url || "").match(/\.com\/(\w+)\/status\//)?.[1] ||
        "x_user";
      let items = pickItems(mediaList);
      if (items.length === 0) items = scanItems(obj, mediaList);
      if (items.length > 0) {
        map[obj.rest_id] = {
          username: rawUsername.replace(/[^a-zA-Z0-9_]/g, ""),
          date: formatDate(obj.legacy?.created_at),
          items
        };
      } else {
        reportStructure(obj);
      }
    }

    for (const key in obj) {
      if (Object.prototype.hasOwnProperty.call(obj, key)) {
        extractMedia(obj[key], map);
      }
    }
  }

  const cache = {};

  function emit(map) {
    window.dispatchEvent(
      new CustomEvent("X_MEDIA_FOUND", { detail: JSON.stringify(map) })
    );
  }

  window.addEventListener("X_MEDIA_REQUEST", () => {
    if (Object.keys(cache).length > 0) emit(cache);
  });

  function processPayload(data) {
    const mediaMap = {};
    extractMedia(data, mediaMap);
    if (Object.keys(mediaMap).length > 0) {
      Object.assign(cache, mediaMap);
      emit(mediaMap);
    }
  }

  const origFetch = window.fetch;
  window.fetch = async function (...args) {
    const response = await origFetch.apply(this, args);
    try {
      const input = args[0];
      const url = typeof input === "string" ? input : input?.url || String(input || "");
      if (isApiUrl(url)) {
        response.clone().json().then(processPayload).catch(() => {});
      }
    } catch (e) {}
    return response;
  };

  const origOpen = XMLHttpRequest.prototype.open;
  const origSend = XMLHttpRequest.prototype.send;

  XMLHttpRequest.prototype.open = function (method, url) {
    this._xdlUrl = String(url || "");
    return origOpen.apply(this, arguments);
  };

  XMLHttpRequest.prototype.send = function () {
    this.addEventListener("load", function () {
      if (this._xdlUrl && isApiUrl(this._xdlUrl)) {
        try {
          processPayload(
            this.responseType === "json"
              ? this.response
              : JSON.parse(this.responseText)
          );
        } catch (e) {}
      }
    });
    return origSend.apply(this, arguments);
  };
})();