#!/usr/bin/env node
/**
 * 单文件 HTML 原型的无头验证器（语法检查 + jsdom 冒烟测试）
 *
 * 用法:
 *   node verify_html.js <原型.html> [--steps <steps.js>] [--delay 250] [--wait 8000]
 *
 * --steps  可选的步骤文件，导出 module.exports = function (ctx) { ... }，
 *          ctx = { win, doc, q, qa, click, change, input, step, log, errors, sleep }
 * --delay  页面加载后等待多少毫秒再跑步骤（默认 250）
 * --wait   CDN 资源等待上限，仅影响提示（默认 8000）
 *
 * 退出码: 0 全部通过 / 1 校验或步骤失败 / 2 环境缺失
 *
 * jsdom 位置：优先环境变量 JSDOM_PATH，其次常规 require 解析。
 */

'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

function arg(name, dflt) {
  const i = process.argv.indexOf('--' + name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : dflt;
}

const target = process.argv[2];
if (!target) {
  console.error('用法: node verify_html.js <原型.html> [--steps steps.js]');
  process.exit(2);
}
const htmlPath = path.resolve(target);
if (!fs.existsSync(htmlPath)) {
  console.error('[x] 找不到文件: ' + htmlPath);
  process.exit(2);
}
const stepsPath = arg('steps', null);
const delay = parseInt(arg('delay', '250'), 10);

function loadJsdom() {
  const cands = [];
  if (process.env.JSDOM_PATH) cands.push(process.env.JSDOM_PATH);
  cands.push('jsdom');
  for (const c of cands) { try { return require(c); } catch (e) { /* 继续尝试 */ } }
  console.error('[x] 未找到 jsdom。安装后重试：');
  console.error('    <node目录>/npm install jsdom');
  console.error('    或设置环境变量 JSDOM_PATH=<.../node_modules/jsdom>');
  process.exit(2);
}
const { JSDOM, VirtualConsole } = loadJsdom();

const html = fs.readFileSync(htmlPath, 'utf8');
const report = [];
let failed = 0;

/* ---------- 1. 内联脚本语法检查 ---------- */
const blocks = [];
const re = /<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi;
let m;
while ((m = re.exec(html)) !== null) if (m[1].trim()) blocks.push(m[1]);
if (!blocks.length) {
  report.push('FAIL  未找到内联 <script> 块');
  failed++;
} else {
  const biggest = blocks.reduce((a, b) => (b.length > a.length ? b : a));
  const tmp = path.join(os.tmpdir(), 'verify_' + Date.now() + '.js');
  fs.writeFileSync(tmp, biggest, 'utf8');
  const r = spawnSync(process.execPath, ['--check', tmp], { encoding: 'utf8' });
  if (r.status === 0) report.push('OK    内联脚本语法检查（' + blocks.length + ' 块 / 主体 ' + biggest.length + ' 字符）');
  else { report.push('FAIL  内联脚本语法错误：\n' + (r.stderr || '').trim()); failed++; }
  try { fs.unlinkSync(tmp); } catch (e) {}
  const leftovers = (html.match(/__[A-Z0-9_]*PLACEHOLDER[A-Z0-9_]*__|__JS\d__/g) || []);
  if (leftovers.length) { report.push('FAIL  存在未替换的占位符: ' + leftovers.join(', ')); failed++; }
  else report.push('OK    无残留占位符');
}

/* ---------- 2. jsdom 载入 ---------- */
const errors = [];
const vc = new VirtualConsole();
vc.on('jsdomError', e => {
  const msg = e && e.message ? e.message : String(e);
  if (/Not implemented/.test(msg)) return; // scrollTo 等 jsdom 自身限制，忽略
  errors.push('jsdomError: ' + msg);
});
vc.on('error', function () { errors.push('console.error: ' + Array.prototype.join.call(arguments, ' ')); });

let dom;
try {
  dom = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true, url: 'http://localhost/', virtualConsole: vc });
} catch (e) {
  report.push('FAIL  jsdom 载入失败：' + (e && e.message));
  console.log(report.join('\n'));
  process.exit(1);
}
const win = dom.window;
const doc = win.document;

function q(s) { return doc.querySelector(s); }
function qa(s) { return Array.prototype.slice.call(doc.querySelectorAll(s)); }
function click(el) { if (!el) throw new Error('目标元素不存在'); el.dispatchEvent(new win.MouseEvent('click', { bubbles: true })); }
function setVal(el, v) { if (!el) throw new Error('目标元素不存在'); el.value = v; }
function change(el, v) { setVal(el, v); el.dispatchEvent(new win.Event('change', { bubbles: true })); }
function input(el, v) { setVal(el, v); el.dispatchEvent(new win.Event('input', { bubbles: true })); }
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

let okCount = 0;
function step(name, fn) {
  try { fn(); report.push('OK    ' + name); okCount++; }
  catch (e) { report.push('FAIL  ' + name + '  ::  ' + (e && e.message ? e.message : String(e))); failed++; }
}

setTimeout(async function () {
  report.push('=== DOM 冒烟测试 ===');
  if (stepsPath) {
    try {
      const steps = require(path.resolve(stepsPath));
      await steps({ win, doc, q, qa, click, change, input, step, log: s => report.push('      ' + s), errors, sleep });
    } catch (e) {
      report.push('FAIL  步骤文件执行异常：' + (e && e.stack ? e.stack : e)); failed++;
    }
  } else {
    report.push('（未提供 --steps，仅做载入检查）');
    step('页面可载入且无致命错误', function () { if (!doc.body || !doc.body.children.length) throw new Error('body 为空'); });
  }
  report.push('');
  report.push('=== 运行时错误（' + errors.length + ' 条）===');
  report.push.apply(report, errors.length ? errors : ['无']);
  report.push('');
  report.push((failed ? '结果：失败 ' + failed + ' 项 / 通过 ' + okCount + ' 项' : '结果：全部通过（' + okCount + ' 项）'));
  console.log(report.join('\n'));
  process.exit(failed ? 1 : 0);
}, delay);
