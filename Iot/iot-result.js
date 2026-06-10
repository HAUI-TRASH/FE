/**
 * iot-result.js
 * ── IoT Result Page Integration ──
 *
 * File này cầu nối giữa result.html và API của module IoT.
 *
 * Vấn đề: result.html gọi API /api/v1/iot/ai_response/{id}/detail
 *          nhưng module IoT dùng /api/v1/iot/ai_response/{id}/detail
 *
 * Giải pháp:
 *  1. Monkey-patch window.fetch để tự động rewrite URL từ
 *     /api/v1/iot/ai_response/ → /api/v1/iot/ai_response/
 *  2. Kiểm tra sessionStorage để dùng dữ liệu cache từ iot-main.js
 *     (nếu có), giúp load trang nhanh hơn.
 *
 * Yêu cầu: File này phải được load TRƯỚC inline <script> trong result.html
 *          (nơi gọi loadResult()). Thêm ngay sau <script src="common.js">.
 */

(function () {
  "use strict";

  // ================================================================
  // 1. Dùng dữ liệu cache từ sessionStorage (nếu có)
  // ================================================================
  // Khi iot-main.js chuyển hướng sang result.html, nó lưu kết quả
  // detail vào sessionStorage. Nếu có cache, ta có thể inject trước
  // để result.html không cần gọi lại API.

  var CACHE_KEY = "iot_detail_cache";
  var CACHE_ID_KEY = "iot_detail_id";

  try {
    var cachedData = sessionStorage.getItem(CACHE_KEY);
    var cachedId = sessionStorage.getItem(CACHE_ID_KEY);
    var urlId = new URLSearchParams(window.location.search).get("id");

    if (cachedData && cachedId && urlId && String(cachedId) === String(urlId)) {
      // Cache khớp với id trên URL → lưu vào biến toàn cục
      // để inline script có thể kiểm tra và dùng
      window.__iotCachedDetail = JSON.parse(cachedData);
      console.log(
        "[iot-result] Dùng dữ liệu cache cho id=" + cachedId
      );
    }
  } catch (e) {
    // Không làm gì nếu sessionStorage lỗi
    console.warn("[iot-result] Không đọc được cache:", e.message);
  }

  // ================================================================
  // 2. Monkey-patch window.fetch để rewrite URL IoT
  // ================================================================
  var _originalFetch = window.fetch;

  window.fetch = function (url, options) {
    // Chỉ xử lý string URL (fetch cũng hỗ trợ Request object)
    if (typeof url === "string") {
      // Rewrite /api/v1/iot/ai_response/ → /api/v1/iot/ai_response/
      if (url.indexOf("/api/v1/iot/ai_response/") !== -1) {
        url = url.replace("/api/v1/iot/ai_response/", "/api/v1/iot/ai_response/");
        console.log("[iot-result] Rewrote URL:", url);
      }
      // Rewrite /api/v1/iot/ai_request → /api/v1/iot/ai_request
      if (url.indexOf("/api/v1/iot/ai_request") !== -1) {
        url = url.replace("/api/v1/iot/ai_request", "/api/v1/iot/ai_request");
        console.log("[iot-result] Rewrote URL:", url);
      }
      // Rewrite /api/v1/iot/ai_requests/ → /api/v1/iot/ai_requests/
      if (url.indexOf("/api/v1/iot/ai_requests/") !== -1) {
        url = url.replace("/api/v1/iot/ai_requests/", "/api/v1/iot/ai_requests/");
        console.log("[iot-result] Rewrote URL:", url);
      }
    }

    return _originalFetch.call(window, url, options);
  };

  // Cho phép các script khác truy cập fetch gốc nếu cần
  window.__iotOriginalFetch = _originalFetch;

  // ================================================================
  // 3. Cleanup cache sau khi đã dùng
  // ================================================================
  // Xóa cache sau 5 giây để tránh dùng dữ liệu cũ cho lần sau
  setTimeout(function () {
    try {
      sessionStorage.removeItem(CACHE_KEY);
      sessionStorage.removeItem(CACHE_ID_KEY);
      window.__iotCachedDetail = undefined;
    } catch (e) {
      // ignore
    }
  }, 5000);

  console.log("[iot-result] Đã khởi tạo IoT result integration");
})();
