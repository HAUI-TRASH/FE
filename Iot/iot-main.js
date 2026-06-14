(function () {
  "use strict";

  var SAMPLE_WIDTH = 160;
  var SAMPLE_HEIGHT = 160;
  var SAMPLE_INTERVAL_MS = 100;
  var MOTION_THRESHOLD = 3;
  var STABLE_THRESHOLD = 3;
  var STABLE_DURATION_MS = 500;
  var CAPTURE_MAX_DIM = 1024;
  var CAPTURE_QUALITY = 0.92;
  var CAPTURE_ROI_ONLY = true;
  var DEFAULT_ROIS = [
    { x: 0.18, y: 0.16, w: 0.64, h: 0.62, label: "ROI trong thung" },
  ];
  var ROI_BOXES = normalizeRois(
    Array.isArray(window.TRASH_ROIS) && window.TRASH_ROIS.length
      ? window.TRASH_ROIS
      : DEFAULT_ROIS
  );

  var cameraStream = null;
  var sampleTimer = null;
  var currentFacingMode = "environment";
  var previousFrame = null;
  var hasSeenMotion = false;
  var stableSince = null;
  var isProcessing = false;

  var els = {};
  var sampleCanvas = document.createElement("canvas");
  sampleCanvas.width = SAMPLE_WIDTH;
  sampleCanvas.height = SAMPLE_HEIGHT;
  var sampleCtx = sampleCanvas.getContext("2d", { willReadFrequently: true });

  function cacheDom() {
    els.cameraLoading = document.getElementById("cameraLoading");
    els.cameraError = document.getElementById("cameraError");
    els.cameraErrorMsg = document.getElementById("cameraErrorMsg");
    els.cameraActive = document.getElementById("cameraActive");
    els.camVideo = document.getElementById("camVideo");
    els.roiCanvas = document.getElementById("roiCanvas");
    els.statusTitle = document.getElementById("statusTitle");
    els.statusText = document.getElementById("statusText");
    els.sideStatus = document.getElementById("sideStatus");
    els.motionValue = document.getElementById("motionValue");
    els.motionBar = document.getElementById("motionBar");
    els.btnRetry = document.getElementById("btnRetry");
    els.btnSwitchCam = document.getElementById("btnSwitchCam");
    els.btnCaptureNow = document.getElementById("btnCaptureNow");
    els.stepMotion = document.getElementById("stepMotion");
    els.stepStable = document.getElementById("stepStable");
    els.stepClassify = document.getElementById("stepClassify");
  }

  function getToken() {
    return localStorage.getItem("accessToken") || "";
  }

  function authHeaders() {
    var token = getToken();
    return token ? { Authorization: "Bearer " + token } : {};
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

  function setVisible(el, visible) {
    if (!el) return;
    el.classList.toggle("hidden", !visible);
  }

  function setText(el, text) {
    if (el) el.textContent = text;
  }

  function setStatus(title, detail, side) {
    setText(els.statusTitle, title);
    setText(els.statusText, detail || "");
    setText(els.sideStatus, side || detail || title);
  }

  function setStep(el, done, active) {
    if (!el) return;
    var item = el.closest(".step-item");
    var checked = done || active;
    el.textContent = checked ? "check_circle" : "radio_button_unchecked";
    el.classList.toggle("text-emerald-500", checked);
    el.classList.toggle("text-blue-500", false);
    el.classList.toggle("text-slate-300", !checked);
    if (item) {
      item.classList.toggle("step-done", checked);
      item.classList.toggle("step-active", false);
      item.classList.toggle("step-idle", !checked);
    }
  }

  function resetGate() {
    previousFrame = null;
    hasSeenMotion = false;
    stableSince = null;
    updateSteps(false, false, false);
  }

  function updateSteps(motion, stable, classify) {
    setStep(els.stepMotion, motion, !motion);
    setStep(els.stepStable, stable, motion && !stable);
    setStep(els.stepClassify, classify, stable && !classify);
  }

  function drawVideoCover(ctx, video, width, height) {
    var videoWidth = video.videoWidth;
    var videoHeight = video.videoHeight;
    if (!videoWidth || !videoHeight) return;

    var sourceRatio = videoWidth / videoHeight;
    var targetRatio = width / height;
    var sx = 0;
    var sy = 0;
    var sw = videoWidth;
    var sh = videoHeight;

    if (sourceRatio > targetRatio) {
      sw = videoHeight * targetRatio;
      sx = (videoWidth - sw) / 2;
    } else {
      sh = videoWidth / targetRatio;
      sy = (videoHeight - sh) / 2;
    }

    ctx.drawImage(video, sx, sy, sw, sh, 0, 0, width, height);
  }

  function drawRoiOverlay() {
    var canvas = els.roiCanvas;
    if (!canvas || !els.cameraActive || els.cameraActive.classList.contains("hidden")) return;

    var rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return;

    if (canvas.width !== Math.round(rect.width) || canvas.height !== Math.round(rect.height)) {
      canvas.width = Math.round(rect.width);
      canvas.height = Math.round(rect.height);
    }

    var ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = "rgba(2, 6, 23, 0.32)";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    var rois = ROI_BOXES.length
      ? ROI_BOXES
      : DEFAULT_ROIS;

    rois.forEach(function (roi, index) {
      var x = roi.x * canvas.width;
      var y = roi.y * canvas.height;
      var w = roi.w * canvas.width;
      var h = roi.h * canvas.height;
      var label = typeof roi.label === 'string' ? roi.label : ("ROI " + (index + 1));

      ctx.clearRect(x, y, w, h);
      ctx.fillStyle = "rgba(34, 197, 94, 0.08)";
      ctx.fillRect(x, y, w, h);
      ctx.strokeStyle = "#22C55E";
      ctx.lineWidth = 3;
      ctx.strokeRect(x, y, w, h);

      if (label) {
        ctx.font = "700 13px Space Grotesk, sans-serif";
        var textWidth = ctx.measureText(label).width;
        var labelY = Math.max(8, y - 28);
        ctx.fillStyle = "#22C55E";
        ctx.fillRect(x, labelY, textWidth + 18, 24);
        ctx.fillStyle = "#FFFFFF";
        ctx.fillText(label, x + 9, labelY + 16);
      }
    });
  }

  function calculateRoiMotionScore(previous, current) {
    var totalDiff = 0;
    var count = Math.min(previous.length, current.length);

    for (var i = 0; i < count; i += 1) {
      totalDiff += Math.abs(current[i] - previous[i]);
    }

    return count > 0 ? totalDiff / count : 0;
  }

  function getRoiUnion() {
    var rois = ROI_BOXES.length
      ? ROI_BOXES
      : DEFAULT_ROIS;
    var left = 1;
    var top = 1;
    var right = 0;
    var bottom = 0;

    rois.forEach(function (roi) {
      left = Math.min(left, roi.x);
      top = Math.min(top, roi.y);
      right = Math.max(right, roi.x + roi.w);
      bottom = Math.max(bottom, roi.y + roi.h);
    });

    return {
      x: Math.max(0, left),
      y: Math.max(0, top),
      w: Math.min(1, right) - Math.max(0, left),
      h: Math.min(1, bottom) - Math.max(0, top),
    };
  }

  function showError(message) {
    setVisible(els.cameraLoading, false);
    setVisible(els.cameraActive, false);
    setVisible(els.cameraError, true);
    setText(els.cameraErrorMsg, message);
  }

  function stopCamera() {
    if (sampleTimer) {
      clearInterval(sampleTimer);
      sampleTimer = null;
    }
    if (cameraStream) {
      cameraStream.getTracks().forEach(function (track) {
        track.stop();
      });
      cameraStream = null;
    }
  }

  function startCamera(facingMode) {
    stopCamera();
    resetGate();
    isProcessing = false;

    setVisible(els.cameraLoading, true);
    setVisible(els.cameraError, false);
    setVisible(els.cameraActive, false);
    setStatus("Đang mở camera", "Cho phép trình duyệt dùng camera để bắt đầu.", "Đang khởi động camera.");

    return navigator.mediaDevices
      .getUserMedia({ video: { facingMode: facingMode }, audio: false })
      .then(function (stream) {
        cameraStream = stream;
        currentFacingMode = facingMode;
        els.camVideo.srcObject = stream;

        els.camVideo.onloadedmetadata = function () {
          els.camVideo.play();
          setVisible(els.cameraLoading, false);
          setVisible(els.cameraActive, true);
          setStatus(
            "Đang chờ vật đi vào",
            "Hệ thống sẽ tự chụp khi khung hình đã ổn định.",
            "Sẵn sàng nhận vật thể."
          );
          drawRoiOverlay();
          startStabilityWatch();
        };
      })
      .catch(function (err) {
        console.error("Camera error:", err);
        stopCamera();
        var message = "Không thể mở camera.";
        if (err && err.name === "NotAllowedError") {
          message = "Bạn đã từ chối quyền truy cập camera.";
        } else if (err && err.name === "NotFoundError") {
          message = "Không tìm thấy camera trên thiết bị.";
        } else if (err && err.name === "NotReadableError") {
          message = "Camera đang được ứng dụng khác sử dụng.";
        } else if (err && err.name === "SecurityError") {
          message = "Camera yêu cầu HTTPS hoặc localhost.";
        }
        showError(message);
      });
  }

  function startStabilityWatch() {
    if (sampleTimer) clearInterval(sampleTimer);
    sampleTimer = setInterval(sampleMotion, SAMPLE_INTERVAL_MS);
  }

  function sampleMotion() {
    if (isProcessing || !els.camVideo || !els.camVideo.videoWidth) return;

    drawVideoCover(sampleCtx, els.camVideo, SAMPLE_WIDTH, SAMPLE_HEIGHT);
    var imageData = sampleCtx.getImageData(0, 0, SAMPLE_WIDTH, SAMPLE_HEIGHT).data;
    var current = frameToRoiGrayData(imageData);

    if (!previousFrame) {
      previousFrame = current;
      return;
    }

    var score = calculateRoiMotionScore(previousFrame, current);
    previousFrame = current;
    updateMotionMeter(score);

    if (score >= MOTION_THRESHOLD) {
      hasSeenMotion = true;
      stableSince = null;
      updateSteps(true, false, false);
      setStatus(
        "Đang nhận vật",
        "Chờ đến khi vật nằm yên hoàn toàn trong ngăn.",
        "Đã thấy chuyển động, đang chờ ổn định."
      );
      return;
    }

    if (!hasSeenMotion) {
      setStatus(
        "Đang chờ vật đi vào",
        "Hệ thống sẽ tự chụp khi khung hình đã ổn định.",
        "Sẵn sàng nhận vật thể."
      );
      return;
    }

    if (score > STABLE_THRESHOLD) {
      stableSince = null;
      updateSteps(true, false, false);
      return;
    }

    if (!stableSince) {
      stableSince = Date.now();
    }

    var elapsed = Date.now() - stableSince;
    var remaining = Math.max(0, STABLE_DURATION_MS - elapsed);
    updateSteps(true, remaining === 0, false);
    setStatus(
      "Vật đã ổn định",
      "Phân loại sau " + (remaining / 1000).toFixed(1) + " giây.",
      "Khung hình ổn định, chuẩn bị phân loại."
    );

    if (elapsed >= STABLE_DURATION_MS) {
      classifyCurrentFrame();
    }
  }

  function updateMotionMeter(score) {
    var rounded = score.toFixed(1);
    var pct = Math.max(0, Math.min(100, (score / (MOTION_THRESHOLD * 2)) * 100));
    setText(els.motionValue, String(rounded));
    if (els.motionBar) {
      els.motionBar.style.width = pct.toFixed(0) + "%";
      els.motionBar.classList.toggle("bg-amber-400", score >= MOTION_THRESHOLD);
      els.motionBar.classList.toggle("bg-emerald-400", score < MOTION_THRESHOLD);
    }
  }

  function captureFrame(video, maxDim, quality) {
    return new Promise(function (resolve, reject) {
      if (!video.videoWidth || !video.videoHeight) {
        reject(new Error("Camera chưa sẵn sàng"));
        return;
      }

      var displayRect = video.getBoundingClientRect();
      var displayRatio = displayRect.width && displayRect.height
        ? displayRect.width / displayRect.height
        : video.videoWidth / video.videoHeight;
      var width;
      var height;

      if (displayRatio >= 1) {
        width = maxDim;
        height = Math.round(maxDim / displayRatio);
      } else {
        height = maxDim;
        width = Math.round(maxDim * displayRatio);
      }

      var fullCanvas = document.createElement("canvas");
      fullCanvas.width = width;
      fullCanvas.height = height;
      drawVideoCover(fullCanvas.getContext("2d"), video, width, height);

      var outputCanvas = fullCanvas;
      if (CAPTURE_ROI_ONLY) {
        var roi = getRoiUnion();
        var cropX = Math.floor(roi.x * width);
        var cropY = Math.floor(roi.y * height);
        var cropW = Math.max(1, Math.ceil(roi.w * width));
        var cropH = Math.max(1, Math.ceil(roi.h * height));
        outputCanvas = document.createElement("canvas");
        outputCanvas.width = cropW;
        outputCanvas.height = cropH;
        outputCanvas
          .getContext("2d")
          .drawImage(fullCanvas, cropX, cropY, cropW, cropH, 0, 0, cropW, cropH);
      }

      outputCanvas.toBlob(function (blob) {
        if (!blob) {
          reject(new Error("Không thể tạo ảnh từ camera"));
          return;
        }
        resolve(blob);
      }, "image/jpeg", quality);
    });
  }

  function classifyCurrentFrame() {
    if (isProcessing) return;
    isProcessing = true;
    if (sampleTimer) {
      clearInterval(sampleTimer);
      sampleTimer = null;
    }

    updateSteps(true, true, false);
    setStatus("Đang chụp ảnh", "Giữ nguyên vật trong ngăn.", "Đang chụp ảnh.");

    captureFrame(els.camVideo, CAPTURE_MAX_DIM, CAPTURE_QUALITY)
      .then(function (blob) {
        setStatus("Đang gửi ảnh", "Backend đang tạo yêu cầu phân loại.", "Đang gửi ảnh lên server.");
        return callAiRequestAPI(blob);
      })
      .then(function (created) {
        setStatus("ResNet50 đang phân loại", "Model chỉ trả về nhãn chất liệu.", "Đang chạy ResNet50.");
        return callPredictAPI(created.id, created.cloudinaryUrl).then(function () {
          return created.id;
        });
      })
      .then(function (aiRequestId) {
        updateSteps(true, true, true);
        return cacheDetail(aiRequestId).then(function () {
          window.location.href = "result.html?id=" + encodeURIComponent(aiRequestId);
        });
      })
      .catch(function (err) {
        console.error("Classify flow failed:", err);
        setStatus("Không phân loại được", err.message || "Vui lòng thử lại.", "Có lỗi khi phân loại.");
        isProcessing = false;
        resetGate();
        startStabilityWatch();
      });
  }

  function callAiRequestAPI(blob) {
    var formData = new FormData();
    formData.append("file", blob, "iot-capture.jpg");

    return fetch(API_BASE + "/api/v1/iot/ai_request", {
      method: "POST",
      headers: authHeaders(),
      body: formData,
    })
      .then(parseApiResponse)
      .then(function (data) {
        if (!data || data.id == null || !data.cloudinaryUrl) {
          throw new Error("Backend không trả về ảnh đã upload.");
        }
        return data;
      });
  }

  function callPredictAPI(aiRequestId, imageUrl) {
    var headers = authHeaders();
    headers["Content-Type"] = "application/json";

    return fetch(API_BASE + "/api/v1/iot/predict", {
      method: "POST",
      headers: headers,
      body: JSON.stringify({
        aiRequestId: aiRequestId,
        imageUrl: imageUrl,
      }),
    }).then(parseApiResponse);
  }

  function cacheDetail(aiRequestId) {
    var headers = authHeaders();
    return fetch(API_BASE + "/api/v1/iot/ai_response/" + encodeURIComponent(aiRequestId) + "/detail", {
      method: "GET",
      headers: headers,
    })
      .then(parseApiResponse)
      .then(function (detail) {
        try {
          sessionStorage.setItem("iot_detail_cache", JSON.stringify(detail));
          sessionStorage.setItem("iot_detail_id", String(aiRequestId));
        } catch (_) {
          // Storage is an optimization only.
        }
      })
      .catch(function (err) {
        console.warn("Detail cache skipped:", err.message);
      });
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

  function init() {
    cacheDom();

    if (els.btnRetry) {
      els.btnRetry.addEventListener("click", function () {
        startCamera(currentFacingMode);
      });
    }

    if (els.btnSwitchCam) {
      els.btnSwitchCam.addEventListener("click", function () {
        var next = currentFacingMode === "environment" ? "user" : "environment";
        startCamera(next);
      });
    }

    if (els.btnCaptureNow) {
      els.btnCaptureNow.addEventListener("click", classifyCurrentFrame);
    }

    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      showError("Trình duyệt không hỗ trợ camera.");
      return;
    }

    startCamera(currentFacingMode);
    window.addEventListener("resize", drawRoiOverlay);
    window.addEventListener("beforeunload", stopCamera);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
