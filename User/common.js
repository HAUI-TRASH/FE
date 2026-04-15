 function renderAuthUI() {
    const token = localStorage.getItem("accessToken");
    const acc = JSON.parse(localStorage.getItem("account") || "{}");

    const btns = document.getElementById("auth-buttons");
    const userBox = document.getElementById("user-box");
    const avatar = document.getElementById("user-menu-button");

    if (!btns || !userBox) return;

    if (token) {
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
  async function loadComponent(id, file) {
    const res = await fetch(file);
    const html = await res.text();
    document.getElementById(id).innerHTML = html;

    if (id === "header-container") {
      setActiveMenu();
      renderAuthUI(); // 👈 QUAN TRỌNG
    }
  }