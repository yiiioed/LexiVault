import { yearDistribution } from './model.js';

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

export function createYearFilter({ document: d, getState, onCommit, signal }) {
  const q = selector => d.querySelector(selector), chart = q('#discovery-year-chart');
  const slider = q('#discovery-year-slider'), tooltip = q('#discovery-year-tooltip');
  const fields = { from: q('#discovery-year-from'), to: q('#discovery-year-to') };
  const handles = { from: q('#discovery-year-slider-from'), to: q('#discovery-year-slider-to') };
  const on = (element, type, fn) => element.addEventListener(type, fn, { signal });
  let distribution, focusedYear, drag = null, previewing = false;

  function hideTooltip() {
    tooltip.hidden = true;
    chart.querySelectorAll('.is-hovered').forEach(el => el.classList.remove('is-hovered'));
    chart.querySelectorAll('[aria-describedby]').forEach(el => el.removeAttribute('aria-describedby'));
  }
  function showTooltip(year) {
    const index = distribution.bins.findIndex(bin => bin.year === year);
    if (index < 0) return;
    hideTooltip();
    const bin = distribution.bins[index], button = chart.querySelector(`[data-year-bin="${year}"]`);
    button.classList.add('is-hovered'); button.setAttribute('aria-describedby', tooltip.id);
    q('#discovery-year-tooltip-year').textContent = String(year);
    q('#discovery-year-tooltip-count').textContent = `: ${bin.count.toLocaleString('zh-CN')} 篇`;
    tooltip.style.setProperty('--tip-x', `${(index + .5) / distribution.bins.length * 100}%`);
    tooltip.hidden = false;
  }
  function syncSelection(from, to) {
    const span = distribution.max - distribution.min || 1;
    const left = (from - distribution.min) / span * 100, right = (to - distribution.min) / span * 100;
    q('#filter-year-summary').textContent = `${from}—${to}`;
    for (const [bound, value] of Object.entries({ from, to })) {
      const handle = handles[bound];
      handle.min = distribution.min; handle.max = distribution.max; handle.value = value;
      handle.setAttribute('aria-valuetext', `${value} 年`);
      q('#discovery-year-label-' + bound).textContent = String(value);
    }
    handles.from.style.zIndex = from === distribution.max ? '4' : '2';
    handles.to.style.zIndex = to === distribution.min ? '4' : '3';
    q('#discovery-year-selection').style.left = `${left}%`;
    q('#discovery-year-selection').style.right = `${100 - right}%`;
    for (const button of chart.querySelectorAll('[data-year-bin]')) {
      const year = Number(button.dataset.yearBin);
      button.classList.toggle('is-in-range', year >= from && year <= to);
    }
  }
  function preview(bound, value) {
    let from = Number(fields.from.value), to = Number(fields.to.value);
    if (!Number.isInteger(from) || !Number.isInteger(to) || from > to) ({ from, to } = getState().filters);
    if (bound === 'from') from = clamp(value, distribution.min, to);
    else to = clamp(value, from, distribution.max);
    fields.from.value = from; fields.to.value = to;
    for (const input of Object.values(fields)) input.setAttribute('aria-invalid', 'false');
    q('#discovery-year-error').hidden = true;
    previewing = true; syncSelection(from, to); showTooltip(bound === 'from' ? from : to);
  }
  function commit() { previewing = false; onCommit(); }
  function cancelPreview() {
    drag = null; previewing = false;
    const { from, to } = getState().filters;
    fields.from.value = from; fields.to.value = to;
    syncSelection(from, to); hideTooltip();
  }
  function yearAt(clientX) {
    const rect = slider.getBoundingClientRect(), inset = 8;
    const ratio = clamp((clientX - rect.left - inset) / Math.max(1, rect.width - inset * 2), 0, 1);
    return Math.round(distribution.min + ratio * (distribution.max - distribution.min));
  }
  function render() {
    const state = getState(), activeYear = d.activeElement?.dataset?.yearBin;
    // Keep the scale stable while narrowing. Manually entered dates can expand it.
    distribution = yearDistribution(state, distribution);
    const maxCount = Math.max(1, ...distribution.bins.map(bin => bin.count));
    const tabYear = Number(activeYear || focusedYear || state.filters.from);
    const focusYear = distribution.bins.some(bin => bin.year === tabYear) ? tabYear : distribution.min;
    chart.innerHTML = distribution.bins.map(bin => `<button type="button" class="d-year-bin" data-year-bin="${bin.year}" data-year-count="${bin.count}" tabindex="${bin.year === focusYear ? '0' : '-1'}" aria-label="${bin.year} 年：${bin.count.toLocaleString('zh-CN')} 篇，点击只看该年" style="--bar-height:${bin.count / maxCount * 100}%"><span></span></button>`).join('');
    syncSelection(state.filters.from, state.filters.to);
    hideTooltip();
    if (activeYear) chart.querySelector(`[data-year-bin="${activeYear}"]`)?.focus({ preventScroll: true });
  }

  on(chart, 'pointerover', event => {
    const button = event.target.closest('[data-year-bin]');
    if (button) showTooltip(Number(button.dataset.yearBin));
  });
  on(chart, 'pointerleave', () => {
    const active = d.activeElement;
    if (chart.contains(active) && active.dataset.yearBin) showTooltip(Number(active.dataset.yearBin));
    else hideTooltip();
  });
  on(chart, 'focusin', event => {
    const button = event.target.closest('[data-year-bin]');
    if (!button) return;
    focusedYear = Number(button.dataset.yearBin);
    for (const bin of chart.querySelectorAll('[data-year-bin]')) bin.tabIndex = bin === button ? 0 : -1;
    showTooltip(focusedYear);
  });
  on(chart, 'focusout', hideTooltip);
  on(chart, 'keydown', event => {
    const button = event.target.closest('[data-year-bin]');
    if (!button) return;
    if (event.key === 'Escape') { hideTooltip(); return; }
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const year = Number(button.dataset.yearBin);
    const next = event.key === 'Home' ? distribution.min : event.key === 'End' ? distribution.max : clamp(year + (event.key === 'ArrowRight' ? 1 : -1), distribution.min, distribution.max);
    chart.querySelector(`[data-year-bin="${next}"]`)?.focus({ preventScroll: true });
  });
  on(chart, 'click', event => {
    const button = event.target.closest('[data-year-bin]');
    if (!button) return;
    const year = Number(button.dataset.yearBin);
    fields.from.value = year; fields.to.value = year; focusedYear = year; commit();
    chart.querySelector(`[data-year-bin="${year}"]`)?.focus({ preventScroll: true });
  });
  for (const [bound, handle] of Object.entries(handles)) {
    on(handle, 'input', () => preview(bound, Number(handle.value)));
    on(handle, 'change', () => { preview(bound, Number(handle.value)); commit(); });
    on(handle, 'focus', () => handle.style.zIndex = '5');
    on(handle, 'blur', hideTooltip);
    on(handle, 'keydown', event => { if (event.key === 'Escape' && previewing) cancelPreview(); });
  }
  // The native thumbs handle pointer, touch and keyboard dragging. Clicking the
  // rail also selects the nearest endpoint and allows continuing the same drag.
  on(slider, 'pointerdown', event => {
    if (event.target.matches('input[type=range]') || (event.button !== undefined && event.button !== 0)) return;
    event.preventDefault();
    const value = yearAt(event.clientX), from = Number(fields.from.value), to = Number(fields.to.value);
    const bound = Math.abs(value - from) < Math.abs(value - to) || (from === to && value < from) ? 'from' : 'to';
    drag = { bound, pointerId: event.pointerId };
    slider.setPointerCapture?.(event.pointerId);
    preview(bound, value);
  });
  on(slider, 'pointermove', event => {
    if (drag && event.pointerId === drag.pointerId) preview(drag.bound, yearAt(event.clientX));
  });
  on(slider, 'pointerup', event => {
    if (!drag || event.pointerId !== drag.pointerId) return;
    const pointerId = drag.pointerId; drag = null; commit();
    if (slider.hasPointerCapture?.(pointerId)) slider.releasePointerCapture(pointerId);
  });
  on(slider, 'pointercancel', () => { if (previewing) cancelPreview(); });
  on(slider, 'lostpointercapture', () => { if (drag) cancelPreview(); });
  return { render, resetDomain() { distribution = undefined; } };
}
