import { graphData, escapeHTML, normalizeTitle, localDate } from "./model.js";
function monthCells(year, month) {
  const first = new Date(year, month, 1, 12);
  first.setDate(first.getDate() - (first.getDay() + 6) % 7);
  return Array.from({ length: 42 }, (_, i) => {
    const d = new Date(first);
    d.setDate(d.getDate() + i);
    return { date: localDate(d), day: d.getDate(), outside: d.getMonth() !== month };
  });
}
function layoutGraph(data, selected) {
  const nodes = data.nodes.map((n, i) => ({ ...n, x: 450 + Math.cos(i * 2.39996) * Math.sqrt(i + 1) * 50, y: 260 + Math.sin(i * 2.39996) * Math.sqrt(i + 1) * 38 }));
  const map = new Map(nodes.map((n) => [n.id, n]));
  for (let step = 0; step < 140; step++) {
    const f = new Map(nodes.map((n) => [n.id, { x: (450 - n.x) * 0.015, y: (260 - n.y) * 0.02 }]));
    for (let i = 0; i < nodes.length; i++) for (let j = i + 1; j < nodes.length; j++) {
      const a = nodes[i], b = nodes[j], dx = a.x - b.x || 0.1, dy = a.y - b.y || 0.1, d2 = Math.max(400, dx * dx + dy * dy), power = 3600 / d2;
      f.get(a.id).x += dx * power;
      f.get(a.id).y += dy * power;
      f.get(b.id).x -= dx * power;
      f.get(b.id).y -= dy * power;
    }
    for (const e of data.edges) {
      const a = map.get(e.source), b = map.get(e.target);
      if (!a || !b) continue;
      const dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy) || 1, k = (d - 155) * 0.025;
      f.get(a.id).x += dx / d * k;
      f.get(a.id).y += dy / d * k;
      f.get(b.id).x -= dx / d * k;
      f.get(b.id).y -= dy / d * k;
    }
    nodes.forEach((n) => {
      const v = f.get(n.id), speed = 0.8 * (1 - step / 170);
      n.x = Math.max(65, Math.min(835, n.x + Math.max(-12, Math.min(12, v.x)) * speed));
      n.y = Math.max(45, Math.min(470, n.y + Math.max(-12, Math.min(12, v.y)) * speed));
    });
  }
  return nodes;
}
function renderGraph(container, plans, selected, onOpen, query = "") {
  const raw = graphData(plans), match = normalizeTitle(query), filtered = raw.nodes.filter((n) => !match || normalizeTitle(n.title + " " + n.tags.join(" ")).includes(match)), shown = filtered.slice(0, 150), ids = new Set(shown.map((n) => n.id)), edges = raw.edges.filter((e) => ids.has(e.source) && ids.has(e.target)), nodes = layoutGraph({ nodes: shown, edges }, selected), byId = new Map(nodes.map((n) => [n.id, n]));
  if (!nodes.length) {
    container.innerHTML = '<div class="graph-empty">没有匹配的计划。输入 [[计划名称]]，连接你的第一份文档。</div>';
    return () => {
    };
  }
  container.innerHTML = `<svg viewBox="0 0 900 520" role="group" aria-label="${nodes.length} 个计划节点，${edges.length} 条链接"><g class="graph-transform"><g class="graph-edges">${edges.map((e, i) => `<line class="graph-edge" data-edge="${i}" x1="${byId.get(e.source).x}" y1="${byId.get(e.source).y}" x2="${byId.get(e.target).x}" y2="${byId.get(e.target).y}"/>`).join("")}</g>${nodes.map((n) => `<g class="graph-node ${n.id === selected ? "is-selected" : ""}" data-id="${n.id}" transform="translate(${n.x} ${n.y})" tabindex="0" role="button" aria-label="打开计划：${escapeHTML(n.title)}"><circle r="${n.id === selected ? 14 : 9}"/><text text-anchor="middle" y="32">${escapeHTML(n.title.length > 16 ? n.title.slice(0, 15) + "…" : n.title)}</text><title>${escapeHTML(n.title)}</title></g>`).join("")}</g></svg><span class="graph-summary">${nodes.length} 个计划 · ${edges.length} 条链接${filtered.length > 150 ? " · 仅展示前 150 个匹配节点" : ""}</span>`;
  const svg = container.querySelector("svg"), group = svg.querySelector(".graph-transform");
  let zoom = 1, pan = { x: 0, y: 0 }, drag = null;
  const draw = () => group.setAttribute("transform", `translate(${pan.x} ${pan.y}) scale(${zoom})`);
  const point = (e) => {
    const r = svg.getBoundingClientRect();
    return { x: (e.clientX - r.left) * 900 / (r.width || 900), y: (e.clientY - r.top) * 520 / (r.height || 520) };
  };
  const moveEdges = () => edges.forEach((e, i) => {
    const line = svg.querySelector(`[data-edge="${i}"]`);
    for (const [key, value] of Object.entries({ x1: byId.get(e.source).x, y1: byId.get(e.source).y, x2: byId.get(e.target).x, y2: byId.get(e.target).y })) line.setAttribute(key, value);
  });
  svg.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;
    const node = e.target.closest(".graph-node");
    drag = { node, start: point(e), pan: { ...pan }, moved: false };
    svg.setPointerCapture?.(e.pointerId);
  });
  svg.addEventListener("pointermove", (e) => {
    if (!drag) return;
    const p = point(e), dx = p.x - drag.start.x, dy = p.y - drag.start.y;
    if (Math.hypot(dx, dy) > 3) drag.moved = true;
    if (drag.node) {
      const n = byId.get(drag.node.dataset.id);
      n.x = (p.x - pan.x) / zoom;
      n.y = (p.y - pan.y) / zoom;
      drag.node.setAttribute("transform", `translate(${n.x} ${n.y})`);
      moveEdges();
    } else {
      pan = { x: drag.pan.x + dx, y: drag.pan.y + dy };
      draw();
    }
  });
  svg.addEventListener("pointerup", (e) => {
    if (drag?.node && !drag.moved) onOpen(drag.node.dataset.id);
    drag = null;
  });
  svg.addEventListener("pointercancel", () => drag = null);
  svg.addEventListener("keydown", (e) => {
    const n = e.target.closest(".graph-node");
    if (n && ["Enter", " "].includes(e.key)) {
      e.preventDefault();
      onOpen(n.dataset.id);
    }
  });
  svg.addEventListener("wheel", (e) => {
    e.preventDefault();
    const p = point(e), next = Math.max(0.45, Math.min(3, zoom * Math.exp(-e.deltaY * 1e-3)));
    pan = { x: p.x - (p.x - pan.x) * next / zoom, y: p.y - (p.y - pan.y) * next / zoom };
    zoom = next;
    draw();
  }, { passive: false });
  svg.querySelectorAll(".graph-node").forEach((el) => {
    el.addEventListener("pointerenter", () => {
      if (drag) return;
      const id = el.dataset.id, neighbors = /* @__PURE__ */ new Set([id]);
      edges.forEach((e) => {
        if (e.source === id) neighbors.add(e.target);
        if (e.target === id) neighbors.add(e.source);
      });
      svg.querySelectorAll(".graph-node").forEach((n) => n.classList.toggle("is-dim", !neighbors.has(n.dataset.id)));
    });
    el.addEventListener("pointerleave", () => svg.querySelectorAll(".is-dim").forEach((n) => n.classList.remove("is-dim")));
  });
  return () => {
    zoom = 1;
    pan = { x: 0, y: 0 };
    draw();
  };
}
export {
  layoutGraph,
  monthCells,
  renderGraph
};
