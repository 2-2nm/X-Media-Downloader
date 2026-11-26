(function () {
  function isApiUrl(url) {
    return url.includes("/graphql/") || url.includes("/i/api/");
  }

  function formatDate(createdAt) {
    if (!createdAt) return "unknown-date";
    const d = new Date(createdAt);
    return isNaN(d.getTime()) ? "unknown-date" : d.toISOString().split("T")[0];
  }

  function pickItems(mediaList) {
    return mediaList
      .map((m) => {
        if (m.type === "video" || m.type === "animated_gif") {
          const mp4s = (m.video_info?.variants || [])
            .filter((v) => v.content_type === "video/mp4")
            .sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0));
          return { type: "mp4", url: mp4s[0]?.url };
        }
        return { type: "jpg", url: `${m.media_url_https}?name=orig` };
      })
      .filter((item) => item.url);
  }

  function extractMedia(obj, map) {
    if (!obj || typeof obj !== "object") return;

    const mediaList =
      obj.legacy?.extended_entities?.media || obj.legacy?.entities?.media;
    if (obj.rest_id && Array.isArray(mediaList)) {
      const user = obj.core?.user_results?.result;
      const rawUsername =
        user?.core?.screen_name || user?.legacy?.screen_name || "x_user";
      const items = pickItems(mediaList);
      if (items.length > 0) {
        map[obj.rest_id] = {
          username: rawUsername.replace(/[^a-zA-Z0-9_]/g, ""),
          date: formatDate(obj.legacy?.created_at),
          items
        };
      }
    }

    for (const key in obj) {
      if (Object.prototype.hasOwnProperty.call(obj, key)) {
        extractMedia(obj[key], map);
      }
    }
  }

  function processPayload(data) {
    const mediaMap = {};
    extractMedia(data, mediaMap);
    if (Object.keys(mediaMap).length > 0) {
      window.dispatchEvent(
        new CustomEvent("X_MEDIA_FOUND", { detail: JSON.stringify(mediaMap) })
      );
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
          processPayload(JSON.parse(this.responseText));
        } catch (e) {}
      }
    });
    return origSend.apply(this, arguments);
  };
})();