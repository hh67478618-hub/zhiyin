#!/usr/bin/env node
/**
 * 职引 · 三套自测一键跑
 *
 *   用法:  node tests/run-all.js
 *   依赖:  交互 / 采集两套需要 jsdom（仓库根目录执行 npm install）
 *          算法层零依赖，可单独跑: node tests/engine.test.js
 *
 * 退出码: 0 全绿 / 1 有失败 / 2 环境缺失
 */
'use strict';
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

/* ---------- 静态预检：断言不能变成「return 之后的死代码」 ----------
   这个项目真踩过：一个 `})());` 被插到了 50 行之外的另一条断言后面，
   于是中间几条断言成了 IIFE 里 return 之后的死代码 —— 语法合法、不报错、
   不计数、不出现在输出里，整体照样打印「全部通过」。隔了很久才靠人工核对发现。
   所以现在把这条检查做成机械判据。 */
const ASSERT_RE = /^(ok|ok2|ok3|step|check)\(/;
const indentOf = function (l) { return (l.match(/^[ \t]*/) || [''])[0].length; };

function deadAssertsIn(text) {
  const lines = text.split(/\r?\n/);
  const hits = [];
  let inReturn = null, afterReturn = null;
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i], t = raw.trim();
    if (!t) continue;
    if (afterReturn && ASSERT_RE.test(t) && indentOf(raw) <= afterReturn.indent) {
      hits.push({ line: i + 1, text: t });
    }
    afterReturn = null;
    if (inReturn) {
      if (t.indexOf('{') >= 0) inReturn.hasBrace = true;
      if (/;\s*$/.test(t)) {
        if (!inReturn.hasBrace) afterReturn = { indent: inReturn.indent };
        inReturn = null;
      }
      continue;
    }
    if (/^return\b/.test(t)) {
      if (/;\s*$/.test(t)) { if (t.indexOf('{') < 0) afterReturn = { indent: indentOf(raw) }; }
      else inReturn = { indent: indentOf(raw), hasBrace: t.indexOf('{') >= 0 };
    }
  }
  return hits;
}

/* 守卫本身要先被验证 —— 一个从不报警的守卫比没有守卫更糟 */
const BAD = ['ok3(\'甲\',', '  (function () {', '    return c1 &&', '      c2 >= 0;',
  'ok3(\'乙（死的）\',', '  (function () { return true; })());', '  })());'].join('\n');
const GOOD = ['ok3(\'甲\', (function () { return true; })());',
  'return win.fill({ a: 1 }).then(function (r) {', '  const x = 1;',
  '  ok(\'回调里的断言\', true);', '});'].join('\n');
const s1 = deadAssertsIn(BAD).length, s2 = deadAssertsIn(GOOD).length;
if (s1 !== 1 || s2 !== 0) {
  console.log('静态预检自检失败：坏样本 ' + s1 + '（应 1）/ 好样本 ' + s2 + '（应 0）');
  process.exit(1);
}

const SRC = [
  path.join(__dirname, 'engine.test.js'),
  path.join(__dirname, 'steps-interaction.js'),
  path.join(__dirname, 'collector.test.js')
];
const dead = [];
SRC.forEach(function (f) {
  if (!fs.existsSync(f)) return;
  deadAssertsIn(fs.readFileSync(f, 'utf8')).forEach(function (h) {
    dead.push(path.basename(f) + ' 第 ' + h.line + ' 行：' + h.text.slice(0, 56));
  });
});
if (dead.length) {
  console.log('静态预检失败：下面这些断言在 return 之后，永远不会执行');
  dead.forEach(function (x) { console.log('  ' + x); });
  process.exit(1);
}
console.log('静态预检通过（守卫自检正常 · 无「return 之后的死断言」）\n');

/* ---------- 三套自测 ---------- */
const JOBS = [
  ['算法层', [path.join(__dirname, 'engine.test.js')], ROOT],
  ['界面交互', [path.join(__dirname, 'verify_html.js'), path.join(ROOT, 'index.html'),
    '--steps', path.join(__dirname, 'steps-interaction.js')], ROOT],
  ['扩展采集', [path.join(__dirname, 'collector.test.js')], ROOT]
];

let log = '', envMissing = false;
for (const [name, args, cwd] of JOBS) {
  const r = spawnSync(process.execPath, args, { cwd, encoding: 'utf8', timeout: 180000 });
  const txt = (r.stdout || '') + (r.stderr || '');
  log += '\n===== ' + name + ' exit=' + r.status + ' =====\n' + txt;
  if (r.status === 2) envMissing = true;
  console.log('—— ' + name + ' ——');
  txt.split(/\r?\n/).forEach(function (l) {
    if (/项通过|项全绿|项失败|结果：|\[FAIL\]|^FAIL|运行时错误/.test(l)) console.log('  ' + l.trim());
  });
  console.log();
}

const fails = log.match(/\[FAIL\][^\n]*|^FAIL\s+[^\n]*/gm) || [];
console.log('FAIL 行数: ' + fails.length);
if (fails.length) fails.slice(0, 20).forEach(function (l) { console.log('  ' + l); });

if (envMissing) {
  console.log('\n提示：界面交互 / 扩展采集两套需要 jsdom，请在仓库根目录执行 npm install；');
  console.log('      算法层不依赖任何外部包，可单独运行：node tests/engine.test.js');
}
process.exit(fails.length || envMissing ? 1 : 0);
