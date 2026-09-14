/* 职引 · 采集弹窗
   流程：读规则 -> 注入采集函数 -> 展示可勾选结果 -> 复制成 JSON */
const $ = (s) => document.querySelector(s);
const state = { rules: null, result: null, picked: {}, receipt: null, jobs: null, jobPicked: {}, program: null, programPicked: {}, probe: null };

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
  });
}

function banner(cls, text) {
  const el = $('#banner');
  el.className = 'banner' + (cls ? ' ' + cls : '');
  el.innerHTML = text;
}

/* ------------------------------------------------------------
   把整包 extractor.js 注入页面的「隔离世界」。

   为什么必须这么做：chrome.scripting.executeScript 的 func: 只序列化**那一个函数**
   的源码 —— 函数体里引用的任何顶层辅助函数（scanForm / labelMatch / timeRange …）
   在页面里都不存在，一调用就是 ReferenceError，而且 popup 只会看到 result 为空。
   所以每个注入入口之前，都要先把整包文件注进去（同一个隔离世界，顶层函数声明会成为
   该世界的全局，后续注入的函数就能看到它们）。

   注入完再验一次：如果这一页拿不到这几个函数，直接说清楚原因，不要让它退化成
   「没读到页面结构 / 什么都没填上」这种查不出所以然的提示。
   ------------------------------------------------------------ */
async function injectBundle(tabId) {
  await chrome.scripting.executeScript({ target: { tabId: tabId }, files: ['extractor.js'] });
  let r = null;
  try {
    const chk = await chrome.scripting.executeScript({
      target: { tabId: tabId },
      func: function () {
        /* typeof 不会抛错：这里只是「问一句」，不是在调用 */
        return {
          scanForm: typeof scanForm === 'function',
          labelMatch: typeof labelMatch === 'function',
          collectJobs: typeof collectJobs === 'function',
          probeForm: typeof probeForm === 'function'
        };
      }
    });
    r = chk && chk[0] ? chk[0].result : null;
  } catch (e) { r = null; }
  const okAll = r && r.scanForm && r.labelMatch && r.collectJobs && r.probeForm;
  if (!okAll) {
    throw new Error('扩展脚本没能注入这一页（' + JSON.stringify(r) +
      '）。请刷新页面后重试；如果一直失败，把这一页的网址发我。');
  }
}

function stageLabel(key) {
  const g = (state.rules.stages || []).filter(function (s) { return s.stage === key; })[0];
  return g ? g.label : key;
}

async function collect() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  const tab = tabs && tabs[0];
  if (!tab || !tab.id) throw new Error('找不到当前标签页。');
  if (/^(chrome|edge|about|devtools|chrome-extension|view-source):/i.test(tab.url || '')) {
    throw new Error('浏览器内置页面不允许注入脚本。请先打开你的投递记录页面，再点这个图标。');
  }
  await injectBundle(tab.id);
  const injected = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: collectFromPage,
    args: [{
      rules: (state.rules.rules) || [],
      stages: (state.rules.stages) || [],
      options: (state.rules.options) || {},
      url: tab.url,
      title: tab.title
    }]
  });
  const r = injected && injected[0] ? injected[0].result : null;
  if (!r) throw new Error('页面没有返回采集结果。可能是页面尚未渲染完，稍等一会儿再点一次。');
  return r;
}

function render() {
  const r = state.result;
  const list = $('#list');
  const toggle = $('#toggle');
  const copy = $('#copy');

  if (!r.items.length) {
    banner('warn', '这个页面上没有识别到投递状态。<br>请确认你打开的是「我的投递 / 申请记录 / 应聘进度」这类页面。' +
      '如果页面上确实有状态文字却没被认出来，把页面截图发我，我把该站点的规则补上。');
    list.innerHTML = '';
    copy.disabled = true;
    toggle.disabled = true;
    return;
  }

  const miss = r.items.filter(function (i) { return !i.company || !i.position; }).length;
  const head = r.mode === 'rule'
    ? '已按该站点规则精确提取 <b>' + r.items.length + '</b> 条。'
    : '未命中站点规则，已用通用识别提取 <b>' + r.items.length + '</b> 条。';
  const tail = miss ? '<br>其中 <b>' + miss + '</b> 条缺少公司名或职位名，导入后可在投递记录里补全。' : '';
  banner(r.mode === 'rule' ? '' : 'warn', head + '来源：' + esc(r.channel) + '。' + tail);

  r.items.forEach(function (it, i) {
    if (state.picked[i] === undefined) state.picked[i] = true;
  });

  list.innerHTML = r.items.map(function (it, i) {
    const missing = (!it.company || !it.position);
    const who = esc(it.company || '（公司名缺失）') + ' · ' + esc(it.position || '（职位名缺失）');
    return '<div class="item' + (state.picked[i] ? '' : ' off') + '" data-i="' + i + '">' +
      '<div class="line"><input type="checkbox"' + (state.picked[i] ? ' checked' : '') + ' data-i="' + i + '">' +
      '<div style="flex:1">' +
      '<div class="who">' + who + '</div>' +
      '<div class="meta"><span class="pill">' + esc(stageLabel(it.stage)) + '</span>' +
      (it.confidence === 'rule' ? '' : '<span class="pill miss">通用识别</span>') +
      (missing ? '<span class="pill miss">需补全</span>' : '') +
      (it.externalId ? '<span class="pill">ID ' + esc(it.externalId) + '</span>' : '') +
      (it.occurredAt ? '<span class="pill">' + esc(it.occurredAt) + '</span>' : '') +
      '</div>' +
      '<div class="raw">页面原文：' + esc(it.stageRaw || '—') + '</div>' +
      '</div></div></div>';
  }).join('');

  list.querySelectorAll('input[type=checkbox]').forEach(function (cb) {
    cb.addEventListener('change', function () {
      const i = cb.dataset.i;
      state.picked[i] = cb.checked;
      cb.parentNode.parentNode.classList.toggle('off', !cb.checked);
      updateCopy();
    });
  });

  toggle.disabled = false;
  toggle.textContent = '全不选';
  toggle.onclick = function () {
    const anyOn = Object.keys(state.picked).some(function (k) { return state.picked[k]; });
    Object.keys(state.picked).forEach(function (k) { state.picked[k] = !anyOn; });
    state.result.items.forEach(function (it, i) { state.picked[i] = !anyOn; });
    toggle.textContent = anyOn ? '全选' : '全不选';
    render();
  };

  copy.onclick = doCopy;
  updateCopy();
}

function updateCopy() {
  const n = Object.keys(state.picked).filter(function (k) { return state.picked[k]; }).length;
  const btn = $('#copy');
  btn.textContent = n ? '复制 JSON（' + n + ' 条）' : '复制 JSON';
  btn.disabled = !n;
}

async function doCopy() {
  const r = state.result;
  const items = r.items.filter(function (it, i) { return state.picked[i]; }).map(function (it) {
    return {
      company: it.company || '',
      position: it.position || '',
      channel: it.channel || r.channel || '',
      stage: it.stage,
      stageRaw: it.stageRaw || '',
      externalId: it.externalId || '',
      occurredAt: it.occurredAt ? it.occurredAt + 'T00:00:00+08:00' : '',
      source: 'extension'
    };
  });
  const payload = {
    schema: 'zhiyin.status-event.v1',
    exportedAt: new Date().toISOString(),
    channel: r.channel,
    pageUrl: r.url,
    mode: r.mode,
    items: items
  };
  try {
    await navigator.clipboard.writeText(JSON.stringify(payload, null, 2));
    banner('', '已复制 <b>' + items.length + '</b> 条状态事件。打开求职app → 投递中心 → 「导入状态」，粘贴即可。');
    $('#copy').textContent = '已复制';
  } catch (e) {
    banner('err', '复制失败：' + e.message + '　可改用下方文本框手动复制。<textarea style="width:100%;height:80px">' +
      esc(JSON.stringify(payload)) + '</textarea>');
  }
}

/* ---- 投递回执：抓当前这一张页面（提交成功页 / 投递详情页）---- */
async function collectReceiptFromPage() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  const tab = tabs && tabs[0];
  if (!tab || !tab.id) throw new Error('找不到当前标签页。');
  if (/^(chrome|edge|about|devtools|chrome-extension|view-source):/i.test(tab.url || '')) {
    throw new Error('浏览器内置页面不允许注入脚本。请先打开你的投递页，再点这个按钮。');
  }
  await injectBundle(tab.id);
  const injected = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: collectReceipt,
    args: [{ url: tab.url, title: tab.title }]
  });
  return injected && injected[0] ? injected[0].result : null;
}

function renderReceipt(r) {
  const bannerEl = $('#rcBanner');
  const body = $('#rcBody');
  const copy = $('#rcCopy');
  if (!r) {
    bannerEl.className = 'banner warn';
    bannerEl.innerHTML = '这一页没提取到公司名，生成不了回执。<br>请把页面切到「提交成功」或某条投递的详情页再试；' +
      '也可以直接在求职app里点「补回执」手动填。';
    body.innerHTML = '';
    copy.disabled = true;
    return;
  }
  bannerEl.className = 'banner';
  bannerEl.innerHTML = '已生成回执。核对无误后复制，回到求职app → 投递中心 → 「导入回执」粘贴。';
  const row = (k, v) => '<div class="kv"><span class="k">' + k + '</span><span class="v">' + esc(v || '—') + '</span></div>';
  body.innerHTML = row('公司', r.company) + row('岗位', r.position) + row('申请号', r.jobRef) +
    row('渠道', r.channel) + row('地址', r.url);
  copy.disabled = false;
}

function receiptPayload(r) {
  return {
    schema: 'zhiyin.receipt.v1',
    exportedAt: new Date().toISOString(),
    pageUrl: r.url,
    receipt: {
      company: r.company, position: r.position, jobRef: r.jobRef,
      url: r.url, title: r.title, at: r.at, status: r.status, channel: r.channel
    }
  };
}

async function doCopyReceipt() {
  const r = state.receipt;
  if (!r) return;
  const payload = receiptPayload(r);
  try {
    await navigator.clipboard.writeText(JSON.stringify(payload, null, 2));
    $('#rcBanner').className = 'banner';
    $('#rcBanner').innerHTML = '已复制回执。打开求职app → 投递中心 → 「导入回执」，粘贴即可。';
    $('#rcCopy').textContent = '已复制';
  } catch (e) {
    $('#rcBanner').className = 'banner err';
    $('#rcBanner').innerHTML = '复制失败：' + esc(e.message) + '　可改用下方文本框手动复制。' +
      '<textarea style="width:100%;height:80px">' + esc(JSON.stringify(payload)) + '</textarea>';
  }
}

/* ---- 辅助填写：把求职app导出的填表数据填进当前页的表单 ---- */
async function fillCurrentPage() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  const tab = tabs && tabs[0];
  if (!tab || !tab.id) throw new Error('找不到当前标签页。');
  if (/^(chrome|edge|about|devtools|chrome-extension|view-source):/i.test(tab.url || '')) {
    throw new Error('浏览器内置页面不能注入。请先打开公司官网的申请表页。');
  }
  let payload;
  try { payload = JSON.parse($('#ffInput').value); }
  catch (e) { throw new Error('JSON 解析失败：' + e.message); }
  /* v1 = 纯字段；v2 = 字段 + 结构化经历（教育/工作/项目…）。两种都收（第二十轮） */
  if (!payload || !/^zhiyin\.fill\.v[12]$/.test(payload.schema) || !payload.fields) {
    throw new Error('这不是求职app导出的填表数据（需要 schema: zhiyin.fill.v1 或 v2）。');
  }
  lastFillSections = payload.sections || null;
  const args = [{ fields: payload.fields, sections: payload.sections || null }];
  await injectBundle(tab.id);
  const injected = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: fillFromPayload,
    /* sections 也传进去：分段卡片上的「公司名称 / 项目名称」这类字段靠它补第一段 */
    args: args
  });
  const r = injected && injected[0] ? injected[0].result : null;

  /* 第二遍：检索型下拉 + 日期选择器（异步）。
     公司名称 / 学校名称 / 起止时间这类栏是受控的搜索组件，写 value 无效，
     必须"点开 → 逐字输入 → 等选项 → 点中"，天然是异步的，所以单开一遍。
     这一遍失败不影响第一遍已经填上的结果。 */
  await injectBundle(tab.id);
  let c = null;
  try {
    const inj2 = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: fillComboFields,
      args: args
    });
    c = inj2 && inj2[0] ? inj2[0].result : null;
  } catch (e) { c = null; }
  if (r && c) {
    const comboFilled = c.filled || [];
    r.combo = c;
    r.filled = (r.filled || []).concat(comboFilled);
    const done = comboFilled.map(function (f) { return f.field; });
    r.missed = (r.missed || []).filter(function (k) { return done.indexOf(k) < 0; });
  }
  return r;
}

/* ---- 表单结构探针：不改页面，只把"这张表长什么样"导出来 ---- */
async function probeCurrentPage() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  const tab = tabs && tabs[0];
  if (!tab || !tab.id) throw new Error('找不到当前标签页。');
  if (/^(chrome|edge|about|devtools|chrome-extension|view-source):/i.test(tab.url || '')) {
    throw new Error('浏览器内置页面不能注入。请先打开公司官网的申请表页。');
  }
  await injectBundle(tab.id);
  const injected = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: probeForm,
    args: []
  });
  return injected && injected[0] ? injected[0].result : null;
}

function renderProbe(p) {
  const b = $('#pbBanner');
  const body = $('#pbBody');
  const copy = $('#pbCopy');
  if (!p || !p.ok) {
    b.className = 'banner warn';
    b.innerHTML = '没读到页面结构。请确认当前页是<b>申请表页</b>，再点一次。';
    body.innerHTML = '';
    copy.disabled = true;
    return;
  }
  b.className = 'banner';
  b.innerHTML = '这一页共有 <b>' + p.controlCount + '</b> 个可填控件，其中 <b>' + p.richCount + '</b> 个是' +
    '<b>检索型 / 日期型组件</b>（就是辅助填写容易填不动的那类）。' +
    '<br>组件库：<b>' + esc(p.uiKit || p.framework) + '</b>' +
    (p.panels && p.panels.length
      ? '　当前有 <b>' + p.panels.length + '</b> 个浮层开着（面板结构已一并导出）'
      : '　<b>没有浮层开着</b> —— 如果是日期栏填不动，请先把它点开再探一次') +
    (p.dupIds && Object.keys(p.dupIds).length
      ? '<br><b>有重复 id</b>：' + esc(Object.keys(p.dupIds).join('、')) + '（label[for] 会抓错栏）'
      : '');
  /* 只把"值得看的"列出来：带组件外壳的排在前面 */
  const rich = p.rich || [];
  const rows = rich.map(function (x) {
    const lab = Object.keys(x.label).length ? Object.keys(x.label).map(function (k) { return k + '=' + x.label[k]; }).join('　') : '（没找到任何标签文本）';
    const wrap = x.wrapper ? x.wrapper.sel + ' @' + (x.wrapper.cls || '(无class)') : '（无组件外壳）';
    const guess = x.guess
      ? '探针判读：<b>' + esc(x.guess.text) + '</b>（依据 ' + esc(x.guess.from) + '）'
      : '<b>探针认不出这栏叫什么</b>' + (x.labels && x.labels.length ? '（候选：' + esc(x.labels.join(' | ')) + '）' : '');
    return '<div class="item"><div class="who">' + esc(lab) + '</div>' +
      '<div class="meta">' + esc(x.tag + '/' + x.type) +
      (x.sect ? '　栏目：' + esc(x.sect) : '') + '　第 ' + (Number(x.block) + 1) + ' 段' +
      '　组件：' + esc(wrap) +
      (x.hasPopup ? '　aria-haspopup=' + esc(x.hasPopup) : '') +
      (x.readOnly ? '　<b>只读</b>' : '') +
      (x.optionCount ? '　选项 ' + x.optionCount + ' 个' : '') + '</div>' +
      '<div class="raw">' + guess + '</div>' +
      (x.optionsSample && x.optionsSample.length ? '<div class="raw">选项样例：' + esc(x.optionsSample.join(' / ')) + '</div>' : '') +
      '</div>';
  }).join('');
  const panelRows = (p.panels || []).map(function (pn) {
    return '<div class="item"><div class="who">浮层：' + esc(pn.cls || '(无class)') + (pn.role ? '　role=' + esc(pn.role) : '') + '</div>' +
      (pn.nodeCls && pn.nodeCls.length ? '<div class="meta">节点 class：' + esc(pn.nodeCls.join(' / ')) + '</div>' : '') +
      (pn.nodes && pn.nodes.length ? '<div class="raw">可点节点样例：' + esc(pn.nodes.join(' / ')) + '</div>' : '') +
      '</div>';
  }).join('');
  body.innerHTML = (rich.length
    ? '<div style="font-size:11px;color:#666;line-height:1.6;margin:8px 0 4px">下面这些就是"标签写在哪儿、用的是什么组件"：</div>' + rows
    : '<div class="item"><div class="who">这一页没有检测到检索型 / 日期型组件</div><div class="meta">说明填不上的原因在别处，把整份 JSON 发我看看</div></div>') +
    (panelRows ? '<div style="font-size:11px;color:#666;line-height:1.6;margin:10px 0 4px">当前开着的浮层（日期 / 下拉面板的长相）：</div>' + panelRows : '');
  copy.disabled = false;
  copy.textContent = '复制结构 JSON';
}

async function doCopyProbe() {
  const p = state.probe;
  if (!p) return;
  try {
    await navigator.clipboard.writeText(JSON.stringify(p, null, 2));
    $('#pbBanner').className = 'banner';
    $('#pbBanner').innerHTML = '已复制页面结构。<b>把这段贴给我</b>，我就能针对这一页的组件写适配，不用继续猜。';
    $('#pbCopy').textContent = '已复制';
  } catch (e) {
    $('#pbBanner').className = 'banner err';
    $('#pbBanner').innerHTML = '复制失败：' + esc(e.message) + '　可改用下方文本框手动复制。' +
      '<textarea style="width:100%;height:80px">' + esc(JSON.stringify(p)) + '</textarea>';
  }
}

function bindProbe() {
  $('#pbGo').onclick = async function () {
    const b = $('#pbBanner');
    b.className = 'banner';
    b.textContent = '正在读取这一页的表单结构…';
    $('#pbCopy').disabled = true;
    try {
      state.probe = await probeCurrentPage();
      renderProbe(state.probe);
    } catch (e) {
      b.className = 'banner err';
      b.innerHTML = '探测失败：' + esc(e.message);
    }
  };
  $('#pbCopy').onclick = doCopyProbe;
}


/* ---- v2 载荷的结构化经历：面板列出 + 逐条复制。
   官网「添加一段」按钮结构各不相同不代点，由用户对照粘贴（第二十轮） ---- */
let lastFillSections = null;
const SEC_TITLES = { education: '教育经历', work: '工作/实习', projects: '项目经历', language: '语言水平', campus: '校园经历', honors: '荣誉', certs: '证书', papers: '论文' };
function secItemText(kind, it) {
  it = it || {};
  if (kind === 'education') return [it.school, it.major, it.degree, it.time, it.gpa ? 'GPA ' + it.gpa : ''].filter(Boolean).join('｜') + (it.courses ? '\n主修课程：' + it.courses : '');
  if (kind === 'work') return [it.company, it.role, it.time].filter(Boolean).join('｜') + ((it.bullets || []).length ? '\n' + it.bullets.map(function (b) { return '· ' + b; }).join('\n') : '');
  if (kind === 'projects') return [it.name, it.role, it.time].filter(Boolean).join('｜') + (it.description ? '\n' + it.description : '') + ((it.duties || []).length ? '\n' + it.duties.map(function (b) { return '· ' + b; }).join('\n') : '');
  if (kind === 'language') return [it.type, it.level].filter(Boolean).join('：');
  return it.name || it.title || '';
}
function renderFillSections(sections) {
  const box = document.getElementById('ffSections');
  if (!box) return;
  if (!sections) { box.innerHTML = ''; return; }
  let html = '', any = false;
  Object.keys(SEC_TITLES).forEach(function (k) {
    const arr = sections[k];
    if (!arr || !arr.length) return;
    any = true;
    html += '<div style="margin-top:10px">' +
      '<div style="display:flex;align-items:center;gap:6px;margin-bottom:3px">' +
      '<div style="font-weight:600;font-size:12px;flex:1">' + SEC_TITLES[k] + ' · ' + arr.length + ' 段</div>' +
      '<button data-ffall="' + k + '" style="font-size:11px;padding:2px 8px;border:1px solid #d0d5dd;border-radius:6px;background:#fff;cursor:pointer">复制全部</button>' +
      '</div>';
    arr.forEach(function (it, i) {
      const txt = esc(secItemText(k, it)).replace(/\n/g, '<br>');
      html += '<div style="display:flex;gap:6px;align-items:flex-start;margin-bottom:4px">' +
        '<div style="flex:1;font-size:11px;line-height:1.5;background:#f6f7f9;border:1px solid #e3e6ea;border-radius:6px;padding:4px 6px">' + txt + '</div>' +
        '<button data-ffsec="' + k + '|' + i + '" style="flex:0 0 auto;font-size:11px;padding:2px 8px;border:1px solid #d0d5dd;border-radius:6px;background:#fff;cursor:pointer">复制</button></div>';
    });
    html += '</div>';
  });
  box.innerHTML = any ? ('<div style="margin-top:10px;font-size:11px;color:#666;line-height:1.6">' +
    '官网的「教育经历 / 项目经历」是分段卡片：点它自己的「添加一段」，再把下面某一段粘进去。' +
    '扩展不会替你点「添加」（各家按钮结构不同，点错了会填乱），也不替你点提交。</div>' + html) : '';
  if (any) {
    box.querySelectorAll('button[data-ffsec]').forEach(function (btn) {
      btn.onclick = function () {
        const parts = btn.getAttribute('data-ffsec').split('|');
        const it = sections[parts[0]][+parts[1]];
        copyText(secItemText(parts[0], it), btn);
      };
    });
    box.querySelectorAll('button[data-ffall]').forEach(function (btn) {
      btn.onclick = function () {
        const k = btn.getAttribute('data-ffall');
        copyText(secAllText(k, sections[k]), btn);
      };
    });
  }
}

/* 复制一段文本；剪贴板不可用时降级成「选中让你自己 Ctrl+C」 */
function copyText(text, btn) {
  const done = function () {
    const old = btn.textContent;
    btn.textContent = '已复制';
    setTimeout(function () { btn.textContent = old; }, 1200);
  };
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(done, function () { btn.textContent = '复制失败'; });
    return;
  }
  const ta = document.createElement('textarea');
  ta.value = text;
  document.body.appendChild(ta);
  ta.select();
  try { document.execCommand('copy'); done(); } catch (e) { btn.textContent = '复制失败'; }
  document.body.removeChild(ta);
}

const FF_NAMES = {
  name: '姓名', phone: '手机号', email: '邮箱', school: '毕业院校', major: '专业',
  edu: '学历', gpa: 'GPA', gradYear: '毕业时间', skills: '技能', intro: '自我介绍',
  company: '公司名称', role: '职位名称', projName: '项目名称', projDesc: '项目描述',
  workDesc: '工作内容', gradEnd: '就读起止'
};

/* 整段文本：一键复制「这一段全部」——多段经历里一段一段点太慢 */
function secAllText(kind, arr) {
  return (arr || []).map(function (it, i) {
    return (arr.length > 1 ? '第 ' + (i + 1) + ' 段\n' : '') + secItemText(kind, it);
  }).join('\n\n');
}

function bindFill() {
  $('#ffFill').onclick = async function () {
    const b = $('#ffBanner');
    b.className = 'banner';
    b.textContent = '正在填充当前页…';
    try {
      const r = await fillCurrentPage();
      if (!r || !r.ok) throw new Error((r && r.error) || '页面没有返回结果。');
      if (!r.filled.length) {
        b.className = 'banner warn';
        b.innerHTML = '一个字段都没填上。请确认当前页是<b>公司官网的申请表</b>（有姓名、邮箱这类输入框），而不是职位列表页。';
        return;
      }
      /* 第一遍和第二遍可能都"填过"同一个栏（下拉的内层 input 第一遍也写过值）——
         汇报时按字段名去重，别让用户以为填了两遍 */
      const gotSet = [];
      r.filled.forEach(function (f) { if (gotSet.indexOf(f.field) < 0) gotSet.push(f.field); });
      const got = gotSet.map(function (k) { return FF_NAMES[k] || k; }).join('、');
      const miss = r.missed.length
        ? '<br>没找到对应输入框的：' + r.missed.map(function (k) { return FF_NAMES[k] || k; }).join('、') + '（请手动填）'
        : '';
      /* 第二遍（检索型下拉 / 日期）单独汇报：填上了什么、没填上的原因 */
      const comboFilled = (r.combo && r.combo.filled) || [];
      const comboMissed = (r.combo && r.combo.missed) || [];
      const comboLine = (comboFilled.length || comboMissed.length)
        ? '<br><b>检索型 / 日期栏</b>：填上 ' + comboFilled.length + ' 个' +
          (comboFilled.length ? '（' + esc(comboFilled.map(function (f) { return (FF_NAMES[f.field] || f.field) + '→' + (f.shown || f.value || ''); }).join('；')) + '）' : '') +
          (comboMissed.length
            ? '<br>没填上的：' + esc(comboMissed.map(function (f) { return (FF_NAMES[f.field] || f.field) + '（' + f.reason + '）'; }).join('；')) +
              '<br><b>这类栏需要针对性适配</b> —— 请到下面「探测表单结构」复制一份结构发我'
            : '')
        : '';
      /* 该说的都说清：为什么不填（敏感栏/文件），以及需要你手动补一下的地方 */
      const skippedLine = (r.skipped && r.skipped.length)
        ? '<br><b>我没动这几类栏（也不该动）</b>：' +
          esc(r.skipped.map(function (s) { return (s.label || s.field) + '（' + s.reason + '）'; }).join('；'))
        : '';
      const notices = (r.notice || []).concat((r.combo && r.combo.notice) || []);
      const noticeLine = notices.length
        ? '<br>' + esc(notices.join('；'))
        : '';
      b.className = 'banner';
      b.innerHTML = '已填 <b>' + gotSet.length + '</b> 个字段：' + esc(got) + '。' + miss + comboLine + noticeLine + skippedLine +
        (r.custom && r.custom.used ? '<br><b>本岗改写文案已填入「' + esc(r.custom.where || '描述') + '」栏</b>（' + r.custom.bullets + ' 条，' +
          '其中的 [N] 是提醒你补真实数字的占位符，提交前记得改掉）—— 只有这一栏用定制版，其余描述栏用简历原文。' : '') +
        (lastFillSections ? '<br><b>教育 / 工作 / 项目</b>这类分段内容不在这一层的输入框里时——下方已列出，' +
          '请在官网点它自己的「添加一段」后逐段粘贴（见下方每一段的「复制」按钮）。' : '') +
        '<br><b>请逐项核对后亲手点提交</b>——扩展不会替你提交。';
      renderFillSections(lastFillSections);
    } catch (e) {
      renderFillSections(null);
      b.className = 'banner err';
      b.innerHTML = '填充失败：' + esc(e.message);
    }
  };
}

/* ---- 职位采集：把当前职位列表页的岗位收进匹配池 ---- */
async function collectJobsFromPage() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  const tab = tabs && tabs[0];
  if (!tab || !tab.id) throw new Error('找不到当前标签页。');
  if (/^(chrome|edge|about|devtools|chrome-extension|view-source):/i.test(tab.url || '')) {
    throw new Error('浏览器内置页面不允许注入。请先打开职位列表页，再点这个按钮。');
  }
  await injectBundle(tab.id);
  const injected = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: collectJobs,
    args: [{ url: tab.url }]
  });
  return injected && injected[0] ? injected[0].result : null;
}

async function collectProgramsFromPage() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  const tab = tabs && tabs[0];
  if (!tab || !tab.id) throw new Error('找不到当前标签页。');
  if (/^(chrome|edge|about|devtools|chrome-extension|view-source):/i.test(tab.url || '')) {
    throw new Error('浏览器内置页面不允许注入。请先打开院校项目页，再点这个按钮。');
  }
  await injectBundle(tab.id);
  const injected = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: collectPrograms,
    args: [{ url: tab.url }]
  });
  return injected && injected[0] ? injected[0].result : null;
}

function renderProgram(r) {
  const b = $('#pgBanner');
  const list = $('#pgBody');
  const copy = $('#pgCopy');
  if (!r || !r.ok || !r.items.length) {
    b.className = 'banner warn';
    b.innerHTML = (r && r.error) ? esc(r.error) : '这一页没识别到项目。请确认打开的是<b>项目详情页</b>，或<b>FindaPhD / 爱丁堡等带项目卡片的列表页</b>。';
    list.innerHTML = '';
    copy.disabled = true;
    return;
  }
  const isList = r.items.length > 1;
  b.className = 'banner';
  b.innerHTML = (isList ? '本页是项目列表页，识别到 <b>' + r.items.length + '</b> 个项目' : '已识别项目') +
    (r.schoolFallback ? '（按站点推断为「' + esc(r.schoolFallback) + '」）' : '') +
    '。勾掉不想要的，复制后到求职app → 申学规划 → 「导入院校项目」粘贴入库。';

  if (isList) {
    /* 多项目：仿 renderJobs 的勾选列表 */
    state.programPicked = state.programPicked || {};
    r.items.forEach(function (it, i) { if (state.programPicked[i] === undefined) state.programPicked[i] = true; });
    list.innerHTML = r.items.map(function (it, i) {
      const meta = [it.region, it.deadline, it.fund].filter(Boolean).join(' · ');
      const note = (it.note || '').slice(0, 120);
      return '<div class="item' + (state.programPicked[i] ? '' : ' off') + '" data-pi="' + i + '">' +
        '<div class="line"><input type="checkbox"' + (state.programPicked[i] ? ' checked' : '') + ' data-pi="' + i + '">' +
        '<div style="flex:1"><div class="who">' + esc(it.program) + '</div>' +
        '<div class="meta">' + esc(meta || '—') + '</div>' +
        (note ? '<div class="meta" style="margin-top:2px">' + esc(note) + '</div>' : '') +
        '</div></div></div>';
    }).join('');
    list.querySelectorAll('input[type=checkbox]').forEach(function (cb) {
      cb.addEventListener('change', function () {
        state.programPicked[cb.dataset.pi] = cb.checked;
        cb.parentNode.parentNode.classList.toggle('off', !cb.checked);
        updateProgramCopy();
      });
    });
    copy.disabled = false;
    updateProgramCopy();
    return;
  }

  /* 单项目：原有 KV 详情展示 */
  const it = r.items[0];
  const lang = (it.toefl || it.ielts)
    ? 'TOEFL ' + (it.toefl || '—') + ' / IELTS ' + (it.ielts || '—')
    : '—';
  const rows = [
    ['校名', it.school],
    ['项目', it.program],
    ['地区', it.region || '—'],
    ['方向', it.field || '—'],
    ['截止', it.deadline || '—'],
    ['资助', it.fund || '—'],
    ['语言', lang],
    ['论文', it.papers ? it.papers + ' 篇' : '—'],
    ['入口', it.applyUrl || '—'],
    ['备注', it.note || '—']
  ].map(function (kv) {
    return '<div class="kv"><div class="k">' + esc(kv[0]) + '</div><div class="v">' + esc(String(kv[1])) + '</div></div>';
  }).join('');
  list.innerHTML = '<div class="item">' + rows + '</div>';
  copy.disabled = false;
  copy.textContent = '复制项目 JSON';
}

function updateProgramCopy() {
  const r = state.program;
  if (!r || !r.items.length) { $('#pgCopy').textContent = '复制项目 JSON'; $('#pgCopy').disabled = true; return; }
  if (r.items.length === 1) { $('#pgCopy').textContent = '复制项目 JSON'; $('#pgCopy').disabled = false; return; }
  const n = Object.keys(state.programPicked || {}).filter(function (k) { return state.programPicked[k]; }).length;
  $('#pgCopy').textContent = n ? '复制项目 JSON（' + n + ' 条）' : '复制项目 JSON';
  $('#pgCopy').disabled = !n;
}

async function doCopyProgram() {
  const r = state.program;
  if (!r || !r.ok || !r.items.length) return;
  /* 列表模式：只复制用户勾选上的；单项目模式：全量复制。 */
  const items = r.items.length > 1
    ? r.items.filter(function (it, i) { return state.programPicked[i]; })
    : r.items;
  if (!items.length) return;
  const payload = { schema: 'zhiyin.programs.v1', items: items, url: r.url, source: 'extension' };
  await navigator.clipboard.writeText(JSON.stringify(payload, null, 2));
  const c = $('#pgCopy');
  c.textContent = '已复制';
  setTimeout(function () { c.textContent = r.items.length > 1 ? '复制项目 JSON' : '复制项目 JSON'; }, 1200);
}

function bindPrograms() {
  $('#pgGo').onclick = async function () {
    const b = $('#pgBanner');
    b.className = 'banner';
    b.textContent = '正在读取当前页…';
    $('#pgCopy').disabled = true;
    state.programPicked = {};
    try {
      state.program = await collectProgramsFromPage();
      renderProgram(state.program);
    } catch (e) {
      b.className = 'banner err';
      b.innerHTML = '采集失败：' + esc(e.message);
    }
  };
  $('#pgCopy').onclick = doCopyProgram;
}

function renderJobs(r) {
  const b = $('#jbBanner');
  const list = $('#jbList');
  const copy = $('#jbCopy');
  if (!r || !r.ok || !r.items.length) {
    b.className = 'banner warn';
    b.innerHTML = '这一页没识别到职位卡片。请先确认打开的是<b>职位列表页</b>（一排排岗位的那种），' +
      '不是投递记录页 / 职位详情页 / 招聘首页。若确实是列表页却仍为 0，多半是页面结构特殊——' +
      '在第一条职位上右键 →「检查」，把那段 HTML 发我补规则。';
    list.innerHTML = '';
    copy.disabled = true;
    return;
  }
  b.className = 'banner';
  b.innerHTML = '识别到 <b>' + r.items.length + '</b> 个职位' +
    (r.companyFallback ? '（本页没有公司名字段，已按站点推断为「' + esc(r.companyFallback) + '」）' : '') +
    '。勾掉不想要的，复制后到求职app → 求职匹配 → 「导入职位」粘贴。';
  r.items.forEach(function (it, i) { if (state.jobPicked[i] === undefined) state.jobPicked[i] = true; });
  list.innerHTML = r.items.map(function (it, i) {
    const meta = [it.city, it.edu, it.salaryRaw].filter(Boolean).join(' · ');
    const sk = (it.skills || []).slice(0, 4).map(s => '<span class="pill">' + esc(s) + '</span>').join('');
    return '<div class="item' + (state.jobPicked[i] ? '' : ' off') + '" data-ji="' + i + '">' +
      '<div class="line"><input type="checkbox"' + (state.jobPicked[i] ? ' checked' : '') + ' data-ji="' + i + '">' +
      '<div style="flex:1"><div class="who">' + esc(it.company) + ' · ' + esc(it.position) + '</div>' +
      '<div class="meta">' + esc(meta || '—') + '</div>' +
      (sk ? '<div class="meta" style="margin-top:2px">' + sk + '</div>' : '') +
      '</div></div></div>';
  }).join('');
  list.querySelectorAll('input[type=checkbox]').forEach(function (cb) {
    cb.addEventListener('change', function () {
      state.jobPicked[cb.dataset.ji] = cb.checked;
      cb.parentNode.parentNode.classList.toggle('off', !cb.checked);
      updateJobCopy();
    });
  });
  copy.disabled = false;
  updateJobCopy();
}

function updateJobCopy() {
  const n = Object.keys(state.jobPicked).filter(k => state.jobPicked[k]).length;
  $('#jbCopy').textContent = n ? '复制职位 JSON（' + n + ' 个）' : '复制职位 JSON';
}

async function doCopyJobs() {
  const r = state.jobs;
  if (!r) return;
  const items = r.items.filter(function (it, i) { return state.jobPicked[i]; }).map(function (it) {
    return {
      company: it.company, position: it.position, city: it.city || '', edu: it.edu || '',
      salaryRaw: it.salaryRaw || '', skills: it.skills || [], url: it.url || '', channel: 'extension'
    };
  });
  const payload = { schema: 'zhiyin.jobs.v1', exportedAt: new Date().toISOString(), pageUrl: r.url, items: items };
  try {
    await navigator.clipboard.writeText(JSON.stringify(payload, null, 2));
    $('#jbBanner').className = 'banner';
    $('#jbBanner').innerHTML = '已复制 <b>' + items.length + '</b> 个职位。打开求职app → 求职匹配 → 「导入职位」，粘贴即可。';
    $('#jbCopy').textContent = '已复制';
  } catch (e) {
    $('#jbBanner').className = 'banner err';
    $('#jbBanner').innerHTML = '复制失败：' + esc(e.message) + '　可改用下方文本框手动复制。<textarea style="width:100%;height:80px">' +
      esc(JSON.stringify(payload)) + '</textarea>';
  }
}

function bindJobs() {
  $('#jbGo').onclick = async function () {
    const b = $('#jbBanner');
    b.className = 'banner';
    b.textContent = '正在读取当前页…';
    $('#jbCopy').disabled = true;
    state.jobPicked = {};
    try {
      state.jobs = await collectJobsFromPage();
      renderJobs(state.jobs);
    } catch (e) {
      b.className = 'banner err';
      b.innerHTML = '采集失败：' + esc(e.message);
    }
  };
  $('#jbCopy').onclick = doCopyJobs;
}

(async function boot() {
  /* 回执与辅助填写按钮先绑定：即使状态采集失败，这两个功能也要能用（三者互不依赖）。 */
  $('#rcMake').onclick = async function () {
    $('#rcBanner').className = 'banner';
    $('#rcBanner').textContent = '正在读取当前页面…';
    $('#rcCopy').disabled = true;
    try {
      state.receipt = await collectReceiptFromPage();
      renderReceipt(state.receipt);
    } catch (e) {
      $('#rcBanner').className = 'banner err';
      $('#rcBanner').innerHTML = '生成失败：' + esc(e.message);
    }
  };
  $('#rcCopy').onclick = doCopyReceipt;
  bindFill();
  bindJobs();
  bindPrograms();
  bindProbe();

  try {
    const res = await fetch(chrome.runtime.getURL('rules.json'));
    state.rules = await res.json();
  } catch (e) {
    banner('err', '读取 rules.json 失败：' + e.message);
    return;
  }
  try {
    state.result = await collect();
  } catch (e) {
    banner('err', '采集失败：' + e.message);
    return;
  }
  render();
})();
