const LIMITS = Object.freeze({ file: 50 * 1024 * 1024, editable: 20 * 1024 * 1024, backup: 100 * 1024 * 1024, expanded: 100 * 1024 * 1024, entries: 2048, text: 1e6, pages: 100, plans: 2e3 });
const STATUSES = { draft: "待开始", active: "进行中", done: "已完成", archived: "已归档" };
const uid = () => globalThis.crypto?.randomUUID?.() || "p-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2);
const escapeHTML = (value) => String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const normalizeTitle = (s) => String(s || "").normalize("NFKC").trim().toLocaleLowerCase();
function localDate(d = /* @__PURE__ */ new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function plusDays(n) {
  const d = /* @__PURE__ */ new Date();
  d.setDate(d.getDate() + n);
  return localDate(d);
}
function isDate(s) {
  return s === "" || /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(/* @__PURE__ */ new Date(s + "T12:00:00")) && localDate(/* @__PURE__ */ new Date(s + "T12:00:00")) === s;
}
function plainText(n) {
  if (!n) return "";
  if (n.type === "text") return n.text || "";
  if (n.type === "wikiLink") return "[[" + (n.attrs?.alias || n.attrs?.title || "") + "]]";
  return (n.content || []).map(plainText).join(n.type === "doc" ? "\n" : "") + (["paragraph", "heading", "listItem", "taskItem", "tableRow"].includes(n.type) ? "\n" : "");
}
const safeImage = /^data:image\/(png|jpeg|gif|webp);base64,[a-z0-9+/=\s]+$/i;
function validateDoc(doc) {
  const nodes = /* @__PURE__ */ new Set(["doc", "paragraph", "text", "heading", "bulletList", "orderedList", "listItem", "taskList", "taskItem", "blockquote", "codeBlock", "horizontalRule", "hardBreak", "image", "table", "tableRow", "tableCell", "tableHeader", "wikiLink"]);
  const marks = /* @__PURE__ */ new Set(["bold", "italic", "underline", "strike", "code", "link", "highlight", "textStyle"]);
  let count = 0, chars = 0;
  function walk(n, depth) {
    if (!n || !nodes.has(n.type) || depth > 32 || ++count > 5e4) throw new Error("文档结构或大小不受支持。");
    if (n.text !== void 0) {
      if (typeof n.text !== "string") throw new Error("无效文本。");
      chars += n.text.length;
    }
    if (chars > LIMITS.text) throw new Error("正文超过 100 万字符。");
    if (n.type === "image" && (!safeImage.test(n.attrs?.src || "") || n.attrs.src.length > 8 * 1024 * 1024)) throw new Error("只允许安全的本地正文图片。");
    if (n.type === "wikiLink" && [n.attrs?.title, n.attrs?.alias].some((v) => v != null && (typeof v !== "string" || v.length > 160))) throw new Error("内部链接无效。");
    if (n.marks) {
      if (!Array.isArray(n.marks)) throw new Error("文字格式无效。");
      for (const m of n.marks) {
        if (!m || !marks.has(m.type)) throw new Error("文字格式不受支持。");
        const a = m.attrs || {};
        if (m.type === "link" && a.href && !/^(https?:\/\/|mailto:|#)/i.test(a.href)) throw new Error("不安全的文档链接。");
        if (a.fontFamily && !/^[\w\s,'"\-\u3400-\u9fff]{1,100}$/.test(a.fontFamily)) throw new Error("字体名称无效。");
        if (a.fontSize && (!/^\d{1,3}(\.\d{1,3})?(px|pt)$/.test(a.fontSize) || parseFloat(a.fontSize) > 160)) throw new Error("字号无效。");
        for (const color of [a.color, a.backgroundColor]) if (color && !/^(#[\da-f]{3,8}|rgba?\([\d\s.,%]+\)|[a-z]{3,20})$/i.test(color)) throw new Error("文字颜色无效。");
      }
    }
    if (n.content) {
      if (!Array.isArray(n.content)) throw new Error("无效段落。");
      n.content.forEach((c) => walk(c, depth + 1));
    }
  }
  if (doc?.type !== "doc") throw new Error("无效正文。");
  walk(doc, 0);
  return true;
}
function validPlan(p) {
  if (!p || typeof p.id !== "string" || !/^[\w-]{1,160}$/.test(p.id) || typeof p.title !== "string" || p.title.length > 160 || !STATUSES[p.status] || !isDate(p.startDate) || !isDate(p.dueDate) || !Array.isArray(p.tags) || p.tags.length > 20 || p.tags.some((t) => typeof t !== "string" || t.length > 30) || !Array.isArray(p.attachmentIds) || p.attachmentIds.length > 1e3 || p.attachmentIds.some((id) => typeof id !== "string" || !/^[\w-]{1,160}$/.test(id)) || typeof p.folder !== "string" || p.folder.length > 60 || typeof p.summary !== "string" || p.summary.length > 1e3 || !Number.isFinite(Date.parse(p.createdAt)) || !Number.isFinite(Date.parse(p.updatedAt))) throw new Error("计划元数据不完整或超限。");
  if (p.startDate && p.dueDate && p.startDate > p.dueDate) throw new Error("截止日期不能早于开始日期。");
  validateDoc(p.doc);
  return true;
}
function newPlan(title = "未命名计划", doc = { type: "doc", content: [{ type: "paragraph" }] }) {
  const now = (/* @__PURE__ */ new Date()).toISOString();
  return { id: uid(), title, summary: "", doc, status: "draft", startDate: "", dueDate: "", folder: "我的研究", tags: [], attachmentIds: [], createdAt: now, updatedAt: now, revision: 0, deletedAt: null, sample: false };
}
function resolveTitle(title, plans) {
  const found = plans.filter((p) => !p.deletedAt && normalizeTitle(p.title) === normalizeTitle(title));
  return found.length === 1 ? found[0] : null;
}
function collectLinks(plan, plans) {
  const result = [];
  function add(a) {
    const matches = a.targetId ? plans.filter((p) => p.id === a.targetId) : plans.filter((p) => !p.deletedAt && normalizeTitle(p.title) === normalizeTitle(a.title));
    const target = matches.length === 1 ? matches[0] : null;
    result.push({ sourceId: plan.id, targetId: target?.id || null, title: target?.title || a.title || "", alias: a.alias || "", state: matches.length > 1 ? "ambiguous" : target?.deletedAt ? "deleted" : target ? "resolved" : "missing" });
  }
  function walk(n) {
    if (n.type === "codeBlock" || n.marks?.some((m) => m.type === "code")) return;
    if (n.type === "wikiLink") add(n.attrs || {});
    if (n.type === "text") for (const m of (n.text || "").matchAll(/\[\[([^\]\n]{1,160})\]\]/g)) {
      const [title, alias = ""] = m[1].split("|");
      add({ title: title.trim(), alias });
    }
    (n.content || []).forEach(walk);
  }
  walk(plan.doc);
  return result;
}
function bindWikiText(doc, plans) {
  const result = structuredClone(doc);
  function walk(node) {
    if (node.type === "codeBlock") return;
    if (!node.content) return;
    node.content = node.content.flatMap((child) => {
      if (child.type !== "text" || child.marks?.some((m) => m.type === "code" || m.type === "link")) {
        walk(child);
        return [child];
      }
      const pieces = [];
      let cursor = 0;
      for (const match of child.text.matchAll(/\[\[([^\]\n]{1,160})\]\]/g)) {
        const [raw, alias = ""] = match[1].split("|"), title = raw.trim();
        if (!title) continue;
        if (match.index > cursor) pieces.push({ ...child, text: child.text.slice(cursor, match.index) });
        pieces.push({ type: "wikiLink", attrs: { targetId: resolveTitle(title, plans)?.id || null, title, alias } });
        cursor = match.index + match[0].length;
      }
      if (!cursor) return [child];
      if (cursor < child.text.length) pieces.push({ ...child, text: child.text.slice(cursor) });
      return pieces;
    });
  }
  walk(result);
  return result;
}
function graphData(plans) {
  const edges = /* @__PURE__ */ new Map();
  const nodes = plans.filter((p) => !p.deletedAt);
  nodes.forEach((p) => collectLinks(p, plans).forEach((l) => {
    if (l.state === "resolved" && l.targetId !== p.id) edges.set(p.id + ">" + l.targetId, { source: p.id, target: l.targetId });
  }));
  return { nodes: nodes.map(({ id, title, status, folder, tags, updatedAt }) => ({ id, title, status, folder, tags, updatedAt })), edges: [...edges.values()] };
}
function taskProgress(doc) {
  let total = 0, done = 0;
  function walk(n) {
    if (n.type === "taskItem") {
      total++;
      if (n.attrs?.checked) done++;
    }
    (n.content || []).forEach(walk);
  }
  walk(doc);
  return { total, done };
}
function renameLinkTitles(doc, id, title) {
  let changed = false;
  function walk(n) {
    if (n.type === "wikiLink" && n.attrs?.targetId === id && !n.attrs.alias) {
      n.attrs.title = title;
      changed = true;
    }
    (n.content || []).forEach(walk);
  }
  walk(doc);
  return changed;
}
function recentTags(plans) {
  const tags = /* @__PURE__ */ new Map();
  plans.filter((p) => !p.deletedAt && Date.parse(p.updatedAt) > Date.now() - 14 * 864e5).forEach((p) => p.tags.forEach((t) => tags.set(t, (tags.get(t) || 0) + 1)));
  return [...tags].sort((a, b) => b[1] - a[1]).slice(0, 8);
}
function seedPlans() {
  const t = (text) => ({ type: "text", text }), p = (...c2) => ({ type: "paragraph", content: c2.map((x) => typeof x === "string" ? t(x) : x) }), h = (text) => ({ type: "heading", attrs: { level: 2 }, content: [t(text)] }), w = (plan) => ({ type: "wikiLink", attrs: { targetId: plan.id, title: plan.title, alias: "" } });
  const a = newPlan("秋季科研推进计划"), b = newPlan("分子图学习阅读路线"), c = newPlan("预训练方法阅读笔记"), d = newPlan("组会准备 · 第三周");
  a.status = b.status = "active";
  a.startDate = b.startDate = localDate();
  a.dueDate = plusDays(21);
  b.dueDate = plusDays(7);
  c.dueDate = plusDays(4);
  d.dueDate = plusDays(3);
  a.tags = ["阅读", "实验"];
  b.tags = ["阅读", "图学习"];
  c.tags = ["阅读", "预训练"];
  d.tags = ["组会", "复盘"];
  a.folder = "科研主线";
  b.folder = c.folder = "阅读与复现";
  d.folder = "周记与复盘";
  a.summary = "把方向探索、文献阅读和复现实验，连成一条清晰的研究路径。";
  a.doc = { type: "doc", content: [h("一、这个阶段要回答的问题"), p("分子预训练在什么条件下能够改善小样本性质预测？先建立共同的评估协议，再比较方法；优先记录假设、数据划分与证据边界。"), p({ type: "text", text: "本周重点：厘清数据划分，完成一篇论文复现。", marks: [{ type: "bold" }, { type: "highlight", attrs: { color: "#efe2a5" } }] }), h("二、本周行动"), { type: "taskList", content: [["整理分子图学习的入门综述", true], ["精读两篇核心文献并记录证据", false], ["核对复现实验的数据划分和评价指标", false]].map(([text, checked]) => ({ type: "taskItem", attrs: { checked }, content: [p(text)] })) }, h("关联阅读"), p(w(b), "　", w(c)), p("这是一份可编辑的示例计划，可修改或移到回收站。")] };
  b.doc = { type: "doc", content: [h("先建立阅读路径"), p("从综述开始，记录研究问题、关键假设、实验设置与仍需核验的内容。"), p("本周安排来自 ", w(a), "。")] };
  c.doc = { type: "doc", content: [h("需要核对的证据"), p("这里是计划中的研究备忘，不替代文献阅读器中的原文锚点。"), p("纳入 ", w(a), " 的复现部分，并更新 ", w(b), "。")] };
  d.doc = { type: "doc", content: [h("本周要讲清楚什么"), p("汇报本阶段的研究进展：", w(a), "。"), p("准备问题、已核验的证据、尚未完成的工作和下一步安排。")] };
  return [a, b, c, d].map((p2) => ({ ...p2, sample: true }));
}
export {
  LIMITS,
  STATUSES,
  bindWikiText,
  collectLinks,
  escapeHTML,
  graphData,
  isDate,
  localDate,
  newPlan,
  normalizeTitle,
  plainText,
  plusDays,
  recentTags,
  renameLinkTitles,
  resolveTitle,
  seedPlans,
  taskProgress,
  uid,
  validPlan,
  validateDoc
};
