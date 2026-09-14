/* ============================================================
   职引 · 页面采集核心
   collectFromPage(opts) —— 自包含纯函数。

   为什么必须自包含：它会被 chrome.scripting.executeScript({func}) 序列化后
   注入到目标页面执行，序列化只带函数体，任何对外部变量的引用都会在页面里变成 undefined。
   好处是同一个函数也能在 Node + jsdom 里直接调用做测试（见 采集自测）。

   设计原则：只读、不请求、不改页面、不写 cookie。
   读的是「用户当前已经打开、已经渲染出来的文字」，不发起任何网络请求。
   ============================================================ */
function collectFromPage(opts) {
  var o = opts || {};
  var rules = o.rules || [];
  var stages = o.stages || [];
  var options = o.options || {};
  var pageUrl = o.url || (typeof location !== 'undefined' ? location.href : '');
  var pageTitle = o.title || (typeof document !== 'undefined' ? document.title : '');
  var maxItems = options.maxItems || 50;
  var minLen = options.minTextLen || 2;
  var maxLen = options.maxTextLen || 24;

  var SKIP_TAGS = { SCRIPT: 1, STYLE: 1, NOSCRIPT: 1, TEMPLATE: 1, SVG: 1, IFRAME: 1 };
  var POS_SUFFIX = /(工程师|开发|经理|分析师|研究员|专员|顾问|设计师|运营|产品|算法|测试|实习|管培|主管|架构师|科学家|总监|负责人|助理)/;
  var CO_SUFFIX = /(有限公司|股份有限公司|集团|银行|证券|科技|网络|研究院|事务所|事业部)$/;

  var SITES = [
    { key: 'zhipin.com', name: 'BOSS直聘' },
    { key: 'nowcoder.com', name: '牛客' },
    { key: 'zhaopin.com', name: '智联招聘' },
    { key: '51job.com', name: '前程无忧' },
    { key: 'liepin.com', name: '猎聘' },
    { key: 'lagou.com', name: '拉勾' },
    { key: 'shixiseng.com', name: '实习僧' },
    { key: 'linkedin.com', name: '领英' },
    { key: 'bytedance.com', name: '字节跳动官网' },
    { key: 'tencent.com', name: '腾讯官网' },
    { key: 'alibaba.com', name: '阿里巴巴官网' },
    { key: 'jd.com', name: '京东官网' },
    { key: 'meituan.com', name: '美团官网' },
    { key: 'baidu.com', name: '百度官网' },
    { key: 'huawei.com', name: '华为官网' },
    { key: 'xiaohongshu.com', name: '小红书官网' },
    { key: 'kuaishou.com', name: '快手官网' },
    { key: 'didiglobal.com', name: '滴滴官网' },
    { key: 'netease.com', name: '网易官网' }
  ];

  /* 用 textContent 而不是 innerText：innerText 会触发页面重排，且 jsdom 里不存在。
     子树文本读一次就缓存，避免嵌套遍历时反复读整棵子树。 */
  var CACHE = (typeof WeakMap !== 'undefined') ? new WeakMap() : null;
  function textOf(el) {
    if (!el) return '';
    if (CACHE && CACHE.has(el)) return CACHE.get(el);
    var t = String(el.textContent == null ? '' : el.textContent).replace(/[\s\u00a0]+/g, ' ').trim();
    if (CACHE) CACHE.set(el, t);
    return t;
  }
  function clean(s) { return String(s == null ? '' : s).replace(/[\s\u00a0]+/g, ' ').trim(); }
  function pad(n) { return String(n).length < 2 ? '0' + n : String(n); }
  function usable(el) { return el && !SKIP_TAGS[el.tagName]; }

  /* stageRaw -> 统一阶段。stages 的顺序即优先级：
     先判「已结束」「Offer」这类终局状态，再判具体面试轮次，最后才是泛化词。 */
  function classify(raw) {
    var t = clean(raw).toLowerCase();
    if (!t) return null;
    for (var i = 0; i < stages.length; i++) {
      var g = stages[i];
      for (var j = 0; j < g.kws.length; j++) {
        if (t.indexOf(String(g.kws[j]).toLowerCase()) >= 0) {
          return { stage: g.stage, label: g.label, kw: g.kws[j] };
        }
      }
    }
    return null;
  }

  function siteName(url) {
    var u = String(url || '').toLowerCase();
    for (var i = 0; i < SITES.length; i++) {
      if (u.indexOf(SITES[i].key) >= 0) return SITES[i].name;
    }
    return '官网直投';
  }

  function normDate(s) {
    var m = /(20\d{2})\s*[-/.年]\s*(\d{1,2})\s*[-/.月]\s*(\d{1,2})/.exec(String(s || ''));
    if (!m) return '';
    return m[1] + '-' + pad(m[2]) + '-' + pad(m[3]);
  }

  function leaves(root) {
    var out = [];
    var all = root.querySelectorAll('*');
    for (var i = 0; i < all.length; i++) {
      var e = all[i];
      if (!usable(e) || e.children.length > 0) continue;
      var t = textOf(e);
      if (t.length < minLen || t.length > maxLen) continue;
      out.push({ el: e, text: t });
    }
    return out;
  }

  function pickPosition(root) {
    var best = '';
    var all = root.querySelectorAll('*');
    for (var i = 0; i < all.length; i++) {
      var e = all[i];
      if (!usable(e) || e.children.length > 0) continue;
      var t = textOf(e);
      if (t.length >= 2 && t.length <= 32 && POS_SUFFIX.test(t) && t.length > best.length) best = t;
    }
    return best;
  }

  /* 从状态词所在的元素向上找「这块儿属于哪条投递」：
     一直往上，直到这个容器里能看出职位名，或文本量超出单条卡片的合理范围。 */
  function cardOf(el) {
    var node = el;
    var best = el.parentElement || el;
    for (var i = 0; i < 7 && node && node.parentElement; i++) {
      node = node.parentElement;
      if (!node || node === document.body) break;
      if (textOf(node).length > 320) break;
      best = node;
      if (pickPosition(node)) return node;
    }
    return best;
  }

  function pickCompany(root) {
    var i, t;
    var byClass = root.querySelectorAll('[class*=compan],[class*=comp-],[id*=compan],[class*=corp],[class*=enterprise],[class*=brand]');
    for (i = 0; i < byClass.length; i++) {
      t = textOf(byClass[i]);
      if (t && t.length >= 2 && t.length <= 24 && !POS_SUFFIX.test(t)) return t;
    }
    var all = root.querySelectorAll('*');
    for (i = 0; i < all.length; i++) {
      var e = all[i];
      if (!usable(e) || e.children.length > 0) continue;
      t = textOf(e);
      if (t && t.length >= 2 && t.length <= 24 && CO_SUFFIX.test(t)) return t;
    }
    var m = /^(.{2,20}?)[\s\-_|·]/.exec(clean(pageTitle));
    if (m && m[1] && !/招聘|投递|申请|我的/.test(m[1])) return m[1];
    return '';
  }

  var ID_ATTRS = ['data-application-id', 'data-job-id', 'data-jobid', 'data-id', 'data-key', 'data-row-key'];
  /* 注意：querySelector 不会匹配元素自身，所以容器自己带 data-id 时必须单独取一次，
     否则「列表项本身就是带 id 的元素」这种很常见的结构会拿不到申请号。 */
  function selfId(el) {
    if (!el || !el.getAttribute) return '';
    for (var i = 0; i < ID_ATTRS.length; i++) {
      var v = el.getAttribute(ID_ATTRS[i]);
      if (v) return clean(v);
    }
    return '';
  }
  function pickId(root) {
    var own = selfId(root);
    if (own) return own;
    var els = root.querySelectorAll('[data-id],[data-application-id],[data-job-id],[data-jobid],[data-key],[data-row-key]');
    for (var i = 0; i < els.length; i++) {
      var v = selfId(els[i]);
      if (v) return v;
    }
    var link = root.querySelector('a[href]');
    var m = link && /(?:id=|jobId=|positionId=)(\d{4,})/.exec(link.getAttribute('href') || '');
    return m ? m[1] : '';
  }

  /* ---- 路线一：命中精确规则（用户校准过选择器的站点） ---- */
  function byRule() {
    for (var i = 0; i < rules.length; i++) {
      var r = rules[i];
      if (!r || !r.itemSelector) continue;
      var hit = !r.match || !r.match.length;
      for (var k = 0; k < (r.match || []).length; k++) {
        if (pageUrl.indexOf(r.match[k]) >= 0) { hit = true; break; }
      }
      if (!hit) continue;

      var nodes = document.querySelectorAll(r.itemSelector);
      if (!nodes.length) continue;
      var f = r.fields || {};
      var out = [];
      for (var n = 0; n < nodes.length && out.length < maxItems; n++) {
        var c = nodes[n];
        function txt(sel) { var t = sel && c.querySelector(sel); return t ? textOf(t) : ''; }
        var idEl = f.externalId ? c.querySelector(f.externalId) : null;
        var raw = txt(f.stageRaw) || textOf(c);
        var cls = classify(raw);
        if (!cls) continue;
        out.push({
          company: txt(f.company),
          position: txt(f.position),
          stage: cls.stage,
          stageRaw: clean(raw).slice(0, 40),
          externalId: (idEl ? selfId(idEl) : '') || selfId(c) || pickId(c),
          occurredAt: normDate(txt(f.occurredAt) || textOf(c)),
          confidence: 'rule',
          ruleId: r.id || ''
        });
      }
      if (out.length) return out;
    }
    return [];
  }

  /* ---- 路线二：启发式。页面改版、或还没写规则时靠它兜底 ---- */
  function byHeuristic() {
    var list = leaves(document.body);
    var out = [];
    var seen = {};
    for (var i = 0; i < list.length && out.length < maxItems; i++) {
      var cls = classify(list[i].text);
      if (!cls) continue;
      var card = cardOf(list[i].el);
      var position = pickPosition(card);
      var company = pickCompany(card);
      var key = (company || '') + '|' + (position || '') + '|' + cls.stage;
      if (seen[key]) continue;
      seen[key] = 1;
      out.push({
        company: company,
        position: position,
        stage: cls.stage,
        stageRaw: list[i].text,
        externalId: pickId(card),
        occurredAt: normDate(textOf(card)),
        confidence: 'heuristic',
        ruleId: ''
      });
    }
    return out;
  }

  var items = byRule();
  var mode = 'rule';
  if (!items.length) { items = byHeuristic(); mode = 'heuristic'; }

  for (var x = 0; x < items.length; x++) {
    items[x].channel = siteName(pageUrl);
    items[x].source = 'extension';
    items[x].evidence = { url: pageUrl, pageTitle: pageTitle };
  }

  return {
    mode: mode,
    url: pageUrl,
    pageTitle: pageTitle,
    channel: siteName(pageUrl),
    count: items.length,
    items: items
  };
}

/* ============================================================
   职引 · 投递回执采集
   collectReceipt(opts) —— 同样是自包含纯函数。

   和 collectFromPage 的分工：
     collectFromPage = 在你的「投递记录列表页」上，一次抓多条**状态**（过程数据）；
     collectReceipt  = 在你此刻停留的**这一张页面**上，抓一张**回执**（提交凭证）——
                       典型是「提交成功页」，或某一条投递的详情页。

   它只读当前已渲染的文字与地址栏，不请求、不改页面。
   拿不到公司名就返回 null —— 凭证宁可让用户手填，也不编造一条。
   ============================================================ */
function collectReceipt(opts) {
  var o = opts || {};
  var doc = (typeof document !== 'undefined') ? document : null;
  if (!doc) return null;
  var pageUrl = o.url || (typeof location !== 'undefined' ? location.href : '');
  var pageTitle = o.title || doc.title || '';

  function clean(s) { return String(s == null ? '' : s).replace(/[\s\u00a0]+/g, ' ').trim(); }
  function metaOf(name) {
    var m = doc.querySelector('meta[property="' + name + '"], meta[name="' + name + '"]');
    return m ? clean(m.getAttribute('content')) : '';
  }

  /* 招聘平台识别 —— 决定这张回执的「渠道」。只按域名静态判断，不发请求。 */
  var SITES = [
    { key: 'zhipin.com', name: 'BOSS直聘' }, { key: 'nowcoder.com', name: '牛客' },
    { key: 'zhaopin.com', name: '智联招聘' }, { key: '51job.com', name: '前程无忧' },
    { key: 'liepin.com', name: '猎聘' }, { key: 'lagou.com', name: '拉勾' },
    { key: 'linkedin.com', name: '领英' }, { key: 'shixiseng.com', name: '实习僧' }
  ];
  var channel = '官网直投';
  for (var s = 0; s < SITES.length; s++) {
    if (pageUrl.indexOf(SITES[s].key) >= 0) { channel = SITES[s].name; break; }
  }

  /* 申请号：页面上明确写出的优先；没有再从 URL 参数里认。 */
  var jobRef = '';
  var bodyText = clean(doc.body ? doc.body.textContent : '');
  var refM = /(?:申请(?:编|序)?号|应聘(?:编|序)?号|简历编号|投递编号|报名号)\s*[:：]?\s*([A-Za-z0-9\-_]{4,})/.exec(bodyText);
  if (refM) jobRef = refM[1];
  if (!jobRef) {
    var KEYS = ['applicationId', 'application_id', 'applyId', 'appId', 'jobId', 'job_id', 'positionId', 'postId', 'id'];
    for (var k = 0; k < KEYS.length && !jobRef; k++) {
      var mm = new RegExp('[?&]' + KEYS[k] + '=([^&#]+)', 'i').exec(String(pageUrl));
      if (mm) jobRef = decodeURIComponent(mm[1]);
    }
  }

  /* 公司名与岗位名：先用标题拆（「岗位 - 公司」很常见），再用 og:site_name 兜底公司。 */
  var company = metaOf('og:site_name');
  var position = '';
  var parts = String(pageTitle).split(/\s*[-|｜·—]\s*/).map(clean).filter(Boolean);
  if (parts.length >= 2) { position = parts[0]; if (!company) company = parts[1]; }
  else if (parts.length === 1) { position = parts[0]; }

  var h1 = doc.querySelector('h1');
  if (h1 && clean(h1.textContent) && clean(h1.textContent).length <= 40) position = clean(h1.textContent);

  /* 公司名兜底（两趟）：
     第一趟找「明确标注为公司」的元素（class 里带 company）—— 这类不必要求后缀匹配，
     因为「美团」「小红书」这种公司名本来就不带「有限公司」；
     第二趟再退到通用标题里找「像公司名」的（以 有限公司 / 集团 / 银行 等结尾）。 */
  if (!company) {
    var labeled = doc.querySelectorAll('.company, .company-name, .corp, [class*="companyName"], [class*="company-name"]');
    for (var q = 0; q < labeled.length && !company; q++) {
      var lt = clean(labeled[q].textContent);
      if (lt && lt.length <= 30) company = lt;
    }
  }
  if (!company) {
    var cands = doc.querySelectorAll('h1, h2, header span');
    var CO = /(有限公司|股份有限公司|集团|银行|证券|科技|网络|研究院|事务所)$/;
    for (var c = 0; c < cands.length; c++) {
      var t = clean(cands[c].textContent);
      if (t && t.length <= 30 && CO.test(t)) { company = t; break; }
    }
  }

  if (!company) return null;
  return {
    company: company,
    position: position,
    jobRef: jobRef,
    url: pageUrl,
    title: clean(pageTitle),
    at: o.at || new Date().toISOString(),
    status: '已投递',
    channel: channel
  };
}

/* ============================================================
   职引 · 职位列表页采集
   collectJobs(opts) —— 在你正刷着的职位列表页上，把整页职位收进匹配池。

   和 collectFromPage 的分工：
     collectFromPage = 「我的投递」页 → 采**状态**（你投过的）；
     collectJobs     = 「职位列表」页 → 采**岗位**（你想投的候选）。
   用法：刷牛客 / 官网招聘列表时，翻一页点一次，岗位成批进求职app匹配池。

   输出 zhiyin.jobs.v1 条目：company / position / city / edu / salaryRaw /
   skills(尽量) / url(详情链接，尽量)。
   边界与采集一致：只读已渲染文本，不请求、不改页面；
   识别不出公司的条目直接丢弃——匹配池里塞「公司不明」的岗位没有意义。
   ============================================================ */
function collectJobs(opts) {
  var o = opts || {};
  var doc = (typeof document !== 'undefined') ? document : null;
  if (!doc) return { ok: false, count: 0, items: [] };
  var pageUrl = o.url || (typeof location !== 'undefined' ? location.href : '');
  var maxItems = o.maxItems || 50;

  function clean(s) { return String(s == null ? '' : s).replace(/[\s\u00a0]+/g, ' ').trim(); }
  var CACHE = (typeof WeakMap !== 'undefined') ? new WeakMap() : null;
  function textOf(el) {
    if (!el) return '';
    if (CACHE && CACHE.has(el)) return CACHE.get(el);
    var t = String(el.textContent == null ? '' : el.textContent).replace(/[\s\u00a0]+/g, ' ').trim();
    if (CACHE) CACHE.set(el, t);
    return t;
  }
  /* 只取元素**自身**的直接文本节点（不含后代文本）。
     用途：识别职位标题。真实站点常写成 <h3><span>职位名</span></h3>，
     这时 h3 的 textContent 既含标题又含兄弟信息（城市/薪资），
     而直接文本能精确落在真正承载标题的那一层——顺带天然去重（父容器直接文本为空）。 */
  function directText(el) {
    if (!el) return '';
    var s = '', n = el.firstChild;
    while (n) {
      if (n.nodeType === 3) s += n.nodeValue;
      n = n.nextSibling;
    }
    return String(s).replace(/[\s\u00a0]+/g, ' ').trim();
  }

  /* 职位名特征词。真实岗位名千奇百怪（财务BP / UX设计负责人 / 大模型评测专家），
     词表只能覆盖高频词；命中不了的名字由「结构化标题」通道兜底（见 byStructTitle）。 */
  var POS_SUFFIX = /(工程师|开发|经理|分析师|研究员|专员|顾问|设计师|架构师|科学家|负责人|主管|总监|专家|专员|BP|管培生|管培|培训生|实习生|实习|校招|运营|产品|算法|测试|策划|编辑|记者|翻译|教师|讲师|教研|医生|药师|护士|律师|法务|合规|风控|审计|会计|财务|税务|人力|HRBP|行政|招聘|商务|销售|市场|市场营销|品牌|公关|采购|供应链|物流|仓储|客服|安全|运维|前端|后端|全栈|客户端|服务端|数据|大数据|机器学习|深度学习|视觉|语音|自然语言|推荐|搜索|广告|增长|策略|战略|投资|研究|咨询|设计|交互|视觉设计|用户研究|项目管理|项目经理|质量管理|测试开发|游戏|直播|主播|内容|编导|导演|摄像|剪辑|美术|原画|特效|动画|医学|生物|材料|化学|机械|电子|电气|土木|建筑|规划|能源|环境|食品|农学|金融|银行|证券|保险|投研|量化|交易)/;
  /* 导航 / 筛选栏噪声：这些文本虽含职位特征词（如「产品与技术」「职能 / 支持」），
     但不是岗位。命中即不当作标题候选。 */
  var NAV_NOISE = /^(首页|所有职位|全部职位|职位类别|职位搜索|工作地点|筛选|清除|搜索职位|职位详情|返回|更多|上一页|下一页|登录|注册|我的|个人中心|校园招聘|社会招聘|实习生招聘|关于我们|联系我们|招聘首页)/;
  var SKIP_TAGS = { SCRIPT: 1, STYLE: 1, NOSCRIPT: 1, TEMPLATE: 1, SVG: 1, IFRAME: 1 };

  /* 单公司官网（公司自建招聘站）：整页只有这一家的岗位，卡片里**没有公司名字段**。
     这类站点的公司名写在页头/域名里——域名是权威信号，用它兜底不算猜。
     多公司平台（BOSS / 牛客 / 智联…）不在此表，绝不能兜底。 */
  var SOLE_EMPLOYER = [
    { key: 'jobs.bytedance.com', co: '字节跳动' }, { key: 'bytedance.com', co: '字节跳动' },
    { key: 'careers.tencent.com', co: '腾讯' }, { key: 'tencent.com', co: '腾讯' },
    { key: 'talent.alibaba.com', co: '阿里巴巴' }, { key: 'alibaba.com', co: '阿里巴巴' },
    { key: 'talent.baidu.com', co: '百度' }, { key: 'baidu.com', co: '百度' },
    { key: 'career.huawei.com', co: '华为' }, { key: 'huawei.com', co: '华为' },
    { key: 'zhaopin.jd.com', co: '京东' }, { key: 'jd.com', co: '京东' },
    { key: 'zhaopin.meituan.com', co: '美团' }, { key: 'meituan.com', co: '美团' },
    { key: 'job.xiaohongshu.com', co: '小红书' }, { key: 'xiaohongshu.com', co: '小红书' },
    { key: 'zhaopin.kuaishou.cn', co: '快手' }, { key: 'kuaishou.com', co: '快手' },
    { key: 'careers.netease.com', co: '网易' }, { key: 'netease.com', co: '网易' },
    { key: 'job.mi.com', co: '小米' }, { key: 'mi.com', co: '小米' },
    { key: 'careers.didiglobal.com', co: '滴滴' }, { key: 'didiglobal.com', co: '滴滴' },
    { key: 'jobs.pinduoduo.com', co: '拼多多' }, { key: 'pinduoduo.com', co: '拼多多' }
  ];
  function soleEmployer(url) {
    var u = String(url || '').toLowerCase();
    for (var i = 0; i < SOLE_EMPLOYER.length; i++) {
      if (u.indexOf(SOLE_EMPLOYER[i].key) >= 0) return SOLE_EMPLOYER[i].co;
    }
    return '';
  }

  var EDU_PATS = [
    { re: /博士及以上|博士/, val: '博士' },
    { re: /硕士及以上|硕士|研究生及以上|研究生/, val: '硕士' },
    { re: /本科及以上|本科以上|统招本科|全日制本科|本科/, val: '本科' },
    { re: /大专及以上|专科及以上|大专|专科|高职/, val: '大专' },
    { re: /学历不限|不限学历/, val: '不限' }
  ];
  function pickEdu(text) {
    for (var i = 0; i < EDU_PATS.length; i++) { if (EDU_PATS[i].re.test(text)) return EDU_PATS[i].val; }
    return '';
  }

  /* 城市匹配常见城市名（含「市」可省略的写法），找不到返回空——宁可空也不猜。 */
  var CITIES = ['北京', '上海', '深圳', '广州', '杭州', '成都', '南京', '武汉', '西安', '苏州', '天津', '重庆', '长沙', '郑州', '青岛', '合肥', '福州', '厦门', '东莞', '佛山', '珠海', '宁波', '无锡', '济南', '大连', '沈阳', '哈尔滨', '长春', '石家庄', '太原', '南昌', '昆明', '贵阳', '南宁', '兰州', '乌鲁木齐', '香港', '澳门', '台北', '宁德', '常州', '嘉兴', '惠州', '绍兴', '烟台', '泉州', '温州', '海口', '呼和浩特', '洛阳', '徐州', '芜湖'];
  function pickCity(text) {
    var t = String(text || '');
    for (var i = 0; i < CITIES.length; i++) { if (t.indexOf(CITIES[i]) >= 0) return CITIES[i]; }
    return '';
  }

  /* 薪资原文，保留页面写法（"15-25K·16薪"），不解析成数字——解析交给应用侧，原文留作对账。 */
  var SALARY_RE = /[0-9０-９]+(?:\.[0-9０-９]+)?\s*[-~至]\s*[0-9０-９]+(?:\.[0-9０-９]+)?\s*[Kk万]?\s*(?:·\s*[0-9]+薪)?/;
  function pickSalary(text) {
    var m = SALARY_RE.exec(String(text || ''));
    return m ? clean(m[0]) : '';
  }

  /* 职位 ID（如「职位 ID: A67442」「岗位编号：12345」）——回执对账时靠它精确匹配。
     取不到就留空，绝不编造。 */
  var JOBREF_RE = /(?:职位\s*(?:ID|编号|代码)|岗位\s*(?:ID|编号|代码)|申请(?:编|序)?号|应聘(?:编|序)?号)\s*[:：]?\s*([A-Za-z0-9\-_]{4,})/i;
  function pickJobRef(text) {
    var m = JOBREF_RE.exec(String(text || ''));
    return m ? clean(m[1]) : '';
  }

  /* 卡片「证据制」校验：一条真实职位至少带 2 项岗位特征。
     目的：把「产品与技术」「职能 / 支持」这类导航/筛选文本挡在门外——
     它们的文本像职位名，但周围没有城市、招聘类型、职位 ID、薪资、学历中的任何一项。 */
  function looksLikeJobCard(text) {
    var t = String(text || '');
    var evidence = 0;
    if (/(正式|实习|社招|校招|全职|兼职|应届|定期)/.test(t)) evidence++;
    if (/(职位\s*(ID|编号)|岗位\s*(ID|编号)|申请(编|序)?号)/i.test(t)) evidence++;
    if (SALARY_RE.test(t)) evidence++;
    if (/(本科|硕士|博士|大专|专科|学历|研究生)/.test(t)) evidence++;
    if (CITIES.some(function (c) { return t.indexOf(c) >= 0; })) evidence++;
    return evidence >= 2;
  }

  /* 标题特征过滤：职位标题是「名词短语」，不会有句读、不会以「团队介绍」开头。
     这道过滤专治「团队介绍：…产品…」这类段落 —— 它含职位特征词（产品/研究/数据），
     长度也可能不超限，若不拦，会与真标题同处一张卡片、把卡片边界卡死。 */
  function looksLikeTitleText(t) {
    var s = String(t || '');
    if (/[。！？；]/.test(s)) return false;
    if (/^(团队介绍|职位描述|岗位职责|工作职责|任职要求|我们希望|你将|你会|职位要求|加分项|我们提供)/.test(s)) return false;
    if (/[:：]\s*\S{12,}/.test(s)) return false;
    return true;
  }

  /* 元信息行识别：「北京 | 正式 | 职能 / 支持 | 职位 ID: A67442」这类行虽然含职位特征词
     （「后端」「设计」「运营」都在词表里），但它不是职位标题。判据三条，命中任一即为元信息：
       ① 明确带「职位 ID / 编号 / 申请号」；② 竖线分隔符 ≥2 个；③ 以城市开头且含分隔符。 */
  function looksLikeMetaLine(t) {
    var s = String(t || '');
    if (/职位\s*(ID|编号|代码)|岗位\s*(ID|编号)|申请(编|序)?号/i.test(s)) return true;
    if ((s.match(/[|｜]/g) || []).length >= 2) return true;
    if (/[|｜·]/.test(s)) {
      for (var i = 0; i < CITIES.length; i++) {
        if (s.indexOf(CITIES[i]) === 0) return true;
      }
    }
    return false;
  }

  /* 技能标签：卡片里短小的标签式文本（如 Python / SQL / 推荐），最多收 8 个。
     公司名与职位名本身不算技能。 */
  function pickSkills(root, positionText, companyText) {
    var out = [], seen = {};
    var all = root.querySelectorAll('*');
    for (var i = 0; i < all.length && out.length < 8; i++) {
      var e = all[i];
      if (SKIP_TAGS[e.tagName] || e.children.length > 0) continue;
      var t = textOf(e);
      if (t.length < 2 || t.length > 14) continue;
      if (t === positionText || t === companyText) continue;
      /* 标签特征：短的、不含句读的、像技能词的（中英数与常见符号） */
      if (!/^[A-Za-z0-9\u4e00-\u9fa5+#./ ]+$/.test(t)) continue;
      if (/^[0-9.]+$/.test(t)) continue;
      if (seen[t]) continue;
      seen[t] = 1;
      out.push(t);
    }
    return out;
  }

  /* 找「职位卡片」容器：卡片边界 = 不再包含**其他职位标题**的最近祖先。
     不用文本长度做上限——真实卡片可能带「团队介绍」等长文案（大厂官网常见），
     靠长度截断会把卡片缩回标题本身，反而丢掉城市/职位ID 这些证据。 */
  function cardOf(posEl, titleEls) {
    var best = posEl;
    var node = posEl.parentElement;
    for (var i = 0; i < 8 && node && node !== doc.body; i++) {
      var blocks = false;
      for (var k = 0; k < titleEls.length; k++) {
        if (titleEls[k] === posEl) continue;
        if (node === titleEls[k] || (node.contains && node.contains(titleEls[k]))) { blocks = true; break; }
      }
      if (blocks) break;
      best = node;
      node = node.parentElement;
    }
    return best;
  }

  /* 公司名：卡片内 class 带 company/corp/employer 的元素优先；再退到图片 alt；
     最后按「公司名后缀」找（「xx有限公司」这类）。
     注意：这里**宁可返回空**，也不要返回错的值——因为空值会走「单公司官网兜底」，
     而错值会覆盖掉正确的兜底，把一个字节的岗位标成别的公司。 */
  var CO_SUFFIX = /(有限公司|股份有限公司|集团|银行|证券|科技|网络|研究院|事务所|事业部)$/;
  function pickCompany(root) {
    var i, t;
    var byClass = root.querySelectorAll('[class*=compan],[class*=corp],[class*=employer],[class*=firm]');
    for (i = 0; i < byClass.length; i++) {
      t = textOf(byClass[i]);
      if (t && t.length >= 2 && t.length <= 24 && !POS_SUFFIX.test(t)) return t;
    }
    var imgs = root.querySelectorAll('img[alt]');
    for (i = 0; i < imgs.length; i++) {
      t = clean(imgs[i].getAttribute('alt'));
      if (!t || t.length < 2 || t.length > 24) continue;
      if (POS_SUFFIX.test(t)) continue;
      if (/logo|图标|icon|头像|avatar|banner|默认|占位/i.test(t)) continue;
      return t;
    }
    var all = root.querySelectorAll('*');
    for (i = 0; i < all.length; i++) {
      var e = all[i];
      if (SKIP_TAGS[e.tagName] || e.children.length > 0) continue;
      t = textOf(e);
      if (t && t.length >= 2 && t.length <= 24 && CO_SUFFIX.test(t)) return t;
    }
    return '';
  }

  /* 详情链接：卡片里第一个站内职位链接，补全成绝对地址。 */
  function pickUrl(root) {
    var links = root.querySelectorAll('a[href]');
    for (var i = 0; i < links.length; i++) {
      var h = links[i].getAttribute('href') || '';
      if (!h || h.charAt(0) === '#' || /^(javascript|mailto|tel):/i.test(h)) continue;
      try {
        return new URL(h, pageUrl || (typeof location !== 'undefined' ? location.href : 'https://x/')).href;
      } catch (e) { /* 非法 href 跳过 */ }
    }
    return '';
  }

  /* 主流程（三趟）：
     ① 收全页「像职位标题」的元素 —— 用**直接文本**判断，允许标题带子元素
        （<h3><span>职位名</span></h3> 在真实站点极常见）；
     ② 去包含：候选 A 含候选 B 时，保留最内层的 B（那才是真正承载标题的一层）；
     ③ 逐条归卡片 → 公司名（卡片里找不到就按单公司官网兜底）→ 证据校验 → 提取。 */
  var all = doc.body ? doc.body.querySelectorAll('*') : [];
  var i, k;
  var cands = [];
  for (i = 0; i < all.length; i++) {
    var el = all[i];
    if (SKIP_TAGS[el.tagName]) continue;
    var dt = directText(el);
    if (!dt && el.children.length === 0) dt = textOf(el);
    if (dt.length < 2 || dt.length > 64) continue;
    if (!POS_SUFFIX.test(dt)) continue;
    if (NAV_NOISE.test(dt)) continue;
    if (!looksLikeTitleText(dt)) continue;
    if (looksLikeMetaLine(dt)) continue;   /* 「城市 | 正式 | 部门 | 职位 ID」不是标题 */
    cands.push(el);
  }

  var titles = [];
  for (i = 0; i < cands.length; i++) {
    var host = false;
    for (k = 0; k < cands.length; k++) {
      if (k === i) continue;
      if (cands[i].contains && cands[i].contains(cands[k])) { host = true; break; }
    }
    if (!host) titles.push(cands[i]);
  }

  var fallbackCo = soleEmployer(pageUrl);
  var seenCard = [];
  var out = [];
  var seenKey = {};
  for (i = 0; i < titles.length && out.length < maxItems; i++) {
    var posEl = titles[i];
    var posText = directText(posEl) || textOf(posEl);
    var card = cardOf(posEl, titles);

    var dupCard = false;
    for (var c = 0; c < seenCard.length; c++) {
      if (seenCard[c] === card || (seenCard[c].contains && seenCard[c].contains(card))) { dupCard = true; break; }
    }
    if (dupCard) continue;

    var cardText = textOf(card);
    /* 卡片文本里带投递状态词 → 这是「我的投递」页，不是职位列表页，跳过 */
    if (/已投递|已查看|待沟通|不合适|邀面试/.test(cardText)) continue;
    /* 证据制：一条真实职位至少带 2 项岗位特征（城市 / 招聘类型 / 职位ID / 薪资 / 学历）。
       导航项与筛选词（「产品与技术」「职能 / 支持」）过不了这一关。 */
    if (!looksLikeJobCard(cardText)) continue;

    var company = pickCompany(card) || fallbackCo;   /* 单公司官网：卡片无公司名时用站点兜底 */
    if (!company) continue;                          /* 公司不明：丢弃，不编造 */

    var key = company + '|' + posText;
    if (seenKey[key]) continue;
    seenKey[key] = 1;
    seenCard.push(card);

    out.push({
      company: company,
      position: posText,
      city: pickCity(cardText),
      edu: pickEdu(cardText),
      salaryRaw: pickSalary(cardText),
      jobRef: pickJobRef(cardText),
      skills: pickSkills(card, posText, company),
      url: pickUrl(card),
      channel: 'extension'
    });
  }

  return { ok: true, count: out.length, items: out, url: pageUrl, companyFallback: fallbackCo || '' };
}

/* ============================================================
   职引 · 院校项目采集
   collectPrograms(opts) —— 在你正浏览的**院校项目详情页**上抓一个项目。
   与 collectJobs 的差异：
     - collectJobs 处理「公司列表」页（一页多个 job 卡片）→ 一次采多条；
     - collectPrograms 处理「单个项目页」→ 一次采一个，字段更多元（deadline/fund/language）。
   PhD 项目入口没有像 boss/牛客 那样的聚合平台，每个学校网站结构差异极大；
   这里的策略是「详情页字段抽取 + 域名兜底校名」，目录页暂不批量识别
   （目录页每个 program 一行卡的形态需要逐站适配，超出当前通用方案能力）。

   输出 schema = zhiyin.programs.v1：school/program/region/field/deadline/fund/
   language{toefl,ielts}/papers/applyUrl/note/url/channel。

   边界（与 collectJobs 一致）：只读已渲染文本，不请求、不改页面。
   识别不出项目名（无 PhD/DPhil/Doctor 等学位后缀）→ 直接丢弃。
   ============================================================ */
function collectPrograms(opts) {
  var o = opts || {};
  var doc = (typeof document !== 'undefined') ? document : null;
  if (!doc) return { ok: false, count: 0, items: [], error: 'no document' };
  var pageUrl = o.url || (typeof location !== 'undefined' ? location.href : '');
  var pageTitle = (typeof document !== 'undefined') ? (document.title || '') : '';
  var bodyText = clean((doc.body && doc.body.textContent) || '');

  function clean(s) { return String(s == null ? '' : s).replace(/[\s\u00a0]+/g, ' ').trim(); }
  /* 月份名 → 数字：FindaPhD 等英文站常用 "02 March 2027" 这类写法，
     数字正则是接不到的，单独提一段识别。识别不出来再退回原数字分支。 */
  var MONTH_NAME = { jan:1, feb:2, mar:3, apr:4, may:5, jun:6, jul:7, aug:8, sep:9, oct:10, nov:11, dec:12,
    january:1, february:2, march:3, april:4, june:6, july:7, august:8, september:9, october:10, november:11, december:12 };
  function normalizeDate(s) {
    if (!s) return '';
    var t = String(s);
    var named = t.match(/(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})/);
    if (named) {
      var mo = MONTH_NAME[named[2].toLowerCase()];
      if (mo) return named[3] + '-' + String(mo).padStart(2, '0') + '-' + String(+named[1]).padStart(2, '0');
    }
    var m = t.match(/([0-9]{1,2})[\/\-.年]([0-9]{1,2})[\/\-.月]([0-9]{2,4})|([0-9]{4})[\/\-.年]([0-9]{1,2})[\/\-.月]([0-9]{1,4})/);
    if (!m) return '';
    var y = m[4] || (m[3].length === 2 ? '20' + m[3] : m[3]);
    var mo2 = m[5] || m[2];
    var d = m[6] || m[1];
    return y + '-' + String(+mo2).padStart(2, '0') + '-' + String(Math.min(31, +d)).padStart(2, '0');
  }

  /* 项目名后缀（中英兼顾）：含其中之一 + 学科词才当项目名 */
  var PROG_SUFFIX_RE = /(PhD|DPhil|Doctor(?:al)?|Doctorate|MSc|MRes|MA|MBA|MFA|MPH|MEng|MS|M\.S\.|M\.A\.|博士|硕士|研究生)/i;
  /* 「截止」类关键词，用于在页面里定位 deadline 字段 */
  var DEADLINE_RE = /(?:deadline|application\s*deadline|截止(?:时间|日期)?|application\s+by|apply\s+by|due\s+date|submit\s+by)\s*[：:]*\s*([0-9]{1,2}[\/\-.年\s][0-9]{1,2}[\/\-.年\s][0-9]{2,4}|[0-9]{4}[\/\-.年][0-9]{1,2}[\/\-.月][0-9]{1,4})/i;
  /* 「资助」类关键词：含全额/全奖/奖学金/scholarship/funded 等 */
  var FUND_RE = /(全额[\u4e00-\u9fa5]{0,4}奖(?:学金)?|全奖|半奖|岗位制[\u4e00-\u9fa5]{0,8}(?:博士)?|奖学金|奖学金\s*\+|scholarship|fully[\s-]funded|stipend|partial\s+funding)/i;
  var TOEFL_RE = /(?:TOEFL|托福)[^0-9\n]{0,8}([0-9]{2,3})/i;
  var IELTS_RE = /(?:IELTS|雅思)[^0-9\n]{0,8}([0-9]\.?[0-9]?)/i;
  var PAPER_RE = /(?:publications?|papers?|发表论文|论文)[^0-9\n]{0,8}([0-9]{1,2})\s*(?:篇|papers?)?/i;

  /* 域名 → 校名兜底表（与求职侧 SITE_BRAND 同源：宁搜索不猜地址）。
     收录前提：项目入口 URL 来自学校 gradschool 站或该项目专属页面（亲自核实过的）。
     命中即兜底，校名以中文为准（与示例库 / 求职app 一致）。 */
  var SCHOOL_BRAND = {
    /* 香港 5 所 */
    'hku.hk': '香港大学', 'gradschool.hku.hk': '香港大学',
    'cuhk.edu.hk': '香港中文大学', 'gs.cuhk.edu.hk': '香港中文大学',
    'ust.hk': '香港科技大学', 'pg.ust.hk': '香港科技大学',
    'cityu.edu.hk': '香港城市大学',
    'polyu.edu.hk': '香港理工大学',
    /* 新加坡 3 所 */
    'nus.edu.sg': '新加坡国立大学',
    'ntu.edu.sg': '南洋理工大学',
    'smu.edu.sg': '新加坡管理大学',
    /* 英国 5 所 */
    'ox.ac.uk': '牛津大学', 'oxford.ac.uk': '牛津大学',
    'ucl.ac.uk': '伦敦大学学院',
    'ed.ac.uk': '爱丁堡大学',
    'manchester.ac.uk': '曼彻斯特大学',
    'warwick.ac.uk': '华威大学',
    /* 瑞士 2 所 */
    'ethz.ch': '苏黎世联邦理工学院',
    'epfl.ch': '洛桑联邦理工学院',
    /* 荷兰 1 所 */
    'tudelft.nl': '代尔夫特理工大学',
    /* 日本 2 所 */
    'u-tokyo.ac.jp': '东京大学',
    'kyoto-u.ac.jp': '京都大学',
    /* 澳大利亚 2 所 */
    'unsw.edu.au': '新南威尔士大学',
    'unimelb.edu.au': '墨尔本大学',
    /* 澳门 1 所 */
    'um.edu.mo': '澳门大学', 'grad.um.edu.mo': '澳门大学'
  };

  /* 域名 → region 兜底（与 SCHOOL_BRAND 一一对应，省得每个项目都得手动标地区） */
  var REGION_BY_HOST = {
    'hku.hk': '中国香港', 'gradschool.hku.hk': '中国香港',
    'cuhk.edu.hk': '中国香港', 'gs.cuhk.edu.hk': '中国香港',
    'ust.hk': '中国香港', 'pg.ust.hk': '中国香港',
    'cityu.edu.hk': '中国香港', 'polyu.edu.hk': '中国香港',
    'nus.edu.sg': '新加坡', 'ntu.edu.sg': '新加坡', 'smu.edu.sg': '新加坡',
    'ox.ac.uk': '英国', 'oxford.ac.uk': '英国', 'ucl.ac.uk': '英国',
    'ed.ac.uk': '英国', 'manchester.ac.uk': '英国', 'warwick.ac.uk': '英国',
    'ethz.ch': '瑞士', 'epfl.ch': '瑞士',
    'tudelft.nl': '荷兰',
    'u-tokyo.ac.jp': '日本', 'kyoto-u.ac.jp': '日本',
    'unsw.edu.au': '澳大利亚', 'unimelb.edu.au': '澳大利亚',
    'um.edu.mo': '中国澳门', 'grad.um.edu.mo': '中国澳门'
  };

  function pickSchool() {
    /* 优先级：
       1) URL 域名兜底（最稳：用户刷的就是这个学校）
       2) title / h1 里的中国校名（"XX大学"），覆盖兜底表外的中国大陆/港澳学校
       3) title 里的 "University of XX"
       三处都拿不到 → 整条丢弃（避免塞「学校不明」进院校池污染匹配） */
    try {
      var host = (new URL(pageUrl)).host.toLowerCase();
      var stripped = host.replace(/^www\./, '');
      for (var key in SCHOOL_BRAND) {
        if (stripped === key || stripped.indexOf('.' + key) >= 0) return SCHOOL_BRAND[key];
      }
    } catch (e) { /* URL 解析失败 → 走 title/body 路径 */ }
    var cnFromTitle = clean(pageTitle).match(/[\u4e00-\u9fa5]{2,8}(?:大学|学院|理工|科技大学|工业大学|理工大学)/);
    if (cnFromTitle) return clean(cnFromTitle[0]);
    /* title 里的英文校名（"University of XX" / "MIT University" 等） */
    var t = clean(pageTitle);
    var enMatch = t.match(/University\s+of\s+[A-Z][\w\s&]+?(?:[\s,\-|]|$)/i) || t.match(/([A-Z][\w]+\s+University)/);
    if (enMatch) return clean(enMatch[1] || enMatch[0]);
    /* body 兜底：从页面开头找首个完整校名（限前 1500 字，避免抓错） */
    var head = bodyText.slice(0, 1500);
    var cnFromBody = head.match(/[\u4e00-\u9fa5]{2,8}(?:大学|学院|理工|科技大学|工业大学|理工大学)/);
    if (cnFromBody) return clean(cnFromBody[0]);
    return '';
  }
  function pickRegion() {
    try {
      var host = (new URL(pageUrl)).host.toLowerCase().replace(/^www\./, '');
      for (var key in REGION_BY_HOST) {
        if (host === key || host.indexOf('.' + key) >= 0) return REGION_BY_HOST[key];
      }
    } catch (e) {}
    return '';
  }
  function pickProgram() {
    /* 1) 优先 h1/h2：这是项目详情页最稳的标题层 */
    var hs = doc.querySelectorAll('h1, h2');
    for (var i = 0; i < hs.length; i++) {
      var t = clean(hs[i].textContent);
      if (PROG_SUFFIX_RE.test(t) && t.length < 120) return t;
    }
    /* 2) document.title：常常是「Computer Science PhD - HKU Grad School」形式 */
    var titleMatch = pageTitle.match(/([^|\-–\n]{2,80}(?:PhD|DPhil|Doctor(?:al)?|Doctorate|MSc|MRes|MA|MBA|博士|硕士)[^|\-–\n]{0,30})/i);
    if (titleMatch) return clean(titleMatch[1]);
    /* 3) meta og:title 兜底 */
    var og = doc.querySelector('meta[property="og:title"]');
    if (og && og.content) {
      var ogT = clean(og.content);
      if (PROG_SUFFIX_RE.test(ogT)) return ogT;
    }
    return '';
  }
  function pickField() {
    /* 学科方向：从 meta keywords / description / og:description 抓 */
    var metas = ['meta[name="keywords"]', 'meta[name="description"]', 'meta[property="og:description"]'];
    for (var i = 0; i < metas.length; i++) {
      var el = doc.querySelector(metas[i]);
      if (el && el.content) {
        var c = clean(el.content);
        /* keywords 是逗号分隔，取前 2-3 个学科词 */
        if (/keywords/i.test(metas[i])) {
          var parts = c.split(/[;,]/).map(function (x) { return clean(x); }).filter(function (x) { return x.length > 1 && x.length < 30; });
          if (parts.length) return parts.slice(0, 3).join(' / ');
        } else if (c.length < 200) {
          return c;
        }
      }
    }
    /* 兜底：从 body 前 600 字中抓含「AI / ML / 系统 / 计算机视觉」等关键词的句子 */
    var aiWords = ['artificial intelligence', 'machine learning', 'computer science', 'data science', 'robotics', 'computer vision', 'nlp', '人工智能', '机器学习', '计算机科学', '数据科学', '机器人', '计算机视觉', '自然语言', '深度学习', '多模态', '系统工程', '电子工程', '材料', '生物医学', '金融科技', '金融工程', '经济学'];
    var head = bodyText.slice(0, 600);
    var hit = [];
    for (var j = 0; j < aiWords.length; j++) {
      if (head.toLowerCase().indexOf(aiWords[j].toLowerCase()) >= 0) hit.push(aiWords[j]);
      if (hit.length >= 3) break;
    }
    return hit.join(' / ');
  }
  function pickDeadline() {
    var m = bodyText.match(DEADLINE_RE);
    if (!m) return '';
    return normalizeDate(m[1]);
  }
  function pickFund() {
    var m = bodyText.match(FUND_RE);
    return m ? clean(m[0]) : '';
  }
  function pickLanguage() {
    var t = bodyText.match(TOEFL_RE);
    var i = bodyText.match(IELTS_RE);
    if (!t && !i) return null;
    return {
      toefl: t ? +t[1] : 0,
      ielts: i ? +i[1] : 0
    };
  }
  function pickPapers() {
    var m = bodyText.match(PAPER_RE);
    return m ? +m[1] : 0;
  }
  function pickNote() {
    /* 取正文里不含上述字段的一段简介（80 字以内）。先找页面里的第一个长 paragraph。 */
    var ps = doc.querySelectorAll('p, li');
    for (var i = 0; i < Math.min(ps.length, 20); i++) {
      var t = clean(ps[i].textContent);
      if (t.length < 40 || t.length > 500) continue;
      if (/deadline|截止|funding|scholarship|TOEFL|IELTS|fund/i.test(t)) continue;
      return t.slice(0, 90);
    }
    return '';
  }

  /* ---- 列表页分支：FindaPhD 嵌入（爱丁堡等学校用）/ 多项目目录页 ----
     卡片容器 .API_resultItem_Inner 由 FindaPhD 官方 API 嵌入组件生成，
     爱丁堡 study.ed.ac.uk、findaphd.com 的搜索结果页都用同一结构——
     一处规则覆盖两个站。
     边界与单页一致：识别不出校名 → 整页丢弃，不塞「学校不明」。 */
  function collectProgramsList() {
    var cards = doc.querySelectorAll('.API_resultItem_Inner');
    if (!cards.length) return null;
    var school0 = pickSchool();
    if (!school0) return null;
    var region0 = pickRegion();
    var items = [];
    var seen = {};
    for (var i = 0; i < cards.length; i++) {
      var card = cards[i];
      var titleEl = card.querySelector('.API_phdTitle a');
      var title = titleEl ? clean(titleEl.textContent) : '';
      if (!title) continue;
      if (seen[title]) continue;
      seen[title] = 1;
      var deptEl = card.querySelector('.API_schoolTitle a');
      var dept = deptEl ? clean(deptEl.textContent) : '';
      var labels = card.querySelectorAll('.API_categoryDiv .API_label');
      var degree = labels[0] ? clean(labels[0].textContent) : '';
      var fund = labels[1] ? clean(labels[1].textContent) : '';
      var supLinks = card.querySelectorAll('.API_supervisors .supervisorEmail');
      var supNames = [];
      for (var s = 0; s < supLinks.length; s++) supNames.push(clean(supLinks[s].textContent));
      var supervisorText = supNames.join(', ');
      var deadlineEl = card.querySelector('.API_appDeadline');
      var deadline = deadlineEl ? normalizeDate(clean(deadlineEl.textContent)) : '';
      var detailEl = card.querySelector('.API_fullDetails');
      var projectId = detailEl && detailEl.id ? clean(detailEl.id) : '';
      /* 备注：结构化字段（院系/导师/资助/项目 ID）永远优先——
         详情段第一个 <p> 经常是 "Context / Overview" 这种标签，没信息量；
         如果详情里有 ≥40 字且不像标签的段落，再追加一句作补充。 */
      var bits = [];
      if (dept) bits.push(dept);
      if (supervisorText) bits.push(supervisorText);
      if (fund) bits.push(fund);
      if (projectId) bits.push('ID ' + projectId);
      var note = bits.join(' · ');
      if (detailEl) {
        var ps = detailEl.querySelectorAll('p');
        for (var pi = 0; pi < ps.length; pi++) {
          var pt = clean(ps[pi].textContent);
          if (pt.length < 40 || pt.length > 400) continue;
          if (/^(context|overview|description|details?|摘要|简介|项目介绍)\s*$/i.test(pt)) continue;
          note += '　' + pt.slice(0, 200);
          break;
        }
      }
      items.push({
        school: school0,
        program: title,
        region: region0,
        field: '',
        deadline: deadline,
        fund: fund || degree,
        toefl: 0,
        ielts: 0,
        papers: 0,
        /* 列表页 view 链接是 javascript:;，没有真实 URL——给 pageUrl + 提示点 View Details */
        applyUrl: pageUrl,
        note: note + '（列表页：当前页点 "View Details" 看详情）',
        url: pageUrl,
        channel: 'extension',
        projectId: projectId
      });
    }
    if (!items.length) {
      return { ok: false, count: 0, items: [], mode: 'list', error: '本页含 FindaPhD 卡片容器，但每张卡片都未识别到项目名（卡片标题应可见）。' };
    }
    return { ok: true, count: items.length, items: items, mode: 'list', url: pageUrl, schoolFallback: school0 };
  }
  var listResult = collectProgramsList();
  if (listResult) return listResult;

  var program = pickProgram();
  if (!program) {
    return { ok: false, count: 0, items: [], error: '本页未识别到项目名（含 PhD/DPhil/Doctor 等学位后缀）。若这是项目目录页，请进入项目详情页再采。' };
  }
  var school = pickSchool();
  if (!school) {
    /* 与 collectJobs 同原则：识别不出关键字段就丢弃。
       PhD 项目没有「公司不明照样入库」的意义 —— 院校池里塞「学校不明」的项目会污染匹配。 */
    return { ok: false, count: 0, items: [], error: '本页未识别到所属学校（既不在域名兜底表里，标题也找不到大学名）。请确认你正在浏览目标学校的项目页面。' };
  }
  var lang = pickLanguage();
  var item = {
    school: school,
    program: program,
    region: pickRegion(),
    field: pickField(),
    deadline: pickDeadline(),
    fund: pickFund(),
    toefl: lang ? lang.toefl : 0,
    ielts: lang ? lang.ielts : 0,
    papers: pickPapers(),
    applyUrl: pageUrl,
    note: pickNote(),
    url: pageUrl,
    channel: 'extension'
  };
  return { ok: true, count: 1, items: [item], url: pageUrl, schoolFallback: school };
}

/* ============================================================
   职引 · 表单字段识别（第二十三轮抽出，三处共用）
   第一遍填充 / 第二遍组合件 / 探针，共用同一份口径 ——
   否则「填表的代码」和「探针报出来的代码」会说出两个不同的答案。

   第二十三轮为什么要重写（美团 zhaopin.meituan.com 的探针实测）：
     ① 段落容器的文本会被当成字段标签。个人照片那个 file 框探出来的 up3
        竟然是**同一段里第一个字段的「姓名*」**。旧实现把 up1..up3 拼成
        一个字符串再做正则匹配 → 页面上只要有个标签认不出来的栏，
        姓名就会被填进去。这已经不是"填不上"，是"填错地方"。
     ② 那 20 个「标签全空」的栏（学校/专业/学历…）说明自研组件把标签放在
        别的类名里（mtd-form-item__label 这类），旧选择器一个都没认出来。
     ③ 同一栏在页面上会出现好几段（2 段教育 / 2 段工作 / 2 段项目），
        文本一模一样，**只有顺序能区分** —— 不记段号就会全填到第一段。
   ============================================================ */

/* 能当标签用的元素。显式类名在前，最后一档 [class*="label"] 兜底
   （自研组件库的类名五花八门，写不完）。 */
var FORM_LABEL_SEL = ['label', 'legend', '.ant-form-item-label', '.mtd-form-item-label',
  '.el-form-item__label', '.form-item-label', '.form-label', '.item-label', '.field-label',
  '.label', '[class*="item-label"]', '[class*="form-label"]', '[class*="field-label"]',
  '[class*="label"]'];

function formText(s) { return String(s == null ? '' : s).replace(/[\s\u00a0]+/g, ' ').trim(); }

/* 在容器里找一个"像标签"的元素。必须排除「自己包着可填控件」的容器，
   否则会把整个区块的文本当成本栏的标签。 */
function labelNodeIn(node, el) {
  for (var i = 0; i < FORM_LABEL_SEL.length; i++) {
    var n = null;
    try { n = node.querySelector(FORM_LABEL_SEL[i]); } catch (e) { n = null; }
    if (!n) continue;
    if (n === el || (n.contains && n.contains(el))) continue;
    if (n.querySelector && n.querySelector('input, textarea, select')) continue;
    var t = formText(n.textContent);
    if (t && t.length <= 24) return t;
  }
  return '';
}

/* 容器自身的短文本：不含控件的子元素里最短的那个，再退到直接文本节点 */
function shortTextIn(node, el) {
  var all = null;
  try { all = node.querySelectorAll('span, div, p, dt, dd, td, th, i, b, em, strong, h1, h2, h3, h4'); } catch (e) { return ''; }
  var best = '';
  for (var i = 0; i < all.length; i++) {
    var n = all[i];
    if (n === el || (n.contains && n.contains(el))) continue;
    if (n.querySelector && n.querySelector('input, textarea, select')) continue;
    var t = formText(n.textContent);
    if (!t || t.length > 12) continue;
    if (!/[^\s*：:·.、,，()（）\[\]]/.test(t)) continue;   /* 纯星号/标点不算标签 */
    if (!best || t.length < best.length) best = t;
  }
  if (best) return best;
  var direct = '';
  for (var k = 0; k < node.childNodes.length; k++) {
    if (node.childNodes[k].nodeType === 3) direct += node.childNodes[k].nodeValue;
  }
  direct = formText(direct);
  return direct && direct.length <= 12 ? direct : '';
}

/* 从本控件向上找它这一栏的标签。核心判据只有一条：
   **容器里只有本控件 → 它给出的文本是本栏的标签；容器里有一堆控件 → 那是区块标题。**
   美团那页的「姓名*」被 10 多个控件共用，就是这样被识破的。 */
function labelUpFrom(el, doc) {
  var node = el.parentElement;
  /* 5 层：antd 的 Select 是 `.ant-select > .ant-select-selector > .ant-select-selection-search > input`，
     标签在它上两层；美团那种自研组件还更绕。层数给够，靠下面那条判据兜住准确度。 */
  for (var d = 0; d < 5 && node && node !== doc.body && node !== doc.documentElement; d++) {
    var cnt = 0;
    try { cnt = node.querySelectorAll('input, textarea, select').length; } catch (e) { cnt = 0; }
    if (cnt <= 1) {
      var t = labelNodeIn(node, el) || shortTextIn(node, el);
      if (t) return { text: t, depth: d + 1 };
    }
    node = node.parentElement;
  }
  return null;
}

/* 一个控件的全部「可能标签」，带可信度 rank（越小越可信）。
   注意这里是**候选列表**不是拼成的一串 —— 匹配时按可信度逐个试，
   这样「电子邮箱」这种包裹 label 和 placeholder 都能参与，
   又不会被段落标题污染。 */
function formLabel(el, doc) {
  var cand = [];
  function add(t, src, rank) {
    t = formText(t);
    if (t && t.length <= 40) cand.push({ t: t, src: src, rank: rank });
  }
  try {
    if (el.id) { var lb = doc.querySelector('label[for="' + el.id + '"]'); if (lb) add(lb.textContent, 'label[for]', 0); }
  } catch (e) { /* 忽略 */ }
  var at = function (a) { return el.getAttribute ? el.getAttribute(a) : null; };
  add(at('aria-label'), 'aria-label', 1);
  add(at('placeholder'), 'placeholder', 2);
  add(at('name'), 'name', 3);
  add(at('title'), 'title', 3);
  var prev = el.previousElementSibling;
  if (prev && /^(LABEL|SPAN|DIV|P|TD|TH|DT|DD|H\d|I|B|EM|STRONG)$/.test(prev.tagName)) {
    var pt = formText(prev.textContent);
    if (pt && pt.length <= 20) add(pt, 'prev-sibling', 3);
  }
  if (el.closest) { var wl = el.closest('label'); if (wl) add(wl.textContent, 'wrap-label', 3); }
  var up = labelUpFrom(el, doc);
  if (up) add(up.text, 'up' + up.depth, 4 + up.depth);
  cand.sort(function (a, b) { return a.rank - b.rank || a.t.length - b.t.length; });
  return { list: cand, text: cand.length ? cand[0].t : '', src: cand.length ? cand[0].src : '', rank: cand.length ? cand[0].rank : 99 };
}

/* 标签匹配：按候选可信度从高到低试，命中即止，返回命中的那个候选 */
function labelMatch(x, pats) {
  var c = x.list || [];
  for (var i = 0; i < c.length; i++) {
    for (var p = 0; p < pats.length; p++) { if (pats[p].test(c[i].t)) return c[i]; }
  }
  return null;
}

/* 组件外壳：检索型下拉 / 日期选择器。自研组件库（mtd-*）也要认，
   否则"这栏是下拉"这件事根本看不出来。 */
var COMBO_WRAP = ['.ant-select', '.el-select', '.mtd-select', '.arco-select', '.van-dropdown',
  '.ant-picker', '.el-date-editor', '.mtd-picker', '.mtd-date-picker', '.ant-calendar-picker',
  '.arco-picker', '.van-calendar', '[role="combobox"]', '.select2-container', '.v-select',
  '.ant-cascader-picker', '.el-cascader', '.mtd-cascader', '[class*="select"][class*="wrap"]',
  '[class*="picker"]', '[class*="Select"]'];

function wrapperOf(el) {
  for (var i = 0; i < COMBO_WRAP.length; i++) {
    var w = null;
    try { w = el.closest(COMBO_WRAP[i]); } catch (e) { w = null; }
    if (w) return { el: w, sel: COMBO_WRAP[i] };
  }
  return null;
}

/* 全表扫描：给每个可填控件算好标签 + 段号。
   段号 = 这一栏在同一栏目里是第几次出现（0 起）—— 多段经历所依赖的就是它。 */
function scanForm(doc) {
  var els = doc.querySelectorAll('input, textarea, select');
  var list = [];
  for (var i = 0; i < els.length; i++) {
    var el = els[i];
    var tag = el.tagName.toLowerCase();
    var type = String(el.type || (tag === 'select' ? 'select' : tag)).toLowerCase();
    var lb = formLabel(el, doc);
    var wr = wrapperOf(el);
    list.push({
      el: el, i: i, tag: tag, type: type,
      label: lb.text, src: lb.src, rank: lb.rank, list: lb.list,
      wrap: wr ? wr.el : null, wrapSel: wr ? wr.sel : '',
      sect: '', block: 0, taken: false
    });
  }
  assignBlocks(list);
  return list;
}

/* 栏目组：段号必须**按栏目分域**计数。
   踩过的坑（第二十三轮）：一开始按「标签文本」全局计数，
   而「结束时间」在工作段和项目段是同一段文案 —— 结果项目第 1 段被算成了第 3 段，
   起止时间全填不上。所以先用栏目词判断这栏属于哪一组，再在组内计数。 */
var SECT_KW = [
  { id: 'edu', re: /(院校|学校|专业|学历|学位|university|college|major|degree|gpa)/i },
  { id: 'work', re: /(公司|单位|部门|职位|岗位|职务|company|employer|position|insider|intern)/i },
  { id: 'proj', re: /(项目|科研|课题)/ },
  { id: 'campus', re: /(校园|社团|实践|学生会|志愿)/ },
  { id: 'honor', re: /(荣誉|奖项|奖励|获奖)/ },
  { id: 'cert', re: /(证书|资格|执照)/ },
  { id: 'paper', re: /(论文|专利|著作|成果)/ }
];
/* 光杆的时间栏：「入学时间 / 在开始时间 / 结束时间」这类文案页面上到处都是，
   自己认不出属于哪一段 —— 只能跟着**它前面那个有栏目词的栏**走。 */
var AMBIG_LABEL = /^.{0,6}(时间|日期)$/;

function sectOf(label) {
  if (!label || AMBIG_LABEL.test(label)) return '';
  for (var i = 0; i < SECT_KW.length; i++) { if (SECT_KW[i].re.test(label)) return SECT_KW[i].id; }
  return '';
}

function assignBlocks(list) {
  var counter = {};     /* '栏目|标签' -> 已出现次数 */
  var last = '';        /* 最近一次认出来的栏目 */
  for (var i = 0; i < list.length; i++) {
    var x = list[i];
    if (x.type === 'file' || x.type === 'checkbox' || x.type === 'radio' || x.type === 'hidden') continue;
    var lb = x.label || '';
    if (!lb) continue;
    var id = sectOf(lb);
    if (id) last = id; else id = last;      /* 认不出就跟着前面那栏 */
    x.sect = id;
    var key = id + '|' + lb;
    if (counter[key] === undefined) counter[key] = 0; else counter[key] += 1;
    x.block = counter[key];
  }
}

/* 起止时间切分。不能简单按 '-' 切：「2025-11 至 2026-01」会被切成三段 */
function timeRange(t) {
  var s = formText(t);
  if (!s) return ['', ''];
  var parts = null;
  if (/[至–—~]/.test(s)) parts = s.split(/\s*[至–—~]\s*/);
  else if (/\s-\s|\s-|-/.test(s) && /^\s*\d{4}/.test(s)) parts = s.split(/\s*-\s*/);
  if (!parts) return [s, ''];
  parts = parts.map(formText).filter(Boolean);
  if (parts.length >= 2) return [parts[0], parts[parts.length - 1]];
  return [s, ''];
}
function isPresentWord(v) { return /^(至今|现在|目前|今|present|now|current)$/i.test(formText(v)); }

/* 赋值必须走元素原型上的原生 setter。
   React / Vue 受控表单在实例上挂了 value tracker，直接 el.value = x 会被吞掉，
   表现是「看着填上了、一失焦就空」。第一遍和第二遍共用这一个。 */
function setNativeValue(el, val) {
  var s = String(val);
  try {
    var proto = (el.tagName === 'TEXTAREA') ? window.HTMLTextAreaElement.prototype
      : (el.tagName === 'SELECT') ? window.HTMLSelectElement.prototype : window.HTMLInputElement.prototype;
    var desc = Object.getOwnPropertyDescriptor(proto, 'value');
    if (desc && desc.set) { desc.set.call(el, s); return true; }
  } catch (e) { /* 取不到原生 setter 就退回直接赋值 */ }
  try { el.value = s; return true; } catch (e2) { return false; }
}

/* ============================================================
   职引 · 辅助填写（第一遍）：普通输入框
   fillFromPayload(opts)

   边界（不变）：
     - 只填不提交；
     - 密码 / 文件 / 隐藏 / 单选 / 复选 / 提交按钮一律不动；
     - 证件号、身份证、护照这类敏感栏**不代填**（填错是隐私事故）；
     - select 只在选项能对上时才动，对不上就记 missed，不瞎选；
     - 一个控件只接收一个字段；载荷里没有的字段不动页面上的任何东西。
   ============================================================ */
function fillFromPayload(opts) {
  var o = opts || {};
  var doc = (typeof document !== 'undefined') ? document : null;
  if (!doc) return { ok: false, error: 'no document' };
  var raw = o.fields || {};
  var sec = o.sections || null;
  var clean = formText;

  var edu = (sec && sec.education) || [];
  var works = (sec && sec.work) || [];
  var projs = (sec && sec.projects) || [];
  var cust = (sec && sec.custom && Object.prototype.toString.call(sec.custom.bullets) === '[object Array]') ? sec.custom : null;

  var fields = {};
  Object.keys(raw).forEach(function (k) { if (clean(raw[k]) !== '') fields[k] = raw[k]; });

  var scan = scanForm(doc);
  var plan = [], filled = [], missed = [], skipped = [], notice = [];

  /* ---------- 0) 绝不代填的栏 ---------- */
  var SENSITIVE = /证件|身份证|护照|银行卡|信用卡|社保|税号/;
  scan.forEach(function (x) {
    if (SENSITIVE.test(x.label)) {
      x.taken = true;
      skipped.push({ field: '证件类', label: x.label, reason: '涉及身份证 / 护照等敏感信息，扩展不代填' });
    } else if (x.tag === 'input' && x.type === 'file') {
      x.taken = true;
      skipped.push({ field: '文件上传', label: x.label, reason: '文件要你自己选（浏览器也不允许代传）' });
    }
  });

  function avail(x) {
    if (!x || x.taken) return false;
    if (x.tag === 'input' && /^(submit|button|password|file|hidden|image|reset|radio|checkbox)$/.test(x.type)) return false;
    if (x.el.disabled || x.el.readOnly) return false;      /* 只读栏交给第二遍（日期面板） */
    return true;
  }
  function pick(pred) {
    for (var i = 0; i < scan.length; i++) { var x = scan[i]; if (avail(x) && pred(x)) { x.taken = true; return x; } }
    return null;
  }
  function pickBlock(k, pats) {
    return pick(function (x) { return x.block === k && !!labelMatch(x, pats); });
  }
  /* 页面上有没有"第一遍本来就管不了"的栏（只读日期框 / 带组件外壳的下拉）？
     有的话就不是"没填上"，而是**交给第二遍** —— 不能记进 missed，
     否则用户会看到"毕业时间没找到输入框"，可它明明被第二遍填好了。 */
  function deferrable(pats, k) {
    for (var i = 0; i < scan.length; i++) {
      var x = scan[i];
      if (x.taken || x.el.disabled) continue;
      if (k != null && x.block !== k) continue;
      if (!labelMatch(x, pats)) continue;
      return !!(x.el.readOnly || x.wrap);
    }
    return false;
  }
  /* 第 0 段就用载荷里的扁平字段名（school / company / projName…），
     第 1 段起用「字段[1].xx」，missed 里报出来的名字才对得上用户看到的载荷 */
  function nameOf(pair, k) {
    var flat = { school: 'school', major: 'major', degree: 'edu', company: 'company', role: 'role',
      workDesc: 'workDesc', projName: 'projName', projDesc: 'projDesc' };
    if (k === 0 && flat[pair]) return flat[pair];
    return pair + ' #' + (k + 1);
  }
  var usedFlat = {};

  /* ---------- 1) 本岗改写文案：抢第一个「描述型」栏 ----------
     这是 CV 改写唯一的出口。它是一段针对本岗重写过的成果陈述，
     语义上最贴合「自我评价」，其次是「工作内容」，最后是「项目描述」。
     **只填一处** —— 同一段话填进两栏，HR 一眼就看出是复制的。 */
  var ctext = '';
  if (cust && cust.bullets.length) {
    ctext = cust.bullets.map(function (b) { return typeof b === 'string' ? b : ((b && b.text) || ''); })
      .filter(Boolean).join('\n');
  }
  var customUsed = 0, customWhere = '';
  if (ctext) {
    var CU = [
      { pats: [/自我(介绍|评价|描述)/, /个人简介/, /(求职|申请)信/, /cover ?letter/i], where: '自我评价' },
      { pats: [/工作(描述|内容|职责|业绩)/, /(岗位|职位)(描述|职责)/], where: '工作内容' },
      { pats: [/项目(描述|职责|内容|简介|介绍)/], where: '项目描述' }
    ];
    for (var cu = 0; cu < CU.length && !customUsed; cu++) {
      var ch = pick(function (x) { return !!labelMatch(x, CU[cu].pats); });
      if (ch) {
        plan.push({ x: ch, value: ctext, field: 'custom' });
        customUsed = cust.bullets.length;
        customWhere = CU[cu].where;
      }
    }
    if (customUsed) notice.push('本岗改写文案填进了「' + customWhere + '」栏（只有这一栏用定制版，其余用简历原文）');
    else notice.push('本岗改写文案没找到能填的「描述型」栏 —— 这份表可能没有这类栏目');
  }

  /* ---------- 2) 教育段 ---------- */
  var eduList = edu.slice();
  if (!eduList.length && (fields.school || fields.major || fields.edu)) {
    eduList = [{ school: fields.school || '', major: fields.major || '', degree: fields.edu || '', time: '' }];
  }
  eduList.forEach(function (e, k) {
    var r = timeRange(e.time);
    var pairs = [
      { c: 'school', v: e.school, pats: [/院校/, /学校/, /university/i, /college/i, /institute/i, /school/i] },
      { c: 'major', v: e.major, pats: [/专业/, /major/i] },
      { c: 'degree', v: e.degree, pats: [/学历/, /学位/, /degree/i] },
      { c: 'timeStart', v: r[0], pats: [/入学/, /开始时间/, /起始/] },
      { c: 'timeEnd', v: isPresentWord(r[1]) ? '' : r[1], pats: [/毕业/, /结束时间/, /离校/] }
    ];
    pairs.forEach(function (p) {
      if (p.v == null || clean(p.v) === '') return;
      var nm = nameOf(p.c === 'timeStart' ? 'gradEnd' : (p.c === 'timeEnd' ? 'gradYear' : p.c), k);
      var hit = pickBlock(k, p.pats);
      if (hit) { plan.push({ x: hit, value: String(p.v), field: nm }); if (k === 0) usedFlat[nm] = 1; }
      else if (!deferrable(p.pats, k)) missed.push(nm);
    });
  });

  /* ---------- 3) 工作段 ---------- */
  var workList = works.slice();
  if (!workList.length && (fields.company || fields.role)) {
    workList = [{ company: fields.company || '', role: fields.role || '', bullets: [], time: '' }];
  }
  workList.forEach(function (w, k) {
    var r = timeRange(w.time);
    var pairs = [
      /* 公司 ≠ 部门：把公司名填进「部门名称」就是填错地方。
         认不出来宁可漏填 —— 漏填用户一眼看得见，填错了他要逐栏核对才发现。 */
      { c: 'company', v: w.company, pats: [/公司/, /单位/, /company/i, /employer/i] },
      { c: 'role', v: w.role, pats: [/职位/, /岗位/, /职务/, /role/i, /position/i] },
      { c: 'timeStart', v: r[0], pats: [/开始时间/, /起始/, /入职/] },
      { c: 'timeEnd', v: isPresentWord(r[1]) ? '' : r[1], pats: [/结束时间/, /离职/] },
      { c: 'workDesc', v: (w.bullets || []).join('\n'), pats: [/工作(描述|内容|职责|业绩)/, /(岗位|职位)(描述|职责)/] }
    ];
    pairs.forEach(function (p) {
      if (p.v == null || clean(p.v) === '') return;
      var nm = nameOf(p.c, k);
      var hit = pickBlock(k, p.pats);
      /* 第 1 段的描述栏被本岗文案占了 —— 那不是"没填上"，是换了版本，别重复报 */
      var taken = customUsed && k === 0 && (p.c === 'workDesc' || p.c === 'projDesc');
      if (hit) { plan.push({ x: hit, value: String(p.v), field: nm }); if (k === 0) usedFlat[nm] = 1; }
      else if (!taken && !deferrable(p.pats, k)) missed.push(nm);
    });
  });

  /* ---------- 4) 项目 / 科研段 ---------- */
  var projList = projs.slice();
  if (!projList.length && fields.projName) projList = [{ name: fields.projName, duties: [] }];
  projList.forEach(function (p, k) {
    var r = timeRange(p.time);
    var pairs = [
      { c: 'projName', v: p.name, pats: [/项目名称/, /项目名/] },
      { c: 'role', v: p.role, pats: [/项目角色/, /角色/, /担任/] },
      { c: 'projLink', v: p.link, pats: [/项目链接/, /链接/, /url/i] },
      { c: 'timeStart', v: r[0], pats: [/开始时间/, /起始/] },
      { c: 'timeEnd', v: isPresentWord(r[1]) ? '' : r[1], pats: [/结束时间/] },
      { c: 'projDesc', v: [p.description].concat(p.duties || []).filter(Boolean).join('；'),
        pats: [/项目(描述|职责|内容|简介|介绍)/, /科研(描述|内容|经历)/] }
    ];
    pairs.forEach(function (q) {
      if (q.v == null || clean(q.v) === '') return;
      var nm = nameOf(q.c, k);
      var hit = pickBlock(k, q.pats);
      var taken = customUsed && k === 0 && (q.c === 'projDesc' || q.c === 'workDesc');
      if (hit) { plan.push({ x: hit, value: String(q.v), field: nm }); if (k === 0) usedFlat[nm] = 1; }
      else if (!taken && !deferrable(q.pats, k)) missed.push(nm);
    });
  });

  /* ---------- 5) 单值字段（不属于分段卡片的那些） ---------- */
  var SCALAR = [
    { key: 'name', pats: [/姓名/, /名字/, /全名/, /^name$/i] },
    { key: 'phone', pats: [/手机/, /电话/, /联系方式/, /mobile/i, /phone/i, /tel/i] },
    { key: 'email', pats: [/邮箱/, /e-?mail/i] },
    { key: 'gpa', pats: [/gpa/i, /绩点/] },
    { key: 'gradYear', pats: [/毕业(时间|年份|年月|日期)/, /graduation/i] },
    { key: 'gradEnd', pats: [/入学|就读(开始|起止)/] },
    { key: 'skills', pats: [/技能/, /特长/, /skill/i] },
    { key: 'intro', pats: [/自我(介绍|评价)/, /申请理由/, /个人简介/, /(求职|申请)信/, /cover ?letter/i, /introduction/i] }
  ];
  SCALAR.forEach(function (s) {
    var v = fields[s.key];
    if (v == null || clean(v) === '') return;
    var hit = pick(function (x) { return !!labelMatch(x, s.pats); });
    if (hit) { plan.push({ x: hit, value: String(v), field: s.key }); return; }
    if (!usedFlat[s.key] && !deferrable(s.pats, null)) missed.push(s.key);
  });

  /* ---------- 6) 执行 ---------- */
  plan.forEach(function (job) {
    var x = job.x, el = x.el, val = String(job.value);
    if (el.tagName === 'SELECT') {
      var opt = null, os = el.options || [];
      for (var q = 0; q < os.length; q++) {
        if (os[q].value === val || clean(os[q].textContent) === val) { opt = os[q]; break; }
      }
      if (!opt) {
        skipped.push({ field: job.field, value: val, reason: '下拉里没有这个选项，宁可漏填也不选错' });
        if (missed.indexOf(job.field) < 0) missed.push(job.field);
        return;
      }
      setNativeValue(el, opt.value !== '' ? opt.value : opt.textContent);
    } else {
      setNativeValue(el, job.value);
    }
    try {
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      el.dispatchEvent(new Event('blur', { bubbles: false }));
    } catch (e) { /* 老环境没有 Event 构造器就算了 */ }
    filled.push({ field: job.field, value: val.slice(0, 40), by: x.src, block: x.block });
  });

  return {
    ok: true, filled: filled, missed: missed, skipped: skipped, notice: notice,
    untouchedSubmit: true,
    custom: { used: !!customUsed, bullets: customUsed, version: (cust && cust.version) || '', where: customWhere }
  };
}

/* ============================================================
   职引 · 辅助填写（第二遍）：检索型下拉 + 日期选择器
   fillComboFields(opts) —— 处理 fillFromPayload 填不动的那些栏。

   为什么单开一遍、而且必须是异步的：
     「公司名称 / 学校名称 / 起止时间」这类栏在官网不是普通 input，
     而是**带检索的受控组件**（Ant Design Select、自研 AutoComplete、日期面板）。
     它们监听的是真实的交互序列，写 value 一律无效 —— 必须
       点开 → 逐字输入 → 等异步选项渲染出来 → 在选项上点击，
     而"等选项"天然是异步的。所以合并不进同步的 fillFromPayload，
     由 popup 先调同步那遍、再 await 这一遍。

   边界不变：不点提交；选项匹配不上就 Esc 关掉并记 missed（宁可漏填也不填错）。
   ============================================================ */
function fillComboFields(opts) {
  var o = opts || {};
  var doc = (typeof document !== 'undefined') ? document : null;
  if (!doc) return Promise.resolve({ ok: false, error: 'no document' });
  var raw = o.fields || {};
  var sec = o.sections || null;

  function clean(s) { return String(s == null ? '' : s).replace(/[\s\u00a0]+/g, ' ').trim(); }

  var fields = {};
  Object.keys(raw).forEach(function (k) { if (clean(raw[k]) !== '') fields[k] = raw[k]; });
  var edu0 = (sec && sec.education && sec.education[0]) || null;
  var work0 = (sec && sec.work && sec.work[0]) || null;
  if (edu0) {
    if (!fields.school && edu0.school) fields.school = edu0.school;
    if (!fields.major && edu0.major) fields.major = edu0.major;
    if (!fields.edu && edu0.degree) fields.edu = edu0.degree;
  }
  if (work0 && !fields.company && work0.company) fields.company = work0.company;
  if (work0 && !fields.role && work0.role) fields.role = work0.role;

  /* 哪些字段是"检索型 / 日期型"：只有这些才走这条路 */
  var scan = scanForm(doc);
  var results = { ok: true, filled: [], missed: [], handled: [], notice: [], untouchedSubmit: true };

  /* 第二遍只管两类栏：
     ① 带组件外壳的（下拉 / 级联 / 日期）—— 这类栏写 value 一律无效；
     ② 只读的日期框 —— 第一遍按 readOnly 跳过了，正是这里的正主。 */
  function avail(x) {
    if (!x || x.taken) return false;
    if (x.tag === 'input' && /^(submit|button|password|file|hidden|image|reset|radio|checkbox)$/.test(x.type)) return false;
    if (x.el.disabled) return false;
    /* 第一遍已经填过的普通输入框：有值就放过。
       下拉组件的内层 input 平时是空的（值显示在旁边的 span 里），所以
       这条不会挡住检索型下拉 —— 把已经填好的栏再打一遍才是真出错。 */
    if (!x.wrap && !x.el.readOnly && clean(x.el.value) !== '') return false;
    return true;
  }
  function pick(pred) {
    for (var i = 0; i < scan.length; i++) {
      var x = scan[i];
      if (avail(x) && pred(x)) { x.taken = true; results.handled.push(x.el); return x; }
    }
    return null;
  }

  var PAT_START = [/入学/, /开始时间/, /起始/, /入职/];
  var PAT_END = [/毕业/, /结束时间/, /离校/, /离职/];
  var jobs = [];
  function want(key, pats, val, isDate) {
    if (val == null || clean(val) === '') return;
    var hit = pick(function (x) { return !!labelMatch(x, pats); });
    if (hit) jobs.push({ x: hit, field: key, value: String(val), date: !!isDate });
  }

  /* 单值检索型：院校 / 专业 / 学历 / 公司 / 职位 */
  want('school', [/院校/, /学校/, /university/i, /college/i, /institute/i, /school/i], fields.school);
  want('major', [/专业/, /major/i], fields.major);
  want('edu', [/学历/, /文化程度/, /degree/i], fields.edu);
  want('company', [/公司/, /单位/, /用人单位/, /employer/i], fields.company);
  want('role', [/职位名称/, /岗位名称/, /职务/, /^职位$/, /^岗位$/], fields.role);
  /* 单值日期：载荷直接给了毕业/入学时间（没有结构化经历数据时走这里） */
  want('gradYear', [/毕业(时间|年份|年月|日期)/, /graduation/i], fields.gradYear, true);
  want('gradEnd', [/入学|就读(开始|起止)/], fields.gradEnd, true);

  /* 分段起止时间：第 k 段数据 → 页面上第 k 段（同名栏第 k 次出现）。
     美团那页有 2 段教育 / 2 段工作 / 2 段项目，每段都有「起止时间」，
     只有顺序能区分哪一对属于哪一段。 */
  var edu = (sec && sec.education) || [];
  var works = (sec && sec.work) || [];
  var projs = (sec && sec.projects) || [];
  function wantRange(list, tag, k) {
    var it = list[k];
    if (!it || !it.time) return;
    var r = timeRange(it.time);
    if (r[0]) {
      var h = pick(function (x) { return x.block === k && !!labelMatch(x, PAT_START); });
      if (h) jobs.push({ x: h, field: tag + 'Start', value: r[0], date: true });
      else results.missed.push({ field: tag + 'Start', value: r[0], reason: '页面上没有对应的开始时间栏' });
    }
    if (r[1] && !isPresentWord(r[1])) {
      var h2 = pick(function (x) { return x.block === k && !!labelMatch(x, PAT_END); });
      if (h2) jobs.push({ x: h2, field: tag + 'End', value: r[1], date: true });
      else results.missed.push({ field: tag + 'End', value: r[1], reason: '页面上没有对应的结束时间栏' });
    } else if (isPresentWord(r[1])) {
      results.notice.push('「' + clean(r[1]) + '」的结束时间不填 —— 这类表要在旁边勾「至今」，请手动勾一下');
    }
  }
  edu.forEach(function (e, k) { wantRange(edu, 'education', k); });
  works.forEach(function (w, k) { wantRange(works, 'work', k); });
  projs.forEach(function (p, k) { wantRange(projs, 'project', k); });

  /* 派发事件：受控组件靠 input 触发检索 / 认值；click 要靠完整的指针序列 */
  function fire(el, type, Ctor, extra) {
    try {
      var E = window[Ctor] || window.Event;
      var ev = extra ? new E(type, extra) : new E(type, { bubbles: true });
      el.dispatchEvent(ev);
    } catch (e) { /* 忽略 */ }
  }
  function mouse(el, type, extra) {
    var ex = Object.assign({ bubbles: true, cancelable: true, view: window, button: 0 }, extra || {});
    try { el.dispatchEvent(new window.MouseEvent(type, ex)); } catch (e) { fire(el, type, 'Event'); }
  }
  function key(el, k) {
    try {
      el.dispatchEvent(new window.KeyboardEvent('keydown', { key: k, code: k, bubbles: true, cancelable: true }));
      el.dispatchEvent(new window.KeyboardEvent('keyup', { key: k, code: k, bubbles: true, cancelable: true }));
    } catch (e) { /* 忽略 */ }
  }
  /* 真实用户是 pointerdown → mousedown → pointerup → mouseup → click。
     只派发 click 的话，很多组件根本不理你。 */
  function realClick(el) {
    if (!el) return;
    mouse(el, 'pointerdown'); mouse(el, 'mousedown');
    mouse(el, 'pointerup'); mouse(el, 'mouseup'); mouse(el, 'click');
    if (typeof el.focus === 'function') { try { el.focus(); } catch (e) { /* 忽略 */ } }
  }

  /* 面板选择器：Ant Design / Element / 美团自研 mtd-* / 各种自研 popup 都要认 */
  var PANEL_SEL = '.ant-select-dropdown, .ant-picker-dropdown, .el-select-dropdown, .el-picker-panel, ' +
    '.mtd-select-dropdown, .mtd-picker-panel, [class*="picker-panel"], [class*="date-panel"], ' +
    '[class*="calendar"], [class*="dropdown"], [class*="popup"], [class*="overlay"], ' +
    '[role="listbox"], [role="dialog"], .rc-virtual-list, ul[class*="option"], .select2-results, .v-menu__content';

  /* 元素是否"真的在屏幕上"。
     不能只看 offsetParent / getClientRects —— 无头环境里这两个都拿不到，
     会把刚弹出来的面板判成不可见（测试里就是这样卡住的）。
     用计算样式往上查 12 层：display:none / visibility:hidden 才算藏起来，
     查不到明确"隐藏"证据就按可见处理。 */
  function visible(el) {
    if (!el) return false;
    try {
      var w = el.ownerDocument && el.ownerDocument.defaultView;
      if (w && w.getComputedStyle) {
        var p = el;
        for (var d = 0; d < 12 && p; d++) {
          var cs = w.getComputedStyle(p);
          if (cs && (cs.display === 'none' || cs.visibility === 'hidden')) return false;
          p = p.parentElement;
        }
        return true;
      }
    } catch (e) { /* 拿不到计算样式就退回几何判据 */ }
    return el.offsetParent !== null || !!(el.getClientRects && el.getClientRects().length);
  }

  /* 点开之前先把"场面上已有的浮层"记下来。
     判据用的是 **新出现的浮层**，而不是"可见的浮层" —— 两个原因：
       ① antd / Element 会在页面里常驻一批隐藏的 dropdown 外壳，
          只看"可见"会把它们当成真面板；只看"新出现"就不会。
       ② 无头环境下（jsdom）offsetParent 恒为 null，可见性根本判不出来。
      两个条件取或：新出现的，或者确实可见的。 */
  function panelSet() {
    var ps = doc.querySelectorAll(PANEL_SEL), a = [];
    for (var i = 0; i < ps.length; i++) a.push(ps[i]);
    return a;
  }
  function fresh(p, before) {
    for (var i = 0; i < before.length; i++) { if (before[i] === p) return false; }
    return true;
  }

  /* 等面板 / 选项渲染出来：MutationObserver 抢第一帧，超时兜底轮询 */
  function sleep(ms) { return new Promise(function (r) { (window.setTimeout || setTimeout)(r, ms); }); }

  function waitForOptions(timeout, before) {
    before = before || [];
    return new Promise(function (resolve) {
      var done = false;
      var t0 = Date.now();
      function latest() {
        var ps = doc.querySelectorAll(PANEL_SEL);
        for (var i = ps.length - 1; i >= 0; i--) {
          if (fresh(ps[i], before) || visible(ps[i])) return ps[i];
        }
        return null;
      }
      function check() {
        if (done) return true;
        var panels = doc.querySelectorAll(PANEL_SEL);
        for (var i = panels.length - 1; i >= 0; i--) {
          var p = panels[i];
          if (!fresh(p, before) && !visible(p)) continue;
          var items = optionNodes(p);
          if (items.length) { done = true; resolve({ panel: p, items: items }); return true; }
        }
        /* 面板结构在但里面还没有可点的东西（日期面板很常见）：也算"弹出来了" */
        var lp = latest();
        if (lp && Date.now() - t0 > 140) { done = true; resolve({ panel: lp, items: optionNodes(lp) }); return true; }
        return false;
      }
      var mo = null;
      if (typeof window.MutationObserver === 'function') {
        mo = new window.MutationObserver(function () { if (check()) { try { mo.disconnect(); } catch (e) { /* 忽略 */ } } });
        try { mo.observe(doc.body || doc.documentElement, { childList: true, subtree: true }); } catch (e) { /* 忽略 */ }
      }
      var t = 0;
      (function tick() {
        if (done) { try { if (mo) mo.disconnect(); } catch (e) { /* 忽略 */ } return; }
        if (check()) return;
        t += 40;
        if (t >= timeout) { done = true; try { if (mo) mo.disconnect(); } catch (e) { /* 忽略 */ } return resolve(null); }
        Promise.resolve().then(function () { return sleep(40).then(tick); });
      })();
    });
  }

  function visiblePanel() {
    var ps = doc.querySelectorAll(PANEL_SEL);
    for (var i = ps.length - 1; i >= 0; i--) { if (visible(ps[i])) return ps[i]; }
    return null;
  }

  function optionNodes(panel) {
    if (!panel) return [];
    var sels = ['.ant-select-item-option', '.ant-select-item', '.ant-picker-cell', '.el-select-dropdown__item',
      '[role="option"]', 'li[class*="option"]', '.select2-results__option', '.v-list-item',
      '[class*="cell"]', '[class*="day"]', '[class*="item-option"]'];
    for (var i = 0; i < sels.length; i++) {
      var ns = panel.querySelectorAll(sels[i]);
      var vis = [];
      for (var j = 0; j < ns.length; j++) { if (clean(ns[j].textContent) && clean(ns[j].textContent).length <= 40) vis.push(ns[j]); }
      if (vis.length) return vis;
    }
    var all = panel.querySelectorAll('li, td, div, span');
    var out = [];
    for (var k = 0; k < all.length && out.length < 80; k++) {
      var tx = clean(all[k].textContent);
      if (tx && tx.length <= 40 && !all[k].querySelector('li, td, div, span')) out.push(all[k]);
    }
    return out;
  }

  /* 面板里找文本完全等于目标的那个节点，取**最内层**的（外层容器文本往往恰好也相等）。
     注意这里不做几何可见性判断：面板本身已经被确认为"刚弹出来的"，
     而它的格子多半是纯定位元素，几何量在无头环境里也拿不到。 */
  function findInPanel(panel, txt) {
    if (!panel) return null;
    var want = clean(txt);
    var all = null;
    try { all = panel.querySelectorAll('td, li, div, span, button, a'); } catch (e) { return null; }
    var best = null, bestKids = 1e9;
    for (var i = 0; i < all.length; i++) {
      var n = all[i];
      if (n.hidden) continue;
      var st = n.getAttribute && n.getAttribute('style');
      if (st && /display\s*:\s*none/i.test(st)) continue;
      if (clean(n.textContent) !== want) continue;
      var kids = n.querySelectorAll('*').length;
      if (kids < bestKids) { bestKids = kids; best = n; }
      if (kids === 0) break;
    }
    return best;
  }

  /* ---------- 日期面板：两种形态，都要认（第二十五轮据美团实测结构重写） ----------
     只读日期框写 value 是**假象** —— 原生 setter 改得动 DOM，但组件不读它，
     用户会以为填上了（假象比漏填更糟）。所以只能「点开面板 → 在面板里点」。

     ① 美团自研 mtd 的月历（zhaopin.meituan.com 实测）：
        默认列出**某一年的 12 个月**；标题里的「2026年」是个按钮，
        点它才切到**年份列表**（一页 12 年：页眉写着 2020-2029，
        两侧 left-switcher / right-switcher 翻页）→ 点年份回到月份 → 点「N月」落值。
        所以"找年份"这一步在美团这里是**两步**（先展开年份列表，再翻页找到它），
        和 antd 那种"年份格直接可点"不是一回事。
     ② antd / Element 的「年 → 月」两级格子：年份可以直接点，走通用分支。

     两条路最后都**验收**：值必须真的落到输入框里。落不上就如实报失败 ——
     不说"填好了"（假象比漏填更糟这条，对汇报口径同样成立）。 */

  /* 美团的类名都挂在**叶子**上（月份格自己带 mtd-month-panel-list-data），
     所以一律用"class 包含"来查，容器/叶子两种写法都吃得下。 */
  var MTD_MCELL = '[class*="mtd-month-panel-list-data"]';
  var MTD_YCELL = '[class*="mtd-year-panel-list-data"]';
  var MTD_YBTN = '[class*="mtd-month-calendar-year-btn"]';
  var MTD_RANGE = '[class*="mtd-month-calendar-year-header-range"]';
  var MTD_YSW = '[class*="mtd-month-calendar-year-switcher"]';

  /* 认得出是美团月历吗？认得出就返回它的层级信息（当前显示哪一年的月份）。 */
  function mtdPanelInfo(panel) {
    if (!panel || !panel.querySelector) return null;
    var mCells = panel.querySelectorAll(MTD_MCELL);
    var yCells = panel.querySelectorAll(MTD_YCELL);
    var yBtn = panel.querySelector(MTD_YBTN);
    if (!mCells.length && !yCells.length && !yBtn) return null;
    var t = clean(yBtn && yBtn.textContent) || clean((panel.querySelector(MTD_RANGE) || {}).textContent);
    var m = t.match(/(\d{4})/);
    return { year: m ? parseInt(m[1], 10) : 0, months: mCells.length, years: yCells.length, yearBtn: yBtn || null };
  }

  /* 别被图标骗了：美团的日历图标 class 是 mtdicon-calendar-o，
     也命中 PANEL_SEL 里的 [class*="calendar"]，但它里面一个月都没有。
     这里把浮层归一到**真正的面板容器**：优先 .mtd-month-calendar，
     其次"含月份格 / 年份格的最近祖先"；都不是就用刚弹出来的那个（antd / Element 走这条）。 */
  function monthPanelRoot(fallback) {
    var ps = doc.querySelectorAll(PANEL_SEL);
    for (var i = ps.length - 1; i >= 0; i--) {
      var p = ps[i];
      if (!p.querySelector || !visible(p)) continue;
      if (!p.querySelector(MTD_MCELL + ', ' + MTD_YCELL)) continue;
      try { return p.closest ? (p.closest('.mtd-month-calendar') || p) : p; } catch (e) { return p; }
    }
    return fallback || null;
  }

  /* 年份是分页的（一页 12 年）：目标年不在这一页就用两侧箭头翻过去。
     每翻一页节点会被重建，所以每轮都重新查一遍。 */
  function mtdYearRange(panel) {
    var cells = panel.querySelectorAll(MTD_YCELL), ys = [];
    for (var i = 0; i < cells.length; i++) {
      var n = clean(cells[i].textContent);
      if (/^\d{4}$/.test(n)) ys.push(parseInt(n, 10));
    }
    if (ys.length) return { lo: Math.min.apply(null, ys), hi: Math.max.apply(null, ys) };
    var rg = clean((panel.querySelector(MTD_RANGE) || {}).textContent);
    var m = rg.match(/(\d{4})\D+(\d{4})/);
    if (m) return { lo: parseInt(m[1], 10), hi: parseInt(m[2], 10) };
    return null;
  }

  /* 在年份列表里找目标年。类挂在容器上（格子是 li）时，退到子树里按文本找最内层。 */
  function mtdYearCell(panel, want) {
    var cells = panel.querySelectorAll(MTD_YCELL), i;
    for (i = 0; i < cells.length; i++) { if (clean(cells[i].textContent) === String(want)) return cells[i]; }
    for (i = 0; i < cells.length; i++) {
      var hit = findInPanel(cells[i], String(want));
      if (hit) return hit;
    }
    return null;
  }

  function mtdMonthCell(panel, mo) {
    var want = mo + '月', cells = panel.querySelectorAll(MTD_MCELL), i;
    for (i = 0; i < cells.length; i++) { if (clean(cells[i].textContent) === want) return cells[i]; }
    for (i = 0; i < cells.length; i++) {
      var hit = findInPanel(cells[i], want);
      if (hit) return hit;
    }
    return findInPanel(panel, want);
  }

  function mtdPageToYear(getPanel, want) {
    var tries = 0;
    function step() {
      var panel = getPanel();
      if (!panel) return Promise.resolve(null);
      var cell = mtdYearCell(panel, want);
      if (cell || tries >= 8) return Promise.resolve(cell);
      var rg = mtdYearRange(panel);
      if (!rg) return Promise.resolve(null);
      var dir = want < rg.lo ? 'left' : (want > rg.hi ? 'right' : '');
      if (!dir) return Promise.resolve(null);
      var sw = null;
      try { sw = panel.querySelector(MTD_YSW + '.' + dir + '-switcher') || panel.querySelector('[class*="' + dir + '-switcher"]'); } catch (e) { sw = null; }
      if (!sw) return Promise.resolve(null);
      tries++;
      realClick(sw);
      return sleep(190).then(step);
    }
    return step();
  }

  function pickMtdMonth(wantY, wantM, panel0) {
    var steps = [];
    function now() { return monthPanelRoot(visiblePanel() || panel0) || panel0; }
    var info = mtdPanelInfo(panel0);
    var pre;
    if (info && info.year === wantY) {
      pre = Promise.resolve({ ok: true });           /* 已经就是这一年的月份，不用切 */
    } else {
      pre = sleep(60).then(function () {
        var yb = now().querySelector(MTD_YBTN);
        if (!yb) return { stop: true, reason: '认得出是美团月历，但找不到切年份的按钮' };
        realClick(yb); steps.push('展开年份');
        return sleep(220).then(function () { return { ok: true }; });
      }).then(function (r) {
        if (r && r.stop) return r;
        return mtdPageToYear(now, wantY).then(function (cell) {
          if (!cell) return { stop: true, reason: '年份列表里翻不到 ' + wantY + ' 年' };
          realClick(cell); steps.push('选年 ' + wantY);
          return sleep(220).then(function () { return { ok: true }; });
        });
      });
    }
    return pre.then(function (r) {
      if (r && r.stop) return { ok: false, steps: steps, reason: r.reason };
      if (!wantM) return { ok: true, steps: steps };
      var cell = mtdMonthCell(now(), wantM);
      if (!cell) return { ok: false, steps: steps, reason: '月份格里找不到 ' + wantM + '月' };
      realClick(cell); steps.push('选月 ' + wantM);
      return sleep(160).then(function () { return { ok: true, steps: steps }; });
    });
  }

  /* antd / Element 那一类：年份格直接可点，点完再点月份 */
  function pickGenericMonth(wantY, wantM, panel0) {
    var steps = [];
    function now() { return visiblePanel() || panel0; }
    var yHit = findInPanel(panel0, wantY) || findInPanel(panel0, wantY + '年');
    if (yHit) { realClick(yHit); steps.push('选年 ' + wantY); }
    return sleep(200).then(function () {
      if (!wantM) return { ok: true, steps: steps };
      var p2 = now();
      var cell = findInPanel(p2, wantM + '月') || findInPanel(p2, wantM + '月份') || findInPanel(p2, wantM);
      if (!cell) return { ok: false, steps: steps, reason: '面板里找不到月份 ' + wantM + '（年份也没找全）' };
      realClick(cell); steps.push('选月 ' + wantM);
      return sleep(140).then(function () { return { ok: true, steps: steps }; });
    });
  }

  function ymOf(v) {
    var m = clean(v).match(/(\d{4})\s*[.\-\/年]?\s*(\d{1,2})?/);
    if (!m) return null;
    return { y: String(parseInt(m[1], 10)), m: m[2] ? String(parseInt(m[2], 10)) : '' };
  }
  /* 期望的最终样子（YYYY-MM）。报错文案要给人看，所以月份补零。 */
  function ymWant(ym) { return ym.y + (ym.m ? '-' + (ym.m.length < 2 ? '0' + ym.m : ym.m) : ''); }
  /* 值真的落上了吗？有的组件会省前导零（2022-3），所以两种写法都认。 */
  function landed(el, ym) {
    var shown = clean(el.value), d = shown.replace(/\D/g, '');
    if (!d) return false;
    if (d.indexOf(ymWant(ym).replace(/\D/g, '')) >= 0) return true;
    if (ym.m) {
      if (d.slice(0, 4) !== ym.y) return false;
      return new RegExp('(^|[^0-9])' + ym.m + '([^0-9]|$)').test(shown);
    }
    return d.slice(0, 4) === ym.y;
  }

  function pickDateFromPanel(job, x) {
    var inner = x.el, wrap = x.wrap || inner;
    var ym = ymOf(job.value);
    if (!ym) return Promise.resolve({ ok: false, reason: '日期格式认不出：' + clean(job.value) });
    /* 「一屏只有一个面板」是这类组件的常态（用户实测：日期栏点开一个，点第二个时前一个就收了）。
       开新的之前先把旧的收掉，否则很可能把月份点进上一个栏的面板里 ——
       表现就是"只填上了一个"。 */
    key(inner, 'Escape');
    return sleep(80).then(function () {
      var before = panelSet();
      realClick(wrap);
      if (typeof inner.focus === 'function') { try { inner.focus(); } catch (e) { /* 忽略 */ } }
      return waitForOptions(1000, before).then(function (found) {
        if (!found || !found.panel) {
          key(inner, 'Escape');
          return { ok: false, reason: '日期面板没弹出来（这家组件可能拦合成事件）' };
        }
        var panel = monthPanelRoot(found.panel);
        var flow = mtdPanelInfo(panel) ? pickMtdMonth(ym.y, ym.m, panel)
          : pickGenericMonth(ym.y, ym.m, panel);
        return flow.then(function (r) {
          if (!r.ok) { key(inner, 'Escape'); return r; }
          var tries = 0;
          function check() {
            if (landed(inner, ym)) {
              /* 面板只到「月」而载荷给到「日」时：值确实落上了，但日期部分丢了。
                 这不算填完整，得说出来 —— 不声不响地少一位比明说更糟。 */
              var n = [];
              if (/\d{4}\D\d{1,2}\D\d{1,2}/.test(clean(job.value)) && !/\d{4}\D\d{1,2}\D\d{1,2}/.test(clean(inner.value))) {
                n.push('「' + clean(job.value) + '」这一栏的面板只到「月」，已填 ' + clean(inner.value) + '，日期部分请手动补一下');
              }
              return { ok: true, steps: r.steps, shown: clean(inner.value), notice: n };
            }
            /* 点过了不等于填上了：组件不吃合成事件时，DOM 上什么都不会变。
               如实报失败并把"面板长什么样"带上，比说"填好了"有用得多。 */
            if (tries >= 4) {
              return {
                ok: false, steps: r.steps,
                reason: '面板里点了（' + (r.steps || []).join(' → ') + '），但输入框没变成 ' + ymWant(ym) +
                  '，当前是「' + clean(inner.value) + '」—— 请手动选一下'
              };
            }
            tries++;
            return sleep(150).then(check);
          }
          return check();
        });
      });
    });
  }

  /* 选项文本与目标值的匹配：完全相等 > 以目标开头 > 目标以其开头 > 包含。
     包含是最松的一档，只在前面的都落空时才用 —— 避免 "北京大学" 命中 "北京大学附属中学"。 */
  function matchOption(items, val) {
    var v = clean(val).replace(/\s/g, '');
    var best = null, bestRank = 99;
    for (var i = 0; i < items.length; i++) {
      var tx = clean(items[i].textContent);
      if (!tx) continue;
      var t = tx.replace(/\s/g, '');
      var rank = 99;
      if (t === v) rank = 0;
      else if (t.indexOf(v) === 0) rank = 2;
      else if (v.indexOf(t) === 0 && t.length >= 2) rank = 3;
      else if (t.indexOf(v) >= 0) rank = 4;
      if (rank < bestRank) { bestRank = rank; best = items[i]; }
      if (rank === 0) break;
    }
    return bestRank <= 4 ? best : null;
  }

  /* 日期面板的候选格式：不同组件吃不同的写法，逐个试 */
  function dateCandidates(v) {
    var s = clean(v);
    var ym = s.match(/(\d{4})\s*[.\-\/年]\s*(\d{1,2})/);
    var out = [s];
    if (ym) {
      var y = ym[1], mo = String(parseInt(ym[2], 10));
      var m2 = mo.length < 2 ? '0' + mo : mo;
      out.push(y + '-' + m2, y + '/' + m2, y + '.' + m2, y + '年' + mo + '月', y + '-' + m2 + '-01');
    }
    return out.filter(function (x, i, a) { return x && a.indexOf(x) === i; });
  }

  function runJob(idx) {
    if (idx >= jobs.length) return Promise.resolve();
    var job = jobs[idx];
    var x = job.x, inner = x.el, wrap = x.wrap;
    var isDate = job.date || !!(wrap && /picker|date|calendar/i.test(String(wrap.className || '')));
    var next = function () { return runJob(idx + 1); };

    /* A 原生 select：选项对得上才动 */
    if (inner.tagName === 'SELECT') {
      var vv = clean(job.value), opt = null, os = inner.options || [];
      for (var q = 0; q < os.length; q++) {
        var ot = clean(os[q].textContent);
        if (os[q].value === vv || ot === vv || (ot && (ot.indexOf(vv) >= 0 || vv.indexOf(ot) >= 0))) { opt = os[q]; break; }
      }
      if (opt) {
        setNativeValue(inner, opt.value !== '' ? opt.value : opt.textContent);
        fire(inner, 'input', 'Event'); fire(inner, 'change', 'Event');
        results.filled.push({ field: job.field, value: vv, how: 'select' });
      } else {
        results.missed.push({ field: job.field, value: vv, reason: '下拉里没有这个选项' });
      }
      return next();
    }

    /* B 日期 */
    if (isDate) {
      if (inner.readOnly) {
        return pickDateFromPanel(job, x).then(function (r) {
          if (r.ok) {
            results.filled.push({ field: job.field, value: clean(job.value), how: 'date-panel', steps: r.steps, shown: r.shown });
            if (r.notice && r.notice.length) results.notice = results.notice.concat(r.notice);
          } else results.missed.push({ field: job.field, value: clean(job.value), reason: r.reason });
          return next();
        });
      }
      realClick(wrap || inner);
      var cands = dateCandidates(job.value), okSet = false;
      for (var c = 0; c < cands.length && !okSet; c++) {
        setNativeValue(inner, cands[c]);
        fire(inner, 'input', 'Event');
        key(inner, 'Enter');
        fire(inner, 'change', 'Event');
        if (clean(inner.value) !== '') okSet = true;
      }
      if (doc.activeElement && doc.activeElement.blur) { try { doc.activeElement.blur(); } catch (e) { /* 忽略 */ } }
      key(inner, 'Escape');
      if (okSet) results.filled.push({ field: job.field, value: clean(inner.value), how: 'date' });
      else results.missed.push({ field: job.field, value: clean(job.value), reason: '日期栏写不进去（面板需要手动选）' });
      return next();
    }

    /* C 检索型下拉 —— 点开 → 逐字输入 → 等选项 → 点中 */
    var beforeC = panelSet();
    realClick(wrap || inner);
    if (typeof inner.focus === 'function') { try { inner.focus(); } catch (e) { /* 忽略 */ } }
    var probeVal = clean(job.value);
    inner.value = '';
    var chars = probeVal.slice(0, 12).split('');
    for (var ci = 0; ci < chars.length; ci++) {
      inner.value = inner.value + chars[ci];
      fire(inner, 'input', 'Event');
    }
    if (chars.length === 0) { setNativeValue(inner, probeVal); fire(inner, 'input', 'Event'); }

    return waitForOptions(800, beforeC).then(function (found) {
      var pickEl = found ? matchOption(found.items, probeVal) : null;
      if (pickEl) {
        realClick(pickEl);
        fire(pickEl, 'click', 'MouseEvent', { bubbles: true });
        var shown = clean(inner.value) || clean((wrap || inner).textContent);
        results.filled.push({ field: job.field, value: clean(pickEl.textContent).slice(0, 40), how: 'combobox', shown: shown.slice(0, 40) });
      } else {
        key(inner, 'Escape');
        fire(inner, 'blur', 'Event');
        results.missed.push({
          field: job.field, value: probeVal,
          reason: found ? '下拉里没找到匹配项（选项名可能不同，请手动选）' : '点了但下拉没弹出来（该组件可能拦合成事件）'
        });
      }
      return next();
    });
  }

  return runJob(0).then(function () { return results; });
}


/* ============================================================
   职引 · 表单结构探针（第二十二轮起 · 二十三 → v2 · 二十五 → v3）
   probeForm() —— 不是填表，是"看清楚这张表长什么样"。

   为什么需要它：辅助填写填不上的栏（公司名称 / 学校名称 / 起止时间），
   每一家的组件都不一样 —— 有的用 Ant Design Select、有的自研 AutoComplete、
   有的把日期藏在只读 input + 面板后面。只靠通用启发式永远有漏网的。

   v2 补了三样（都是美团 zhaopin.meituan.com 那份实测数据逼出来的）：
     ① uiKit —— 直接告诉你这家是不是我适配过的那两套（antd / element）。
        美团是自研的 mtd-，那就别指望通用规则一次到位。
     ② guess / labels —— 探针**自己认为这栏叫什么、依据是什么**。
        上一版只给原始来源映射，我还得自己推断；现在它直接给结论 + 全部候选。
     ③ panels —— 当前屏幕上可见的浮层。**把日期框点开再跑一次探针**，
        日期面板的结构就在这里面。这是"日期栏为什么点不动"的最终答案。
     ④ block —— 同名栏是第几次出现。多段经历只有顺序能区分。

   v3（第二十五轮，拿到美团**面板打开状态**的那份 JSON 之后）：
     ⑤ panels 里多了 kind / yearBtn / range / switchers / cellCount ——
        美团月历是"月 → 年"两级（标题上的「2026年」是个按钮，点它才出年份列表，
        一页 12 年、两侧箭头翻页）。这件事 v2 只能靠人猜 nodeCls，现在数据里直接写清楚。
        顺带把纯图标浮层过滤掉了：日历图标 mtdicon-calendar-o 也命中 [class*="calendar"]，
        但它没文字没类名，报出来只会淹掉真面板。

   只读：不改 DOM、不填值、不点任何东西。
   ============================================================ */
function probeForm() {
  var doc = (typeof document !== 'undefined') ? document : null;
  if (!doc) return { ok: false, error: 'no document' };
  function clean(s) { return String(s == null ? '' : s).replace(/[\s\u00a0]+/g, ' ').trim(); }
  function cls(el) {
    var c = clean(el.className);
    return (typeof c === 'string' ? c : '').split(/\s+/).filter(Boolean).slice(0, 6).join(' ');
  }
  /* 元素是否"真的在屏幕上"。**不能**用 offsetParent / getClientRects ——
     无头环境（自测用的 jsdom）里这两个恒为空，会把刚弹出来的面板判成不可见，
     于是 panels 永远是空数组（第二十五轮自测抓到的：探针 v3 断言全红，原因就在这）。
     改成计算样式往上查 12 层：display:none / visibility:hidden 才算藏起来。 */
  function shown(el) {
    if (!el) return false;
    try {
      var w = el.ownerDocument && el.ownerDocument.defaultView;
      if (w && w.getComputedStyle) {
        var p = el;
        for (var d = 0; d < 12 && p; d++) {
          var cs = w.getComputedStyle(p);
          if (cs && (cs.display === 'none' || cs.visibility === 'hidden')) return false;
          p = p.parentElement;
        }
        return true;
      }
    } catch (e) { /* 拿不到计算样式就退回几何判据 */ }
    return el.offsetParent !== null || !!(el.getClientRects && el.getClientRects().length);
  }

  /* UI 库签名：一眼看出"这家是不是我适配过的那两套"。
     美团是 mtd-（自研），通用规则不会一次到位 —— 先把这件事说清楚。 */
  var KITS = [
    { name: 'antd', sel: '[class^="ant-"], [class*=" ant-"]' },
    { name: 'element-ui', sel: '.el-form-item, .el-input, .el-select, .el-date-editor' },
    { name: 'mtd（自研）', sel: '[class^="mtd-"], [class*=" mtd-"]' },
    { name: 'arco', sel: '.arco-form, .arco-input, .arco-select' },
    { name: 'vant', sel: '.van-field, .van-cell' }
  ];
  var uiKit = [];
  KITS.forEach(function (k) {
    try { if (doc.querySelector(k.sel)) uiKit.push(k.name); } catch (e) { /* 忽略 */ }
  });
  var kit = uiKit.length ? uiKit.join(' + ') : (doc.querySelectorAll('form').length ? '原生 form' : '未识别（自研组件）');

  var framework = 'unknown';
  try {
    if (doc.querySelector('[data-reactroot], #root, #__next')) framework = 'react';
    if (doc.querySelector('[data-v-app], [data-vue-app], #app[data-v-]')) framework = 'vue';
  } catch (e) { /* 忽略 */ }

  /* 标签的可能来源，逐个标出"命中了哪个" —— 填不上时最需要的就是这个 */
  function labelSources(el) {
    var src = {};
    if (el.id) {
      var lb = doc.querySelector('label[for="' + el.id + '"]');
      if (lb) src['label[for]'] = clean(lb.textContent).slice(0, 30);
    }
    ['aria-label', 'placeholder', 'name', 'title', 'id'].forEach(function (a) {
      var v = el.getAttribute ? el.getAttribute(a) : null;
      if (v) src[a] = clean(v).slice(0, 30);
    });
    if (el.closest) { var w = el.closest('label'); if (w) src['wrap-label'] = clean(w.textContent).slice(0, 30); }
    var prev = el.previousElementSibling;
    if (prev && /^(LABEL|SPAN|DIV|P|TD|TH|DT|DD|H\d)$/.test(prev.tagName)) {
      var pt = clean(prev.textContent); if (pt && pt.length <= 20) src['prev-sibling'] = pt;
    }
    var node = el.parentElement;
    for (var d = 0; d < 5 && node && node !== doc.body; d++) {
      var t = labelNodeIn(node, el) || shortTextIn(node, el);
      if (t) src['up' + (d + 1)] = t.slice(0, 30);
      node = node.parentElement;
    }
    return src;
  }

  var scan = scanForm(doc);

  /* 重复 id：id 撞了 label[for] 就会抓错栏（美团那页的「至今」勾选框 id 就重了） */
  var idCount = {};
  scan.forEach(function (x) { if (x.el.id) idCount[x.el.id] = (idCount[x.el.id] || 0) + 1; });
  var dupIds = {};
  Object.keys(idCount).forEach(function (k) { if (idCount[k] > 1) dupIds[k] = idCount[k]; });

  var LIMIT = 140;
  var out = [];
  scan.forEach(function (x) {
    if (out.length >= LIMIT) return;
    var el = x.el;
    var item = {
      i: out.length,
      tag: x.tag,
      type: x.type,
      cls: cls(el),
      id: el.id || '',
      name: (el.getAttribute && el.getAttribute('name')) || '',
      role: (el.getAttribute && el.getAttribute('role')) || '',
      hasPopup: (el.getAttribute && el.getAttribute('aria-haspopup')) || '',
      expanded: (el.getAttribute && el.getAttribute('aria-expanded')) || '',
      autocomplete: (el.getAttribute && el.getAttribute('autocomplete')) || '',
      readOnly: !!el.readOnly,
      disabled: !!el.disabled,
      required: !!el.required,
      /* 同名栏第几次出现 —— 多段经历（2 段教育 / 2 段工作 / 2 段项目）靠它顺序对上。
         sect 是"它被归到哪个栏目"（edu / work / proj / …），段号在栏目内计数。 */
      sect: x.sect,
      block: x.block,
      /* 探针自己的判断：这栏叫什么、依据什么信它（rank 越小越可信；null = 完全认不出来） */
      guess: x.label ? { text: x.label, from: x.src, rank: x.rank } : null,
      /* 全部候选标签，按可信度排序 —— "它到底认成了什么"就藏在这里 */
      labels: (x.list || []).map(function (c) { return c.t + ' ‹' + c.src + '›'; }),
      label: labelSources(el)      /* 兼容上一版的原始来源映射 */
    };
    if (x.wrap) {
      item.wrapper = { sel: x.wrapSel, cls: cls(x.wrap), role: clean(x.wrap.getAttribute && x.wrap.getAttribute('role')) };
      /* antd 把 role / aria-haspopup 挂在组件外壳上，不在 input 上 ——
         只读 input 自身的属性会以为"这栏没什么特别"，而它恰恰就是填不动的那栏 */
      if (!item.role) item.role = item.wrapper.role || '';
      if (!item.hasPopup) {
        try { var hp = el.closest('[aria-haspopup]'); if (hp) item.hasPopup = hp.getAttribute('aria-haspopup'); } catch (e) { /* 忽略 */ }
      }
    }
    if (el.tagName === 'SELECT') {
      item.optionCount = (el.options || []).length;
      var sam = []; for (var k = 0; k < el.options.length && k < 6; k++) sam.push(clean(el.options[k].textContent));
      item.optionsSample = sam;
    }
    out.push(item);
  });

  /* 只列出"值得一提"的组件：检索型 / 日期型 / 只读但带下拉 */
  var rich = out.filter(function (x) {
    return x.wrapper && (/select|picker|date|calendar|combobox|dropdown|cascader/i.test(x.wrapper.sel) || x.hasPopup);
  });

  /* 当前屏幕上可见的浮层 / 面板。
     用户把日期框点开后再跑一次探测，这份数据就告诉我这家的日期面板长什么样 ——
     这才是"日期栏为什么点不动"的最终答案。 */
  var PANEL_SEL = '.ant-select-dropdown, .ant-picker-dropdown, .el-select-dropdown, .el-picker-panel, ' +
    '.mtd-select-dropdown, .mtd-picker-panel, [class*="picker-panel"], [class*="date-panel"], ' +
    '[class*="calendar"], [class*="dropdown"], [class*="popup"], [class*="overlay"], ' +
    '[role="listbox"], [role="dialog"]';
  var panels = [];
  try {
    var ps = doc.querySelectorAll(PANEL_SEL);
    for (var pi = 0; pi < ps.length && panels.length < 8; pi++) {
      var p = ps[pi];
      if (!shown(p)) continue;
      var cand = p.querySelectorAll('td, li, div, span, button, a');
      var nodes = [], nodeCls = [];
      for (var ci = 0; ci < cand.length && nodes.length < 20; ci++) {
        var n = cand[ci];
        if (n.querySelector && n.querySelector('td, li, div, span')) continue;
        var t = clean(n.textContent);
        if (!t || t.length > 20) continue;
        nodes.push(t);
        var c = cls(n); if (c && nodeCls.indexOf(c) < 0) nodeCls.push(c);
      }
      var textSample = clean(p.textContent).slice(0, 140);
      /* 纯图标浮层别报：美团的日历图标 class 是 mtdicon-calendar-o，
         也命中 [class*="calendar"]，但它没文字没类名 —— 报出来只会淹掉真面板。 */
      if (!textSample && !nodeCls.length && !nodes.length) continue;
      /* 面板的"层级"信息：v3 补的。美团月历要看得出「月份格 / 年份格 / 年份按钮 / 翻页箭头」
         分别是哪几个节点 —— 上一份数据里这四样混在 nodeCls 里，还得靠人猜。 */
      var yBtn = p.querySelector('[class*="mtd-month-calendar-year-btn"]');
      var rgEl = p.querySelector('[class*="mtd-month-calendar-year-header-range"]');
      var sws = p.querySelectorAll('[class*="mtd-month-calendar-year-switcher"]');
      var swCls = [];
      for (var si = 0; si < sws.length; si++) { var sc = cls(sws[si]); if (sc && swCls.indexOf(sc) < 0) swCls.push(sc); }
      var mCells = p.querySelectorAll('[class*="mtd-month-panel-list-data"]').length;
      var yCells = p.querySelectorAll('[class*="mtd-year-panel-list-data"]').length;
      panels.push({
        cls: cls(p),
        kind: (mCells || yCells) ? 'mtd-month-calendar（美团月历：月/年两级）' : '',
        yearBtn: clean(yBtn && yBtn.textContent).slice(0, 20),
        range: clean(rgEl && rgEl.textContent).slice(0, 20),
        switchers: swCls.slice(0, 4),
        cellCount: { month: mCells, year: yCells },
        role: clean(p.getAttribute && p.getAttribute('role')),
        textSample: textSample,
        nodeCls: nodeCls.slice(0, 8),
        nodes: nodes.slice(0, 18)
      });
    }
  } catch (e) { /* 忽略 */ }

  return {
    ok: true,
    url: (typeof location !== 'undefined') ? location.href : '',
    host: (typeof location !== 'undefined') ? location.host : '',
    title: doc.title || '',
    uiKit: kit,
    framework: framework,
    formCount: doc.querySelectorAll('form').length,
    controlCount: scan.length,
    truncated: scan.length > LIMIT,
    richCount: rich.length,
    dupIds: dupIds,
    panels: panels,
    hint: '有栏填不动？① 先把它点开（让下拉 / 日期面板弹出来）② 再点一次「探测表单结构」' +
      '③ 把这份 JSON 复制发我 —— 面板结构就在 panels 里。' +
      '同一时刻只会有 1 个浮层（点第二个栏时前一个就收了），所以有几个日期栏就分几次探，只探到一个也够。',
    controls: out,
    rich: rich
  };
}

if (typeof module !== 'undefined' && module.exports) { module.exports = { collectFromPage: collectFromPage, collectReceipt: collectReceipt, collectJobs: collectJobs, fillFromPayload: fillFromPayload, fillComboFields: fillComboFields, probeForm: probeForm, collectPrograms: collectPrograms }; }
