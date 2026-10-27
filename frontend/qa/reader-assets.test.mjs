import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';

test('production reader loads a content-hashed JS worker matching its bundled PDF.js version',()=>{
  const root=new URL('../',import.meta.url);
  const expected=readFileSync(new URL('node_modules/pdfjs-dist/legacy/build/pdf.worker.min.mjs',root));
  const hash=createHash('sha256').update(expected).digest('hex').slice(0,12);
  const asset=`/vendor/pdf.worker.${hash}.js`;
  const reader=readFileSync(new URL('dist/generated/reader.js',root),'utf8');
  assert.ok(reader.includes(asset),'Reader must request a fresh versioned worker URL');
  assert.ok(!reader.includes('vendor/pdf.worker.min.mjs'),'Do not reuse the previously failed unversioned module URL');
  assert.deepEqual(readFileSync(fileURLToPath(new URL('dist'+asset,root))),expected);
});
