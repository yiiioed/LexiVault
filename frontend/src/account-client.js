/* Same-origin account adapter. Passwords and session credentials never enter Web Storage. */
(() => {
  'use strict';
  if (window.lexivaultAuth) return;
  let bootstrap, csrf = '', identity = null, settingsTimer;
  async function localSession() {
    if (!bootstrap) bootstrap = fetch('/api/session', { credentials: 'same-origin' }).then(async response => {
      if (!response.ok) throw new Error('本地账号服务不可用。');
      return response.json();
    }).catch(error => { bootstrap = null; throw error; });
    return bootstrap;
  }
  async function request(path, { method = 'GET', body, signal } = {}, retry = true) {
    const session = await localSession();
    const headers = { 'X-LexiVault-Token': session.token };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (csrf) headers['X-Account-CSRF'] = csrf;
    const response = await fetch('/api/auth' + path, { method, headers, credentials: 'same-origin', signal,
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      if (response.status === 401 && !data.code && retry) { bootstrap = null; return request(path, { method, body, signal }, false); }
      const error = new Error(data.message || '账号服务暂不可用。'); error.code = data.code || (response.status === 429 ? 'rateLimited' : 'connectionFailed');
      throw error;
    }
    if (data.csrf_token) csrf = data.csrf_token;
    return data;
  }
  function changed() {
    try { localStorage.setItem('lexivault.account.changed', String(Date.now())); } catch {}
  }
  const adapter = {
    async signIn({ email, password, remember, signal }) {
      await request('/login', { method: 'POST', body: { email, password, remember: !!remember }, signal });
      changed(); return { redirectTo: './home.html' };
    },
    async signUp({ email, password, signal }) {
      return request('/register', { method: 'POST', body: { email, password }, signal });
    },
    async requestPasswordReset({ email, signal }) {
      return request('/password-reset', { method: 'POST', body: { email }, signal });
    },
    async signOut() {
      await request('/logout', { method: 'POST', body: {} }); csrf = ''; changed(); await refresh();
    },
    async getCurrentUser() { return request('/me'); }
  };
  window.lexivaultAuth = adapter;

  async function refresh() {
    try {
      const state = await request('/me'); identity = state.user;
      const button = document.getElementById('account-button'), menu = document.getElementById('account-menu');
      if (state.user && state.settings) {
        const theme = state.settings.theme === 'dark' ? 'dark' : 'light';
        document.documentElement.dataset.theme = theme;
        try { localStorage.setItem('lexivault.theme', theme); } catch {}
        window.LexiVaultSidebar?.setTheme(theme);
        const font = Number(state.settings.font_size);
        if (Number.isInteger(font) && font >= 12 && font <= 26) document.documentElement.style.setProperty('--reader-note-font-size', `${font}px`);
      }
      if (!button || !menu) return;
      const name = state.user?.nickname || '本地访客';
      button.setAttribute('aria-label', state.user ? `账号：${state.user.email}` : '本地访客');
      button.title = state.user?.email || '本地访客';
      const avatar = button.querySelector('.lv-avatar'); if (avatar) avatar.textContent = state.user ? name.slice(0, 2).toUpperCase() : 'LV';
      const copy = button.querySelector('.lv-account-copy');
      if (copy) { const small = document.createElement('small'); small.textContent = '资料保存在本机'; copy.replaceChildren(document.createTextNode(name), small); }
      menu.replaceChildren();
      const label = document.createElement('p'); label.textContent = state.user?.email || '未登录 · 本地仓库仍可使用'; menu.append(label);
      const local = document.createElement('a'); local.href = 'reader.html'; local.textContent = '打开本地文献阅读'; menu.append(local);
      if (state.user) {
        const logout = document.createElement('button'); logout.type = 'button'; logout.textContent = '退出账号';
        logout.addEventListener('click', async () => {
          logout.disabled = true;
          try { await adapter.signOut(); }
          catch (error) { label.textContent = error.message; logout.disabled = false; }
        }); menu.append(logout);
      } else { const login = document.createElement('a'); login.href = 'index.html'; login.textContent = '登录 / 注册'; menu.append(login); }
    } catch { identity = null; /* Pure static previews keep working without an account backend. */ }
  }
  document.addEventListener('click', event => {
    if (!identity || !event.target.closest?.('#theme-light,#theme-dark,#theme-compact')) return;
    clearTimeout(settingsTimer);
    settingsTimer = setTimeout(() => { void request('/settings', { method: 'PATCH', body: { theme: document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light' } }).catch(() => {}); }, 250);
  });
  window.addEventListener('storage', event => { if (event.key === 'lexivault.account.changed') void refresh(); });
  document.addEventListener('lexivault:authenticated', () => void refresh());
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => void refresh(), { once: true });
  else void refresh();
})();
