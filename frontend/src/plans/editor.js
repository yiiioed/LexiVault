import { Editor, Node, InputRule, nodePasteRule, mergeAttributes } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { TextStyleKit } from "@tiptap/extension-text-style";
import Highlight from "@tiptap/extension-highlight";
import TextAlign from "@tiptap/extension-text-align";
import Image from "@tiptap/extension-image";
import { TableKit } from "@tiptap/extension-table";
import { TaskList, TaskItem } from "@tiptap/extension-list";
import Placeholder from "@tiptap/extension-placeholder";
import { sanitizeHTML } from "./formats.js";
import { normalizeTitle, resolveTitle } from "./model.js";
function wikiExtension(getPlans) {
  return Node.create({ name: "wikiLink", inline: true, group: "inline", atom: true, selectable: true, addAttributes() {
    return { targetId: { default: null, parseHTML: (e) => e.getAttribute("data-wiki-target") || null, renderHTML: () => ({}) }, title: { default: "", parseHTML: (e) => e.getAttribute("data-wiki-title") || "", renderHTML: () => ({}) }, alias: { default: "", parseHTML: (e) => e.getAttribute("data-wiki-alias") || "", renderHTML: () => ({}) } };
  }, parseHTML() {
    return [{ tag: 'span[data-type="wiki-link"]' }];
  }, renderHTML({ node, HTMLAttributes }) {
    const a = node.attrs, target = a.targetId ? getPlans().find((p) => p.id === a.targetId) : resolveTitle(a.title, getPlans());
    return ["span", mergeAttributes(HTMLAttributes, { "data-type": "wiki-link", "data-wiki-target": a.targetId || "", "data-wiki-title": a.title, "data-wiki-alias": a.alias, class: "wiki-link" + (!target || target.deletedAt ? " is-unresolved" : ""), tabindex: "0", role: "link" }), "[[" + (a.alias || target?.title || a.title) + "]]"];
  }, addPasteRules() {
    return [nodePasteRule({ find: /\[\[([^\]\n]{1,160})\]\]/g, type: this.type, getAttributes: (match) => {
      if (this.editor.isActive("codeBlock") || this.editor.isActive("code")) return false;
      const [raw, alias = ""] = match[1].split("|"), title = raw.trim();
      return title ? { targetId: resolveTitle(title, getPlans())?.id || null, title, alias } : false;
    } })];
  }, addInputRules() {
    const type = this.type;
    return [new InputRule({ find: /\[\[([^\]\n]{1,160})\]\]$/, handler: ({ state, range, match }) => {
      const [raw, alias = ""] = match[1].split("|"), title = raw.trim(), target = resolveTitle(title, getPlans());
      if (!title) return null;
      state.tr.replaceWith(range.from, range.to, type.create({ targetId: target?.id || null, title, alias }));
    } })];
  } });
}
function createPlanEditor(element, { doc, getPlans = () => [], onUpdate = () => {
}, onSelection = () => {
}, onNavigate = () => {
}, onKey = () => false } = {}) {
  return new Editor({ element, extensions: [StarterKit.configure({ link: { openOnClick: false, autolink: true, defaultProtocol: "https" } }), TextStyleKit, Highlight.configure({ multicolor: true }), TextAlign.configure({ types: ["heading", "paragraph"] }), Image.configure({ allowBase64: true }), TableKit.configure({ table: { resizable: true } }), TaskList, TaskItem.configure({ nested: true }), Placeholder.configure({ placeholder: "写下研究问题、安排和灵感，输入 [[ 连接另一份计划…" }), wikiExtension(getPlans)], content: doc || { type: "doc", content: [{ type: "paragraph" }] }, editorProps: { attributes: { class: "plan-prose", role: "textbox", "aria-label": "研究计划正文", "aria-multiline": "true", spellcheck: "false" }, transformPastedHTML: sanitizeHTML, handleKeyDown: (view, event) => onKey(event), handleDOMEvents: { click: (view, event) => {
    const link = event.target.closest?.("[data-wiki-title]");
    if (!link) return false;
    event.preventDefault();
    const pos = view.posAtDOM(link.parentNode, [...link.parentNode.childNodes].indexOf(link));
    onNavigate({ targetId: link.dataset.wikiTarget, title: link.dataset.wikiTitle, range: { from: pos, to: pos + 1 } });
    return true;
  } } }, onUpdate: ({ editor }) => onUpdate(editor), onSelectionUpdate: ({ editor }) => onSelection(editor) });
}
function pendingWiki(editor) {
  if (editor.view.composing || !editor.state.selection.empty) return null;
  const { $from } = editor.state.selection, m = /\[\[([^\]\[\n]{0,80})$/.exec($from.parent.textBetween(0, $from.parentOffset, "\n", "￼"));
  return m ? { from: $from.pos - m[0].length, to: $from.pos, query: m[1] } : null;
}
function insertWiki(editor, attrs, range) {
  const chain = editor.chain().focus();
  if (range) chain.deleteRange(range);
  return chain.insertContent([{ type: "wikiLink", attrs: { targetId: null, alias: "", ...attrs } }, { type: "text", text: " " }]).run();
}
function schemaCheck(editor, doc) {
  editor.schema.nodeFromJSON(doc).check();
  return true;
}
export {
  createPlanEditor,
  insertWiki,
  pendingWiki,
  schemaCheck,
  wikiExtension
};
