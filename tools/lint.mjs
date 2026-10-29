// 静态自检：抓那些不打开浏览器就发现不了的接线错误。
// 用法：node tools/lint.mjs

import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';

const root = resolve(import.meta.dirname, '..');
let failures = 0;

function ok(name) { console.log('  \u2713 ' + name); }
function bad(name, detail) {
  failures++;
  console.log('  \u2717 ' + name + (detail ? '\n    ' + detail : ''));
}

console.log('\n[1] 模块能否真正加载');
for (const m of ['src/rng.js', 'src/track.js', 'src/game.js', 'src/net.js', 'src/race.js', 'config.js']) {
  try {
    await import(new URL('../' + m, import.meta.url).href);
    ok(m);
  } catch (err) {
    bad(m, err.message);
  }
}

console.log('\n[2] HTML 里的 import 路径是否都有效');
for (const page of ['index.html', 'game.html']) {
  const html = await readFile(resolve(root, page), 'utf8');
  const specs = [...html.matchAll(/from\s+['"](\.[^'"]+)['"]/g)].map((m) => m[1]);
  for (const spec of specs) {
    const target = resolve(root, dirname(page), spec);
    if (existsSync(target)) ok(`${page} -> ${spec}`);
    else bad(`${page} -> ${spec}`, '文件不存在');
  }
}

console.log('\n[3] 脚本引用的 DOM id 是否都存在');
{
  const page = 'game.html';
  const html = await readFile(resolve(root, page), 'utf8');

  const defined = new Set([...html.matchAll(/\bid\s*=\s*"([^"]+)"/g)].map((m) => m[1]));
  const used = new Set([
    ...[...html.matchAll(/\$\('([^']+)'\)/g)].map((m) => m[1]),
    ...[...html.matchAll(/getElementById\('([^']+)'\)/g)].map((m) => m[1]),
  ]);

  for (const id of used) {
    if (defined.has(id)) ok('#' + id);
    else bad('#' + id, 'JS 里引用了，但 HTML 中没有这个 id');
  }
}

console.log('\n[4] 导出的函数名有没有用到不存在的');
{
  // game.html 从各模块导入的名字，逐个核对模块真实导出了没有
  const html = await readFile(resolve(root, 'game.html'), 'utf8');
  const block = html.match(/import\s+\{([^}]+)\}\s+from\s+['"]\.\/(src\/[^'"]+)['"]/g) || [];
  for (const line of block) {
    const m = line.match(/import\s+\{([^}]+)\}\s+from\s+['"]\.\/(src\/[^'"]+)['"]/);
    if (!m) continue;
    const names = m[1].split(',').map((s) => s.trim()).filter(Boolean);
    const mod = await import(new URL('../' + m[2], import.meta.url).href);
    for (const name of names) {
      if (name in mod) ok(`${m[2]} 导出 ${name}`);
      else bad(`${m[2]} 导出 ${name}`, '模块里没有这个导出');
    }
  }
}

console.log('\n[5] Netlify 配置');
{
  const toml = await readFile(resolve(root, 'netlify.toml'), 'utf8');
  if (/publish\s*=\s*"\."/.test(toml)) ok('publish = "."');
  else bad('publish', '发布目录不是项目根');
}

console.log('\n' + (failures === 0 ? '全部通过 ✓' : failures + ' 项失败 ✗'));
process.exit(failures === 0 ? 0 : 1);
