/**
 * iot-main.js
 * ── IoT Camera & AI Trash Detection Flow ──
 *
 * Luồng xử lý:
 *  1. Mở camera
 *  2. Polling POST /api/v1/iot/realtime mỗi 800ms với frame từ camera
 *  3. Khi phát hiện vật thể (confidence >= threshold) → dừng polling
 *  4. Chờ 2 giây để vật thể ổn định
 *  5. Chụp ảnh chất lượng cao từ camera
 *  6. POST /api/v1/iot/ai_request (upload ảnh) → lấy aiRequestId
 *  7. POST /api/v1/iot/predict (chạy YOLO) → lấy aiResponseId
 *  8. GET /api/v1/iot/ai_response/{id}/detail → lấy kết quả chi tiết
 *  9. Chuyển hướng sang result.html?id={aiResponseId}
 *
 * Yêu cầu: File này cần được load TRƯỚC inline script trong index.html.
 *          Thêm <script src="iot-main.js"></script> vào <head> hoặc đầu <body>.
 */

(function () {
  "use strict";

  // ================================================================
  // CONSTANTS
  // ================================================================
  var REALTIME_POLL_MS = 800; // Khoảng cách giữa các lần gọi realtime API
  var STABILIZE_DELAY_MS = 2000; // Thời gian chờ ổn định sau khi phát hiện
  var DETECTION_THRESHOLD = 0.25; // Ngưỡng confidence tối thiểu để coi là phát hiện
  var FRAME_MAX_DIM = 512; // Kích thước tối đa của frame gửi đi realtime
  var CAPTURE_MAX_DIM = 1024; // Kích thước tối đa của ảnh chụp để gửi AI
  var FRAME_QUALITY = 0.85; // Chất lượng JPEG cho realtime
  var CAPTURE_QUALITY = 0.92; // Chất lượng JPEG cho ảnh chụp AI

  // ================================================================
  // STATE
  // ================================================================
  var cameraStream = null;
  var pollTimer = null;
  var isProcessing = false; // Ngăn gọi API lặp khi đang xử lý một ảnh
  var currentFacingMode = "environment";
  var lastFrameDims = { w: 512, h: 512 };
  var processingToast = null; // Tham chiếu tới toast đang hiển thị

  // ================================================================
  // DOM REFS (lấy sau khi DOM sẵn sàng)
  // ================================================================
  var els = {};

  function cacheDom() {
    els.cameraLoading = document.getElementById("cameraLoading");
    els.cameraError = document.getElementById("cameraError");
    els.cameraErrorMsg = document.getElementById("cameraErrorMsg");
    els.cameraActive = document.getElementById("cameraActive");
    els.cameraControls = document.getElementById("cameraControls");
    els.camTip = document.getElementById("camTip");
    els.cameraZone = document.getElementById("cameraZone");
    els.camVideo = document.getElementById("camVideo");
    els.overlayCanvas = document.getElementById("overlayCanvas");
    els.realtimeBadge = document.getElementById("realtimeBadge");
    els.realtimeText = document.getElementById("realtimeText");
    els.realtimeConf = document.getElementById("realtimeConf");
    els.realtimeStatusDot = document.getElementById("realtimeStatusDot");
    els.btnRetry = document.getElementById("btnRetry");
    els.btnSwitchCam = document.getElementById("btnSwitchCam");
    els.btnCloseCam = document.getElementById("btnCloseCam");
  }

  // ================================================================
  // UTILITY HELPERS
  // ================================================================
  function getToken() {
    return localStorage.getItem("accessToken") || "";
  }

  function authHeaders() {
    var h = {};
    var t = getToken();
    if (t) h["Authorization"] = "Bearer " + t;
    return h;
  }

  function sleep(ms) {
    return new Promise(function (resolve) {
      setTimeout(resolve, ms);
    });
  }

  /**
   * Hiển thị toast nhẹ, không tích lũy quá nhiều toast.
   * Nếu đang có toast cũ thì thay nội dung thay vì tạo mới.
   */
  function showToast(message, type) {
    type = type || "info";

    // Xoá toast cũ nếu có
    if (processingToast) {
      processingToast.remove();
      processingToast = null;
    }

    var t = document.createElement("div");
    t.className =
      "fixed z-[9999] left-1/2 -translate-x-1/2 top-6 px-4 py-3 rounded-xl border text-sm shadow-2xl backdrop-blur-md transition-all duration-300";

    if (type === "success") {
      t.classList.add("border-green-500/30", "bg-green-500/10", "text-green-900");
    } else if (type === "error") {
      t.classList.add("border-red-500/30", "bg-red-500/10", "text-red-900");
    } else if (type === "loading") {
      t.classList.add("border-blue-500/30", "bg-blue-500/10", "text-blue-900");
    } else {
      t.classList.add("border-slate-200", "bg-white/80", "text-slate-900");
    }

    t.textContent = message;
    document.body.appendChild(t);
    processingToast = t;

    // Tự ẩn sau 3.5 giây (trừ khi là loading)
    if (type !== "loading") {
      setTimeout(function () {
        if (processingToast === t) {
          t.remove();
          processingToast = null;
        }
      }, 3500);
    }

    return t;
  }

  function hideToast() {
    if (processingToast) {
      processingToast.remove();
      processingToast = null;
    }
  }

  // ================================================================
  // CAMERA MANAGEMENT
  // ================================================================
  function stopCamera() {
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
    if (cameraStream) {
      cameraStream.getTracks().forEach(function (t) {
        t.stop();
      });
      cameraStream = null;
    }
  }

  function showError(msg) {
    if (els.cameraLoading) els.cameraLoading.classList.add("hidden");
    if (els.cameraActive) els.cameraActive.classList.add("hidden");
    if (els.cameraControls) els.cameraControls.classList.add("hidden");
    if (els.camTip) els.camTip.classList.add("hidden");
    if (els.cameraError) els.cameraError.classList.remove("hidden");
    if (els.cameraErrorMsg) els.cameraErrorMsg.textContent = msg;
  }

  /**
   * Khởi động camera và bắt đầu luồng phát hiện.
   */
  function startCamera(facingMode) {
    // Reset state
    stopCamera();
    isProcessing = false;
    hideToast();

    if (els.cameraLoading) els.cameraLoading.classList.remove("hidden");
    if (els.cameraError) els.cameraError.classList.add("hidden");
    if (els.cameraActive) els.cameraActive.classList.add("hidden");
    if (els.cameraControls) els.cameraControls.classList.add("hidden");
    if (els.camTip) els.camTip.classList.add("hidden");

    var constraints = {
      video: { facingMode: facingMode },
      audio: false,
    };

    return navigator.mediaDevices
      .getUserMedia(constraints)
      .then(function (stream) {
        cameraStream = stream;
        currentFacingMode = facingMode;

        var video = els.camVideo;
        video.srcObject = stream;

        video.onloadedmetadata = function () {
          video.play();

          if (els.cameraLoading) els.cameraLoading.classList.add("hidden");
          if (els.cameraActive) els.cameraActive.classList.remove("hidden");
          if (els.cameraControls) els.cameraControls.classList.remove("hidden");
          if (els.camTip) els.camTip.classList.remove("hidden");
          if (els.cameraZone) els.cameraZone.classList.add("border-[#3B82F6]");

          // Bắt đầu luồng phát hiện realtime bằng REST
          startRealtimePolling(video);
        };

        // Gán sự kiện cho nút điều khiển
        if (els.btnCloseCam) {
          els.btnCloseCam.onclick = function () {
            stopCamera();
            showError("Camera đã tắt. Tải lại trang để thử lại.");
          };
        }

        if (els.btnSwitchCam) {
          els.btnSwitchCam.onclick = function () {
            var next =
              currentFacingMode === "environment" ? "user" : "environment";
            startCamera(next);
          };
        }
      })
      .catch(function (err) {
        console.error("Camera error:", err);
        stopCamera();
        var msg = "Không thể mở camera.";
        if (err && err.name === "NotAllowedError")
          msg =
            "Bạn đã từ chối quyền truy cập camera. Vào cài đặt trình duyệt để cấp quyền.";
        if (err && err.name === "NotFoundError")
          msg = "Không tìm thấy camera trên thiết bị.";
        if (err && err.name === "NotReadableError")
          msg = "Camera đang được ứng dụng khác sử dụng.";
        if (err && err.name === "SecurityError")
          msg = "Camera yêu cầu kết nối HTTPS hoặc localhost.";
        showError(msg);
      });
  }

  // ================================================================
  // FRAME CAPTURE
  // ================================================================

  /**
   * Chụp một frame từ video, resize về kích thước tối đa, trả về Blob.
   */
  function captureFrame(video, maxDim, quality) {
    maxDim = maxDim || FRAME_MAX_DIM;
    quality = quality || FRAME_QUALITY;

    return new Promise(function (resolve, reject) {
      try {
        var fw = video.videoWidth;
        var fh = video.videoHeight;

        if (!fw || !fh) {
          reject(new Error("Video chưa sẵn sàng"));
          return;
        }

        if (fw > maxDim || fh > maxDim) {
          var ratio = Math.min(maxDim / fw, maxDim / fh);
          fw = Math.round(fw * ratio);
          fh = Math.round(fh * ratio);
        }

        var canvas = document.createElement("canvas");
        canvas.width = fw || maxDim;
        canvas.height = fh || maxDim;
        var ctx = canvas.getContext("2d");
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

        lastFrameDims = { w: canvas.width, h: canvas.height };

        canvas.toBlob(
          function (blob) {
            if (!blob) {
              reject(new Error("Không thể tạo ảnh từ camera"));
              return;
            }
            resolve(blob);
          },
          "image/jpeg",
          quality
        );
      } catch (err) {
        reject(err);
      }
    });
  }

  // ================================================================
  // BOUNDING BOX DRAWING (trên overlay canvas)
  // ================================================================
  function clearOverlay() {
    var canvas = els.overlayCanvas;
    if (!canvas) return;
    var ctx = canvas.getContext("2d");
    var rect = els.cameraZone
      ? els.cameraZone.getBoundingClientRect()
      : { width: canvas.width, height: canvas.height };
    if (canvas.width !== rect.width || canvas.height !== rect.height) {
      canvas.width = rect.width;
      canvas.height = rect.height;
    }
    ctx.clearRect(0, 0, canvas.width, canvas.height);
  }

  function drawBoundingBox(detection) {
    var canvas = els.overlayCanvas;
    if (!canvas) return;
    var ctx = canvas.getContext("2d");

    var rect = els.cameraZone
      ? els.cameraZone.getBoundingClientRect()
      : { width: canvas.width, height: canvas.height };
    if (canvas.width !== rect.width || canvas.height !== rect.height) {
      canvas.width = rect.width;
      canvas.height = rect.height;
    }
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    if (
      detection.x1 == null ||
      detection.x2 == null ||
      detection.y1 == null ||
      detection.y2 == null
    )
      return;

    var scaleX = canvas.width / lastFrameDims.w;
    var scaleY = canvas.height / lastFrameDims.h;

    var x = detection.x1 * scaleX;
    var y = detection.y1 * scaleY;
    var w = (detection.x2 - detection.x1) * scaleX;
    var h = (detection.y2 - detection.y1) * scaleY;

    // Vẽ viền
    ctx.strokeStyle = "#3B82F6";
    ctx.lineWidth = 3;
    ctx.strokeRect(x, y, w, h);

    // Vẽ label
    var conf = detection.confidence
      ? (detection.confidence * 100).toFixed(0)
      : "?";
    var labelText =
      (detection.labelDisplay || detection.label || "Vật thể") + " " + conf + "%";
    ctx.font = "bold 16px 'Space Grotesk', sans-serif";
    var textWidth = ctx.measureText(labelText).width;
    var textBgHeight = 26;
    ctx.fillStyle = "#3B82F6";
    ctx.fillRect(x, Math.max(0, y - textBgHeight), textWidth + 12, textBgHeight);
    ctx.fillStyle = "#FFFFFF";
    ctx.fillText(labelText, x + 6, Math.max(0, y - textBgHeight) + 18);
  }

  // ================================================================
  // REALTIME BADGE UI
  // ================================================================
  function updateRealtimeBadge(detection) {
    var badge = els.realtimeBadge;
    var textEl = els.realtimeText;
    var confEl = els.realtimeConf;
    var dot = els.realtimeStatusDot;

    if (!badge || !textEl || !confEl || !dot) return;

    if (detection && detection.labelDisplay && detection.confidence >= DETECTION_THRESHOLD) {
      // Có phát hiện
      badge.classList.remove("opacity-0", "translate-y-2");
      badge.classList.add("opacity-100", "translate-y-0");
      textEl.textContent = detection.labelDisplay;
      confEl.textContent =
        "Độ tin cậy: " + (detection.confidence * 100).toFixed(1) + "%";
      dot.classList.replace("bg-slate-400", "bg-emerald-500");
      dot.classList.add("animate-pulse");
    } else {
      // Không phát hiện
      badge.classList.add("opacity-0", "translate-y-2");
      badge.classList.remove("opacity-100", "translate-y-0");
      textEl.textContent = "Đang chờ rác...";
      confEl.textContent = "";
      dot.classList.replace("bg-emerald-500", "bg-slate-400");
      dot.classList.remove("animate-pulse");
    }
  }

  // ================================================================
  // API: REALTIME POLLING
  // ================================================================

  /**
   * Gọi POST /api/v1/iot/realtime để kiểm tra camera có vật thể không.
   * Trả về dữ liệu detection hoặc null nếu không phát hiện thấy gì.
   */
  function callRealtimeAPI(blob) {
    var formData = new FormData();
    formData.append("file", blob, "frame.jpg");

    return fetch(API_BASE + "/api/v1/iot/realtime", {
      method: "POST",
      headers: authHeaders(),
      body: formData,
    })
      .then(function (res) {
        if (!res.ok) {
          throw new Error("Realtime API trả về lỗi: " + res.status);
        }
        return res.json();
      })
      .then(function (data) {
        // Nếu có labelDisplay và confidence > 0 thì coi là phát hiện
        if (
          data &&
          data.labelDisplay &&
          typeof data.confidence === "number" &&
          data.confidence >= DETECTION_THRESHOLD
        ) {
          return data;
        }
        return null;
      })
      .catch(function (err) {
        console.error("Realtime API error:", err);
        return null; // Lỗi mạng -> coi như không phát hiện, tiếp tục poll
      });
  }

  /**
   * Một chu kỳ poll: chụp frame → gọi realtime API → kiểm tra kết quả.
   */
  function pollOnce(video) {
    if (isProcessing) return;

    return captureFrame(video, FRAME_MAX_DIM, FRAME_QUALITY)
      .then(function (blob) {
        if (isProcessing) return null;
        return callRealtimeAPI(blob);
      })
      .then(function (detection) {
        if (isProcessing) return;

        // Luôn clear overlay trước khi vẽ mới
        clearOverlay();

        if (detection) {
          // Có vật thể! → dừng polling, xử lý tiếp
          onObjectDetected(video, detection);
        } else {
          // Không có vật thể → cập nhật badge, tiếp tục poll
          updateRealtimeBadge(null);
        }
      })
      .catch(function (err) {
        if (!isProcessing) {
          console.error("Poll error:", err);
          updateRealtimeBadge(null);
        }
      });
  }

  function startRealtimePolling(video) {
    // Reset trạng thái badge
    updateRealtimeBadge(null);
    clearOverlay();

    // Chạy lần đầu ngay lập tức
    pollOnce(video);

    // Sau đó poll định kỳ
    pollTimer = setInterval(function () {
      pollOnce(video);
    }, REALTIME_POLL_MS);
  }

  // ================================================================
  // OBJECT DETECTED → CAPTURE → AI PIPELINE
  // ================================================================

  /**
   * Khi phát hiện vật thể:
   *  1. Dừng polling
   *  2. Hiển thị badge + bounding box
   *  3. Chờ 2 giây
   *  4. Chụp ảnh → ai_request → predict → detail → redirect
   */
  function onObjectDetected(video, detectionData) {
    // 1. Dừng polling tạm thời
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
    isProcessing = true;

    // 2. Cập nhật UI
    updateRealtimeBadge(detectionData);
    drawBoundingBox(detectionData);

    var labelName = detectionData.labelDisplay || detectionData.label || "vật thể";
    showToast(
      "Đã phát hiện " + labelName + "! Đang chờ ổn định...",
      "loading"
    );

    // 3. Chờ 2 giây để vật thể ổn định
    sleep(STABILIZE_DELAY_MS)
      .then(function () {
        if (!cameraStream) throw new Error("Camera đã tắt");

        // 4. Chụp ảnh chất lượng cao
        showToast("Đang chụp ảnh...", "loading");
        return captureFrame(video, CAPTURE_MAX_DIM, CAPTURE_QUALITY);
      })
      .then(function (capturedBlob) {
        // 5. Gọi API ai_request để upload ảnh
        showToast("Đang gửi ảnh lên server...", "loading");
        return callAiRequestAPI(capturedBlob);
      })
      .then(function (aiRequestId) {
        // 6. Gọi API predict để YOLO dự đoán
        showToast("AI đang phân tích ảnh...", "loading");
        return callPredictAPI(aiRequestId);
      })
      .then(function (aiResponseId) {
        // 7. Gọi API detail để lấy kết quả đầy đủ
        showToast("Đang tải kết quả chi tiết...", "loading");
        return callDetailAPI(aiResponseId);
      })
      .then(function (detailData) {
        // 8. Thành công → chuyển hướng tới result.html
        hideToast();
        showToast("Nhận diện thành công! Đang chuyển đến kết quả...", "success");

        // Lưu dữ liệu vào sessionStorage để result.html có thể dùng
        try {
          sessionStorage.setItem(
            "iot_detail_cache",
            JSON.stringify(detailData)
          );
          sessionStorage.setItem(
            "iot_detail_id",
            String(detailData.id || "")
          );
        } catch (e) {
          // ignore storage errors
        }

        return sleep(600).then(function () {
          window.location.href =
            "result.html?id=" + encodeURIComponent(detailData.id || "");
        });
      })
      .catch(function (err) {
        // Xử lý lỗi ở bất kỳ bước nào
        console.error("IoT detection pipeline error:", err);
        hideToast();
        showToast(
          "Lỗi: " + (err.message || "Không thể xử lý ảnh") + ". Đang thử lại...",
          "error"
        );

        // Reset trạng thái và tiếp tục polling
        isProcessing = false;
        clearOverlay();
        updateRealtimeBadge(null);

        if (cameraStream && video) {
          startRealtimePolling(video);
        }
      });
  }

  // ================================================================
  // API: AI_REQUEST
  // ================================================================

  /**
   * POST /api/v1/iot/ai_request
   * Upload ảnh lên server, tạo AI request.
   * Trả về aiRequestId (Integer).
   */
  function callAiRequestAPI(blob) {
    var formData = new FormData();
    formData.append("file", blob, "capture.jpg");

    return fetch(API_BASE + "/api/v1/iot/ai_request", {
      method: "POST",
      headers: authHeaders(),
      body: formData,
    }).then(function (res) {
      if (!res.ok) {
        return res
          .json()
          .catch(function () {
            return null;
          })
          .then(function (json) {
            var msg =
              json && json.message
                ? json.message
                : "Không thể tạo AI request (HTTP " + res.status + ")";
            throw new Error(msg);
          });
      }
      return res.json();
    }).then(function (json) {
      if (!json || json.id == null) {
        throw new Error("AI request response không chứa id");
      }
      return json.id;
    });
  }

  // ================================================================
  // API: PREDICT
  // ================================================================

  /**
   * POST /api/v1/iot/predict
   * Gửi aiRequestId để YOLO dự đoán và lưu kết quả detection.
   * Trả về aiResponseId (Integer, field "requestId" trong response).
   */
  function callPredictAPI(aiRequestId) {
    var body = {
      aiRequestId: aiRequestId,
      conf: 0.25,
      iou: 0.6,
    };

    var headers = authHeaders();
    headers["Content-Type"] = "application/json";

    return fetch(API_BASE + "/api/v1/iot/predict", {
      method: "POST",
      headers: headers,
      body: JSON.stringify(body),
    }).then(function (res) {
      if (!res.ok) {
        return res
          .json()
          .catch(function () {
            return null;
          })
          .then(function (json) {
            var msg =
              json && json.message
                ? json.message
                : "Không thể chạy dự đoán (HTTP " + res.status + ")";
            throw new Error(msg);
          });
      }
      return res.json();
    }).then(function (json) {
      if (!json || json.requestId == null) {
        throw new Error("Predict response không chứa requestId");
      }
      return json.requestId;
    });
  }

  // ================================================================
  // API: DETAIL
  // ================================================================

  /**
   * GET /api/v1/iot/ai_response/{id}/detail
   * Lấy chi tiết kết quả detection (bao gồm material, note, action, etc.)
   */
  function callDetailAPI(aiResponseId) {
    return fetch(
      API_BASE + "/api/v1/iot/ai_response/" + encodeURIComponent(aiResponseId) + "/detail",
      {
        method: "GET",
        headers: authHeaders(),
      }
    ).then(function (res) {
      if (!res.ok) {
        return res
          .json()
          .catch(function () {
            return null;
          })
          .then(function (json) {
            var msg =
              json && json.message
                ? json.message
                : "Không thể lấy chi tiết kết quả (HTTP " + res.status + ")";
            throw new Error(msg);
          });
      }
      return res.json();
    }).then(function (json) {
      if (!json) {
        throw new Error("Detail response rỗng");
      }
      return json;
    });
  }

  // ================================================================
  // INIT
  // ================================================================

  function init() {
    cacheDom();

    // Gán sự kiện cho nút retry
    if (els.btnRetry) {
      els.btnRetry.addEventListener("click", function () {
        startCamera(currentFacingMode);
      });
    }

    // Tự động mở camera khi trang load
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      showError("Trình duyệt không hỗ trợ camera.");
      return;
    }

    startCamera(currentFacingMode);

    // Cleanup khi rời trang
    window.addEventListener("beforeunload", function () {
      stopCamera();
    });
  }

  // Chạy sau khi DOM sẵn sàng
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
