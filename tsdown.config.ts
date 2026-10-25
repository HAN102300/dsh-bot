import { defineConfig } from 'tsdown';
import fs from 'node:fs';
import path from 'node:path';

/**
 * 构建插件：
 *   src/index.ts         → lib/index.js   （host 端，需要打包）
 *   src/client/bundle.js → lib/client.js  （浏览器端，原样复制）
 *
 * 客户端为什么原样复制：
 *   它是 window.__ModuleLoader__.load({...}) 形式，
 *   DSH 的 client-modules 会直接作为 <script> 加载并执行，
 *   不应该被 ESM 打包器处理。
 *
 * ⚠️ package.json 的 exports["./client"] 必须指向 ./lib/client.js，
 *    这是 DSH 发现浏览器端插件的硬性要求。
 */
const copyClient = () => {
  const src = path.resolve('src/client/bundle.js');
  const dst = path.resolve('lib/client.js');
  if (fs.existsSync(src)) {
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.copyFileSync(src, dst);
    console.log('✔ copied src/client/bundle.js → lib/client.js');
  } else {
    console.warn('⚠ src/client/bundle.js not found, skipping client bundle');
  }
};

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  platform: 'node',
  outDir: 'lib',
  dts: false,
  clean: true,
  external: [/^@deepseek-ai\//],
  hooks: {
    'build:done': copyClient,
  },
});
