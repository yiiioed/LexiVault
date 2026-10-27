import JSZip from "jszip";
import DOMPurify from "dompurify";
import { marked } from "marked";
import { LIMITS, escapeHTML, uid, validPlan } from "./model.js";
const imageURI = /^data:image\/(png|jpeg|gif|webp);base64,[a-z0-9+/=\s]+$/i;
function sanitizeHTML(html) {
  const clean = DOMPurify.sanitize(html, { ALLOWED_TAGS: ["p", "br", "h1", "h2", "h3", "h4", "h5", "h6", "strong", "b", "em", "i", "u", "s", "del", "code", "pre", "blockquote", "ul", "ol", "li", "a", "span", "mark", "hr", "table", "thead", "tbody", "tr", "th", "td", "img", "input"], ALLOWED_ATTR: ["href", "title", "alt", "src", "style", "colspan", "rowspan", "start", "type", "checked", "data-type", "data-checked", "data-color", "data-wiki-target", "data-wiki-title", "data-wiki-alias"], ALLOW_DATA_ATTR: false });
  const doc = new DOMParser().parseFromString(clean, "text/html");
  doc.querySelectorAll("input").forEach((input) => {
    const li = input.closest("li");
    if (li && input.type === "checkbox") {
      li.setAttribute("data-type", "taskItem");
      li.setAttribute("data-checked", String(input.hasAttribute("checked")));
      li.parentElement?.setAttribute("data-type", "taskList");
    }
    input.remove();
  });
  doc.querySelectorAll("img").forEach((img) => {
    if (!imageURI.test(img.getAttribute("src") || "")) img.replaceWith(doc.createTextNode(img.alt ? "[图片：" + img.alt + "]" : "[外部图片已省略]"));
  });
  doc.querySelectorAll("a").forEach((a) => {
    if (!/^(https?:\/\/|mailto:|#)/i.test(a.getAttribute("href") || "")) a.removeAttribute("href");
  });
  doc.querySelectorAll("[style]").forEach((node) => {
    const css = [];
    for (const key of ["font-weight", "font-style", "text-decoration", "text-align", "font-size", "font-family", "color", "background-color"]) {
      const value = node.style.getPropertyValue(key).trim();
      if (!value) continue;
      const safe = ["color", "background-color"].includes(key) ? /^(#[\da-f]{3,8}|rgba?\([\d\s.,%]+\)|[a-z]{3,20})$/i.test(value) : key === "font-size" ? /^\d{1,3}(\.\d{1,3})?(px|pt|em|rem|%)$/.test(value) : key === "font-family" ? /^[\w\s,'"\-\u3400-\u9fff]{1,100}$/.test(value) : /^[\w\s-]{1,40}$/.test(value);
      if (safe) css.push(key + ":" + value);
    }
    node.removeAttribute("style");
    if (css.length) node.setAttribute("style", css.join(";"));
  });
  return doc.body.innerHTML;
}
const textHTML = (text) => String(text).split(/\r?\n/).map((s) => "<p>" + escapeHTML(s) + "</p>").join("");
const kids = (n) => Array.from(n?.children || []), child = (n, k) => kids(n).find((x) => x.localName === k), desc = (n, k) => Array.from(n?.getElementsByTagNameNS("*", k) || []), attr = (n, k) => Array.from(n?.attributes || []).find((a) => a.localName === k)?.value || "", val = (n, k) => attr(child(n, k), "val");
function xml(text) {
  if (/<!DOCTYPE|<!ENTITY/i.test(text)) throw new Error("不支持带实体声明的 XML。");
  const d = new DOMParser().parseFromString(text, "application/xml");
  if (d.getElementsByTagName("parsererror").length) throw new Error("文档结构损坏。");
  return d;
}
function base64(bytes) {
  let s = "";
  for (let i = 0; i < bytes.length; i += 8192) s += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return btoa(s);
}
function inspectZip(buffer) {
  const v = new DataView(buffer);
  let end = -1;
  for (let i = v.byteLength - 22; i >= Math.max(0, v.byteLength - 65558); i--) if (v.getUint32(i, true) === 101010256) {
    end = i;
    break;
  }
  if (end < 0) throw new Error("压缩文档不完整。");
  const count = v.getUint16(end + 10, true);
  let p = v.getUint32(end + 16, true), size = 0;
  if (count > LIMITS.entries || count === 65535) throw new Error("压缩条目过多或不支持 ZIP64。");
  for (let n = 0; n < count; n++) {
    if (p + 46 > v.byteLength || v.getUint32(p, true) !== 33639248) throw new Error("压缩目录损坏。");
    if (v.getUint16(p + 8, true) & 1) throw new Error("请移除文档密码后导入。");
    size += v.getUint32(p + 24, true);
    const len = v.getUint16(p + 28, true), extra = v.getUint16(p + 30, true), comment = v.getUint16(p + 32, true);
    if (p + 46 + len > v.byteLength) throw new Error("压缩目录越界。");
    const name = new TextDecoder().decode(new Uint8Array(buffer, p + 46, len));
    if (name.split(/[\\/]/).includes("..") || /^(?:[\\/]|[A-Za-z]:)/.test(name)) throw new Error("压缩包含不安全路径。");
    p += 46 + len + extra + comment;
  }
  if (size > LIMITS.expanded) throw new Error("解压内容超过 100 MiB。");
  return { count, size };
}
async function unzip(buffer) {
  inspectZip(buffer);
  return JSZip.loadAsync(buffer);
}
async function docxHTML(buffer) {
  const zip = await unzip(buffer);
  if (!zip.file("word/document.xml")) throw new Error("找不到 Word 正文。");
  const d = xml(await zip.file("word/document.xml").async("string")), rels = /* @__PURE__ */ new Map(), styles = /* @__PURE__ */ new Map();
  if (zip.file("word/_rels/document.xml.rels")) for (const r of desc(xml(await zip.file("word/_rels/document.xml.rels").async("string")), "Relationship")) rels.set(attr(r, "Id"), { target: attr(r, "Target"), external: attr(r, "TargetMode") === "External" });
  if (zip.file("word/styles.xml")) for (const s of desc(xml(await zip.file("word/styles.xml").async("string")), "style")) styles.set(attr(s, "styleId"), attr(child(s, "name"), "val"));
  const numbering = /* @__PURE__ */ new Map(), abstract = /* @__PURE__ */ new Map();
  if (zip.file("word/numbering.xml")) {
    const nd = xml(await zip.file("word/numbering.xml").async("string"));
    for (const n of desc(nd, "abstractNum")) abstract.set(attr(n, "abstractNumId"), desc(n, "lvl").map((l) => val(l, "numFmt")));
    for (const n of desc(nd, "num")) numbering.set(attr(n, "numId"), abstract.get(val(n, "abstractNumId")) || []);
  }
  async function run(r) {
    let out = "";
    const pr = child(r, "rPr");
    for (const x of kids(r)) {
      if (x.localName === "t") out += escapeHTML(x.textContent);
      if (x.localName === "tab") out += "&#8195;";
      if (["br", "cr"].includes(x.localName)) out += "<br>";
      if (x.localName === "drawing") {
        const rel = rels.get(attr(desc(x, "blip")[0], "embed"));
        if (rel && !rel.external) {
          const path = rel.target.replace(/^\//, ""), file = zip.file(path.startsWith("word/") ? path : "word/" + path), ext = path.split(".").pop().toLowerCase();
          if (file && ["png", "jpg", "jpeg", "gif", "webp"].includes(ext)) {
            const bytes = await file.async("uint8array");
            if (bytes.length <= 5 * 1024 * 1024) out += `<img src="data:image/${ext === "jpg" ? "jpeg" : ext};base64,${base64(bytes)}" alt="导入的文档图片">`;
          }
        }
      }
    }
    const yes = (k) => {
      const p = child(pr, k);
      return p && !["0", "false", "off", "none"].includes(attr(p, "val"));
    };
    if (yes("b")) out = "<strong>" + out + "</strong>";
    if (yes("i")) out = "<em>" + out + "</em>";
    if (yes("u")) out = "<u>" + out + "</u>";
    if (yes("strike")) out = "<s>" + out + "</s>";
    const css = [], color = val(pr, "color"), size = Number(val(pr, "sz")), font = attr(child(pr, "rFonts"), "eastAsia") || attr(child(pr, "rFonts"), "ascii");
    if (/^[\da-f]{6}$/i.test(color)) css.push("color:#" + color);
    if (size >= 12 && size <= 200) css.push("font-size:" + (size * 2 / 3).toFixed(2) + "px");
    if (/^[\w\s\-\u3400-\u9fff]{1,80}$/.test(font)) css.push("font-family:" + font);
    const colors = { yellow: "#fff2a8", green: "#d7eac5", cyan: "#cee8eb", magenta: "#e8c9e3", blue: "#cbd9ee", red: "#f2c8c8", darkYellow: "#e5d19a" }, highlight = colors[val(pr, "highlight")], fill = attr(child(pr, "shd"), "fill");
    if (highlight) out = `<mark data-color="${highlight}" style="background-color:${highlight}">${out}</mark>`;
    else if (/^[\da-f]{6}$/i.test(fill)) out = `<mark data-color="#${fill}" style="background-color:#${fill}">${out}</mark>`;
    return css.length ? '<span style="' + css.join(";") + '">' + out + "</span>" : out;
  }
  async function inline(n) {
    let out = "";
    for (const c of kids(n)) {
      if (c.localName === "r") out += await run(c);
      else if (c.localName === "hyperlink") {
        const rel = rels.get(attr(c, "id")), text = await inline(c);
        out += rel?.external && /^(https?:\/\/|mailto:)/i.test(rel.target) ? '<a href="' + escapeHTML(rel.target) + '">' + text + "</a>" : text;
      } else if (["sdt", "sdtContent", "ins"].includes(c.localName)) out += await inline(c);
    }
    return out;
  }
  async function blocks(parent) {
    let out = "", list = "";
    for (const n of kids(parent)) {
      if (n.localName === "p") {
        const pr = child(n, "pPr"), id = val(pr, "pStyle"), heading = /heading\s*([1-6])|标题\s*([1-6])/i.exec(styles.get(id) || id), num = child(pr, "numPr"), level = Number(val(num, "ilvl")) || 0, tag = num ? numbering.get(val(num, "numId"))?.[level] === "decimal" ? "ol" : "ul" : "";
        if (list && list !== tag) {
          out += `</${list}>`;
          list = "";
        }
        if (tag && !list) {
          out += `<${tag}>`;
          list = tag;
        }
        const text = await inline(n);
        if (tag) out += "<li><p>" + text + "</p></li>";
        else {
          const h = heading ? "h" + (heading[1] || heading[2]) : "p", align = val(pr, "jc");
          out += `<${h}${["left", "center", "right", "both"].includes(align) ? ' style="text-align:' + (align === "both" ? "justify" : align) + '"' : ""}>${text}</${h}>`;
        }
      } else if (n.localName === "tbl") {
        if (list) {
          out += `</${list}>`;
          list = "";
        }
        out += "<table>";
        for (const row of kids(n).filter((x) => x.localName === "tr")) {
          out += "<tr>";
          for (const cell of kids(row).filter((x) => x.localName === "tc")) out += "<td>" + await blocks(cell) + "</td>";
          out += "</tr>";
        }
        out += "</table>";
      }
    }
    return out + (list ? `</${list}>` : "");
  }
  return blocks(desc(d, "body")[0]);
}
async function odtHTML(buffer) {
  const z = await unzip(buffer);
  if (!z.file("content.xml")) throw new Error("找不到 ODT 正文。");
  const d = xml(await z.file("content.xml").async("string")), styles = /* @__PURE__ */ new Map();
  for (const s of desc(d, "style")) {
    const p = child(s, "text-properties"), css = [];
    for (const k of ["font-weight", "font-style", "font-size", "color", "background-color"]) if (attr(p, k)) css.push(k + ":" + attr(p, k));
    styles.set(attr(s, "name"), css.join(";"));
  }
  function walk(n) {
    if (n.nodeType === 3) return escapeHTML(n.textContent);
    const text = Array.from(n.childNodes || []).map(walk).join(""), name = n.localName;
    if (name === "p") return "<p>" + text + "</p>";
    if (name === "h") {
      const h = Math.min(6, Math.max(1, Number(attr(n, "outline-level")) || 2));
      return `<h${h}>${text}</h${h}>`;
    }
    if (name === "span") return '<span style="' + escapeHTML(styles.get(attr(n, "style-name")) || "") + '">' + text + "</span>";
    const tags = { list: "ul", "list-item": "li", table: "table", "table-row": "tr", "table-cell": "td" };
    if (tags[name]) return `<${tags[name]}>${text}</${tags[name]}>`;
    if (name === "line-break") return "<br>";
    if (name === "tab") return "&#8195;";
    if (name === "a") return '<a href="' + escapeHTML(attr(n, "href")) + '">' + text + "</a>";
    return text;
  }
  return walk(desc(d, "text")[0]);
}
function rtfHTML(text) {
  if (!/^\s*\{\\rtf/.test(text)) throw new Error("RTF 头部无效。");
  const colors = [null], ct = /\{\\colortbl([^}]+)\}/.exec(text);
  if (ct) for (const part of ct[1].split(";").slice(1)) {
    const rgb = ["red", "green", "blue"].map((k) => new RegExp("\\\\" + k + "(\\d+)").exec(part));
    if (rgb.every(Boolean)) colors.push("#" + rgb.map((x) => Math.min(255, Number(x[1])).toString(16).padStart(2, "0")).join(""));
  }
  const page = Number(/\\ansicpg(\d+)/.exec(text)?.[1] || 1252);
  const decoder = new TextDecoder({ 936: "gb18030", 932: "shift_jis", 950: "big5", 65001: "utf-8" }[page] || "windows-1252");
  let s = { b: false, i: false, u: false, strike: false, size: 16, color: 0, highlight: 0, skip: false, uc: 1 }, stack = [], out = "<p>", skip = 0;
  function emit(t) {
    if (s.skip) return;
    let x = escapeHTML(t);
    for (const [key, tag] of [["b", "strong"], ["i", "em"], ["u", "u"], ["strike", "s"]]) if (s[key]) x = `<${tag}>${x}</${tag}>`;
    if (colors[s.highlight]) x = '<mark style="background-color:' + colors[s.highlight] + '">' + x + "</mark>";
    out += '<span style="font-size:' + s.size + "px" + (colors[s.color] ? ";color:" + colors[s.color] : "") + '">' + x + "</span>";
  }
  for (let i = 0; i < text.length; ) {
    const c = text[i++];
    if (c === "{") {
      stack.push({ ...s });
      continue;
    }
    if (c === "}") {
      s = stack.pop() || s;
      continue;
    }
    if (c === "\\") {
      if (text[i] === "'") {
        const bytes = [];
        while (text[i] === "'") {
          const h = text.slice(i + 1, i + 3);
          if (!/^[\da-f]{2}$/i.test(h)) break;
          bytes.push(parseInt(h, 16));
          i += 3;
          if (text[i] === "\\" && text[i + 1] === "'") i++;
          else break;
        }
        if (skip) skip--;
        else emit(decoder.decode(new Uint8Array(bytes)));
        continue;
      }
      if (["\\", "{", "}"].includes(text[i])) {
        const t = text[i++];
        if (skip) skip--;
        else emit(t);
        continue;
      }
      if (text[i] === "*") {
        s.skip = true;
        i++;
        continue;
      }
      const m = /^([a-z]+)(-?\d+)? ?/i.exec(text.slice(i));
      if (!m) {
        i++;
        continue;
      }
      i += m[0].length;
      const k = m[1], v = m[2] === void 0 ? 1 : Number(m[2]);
      if (["fonttbl", "colortbl", "stylesheet", "info", "pict", "object", "header", "footer", "generator", "filetbl", "datastore", "themedata"].includes(k)) s.skip = true;
      if (["b", "i", "u", "strike"].includes(k)) s[k] = v !== 0;
      if (k === "ul") s.u = v !== 0;
      if (k === "ulnone") s.u = false;
      if (k === "fs") s.size = Math.min(120, Math.max(8, v * 2 / 3));
      if (k === "cf") s.color = v;
      if (k === "highlight") s.highlight = v;
      if (k === "uc") s.uc = v;
      if (k === "u") {
        emit(String.fromCharCode(v < 0 ? v + 65536 : v));
        skip = s.uc;
      }
      if (["par", "line"].includes(k) && !s.skip) out += "</p><p>";
      if (k === "tab") emit(" ");
      if (k === "plain") s = { ...s, b: false, i: false, u: false, strike: false, size: 16, color: 0, highlight: 0 };
      continue;
    }
    if (c === "\n" || c === "\r") continue;
    if (skip) {
      skip--;
      continue;
    }
    emit(c);
  }
  return out + "</p>";
}
function parseCSV(text) {
  const rows = [];
  let row = [], value = "", quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') {
      if (quoted && text[i + 1] === '"') {
        value += '"';
        i++;
      } else quoted = !quoted;
    } else if (c === "," && !quoted) {
      row.push(value);
      value = "";
    } else if ((c === "\n" || c === "\r") && !quoted) {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(value);
      rows.push(row);
      row = [];
      value = "";
    } else value += c;
  }
  if (quoted) throw new Error("CSV 引号未闭合。");
  if (value || row.length) {
    row.push(value);
    rows.push(row);
  }
  if (rows.length > 1e3 || rows.some((r) => r.length > 50)) throw new Error("CSV 最多 1000 行、50 列。");
  return rows;
}
async function pdfHTML(buffer) {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  pdfjs.GlobalWorkerOptions.workerSrc = new URL("vendor/pdf.worker.min.mjs", document.baseURI).href;
  const task = pdfjs.getDocument({ data: new Uint8Array(buffer), isEvalSupported: false, useSystemFonts: true, disableFontFace: true, cMapUrl: new URL("vendor/cmaps/", document.baseURI).href, cMapPacked: true, standardFontDataUrl: new URL("vendor/standard_fonts/", document.baseURI).href });
  let pdf;
  try {
    pdf = await task.promise;
    if (pdf.numPages > LIMITS.pages) throw new Error("PDF 超过 100 页，请拆分后转换正文。");
    let html = "", total = "";
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i), content = await page.getTextContent(), text = content.items.map((x) => (x.str || "") + (x.hasEOL ? "\n" : " ")).join("");
      total += text;
      if (total.length > LIMITS.text) throw new Error("PDF 文字超过 100 万字符。");
      html += "<h2>第 " + i + " 页</h2>" + textHTML(text);
      page.cleanup();
    }
    if (!total.trim()) throw new Error("没有可提取的文本层，扫描 PDF 需要 OCR。");
    return html;
  } finally {
    if (pdf) await pdf.destroy();
    else await task.destroy();
  }
}
async function importDocument(file) {
  if (file.size > LIMITS.file) throw new Error("附件超过 50 MiB。");
  const ext = file.name.split(".").pop().toLowerCase(), supported = ["docx", "odt", "rtf", "md", "markdown", "txt", "html", "htm", "csv", "json", "pdf"];
  let html = "", warning = "", converted = false;
  if (supported.includes(ext) && file.size > LIMITS.editable) warning = "超过 20 MiB 正文转换限制，原件已保留。";
  else if (supported.includes(ext)) {
    try {
      if (ext === "docx") html = await docxHTML(await file.arrayBuffer());
      else if (ext === "odt") html = await odtHTML(await file.arrayBuffer());
      else if (ext === "pdf") {
        html = await pdfHTML(await file.arrayBuffer());
        warning = "PDF 已提取为文字草稿；版式、公式和表格请核对原件。";
      } else {
        const text = await file.text();
        if (text.length > LIMITS.text) throw new Error("正文超过 100 万字符。");
        if (["md", "markdown"].includes(ext)) html = await marked.parse(text, { gfm: true });
        else if (["html", "htm"].includes(ext)) html = text;
        else if (ext === "rtf") html = rtfHTML(text);
        else if (ext === "csv") html = "<table>" + parseCSV(text).map((row, i) => "<tr>" + row.map((t) => `<${i ? "td" : "th"}><p>${escapeHTML(t)}</p></${i ? "td" : "th"}>`).join("") + "</tr>").join("") + "</table>";
        else if (ext === "json") html = "<pre><code>" + escapeHTML(JSON.stringify(JSON.parse(text), null, 2)) + "</code></pre>";
        else html = textHTML(text);
      }
      html = sanitizeHTML(html);
      if (new DOMParser().parseFromString(html, "text/html").body.textContent.length > LIMITS.text) throw new Error("转换后的正文过大。");
      converted = !!html.trim();
      if (["docx", "odt", "rtf"].includes(ext)) warning = "已转换常见结构和样式；复杂版式、特殊对象请核对原件。";
    } catch (e) {
      warning = e.message + " 原始文件将保留为附件。";
    }
  }
  if (!converted) {
    html = "<p>原始附件：" + escapeHTML(file.name) + "</p><p>可在这里继续补充研究安排和笔记，原件可随时下载。</p>";
    warning ||= "该格式已作为原始附件保存，暂不转换正文。";
  }
  return { title: file.name.replace(/\.[^.]+$/, "").slice(0, 160) || "导入的计划", html, warning, converted };
}
async function createBackup(plans, files) {
  if (files.length + 2 > LIMITS.entries) throw new Error("备份附件条目超过上限，请分批整理。");
  const z = new JSZip(), manifest = { format: "LexiVaultPlans", version: 1, exportedAt: (/* @__PURE__ */ new Date()).toISOString(), plans, files: files.map(({ id, planId, name, type, size, createdAt }) => ({ id, planId, name, type, size, createdAt, path: "files/" + id })) }, json = JSON.stringify(manifest, null, 2);
  let total = new TextEncoder().encode(json).length;
  z.file("manifest.json", json);
  for (const f of files) {
    total += f.size;
    if (total > LIMITS.expanded) throw new Error("备份展开内容超过 100 MiB，请减少附件后重试。");
    z.file("files/" + f.id, await f.blob.arrayBuffer());
  }
  const blob = await z.generateAsync({ type: "blob", compression: "DEFLATE", compressionOptions: { level: 6 } });
  if (blob.size > LIMITS.backup) throw new Error("ZIP 备份超过 100 MiB。");
  return blob;
}
async function readBackup(file) {
  if (file.size > LIMITS.backup) throw new Error("备份超过 100 MiB。");
  const z = await unzip(await file.arrayBuffer()), entry = z.file("manifest.json");
  if (!entry) return null;
  const m = JSON.parse(await entry.async("string"));
  if (m.format !== "LexiVaultPlans" || m.version !== 1 || !Array.isArray(m.plans) || !Array.isArray(m.files) || m.plans.length > LIMITS.plans) throw new Error("备份格式不受支持。");
  m.plans.forEach(validPlan);
  const ids = /* @__PURE__ */ new Map(), fileIds = /* @__PURE__ */ new Map(), files = [];
  for (const p of m.plans) {
    if (ids.has(p.id)) throw new Error("备份有重复计划 ID。");
    ids.set(p.id, uid());
  }
  for (const f of m.files) {
    if (!Number.isInteger(f.size) || f.size < 0 || typeof f.type !== "string" || typeof f.id !== "string" || !/^[\w-]{1,160}$/.test(f.id) || fileIds.has(f.id) || !ids.has(f.planId) || typeof f.name !== "string" || f.name.length > 500 || f.size > LIMITS.file || f.path !== "files/" + f.id || !z.file(f.path)) throw new Error("备份附件不完整。");
    const data = await z.file(f.path).async("uint8array");
    if (data.length !== f.size) throw new Error("备份附件大小不一致。");
    const id = uid();
    fileIds.set(f.id, id);
    files.push({ ...f, id, planId: ids.get(f.planId), blob: new Blob([data], { type: f.type || "application/octet-stream" }) });
  }
  const plans = m.plans.map((p) => {
    const n = structuredClone(p);
    n.id = ids.get(p.id);
    n.title = (p.title + "（导入）").slice(0, 160);
    n.revision = 0;
    n.attachmentIds = p.attachmentIds.map((id) => {
      if (!fileIds.has(id)) throw new Error("备份缺少被引用附件。");
      if (m.files.find((f) => f.id === id)?.planId !== p.id) throw new Error("备份附件所属计划不一致。");
      return fileIds.get(id);
    });
    function walk(x) {
      if (x.type === "wikiLink" && ids.has(x.attrs?.targetId)) x.attrs.targetId = ids.get(x.attrs.targetId);
      (x.content || []).forEach(walk);
    }
    walk(n.doc);
    return n;
  });
  return { plans, files };
}
function markdown(plan) {
  const raw = n => n.text || (n.content || []).map(raw).join('');
  function list(n) {
    return (n.content || []).map((item,i)=>{
      const prefix=item.type==='taskItem'?`- [${item.attrs?.checked?'x':' '}] `:n.type==='orderedList'?`${(n.attrs?.start || 1)+i}. `:'- ';
      const body=(item.content || []).map(walk).join('').trimEnd().split('\n');
      return prefix+body[0]+body.slice(1).map(line=>'\n'+' '.repeat(prefix.length)+line).join('')+'\n';
    }).join('')+'\n';
  }
  function walk(n) {
    if(n.type==='text'){
      const marks=n.marks || [],code=marks.find(m=>m.type==='code');
      let value;
      if(code){const fence='`'.repeat(Math.max(0,...(n.text.match(/`+/g) || []).map(s=>s.length))+1);value=fence+' '+n.text+' '+fence;}
      else value=n.text.replace(/([\\`*_[\]<>])/g,'\\$1');
      for(const m of marks){
        if(m.type==='bold')value='**'+value+'**';
        if(m.type==='italic')value='*'+value+'*';
        if(m.type==='strike')value='~~'+value+'~~';
        if(m.type==='underline')value='<u>'+value+'</u>';
        if(m.type==='link')value='['+value+'](<'+m.attrs.href.replace(/>/g,'%3E')+'>)';
        if(m.type==='highlight')value='<mark style="background-color:'+escapeHTML(m.attrs?.color || '#ffff00')+'">'+value+'</mark>';
        if(m.type==='textStyle'){
          const attrs=m.attrs || {},style=[attrs.color && 'color:'+attrs.color,attrs.fontSize && 'font-size:'+attrs.fontSize,attrs.fontFamily && 'font-family:'+attrs.fontFamily].filter(Boolean).join(';');
          if(style)value='<span style="'+escapeHTML(style)+'">'+value+'</span>';
        }
      }
      return value;
    }
    if(n.type==='wikiLink')return '[['+(n.attrs.title || '')+(n.attrs.alias?'|'+n.attrs.alias:'')+']]';
    if(n.type==='codeBlock'){
      const text=raw(n),fence='`'.repeat(Math.max(2,...(text.match(/`+/g) || []).map(s=>s.length))+1);
      return fence+(n.attrs?.language || '')+'\n'+text+'\n'+fence+'\n\n';
    }
    if(['bulletList','orderedList','taskList'].includes(n.type))return list(n);
    const content=(n.content || []).map(walk).join('');
    if(n.type==='heading')return '#'.repeat(n.attrs?.level || 2)+' '+content+'\n\n';
    if(n.type==='paragraph')return content+'\n\n';
    if(n.type==='blockquote')return content.trimEnd().split('\n').map(line=>'> '+line).join('\n')+'\n\n';
    if(n.type==='hardBreak')return '  \n';
    if(n.type==='horizontalRule')return '\n---\n\n';
    if(n.type==='image')return '!['+(n.attrs.alt || '图片').replace(/]/g,'\\]')+']('+n.attrs.src+')\n\n';
    if(n.type==='table'){
      const rows=(n.content || []).map(row=>'| '+(row.content || []).map(cell=>(cell.content || []).map(walk).join('').trim().replace(/\|/g,'\\|').replace(/\n/g,'<br>')).join(' | ')+' |');
      if(rows.length)rows.splice(1,0,'| '+(n.content[0].content || []).map(()=>'---').join(' | ')+' |');
      return rows.join('\n')+'\n\n';
    }
    return content;
  }
  return '# '+plan.title+'\n\n'+walk(plan.doc);
}

function htmlDocument(plan, html) {
  return '<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>' + escapeHTML(plan.title) + "</title><style>body{max-width:780px;margin:60px auto;padding:0 25px;font:16px/1.9 system-ui;color:#2b2729}h1,h2{line-height:1.5}table{border-collapse:collapse;width:100%}td,th{border:1px solid #ccc;padding:8px}img{max-width:100%}blockquote{border-left:3px solid #744660;padding-left:16px}a{color:#744660}</style><body><h1>" + escapeHTML(plan.title) + "</h1>" + sanitizeHTML(html) + "</body></html>";
}
function colorHex(s) {
  if (/^#[\da-f]{6}$/i.test(s || "")) return s.slice(1);
  const m = /^rgb\(\s*(\d+)[, ]+\s*(\d+)[, ]+\s*(\d+)\s*\)/i.exec(s || "");
  return m ? m.slice(1).map((x) => Math.min(255, Number(x)).toString(16).padStart(2, "0")).join("") : null;
}
async function wordDocument(plan) {
  const D = await import("docx"), { Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell, WidthType, HeadingLevel, ExternalHyperlink } = D;
  function inline(n) {
    if (n.type === "wikiLink") return [new TextRun("[[" + (n.attrs.alias || n.attrs.title || "") + "]]")];
    if (n.type === "hardBreak") return [new TextRun({ break: 1 })];
    if (n.type === "text") {
      const o = { text: n.text };
      for (const m of n.marks || []) {
        if (m.type === "bold") o.bold = true;
        if (m.type === "italic") o.italics = true;
        if (m.type === "underline") o.underline = {};
        if (m.type === "strike") o.strike = true;
        if (m.type === "highlight" && colorHex(m.attrs?.color)) o.shading = { fill: colorHex(m.attrs.color) };
        if (m.type === "textStyle") {
          const a = m.attrs || {};
          if (colorHex(a.color)) o.color = colorHex(a.color);
          if (a.fontSize) o.size = Math.round(parseFloat(a.fontSize) * (a.fontSize.endsWith("pt") ? 2 : 1.5));
          if (a.fontFamily) o.font = a.fontFamily.replace(/['"]/g, "");
        }
      }
      const r = new TextRun(o), l = n.marks?.find((m) => m.type === "link");
      return l && /^(https?:\/\/|mailto:)/i.test(l.attrs?.href || "") ? [new ExternalHyperlink({ link: l.attrs.href, children: [r] })] : [r];
    }
    return (n.content || []).flatMap(inline);
  }
  function blocks(n, level = 0, kind = "") {
    if (n.type === "table") return [new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows: n.content.map((row) => new TableRow({ children: row.content.map((cell) => new TableCell({ children: cell.content?.flatMap((c) => blocks(c)) || [new Paragraph("")] })) })) })];
    if (["paragraph", "heading", "codeBlock", "blockquote"].includes(n.type)) {
      const o = { children: inline(n), spacing: { after: 160 } };
      if (n.type === "heading") o.heading = HeadingLevel["HEADING_" + Math.min(6, n.attrs?.level || 2)];
      if (kind === "bullet") o.bullet = { level: Math.min(level, 8) };
      if (kind === "ordered") o.numbering = { reference: "research", level: Math.min(level, 8) };
      if (n.attrs?.textAlign) o.alignment = n.attrs.textAlign;
      return [new Paragraph(o)];
    }
    if (n.type === "taskItem") return [new Paragraph({ children: [new TextRun(n.attrs?.checked ? "☑ " : "☐ "), ...inline(n.content?.[0] || {})] }), ...(n.content || []).slice(1).flatMap((c) => blocks(c))];
    if (n.type === "image") return [new Paragraph("[图片请参阅原件附件或 HTML 版本]")];
    return (n.content || []).flatMap((c) => blocks(c, n.type === "listItem" ? level + 1 : level, n.type === "bulletList" ? "bullet" : n.type === "orderedList" ? "ordered" : kind));
  }
  return Packer.toBlob(new Document({ creator: "LexiVault", title: plan.title, numbering: { config: [{ reference: "research", levels: Array.from({ length: 9 }, (_, level) => ({ level, format: "decimal", text: "%" + (level + 1) + ".", alignment: "left", style: { paragraph: { indent: { left: 720 * (level + 1), hanging: 260 } } } })) }] }, sections: [{ children: [new Paragraph({ text: plan.title, heading: HeadingLevel.TITLE }), ...blocks(plan.doc)] }] }));
}
export {
  createBackup,
  htmlDocument,
  importDocument,
  inspectZip,
  markdown,
  parseCSV,
  readBackup,
  rtfHTML,
  sanitizeHTML,
  textHTML,
  wordDocument
};
