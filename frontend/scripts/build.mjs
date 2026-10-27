import { build } from "esbuild";
import { mkdir, rm, cp, readFile, writeFile, readdir } from "node:fs/promises";
import { writePages } from "./pages.mjs";
import { createHash } from 'node:crypto';
const pdfWorkerBytes = await readFile('node_modules/pdfjs-dist/legacy/build/pdf.worker.min.mjs');
const pdfWorkerName = `pdf.worker.${createHash('sha256').update(pdfWorkerBytes).digest('hex').slice(0,12)}.js`;
await mkdir('dist/vendor', {recursive:true});
await writeFile('dist/vendor/'+pdfWorkerName, pdfWorkerBytes);
await writePages();
await build({entryPoints:["src/workspace-client.js"],outfile:"dist/workspace-client.js",bundle:true,format:"iife",minify:true,target:["es2022"],charset:"utf8",logLevel:"info"});
await build({entryPoints:["src/account-client.js"],outfile:"dist/account-client.js",bundle:true,format:"iife",minify:true,target:["es2022"],charset:"utf8",logLevel:"info"});
for (const name of await readdir('dist')) {
  if (!name.endsWith('.html')) continue;
  const file = 'dist/' + name;
  let html = await readFile(file,'utf8');
  html = html.replace(/(href="[^"?]+\.css)\?v=[^" ]+/g,'$1');
  html = html.replace(/(src="[^"?]+\.js)\?v=[^" ]+/g,'$1');
  html = html.replace(/<script src="workspace-client.js" defer><\/script>/g,'');
  html = html.replace(/(<script(?: type="module"| src="(?:sidebar|workspace|account-client)\.js"))/, '<script src="workspace-client.js" defer></script>$1');
  await writeFile(file,html);
  if (!html.includes('src="account-client.js"')) await writeFile(file,html.replace('</head>','<script src="account-client.js" defer></script></head>'));
}
await rm("dist/generated", { recursive: true, force: true });
await build({ entryPoints: { plans: "src/plans/app.js", discover: "src/discover/app.js", reader: "src/reader/app.js", "suite-pages": "src/prototypes.js", designs: "src/designs.js" }, outdir: "dist/generated", bundle: true, format: "esm", splitting: true, minify: true, target: ["es2022"], define:{__PDFJS_WORKER_URL__:JSON.stringify('/vendor/'+pdfWorkerName)}, legalComments: "linked", logLevel: "info" });
await cp("src/reader/reader.css", "dist/reader.css");
await cp("src/explorer.css", "dist/explorer.css");
await build({entryPoints:["src/sidebar-standalone.js"],outfile:"dist/sidebar.js",bundle:true,format:"iife",minify:true,target:["es2022"],charset:"utf8",logLevel:"info"});
await mkdir("dist/vendor", { recursive: true });
await cp("node_modules/pdfjs-dist/legacy/build/pdf.worker.min.mjs", "dist/vendor/pdf.worker.min.mjs");
for (const name of ["cmaps", "standard_fonts"]) await cp("node_modules/pdfjs-dist/" + name, "dist/vendor/" + name, { recursive: true });
await cp("node_modules/pdfjs-dist/LICENSE", "dist/vendor/PDFjs-LICENSE.txt");
const manifest = JSON.parse(await readFile("package.json", "utf8"));
const lock = JSON.parse(await readFile("package-lock.json", "utf8")), licenses = [];
await rm("dist/vendor/licenses", {recursive:true,force:true});
await mkdir("dist/vendor/licenses", {recursive:true});
for(const [location,entry] of Object.entries(lock.packages)) {
  if(!location.startsWith("node_modules/") || entry.dev) continue;
  let p;
  try {p=JSON.parse(await readFile(location+"/package.json","utf8"));} catch {continue;}
  const item={name:p.name,version:p.version,license:p.license,direct:Object.hasOwn(manifest.dependencies,p.name),repository:p.repository?.url || p.repository || ""};
  for(const name of ["LICENSE","LICENSE.md","LICENSE.txt","LICENSE-MIT","COPYING"]) try {
    const target=p.name.replace(/[@/]/g,"-")+"-"+p.version+".txt";
    await cp(location+"/"+name,"dist/vendor/licenses/"+target);item.licenseFile="licenses/"+target;break;
  } catch {}
  licenses.push(item);
}
await writeFile("dist/vendor/dependencies.json",JSON.stringify(licenses,null,2));
// Stable entry filenames must load the matching build after an update.
for (const name of await readdir('dist')) {
  if (!name.endsWith('.html')) continue;
  const file='dist/'+name;
  let html=await readFile(file,'utf8');
  for (const match of [...html.matchAll(/<script[^>]+src="([^"?]+\.js)"/g)]) {
    const version=createHash('sha256').update(await readFile('dist/'+match[1])).digest('hex').slice(0,12);
    html=html.replace(`src="${match[1]}"`,`src="${match[1]}?v=${version}"`);
  }
  for(const match of [...html.matchAll(/<link[^>]+href="([^"?]+\.css)"/g)]){
    const version=createHash('sha256').update(await readFile('dist/'+match[1])).digest('hex').slice(0,12);
    html=html.replace(`href="${match[1]}"`,`href="${match[1]}?v=${version}"`);
  }
  await writeFile(file,html);
}
console.log("Built workspace routes, local plan editor, import/export modules and design gallery.");
