import { mkdir, writeFile } from "node:fs/promises";
import { wordDocument } from "../src/plans/formats.js";
import { seedPlans } from "../src/plans/model.js";
await mkdir("dist/examples", { recursive: true });
const p = seedPlans()[0];
p.title = "我的科研推进计划";
await writeFile("dist/examples/research-plan.docx", new Uint8Array(await (await wordDocument(p)).arrayBuffer()));
await writeFile("dist/examples/research-plan.md", "# 本周科研安排\n\n## 研究问题\n分子预训练的收益，是否依赖数据划分？\n\n- [x] 整理入门综述\n- [ ] 核对数据划分\n- [ ] 准备组会\n\n把复现实验关联到 [[新的实验方案]]。\n\n| 工作 | 预期产出 |\n| --- | --- |\n| 精读 | 证据记录 |\n| 复现 | 可运行基线 |\n");
await writeFile("dist/examples/research-tasks.csv", '任务,说明,优先级\n精读综述,"记录问题、方法与限制",高\n复现基线,"核验数据划分\n保存随机种子",高\n组会准备,整理待讨论问题,中\n');
await writeFile("dist/examples/research-notes.txt", "研究备忘\n\n先写清楚假设，再决定实验。\n原文结论与自己的推断应分开记录。\n");
await writeFile("dist/examples/research-notes.rtf", "{\\rtf1\\ansi\\deff0{\\colortbl;\\red116\\green70\\blue96;\\red239\\green226\\blue165;}\\b Research plan\\b0\\par \\cf1 Evidence first.\\cf0\\par \\highlight2 Verify the dataset split.\\highlight0\\par }");
const stream = "BT /F1 20 Tf 56 770 Td (Research plan) Tj 0 -40 Td /F1 12 Tf (Read the survey. Verify evidence. Reproduce a baseline.) Tj ET";
const objs = ["<< /Type /Catalog /Pages 2 0 R >>", "<< /Type /Pages /Kids [3 0 R] /Count 1 >>", "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>", "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>", `<< /Length ${Buffer.byteLength(stream)} >>
stream
${stream}
endstream`];
let pdf = "%PDF-1.4\n", offsets = [0];
objs.forEach((o, i) => {
  offsets.push(Buffer.byteLength(pdf));
  pdf += `${i + 1} 0 obj
${o}
endobj
`;
});
const xref = Buffer.byteLength(pdf);
pdf += "xref\n0 6\n0000000000 65535 f \n" + offsets.slice(1).map((n) => String(n).padStart(10, "0") + " 00000 n \n").join("") + `trailer
<< /Size 6 /Root 1 0 R >>
startxref
${xref}
%%EOF
`;
await writeFile("dist/examples/research-plan.pdf", pdf);
console.log("Created DOCX, Markdown, CSV, TXT, RTF and text-layer PDF examples.");
