const MODE_KEY = "lexivault.sidebar.mode";
const CONTROLLER = /* @__PURE__ */ Symbol.for("lexivault.sidebar.controller");
function initSidebar() {
  const root = document.documentElement, aside = document.getElementById("sidebar");
  if (!aside) return null;
  if (aside[CONTROLLER]) {
    window.LexiVaultSidebar = aside[CONTROLLER];
    return aside[CONTROLLER];
  }
  const surface = document.getElementById("sidebar-surface"), shell = document.querySelector("[data-sidebar-shell]"), main = document.querySelector("[data-sidebar-main]"), mobileButton = document.getElementById("nav-open"), scrim = document.getElementById("sidebar-scrim");
  let mode = readMode(), mobileOpen = false, theme = readTheme();
  function readMode() {
    try {
      return localStorage.getItem(MODE_KEY) === "expanded" ? "expanded" : "compact";
    } catch {
      return root.dataset.sidebar === "expanded" ? "expanded" : "compact";
    }
  }
  function readTheme() {
    try {
      return localStorage.getItem("lexivault.theme") === "dark" ? "dark" : "light";
    } catch {
      return root.dataset.theme === "dark" ? "dark" : "light";
    }
  }
  const mobile = () => window.innerWidth <= 760;
  function closeMenus() {
    for (const [trigger, id] of [["workspace-selector", "workspace-menu"], ["account-button", "account-menu"]]) {
      document.getElementById(id).hidden = true;
      document.getElementById(trigger).setAttribute("aria-expanded", "false");
    }
  }
  function render() {
    const onMobile = mobile(), expanded = mode === "expanded";
    root.dataset.sidebar = mode;
    document.body.classList.toggle("lv-mobile-open", onMobile && mobileOpen);
    shell?.classList.toggle("is-collapsed", !onMobile && !expanded);
    shell?.classList.toggle("is-sidebar-open", onMobile && mobileOpen);
    aside.toggleAttribute("inert", onMobile && !mobileOpen);
    main?.toggleAttribute("inert", onMobile && mobileOpen);
    if (scrim) scrim.hidden = !(onMobile && mobileOpen);
    mobileButton?.setAttribute("aria-expanded", String(onMobile && mobileOpen));
    surface.disabled = onMobile;
    surface.tabIndex = onMobile ? -1 : 0;
    surface.setAttribute("aria-expanded", String(expanded));
    surface.setAttribute("aria-label", expanded ? "收起侧边栏" : "展开侧边栏");
    surface.title = expanded ? "点击空白处收起侧边栏" : "点击空白处展开侧边栏";
  }
  function setMode(value, persist = true) {
    mode = value === "expanded" ? "expanded" : "compact";
    if (persist) try {
      localStorage.setItem(MODE_KEY, mode);
    } catch {
    }
    closeMenus();
    render();
  }
  function toggle() {
    if (mobile()) return;
    setMode(mode === "compact" ? "expanded" : "compact");
  }
  function openMobile() {
    if (!mobile()) return;
    mobileOpen = true;
    closeMenus();
    render();
    aside.querySelector('a[aria-current="page"]')?.focus();
  }
  function closeMobile(returnFocus = false) {
    mobileOpen = false;
    render();
    if (returnFocus && mobile()) mobileButton?.focus();
  }
  function setTheme(value, persist = true) {
    theme = value === "dark" ? "dark" : "light";
    root.dataset.theme = theme;
    if (persist) try {
      localStorage.setItem("lexivault.theme", theme);
    } catch {
    }
    for (const value2 of ["light", "dark"]) {
      document.getElementById("theme-" + value2)?.setAttribute("aria-pressed", String(theme === value2));
    }
    const compactTheme = document.getElementById("theme-compact");
    if (compactTheme) {
      compactTheme.setAttribute("aria-checked", String(theme === "dark"));
      compactTheme.title = theme === "dark" ? "切换到日间模式" : "切换到夜间模式";
    }
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.content = theme === "dark" ? "#242320" : "#f9f7f2";
    document.querySelectorAll("[data-design-src]").forEach((img) => img.setAttribute("href", "design-assets/" + img.dataset.designSrc + "-" + theme + ".png"));
  }
  surface.addEventListener("click", toggle);
  aside.addEventListener("click", (event) => {
    if (event.defaultPrevented || event.target.closest(".lv-popover,.history-menu,a,button,input,select,textarea,label,[contenteditable],summary")) return;
    if (window.getSelection?.()?.toString()) return;
    toggle();
  });
  mobileButton?.addEventListener("click", () => mobileOpen ? closeMobile(true) : openMobile());
  scrim?.addEventListener("click", () => closeMobile(true));
  document.getElementById("theme-light")?.addEventListener("click", () => setTheme("light"));
  document.getElementById("theme-dark")?.addEventListener("click", () => setTheme("dark"));
  document.getElementById("theme-compact")?.addEventListener("click", () => setTheme(theme === "dark" ? "light" : "dark"));
  for (const [trigger, id] of [["workspace-selector", "workspace-menu"], ["account-button", "account-menu"]]) document.getElementById(trigger).addEventListener("click", (event) => {
    event.stopPropagation();
    const menu = document.getElementById(id), open = menu.hidden;
    closeMenus();
    menu.hidden = !open;
    event.currentTarget.setAttribute("aria-expanded", String(open));
    if (event.detail === 0 && open) menu.querySelector("a,button")?.focus();
  });
  document.getElementById("current-workspace")?.addEventListener("click", closeMenus);
  document.addEventListener("click", (event) => {
    if (!event.target.closest(".lv-popover,.lv-workspace-picker,.lv-account-anchor")) closeMenus();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      closeMenus();
      if (mobileOpen) {
        event.preventDefault();
        closeMobile(true);
      }
    }
  });
  aside.querySelectorAll("[data-workspace-route]").forEach((link) => link.addEventListener("click", (event) => {
    const route = new CustomEvent("lexivault:navigate", { bubbles: true, cancelable: true, detail: { module: link.dataset.module, href: link.getAttribute("href") } });
    if (!link.dispatchEvent(route)) event.preventDefault();
  }));
  window.addEventListener("resize", () => {
    if (!mobile()) mobileOpen = false;
    render();
  });
  window.addEventListener("storage", (event) => {
    if (event.key === MODE_KEY) setMode(readMode(), false);
    if (event.key === "lexivault.theme") setTheme(readTheme(), false);
  });
  window.addEventListener("pageshow", () => {
    mode = readMode();
    setTheme(readTheme(), false);
    render();
  });
  const name = window.LexiVaultSpace?.current?.name || "选择工作空间";
  aside.querySelectorAll("[data-workspace-name]").forEach((el) => el.textContent = String(name).slice(0, 80));
  const controller = { setMode, toggle, openMobile, closeMobile, setTheme, get mode() {
    return mode;
  }, get mobileOpen() {
    return mobileOpen;
  } };
  aside[CONTROLLER] = controller;
  window.LexiVaultSidebar = controller;
  setTheme(theme, false);
  render();
  return controller;
}
export {
  initSidebar
};
