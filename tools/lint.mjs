// 静态自检：抓那些不打开浏览器就发现不了的接线错误。
// 自动扫描 games/ 下的每个游戏，逐个检查模块加载、import 路径、DOM id、导出名，
// 再核对游戏注册表和 Netlify 配置。加新游戏不用改本文件。
// 用法：node tools/lint.mjs

import { readFile, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { pathToFileURL } from 'node:url';

const root = resolve(import.meta.dirname, '..');
let failures = 0;

function ok(name) { console.log('  \u2713 ' + name); }
function bad(name, detail) {
  failures++;
  console.log('  \u2717 ' + name + (detail ? '\n    ' + detail : ''));
}

// ---------- 发现结构：根页面 + games/<id>/ 下的每个游戏 ----------
const gamesDir = resolve(root, 'games');
const gameIds = (await readdir(gamesDir, { withFileTypes: true }))
  .filter((e) => e.isDirectory())
  .map((e) => e.name);

const pages = [{ rel: 'index.html', abs: resolve(root, 'index.html') }];
for (const id of gameIds) {
  for (const f of await readdir(resolve(gamesDir, id))) {
    if (f.endsWith('.html')) {
      pages.push({ rel: `games/${id}/${f}`, abs: resolve(gamesDir, id, f) });
    }
  }
}

console.log('\n[1] 游戏模块能否真正加载');
for (const id of gameIds) {
  const dir = resolve(gamesDir, id);
  const mods = [];
  if (existsSync(resolve(dir, 'config.js'))) mods.push('config.js');
  const srcDir = resolve(dir, 'src');
  if (existsSync(srcDir)) {
    for (const f of await readdir(srcDir)) if (f.endsWith('.js')) mods.push('src/' + f);
  }
  if (mods.length === 0) { ok(`games/${id}/（无 JS 模块，跳过）`); continue; }
  for (const m of mods) {
    try {
      await import(pathToFileURL(resolve(dir, m)).href);
      ok(`games/${id}/${m}`);
    } catch (err) {
      bad(`games/${id}/${m}`, err.message);
    }
  }
}

console.log('\n[2] HTML 里的 import 路径是否都有效');
for (const p of pages) {
  const html = await readFile(p.abs, 'utf8');
  const specs = [...html.matchAll(/from\s+['"](\.[^'"]+)['"]/g)].map((m) => m[1]);
  for (const spec of specs) {
    const target = resolve(dirname(p.abs), spec);
    if (existsSync(target)) ok(`${p.rel} -> ${spec}`);
    else bad(`${p.rel} -> ${spec}`, '文件不存在');
  }
}

console.log('\n[3] 脚本引用的 DOM id 是否都存在');
for (const p of pages) {
  const html = await readFile(p.abs, 'utf8');
  const defined = new Set([...html.matchAll(/\bid\s*=\s*"([^"]+)"/g)].map((m) => m[1]));
  const used = new Set([
    ...[...html.matchAll(/\$\('([^']+)'\)/g)].map((m) => m[1]),
    ...[...html.matchAll(/getElementById\('([^']+)'\)/g)].map((m) => m[1]),
  ]);
  for (const id of used) {
    if (defined.has(id)) ok(`${p.rel} #${id}`);
    else bad(`${p.rel} #${id}`, 'JS 里引用了，但 HTML 中没有这个 id');
  }
}

console.log('\n[4] 导出的函数名有没有用到不存在的');
for (const p of pages) {
  const html = await readFile(p.abs, 'utf8');
  const lines = html.match(/import\s+\{[^}]+\}\s+from\s+['"]\.[^'"]+['"]/g) || [];
  for (const line of lines) {
    const m = line.match(/import\s+\{([^}]+)\}\s+from\s+['"](\.[^'"]+)['"]/);
    if (!m) continue;
    const names = m[1].split(',').map((s) => s.trim()).filter(Boolean);
    const target = resolve(dirname(p.abs), m[2]);
    try {
      const mod = await import(pathToFileURL(target).href);
      for (const name of names) {
        if (name in mod) ok(`${p.rel} <- ${m[2]} 导出 ${name}`);
        else bad(`${p.rel} <- ${m[2]} 导出 ${name}`, '模块里没有这个导出');
      }
    } catch (err) {
      bad(`${p.rel} <- ${m[2]}`, '模块加载失败: ' + err.message);
    }
  }
}

console.log('\n[5] 游戏注册表 games/registry.js');
{
  try {
    const reg = await import(pathToFileURL(resolve(gamesDir, 'registry.js')).href);
    const games = reg.GAMES;
    if (!Array.isArray(games) || games.length === 0) {
      bad('GAMES', '注册表不是非空数组');
    } else {
      for (const g of games) {
        const label = `注册表项 ${g.id || '(缺 id)'}`;
        const required = ['id', 'title', 'tagline', 'desc', 'href', 'players', 'controls', 'tags', 'accent'];
        const missing = required.filter((k) => g[k] === undefined);
        if (missing.length) bad(label, '缺少字段: ' + missing.join(', '));
        else if (!gameIds.includes(g.id)) bad(label, `games/${g.id}/ 目录不存在（id 要和目录名一致）`);
        else if (!existsSync(resolve(root, g.href.replace(/^\.\//, '')))) bad(label, `入口不存在: ${g.href}`);
        else ok(`${g.id} -> ${g.href}`);
      }
    }
  } catch (err) {
    bad('games/registry.js', err.message);
  }
}

console.log('\n[6] Netlify 配置');
{
  const toml = await readFile(resolve(root, 'netlify.toml'), 'utf8');
  if (/publish\s*=\s*"\."/.test(toml)) ok('publish = "."');
  else bad('publish', '发布目录不是项目根');
}

console.log('\n' + (failures === 0 ? '全部通过 ✓' : failures + ' 项失败 ✗'));
process.exit(failures === 0 ? 0 : 1);
