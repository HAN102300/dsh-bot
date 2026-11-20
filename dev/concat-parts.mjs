/**
 * 拼接 src/client/parts/*.js → src/client/bundle.js
 *
 * 刀 0（v0.3.9）：bundle 单文件不可维护（0.3.8 时 6634 行），按序号分片开发，
 * 构建前拼接回单文件 bundle.js（IIFE 形态不变，ModuleLoader 契约不变）。
 *
 * 约定：
 *   · parts/ 下按文件名字典序拼接，纯文本操作，无语法转换
 *   · 修改源码请改 parts/ 下的分片，不要直接改 bundle.js（会被本脚本覆盖）
 */
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const partsDir = path.join(__dirname, '..', 'src', 'client', 'parts');
const outFile = path.join(__dirname, '..', 'src', 'client', 'bundle.js');

const files = fs.readdirSync(partsDir).filter((f) => f.endsWith('.js')).sort();
if (files.length === 0) {
  console.error('concat-parts: parts/ 目录为空');
  process.exit(1);
}

const partsList = files.map((f) => ' * - src/client/parts/' + f).join('\n');
const banner = [
  '/*',
  ' * ⚠️ 本文件由 dev/concat-parts.mjs 自动拼接生成 —— 不要直接编辑！',
  ' * 分片清单（按文件名字典序拼接，改完分片运行: node dev/concat-parts.mjs）:',
  partsList,
  ' */',
  '',
].join('\n');

let body = '';
for (const f of files) {
  let text = fs.readFileSync(path.join(partsDir, f), 'utf8');
  if (!text.endsWith('\n')) text += '\n';
  body += text;
}
body = body.replace(/\n$/, '\n');

fs.writeFileSync(outFile, banner + '\n' + body);
const kb = ((banner.length + 1 + body.length) / 1024).toFixed(1);
console.log('concat-parts: ' + files.length + ' parts → src/client/bundle.js (' + kb + ' KB)');
