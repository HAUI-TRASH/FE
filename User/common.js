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

  // Check if token exists AND not expired
  if (isTokenExpired(token)) {
    localStorage.removeItem("accessToken");
    localStorage.removeItem("account");
  }

  const freshToken = localStorage.getItem("accessToken");
  const isLoggedIn = freshToken && freshToken !== "null" && freshToken !== "undefined";

  const btns = document.getElementById("auth-buttons");
  const userBox = document.getElementById("user-box");
  const avatar = document.getElementById("user-menu-button");

  // Mobile auth elements
  const mobileBtns = document.getElementById("mobile-auth-buttons");
  const mobileUserBox = document.getElementById("mobile-user-box");

  if (!btns || !userBox) return;

  if (isLoggedIn) {
    // Show user box, hide login buttons immediately
    btns.classList.add("hidden");
    userBox.classList.remove("hidden");

    // Mobile: hide auth buttons, show user box
    if (mobileBtns) mobileBtns.classList.add("hidden");
    if (mobileUserBox) mobileUserBox.classList.remove("hidden");

    // Set default avatar while fetching
    const defaultAvatar = "./avt.png";
    if (avatar) {
      avatar.style.backgroundImage = `url('${defaultAvatar}')`;
    }

    // Call GET /me to fetch fresh user info
    fetch(API_BASE + "/api/v1/auth/me", {
      method: "GET",
      headers: {
        "Authorization": "Bearer " + freshToken,
        "Content-Type": "application/json"
      }
    })
      .then(res => {
        if (res.status === 401 || res.status === 403) {
          // Token invalid → force logout
          localStorage.removeItem("accessToken");
          localStorage.removeItem("account");
          btns.classList.remove("hidden");
          userBox.classList.add("hidden");
          if (mobileBtns) mobileBtns.classList.remove("hidden");
          if (mobileUserBox) mobileUserBox.classList.add("hidden");
          return null;
        }
        return res.json();
      })
      .then(json => {
        if (!json) return;
        const account = json?.data || json;
        // Save fresh account info
        localStorage.setItem("account", JSON.stringify(account));
        // Update desktop avatar
        if (avatar && account?.avatarUrl) {
          avatar.style.backgroundImage = `url('${account.avatarUrl}')`;
        }
        // Update desktop name + email in dropdown
        const userNameEl = document.getElementById("user-menu-name");
        if (userNameEl && account?.fullName) {
          userNameEl.textContent = account.fullName;
        } else if (userNameEl && account?.username) {
          userNameEl.textContent = account.username;
        } else if (userNameEl) {
          userNameEl.textContent = "Người dùng";
        }
        const userEmailEl = document.getElementById("user-menu-email");
        if (userEmailEl && account?.email) {
          userEmailEl.textContent = account.email;
        }
        // Update mobile user info
        const mobileAvatar = document.getElementById("mobile-user-avatar");
        if (mobileAvatar && account?.avatarUrl) {
          mobileAvatar.style.backgroundImage = `url('${account.avatarUrl}')`;
        } else if (mobileAvatar) {
          mobileAvatar.style.backgroundImage = `url('./avt.png')`;
        }
        const mobileNameEl = document.getElementById("mobile-user-name");
        if (mobileNameEl && account?.fullName) {
          mobileNameEl.textContent = account.fullName;
        } else if (mobileNameEl && account?.username) {
          mobileNameEl.textContent = account.username;
        } else if (mobileNameEl) {
          mobileNameEl.textContent = "Người dùng";
        }
        const mobileEmailEl = document.getElementById("mobile-user-email");
        if (mobileEmailEl && account?.email) {
          mobileEmailEl.textContent = account.email;
        }
      })
      .catch(err => {
        console.warn("Failed to fetch /me:", err);
        // Keep showing default avatar on network error
      });
  } else {
    // Not logged in → show login/register buttons
    btns.classList.remove("hidden");
    userBox.classList.add("hidden");
    if (mobileBtns) mobileBtns.classList.remove("hidden");
    if (mobileUserBox) mobileUserBox.classList.add("hidden");
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
  const authArea = document.getElementById("auth-area");
  if (!menu) return;
  const isOpen = !menu.classList.contains("hidden");
  menu.classList.toggle("hidden");
  // Hide header auth buttons when menu is open (already shown inside menu)
  if (authArea) {
    if (isOpen) {
      authArea.classList.remove("hidden");   // restoring
    } else {
      authArea.classList.add("hidden");       // hiding
    }
  }
}

// ── Brand variant dropdown ──
function toggleBrandDropdown() {
  const menu = document.getElementById("brand-menu");
  const arrow = document.getElementById("brand-arrow");
  const mobileIcon = document.getElementById("brand-mobile-icon");
  if (!menu) return;
  menu.classList.toggle("hidden");
  if (arrow) arrow.classList.toggle("rotate-180");
  if (mobileIcon) {
    mobileIcon.classList.toggle("text-[#1D4ED8]");
    mobileIcon.classList.toggle("text-[#3B82F6]");
  }
}

function selectBrand(brand, el) {
  const label = document.getElementById("brand-label");
  const menu = document.getElementById("brand-menu");
  const arrow = document.getElementById("brand-arrow");
  const mobileIcon = document.getElementById("brand-mobile-icon");
  if (!label || !menu) return;

  const oldBrand = label.textContent;
  label.textContent = brand;
  // Update mobile brand label
  const mobileLabel = document.getElementById("mobile-brand-label");
  if (mobileLabel) mobileLabel.textContent = brand;

  // Close PC dropdown
  menu.classList.add("hidden");
  if (arrow) arrow.classList.remove("rotate-180");
  if (mobileIcon) {
    mobileIcon.classList.remove("text-[#1D4ED8]");
    mobileIcon.classList.add("text-[#3B82F6]");
  }

  // Highlight active option in PC dropdown
  document.querySelectorAll(".brand-option").forEach(btn => {
    btn.classList.remove("bg-[#F1F5F9]");
  });
  el.classList.add("bg-[#F1F5F9]");

  // Persist selection
  localStorage.setItem("ecoscan_brand", brand);

  // Reload page if brand actually changed
  if (oldBrand !== brand) {
    window.location.reload();
    return;
  }
  // Dispatch event for other components (if same brand, just close dropdown)
  window.dispatchEvent(new CustomEvent("brandChanged", { detail: { brand } }));
}

function restoreBrandSelection() {
  const saved = localStorage.getItem("ecoscan_brand");
  const brand = saved || "SmartDisposal-U";
  const label = document.getElementById("brand-label");
  const mobileLabel = document.getElementById("mobile-brand-label");
  if (label) label.textContent = brand;
  if (mobileLabel) mobileLabel.textContent = brand;
  applyBrandNav(brand);
}

// Show/hide nav items & page sections based on selected brand
function applyBrandNav(brand) {
  // Extract suffix: SmartDisposal-U → U, SmartDisposal-P → P, SmartDisposal-I → I
  const suffix = brand.replace("SmartDisposal-", "");

  // Desktop + mobile nav links
  document.querySelectorAll("[data-brand]").forEach(el => {
    const allowed = el.getAttribute("data-brand").split(",");
    if (allowed.includes(suffix)) {
      el.classList.remove("hidden");
    } else {
      el.classList.add("hidden");
    }
  });

  // Brand-specific page sections
  document.querySelectorAll("[data-brand-section]").forEach(el => {
    const allowed = el.getAttribute("data-brand-section").split(",");
    if (allowed.includes(suffix)) {
      el.classList.remove("hidden");
    } else {
      el.classList.add("hidden");
    }
  });
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
      restoreBrandSelection();
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
  const brandBtn = document.getElementById("brand-dropdown-btn");
  const brandMenu = document.getElementById("brand-menu");
  const brandArrow = document.getElementById("brand-arrow");

  if (userMenu && userBtn && !userBtn.contains(event.target) && !userMenu.contains(event.target)) {
    userMenu.classList.add("hidden");
  }

  if (mobileMenu && mobileBtn && !mobileBtn.contains(event.target) && !mobileMenu.contains(event.target)) {
    const wasHidden = mobileMenu.classList.contains("hidden");
    mobileMenu.classList.add("hidden");
    // Restore header auth & reset mobile brand accordion when menu closes
    if (!wasHidden) {
      const authArea = document.getElementById("auth-area");
      if (authArea) authArea.classList.remove("hidden");
    }
  }

  if (brandMenu && brandBtn && !brandBtn.contains(event.target) && !brandMenu.contains(event.target)) {
    brandMenu.classList.add("hidden");
    if (brandArrow) brandArrow.classList.remove("rotate-180");
    const mobileIcon = document.getElementById("brand-mobile-icon");
    if (mobileIcon) {
      mobileIcon.classList.remove("text-[#1D4ED8]");
      mobileIcon.classList.add("text-[#3B82F6]");
    }
  }
});

window.ecoscanLogout = function () {
  localStorage.removeItem("accessToken");
  localStorage.removeItem("account");
  window.location.href = "login.html";
};

// ── Auto-init for inline header (when not loaded via loadComponent) ──
document.addEventListener("DOMContentLoaded", function () {
  // If header is inline (not inside #header-container loaded dynamically)
  const headerEl = document.querySelector("header");
  const headerContainer = document.getElementById("header-container");
  // Only auto-init if header exists directly in DOM AND not inside a dynamic container
  if (headerEl && (!headerContainer || headerContainer.children.length === 0)) {
    setActiveMenu();
    renderAuthUI();
    restoreBrandSelection();
  }
});