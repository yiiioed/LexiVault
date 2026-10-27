import { FEATURES } from "./navigation.js";
import { initSidebar } from "./sidebar.js";
const paths = { chat: "M21 11a9 9 0 0 1-9 9 10 10 0 0 1-4-.8L2 22l1.7-5.4A9 9 0 1 1 21 11Z", search: "m17 17 5 5M19 10a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z", read: "M2 3h20v18H2ZM8 3v18M13 7h5m-5 5h5m-5 5h5", plan: "M5 2h10l5 5v15H5ZM15 2v6h5M8 12h8m-8 4h8", graph: "M12 5 4 19m8-14 8 14M5 19h14M15 4a3 3 0 1 1-6 0 3 3 0 0 1 6 0ZM7 19a3 3 0 1 1-6 0 3 3 0 0 1 6 0Zm16 0a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z", stack: "M3 3h18v4H3Zm0 7h18v4H3Zm0 7h18v4H3Z", plus: "M12 4v16M4 12h16", close: "m5 5 14 14M5 19 19 5", download: "M12 2v13m-5-5 5 5 5-5M3 16v6h18v-6", upload: "M12 17V2m-5 5 5-5 5 5M3 16v6h18v-6", chevron: "m6 9 6 6 6-6", sun: "M12 1v3m0 16v3M1 12h3m16 0h3M4 4l2 2m12 12 2 2M4 20l2-2M18 6l2-2M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0Z", menu: "M3 5h18M3 12h18M3 19h18", folder: "M2 5h7l3 3h10v13H2Z", more: "M5 12h.1M12 12h.1M19 12h.1", link: "m9 15 6-6M8 17l-1 1a4 4 0 0 1-6-6l5-5a4 4 0 0 1 6 0m0 10a4 4 0 0 0 6 0l5-5a4 4 0 0 0-6-6l-1 1", panel: "M2 3h20v18H2Zm14 0v18", settings: "M12 2v3m0 14v3M2 12h3m14 0h3M5 5l2 2m10 10 2 2M5 19l2-2M17 7l2-2M17 12a5 5 0 1 1-10 0 5 5 0 0 1 10 0Z", undo: "M9 4 3 10l6 6M3 10h11a7 7 0 0 1 7 7v4", redo: "m15 4 6 6-6 6m6-6H10a7 7 0 0 0-7 7v4", task: "M2 3h18v18H2ZM6 12l4 4 7-8", list: "M8 5h14M8 12h14M8 19h14M2 5h1m-1 7h1m-1 7h1", table: "M2 3h20v18H2ZM2 9h20M2 15h20M9 3v18m6-18v18", image: "M2 3h20v18H2Zm0 15 6-6 4 4 4-6 6 8M8 7h.1" };
paths.trash = "M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7m4-7v7";
function icon(name) {
  return `<svg class="s-icon" aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="${paths[name] || paths.plan}"/></svg>`;
}
function initSuite() {
  initSidebar();
  document.querySelectorAll("[data-close-dialog]").forEach((b) => b.addEventListener("click", () => b.closest("dialog").close()));
  document.getElementById("settings-button")?.addEventListener("click", () => document.getElementById("suite-about").showModal());
}
export {
  FEATURES,
  icon,
  initSuite
};
