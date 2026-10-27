const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {parseHTML} = require('linkedom');
const shaders = require('../dist/auth-shaders.js');

function setup(options = {}) {
  const {window: dom, document} = parseHTML(fs.readFileSync(path.join(__dirname, '../dist/index.html'), 'utf8'));
  const events = document.createElement('div');
  const window = {
    Event: dom.Event,
    addEventListener: events.addEventListener.bind(events),
    removeEventListener: events.removeEventListener.bind(events),
    dispatchEvent: events.dispatchEvent.bind(events)
  };
  const q = selector => document.querySelector(selector);
  const saved = new Map(options.paused ? [['lexivault.motion', 'paused']] : []);
  const frames = new Map();
  const images = [];
  const observers = {};
  const values = {};
  const calls = {contexts: 0, draws: 0, destroyed: 0};
  let id = 0;
  let now = 100;
  const queries = new Map();
  window.matchMedia = query => {
    if (!queries.has(query)) {
      const listeners = new Set();
      queries.set(query, {
        matches: query.includes('reduced-motion') ? !!options.reduced : query.includes('pointer: fine') ? true : !!options.compact,
        addEventListener: (_, cb) => listeners.add(cb),
        removeEventListener: (_, cb) => listeners.delete(cb),
        change(value) { this.matches = value; [...listeners].forEach(cb => cb()); }
      });
    }
    return queries.get(query);
  };
  window.localStorage = {getItem: key => saved.get(key) ?? null, setItem: (key, value) => saved.set(key, String(value))};
  window.requestAnimationFrame = cb => { frames.set(++id, cb); return id; };
  window.cancelAnimationFrame = key => frames.delete(key);
  window.devicePixelRatio = 3;
  Object.defineProperty(document, 'hidden', {value: false, writable: true});
  window.MutationObserver = class {
    constructor(cb) { observers.attributes = cb; }
    observe() {} disconnect() { calls.attributesDisconnected = true; }
  };
  window.IntersectionObserver = class {
    constructor(cb) { observers.intersection = cb; }
    observe() {} disconnect() { calls.intersectionDisconnected = true; }
  };
  window.ResizeObserver = class {
    constructor(cb) { observers.resize = cb; }
    observe() {} disconnect() {}
  };
  window.Image = class {
    constructor() { images.push(this); }
  };
  window.LexiVaultMotionShaders = shaders;
  q('.brand-panel').getBoundingClientRect = () => ({left: 0, top: 0, width: 840, height: 852});
  q('.brand-art').getBoundingClientRect = () => ({left: 0, top: 308, width: options.compact ? 350 : 840, height: options.compact ? 177 : 425});
  const gl = new Proxy({}, {
    get(target, name) {
      if (name in target) return target[name];
      if (name === 'getShaderParameter') return () => !options.compileFailure;
      if (name === 'getProgramParameter') return () => true;
      if (name === 'getUniformLocation') return (_, value) => value;
      if (name === 'getAttribLocation') return () => 0;
      if (name === 'uniform1f') return (key, value) => { values[key] = value; };
      if (name === 'uniform2f') return (key, x, y) => { values[key] = [x, y]; };
      if (name === 'drawArrays') return () => { calls.draws++; };
      if (name === 'deleteProgram') return () => { calls.destroyed++; };
      if (String(name).startsWith('create')) return () => ({});
      if (/^[A-Z_0-9]+$/.test(name)) return name === 'TEXTURE0' ? 100 : 1;
      return () => {};
    }
  });
  q('canvas').getContext = () => { calls.contexts++; return options.gpu ? gl : null; };
  const context = vm.createContext({window, document, console, Float32Array});
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../dist/auth-motion.js'), 'utf8'), context);
  function event(target, name, data = {}) {
    const e = new window.Event(name, {cancelable: true});
    Object.assign(e, data);
    target.dispatchEvent(e);
    return e;
  }
  return {
    q, window, document, saved, frames, images, values, calls, queries, observers,
    move: (x, y, pointerType = 'mouse') => event(q('.brand-panel'), 'pointermove', {clientX: x, clientY: y, pointerType}),
    leave: () => event(q('.brand-panel'), 'pointerleave'),
    load: () => images.slice().forEach(image => { if (image.onload) image.onload(); }),
    attributes: () => observers.attributes(),
    visibility(hidden) { document.hidden = hidden; event(document, 'visibilitychange'); },
    intersect(visible) { observers.intersection([{isIntersecting: visible}]); },
    media(query, value) { queries.get(query).change(value); },
    event,
    step(ms = 50) { now += ms; const callbacks = [...frames.values()]; frames.clear(); callbacks.forEach(cb => cb(now)); },
    advance(count = 25, ms = 50) { for (let i = 0; i < count; i++) this.step(ms); },
  };
}

test('CSS fallback is idle, pointer motion is clamped and eased, and touch does not move the artwork', () => {
  const ui = setup();
  ui.step();
  assert.equal(ui.frames.size, 0);
  assert.equal(ui.q('.brand-art').dataset.renderer, undefined);
  ui.move(2000, -2000);
  ui.advance(60);
  assert.equal(Number(ui.q('.brand-art-motion').style.getPropertyValue('--motion-x')), 1);
  assert.equal(Number(ui.q('.brand-art-motion').style.getPropertyValue('--motion-y')), -1);
  assert.equal(ui.frames.size, 0);
  ui.leave(); ui.advance(60);
  assert.equal(Number(ui.q('.brand-art-motion').style.getPropertyValue('--motion-x')), 0);
  ui.move(0, 0, 'touch');
  assert.equal(ui.frames.size, 0);
});

test('the scene always runs without a pause control or obsolete pause preferences', () => {
  const ui = setup({gpu: true, paused: true}); ui.load(); ui.advance();
  assert.equal(ui.q('.brand-art').dataset.renderer, 'webgl');
  assert.equal(ui.q('#motion-toggle'), null);
  assert.equal(ui.q('#i-motion-pause'), null);
  assert.equal(ui.q('#i-motion-play'), null);
  assert.equal(ui.document.body.dataset.motionState, 'running');
  assert.equal(ui.frames.size, 1);
  const draws = ui.calls.draws; ui.advance();
  assert.ok(ui.calls.draws > draws);
});

test('reduced motion avoids GPU work and always restores visible static artwork', () => {
  const ui = setup({gpu: true, reduced: true});
  assert.equal(ui.calls.contexts, 0);
  assert.equal(ui.frames.size, 0);
  assert.equal(ui.document.body.dataset.motionState, 'reduced');
  assert.equal(ui.q('#motion-toggle'), null);
  ui.media('(prefers-reduced-motion: reduce)', false); ui.load();
  assert.equal(ui.q('.brand-art').dataset.renderer, 'webgl');
  ui.media('(prefers-reduced-motion: reduce)', true);
  assert.equal(ui.q('.brand-art').dataset.renderer, undefined);
  assert.equal(ui.frames.size, 0);
  assert.equal(ui.calls.destroyed, 1);
  assert.equal(ui.saved.has('lexivault.motion'), false);
});

test('day and night interpolate continuously and a hidden theme switch resumes in the correct theme', () => {
  const ui = setup({gpu: true}); ui.load(); ui.advance();
  ui.document.documentElement.dataset.theme = 'dark';
  ui.document.documentElement.lang = 'en'; ui.attributes();
  ui.advance(3);
  assert.ok(ui.values.u_theme > 0 && ui.values.u_theme < 1);
  ui.advance(50);
  assert.equal(ui.values.u_theme, 1);
  ui.visibility(true);
  ui.document.documentElement.dataset.theme = 'light'; ui.attributes();
  ui.visibility(false); ui.step();
  assert.equal(ui.values.u_theme, 0);
  assert.equal(ui.q('.brand-art').dataset.renderer, 'webgl');
});

test('the reveal mask tracks artwork coordinates with inertia and fades away when the pointer leaves', () => {
  const ui = setup({gpu: true}); ui.load();
  ui.move(470.4, 541.75); ui.advance(45);
  assert.ok(Math.abs(ui.values.u_focus[0] - .56) < .001);
  assert.ok(Math.abs(ui.values.u_focus[1] - .55) < .001);
  assert.equal(ui.values.u_hover, 1);
  assert.ok(Number(ui.q('.brand-panel').style.getPropertyValue('--reveal-strength')) > .99);
  ui.move(750, 700); ui.step();
  assert.ok(ui.values.u_focus[0] > .56 && ui.values.u_focus[0] < 750/840);
  ui.leave(); ui.advance(50);
  assert.equal(ui.values.u_hover, 0);
  assert.equal(ui.q('.brand-panel').style.getPropertyValue('--reveal-strength'), '0.0000');
  const fallback = setup(); fallback.move(400, 500); fallback.advance(50);
  assert.equal(fallback.q('.brand-panel').style.getPropertyValue('--reveal-strength'), '1.0000');
  assert.equal(fallback.frames.size, 0);
});

test('hidden tabs and offscreen scenes suspend work and resume without advancing by hidden time', () => {
  const ui = setup({gpu: true}); ui.load(); ui.advance();
  const elapsed = ui.values.u_time;
  ui.visibility(true);
  assert.equal(ui.frames.size, 0);
  assert.equal(ui.document.body.dataset.motionState, 'suspended');
  ui.step(60000); ui.visibility(false); ui.step();
  assert.ok(Math.abs(ui.values.u_time - elapsed) < .001);
  ui.intersect(false);
  assert.equal(ui.frames.size, 0);
  ui.intersect(true); ui.advance(3);
  assert.ok(ui.calls.draws > 1);
  assert.ok(ui.q('canvas').width * ui.q('canvas').height <= 1002000);
});

test('GPU failure and lost contexts retain the fallback and can restore after context recovery', () => {
  const failed = setup({gpu: true, compileFailure: true}); failed.advance();
  assert.equal(failed.q('.brand-art').dataset.renderer, undefined);
  assert.equal(failed.frames.size, 0);
  const ui = setup({gpu: true}); ui.load();
  const lost = ui.event(ui.q('canvas'), 'webglcontextlost');
  assert.equal(lost.defaultPrevented, true);
  assert.equal(ui.q('.brand-art').dataset.renderer, undefined);
  ui.step(); assert.equal(ui.frames.size, 0);
  ui.event(ui.q('canvas'), 'webglcontextrestored');
  ui.images.slice(2).forEach(image => image.onload());
  assert.equal(ui.q('.brand-art').dataset.renderer, 'webgl');
  const error = setup({gpu: true}); error.images[0].onerror(); error.step();
  assert.equal(error.q('.brand-art').dataset.renderer, undefined);
  assert.equal(error.frames.size, 0);
});

test('back-forward cache suspends and resumes the scene; final navigation frees GPU resources', () => {
  const ui = setup({gpu: true, compact: true}); ui.load(); ui.advance();
  assert.equal(ui.q('canvas').width, 350);
  ui.event(ui.window, 'pagehide', {persisted: true});
  assert.equal(ui.frames.size, 0);
  assert.equal(ui.calls.destroyed, 0);
  ui.event(ui.window, 'pageshow', {persisted: true});
  assert.equal(ui.frames.size, 1);
  ui.event(ui.window, 'pagehide', {persisted: false});
  assert.equal(ui.frames.size, 0);
  assert.equal(ui.calls.destroyed, 1);
  assert.equal(ui.calls.attributesDisconnected, true);
  assert.equal(ui.calls.intersectionDisconnected, true);
});
