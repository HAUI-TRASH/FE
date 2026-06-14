(function () {
  "use strict";

  var CACHE_KEY = "iot_detail_cache";
  var CACHE_ID_KEY = "iot_detail_id";
  var SAMPLE_WIDTH = 160;
  var SAMPLE_HEIGHT = 160;
  var SAMPLE_INTERVAL_MS = 100;
  var RETURN_MOTION_THRESHOLD = 2;
  var RETURN_ARM_DELAY_MS = 600;
  var DEFAULT_ROIS = [
    { x: 0.1, y: 0.1, w: 0.8, h: 0.8, label: "" }
  ];
  var ROI_BOXES = normalizeRois(
    Array.isArray(window.TRASH_ROIS) && window.TRASH_ROIS.length
      ? window.TRASH_ROIS
      : DEFAULT_ROIS
  );

  var MATERIALS = {
    plastic: {
      name: "Nhựa",
      color: "#22C55E",
      bg: "#F0FDF4",
      image: "anh-chai-nhua.png",
      icon: "delete",
      note: "Mở ngăn dành cho nhựa."
    },
    metal: {
      name: "Kim loại",
      color: "#EAB308",
      bg: "#FEFCE8",
      image: "anh-chai-kim-loai.png",
      icon: "delete",
      note: "Mở ngăn dành cho kim loại."
    },
    glass: {
      name: "Thủy tinh",
      color: "#14B8A6",
      bg: "#F0FDFA",
      image: "anh-chai-thuy-tinh.png",
      icon: "delete",
      note: "Mở ngăn dành cho thủy tinh."
    },
    paper: {
      name: "Giấy",
      color: "#3B82F6",
      bg: "#EFF6FF",
      image: "chai-giay.png",
      icon: "delete",
      note: "Mở ngăn dành cho giấy."
    }
  };

  var els = {};
  var returnMotionStream = null;
  var returnMotionVideo = null;
  var returnMotionTimer = null;
  var returnPreviousFrame = null;
  var returnMotionStartedAt = 0;
  var isReturningToScan = false;
  var returnCanvas = document.createElement("canvas");
  returnCanvas.width = SAMPLE_WIDTH;
  returnCanvas.height = SAMPLE_HEIGHT;
  var returnCtx = returnCanvas.getContext("2d", { willReadFrequently: true });

  function cacheDom() {
    els.loadingState = document.getElementById("loadingState");
    els.resultState = document.getElementById("resultState");
    els.errorState = document.getElementById("errorState");
    els.errorText = document.getElementById("errorText");
    els.binIcon = document.getElementById("binIcon");
    els.materialName = document.getElementById("materialName");
    els.resultNote = document.getElementById("resultNote");
    els.scanAgainBtn = document.getElementById("scanAgainBtn");
  }

  function getToken() {
    return localStorage.getItem("accessToken") || "";
  }

  function authHeaders() {
    var token = getToken();
    return token ? { Authorization: "Bearer " + token } : {};
  }

  function qs(name) {
    return new URLSearchParams(window.location.search).get(name);
  }

  function setVisible(el, visible) {
    if (!el) return;
    el.classList.toggle("hidden", !visible);
  }

  function clamp01(value) {
    value = Number(value);
    if (!Number.isFinite(value)) return 0;
    return Math.max(0, Math.min(1, value));
  }

  function normalizeRois(rois) {
    return rois
      .map(function (roi, index) {
        var x = clamp01(roi.x);
        var y = clamp01(roi.y);
        var w = clamp01(roi.w);
        var h = clamp01(roi.h);
        if (x + w > 1) w = 1 - x;
        if (y + h > 1) h = 1 - y;
        return {
          x: x,
          y: y,
          w: w,
          h: h,
          label: roi.label || "ROI " + (index + 1),
        };
      })
      .filter(function (roi) {
        return roi.w > 0.02 && roi.h > 0.02;
      });
  }

  function getSampleRois() {
    var rois = ROI_BOXES.length
      ? ROI_BOXES
      : DEFAULT_ROIS;

    return rois.map(function (roi) {
      var x1 = Math.max(0, Math.floor(roi.x * SAMPLE_WIDTH));
      var y1 = Math.max(0, Math.floor(roi.y * SAMPLE_HEIGHT));
      var x2 = Math.min(SAMPLE_WIDTH, Math.ceil((roi.x + roi.w) * SAMPLE_WIDTH));
      var y2 = Math.min(SAMPLE_HEIGHT, Math.ceil((roi.y + roi.h) * SAMPLE_HEIGHT));
      return {
        x1: x1,
        y1: y1,
        x2: Math.max(x1 + 1, x2),
        y2: Math.max(y1 + 1, y2),
      };
    });
  }

  function drawVideoCover(ctx, video, width, height) {
    var videoWidth = video.videoWidth;
    var videoHeight = video.videoHeight;
    if (!videoWidth || !videoHeight) return;

    var targetRatio = width / height;
    var videoRatio = videoWidth / videoHeight;
    var sx = 0;
    var sy = 0;
    var sw = videoWidth;
    var sh = videoHeight;

    if (videoRatio > targetRatio) {
      sw = videoHeight * targetRatio;
      sx = (videoWidth - sw) / 2;
    } else {
      sh = videoWidth / targetRatio;
      sy = (videoHeight - sh) / 2;
    }

    ctx.drawImage(video, sx, sy, sw, sh, 0, 0, width, height);
  }

  function frameToRoiGrayData(imageData) {
    var rois = getSampleRois();
    var totalPixels = 0;

    rois.forEach(function (roi) {
      totalPixels += Math.max(0, roi.x2 - roi.x1) * Math.max(0, roi.y2 - roi.y1);
    });

    var current = new Uint8Array(totalPixels);
    var cursor = 0;

    rois.forEach(function (roi) {
      for (var y = roi.y1; y < roi.y2; y += 1) {
        var rowOffset = y * SAMPLE_WIDTH;
        for (var x = roi.x1; x < roi.x2; x += 1) {
          var idx = (rowOffset + x) * 4;
          current[cursor] = (imageData[idx] * 0.299 + imageData[idx + 1] * 0.587 + imageData[idx + 2] * 0.114) | 0;
          cursor += 1;
        }
      }
    });

    return current;
  }

  function calculateRoiMotionScore(previous, current) {
    var totalDiff = 0;
    var count = Math.min(previous.length, current.length);

    for (var i = 0; i < count; i += 1) {
      totalDiff += Math.abs(current[i] - previous[i]);
    }

    return count > 0 ? totalDiff / count : 0;
  }

  function stopReturnMotionWatch() {
    if (returnMotionTimer) {
      clearInterval(returnMotionTimer);
      returnMotionTimer = null;
    }
    if (returnMotionStream) {
      returnMotionStream.getTracks().forEach(function (track) {
        track.stop();
      });
      returnMotionStream = null;
    }
    if (returnMotionVideo && returnMotionVideo.parentNode) {
      returnMotionVideo.parentNode.removeChild(returnMotionVideo);
    }
    returnMotionVideo = null;
    returnPreviousFrame = null;
  }

  function returnToScanPage() {
    if (isReturningToScan) return;
    isReturningToScan = true;
    stopReturnMotionWatch();
    window.location.href = "index.html";
  }

  function sampleReturnMotion() {
    if (
      isReturningToScan ||
      !returnCtx ||
      !returnMotionVideo ||
      !returnMotionVideo.videoWidth
    ) {
      return;
    }

    drawVideoCover(returnCtx, returnMotionVideo, SAMPLE_WIDTH, SAMPLE_HEIGHT);
    var imageData = returnCtx.getImageData(0, 0, SAMPLE_WIDTH, SAMPLE_HEIGHT).data;
    var current = frameToRoiGrayData(imageData);

    if (!returnPreviousFrame) {
      returnPreviousFrame = current;
      return;
    }

    var score = calculateRoiMotionScore(returnPreviousFrame, current);
    returnPreviousFrame = current;

    if (Date.now() - returnMotionStartedAt < RETURN_ARM_DELAY_MS) {
      return;
    }

    if (score >= RETURN_MOTION_THRESHOLD) {
      returnToScanPage();
    }
  }

  function startReturnMotionWatch() {
    if (returnMotionTimer || returnMotionStream || isReturningToScan) return;
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) return;

    returnMotionVideo = document.createElement("video");
    returnMotionVideo.autoplay = true;
    returnMotionVideo.muted = true;
    returnMotionVideo.playsInline = true;
    returnMotionVideo.style.cssText = "position:fixed;left:-9999px;top:-9999px;width:1px;height:1px;opacity:0;pointer-events:none;";
    document.body.appendChild(returnMotionVideo);

    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: "environment" }, audio: false })
      .then(function (stream) {
        returnMotionStream = stream;
        returnMotionVideo.srcObject = stream;
        returnMotionVideo.onloadedmetadata = function () {
          returnMotionStartedAt = Date.now();
          returnMotionVideo.play().catch(function () {
            // ignore autoplay errors; the interval can still sample after playback starts
          });
          returnMotionTimer = setInterval(sampleReturnMotion, SAMPLE_INTERVAL_MS);
        };
      })
      .catch(function (err) {
        console.warn("Result motion watch failed:", err);
        stopReturnMotionWatch();
      });
  }

  function showOnly(state) {
    setVisible(els.loadingState, state === "loading");
    setVisible(els.resultState, state === "result");
    setVisible(els.errorState, state === "error");
  }

  function parseApiResponse(res) {
    return res.json().catch(function () {
      return null;
    }).then(function (json) {
      if (!res.ok) {
        var message = json && (json.message || json.error) ? (json.message || json.error) : "HTTP " + res.status;
        throw new Error(message);
      }
      return json && json.data ? json.data : json;
    });
  }

  function readCachedDetail(id) {
    try {
      var cachedId = sessionStorage.getItem(CACHE_ID_KEY);
      var cached = sessionStorage.getItem(CACHE_KEY);
      if (cachedId && cached && String(cachedId) === String(id)) {
        return JSON.parse(cached);
      }
    } catch (_) {
      return null;
    }
    return null;
  }

  function fetchDetail(id) {
    var cached = readCachedDetail(id);
    if (cached) {
      return Promise.resolve(cached);
    }

    return fetch(API_BASE + "/api/v1/iot/ai_response/" + encodeURIComponent(id) + "/detail", {
      method: "GET",
      headers: authHeaders(),
    }).then(parseApiResponse);
  }

  function normalizeText(value) {
    return String(value || "")
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/đ/g, "d")
      .trim();
  }

  function detectMaterialKey(detail) {
    var detections = Array.isArray(detail && detail.detections) ? detail.detections : [];
    var first = detections[0] || {};
    var combined = normalizeText([
      first.label,
      first.labelDisplay,
      first.material,
      first.trashType
    ].join(" "));

    if (/\bplastic\b|nhua|pet|hdpe|pp/.test(combined)) return "plastic";
    if (/\bmetal\b|kim loai|nhom|sat|thep|lon/.test(combined)) return "metal";
    if (/\bglass\b|thuy tinh|thuytinh/.test(combined)) return "glass";
    if (/\bpaper\b|giay|carton|cardboard|bia/.test(combined)) return "paper";
    return null;
  }

  function render(detail) {
    var key = detectMaterialKey(detail);

    if (!key || !MATERIALS[key]) {
      throw new Error("Label vật liệu không thuộc 4 nhóm hiện có.");
    }

    var config = MATERIALS[key];
    els.binIcon.textContent = config.icon;
    els.binIcon.style.color = config.color;
    els.materialName.textContent = config.name;
    els.materialName.style.color = config.color;
    els.resultNote.textContent = config.note;

    showOnly("result");
  }

  function showError(message) {
    if (els.errorText) {
      els.errorText.textContent = message || "Vui lòng thử lại.";
    }
    showOnly("error");
  }

  function init() {
    cacheDom();
    showOnly("loading");
    startReturnMotionWatch();

    if (els.scanAgainBtn) {
      els.scanAgainBtn.addEventListener("click", function () {
        returnToScanPage();
      });
    }

    var id = qs("id");
    if (!id) {
      showError("Thiếu id kết quả trên URL.");
      return;
    }

    fetchDetail(id)
      .then(render)
      .catch(function (err) {
        console.error("Load IoT result failed:", err);
        showError(err.message || "Không tải được kết quả.");
      })
      .finally(function () {
        try {
          sessionStorage.removeItem(CACHE_KEY);
          sessionStorage.removeItem(CACHE_ID_KEY);
        } catch (_) {
          // ignore
        }
        
      });
  }

  window.addEventListener("pagehide", stopReturnMotionWatch);

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
