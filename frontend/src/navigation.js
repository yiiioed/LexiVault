const FEATURES = [
  ["assistant", "科研智能体", "home.html", "chat"],
  ["discover", "文献发现", "discover.html", "search"],
  ["reader", "文献阅读", "reader.html", "read"],
  ["plans", "研究计划", "plans.html", "plan"],
  ["graph", "主题图谱", "graph.html", "graph"],
  ["knowledge", "知识库管理", "knowledge.html", "stack"]
];
const SIDEBAR_ICONS = {
  chat: '<path d="M21.5 11.4a9.3 9.3 0 0 1-9.7 8.9 10.8 10.8 0 0 1-4.3-.9L2 22l1.7-5.6a8.2 8.2 0 0 1-1.5-5 9.7 9.7 0 0 1 19.3 0Z"/>',
  search: '<circle cx="10.5" cy="10.5" r="8"/><path d="m16.5 16.5 6 6"/>',
  read: '<ellipse cx="12" cy="5" rx="8" ry="3.5"/><path d="M4 5v13.5a8 3.5 0 0 0 16 0V5M4 11.5a8 3.5 0 0 0 16 0"/>',
  plan: '<path d="M5 2h10l5 5v15H5Z"/><path d="M15 2v6h5M8 11h7M8 15h5M8 18h3"/><path d="M2 6h3"/>',
  graph: '<circle cx="12" cy="4.5" r="3"/><circle cx="4.5" cy="19" r="3"/><circle cx="20" cy="19" r="3"/><path d="m10.5 7-4.6 9.3m7.7-9.3 5 9.2M7.5 19H17"/>',
  stack: '<path d="M3 3h18v4H3Zm0 7h18v4H3Zm0 7h18v4H3Z"/>',
  settings: '<path d="m9 2-1 3-3 .5-1.8 3.1L5 11l-.2 2.5-2 2 1.8 3.2L8 19l1.5 3h4l1.5-3 3.4-.3 1.8-3.2-2-2L18 11l1.8-2.4L18 5.5 15 5l-1-3Z"/><circle cx="11.5" cy="12" r="4"/>',
  plus: '<path d="M12 4v16M4 12h16"/>',
  folder: '<path d="M3 4.5h6l2.5 3H21a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1v-14a1 1 0 0 1 1-1Z"/><path d="M2 8h9.5"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 1v3m0 16v3M1 12h3m16 0h3M4.22 4.22l2.12 2.12m11.32 11.32 2.12 2.12m0-15.56-2.12 2.12M6.34 17.66l-2.12 2.12"/>',
  moon: '<path d="M20.8 13.1A8.9 8.9 0 0 1 10.9 3.2a9 9 0 1 0 9.9 9.9Z"/>'
};
function sidebarIcon(name) {
  return `<svg class="lv-icon" aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round">${SIDEBAR_ICONS[name] || SIDEBAR_ICONS.plan}</svg>`;
}
export {
  FEATURES,
  SIDEBAR_ICONS,
  sidebarIcon
};
