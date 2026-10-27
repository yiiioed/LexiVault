import { FEATURES, sidebarIcon } from "../src/navigation.js";
const sidebarBoot = `try{document.documentElement.dataset.sidebar=localStorage.getItem('lexivault.sidebar.mode')==='expanded'?'expanded':'compact'}catch{document.documentElement.dataset.sidebar='compact'}`;
const logo = `<svg class="lv-logo" viewBox="0 0 44 44" aria-hidden="true"><path fill="currentColor" d="M2 1h9v23.5c0 3.8 1.2 5.8 5.9 8.4l-3.2 6.1-7.4-4C3 33.2 2 30 2 25.2Z"/><path fill="currentColor" d="M25.2 18h11.2L23.3 42H12.1Z"/><path fill="var(--lv-fold)" d="m31.9 4-5.5 10h11.1L43 4Z"/></svg>`;
function sidebarMarkup(active) {
  return `<aside class="lv-sidebar" id="sidebar" aria-label="工作空间导航">
  <button type="button" class="lv-sidebar-surface" id="sidebar-surface" data-sidebar-toggle aria-label="展开侧边栏" aria-expanded="false" aria-controls="sidebar-content" title="点击空白处展开侧边栏"><span class="lv-sr-only">展开或收起侧边栏</span></button>
  <div class="lv-sidebar-content" id="sidebar-content">
    <a class="lv-brand" href="home.html" aria-label="LexiVault 工作空间" title="LexiVault">${logo}<span class="lv-label lv-wordmark">LexiVault</span></a>
    <div class="lv-primary-action"><a class="lv-new-chat" id="new-chat" href="home.html?new=1" title="新建对话" aria-label="新建对话">${sidebarIcon("plus")}<span class="lv-label">新建对话</span></a></div>
    <div class="lv-sidebar-middle">
      <nav class="lv-navigation" aria-label="主要功能">${FEATURES.map(([id, label, href, glyph]) => `<a class="lv-nav-link${id === active ? " is-active" : ""}" href="${href}" data-module="${id}" data-feature="${id}" data-workspace-route ${id === active ? 'aria-current="page"' : ""} aria-label="${label}" title="${label}">${sidebarIcon(glyph)}<span class="lv-label">${label}</span></a>`).join("")}</nav>
      <div class="lv-extras">
        <div class="lv-workspace-picker popover-anchor"><button type="button" class="lv-workspace-selector" id="workspace-selector" aria-expanded="false" aria-controls="workspace-menu" aria-label="当前工作空间">${sidebarIcon("folder")}<span class="workspace-name" data-workspace-name>选择工作空间</span></button><div class="lv-popover popover" id="workspace-menu" hidden><p>工作空间</p><div id="workspace-list"><button type="button" id="current-workspace" disabled>正在读取工作空间…</button></div><p id="workspace-menu-status" role="status" hidden></p><button type="button" id="new-workspace">＋ 新建工作空间</button></div></div>
        <section class="lv-history" aria-labelledby="history-heading"><h2 id="history-heading">最近对话</h2><div id="history-list"><p class="lv-history-empty">从一个研究问题开始。</p></div></section>
      </div>
    </div>
    <div class="lv-sidebar-footer">
      <button type="button" class="lv-settings" id="settings-button" title="设置" aria-label="设置">${sidebarIcon("settings")}<span class="lv-label">设置</span></button>
      <div class="lv-appearance">
        <button type="button" class="lv-theme-compact" id="theme-compact" role="switch" aria-label="夜间模式" aria-checked="false" title="切换到夜间模式"><span class="lv-theme-sun">${sidebarIcon("sun")}</span><span class="lv-theme-moon">${sidebarIcon("moon")}</span></button>
        <div class="lv-theme-switch" role="group" aria-label="外观"><button type="button" class="lv-theme-option" id="theme-light" aria-label="日间模式" title="日间模式" aria-pressed="true">${sidebarIcon("sun")}<span>日间</span></button><button type="button" class="lv-theme-option" id="theme-dark" aria-label="夜间模式" title="夜间模式" aria-pressed="false">${sidebarIcon("moon")}<span>夜间</span></button></div>
      </div>
      <div class="lv-account-anchor popover-anchor"><button type="button" class="lv-account" id="account-button" title="我的工作空间" aria-label="我的工作空间" aria-expanded="false" aria-controls="account-menu"><span class="lv-avatar" aria-hidden="true">YL</span><span class="lv-label lv-account-copy">我的工作空间<small><i></i>本地运行</small></span></button><div class="lv-popover popover" id="account-menu" hidden><p>LexiVault · 个人研究空间</p><a href="index.html">返回登录页面</a></div></div>
    </div>
  </div>
</aside>`;
}
export {
  sidebarBoot,
  sidebarMarkup
};
