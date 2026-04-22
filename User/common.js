/**
 * Giải mã JWT và kiểm tra xem token có hết hạn chưa.
 * Trả về true nếu token KHÔNG hợp lệ hoặc đã hết hạn.
 */
function isTokenExpired(token) {
  if (!token || token === "null" || token === "undefined") return true;
  try {
    // JWT gồm 3 phần: header.payload.signature — lấy phần giữa
    const payloadBase64 = token.split(".")[1];
    if (!payloadBase64) return true;

    // Base64url → Base64 chuẩn rồi decode
    const base64 = payloadBase64.replace(/-/g, "+").replace(/_/g, "/");
    const payload = JSON.parse(atob(base64));

    // `exp` là số giây Unix, Date.now() trả về milli-giây
    if (!payload.exp) return true;
    return Date.now() >= payload.exp * 1000;
  } catch (e) {
    console.warn("Không thể giải mã JWT:", e);
    return true; // Coi như hết hạn nếu lỗi
  }
}

function renderAuthUI() {
  const token = localStorage.getItem("accessToken");

  // Kiểm tra token có tồn tại VÀ chưa hết hạn
  if (isTokenExpired(token)) {
    // Xóa token hết hạn để trang hiển thị đúng trạng thái "chưa đăng nhập"
    localStorage.removeItem("accessToken");
    localStorage.removeItem("account");
  }

  const freshToken = localStorage.getItem("accessToken");
  const isLoggedIn = freshToken && freshToken !== "null" && freshToken !== "undefined";
  const acc = JSON.parse(localStorage.getItem("account") || "{}");

  const btns = document.getElementById("auth-buttons");
  const userBox = document.getElementById("user-box");
  const avatar = document.getElementById("user-menu-button");

  if (!btns || !userBox) return;

  if (isLoggedIn) {
    btns.classList.add("hidden");
    userBox.classList.remove("hidden");

    const defaultAvatar = "./avt.png";
    if (avatar) {
      avatar.style.backgroundImage = `url('${acc?.avatarUrl || defaultAvatar}')`;
    }
  } else {
    btns.classList.remove("hidden");
    userBox.classList.add("hidden");
  }
}

function setActiveMenu() {
  const links = document.querySelectorAll(".nav-link");
  const currentPage = window.location.pathname.split("/").pop() || "index.html";

  links.forEach((link) => {
    const linkPage = link.getAttribute("href");
    if (linkPage === currentPage) {
      link.classList.add("active");
    } else {
      link.classList.remove("active");
    }
  });
}

function toggleUserMenu() {
  const menu = document.getElementById("user-menu");
  menu?.classList.toggle("hidden");
}

function toggleMobileMenu() {
  const menu = document.getElementById("mobile-menu");
  menu?.classList.toggle("hidden");
}

async function loadComponent(id, file) {
  try {
    const res = await fetch(file);
    if (!res.ok) throw new Error(`Could not load ${file}`);
    const html = await res.text();
    const container = document.getElementById(id);
    if (!container) return;
    container.innerHTML = html;

    if (id === "header-container") {
      setActiveMenu();
      renderAuthUI();
    }
  } catch (err) {
    console.error("Error loading component:", err);
  }
}

// Global click handler to close menus when clicking outside
document.addEventListener("click", function (event) {
  const userBtn = document.getElementById("user-menu-button");
  const userMenu = document.getElementById("user-menu");
  const mobileBtn = document.getElementById("mobile-menu-button");
  const mobileMenu = document.getElementById("mobile-menu");

  if (userMenu && userBtn && !userBtn.contains(event.target) && !userMenu.contains(event.target)) {
    userMenu.classList.add("hidden");
  }

  if (mobileMenu && mobileBtn && !mobileBtn.contains(event.target) && !mobileMenu.contains(event.target)) {
    mobileMenu.classList.add("hidden");
  }
});

window.ecoscanLogout = function () {
  localStorage.removeItem("accessToken");
  localStorage.removeItem("account");
  window.location.href = "login.html";
};