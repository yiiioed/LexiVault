import { LIMITS, validPlan } from "./model.js";
class ConflictError extends Error {
  constructor() {
    super("另一个页面已更新此计划。当前草稿仍保留，请另存为副本或载入已保存版本。");
    this.name = "ConflictError";
  }
}
const request = (req) => new Promise((resolve, reject) => {
  req.onsuccess = () => resolve(req.result);
  req.onerror = () => reject(req.error);
});
const complete = (tx) => new Promise((resolve, reject) => {
  tx.oncomplete = resolve;
  tx.onerror = tx.onabort = () => reject(tx.error || new Error("本地事务未完成。"));
});
async function openStore(name = "lexivault.plans.v1", factory = globalThis.indexedDB) {
  if (!factory) throw new Error("本地数据库不可用，请通过 HTTP 打开并允许本地存储。");
  const req = factory.open(name, 1);
  req.onupgradeneeded = () => {
    const db2 = req.result;
    db2.createObjectStore("plans", { keyPath: "id" });
    const files = db2.createObjectStore("files", { keyPath: "id" });
    files.createIndex("planId", "planId");
    db2.createObjectStore("meta", { keyPath: "key" });
  };
  const db = await request(req);
  db.onversionchange = () => db.close();
  const all = (key) => request(db.transaction(key).objectStore(key).getAll());
  const get = (key, id) => request(db.transaction(key).objectStore(key).get(id));
  async function putPlan(plan, revision = 0, files = []) {
    validPlan(plan);
    if (files.some((f) => !f.blob || f.blob.size !== f.size || f.size > LIMITS.file || f.planId !== plan.id)) throw new Error("附件大小或所属计划无效。");
    const tx = db.transaction(["plans", "files"], "readwrite"), done = complete(tx);
    let conflict = false;
    const store = tx.objectStore("plans"), lookup = store.get(plan.id);
    lookup.onsuccess = () => {
      if ((lookup.result?.revision || 0) !== revision) {
        conflict = true;
        tx.abort();
        return;
      }
      store.put({ ...plan, revision: revision + 1 });
      files.forEach((f) => tx.objectStore("files").put(f));
    };
    try {
      await done;
    } catch (error) {
      if (conflict) throw new ConflictError();
      throw error;
    }
    return { ...plan, revision: revision + 1 };
  }
  async function importBatch(plans, files) {
    if (plans.length > LIMITS.plans) throw new Error("计划数量超限。");
    plans.forEach(validPlan);
    if (files.some((f) => !f.blob || f.blob.size !== f.size || f.size > LIMITS.file)) throw new Error("备份附件无效。");
    const tx = db.transaction(["plans", "files"], "readwrite"), done = complete(tx);
    plans.forEach((p) => tx.objectStore("plans").add({ ...p, revision: 1 }));
    files.forEach((f) => tx.objectStore("files").add(f));
    await done;
  }
  async function setMeta(key, value) {
    const tx = db.transaction("meta", "readwrite"), done = complete(tx);
    tx.objectStore("meta").put({ key, value });
    await done;
  }
  async function seed() {
    const tx = db.transaction(["plans", "meta"], "readwrite"), done = complete(tx), meta = tx.objectStore("meta"), lookup = meta.get("initialized");
    lookup.onsuccess = () => {
      if (lookup.result) return;
      const count = tx.objectStore("plans").count();
      count.onsuccess = () => {
        // Opening a workspace must never create example plans.
        meta.put({ key: "initialized", value: true });
      };
    };
    await done;
  }
  async function removeAttachment(id) {
    const tx = db.transaction(["plans", "files"], "readwrite"), done = complete(tx), files = tx.objectStore("files"), r = files.get(id);
    r.onsuccess = () => {
      if (!r.result) return;
      const f = r.result;
      files.delete(id);
      const q = tx.objectStore("plans").get(f.planId);
      q.onsuccess = () => {
        if (q.result) {
          const p = q.result;
          tx.objectStore("plans").put({ ...p, attachmentIds: p.attachmentIds.filter((x) => x !== id), revision: p.revision + 1 });
        }
      };
    };
    await done;
  }
  return { allPlans: () => all("plans"), allFiles: () => all("files"), getPlan: (id) => get("plans", id), getFile: (id) => get("files", id), putPlan, importBatch, removeAttachment, setMeta, getMeta: async (key) => (await get("meta", key))?.value, seed, close: () => db.close() };
}
export {
  ConflictError,
  openStore
};
