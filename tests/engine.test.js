/* ============================================================
   职引 · 引擎自测（无头，不需要浏览器）
   用法：node tests/engine.test.js
   作用：把原型的纯逻辑层切出来直接调用，验证解析 / 评分 / 匹配 / 排序。
        界面不会报错的算法问题，只能靠这里的输出发现。
   ============================================================ */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const HTML = path.join(__dirname, '..', 'index.html');
if (!fs.existsSync(HTML)) {
  console.error('[x] 找不到原型文件：' + HTML);
  process.exit(2);
}
const html = fs.readFileSync(HTML, 'utf8');
const js = html.match(/<script>([\s\S]*?)<\/script>/)[1];

/* 只取纯逻辑部分：切到「渲染」之前，避开所有 DOM 调用 */
const CUT = '/* ---------- 15.';
const idx = js.indexOf(CUT);
if (idx < 0) {
  console.error('[x] 找不到切分标记 ' + CUT + '（原型结构可能已变，请更新本脚本）');
  process.exit(2);
}
const core = js.slice(0, idx);

const EXTRA = {
  DEFAULT_SORT_IS_SCORE: /studySort:\s*'score'/.test(js),
  HTML_CHARS: html.length,
  JS_CHARS: js.length
};

const BODY = `
const out = [];
let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; out.push('  [PASS] ' + name); }
  else { fail++; out.push('  [FAIL] ' + name + (extra ? '  -> ' + extra : '')); }
}

out.push('=== 1. 专业解析精度（防「别处关键词」污染） ===');
const t1 = [
  '姓名：张雨桐',
  '手机：13800001111',
  '【教育背景】',
  '2024.09 - 2027.06  香港中文大学  健康科学与管理  硕士研究生  GPA 3.4/4.0',
  '2020.09 - 2024.06  中山大学  公共事业管理  本科  GPA 3.5/4.0',
  '【专业技能】',
  'Python、人工智能、数据分析、SQL',
  '【求职意向】',
  '健康管理 / 医疗运营方向'
].join('\\n');
const r1 = parseResume(t1);
ok('专业=「健康科学与管理」，未被技能栏的「人工智能」污染', r1.profile.major === '健康科学与管理', 'got=' + r1.profile.major);
ok('该字段置信度为 auto', r1.meta.major === 'auto', 'got=' + r1.meta.major);
ok('技能仍正常识别到人工智能', r1.profile.skills.indexOf('人工智能') >= 0);

const t2 = [
  '姓名：李一',
  '【教育背景】',
  '2023.09 - 2026.06  浙江大学  数字人文与计算传播  硕士  GPA 3.6/4.0',
  '【专业技能】',
  '数据分析'
].join('\\n');
const r2 = parseResume(t2);
ok('词典未收录时走结构提取并标「待确认」', r2.meta.major === 'guess', 'got=' + r2.meta.major);
ok('结构提取拿到专业名而非校名/学历', r2.profile.major === '数字人文与计算传播', 'got=' + r2.profile.major);

const t3 = [
  '姓名：王一',
  '【教育背景】',
  '2023.09 - 2026.06  浙江大学  硕士研究生  GPA 3.6/4.0',
  '【专业技能】',
  '人工智能、机器学习、深度学习'
].join('\\n');
const r3 = parseResume(t3);
ok('完全无专业信息时标「待补充」，不做全文兜底', r3.meta.major === 'miss' && !r3.profile.major, 'got=' + r3.meta.major + '/' + r3.profile.major);

const r4 = parseResume(SAMPLES[2].text);
ok('回归：电子信息工程未被岗位名「嵌入式软件工程师」污染', r4.profile.major === '电子信息工程', 'got=' + r4.profile.major);

out.push('');
out.push('=== 2. 技能短词匹配（防单字母脏标签） ===');
const allSkills = SAMPLES.map(s => parseResume(s.text).profile.skills);
ok('不再凭空出现单字母「C」', allSkills.every(a => a.indexOf('C') < 0));
ok('不再凭空出现单字母「R」', allSkills.every(a => a.indexOf('R') < 0));
SAMPLES.forEach(function (s, i) {
  out.push('  样本' + (i + 1) + ' 技能(' + allSkills[i].length + ')：' + allSkills[i].join('、'));
});

out.push('');
out.push('=== 3. 三份示例简历字段回归 ===');
SAMPLES.forEach(function (s, i) {
  const r = parseResume(s.text);
  const f = phdFit(r.profile);
  const missN = Object.keys(r.meta).filter(k => r.meta[k] === 'miss').length;
  out.push('  样本' + (i + 1) + ' 姓名=' + r.profile.name + ' 学历=' + r.profile.edu + ' 院校=' + r.profile.school +
    ' 专业=' + r.profile.major + '(' + r.meta.major + ')' + ' GPA=' + r.profile.gpa + ' 毕业=' + r.profile.gradYear +
    ' 论文=' + r.profile.papers + ' 待补充=' + missN + ' 适配度=' + f.total);
});
ok('三份样本专业均识别成功', SAMPLES.every(s => parseResume(s.text).profile.major));

out.push('');
out.push('=== 4. 申学列表默认按匹配分降序 ===');
ok('defaultState() 自带 filters，默认即匹配度降序', defaultState().filters.studySort === 'score', 'got=' + defaultState().filters.studySort);
ok('源码中没有会被 load() 覆盖的顶层 state.filters 赋值', !HAS_TOP_LEVEL_FILTER_ASSIGN);
/* 复现线上现象：存档里残留着旧默认值 'rec'，load() 后必须被迁移 */
const v1 = {
  ver: 1,
  profile: { name: '老王', school: '某大学' },
  appliedKeys: ['字节跳动|算法工程师（推荐方向）'],
  filters: { studySort: 'rec', studyMin: 55 }
};
const mg = mergeState(v1);
ok('老存档迁移：排序切回匹配度降序（线上看到的正是没切回来）', mg.filters.studySort === 'score', 'got=' + mg.filters.studySort);
ok('迁移不覆盖用户自己调过的匹配度下限', mg.filters.studyMin === 55, 'got=' + mg.filters.studyMin);
ok('迁移补齐 filters 里缺失的键', mg.filters.jobCity === '全部' && mg.filters.jobMin === 50);
ok('迁移保留简历数据与投递记录', mg.profile.name === '老王' && mg.appliedKeys.length === 1);
ok('迁移后版本号升到最新', mg.ver === STATE_VER, 'got=' + mg.ver);
ok('无 ver 字段的更早存档同样被迁移', mergeState({ filters: { studySort: 'rec' } }).filters.studySort === 'score');
const mg2 = mergeState(mg);
mg2.filters.studySort = 'rec';
ok('已升到 v2 的用户，之后主动改的排序不再被覆盖', mergeState(mg2).filters.studySort === 'rec');

const pA = parseResume(SAMPLES[0].text).profile;
const listA = SCHOOLS.map(s => ({ s: s, m: schoolMatch(s, pA, state.studyPref) }))
  .sort((a, b) => (b.m.score - a.m.score) || (b.m.margin - a.m.margin));
let desc = true;
for (let i = 1; i < listA.length; i++) if (listA[i].m.score > listA[i - 1].m.score) desc = false;
ok('排序结果按分数单调不增', desc);
out.push('  TOP5 = ' + listA.slice(0, 5).map(x => x.s.school + '/' + x.s.program + '(' + x.m.score + ',' + x.m.tier + ')').join(' ; '));

out.push('');
out.push('=== 5. 未选标签 = 全范围检索且有区分度 ===');
const noPref = { regions: [], fields: [], weights: state.studyPref.weights };
const listB = SCHOOLS.map(s => ({ s: s, m: schoolMatch(s, pA, noPref) }));
const scores = listB.map(x => x.m.score);
ok('未选方向时不做过滤', listB.length === SCHOOLS.length);
ok('未选时分数仍有区分度（不是一片同分）', Math.max.apply(null, scores) - Math.min.apply(null, scores) > 8,
  'range=' + (Math.max.apply(null, scores) - Math.min.apply(null, scores)));
ok('未选地区时不惩罚', listB.every(x => x.m.fieldRel > 0));

out.push('');
out.push('=== 6. 子分类 / 自定义标签匹配 ===');
const sNLP = SCHOOLS.filter(s => s.field.indexOf('NLP') >= 0)[0];
const sMat = SCHOOLS.filter(s => s.field.indexOf('材料') >= 0)[0];
ok('子分类「自然语言处理」命中 NLP 项目', fieldMatches('自然语言处理', sNLP));
ok('子分类「自然语言处理」不命中材料项目', !fieldMatches('自然语言处理', sMat));
ok('子分类「材料科学与工程」命中材料项目', fieldMatches('材料科学与工程', sMat));
ok('大类 key 仍可用（ai 命中 AI 项目）', fieldMatches('ai', sNLP));
ok('自定义方向标签按文本匹配', fieldMatches('机器人', SCHOOLS.filter(s => s.field.indexOf('机器人') >= 0)[0]));
const jAlgo = JOBS.filter(j => j.position.indexOf('推荐算法') >= 0)[0];
const jBack = JOBS.filter(j => j.position.indexOf('后端开发') >= 0)[0];
ok('岗位类型：选大类「技术研发」命中算法岗', typeHit(jAlgo, ['技术研发']));
ok('岗位类型：选子类「算法」命中算法岗', typeHit(jAlgo, ['算法']));
ok('岗位类型：选子类「算法」不命中后端岗', !typeHit(jBack, ['算法']));
ok('岗位类型：自定义标签「推荐」命中推荐算法岗', typeHit(jAlgo, ['推荐']));

out.push('');
out.push('=== 7. 分类体系完整性 ===');
const cc = labelCounts(CITY_GROUPS, JOBS, j => j.city);
const tc = labelCounts(JOBTYPE_GROUPS, JOBS, j => jobType(j));
const ic = labelCounts(INDUSTRY_GROUPS, JOBS, j => j.industry);
out.push('  城市选项 ' + Object.keys(cc).length + ' 个；岗位类型 ' + Object.keys(tc).length + ' 个；行业 ' + Object.keys(ic).length + ' 个');
const zeros = Object.keys(tc).filter(k => tc[k] === 0);
out.push('  当前 0 结果的岗位类型（示例数据规模所致）：' + (zeros.join('、') || '无'));
let tsum = 0; Object.keys(tc).forEach(k => tsum += tc[k]);
ok('每个岗位都被归类（类型计数之和 = 岗位总数）', tsum === JOBS.length, 'sum=' + tsum + ' jobs=' + JOBS.length);
let isum = 0; Object.keys(ic).forEach(k => isum += ic[k]);
ok('每个岗位行业都在分类表内', isum === JOBS.length, 'sum=' + isum);
ok('城市计数正确', cc['北京'] > 0 && cc['嘉兴'] === 0);

out.push('');
out.push('=== 8. GPA 条件化 ===');
const pG = parseResume(SAMPLES[1].text).profile;
const noGpaJob = JOBS.filter(j => !j.gpaReq)[0];
const gpaJob = JOBS.filter(j => j.gpaReq)[0];
const intro1 = generateIntro(pG, noGpaJob, false);
const intro2 = generateIntro(pG, gpaJob, true);
ok('非必填岗位：自我介绍不提 GPA', intro1.indexOf('GPA') < 0, intro1);
ok('必填岗位：自我介绍包含 GPA', intro2.indexOf('GPA') >= 0, intro2);
ok('岗位库同时存在必填与非必填两类', !!gpaJob && !!noGpaJob && JOBS.filter(j => j.gpaReq).length < JOBS.length);
out.push('  必填 GPA 的岗位：' + JOBS.filter(j => j.gpaReq).map(j => j.company + '/' + j.position).join(' ; '));
out.push('  非必填草稿：' + intro1);
out.push('  必填草稿　：' + intro2);

out.push('');
out.push('=== 9. 数据规模 ===');
out.push('  院校项目 ' + SCHOOLS.length + ' 个　岗位 ' + JOBS.length + ' 个　示例简历 ' + SAMPLES.length + ' 份');
out.push('  原型 ' + HTML_CHARS + ' 字符 / 逻辑层 ' + JS_CHARS + ' 字符');

out.push('');
out.push('=== 10. 官网投递：地址识别与追踪方案 ===');
ok('识别表已内置且覆盖主流招聘系统', ATS_DICT.length >= 20, 'n=' + ATS_DICT.length);
const badAts = ATS_DICT.filter(a => !a.vendor || !a.kind || !a.hosts || !a.hosts.length);
ok('识别表每条都带 vendor / kind / hosts', badAts.length === 0, badAts.map(a => a.vendor).join(','));
const seenHost = {}; let dupHost = '';
ATS_DICT.forEach(a => a.hosts.forEach(h => { if (seenHost[h]) dupHost = h; seenHost[h] = 1; }));
ok('识别表没有重复域名（重复会让后面的规则永不被命中）', !dupHost, dupHost);
ok('追踪方式都有中文标签', ['mail', 'ext', 'manual', 'archive', 'inapp'].every(k => !!TRACK_LABEL[k]));

const atsCases = [
  ['https://tencent.mokahr.com/candidate', 'Moka'],
  ['https://jobs.bytedance.com/status', '字节跳动招聘'],
  ['https://acme.myworkdayjobs.com/en-US/careers', 'Workday'],
  ['https://boards.greenhouse.io/acme', 'Greenhouse'],
  ['https://www.zhipin.com/web/chat', 'Boss 直聘'],
  ['https://www.zhaopin.com/mine', '智联招聘'],
  ['https://zhaopin.meituan.com/my', '美团招聘'],
  ['https://career.huawei.com/reccampportal', '华为招聘']
];
atsCases.forEach(function (c) {
  const info = identifyAts(c[0]);
  const got = info.ok && info.ats ? info.ats.vendor : (info.ok ? '（未收录）' : '（解析失败）');
  ok('识别 ' + c[0].replace('https://', '') + ' -> ' + c[1], got === c[1], 'got=' + got);
});
ok('不带协议头的地址也能识别', identifyAts('tencent.mokahr.com').ok);
ok('用域名后缀匹配，伪域名不误判', !(identifyAts('https://notmokahr.com.evil.net/x').ats));
ok('无法解析的输入被拒绝', !identifyAts('随便写的').ok);
ok('未收录域名 -> ok 但 ats 为空（宁可留空也不猜）',
  (function () { const i = identifyAts('https://careers.example-corp.com/x'); return i.ok && !i.ats; })());

const planCases = [
  ['来源=招聘平台', { ats: { mail: true, ext: true } }, '招聘平台', 'archive', '仅归档'],
  ['平台型系统（自带汇总与提醒）', { ats: { mail: false, ext: false, agg: true } }, '官网直投', 'archive', '仅归档'],
  ['普通公司自研系统', { ats: { mail: true, ext: true } }, '官网直投', 'manual', '去官网确认'],
  ['未收录系统', null, '官网直投', 'manual', '去官网确认']
];
planCases.forEach(function (c) {
  const p = trackPlan(c[1], c[2]);
  ok('确认方式 ' + c[0] + ' -> ' + c[4], p.mode === c[3] && p.label === c[4], 'got=' + p.mode + '/' + p.label);
});
const jdAts = identifyAts('https://campus.jd.com/candidate').ats;
ok('识别到京东地址 -> 预选京东校招流程模板', suggestFlowKey(jdAts) === 'jd', 'got=' + suggestFlowKey(jdAts));
ok('其他系统不瞎猜流程，回落到通用模板',
  suggestFlowKey(identifyAts('https://tencent.mokahr.com/x').ats) === FLOW_DEFAULT);
out.push('  内置识别表：' + ATS_DICT.map(a => a.vendor).join('、'));

out.push('');
out.push('=== 11. 每家一套流程：模板 / 进度条 / 归档 ===');
ok('模板库里保留「无进度条」这一档（不是每家都展示进度）', FLOW_TEMPLATES.some(t => t.steps === null));
ok('模板库至少 5 套可用流程', FLOW_TEMPLATES.filter(t => t.steps).length >= 5);
const tplKeys = FLOW_TEMPLATES.map(t => t.key);
ok('模板 key 不重复', tplKeys.length === Object.keys(tplKeys.reduce((m, k) => { m[k] = 1; return m; }, {})).length);

const jdTpl = FLOW_TEMPLATES.filter(t => t.key === 'jd')[0];
const jdSteps = jdTpl ? jdTpl.steps.join('>') : '';
ok('京东模板顺序 = 投递>测评>笔试>AI 面试>简历筛选>面试>Offer>入职',
  jdSteps === '投递>测评>笔试>AI 面试>简历筛选>面试>Offer>入职', 'got=' + jdSteps);
/* 这两条是「不能只有一套固定枚举」的实证：京东的顺序和通用流程是反的 */
ok('京东模板里「测评」排在「笔试」之前', jdTpl.steps.indexOf('测评') < jdTpl.steps.indexOf('笔试'));
ok('京东模板里「简历筛选」排在「AI 面试」之后', jdTpl.steps.indexOf('简历筛选') > jdTpl.steps.indexOf('AI 面试'));

/* 归档：点进度条任意节点，不伪造中间节点 */
function mkApp(over) {
  const f = tplOf('jd').steps.slice();
  return Object.assign({
    id: 't1', company: '京东', position: '算法工程师', flowKey: 'jd', flow: f,
    stepIdx: 0, closed: false, status: f[0], urlCheckedAt: '', confirmPending: false,
    timeline: [{ s: f[0], t: '2026-09-01', note: '登记' }]
  }, over || {});
}
const jdApp = mkApp();
setStep(jdApp, 4, '官网确认后归档');
ok('直接归档到第 5 步 -> 状态=简历筛选', stageOf(jdApp) === '简历筛选', 'got=' + stageOf(jdApp));
ok('归档只追加一条时间轴，不伪造中间节点', jdApp.timeline.length === 2, 'n=' + jdApp.timeline.length);
ok('时间轴注明来源是官网确认', /官网确认/.test(jdApp.timeline[1].note), jdApp.timeline[1].note);
ok('可以往回改（官网看到的就是真相，不强制单向）', (function () {
  setStep(jdApp, 1, '官网确认后归档'); return stageOf(jdApp) === '测评';
})());
closeApplication(jdApp, '收到感谢信');
ok('结束流程后状态显示「已结束」', stageOf(jdApp) === '已结束');
ok('结束流程不丢失「曾走到哪一步」的信息', stepIdxOf(jdApp) === 1, 'got=' + stepIdxOf(jdApp));

/* 分列：任意自定义步骤名都能落到统计列 */
const bucketCases = {
  '投递': '已投递', '资格审查': '筛选中', '在线测评': '筛选中', 'AI 面试': '面试中',
  '群面': '面试中', 'HR 面': '面试中', 'Offer': 'Offer', '入职': 'Offer'
};
Object.keys(bucketCases).forEach(function (nm) {
  const b = bucketOf({ flow: [nm], stepIdx: 0, closed: false });
  ok('步骤「' + nm + '」归到「' + bucketCases[nm] + '」列', b === bucketCases[nm], 'got=' + b);
});

/* 无进度条的公司：仍有状态，只是不画进度 */
const plainApp = { id: 't2', flowKey: 'none', flow: null, stepIdx: 0, closed: false, status: '处理中', timeline: [] };
ok('无进度条时 flowOf 返回 null', flowOf(plainApp) === null);
ok('无进度条时照样有状态', stageOf(plainApp) === '处理中');
setStep(plainApp, '面试邀约', '官网确认后归档');
ok('无进度条也能归档状态', stageOf(plainApp) === '面试邀约', 'got=' + stageOf(plainApp));

/* 导入：归一化阶段 -> 这条投递自己的流程 */
ok('「笔试」在京东流程里映射到第 3 步（不被前面的「测评」抢走）', stepIndexForStage(tplOf('jd').steps, '笔试') === 2,
  'got=' + stepIndexForStage(tplOf('jd').steps, '笔试'));
ok('「简历筛选中」在京东流程里映射到第 5 步', stepIndexForStage(tplOf('jd').steps, '简历筛选中') === 4);
ok('只有「在线测评」时「笔试」落到测评那一步', stepIndexForStage(['投递', '在线测评', '面试', 'Offer'], '笔试') === 1);
ok('流程里根本没有笔试时返回 -1（不硬塞到别的步骤）', stepIndexForStage(['投递', '面试', 'Offer'], '笔试') === -1);
ok('京东流程没有「一面」时落到第一个含「面」的步骤（AI 面试）', stepIndexForStage(tplOf('jd').steps, '一面') === 3,
  'got=' + stepIndexForStage(tplOf('jd').steps, '一面'));

/* 老记录迁移：v2 的固定八态 -> v3 的模板 + 位置 */
const oldApps = [
  { id: 'a', company: 'A', position: 'p', status: '笔试', timeline: [{ s: '已投递', t: '2026-08-01' }] },
  { id: 'b', company: 'B', position: 'p', status: 'Offer', timeline: [{ s: '已投递', t: '2026-08-02' }] },
  { id: 'c', company: 'C', position: 'p', status: '已结束', timeline: [{ s: '已投递', t: '2026-08-03' }] }
];
const mgApps = mergeState({ ver: 2, applications: oldApps }).applications;
ok('老记录迁移后带上流程数组', mgApps.every(a => Array.isArray(a.flow) && a.flow.length === 8));
ok('老记录的状态对上新流程的那一步', mgApps[0].flow[mgApps[0].stepIdx] === '笔试', 'got=' + mgApps[0].flow[mgApps[0].stepIdx]);
ok('迁移后 stageOf 与迁移前一致', stageOf(mgApps[0]) === '笔试' && stageOf(mgApps[1]) === 'Offer' && stageOf(mgApps[2]) === '已结束',
  'got=' + [stageOf(mgApps[0]), stageOf(mgApps[1]), stageOf(mgApps[2])].join('/'));
ok('「已结束」迁成终止标记而不是流程步骤', mgApps[2].closed === true && mgApps[1].closed === false);
ok('迁移保留原时间轴', mgApps[0].timeline.length === 1 && mgApps[0].timeline[0].t === '2026-08-01');
ok('迁移不丢投递记录条数', mgApps.length === 3);
ok('迁移后每条都带待确认相关字段', mgApps.every(a => a.urlCheckedAt === '' && a.confirmPending === false));
ok('defaultState 自带 trackSeg / hubFilter（避免又被 load 覆盖）',
  defaultState().trackSeg === 'hub' && defaultState().hubFilter === 'all');

out.push('');
out.push('=== 12. 投递回执：编号 / 只补不覆 / 导入 ===');
ok('回执编号 = HT-日期-三位序号', makeReceiptNo('2026-09-13', 1) === 'HT-20260913-001', makeReceiptNo('2026-09-13', 1));
ok('回执序号补零到三位', makeReceiptNo('2026-09-13', 12) === 'HT-20260913-012', makeReceiptNo('2026-09-13', 12));
ok('编号能容忍带时间的入参', makeReceiptNo('2026-09-13 14:22', 3) === 'HT-20260913-003', makeReceiptNo('2026-09-13 14:22', 3));

state.applications = [];
const rvA = buildReceipt({ at: '2026-09-13 10:00', jobRef: 'JD-A', url: 'https://a.myworkdayjobs.com/x' });
ok('生成回执自动分配编号', rvA.no === 'HT-20260913-001', rvA.no);
ok('生成回执默认渠道为官网直投', rvA.channel === '官网直投', rvA.channel);
ok('回执时间规整为「日期 时分」', rvA.at === '2026-09-13 10:00', rvA.at);

const appA = { id: 'a', company: '甲', position: 'p', timeline: [] };
ok('首次挂载回执成功', attachReceipt(appA, rvA) === true);
ok('挂载后 hasReceipt 为真', hasReceipt(appA) === true);
ok('挂载顺带回填申请号与直达链接', appA.externalId === 'JD-A' && appA.url.indexOf('workday') >= 0, appA.externalId + ' / ' + appA.url);

const rvB = buildReceipt({ at: '2026-09-14 09:00', jobRef: 'JD-B' });
ok('已有回执时再挂载被拒绝（凭证不覆盖）', attachReceipt(appA, rvB) === false);
ok('已有回执内容保持不变', appA.receipt.jobRef === 'JD-A', appA.receipt.jobRef);

/* 导入：命中已有记录 -> 只补回执，不新建、不改状态 */
state.applications = [{
  id: 'k1', company: '字节跳动', position: '算法工程师', externalId: '', url: '', atsVendor: '', source: '',
  flowKey: 'internet', flow: tplOf('internet').steps.slice(), stepIdx: 0, closed: false, status: '投递',
  timeline: [], receipt: null, urlCheckedAt: '', confirmPending: false
}];
const impA = importReceipts(JSON.stringify({ schema: 'zhiyin.receipt.v1', receipt: { company: '字节跳动', position: '算法工程师', jobRef: 'JD2026001', url: 'https://jobs.bytedance.com/status', at: '2026-09-13T14:22:00', channel: '官网直投' } }));
ok('导入回执命中已有记录时不新建', impA.ok && impA.stat.created === 0 && impA.stat.attached === 1, JSON.stringify(impA.stat));
ok('导入后记录带上回执', hasReceipt(state.applications[0]) === true);
ok('导入回执保留原始提交时间', state.applications[0].receipt.at === '2026-09-13 14:22', state.applications[0].receipt.at);
ok('导入回执回填申请号', state.applications[0].externalId === 'JD2026001', state.applications[0].externalId);
ok('导入回执不改动流程位置（回执不是状态）', state.applications[0].stepIdx === 0);

const impB = importReceipts(JSON.stringify({ receipt: { company: '字节跳动', position: '算法工程师', jobRef: 'JD2026001', at: '2026-09-25T09:00:00' } }));
ok('重复导入同一张回执被跳过', impB.ok && impB.stat.skipped === 1 && impB.stat.attached === 0, JSON.stringify(impB.stat));
ok('重复导入不改写已存回执', state.applications[0].receipt.at === '2026-09-13 14:22', state.applications[0].receipt.at);

/* 导入：匹配不到 -> 新建一条，状态落在「已投递」 */
const nBefore = state.applications.length;
const impC = importReceipts(JSON.stringify({ pageUrl: 'https://acme.myworkdayjobs.com/en-US/careers', receipt: { company: '某外企', position: 'Data Scientist', jobRef: 'WD-7788', at: '2026-09-13T16:00:00' } }));
ok('导入回执匹配不到时新建记录', impC.ok && impC.stat.created === 1 && state.applications.length === nBefore + 1, JSON.stringify(impC.stat));
const appNew = state.applications[state.applications.length - 1];
ok('新建记录自带回执', hasReceipt(appNew) === true);
ok('新建记录落在「已投递」列', bucketOf(appNew) === '已投递', bucketOf(appNew));
ok('新建记录识别出招聘系统', appNew.atsVendor === 'Workday', appNew.atsVendor);
ok('新建记录的时间轴注明回执编号', String(appNew.timeline[0].note).indexOf('回执') >= 0, appNew.timeline[0].note);

ok('非法 JSON 被拒绝', importReceipts('{不是 json').ok === false);
ok('没有回执内容时被拒绝', importReceipts('{}').ok === false);

const mgR = mergeState({ ver: 3, applications: [{ id: 'z', company: 'Z', position: 'p', timeline: [], flowKey: 'internet', flow: tplOf('internet').steps.slice(), stepIdx: 0, closed: false, status: '投递' }] }).applications;
ok('迁移后每条记录都有 receipt 键（缺则 null，不虚构凭证）', mgR[0].receipt === null, JSON.stringify(mgR[0].receipt));

out.push('');
out.push('=== 13. 辅助填写载荷（zhiyin.fill.v2） ===');
const fpIn = { name: '杨明翰', phone: '13800000000', email: 'yang@example.com', school: '华中科技大学', major: '计算机科学与技术', edu: '硕士', gpa: '', gradYear: '2027-06', skills: 'Python、SQL', intro: '希望应聘贵司数据岗位。' };
const fp = buildFillPayload('美团', '数据分析师', fpIn);
ok('载荷 schema 为 zhiyin.fill.v2', fp.schema === 'zhiyin.fill.v2', fp.schema);
ok('载荷带上公司与岗位', fp.company === '美团' && fp.position === '数据分析师');
ok('空值字段不导出（GPA 非必填默认留空）', !('gpa' in fp.fields), JSON.stringify(Object.keys(fp.fields)));
ok('非空字段全量导出（9 个）', Object.keys(fp.fields).length === 9, 'n=' + Object.keys(fp.fields).length);
ok('值两侧空白被裁剪', buildFillPayload('a', 'b', { name: '  张三  ' }).fields.name === '张三');
ok('载荷不改传入的表单值（防御性拷贝）', fpIn.gpa === '' && fpIn.name === '杨明翰');
ok('全空入参也能给出合法载荷（fields 为空对象）', Object.keys(buildFillPayload('', '', {}).fields).length === 0);
ok('null / undefined 值按空处理不进载荷', !('note' in buildFillPayload('a', 'b', { note: null }).fields));

out.push('');
out.push('=== 14. 官网投递入口（直达 / 搜索兜底） ===');
ok('已核实的公司（京东）直达官方招聘站', applyEntryUrl({ company: '京东' }) === 'https://campus.jd.com', applyEntryUrl({ company: '京东' }));
ok('已核实的公司标签为「直达官网」', applyEntryLabel({ company: '腾讯' }) === '直达官网');
ok('未核实的公司走搜索兜底（不猜地址）', applyEntryUrl({ company: '大疆创新' }).indexOf('bing.com/search') >= 0 && encodeURIComponent('大疆创新').length > 0, applyEntryUrl({ company: '大疆创新' }));
ok('搜索兜底带上公司名', decodeURIComponent(applyEntryUrl({ company: '大疆创新' })).indexOf('大疆创新') >= 0);
ok('未核实的公司标签为「搜官网入口」', applyEntryLabel({ company: '网易' }) === '搜官网入口');
ok('岗位自带 applyUrl 时最优先', applyEntryUrl({ company: '京东', applyUrl: 'https://x.example.com' }) === 'https://x.example.com');
ok('CAREER_ENTRY 收录的域名都在 ATS_DICT 里（同一知识源，不引入未核实地址）',
  Object.keys(CAREER_ENTRY).every(function (co) {
    const host = CAREER_ENTRY[co].split('https://')[1] || CAREER_ENTRY[co];
    return ATS_DICT.some(function (a) { return a.hosts.indexOf(host) >= 0; });
  }));

out.push('');
out.push('=== 15. 职位导入（zhiyin.jobs.v1） ===');
ok('薪资原文 "18-30K" 解析为 [18,30]', JSON.stringify(parseSalaryRaw('18-30K')) === '[18,30]', JSON.stringify(parseSalaryRaw('18-30K')));
ok('薪资原文 "1.5-2万" 换算为 [15,20]', JSON.stringify(parseSalaryRaw('1.5-2万')) === '[15,20]', JSON.stringify(parseSalaryRaw('1.5-2万')));
ok('薪资原文 "20-36K·14薪" 忽略薪数取 [20,36]', JSON.stringify(parseSalaryRaw('20-36K·14薪')) === '[20,36]', JSON.stringify(parseSalaryRaw('20-36K·14薪')));
ok('倒写的薪资 "30-18K" 自动纠正为 [18,30]', JSON.stringify(parseSalaryRaw('30-18K')) === '[18,30]', JSON.stringify(parseSalaryRaw('30-18K')));
ok('没有薪资时返回 null（不猜）', parseSalaryRaw('') === null && parseSalaryRaw('面议') === null);

const jobsBefore = JOBS.length;
const impJ1 = importJobs(JSON.stringify({
  schema: 'zhiyin.jobs.v1', exportedAt: '2026-09-13T06:00:00Z',
  items: [
    { company: '小红书', position: '数据分析师', city: '上海', edu: '本科', salaryRaw: '18-30K', skills: ['SQL', 'Python'], url: 'https://www.nowcoder.com/jobs/1001' },
    { company: '米哈游', position: '游戏策划', city: '上海', edu: '不限', salaryRaw: '1.5-2万', skills: [] },
    { company: '字节跳动', position: '算法工程师（推荐方向）', city: '北京', edu: '硕士', salaryRaw: '30-52K' }
  ]
}));
ok('导入新增 2 条（示例库已有的跳过）', impJ1.ok && impJ1.stat.added === 2 && impJ1.stat.skipped === 1, JSON.stringify(impJ1.stat));
ok('导入后 JOBS 变长', JOBS.length === jobsBefore + 2, JOBS.length + ' vs ' + (jobsBefore + 2));
const jImp = JOBS.filter(function (j) { return j.imported && j.company === '米哈游'; })[0];
ok('导入职位带 imported 标记', !!jImp && jImp.imported === true);
ok('「1.5-2万」换算成 15-20k 存库', !!jImp && jImp.salary[0] === 15 && jImp.salary[1] === 20, jImp && JSON.stringify(jImp.salary));
ok('导入职位落进 state.importedJobs（可持久化）',
  state.importedJobs.filter(function (j) { return j.company === '米哈游'; }).length === 1);
ok('导入职位带 tag=导入（与示例库一屏可辨）', !!jImp && jImp.tag === '导入');

const impJ2 = importJobs(JSON.stringify({ items: [{ company: '小红书', position: '数据分析师', city: '上海' }] }));
ok('重复导入同一职位被跳过', impJ2.ok && impJ2.stat.added === 0 && impJ2.stat.skipped === 1, JSON.stringify(impJ2.stat));
ok('非法 JSON 被拒绝', importJobs('{不是 json').ok === false);
ok('空 items 被拒绝', importJobs('{"items":[]}').ok === false);

const mgJ = mergeState({ ver: 3, importedJobs: [{ company: 'X', position: 'Y', salary: [1, 2] }, { company: '', position: '' }, null] }).importedJobs;
ok('迁移时过滤掉无效导入职位（缺公司名 / null）', mgJ.length === 1, 'n=' + mgJ.length);
ok('老存档没有 importedJobs 键时补空数组', Array.isArray(mergeState({ ver: 3 }).importedJobs) && mergeState({ ver: 3 }).importedJobs.length === 0);

out.push('');
out.push('=== 16. 院校项目导入（zhiyin.programs.v1） ===');
/* parseProgramText：从任意文本抽取 program/deadline/fund/language/papers/note */
ok('文本解析：识别出 program="Computer Science PhD"',
  parseProgramText('Stanford\' + String.fromCharCode(10) + 'Computer Science PhD\' + String.fromCharCode(10) + 'Deadline: 2027-01-08\' + String.fromCharCode(10) + 'Fully funded\' + String.fromCharCode(10) + 'TOEFL 100').program === 'Computer Science PhD');
ok('文本解析：识别出 deadline="2027-01-08"',
  parseProgramText('PhD in AI\' + String.fromCharCode(10) + 'Deadline: 2027-01-08\' + String.fromCharCode(10) + 'Fully funded').deadline === '2027-01-08');
ok('文本解析：识别出 fund 含 fully funded',
  /fully\\s*funded/i.test(parseProgramText('PhD in AI\' + String.fromCharCode(10) + 'Fully funded / stipend').fund));
ok('文本解析：识别出 toefl=100',
  parseProgramText('PhD in AI\' + String.fromCharCode(10) + 'TOEFL 100 required').language && parseProgramText('PhD in AI\' + String.fromCharCode(10) + 'TOEFL 100 required').language.toefl === 100);
ok('文本解析：识别出 papers=2',
  parseProgramText('PhD in AI\' + String.fromCharCode(10) + 'Publications: 2 papers required').papers === 2);
ok('文本解析：识别出中文"全额奖学金"',
  /全额|奖/.test(parseProgramText('博士项目\' + String.fromCharCode(10) + '全额奖学金').fund));
ok('文本解析：空文本返回 null（不猜）', parseProgramText('') === null);
ok('文本解析：无学位后缀返回 program=undefined（不猜一个名字）',
  parseProgramText('计算机科学\' + String.fromCharCode(10) + '2026-12-01\' + String.fromCharCode(10) + '全奖').program === undefined);

/* applyEntryUrlSchool：与求职侧 applyEntryUrl 同源守门 */
ok('SCHOOL_ENTRY 收录学校：applyEntryLabelSchool = 直达招生入口',
  applyEntryLabelSchool({ school: '香港大学', program: 'CS PhD' }) === '直达招生入口');
ok('SCHOOL_ENTRY 收录学校：applyEntryUrlSchool 走真实入口',
  applyEntryUrlSchool({ school: '新加坡国立大学' }).indexOf('nus.edu.sg') >= 0);
ok('SCHOOL_ENTRY 未收录学校：applyEntryLabelSchool = 搜申请入口',
  applyEntryLabelSchool({ school: '未知大学', program: 'CS PhD' }) === '搜申请入口');
ok('SCHOOL_ENTRY 未收录学校：applyEntryUrlSchool 走 Bing 搜索',
  applyEntryUrlSchool({ school: '未知大学', program: 'CS PhD' }).indexOf('bing.com/search') >= 0);
ok('导入项自带 applyUrl 时最优先',
  applyEntryUrlSchool({ school: '香港大学', program: 'CS PhD', applyUrl: 'https://my-custom.example.com/apply' }) === 'https://my-custom.example.com/apply');

/* importPrograms：与 importJobs 同款 */
const impP1 = importPrograms(JSON.stringify({
  schema: 'zhiyin.programs.v1',
  items: [
    /* 香港大学「计算机科学博士」与示例库 s01 同校+同程序名 → 合并字段（不新增）；示例库已有的 GPA/语言要求保留 */
    { school: '香港大学', program: '计算机科学博士', region: '中国香港', deadline: '2026-12-15', fund: '全奖', applyUrl: 'https://gradschool.hku.hk/cs' },
    /* 东京大学「AI 博士」与示例库 s19「情报理工学博士」程序名不同 → 视为全新项目 */
    { school: '东京大学', program: 'AI 博士', region: '日本', deadline: '2026-11-30', fund: 'MEXT 奖学金', applyUrl: 'https://www.u-tokyo.ac.jp' }
  ]
}));
ok('导入两个项目：1 个与示例库合并 + 1 个新增', impP1.ok && impP1.stat.added === 2 && impP1.stat.skipped === 0, JSON.stringify(impP1.stat));
ok('导入的项目写入 state.importedPrograms',
  state.importedPrograms.length === 2 && state.importedPrograms[0].school === '香港大学');
const impP2 = importPrograms(JSON.stringify({
  items: [{ school: '香港大学', program: '计算机科学博士', region: '中国香港', deadline: '2026-12-15' }]
}));
ok('重复导入同校+同项目：skipped',
  impP2.ok && impP2.stat.added === 0 && impP2.stat.skipped === 1, JSON.stringify(impP2.stat));
ok('非法 JSON 被拒绝', importPrograms('{不是 json').ok === false);
ok('空 items 被拒绝', importPrograms('{"items":[]}').ok === false);
ok('缺校名/项目名的脏数据被跳过（stat.skipped 计入）',
  importPrograms(JSON.stringify({ items: [{ school: '', program: '' }, { school: 'X', program: '' }, null] })).stat.skipped === 3);

/* syncImportedPrograms：导入项合并回渲染池 */
syncImportedPrograms();
const poolCount = schoolPool().length;
const importedFromPool = schoolPool().filter(function (s) { return s.imported; }).length;
ok('syncImportedPrograms：导入项并入渲染池（带 imported=true）',
  poolCount === SCHOOLS.length + 1 && importedFromPool === 2,
  'pool=' + poolCount + ' imported=' + importedFromPool);
ok('syncImportedPrograms：同校+同项目合并字段（deadline 以导入为准）',
  schoolPool().find(function (s) { return s.school === '香港大学' && s.program === '计算机科学博士'; }).deadline === '2026-12-15');
ok('syncImportedPrograms：纯新增项目也带 imported=true',
  schoolPool().find(function (s) { return s.school === '东京大学' && s.program === 'AI 博士'; }).imported === true);
ok('迁移：老存档没有 importedPrograms 键时补空数组',
  Array.isArray(mergeState({ ver: 3 }).importedPrograms) && mergeState({ ver: 3 }).importedPrograms.length === 0);
ok('迁移：导入项目里缺校名/项目名的被过滤',
  mergeState({ ver: 3, importedPrograms: [{ school: '', program: '' }, { school: 'OK', program: 'PhD' }, null] }).importedPrograms.length === 1);

/* === 16b. 投递包（job kit）：一个岗位一套材料（第二十二轮） ===
   这一层存在的理由：在这之前，"CV 改写"必须先有一条投递记录才能进入，顺序是反的，
   改出来的 bullets 也只躺在记录里没人读 —— 用户自然会问"这玩意儿干嘛用的"。
   投递包把键改成「公司|岗位」，独立于投递记录，于是可以"先备料、再投"。 */
out.push('');
out.push('=== 16b. 投递包：一个岗位一套材料 ===');
state.kits = {};
ok('投递包：键是「公司|岗位」', kitKey('京东', '算法工程师') === '京东|算法工程师');
ok('投递包：没备料时读回 null（不返回空壳）', getKit('京东', '算法工程师') === null);
const kit1 = setKitDoc('京东', '算法工程师', {
  bullets: ['主导了资料重建，覆盖 12 家门店', '独立完成合规审核流程'],
  jdKeywords: ['python'], at: '2026-09-14'
});
ok('投递包：写入成功，版本从 1 起', kit1 && kit1.doc.version === 1 && kit1.doc.bullets.length === 2);
ok('投递包：写进去能读回来', getKit('京东', '算法工程师') !== null);
ok('投递包：本岗文案按岗位隔离（换岗位就是另一套材料）', getKit('京东', '产品经理') === null);
const kit2 = setKitDoc('京东', '算法工程师', { bullets: ['只留一条'] });
ok('投递包：同岗位再备一次，版本递增（看得见改了几次）', kit2 && kit2.doc.version === 2);
ok('投递包：空 bullets 不写入（不留空壳刷出"已定制"标记）', setKitDoc('美团', '运营', { bullets: [] }) === null);
ok('投递包：空行与两端空白被清掉', (function () {
  const x = setKitDoc('美团', '运营', { bullets: ['  A  ', '', '   ', 'B'] });
  return x && x.doc.bullets.length === 2 && x.doc.bullets[0] === 'A';
})());
ok('投递包：投递记录的 customDoc 由它生成（标出哪条带真实数字）', (function () {
  setKitDoc('美团', '运营', { bullets: ['提升了转化率', '完成 12 个接口'] });
  const cd = kitToCustomDoc('美团', '运营');
  return cd && cd.bullets.length === 2 && cd.bullets[0].hasRealMetric === false && cd.bullets[1].hasRealMetric === true;
})());
ok('投递包：没有备料时 customDoc 为 null（不虚构凭证）', kitToCustomDoc('不存在的公司', '岗位') === null);
ok('投递包：能反向从 customDoc 还原（投递中心改完要同步回来）', (function () {
  const k = kitFromCustomDoc({ customDoc: { bullets: [{ text: 'A' }, { text: 'B' }], version: 3 } });
  return k && k.doc.bullets.length === 2 && k.doc.version === 3;
})());
ok('投递包：customDoc 为空时还原为 null', kitFromCustomDoc({ customDoc: null }) === null);

/* === 16c. 经历层：成就的父节点（第二十六轮） ===
   为什么加这一层：成就是扁平的，每条自带一遍项目名与时间 —— 同一个项目下 3 条成就改名要改
   3 处；而且要「整段勾选 / 整段替换」时，缺一个可选中的单位。经历自带组织 / 角色 / 类别 / 起止，
   恰好就是官网分段表单要的字段。 */
out.push('');
out.push('=== 16c. 经历层（成就的父节点） ===');
const SPLIT_T = splitTimeRange;
const JOIN_T = joinTimeRange;
const MIG_EXP = migrateExperiences;
const EXP_NAME = expDisplayName;

ok('经历层：起止解析 2025.03 - 2025.08', (function () { const x = SPLIT_T('2025.03 - 2025.08'); return x.start === '2025.03' && x.end === '2025.08'; })());
ok('经历层：波浪号 / 破折号 / 「至」都当分隔符', (function () {
  return SPLIT_T('2025.03～2025.08').end === '2025.08' && SPLIT_T('2025.03—2025.08').end === '2025.08' && SPLIT_T('2025.03至2025.08').end === '2025.08';
})());
ok('经历层：只有一头也认（允许只写开始）', (function () { const x = SPLIT_T('2025.03'); return x.start === '2025.03' && x.end === ''; })());
ok('经历层：空串不炸', (function () { const x = SPLIT_T(''); return x.start === '' && x.end === ''; })());
ok('经历层：起止能拼回文本', JOIN_T('2025.03', '2025.08') === '2025.03 - 2025.08' && JOIN_T('2025.03', '') === '2025.03');
ok('经历层：带连字符的月份要切得对（2025-03 至 2025-08，不能切成 4 段）', (function () {
  const x = SPLIT_T('2025-03 至 2025-08');
  return x.start === '2025-03' && x.end === '2025-08';
})());
ok('经历层：空格连字符同款（2025-03 - 2025-08）', (function () {
  const x = SPLIT_T('2025-03 - 2025-08');
  return x.start === '2025-03' && x.end === '2025-08';
})());
/* 分隔符归一化的**顺序**：先把「空格包围的连字符」处理掉，再处理「至」。
   反过来会把 ' - 至今' 变成 ' -|今'，连字符就留在 start 里 —— 界面上显示成
   「2023.09 - - 今」，而所有旧断言全绿（它们没覆盖「连字符 + 至」这种组合）。 */
ok('经历层：连字符 + 至 的组合不能留下半个连字符（2023.09 - 至今）', (function () {
  const x = SPLIT_T('2023.09 - 至今');
  return x.start === '2023.09' && x.end === '今';
})());
ok('经历层：没空格的「至今」也要切干净', (function () {
  const x = SPLIT_T('2023.09-至今');
  return x.start === '2023.09' && x.end === '今';
})());
ok('经历层：起止拼回去不会出现「- -」这种接缝', (function () {
  const x = SPLIT_T('2023.09 - 至今');
  return JOIN_T(x.start, x.end) === '2023.09 - 今';
})());
ok('经历层：单位数的月份（2023.9 - 2024.1）', (function () {
  const x = SPLIT_T('2023.9 - 2024.1');
  return x.start === '2023.9' && x.end === '2024.1';
})());
ok('经历层：「至今」单独出现时不会被当成起止', (function () {
  const x = SPLIT_T('至今');
  return x.start === '至今' && x.end === '';
})());

const migIn = [
  { id: 'x1', project: '甲项目', time: '2025.03 - 2025.08', action: '做了 A' },
  { id: 'x2', project: '甲项目', time: '2025.03 - 2025.08', action: '做了 B' },
  { id: 'x3', project: '乙项目', time: '2024', action: '做了 C' }
];
const mig1 = MIG_EXP(migIn, []);
ok('迁移：同项目的两条成就收敛成一条经历（项目名只留一份）', mig1.experiences.length === 2);
ok('迁移：两条成就都挂上了 expId，且指向同一条经历', !!mig1.inventory[0].expId && mig1.inventory[0].expId === mig1.inventory[1].expId);
ok('迁移：不同项目挂到不同经历', mig1.inventory[2].expId !== mig1.inventory[0].expId);
ok('迁移：经历的时间从成就的 time 解析出来', mig1.experiences[0].start === '2025.03' && mig1.experiences[0].end === '2025.08');
ok('迁移：经历名取自成就的项目名', mig1.experiences[0].name === '甲项目');
ok('迁移：幂等 —— 拿结果再跑一次，经历不会翻倍', (function () { return MIG_EXP(mig1.inventory, mig1.experiences).experiences.length === 2; })());
ok('迁移：认不出名字的归到「未归类的经历」，不凭空编一个名字', (function () {
  const m = MIG_EXP([{ id: 'y1', action: '做了 D' }], []);
  return m.experiences.length === 1 && m.experiences[0].name === '未归类的经历' && !!m.inventory[0].expId;
})());
ok('迁移：项目名首尾空格会被 trim，仍算同一条（不分裂）', (function () {
  return MIG_EXP([{ id: 'z1', project: '甲项目 ', action: 'A' }, { id: 'z2', project: '甲项目', action: 'B' }], []).experiences.length === 1;
})());
ok('经历名：显式名字优先', EXP_NAME({ name: '甲项目', org: '甲公司' }) === '甲项目');
ok('经历名：没名字时用「组织 · 角色」拼', EXP_NAME({ name: '', org: '甲公司', role: '实习生' }) === '甲公司 · 实习生');
ok('经历名：什么都没有时也不返回空串', EXP_NAME({}) === '未命名的经历');
ok('经历默认类别是「项目经历」', (function () { return MIG_EXP([{ id: 'q1', project: '甲', action: 'A' }], []).experiences[0].kind === 'proj'; })());

/* mergeState 层：老存档打开时的迁移 */
const st4 = mergeState({ ver: 3, inventory: [
  { id: 'a', project: 'P', time: '2025.01 - 2025.06', action: '做了 A' },
  { id: 'b', project: 'P', time: '2025.01 - 2025.06', action: '做了 B' }
] });
ok('迁移：老存档（没有 experiences 键）打开后自动长出经历层', st4.experiences.length === 1);
ok('迁移：ver 升到 4', st4.ver === 4);
ok('迁移：老存档的成就一条不丢', st4.inventory.length === 2);
ok('迁移：经历名取自成就的项目名', st4.experiences[0].name === 'P');
ok('迁移：经历的时间从成就的 time 补齐', st4.experiences[0].start === '2025.01' && st4.experiences[0].end === '2025.06');
ok('迁移：默认状态自带 experiences（不必迁移也是空数组）', Array.isArray(mergeState({}).experiences) && mergeState({}).experiences.length === 0);
ok('迁移：缺 project 但挂了 expId 的成就仍算有效数据', (function () {
  const st = mergeState({ ver: 4, experiences: [{ id: 'e1', name: '甲', kind: 'work' }], inventory: [{ id: 'k1', expId: 'e1', action: '做了 A' }] });
  return st.inventory.length === 1 && st.inventory[0].expId === 'e1' && st.experiences.length === 1;
})());
ok('迁移：指向不存在经历的成就 —— 收容到「未归类的经历」（不丢数据、也不留悬空指针）', (function () {
  const st = mergeState({ ver: 4, experiences: [], inventory: [{ id: 'k2', expId: 'ghost', action: '做了 B' }] });
  return st.inventory.length === 1 && !!st.inventory[0].expId && st.inventory[0].expId !== 'ghost'
    && st.experiences.length === 1 && st.experiences[0].name === '未归类的经历';
})());
ok('迁移：既没名字又没成就的空经历被丢掉', (function () {
  const st = mergeState({ ver: 4, experiences: [{ id: 'e9', name: '', kind: 'proj' }], inventory: [] });
  return st.experiences.length === 0;
})());
/* 经历分两种出身：src='auto' 由成就的项目名反推出来（派生），src='user' 是用户手建/手改的。
   派生经历名下一旦没有成就就是空壳 —— 界面会多出一张「这段经历还没有记录成就」的空卡，
   所以丢掉；用户资产哪怕暂时没成就也绝不替他删（第二十六轮）。 */
ok('空壳：派生经历（src=auto）即使有名字，名下没成就也丢掉', (function () {
  const st = mergeState({ ver: 4, experiences: [{ id: 'e8', name: '甲项目', kind: 'proj' }], inventory: [] });
  return st.experiences.length === 0;
})());
ok('空壳：用户手建的经历（src=user）暂时没成就也留着', (function () {
  const st = mergeState({ ver: 4, experiences: [{ id: 'e7', name: '我加的经历', kind: 'work', src: 'user' }], inventory: [] });
  return st.experiences.length === 1 && st.experiences[0].src === 'user';
})());
ok('空壳：名下还有成就的派生经历不动（别把有用的也清了）', (function () {
  const p = pruneExperiences([{ id: 'e1', name: '甲', src: 'auto' }], [{ id: 'k1', expId: 'e1', action: 'A' }]);
  return p.experiences.length === 1 && p.inventory[0].expId === 'e1';
})());
ok('空壳：没有任何成就挂靠的派生经历被丢掉，成就本身一条不丢', (function () {
  const p = pruneExperiences([{ id: 'e3', name: '空壳', src: 'auto' }], [{ id: 'k3', action: 'A' }]);
  return p.experiences.length === 0 && p.inventory.length === 1 && p.inventory[0].action === 'A';
})());
ok('空壳：同名经历下 2 条成就 → 经历保留，两条指针都还指着它', (function () {
  const p = pruneExperiences([{ id: 'e4', name: '甲', src: 'auto' }], [{ id: 'k4', expId: 'e4', action: 'A' }, { id: 'k5', expId: 'e4', action: 'B' }]);
  return p.experiences.length === 1 && p.inventory.every(function (it) { return it.expId === 'e4'; });
})());
ok('空壳：指向不存在经历的 expId 被清掉（不留悬空指针）', (function () {
  const p = pruneExperiences([], [{ id: 'k6', expId: 'ghost', action: 'A' }]);
  return p.experiences.length === 0 && p.inventory.length === 1 && !p.inventory[0].expId;
})());

ok('载荷：没备料时 sections.custom 不存在', (function () {
  const pay = buildFillPayload('没有备料的公司', '岗位X', { name: '张三' }, { projects: [] });
  return !pay.sections.custom;
})());
ok('载荷：备料后挂到 sections.custom（官网描述栏的正解）', (function () {
  setKitDoc('京东', '算法工程师', { bullets: ['主导了 A，提升效率', '完成 B'], at: '2026-09-14' });
  const pay = buildFillPayload('京东', '算法工程师', { name: '张三' }, { projects: [] });
  return pay.sections.custom && pay.sections.custom.bullets.length === 2;
})());
ok('载荷：custom 带上生成日期；版本号已随三版删除', (function () {
  const pay = buildFillPayload('京东', '算法工程师', { name: '张三' }, { projects: [] });
  return pay.sections.custom.version === undefined && pay.sections.custom.at === '2026-09-14';
})());
ok('载荷：custom.text 是换行拼好的整段', (function () {
  const pay = buildFillPayload('京东', '算法工程师', { name: '张三' }, { projects: [] });
  return pay.sections.custom.text.split('\\n').length === 2;
})());
ok('载荷：schema 仍是 v2 —— 加字段不升版，老扩展读到会忽略', (function () {
  const pay = buildFillPayload('京东', '算法工程师', { name: '张三' }, { projects: [] });
  return pay.schema === 'zhiyin.fill.v2';
})());
ok('载荷：本岗文案不污染 fields 基础字段', (function () {
  const pay = buildFillPayload('京东', '算法工程师', { name: '张三', email: '' }, { projects: [] });
  return Object.keys(pay.fields).length === 1 && pay.fields.name === '张三';
})());

/* 迁移：投递包是新键，老存档必须能平滑升上来 */
ok('迁移：老存档没有 kits 键时补空对象（不能让老用户炸在这一步）', (function () {
  const s = mergeState({ ver: 3 });
  return s.kits && typeof s.kits === 'object' && !Array.isArray(s.kits) && Object.keys(s.kits).length === 0;
})());
ok('迁移：没有 bullets 的空壳投递包被丢掉', (function () {
  const s = mergeState({ ver: 3, kits: { 'a|b': { doc: { bullets: [] } }, 'c|d': { doc: { bullets: ['x'] } } } });
  return Object.keys(s.kits).length === 1 && s.kits['c|d'];
})());
ok('迁移：脏版本号归一到 >=1（不能把 NaN 带进界面）', (function () {
  const s = mergeState({ ver: 3, kits: { 'a|b': { doc: { bullets: ['x'], version: 'abc' } } } });
  return s.kits['a|b'].doc.version === 1;
})());
ok('迁移：旧存档里的投递记录一个不丢（加新键不能伤老数据）', (function () {
  const s = mergeState({ ver: 3, kits: {}, applications: [{ company: 'A', position: 'B' }] });
  return s.applications.length === 1;
})());

/* ============ 第四十八轮：申学侧老存档脆弱点补齐（变异测试逐项复现过报错形态） ============ */
ok('迁移：studyPref 缺 regions/fields/custom* 时补空数组（否则偏好块 indexOf 炸）', (function () {
  const s = mergeState({ ver: 4, studyPref: { weights: { 硬性条件: 55, 研究方向: 25, 地区偏好: 10, 科研产出: 10 } } });
  return Array.isArray(s.studyPref.regions) && Array.isArray(s.studyPref.fields)
    && Array.isArray(s.studyPref.customRegions) && Array.isArray(s.studyPref.customFields);
})());
ok('迁移：studyPref 缺 weights 或权重缺键时逐项补默认值（否则 Object.keys 炸）', (function () {
  const a = mergeState({ ver: 4, studyPref: {} }).studyPref.weights;
  const b = mergeState({ ver: 4, studyPref: { weights: { 硬性条件: 70 } } }).studyPref.weights;
  return a['硬性条件'] === 55 && a['研究方向'] === 25 && b['硬性条件'] === 70 && b['研究方向'] === 25;
})());
ok('迁移：profMail 缺 targets/sender 时补齐（否则导师检索 length 炸）', (function () {
  const s = mergeState({ ver: 4, profMail: { scope: 'abroad' } });
  return Array.isArray(s.profMail.targets) && s.profMail.sender && typeof s.profMail.sender.name === 'string';
})());
ok('迁移：pushLog 缺 ids/history 时补空数组（否则同日再渲染 indexOf 炸）', (function () {
  const s = mergeState({ ver: 4, pushLog: { date: '2026-09-16' } });
  return Array.isArray(s.pushLog.ids) && Array.isArray(s.pushLog.history);
})());
ok('迁移：旧版改写结果（ok=true 缺 bullets）被丢弃，不进渲染层（forEach 炸点）', (function () {
  const s = mergeState({ ver: 4, docAdapt: { mode: 'ps', req: '要求', result: { ok: true, usedItems: [1], alignment: 0.5 } } });
  return s.docAdapt.result === null && s.docAdapt.req === '要求';
})());
ok('迁移：新版改写结果（bullets/usedItems 齐全）原样保留', (function () {
  const r = { ok: true, usedItems: [1], bullets: [{ text: 'x', orig: 'x', sourceId: 'a' }], alignment: 0.5 };
  const s = mergeState({ ver: 4, docAdapt: { mode: 'ps', req: '', result: r } });
  return s.docAdapt.result === r;
})());
ok('迁移：老存档自动补齐岗位来源筛选键（默认全部来源，不缺下拉选项）', mergeState({ ver: 3 }).filters.jobSrc === '全部来源');

/* ============ 第三十五轮：解析根因修复（本套件可直接调 parseResume） ============ */
const issn35 = parseResume('教育背景\\n贵州医科大学 口腔医学 本科 2020.09 - 2025.07\\n《论文》发表于《饮食保健》2021 年第 25 期（ISSN 2095-8439）');
ok('ISSN 2095-8439 不再污染毕业年份（年份区间 + 月份后缘检查）',
  issn35.profile.gradYear === '2025-07', JSON.stringify(issn35.profile.gradYear));
const deco35 = parseResume('杨明翰 | 求职意向：产品运营\\n电话：13800000000\\n教育背景\\n香港城市大学 健康科学与管理 硕士 2025.09 - 2026.10');
ok('装饰首行「杨明翰 | 求职意向…」认出姓名并标「待确认」',
  deco35.profile.name === '杨明翰' && deco35.meta.name === 'guess', deco35.profile.name + '/' + deco35.meta.name);
const org35 = parseResume('某某大学招生简章 | 2026 版\\n教育背景\\n某大学 本科 2022.09 - 2026.06');
ok('机构名不冒充人名（「某某大学招生简章」不识别成姓名）', !org35.profile.name && org35.meta.name === 'miss');
const pct35 = parseResume('姓名：张三\\n教育背景\\n某大学 软件工程 本科 2022.09 - 2026.06 GPA 85/100');
ok('百分制 85：gpaRaw 纯数值 + gpaScale=100 + 折算 ≈ 3.7',
  pct35.profile.gpaRaw === '85' && pct35.profile.gpaScale === 100 && pct35.profile.gpa === 3.7,
  JSON.stringify([pct35.profile.gpaRaw, pct35.profile.gpaScale, pct35.profile.gpa]));
ok('filters 默认值带上 jobQ 与 prefOpen（老存档由 mergeState 兜底补齐）',
  (function () { const df = defaultFilters(); return df.jobQ === '' && !!df.prefOpen && df.prefOpen.city === false; })());
/* ============ 第三十六轮：GPA 老档回填 + 申学折叠状态位 ============ */
ok('老档只存 gpa（4 分制数值）时回填 gpaRaw/gpaScale，成绩框不再空白',
  (function () {
    const m = mergeState({ profile: { gpa: 3.6 } }).profile;
    return m.gpaRaw === '3.6' && m.gpaScale === 4 && m.gpa === 3.6;
  })());
ok('新档清空成绩（gpaRaw 空、gpa null）不会被回填出假数据',
  (function () {
    const m = mergeState({ profile: { gpaRaw: '', gpa: null } }).profile;
    return m.gpaRaw === '' && m.gpa === null;
  })());
ok('studyPref 默认带 prefOpen（申学偏好折叠状态有地方记）',
  (function () {
    const sp = mergeState({}).studyPref;
    return !!sp.prefOpen && sp.prefOpen.region === false && sp.prefOpen.field === false;
  })());

/* 导入岗位（zhiyin.jobs.v1）扩展字段：岗位表快照进池的关键路径 */
out.push('=== 16b. 导入岗位扩展字段（group/tag/ddl/grad/ref/tweet/applyUrl） ===');
(function () {
  const before = JOBS.length;
  const r = importJobs(JSON.stringify({ schema: 'zhiyin.jobs.v1', items: [
    { company: '示例药业', position: '秋招 · 研发 / 营销 等2个方向', city: '全国多地', group: 'bio', tag: '秋招',
      grad: '27届应届', ddl: '2026-10-31', ref: 'ABC123', tweet: 'https://mp.weixin.qq.com/s/x',
      url: 'https://ex.com/campus', applyUrl: 'https://ex.com/campus', skills: ['研发', '营销'] }
  ] }));
  ok('扩展字段导入成功且计数正确', r.ok && r.stat.added === 1 && JOBS.length === before + 1);
  const j = JOBS[JOBS.length - 1];
  ok('group 认显式值（不再靠关键词猜）', j.group === 'bio');
  ok('tag 用导入方给的值（不是硬编码「导入」）', j.tag === '秋招');
  ok('ddl / grad / ref / tweet 四个可选字段原样落库',
    j.ddl === '2026-10-31' && j.grad === '27届应届' && j.ref === 'ABC123' && j.tweet === 'https://mp.weixin.qq.com/s/x');
  ok('applyUrl 生效：直达官网入口与按钮文案', applyEntryUrl(j) === 'https://ex.com/campus' && applyEntryLabel(j) === '直达官网');
  ok('只给 url 没给 applyUrl 时回落到 url', (function () {
    const r2 = importJobs(JSON.stringify({ items: [{ company: '示例药业', position: '实习 · 量产岗', url: 'https://ex.com/i' }] }));
    const j2 = JOBS[JOBS.length - 1];
    return r2.ok && r2.stat.added === 1 && j2.applyUrl === 'https://ex.com/i';
  })());
  ok('重复导入被跳过（只补不覆）',
    importJobs(JSON.stringify({ items: [{ company: '示例药业', position: '秋招 · 研发 / 营销 等2个方向' }] })).stat.skipped === 1);
  ok('group 给了认不出的值时回落关键词识别',
    importJobs(JSON.stringify({ items: [{ company: '示例钢管', position: '焊接工程师', group: 'nope' }] })).ok &&
    JOBS[JOBS.length - 1].group !== 'nope');
  ok('扩展字段不污染：没给这些字段的旧格式照常导入', (function () {
    const r3 = importJobs(JSON.stringify({ items: [{ company: '示例钢管', position: '质检员' }] }));
    const j3 = JOBS[JOBS.length - 1];
    return r3.ok && j3.tag === '导入' && j3.ddl === undefined && j3.ref === undefined;
  })());
})();

out.push('');
out.push('=== 结果 ===');
out.push(pass + ' 项通过' + (fail ? '，' + fail + ' 项失败' : '，全部通过' ));
console.log(out.join('\\n'));
if (fail) process.exitCode = 1;
`;

/* ============================================================
   附加自测：导师检索 + 套磁邮件 + 文书适配器（新增功能）
   这些函数定义在第 12B/12C 节，独立 vm 段跑，避免影响主测试
   ============================================================ */
(function () {
  /* 新增功能段在 renderSchoolList 之后 → renderProfSearch → renderDocAdapt → 第 13 节前 */
  const cutoff = js.indexOf('function renderSchoolList');
  if (cutoff < 0) {
    console.log('\\n=== 17. 导师检索 + 套磁邮件 ===\\n  [SKIP] 未找到 renderSchoolList，请检查原型结构');
    return;
  }
  /* 从 renderSchoolList 开始往后到第 13 节前 = 包含 PROF_FACULTY_URL / buildMail / renderProfSearch / renderDocAdapt */
  const extraEnd = js.indexOf('/* ---------- 13. 渲染：求职模块');
  const extraCode = extraEnd > 0 ? js.slice(cutoff, extraEnd) : js.slice(cutoff);

  const out2 = [];
  let pass2 = 0, fail2 = 0;
  function ok2(name, cond, extra) {
    if (cond) { pass2++; out2.push('  [PASS] ' + name); }
    else { fail2++; out2.push('  [FAIL] ' + name + (extra ? '  -> ' + extra : '')); }
  }

  out2.push('=== 17. 导师检索 + 套磁邮件 ===');

  /* 独立 vm 跑新增段 */
  const sandbox = {
    console, JSON, Math, Date, Array, Object, String, Number, Map, Set, RegExp, Boolean, Error,
    navigator: { clipboard: { writeText: function () { return Promise.resolve(); } } },
    window: {}, document: { querySelector: function () { return null; }, querySelectorAll: function () { return []; }, addEventListener: function () {} },
    SCHOOLS: [{ school: '爱丁堡大学' }, { school: '香港大学' }],
    state: {}
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  /* 顶层 const 改 var 才能从 sandbox 访问 */
  const code = extraCode.replace(/^const /gm, 'var ').replace(/if \(document\.readyState === 'loading'\)[\s\S]*$/m, '');
  try { vm.runInContext(code, sandbox, { filename: 'extra.js' }); }
  catch (e) {
    out2.push('  [FAIL] 新增段加载异常：' + e.message.split('\n')[0]);
    fail2++;
    console.log(out2.join('\n'));
    return;
  }

  const U = sandbox.upgradeText;
  ok2('upgradeText：参与→主导', U && U('我参与了该项目') === '我主导了该项目');
  ok2('upgradeText：协助→独立完成', U && U('我协助老师改 bug') === '我独立完成老师改 bug');
  ok2('upgradeText：熟悉→精通', U && U('熟悉 Python') === '精通 Python');
  ok2('upgradeText：空输入→空', U && U('') === '');

  const EK = sandbox.extractKeywords;
  ok2('extractKeywords：提取中文关键词', EK && JSON.stringify(EK('深度学习 神经网络 深度学习 机器学习')) === JSON.stringify(['深度学习', '神经网络', '机器学习']));
  ok2('extractKeywords：过滤停用词', EK && !EK('和 在 的 了 是').length);
  ok2('extractKeywords：英文关键词', EK && EK('machine learning deep learning machine learning').indexOf('machine') !== -1);

  /* doAdapt/老 doAdapt 测试已废除（第十七轮重写为基于成就仓库的新签名 doAdaptFromInventory）。
     老测试移到下面专门段：doAdaptFromInventory V1/V2/V3 测试。 */

  const BM = sandbox.buildMail;
  const sender = { name: '张三/San Zhang', school: '南京大学 2026 届硕士', background: 'AAAI 2025 一作', interest: 'NeurIPS 论文兴趣' };
  const tgts = [{ name: 'Dr Jane Smith', page: 'https://x.com/j', field: 'NLP' }, { name: 'Prof John Doe', page: 'https://x.com/p', field: 'CV' }];
  const m1 = BM && BM(tgts, sender);
  ok2('buildMail 返回 targets.length 项', m1 && m1.targets.length === tgts.length);
  ok2('buildMail Dr. 称谓', m1 && /Dear Dr\. Smith/.test(m1.targets[0].en));
  ok2('buildMail Prof. 称谓', m1 && /Dear Prof\. Doe/.test(m1.targets[1].en));
  ok2('buildMail 中文版含背景', m1 && m1.targets[0].zh.indexOf('AAAI 2025') !== -1);

  ok2('schoolDomain 爱丁堡', sandbox.schoolDomain('爱丁堡大学') === 'ed.ac.uk');
  ok2('schoolDomain 港大', sandbox.schoolDomain('香港大学') === 'cs.hku.hk');
  ok2('PROF_FACULTY_URL 覆盖 21 所', sandbox.PROF_FACULTY_URL && Object.keys(sandbox.PROF_FACULTY_URL).length >= 21);
  ok2('PROF_FACULTY_URL 澳门大学有', sandbox.PROF_FACULTY_URL && sandbox.PROF_FACULTY_URL['澳门大学']);
  ok2('PROF_CACHE 命中爱丁堡', sandbox.PROF_CACHE && sandbox.PROF_CACHE.some(function (p) { return p.school === '爱丁堡大学'; }));

  out2.push('=== 18. 投递卡 → 文书改写联动（customDoc）===');
  /* JD 字段标签不该被当成目标关键词。
     tokenize 不分词，会把「招聘岗位」「工作地点在北京」整体切出来；
     CN_STOP（2 字词）+ JD_LABEL_PREFIX（前缀拦截）两层一起挡。 */
  const ek2 = sandbox.extractKeywords;
  ok2('JD 标签「招聘岗位」被过滤', ek2 && ek2('招聘岗位 字节跳动').indexOf('招聘岗位') === -1);
  ok2('JD 标签「工作地点在北京」被过滤', ek2 && ek2('工作地点在北京 算法').indexOf('工作地点在北京') === -1);
  ok2('JD 标签「学历要求」被过滤', ek2 && ek2('学历要求 硕士').indexOf('学历要求') === -1);
  ok2('真实关键词不被误杀：字节跳动', ek2 && ek2('招聘岗位 字节跳动').indexOf('字节跳动') !== -1);
  ok2('真实关键词不被误杀：算法工程师', ek2 && ek2('招聘岗位 算法工程师').indexOf('算法工程师') !== -1);
  ok2('真实关键词不被误杀：python（小写归一）', ek2 && ek2('技能要求 Python PyTorch').indexOf('python') !== -1);

  /* openAdaptForJob 在「附加测试」的代码切片范围之外（它属于求职模块那段），
     所以这里用源码级断言检查它的关键行为，而不是调用它。 */
  const htmlSrc0 = require('fs').readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  ok2('openAdaptForJob 已定义', /function openAdaptForJob\(a\)/.test(htmlSrc0));
  ok2('openAdaptForJob：绑定 activeJobId', /d\.activeJobId = a\.id/.test(htmlSrc0));
  ok2('openAdaptForJob：切 mode=cv', /d\.mode = 'cv'/.test(htmlSrc0));
  ok2('openAdaptForJob：清空旧 result', /d\.result = null/.test(htmlSrc0));
  /* 第二十二轮：JD 构造统一收到 buildJdText（投递工作台与投递中心共用一份，口径不漂） */
  ok2('openAdaptForJob：JD 走统一的 buildJdText', /const jdText = buildJdText\(a\.company, a\.position\)/.test(htmlSrc0));
  ok2('buildJdText：用自然语序「招聘岗位」', /parts\.push\('招聘岗位：' \+ company/.test(htmlSrc0));
  ok2('buildJdText：从 JOBS 取该岗位的技能', /j\.skills\.join\('、'\)/.test(htmlSrc0));
  ok2('openAdaptForJob：滚到 track 版卡片', /getElementById\('docAdaptTrack'\)/.test(htmlSrc0));
  ok2('投递卡带改写按钮 data-adapt', /data-adapt="' \+ esc\(a\.id\)/.test(htmlSrc0));
  ok2('看板卡片也带改写按钮', /function renderBoard[\s\S]{0,2600}data-adapt=/.test(htmlSrc0));
  ok2('bindAppActions 监听 data-adapt', /\[data-adapt\]'\)\.forEach/.test(htmlSrc0));
  /* 两条创建路径都要**显式**声明 customDoc：应用内登记顺手带上本岗文案，
     官网登记此刻还没有文案（留 null，不虚构） —— 但两条都不能靠 undefined 兜底。 */
  ok2('两条投递创建路径都显式带 customDoc 字段',
    /customDoc: kitToCustomDoc\(company, position\)/.test(htmlSrc0) && /customDoc: null/.test(htmlSrc0));
  ok2('改写存档时同步回投递包（不制造第二个孤岛）', /setKitDoc\(a\.company, a\.position/.test(htmlSrc0));

  /* 已有 customDoc 时 orig 预填上一版：由 renderDocAdapt 的 activeJob 绑定逻辑保证，
     这里检查源码里有这条赋值 */
  ok2('openAdaptForJob：已有 customDoc 时 orig 预填上一版', /d\.orig = \(a\.customDoc && a\.customDoc\.upgraded\)/.test(htmlSrc0));

  /* 保存逻辑：customDoc 结构含 version 递增 */
  ok2('保存 customDoc 时 version 递增', /version: prev \? \(prev\.version \+ 1\) : 1/.test(htmlSrc0));
  ok2('customDoc 存 bullets / jdKeywords（第十七轮重写后；pickedVersion 已随三版删除）',
    /bullets: bullets/.test(htmlSrc0) && /jdKeywords: d\.result\.jdKeywords/.test(htmlSrc0));
  ok2('renderDocAdapt 是函数', typeof sandbox.renderDocAdapt === 'function');
  ok2('bindDocAdapt 是函数', typeof sandbox.bindDocAdapt === 'function');

  /* 源码级检查：两份卡片的 id 不重复（重复会让 querySelector 永远只命中第一个） */
  const htmlSrc = require('fs').readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  ok2('docAdapt id 在 HTML 中只出现一次', (htmlSrc.match(/id="docAdapt"/g) || []).length === 1);
  ok2('docAdaptTrack id 在 HTML 中出现一次', (htmlSrc.match(/id="docAdaptTrack"/g) || []).length === 1);
  /* bindDocAdapt 必须用相对查找，不能用全局 $('#…') / document.getElementById ——
     两份卡片由同一个 renderDocAdapt 渲染，全局查找只会命中先出现的那一份（在隐藏视图里）。
     第二十八轮把卡片内控件的 id 全换成 data-da，重复 id 这一整类就此消失。 */
  ok2('bindDocAdapt 用 root.querySelectorAll 相对查找', /root\.querySelectorAll\('\[data-mode\]'\)/.test(htmlSrc));
  ok2('适配器控件不再用 id（防重复 id）',
    ['daReq', 'daGo', 'daWb'].every(function (n) { return htmlSrc.indexOf('id="' + n + '"') < 0; }));
  ok2('改写输入框按 data-da 相对定位', htmlSrc.indexOf('[data-da="req"]') >= 0);

  /* 第三十三轮：V1/V2/V3 与 pickedVersion 已删，默认值不再带版本字段；
     顶层默认值仍必须写全字段（教训 1），这条回归留着。 */
  const topDocAdaptDecls = (htmlSrc.match(/state\.docAdapt\s*=\s*state\.docAdapt\s*\|\|\s*\{[^}]*\}/g) || [])
    .filter(function (d) { return !/^\s*state\.docAdapt\s*=\s*state\.docAdapt\s*\|\|\s*\{\s*\}\s*$/.test(d); });
  ok2('顶层 state.docAdapt 默认值数量 >= 2（含字段的声明）', topDocAdaptDecls.length >= 2, 'n=' + topDocAdaptDecls.length);
  ok2('默认值不再带 pickedVersion（三版概念已删）',
    topDocAdaptDecls.length > 0 && topDocAdaptDecls.every(function (d) { return /pickedVersion/.test(d) === false; }));
  ok2('源码里不再有 pickedVersion / 选这版 / 版本折叠组',
    htmlSrc.indexOf('pickedVersion') < 0 && htmlSrc.indexOf('data-pick') < 0 && htmlSrc.indexOf('data-body') < 0);

/* ---------- 19. CAR 改写引擎（第十七轮） ---------- */
function ok3(label, cond) { ok2(label, cond); }

const SPLIT = sandbox.splitOldResumeToItems;
const METRIC_M = sandbox.metricOf;
const SCORE = sandbox.scoreForJD;
const BUILD_CAR = sandbox.buildCAR;
const DO_ADAPT = sandbox.doAdaptFromInventory;
const SELECT_ITEMS = sandbox.selectItems;

const splitT = '主导了 X 项目，获得了 N% 的提升；负责 Y 模块，独立完成 Z。Enforced X+15 improvements.';
ok3('splitOldResumeToItems: 至少 2 段', SPLIT && SPLIT(splitT).length >= 2);
ok3('splitOldResumeToItems: 每段 >= 8 字', SPLIT && SPLIT(splitT).every(function (s) { return s.length >= 8; }));
ok3('splitOldResumeToItems: 空文本返空', SPLIT && SPLIT('').length === 0);

/* 第三十三轮：carHead / 动词升级整个下线 —— 它把每条都塞成「主导…」开头，
   还把「协助」抬成「主导」，等于替用户注水；措辞交给 AI。
   空 action 的兜底也换掉：原来那句「主导了一个项目」本身就是编。 */
ok3('buildCAR: 空 action 用项目名兜底（项目名是用户自己写的，不算编）',
  (function () { const c = BUILD_CAR({ id: 'h1', project: '多模态检索', action: '', metric: '', impact: '' }); return !!c && c.text === '多模态检索'; })());
ok3('buildCAR: 项目名也没有 → 空文本，不编「主导了一个项目」',
  (function () { const c = BUILD_CAR({ id: 'h2', project: '', action: '', metric: '', impact: '' }); return !!c && c.text === ''; })());
ok3('第三十三轮：源码里不再有 carHead 与「主导了一个项目」兜底',
  js.indexOf('carHead') < 0 && js.indexOf('主导了一个项目') < 0);

ok3('metricOf: 真实数字原样保留', METRIC_M && METRIC_M({ metric: '20%' }) === '20%');
ok3('metricOf: 没填就留空（不再按 impact 推断 [N]% 这类占位）', METRIC_M && METRIC_M({ metric: '', impact: '性能提升 30%' }) === '');
ok3('metricOf: impact 里提到人数也不推断占位', METRIC_M && METRIC_M({ metric: '', impact: '服务 5 万用户' }) === '');
ok3('metricOf: 中文数字（无阿拉伯数字）不算数字', METRIC_M && METRIC_M({ metric: '五项', impact: '' }) === '');
ok3('metricOf: 全空 → 空字符串', METRIC_M && METRIC_M({ metric: '', impact: '' }) === '');
ok3('metricOf: 数字夹在文字里也算（3 个月）', METRIC_M && METRIC_M({ metric: '3 个月' }) === '3 个月');

const jdKwSet = new Set(['python', 'nlp', 'tensorflow', 'pipeline']);
const s1 = SCORE && SCORE({ action: '主导 NLP pipeline 重构，用 Python 与 TensorFlow', impact: '提速 30%', metric: '20%' }, jdKwSet);
ok3('scoreForJD: 4 命中 + 加分', s1 >= 4);
ok3('scoreForJD: 无命中 = 0', SCORE && SCORE({ action: '做了一个产品', impact: '', metric: '' }, jdKwSet) === 0);

const car1 = BUILD_CAR && BUILD_CAR(
  { id: 'c1', action: '主导 Python 与 TensorFlow 的 NLP pipeline 重构', metric: '20%', impact: '延迟降 30%' }
);
ok3('buildCAR: 动作原样保留 + 数字 + 影响（不替用户换词）', car1 && car1.text.indexOf('主导 Python 与 TensorFlow 的 NLP pipeline 重构') === 0 && /20%/.test(car1.text));
ok3('buildCAR: hasRealMetric = true', car1 && car1.hasRealMetric === true);
ok3('buildCAR: 有数字时带在括号里，不再写「关键数字」', car1 && car1.text.indexOf('（20%）') >= 0 && car1.text.indexOf('关键数字') === -1);

const car2 = BUILD_CAR && BUILD_CAR(
  { id: 'c2', action: '主导 NLP pipeline 重构', metric: '', impact: '性能提升' }
);
ok3('buildCAR: 没数字就完全不提数字（不占位、不提示补）', car2 && car2.text.indexOf('[N') === -1 && car2.text === '主导 NLP pipeline 重构，性能提升');
ok3('buildCAR: hasRealMetric = false', car2 && car2.hasRealMetric === false);

const car3 = BUILD_CAR && BUILD_CAR(
  { id: 'c3', action: '用 Python + TensorFlow 重构了 NLP pipeline', metric: '20%', impact: '提速 30%' }
);
ok3('buildCAR: 本地改写不再嵌关键词（kws / kwsPresent 恒为空）', car3 && car3.kws.length === 0 && car3.kwsPresent.length === 0);

const items = [
  { id: 'a', action: '主导 Python NLP 训练 pipeline', impact: '提速', metric: '', project: 'P1', tags: [] },
  { id: 'b', action: '做了一个推荐系统', impact: '', metric: '', project: 'P2', tags: [] },
  { id: 'c', action: '完全无关的项目', impact: '', metric: '', project: 'P3', tags: [] }
];
const picked = SELECT_ITEMS && SELECT_ITEMS(items, new Set(['python', 'nlp', 'pipeline']), 3);
ok3('selectItems: 返回数 <= 上限', picked && picked.length <= 3);
ok3('selectItems: 0 命中仍返回部分', SELECT_ITEMS && SELECT_ITEMS(items, new Set(['rust']), 6).length > 0);

sandbox.state = sandbox.state || {};
sandbox.state.inventory = [];
ok3('doAdaptFromInventory: 仓库空 ok=false', DO_ADAPT && DO_ADAPT('python nlp', { max: 6 }).ok === false);

sandbox.state.inventory = [
  { id: 'i1', project: 'NLP pipeline', time: '2025', action: '主导 Python 与 TensorFlow 的 NLP pipeline 重构', metric: '20%', impact: '延迟降 30%' },
  { id: 'i2', project: '推荐系统', time: '2024', action: '优化召回模型', metric: '5万', impact: 'CTR +12%' },
  { id: 'i3', project: '采购系统', time: '2023', action: '做了一个采购 BFF', metric: '', impact: '' }
];
const r1 = DO_ADAPT('python nlp pipeline 招聘', { max: 6 });
ok3('doAdaptFromInventory: 仓库非空 ok=true', r1 && r1.ok === true);
ok3('doAdaptFromInventory: 只出一版 bullets（三版假版本已删）', r1 && Array.isArray(r1.bullets) && r1.bullets.length > 0);
ok3('doAdaptFromInventory: 结果里不再有 v1/v2/v3', r1 && r1.v1 === undefined && r1.v2 === undefined && r1.v3 === undefined);
ok3('doAdaptFromInventory: alignment > 0', r1 && r1.alignment > 0);
ok3('doAdaptFromInventory: usedItems 非空', r1 && r1.usedItems.length > 0);


  out2.push('=== 20. 经历块解析 + 自动归纳 + 填表数据 v2（第十九轮） ===');
  const SRB = sandbox.summarizeResumeBlocks;
  const BRS = sandbox.buildResumeSections;

  const blockT = [
    '【项目经历】',
    '2024.03 - 2024.12  多模态检索系统',
    '· 基于 CLIP 微调构建图文检索系统，召回率提升 12%',
    '· 负责模型压缩与推理加速，部署至 Kubernetes',
    '',
    '【实习经历】',
    '2025.07 - 2025.12  美团  商业分析实习生',
    '· 负责外卖业务经营分析，搭建 SQL 取数脚本',
    '· 输出用户分层报告，被业务侧采纳'
  ].join('\n');
  const srbR = SRB && SRB(blockT);
  ok3('summarize: 两个经历块 → 恰好 2 条（不逐句拆碎，【章节】行跳过）', srbR && srbR.length === 2, srbR && srbR.length);
  ok3('summarize: 项目名取自标题行', srbR && srbR[0].project === '多模态检索系统', srbR && srbR[0].project);
  ok3('summarize: 时间取自标题行', srbR && srbR[0].time === '2024.03 - 2024.12', srbR && srbR[0].time);
  ok3('summarize: 要点合并进 action', srbR && srbR[0].action.indexOf('；') > 0 && srbR[0].action.indexOf('CLIP') >= 0 && srbR[0].action.indexOf('Kubernetes') >= 0, srbR && srbR[0].action);
  ok3('summarize: 数字优先取提升类', srbR && srbR[0].metric === '12%', srbR && srbR[0].metric);
  ok3('summarize: 无结构文本整段合并为 1 条（宁粗不碎）', SRB && SRB('负责 A 项目的整体推进，主导了 B 系统重构。').length === 1);
  ok3('summarize: 名称：描述 单行 → 名字+动作分离+数字', (function () {
    const r = SRB && SRB('字节跳动 算法实习生：负责推荐召回模块重构，上线后 CTR 提升 12%。');
    return r && r.length === 1 && r[0].project === '字节跳动 · 算法实习生' && r[0].metric === '12%' && r[0].action.indexOf('推荐召回模块重构') >= 0;
  })());

  const resumeT = [
    '姓名：测试',
    '【教育背景】',
    '2021.09 - 2024.06  贵州医科大学  临床医学  本科 GPA 3.4/4.0',
    '2024.09 - 2026.06  香港城市大学  公共卫生  硕士研究生',
    '【工作经历】',
    '2024.03 - 2024.10  京东健康  数据分析师',
    '· 负责业务指标体系，输出周报',
    '【项目经历】',
    '2023.01 - 2023.12  ceRNA 网络数据库',
    '· 构建 ceRNA 网络，整合 TCGA 数据',
    '【荣誉奖项】',
    '2022.10  大学生创新训练项目 三等奖',
    '【语言成绩】',
    'CET-6 556，IELTS 6.5'
  ].join('\n');
  const brsP = { rawText: resumeT, lang: { toefl: null, ielts: 6.5, cet6: 556, cet4: null }, intern: '', projText: '', research: '', papers: 0 };
  const brsR = BRS && BRS(brsP);
  ok3('fill v2: 教育拆出 2 段', brsR && brsR.education.length === 2, brsR && JSON.stringify(brsR.education));
  ok3('fill v2: 本科 + 硕士院校名', brsR && brsR.education[0].school === '贵州医科大学' && brsR.education[1].school === '香港城市大学', brsR && JSON.stringify(brsR.education.map(x => x.school)));
  ok3('fill v2: 专业随行拆出', brsR && brsR.education[0].major === '临床医学' && brsR.education[1].major === '公共卫生', brsR && JSON.stringify(brsR.education.map(x => x.major)));
  ok3('fill v2: 学历层级 本科/硕士', brsR && brsR.education[0].degree === '本科' && brsR.education[1].degree === '硕士');
  ok3('fill v2: 工作经历 公司+职位+要点', brsR && brsR.work.length === 1 && brsR.work[0].company === '京东健康' && brsR.work[0].role === '数据分析师' && brsR.work[0].bullets.length === 1, brsR && JSON.stringify(brsR.work));
  ok3('fill v2: 项目带职责 duties', brsR && brsR.projects.length === 1 && brsR.projects[0].name === 'ceRNA 网络数据库' && brsR.projects[0].duties.length === 1, brsR && JSON.stringify(brsR.projects));
  ok3('fill v2: 语言 2 项', brsR && brsR.language.length === 2);
  ok3('fill v2: 证书含 CET-6 / IELTS', brsR && brsR.certs.some(x => x.name.indexOf('CET-6') >= 0) && brsR.certs.some(x => x.name.indexOf('IELTS') >= 0), brsR && JSON.stringify(brsR.certs));
  ok3('fill v2: 荣誉识别三等奖且剥掉日期', brsR && brsR.honors.length === 1 && brsR.honors[0].name.indexOf('三等奖') >= 0 && brsR.honors[0].name.indexOf('2022') < 0, brsR && JSON.stringify(brsR.honors));
  ok3('fill v2: 校园经历无则留空（不编造）', brsR && brsR.campus.length === 0);
  ok3('fill v2: 载荷 schema v2 且带 sections', (function () {
    const fp2 = sandbox.buildFillPayload('美团', '数据分析师', { name: '张三' }, brsR);
    return fp2.schema === 'zhiyin.fill.v2' && fp2.sections === brsR && fp2.fields.name === '张三';
  })());
  out2.push('=== 21. 多行标题经历解析 + 填表数据科研段回退（第二十轮） ===');
  const blockT2 = [
    '【实习经历】',
    '京东健康（京东互联网医院）',
    '产品运营实习生',
    '2025.11- 2026.01',
    '・用户调研与竞品分析：完整体验医检诊药业务闭环，输出完整竞品分析报告。',
    '・慢病产品功能优化设计：独立设计慢病极速续方浮窗功能，预估提升慢病转化15%。',
    '',
    '【科研经历】',
    'ceRNA 网络分析项目',
    '项目成员',
    '・多组学数据自动化解析与归档：使用Python递归解析TCGA嵌套JSON元数据并归档。'
  ].join('\n');
  const srb2 = SRB && SRB(blockT2);
  ok3('多行标题：公司/岗位/时间各占一行 → 仍合并为一条经历', srb2 && srb2.length === 2, srb2 && srb2.length);
  ok3('多行标题：名称 = 公司 · 岗位', srb2 && srb2[0].project === '京东健康（京东互联网医院） · 产品运营实习生', srb2 && srb2[0].project);
  ok3('多行标题：时间取自第三行', srb2 && srb2[0].time === '2025.11 - 2026.01', srb2 && srb2[0].time);
  ok3('全角中点・是要点符号（两要点合并进 action）', srb2 && srb2[0].action.indexOf('；') > 0, srb2 && srb2[0].action.slice(0, 40));
  ok3('成果数字提取 15%', srb2 && srb2[0].metric === '15%', srb2 && srb2[0].metric);
  ok3('科研段项目也归纳（ceRNA）', srb2 && /ceRNA/.test(srb2[1].project), srb2 && srb2[1].project);
  const brs2 = BRS && BRS({ rawText: blockT2, lang: {} });
  ok3('fill v2: 科研经历回退为项目经历（ceRNA 不再丢）', brs2 && brs2.projects.length === 1 && /ceRNA/.test(brs2.projects[0].name), brs2 && JSON.stringify(brs2.projects));
  ok3('fill v2: 工作经历公司/岗位拆开', brs2 && brs2.work.length === 1 && brs2.work[0].company === '京东健康（京东互联网医院）' && brs2.work[0].role === '产品运营实习生', brs2 && JSON.stringify(brs2.work));
  ok3('fill v2: 项目 duties 带要点', brs2 && brs2.projects.length === 1 && brs2.projects[0].duties.length === 1);
    ok3('fill v2: 手动粘贴（无解析）也能带出经历（expText/research 兜底）', (function () {
    const r = BRS && BRS({ expText: '京东健康（京东互联网医院）\n产品运营实习生\n2025.11- 2026.01\n・用户调研与竞品分析：输出完整竞品分析报告。', research: 'ceRNA 网络分析项目\n项目成员\n・多组学数据自动化解析并归档。', lang: {} });
    return r && r.work.length === 1 && r.work[0].company === '京东健康（京东互联网医院）' && r.projects.length === 1 && /ceRNA/.test(r.projects[0].name);
  })());
out2.push('=== 22. 折行复原 + 裸标题 + 项目=科研（第二十一轮） ===');
  const RHK = sandbox.resumeHeadingKey;
  const UWL = sandbox.unwrapResumeLines;

  /* --- 22.1 章节识别：裸标题行（无【】）也要认 --- */
  ok3('章节：裸标题「实习经历」→ work', RHK && RHK('实习经历') === 'work', RHK && RHK('实习经历'));
  ok3('章节：「科研经历」与「项目经历」同类 → proj', RHK && RHK('科研经历') === 'proj' && RHK('项目经历') === 'proj');
  ok3('章节：【】包裹同样认', RHK && RHK('【教育背景】') === 'edu');
  ok3('章节：要点行不是标题', RHK && RHK('・教育背景：这是正文内容') === '');
  ok3('章节：长正文行不是标题', RHK && RHK('这是一行足够长的正文内容不应该被当成章节标题') === '');
  ok3('章节：「个人技能」→ skill', RHK && RHK('个人技能') === 'skill');

  /* --- 22.2 折行复原：只拼「上一行没写完」的续行 --- */
  const foldedOne = '・用户调研与竞品分析：完整体验医检诊药业务闭环，依托平台问诊反馈挖掘慢病问诊、复购\n流程等核心痛点；输出完整竞品分析报告。';
  ok3('折行：半句 + 续行 → 合成一行', UWL && UWL(foldedOne).length === 1, UWL && UWL(foldedOne).length);
  ok3('折行：拼接后内容完整', UWL && /复购流程等核心痛点/.test(UWL(foldedOne)[0]));
  const dateAfterLong = '・用户调研与竞品分析：完整体验医检诊药业务闭环，依托平台问诊反馈挖掘慢病问诊、复购\n京东健康（京东互联网医院） 产品运营实习生 2025.11 - 2026.01';
  ok3('折行：带起止时间的新条目绝不被拼进上一行', UWL && UWL(dateAfterLong).length === 2, UWL && UWL(dateAfterLong).length);
  const awardAfterLong = '・核心课程：口腔修复学、口腔颌面外科学、预防医学、医学影像学\n《黄斑变性的中西医联合治疗》发表于：《饮食保健》2021 年第 25 期';
  ok3('折行：论文 / 获奖这类独立条目不被拼进上一行', UWL && UWL(awardAfterLong).length === 2, UWL && UWL(awardAfterLong).length);
  ok3('折行：上一行已用句号收尾则不拼', UWL && UWL('・要点一：完整的一句话已经写完了。\n续行其实是另一件事').length === 2);

  /* --- 22.3 用户真简历片段（PDF 复制后的折行 + 裸标题）--- */
  const foldedResume = [
    '杨明翰',
    '电话：13800000000 | 邮箱：a@b.com',
    '教育背景',
    '香港城市大学 健康科学与管理 硕士 2025.09 - 2026.10',
    '・核心课程：传染病管理、药物分销与开发、可穿戴技术与数字医疗、人工智能在健',
    '康科学研究与管理中的应用',
    '《黄斑变性的中西医联合治疗》发表于：《饮食保健》2021 年第 25 期（ISSN 2095-8439）',
    '实习经历',
    '京东健康（京东互联网医院） 产品运营实习生 2025.11 - 2026.01',
    '・用户调研与竞品分析：完整体验医检诊药业务闭环，依托平台问诊反馈挖掘慢病问诊、复购',
    '流程等核心痛点；输出完整竞品分析报告。',
    '・医学内容合规运营：搭建科普内容创作规范与免责体系，设计加',
    '权评价模型筛选优质内容，降低平台医疗内容合规风险。',
    '项目经历',
    'ceRNA 网络分析项目 项目成员 2025.09 - 2026.08',
    '・多组学数据自动化解析与归档：使用 Python 递归解析 TCGA 嵌套 JSON 元数据，自动化分类提取',
    'RNA/miRNA/Isoform 表达谱，构建各类基因列表与样本字典并归档至 ceRNA元数据库。',
    '・临床特征整合与跨表对齐：从临床图表中提取 T/N/M 分期与 Grade 特征，通过 TCGA Barcode 实现表达谱与临',
    '床数据的 1:1 精准映射与过滤清洗，确保样本严格对齐。',
    'ICB 免疫疗法多组学数据库构建 项目成员 2026.01 - 2026.08',
    '・多平台测序数据标准化整合：整合 GEO、EGA 测序数据，统一转为.h5ad 格式搭建免疫多组学数据库。',
    '个人技能',
    '• 语言：英语（CET-6 ：583,IELTS：7.0）',
    '• 专业能力：医疗流程理解、患者沟通'
  ].join('\n');

  const fr = SRB && SRB(foldedResume);
  ok3('真简历：归纳出 3 条（1 实习 + 2 项目），不再碎成 7 条', fr && fr.length === 3, fr && fr.length);
  ok3('真简历：项目名不带动角色后缀', fr && fr[1].project === 'ceRNA 网络分析项目' && fr[2].project === 'ICB 免疫疗法多组学数据库构建',
    fr && JSON.stringify(fr.map(function (x) { return x.project; })));
  ok3('真简历：教育 / 技能段不产出成就（核心课程没被收进来）',
    fr && fr.every(function (x) { return !/核心课程|CET-6|专业能力/.test(x.action) && !/核心课程|语言/.test(x.project); }));
  ok3('真简历：折行后半句仍在 action 里（复购流程 / 权评价模型）',
    fr && /复购流程等核心痛点/.test(fr[0].action) && /权评价模型/.test(fr[0].action), fr && fr[0].action);
  ok3('真简历：项目要点跨行拼接完整', fr && /RNA\/miRNA\/Isoform 表达谱/.test(fr[1].action) && /床数据的 1:1 精准映射/.test(fr[1].action), fr && fr[1].action);

  const frs = BRS && BRS({ rawText: foldedResume, lang: { cet6: 583, ielts: 7 }, intern: '', projText: '', research: '', papers: 0 });
  ok3('真简历填表：教育 1 段且带主修课程', frs && frs.education.length === 1 && /健康科学研究与管理/.test(frs.education[0].courses), frs && JSON.stringify(frs.education));
  ok3('真简历填表：工作 1 段（公司/岗位/两条要点）', frs && frs.work.length === 1 && frs.work[0].company === '京东健康（京东互联网医院）' && frs.work[0].bullets.length === 2, frs && JSON.stringify(frs.work));
  ok3('真简历填表：项目 2 段且带角色', frs && frs.projects.length === 2 && frs.projects[0].role === '项目成员' && frs.projects[0].duties.length === 2, frs && JSON.stringify(frs.projects));
  ok3('真简历填表：论文识别到《黄斑变性…》', frs && frs.papers.length === 1 && /黄斑变性/.test(frs.papers[0].title), frs && JSON.stringify(frs.papers));

  /* --- 22.4 「项目经历」= 「科研经历」：两节都收，不再二选一 --- */
  const twoSections = [
    '【项目经历】',
    'ceRNA 网络分析项目 项目成员 2025.09 - 2026.08',
    '・多组学数据自动化解析与归档：使用 Python 递归解析 TCGA 元数据。',
    '【科研经历】',
    'ICB 免疫疗法多组学数据库构建 项目成员 2026.01 - 2026.08',
    '・多平台测序数据标准化整合：整合 GEO、EGA 测序数据。'
  ].join('\n');
  const ts1 = BRS && BRS({ rawText: twoSections, lang: {} });
  ok3('项目=科研：两节都有时都收（旧版 pick() 只取第一段）', ts1 && ts1.projects.length === 2, ts1 && JSON.stringify(ts1.projects.map(function (x) { return x.name; })));
  ok3('项目=科研：科研经历画像同样取 proj 类（源码级，parseResume 不在本切片内）',
    /const researchSec = sec\(sections, \['proj'\]\)/.test(htmlSrc0));
  /* 同名重复出现（项目段与科研段内容一致）只留一条 */
  const dupSections = [
    '【项目经历】',
    'ceRNA 网络分析项目 项目成员 2025.09 - 2026.08',
    '・多组学数据自动化解析与归档：使用 Python 递归解析 TCGA 元数据。',
    '【科研经历】',
    'ceRNA 网络分析项目 项目成员 2025.09 - 2026.08',
    '・多组学数据自动化解析与归档：使用 Python 递归解析 TCGA 元数据。'
  ].join('\n');
  const ts2 = BRS && BRS({ rawText: dupSections, lang: {} });
  ok3('项目=科研：两节同名内容按项目名去重', ts2 && ts2.projects.length === 1, ts2 && JSON.stringify(ts2.projects.map(function (x) { return x.name; })));

  /* --- 22.5 归纳是幂等的：重跑替换上次的草稿（由标签「来自简历」界定） --- */
  ok3('归纳条目都带「来自简历」标签（替换逻辑靠它界定）', fr && fr.every(function (x) { return (x.tags || []).indexOf('来自简历') >= 0; }));
  ok3('归纳结果按原文顺序（实习在前、项目在后）', fr && /京东健康/.test(fr[0].project) && /ceRNA/.test(fr[1].project), fr && JSON.stringify(fr.map(function (x) { return x.project; })));
  ok3('归纳去重：同名经历只出一条', (function () {
    const dup = '【实习经历】\n京东健康（京东互联网医院） 产品运营实习生 2025.11 - 2026.01\n・用户调研与竞品分析：输出完整竞品分析报告。\n【项目经历】\n京东健康（京东互联网医院） 产品运营实习生 2025.11 - 2026.01\n・用户调研与竞品分析：输出完整竞品分析报告。';
    const r = SRB && SRB(dup);
    return r && r.length === 1;
  })());

/* ============================================================
   23. 更多排版风格样本（第二十二轮）
   用户反馈：归纳效果对了，但"样本只有我的简历，还是太少"。
   这里补 6 份排版各异的夹具 —— 换行方式、要点符号、中英文、章节叫法
   都不一样。目的不是"都识别得很漂亮"，而是**任何一份都不许碎成十余条**。
   ============================================================ */
out2.push('=== 23. 简历排版风格样本（第二十二轮） ===');
{
  const RHK3 = sandbox.resumeHeadingKey;
  const UWL3 = sandbox.unwrapResumeLines;
  const SRB3 = sandbox.summarizeResumeBlocks;
  const BRS3 = sandbox.buildResumeSections;

  /* --- 23.1 英文简历的 ALL CAPS 小标题 --- */
  ok3('英文标题：EDUCATION → edu', RHK3 && RHK3('EDUCATION') === 'edu', RHK3 && RHK3('EDUCATION'));
  ok3('英文标题：WORK EXPERIENCE → work', RHK3 && RHK3('WORK EXPERIENCE') === 'work', RHK3 && RHK3('WORK EXPERIENCE'));
  ok3('英文标题：PROJECTS / RESEARCH → proj', RHK3 && RHK3('PROJECTS') === 'proj' && RHK3('RESEARCH') === 'proj');
  ok3('英文标题：大小写混写 Experience 也认', RHK3 && RHK3('Experience') === 'work');
  ok3('英文标题：SKILLS → skill（不产出成就）', RHK3 && RHK3('SKILLS') === 'skill');
  ok3('章节：放宽字数上限后，长正文行仍不是标题',
    RHK3 && RHK3('这是一行足够长的正文内容不应该被当成章节标题') === '');

  /* --- 23.2 折行修复：纯日期行不再被胶到上一行长标题后面 --- */
  ok3('折行：纯日期行独立成行（英文长岗位名的多行标题）',
    UWL3 && UWL3('JD Health\nProduct Operations Intern\n2025.11 - 2026.01').length === 3,
    UWL3 && UWL3('JD Health\nProduct Operations Intern\n2025.11 - 2026.01').length);
  ok3('折行：上一行断在连接符上时，日期仍拼回去', UWL3 && UWL3('2025.11 -\n2026.01').length === 1);
  ok3('折行：中文短标题的多行头不受影响',
    UWL3 && UWL3('京东健康\n产品运营实习生\n2025.11 - 2026.01').length === 3);

  /* --- 23.3 夹具 A：裸标题 + 公司/岗位/时间三行分开 --- */
  const fixA = [
    '教育背景',
    '香港城市大学',
    '健康科学与管理 硕士',
    '2025.09 - 2026.10',
    '实习经历',
    '京东健康',
    '产品运营实习生',
    '2025.11 - 2026.01',
    '· 用户调研与竞品分析：输出完整竞品分析报告。',
    '项目经历',
    'ceRNA 网络分析项目',
    '项目成员',
    '2025.09 - 2026.08',
    '· 多组学数据自动化解析与归档：解析 TCGA 元数据。',
    '个人技能',
    'Python、SQL'
  ].join('\n');
  const a1 = SRB3 && SRB3(fixA);
  ok3('夹具A：三行式标题合成 2 条（1 工作 + 1 项目）', a1 && a1.length === 2, a1 && JSON.stringify(a1.map(function (x) { return x.project; })));
  ok3('夹具A：工作条目带上起止时间', a1 && a1[0].time === '2025.11 - 2026.01', a1 && a1[0].time);
  ok3('夹具A：项目名摘掉「项目成员」', a1 && a1[1].project === 'ceRNA 网络分析项目', a1 && a1[1].project);
  const a2 = BRS3 && BRS3({ rawText: fixA, lang: {} });
  ok3('夹具A 填表：教育 1 段 / 工作 1 段 / 项目 1 段',
    a2 && a2.education.length === 1 && a2.work.length === 1 && a2.projects.length === 1,
    a2 && JSON.stringify([a2.education.length, a2.work.length, a2.projects.length]));

  /* --- 23.4 夹具 B：要点符号变体（全角中点 / 数字编号 / 实心圆）--- */
  const fixB = [
    '项目经历',
    'ICB 免疫疗法多组学数据库构建 项目成员 2026.01 - 2026.08',
    '・多平台测序数据标准化整合：整合 GEO、EGA 测序数据。',
    '1. 数据质控：剔除低质量样本。',
    '● 格式统一：统一转为 .h5ad。',
    '2、样本注释：补充临床元数据。'
  ].join('\n');
  const b1 = SRB3 && SRB3(fixB);
  ok3('夹具B：四种要点符号都只是要点，不是新经历 → 仍是 1 条', b1 && b1.length === 1, b1 && b1.length);
  ok3('夹具B：四条要点合进同一条 action',
    b1 && ['多平台测序', '数据质控', '格式统一', '样本注释'].every(function (k) { return b1[0].action.indexOf(k) >= 0; }),
    b1 && b1[0].action);
  ok3('夹具B：日期没被误当成要点（1. 之类的编号限 1-2 位）',
    b1 && b1[0].time === '2026.01 - 2026.08', b1 && b1[0].time);

  /* --- 23.5 夹具 C：整份英文简历（横线分隔的公司 - 岗位，是英文简历的通行写法） --- */
  const fixC = [
    'EDUCATION',
    'City University of Hong Kong',
    'MSc Health Sciences',
    '2025.09 - 2026.10',
    'EXPERIENCE',
    'JD Health - Product Operations Intern',
    '2025.11 - 2026.01',
    '• User research: analyzed consultation feedback and produced a competitor report.',
    'PROJECTS',
    'ceRNA Network Analysis - Team Member',
    '2025.09 - 2026.08',
    '• Multi-omics parsing: used Python to parse TCGA metadata.',
    'SKILLS',
    'Python, SQL'
  ].join('\n');
  const c1 = SRB3 && SRB3(fixC);
  ok3('夹具C（英文）：归纳 2 条（工作 + 项目），不把 SKILLS 收进来', c1 && c1.length === 2, c1 && JSON.stringify(c1.map(function (x) { return x.project; })));
  ok3('夹具C：英文工作条目时间解析正确', c1 && c1[0].time === '2025.11 - 2026.01', c1 && c1[0].time);
  ok3('夹具C：Team Member 被摘掉，项目名干净', c1 && c1[1].project === 'ceRNA Network Analysis', c1 && c1[1].project);
  ok3('夹具C：英文要点没被下一行经历名污染（句点收尾也要认作"写完了"）',
    c1 && /Multi-omics parsing/.test(c1[1].action) && !/Team Member/.test(c1[1].action), c1 && c1[1].action);
  const c2 = BRS3 && BRS3({ rawText: fixC, lang: {} });
  ok3('夹具C 填表：教育 1 段且校名完整（英文校名本身带空格）',
    c2 && c2.education.length === 1 && c2.education[0].school === 'City University of Hong Kong',
    c2 && JSON.stringify(c2.education));
  ok3('夹具C 填表：教育学位识别为硕士（英文缩写 MSc）',
    c2 && c2.education[0] && c2.education[0].degree === '硕士' && c2.education[0].time === '2025.09 - 2026.10',
    c2 && JSON.stringify(c2.education && c2.education[0]));
  ok3('夹具C 填表：工作段公司 / 岗位按横线切开（不再拿空格猜）',
    c2 && c2.work.length === 1 && c2.work[0].company === 'JD Health' && c2.work[0].role === 'Product Operations Intern',
    c2 && JSON.stringify(c2.work));
  ok3('夹具C 填表：项目 1 段，名字与角色分开',
    c2 && c2.projects.length === 1 && c2.projects[0].name === 'ceRNA Network Analysis' && c2.projects[0].role === 'Team Member',
    c2 && JSON.stringify(c2.projects));

  /* --- 23.5b 英文多行标题（公司/岗位/时间各一行，无分隔符）：不许碎，也不许硬猜 --- */
  const fixC2 = [
    'EXPERIENCE',
    'JD Health',
    'Product Operations Intern',
    '2025.11 - 2026.01',
    '• User research: analyzed consultation feedback.',
    'SKILLS',
    'Python'
  ].join('\n');
  const c3 = SRB3 && SRB3(fixC2);
  ok3('英文多行标题：合并成 1 条（不碎的底线）', c3 && c3.length === 1, c3 && c3.length);
  ok3('英文多行标题：时间解析正确', c3 && c3[0].time === '2025.11 - 2026.01', c3 && c3[0].time);

  /* --- 23.6 夹具 D：紧凑单行「时间 名称 岗位」式，无要点行 --- */
  const fixD = [
    '工作经历',
    '2024.03 - 2024.09 上海医药集团 数据分析实习生',
    '项目经历',
    '2025.01 - 2025.06 慢病复购预测模型 项目负责人'
  ].join('\n');
  const d1 = SRB3 && SRB3(fixD);
  ok3('夹具D：时间在前的单行式也各出一条（不并成一条）', d1 && d1.length === 2, d1 && JSON.stringify(d1.map(function (x) { return x.project; })));
  ok3('夹具D：时间被摘进 time 而非留在名字里',
    d1 && d1[0].time === '2024.03 - 2024.09' && d1[0].project.indexOf('2024') < 0,
    d1 && JSON.stringify(d1[0]));
  ok3('夹具D：项目负责人后缀被摘掉', d1 && d1[1].project === '慢病复购预测模型', d1 && d1[1].project);

  /* --- 23.7 夹具 E：只有「科研经历」这一节（没有「项目经历」） --- */
  const fixE = [
    '科研经历',
    '单细胞转录组图谱构建 项目成员 2025.03 - 2025.12',
    '· 数据整合：整合 12 套公开单细胞数据。',
    '个人技能',
    'R、Seurat'
  ].join('\n');
  const e1 = SRB3 && SRB3(fixE);
  const e2 = BRS3 && BRS3({ rawText: fixE, lang: {} });
  ok3('夹具E：只有「科研经历」也能出成就（旧版只认「项目经历」）', e1 && e1.length === 1, e1 && e1.length);
  ok3('夹具E 填表：科研那节进 projects（项目=科研）', e2 && e2.projects.length === 1 && /单细胞/.test(e2.projects[0].name), e2 && JSON.stringify(e2.projects));

  /* --- 23.8 夹具 F：极简（只有教育 + 一段实习，无任何章节外的内容） --- */
  const fixF = [
    '教育经历',
    '某某大学 计算机科学与技术 本科 2020.09 - 2024.06',
    '实习经历',
    '某某科技 后端开发实习生 2024.07 - 2024.12',
    '· 接口开发：完成 12 个 REST 接口。'
  ].join('\n');
  const f1 = SRB3 && SRB3(fixF);
  const f2 = BRS3 && BRS3({ rawText: fixF, lang: {} });
  ok3('夹具F：极简简历归纳 1 条（只有教育不产出成就）', f1 && f1.length === 1, f1 && f1.length);
  ok3('夹具F 填表：教育 1 段 + 工作 1 段 + 项目 0 段（没有就是没有，不编造）',
    f2 && f2.education.length === 1 && f2.work.length === 1 && f2.projects.length === 0,
    f2 && JSON.stringify([f2.education.length, f2.work.length, f2.projects.length]));

  /* --- 23.9 英文简历的填表数据 + 本岗文案一起进载荷 --- */
  const payEn = sandbox.buildFillPayload('JD Health', 'Product Operations Intern', { name: 'Yang Minghan' }, c2 || {}, {
    bullets: ['Led user research, lifting retention', 'Built compliance ruleset, cutting risk'],
    at: '2026-09-14'
  });
  ok3('载荷：本岗文案挂到 sections.custom', payEn && payEn.sections.custom && payEn.sections.custom.bullets.length === 2);
  ok3('载荷：custom.text 是换行拼好的整段（官网描述栏直接用）',
    payEn && payEn.sections.custom.text.split('\n').length === 2);
  ok3('载荷：schema 保持 v2 —— 加字段不升版，老扩展读到会忽略',
    payEn && payEn.schema === 'zhiyin.fill.v2');

  /* --- 24. 月份归一 / 改写高亮 / 内地院校口径（第二十七轮） --- */
  out2.push('=== 24. 月份归一 + 改写高亮 + 内地院校口径（第二十七轮） ===');

  const YN = sandbox.ymNorm;
  ok3('ymNorm：2023.09 → 2023-09', YN && YN('2023.09') === '2023-09');
  ok3('ymNorm：2023-9 → 2023-09（补零）', YN && YN('2023-9') === '2023-09');
  ok3('ymNorm：2023/09 → 2023-09', YN && YN('2023/09') === '2023-09');
  ok3('ymNorm：13 月返空（脏月份不能进 state）', YN && YN('2023-13') === '');
  ok3('ymNorm：只有年份返空（面板只到月，缺月就不编）', YN && YN('2023') === '');
  ok3('ymNorm：null / 空串 / 中文月份 → 空串', YN && YN(null) === '' && YN('') === '' && YN('2024年9月') === '');

  const MR = sandbox.markRewrite;
  const seg1 = MR && MR('负责系统优化', '主导系统性能优化');
  ok3('markRewrite：只标真正新增的片段（主导 / 性能 各一段 add）',
    !!seg1 && seg1.length === 4 && seg1[0].t === 'add' && seg1[0].s === '主导' &&
    seg1[1].t === 'same' && seg1[2].t === 'add' && seg1[2].s === '性能');
  ok3('markRewrite：一字没改 → 全 same（不能整段刷成高亮）',
    (function () { const s = MR && MR('我参与了一个项目', '我参与了一个项目'); return !!s && s.length === 1 && s[0].t === 'same'; })());
  ok3('markRewrite：原文为空 → 整条都是新增', (function () { const s = MR && MR('', '主导重构'); return !!s && s.length === 1 && s[0].t === 'add'; })());
  ok3('markRewrite：分段拼回去必须等于改写后的文本（不丢字、不重复）',
    [['负责系统优化', '主导系统性能优化'], ['负责 A', '主导 A 并上线'], ['', '新内容'],
     ['原文', '原文'], ['负责 NLP pipeline 重构', '主导 NLP pipeline 重构，性能提升 30%']]
      .every(function (p) { return (MR(p[0], p[1]) || []).map(function (x) { return x.s; }).join('') === p[1]; }));

  /* esc 定义在核心切片（cutoff 之前），附加 sandbox 里没有 —— 用带标记的桩，
     顺便证明 rwHtml 确实走了 esc，而不是自己手拼转义（手拼的会随时间漂移） */
  sandbox.esc = function (s) { return '«' + String(s) + '»'; };
  const RH = sandbox.rwHtml;
  const rwOut = RH && RH(seg1);
  ok3('rwHtml：新增片段包在 <mark class="rw-add"> 里', !!rwOut && rwOut.indexOf('<mark class="rw-add">') === 0);
  ok3('rwHtml：文本一律过 esc（不自己拼转义）', !!rwOut && rwOut.indexOf('«') >= 0);

  const car27 = sandbox.buildCAR({ id: 'x27', action: '负责 NLP pipeline 重构', metric: '', impact: '性能提升' });
  ok3('buildCAR：返回 orig（原文不能丢，否则没法对比）', !!car27 && car27.orig === '负责 NLP pipeline 重构');
  ok3('buildCAR：返回 segs 数组（元素带 t / s）',
    !!car27 && Array.isArray(car27.segs) && car27.segs.every(function (x) { return x.t && typeof x.s === 'string'; }));
  ok3('buildCAR：没改写时 segs 全 same（不假装改过）',
    (function () { const c = sandbox.buildCAR({ id: 'x28', action: '主导规模化交付', metric: '', impact: '' }); return !!c && c.segs.length === 1 && c.segs[0].t === 'same'; })());

/* ---------- 第二十八轮：改写引擎的四个真 bug ----------
   都是实测出来的（探针跑了 6 组样本），不是「看起来可能有问题」：
   ①「提升 15%（15%）」句尾重复同一个数字；
   ②「协助搭建 X」被换成「构建搭建 X」—— 弱动词后面本来就跟着动词，硬塞就成病句；
   ③ 关键词插进单词中间：'rank' 命中 'ranking' 第 0 位 →「rank (incl. …)ing」；
   ④ 一条 action 只有第一小句被升级，第二小句明明也是动词位
     （这就是用户说的「改写基本只在最后加了一个影响」）。 */
ok3('第二十八轮：影响句里已写过这个数字 → 句尾不再重复（15%（15%））',
  (function () {
    const c = sandbox.buildCAR({ id: 'x29', action: '参与召回模型优化', metric: '15%', impact: '召回率提升 15%' });
    return !!c && c.text.indexOf('15%') >= 0 && c.text.split('15%').length - 1 === 1;
  })());
ok3('第二十八轮：影响句没提到这个数字 → 照旧补在句尾',
  (function () {
    const c = sandbox.buildCAR({ id: 'x30', action: '主导召回模型优化', metric: '15%', impact: '线上指标明显转好' });
    return !!c && c.text.indexOf('（15%）') >= 0;
  })());
ok3('第三十三轮：动词升级与关键词嵌入已下线（源码不再含动词表 / 提示表定义与两类徽章文案）',
  js.indexOf('const CAR_VERBS') < 0 && js.indexOf('const CAR_KW_HINTS') < 0 &&
  js.indexOf('升级动作动词') < 0 && js.indexOf('嵌入 JD 关键词') < 0);
ok3('第二十八轮：中英文各用各的标点（英文句不再出现全角逗号）',
  (function () {
    const zh = sandbox.buildCAR({ id: 'x35', action: '主导重构', metric: '', impact: '性能提升' });
    const en = sandbox.buildCAR({ id: 'x36', action: 'Led the refactor', metric: '', impact: 'latency dropped' });
    return !!zh && !!en && zh.text.indexOf('，性能提升') >= 0 && en.text.indexOf(', latency dropped') >= 0;
  })());
ok3('第三十三轮：buildCAR 带回 changes（动词升级 / 关键词嵌入已删，只剩接影响与补数字）',
  (function () {
    const c = sandbox.buildCAR({ id: 'x37', action: '参与搭建 pipeline', metric: '20%', impact: '提速' });
    return !!c && Array.isArray(c.changes) && c.changes.indexOf('升级动作动词') === -1 &&
      c.changes.indexOf('嵌入 JD 关键词') === -1 && c.changes.indexOf('接上你写的影响') >= 0 && c.changes.indexOf('补上真实数字') >= 0;
  })());
ok3('第二十八轮：影响句里已经写过的话不再接第二遍（截图 71 里重复的那句）',
  (function () {
    const c = sandbox.buildCAR({ id: 'x40', action: '部署服务至集群，召回率提升 12%', metric: '', impact: '召回率提升 12%' });
    return !!c && c.text.split('召回率提升 12%').length - 1 === 1;
  })());
ok3('第二十八轮：影响句确实是新的 → 照旧接上（不能因为去重把真影响也丢掉）',
  (function () {
    const c = sandbox.buildCAR({ id: 'x41', action: '主导服务部署', metric: '', impact: '上线后故障率下降' });
    return !!c && c.text.indexOf('，上线后故障率下降') >= 0;
  })());
ok3('第二十八轮：源码里不再生成零计数徽章（badge-neutral 那支已摘掉）',
  js.indexOf('badge-neutral">关键词') < 0);
/* 第二十八轮：取材范围与 PS / CV 都必须真生效 ——
   以前两个都是死参数（strength 进 doAdapt 就丢、mode 只喂给 AI 提示词），
   控件点下去毫无反应。这两条断言就是防止它们再退化成摆设。 */
ok3('第二十八轮：取材范围真的改条数（精简 4 条 < 全面 9 条）',
  (function () {
    const keepInv = sandbox.state.inventory;
    const keepMode = sandbox.state.docAdapt;
    const big = [];
    for (let k = 0; k < 12; k++) {
      big.push({ id: 'b' + k, project: 'P' + k, time: '2024', action: '负责模块 ' + k + ' 的交付', metric: '', impact: '提升效率' });
    }
    sandbox.state.inventory = big;
    sandbox.state.docAdapt = { mode: 'cv', strength: 'std' };
    const aL = sandbox.doAdapt('python nlp 招聘', 'light', null);
    const aH = sandbox.doAdapt('python nlp 招聘', 'hot', null);
    sandbox.state.inventory = keepInv;
    sandbox.state.docAdapt = keepMode;
    return !!aL && !!aH && aL.bullets.length === 4 && aH.bullets.length === 9;
  })());
ok3('第二十八轮：PS 取材偏科研、CV 取材偏可量化成果',
  (function () {
    const keepInv = sandbox.state.inventory;
    const keepMode = sandbox.state.docAdapt;
    sandbox.state.inventory = [
      { id: 'm1', project: 'A', time: '2024', action: '搭建实验平台', metric: '', impact: '支撑三篇论文投稿' },
      { id: 'm2', project: 'B', time: '2024', action: '优化对外接口', metric: '30%', impact: '响应更快' }
    ];
    sandbox.state.docAdapt = { mode: 'ps', strength: 'std' };
    const psFirst = (sandbox.doAdapt('python nlp 招聘', 'std', null) || {}).bullets[0].sourceId;
    sandbox.state.docAdapt = { mode: 'cv', strength: 'std' };
    const cvFirst = (sandbox.doAdapt('python nlp 招聘', 'std', null) || {}).bullets[0].sourceId;
    sandbox.state.inventory = keepInv;
    sandbox.state.docAdapt = keepMode;
    return psFirst === 'm1' && cvFirst === 'm2';
  })());

  const sender27 = { name: '张三/San Zhang', school: '南京大学 2026 届硕士', background: 'AAAI 2025 一作', interest: 'NeurIPS 论文' };
  const tgts27 = [{ name: '张伟 教授', page: 'https://x.edu.cn', field: '深度学习' }];
  const BMz = sandbox.buildMail(tgts27, sender27, { zhOnly: true });
  ok3('buildMail：zhOnly 回传（渲染层靠它决定显示几版）', !!BMz && BMz.zhOnly === true);
  ok3('buildMail：中文版首行就是主题行（内地邮件直接可发）', !!BMz && /^主题：/.test(BMz.targets[0].zh.split('\n')[0]));
  ok3('buildMail：名字里已带职称就不再补「老师」',
    !!BMz && BMz.targets[0].zh.indexOf('尊敬的张伟 教授，') >= 0,
    BMz && BMz.targets[0].zh.split('\n').filter(function (l) { return /尊敬的/.test(l); })[0]);
  ok3('buildMail：不带 opts 时 zhOnly=false（老调用不受影响）', sandbox.buildMail(tgts27, sender27).zhOnly === false);

  /* 内地院校口径：问「国内院校支不支持」的答案是「只支持套磁检索这一条路径」——
     没有项目/门槛数据，所以不进院校池、不参与冲稳保；域名表里也不放内地校（放进去就会拼出假 site:） */
  ok3('内地院校：域名表里没有内地校（不给内地拼假 site: 域名）',
    Object.keys(sandbox.SCHOOL_DOMAIN).every(function (k) {
      return /香港|澳门|新加坡|牛津|伦敦|爱丁堡|曼彻斯特|华威|苏黎世|洛桑|代尔夫特|东京|京都|新南威尔士|墨尔本|新加坡国立|南洋/.test(k);
    }), Object.keys(sandbox.SCHOOL_DOMAIN).join(','));
  ok3('内地校名联想表：>= 20 所且是内地校（只做输入提示）',
    sandbox.CN_UNI_HINT.length >= 20 && sandbox.CN_UNI_HINT.indexOf('清华大学') >= 0);
  ok3('教授缓存里没有内地校（内地路径只能 Bing + 手动加，不假装有数据）',
    sandbox.PROF_CACHE.every(function (p) { return sandbox.CN_UNI_HINT.indexOf(p.school) < 0; }));

  sandbox.state.profMail.lastQuery = { scope: 'cn', school: '清华大学', dept: '自动化', keyword: 'RL' };
  sandbox.state.profMail.scope = 'cn';
  const pTaociCn = sandbox.aiPromptFor('taoci');
  ok3('内地套磁提示词：只要中文一封（不摆双语，免得用户误发英文）',
    pTaociCn.indexOf('中文一封') >= 0 && pTaociCn.indexOf('中英双语各一版') < 0);
  ok3('内地套磁提示词：说清「这封可以直接发给教授」，且不再自称「这一版」',
    /直接发给教授/.test(pTaociCn) && pTaociCn.indexOf('这一版') < 0);
  ok3('找教授提示词：内地补一句「师资队伍页没有统一 URL」', sandbox.aiPromptFor('search').indexOf('师资队伍') >= 0);
  sandbox.state.profMail.scope = 'abroad';
  ok3('境外套磁提示词：仍是中英双语各一版（没被内地口径带跑）', sandbox.aiPromptFor('taoci').indexOf('中英双语各一版') >= 0);

  /* 第二十七轮第 5 项：四处导出「点了没反应」的根因 = navigator.clipboard 无兜底 + 写死某一家 AI */
  ok3('AI 提示词入口只留三个，且不再写死任何一家厂商', Object.keys(sandbox.AI_KIND).join(',') === 'ps,taoci,search');
  ok3('原型源码里不再出现任何厂商名（导出不绑定某一家 AI）', js.indexOf('WorkBuddy') < 0);
  ok3('剪贴板统一走 copyTextSafe + clipboardWrite（存在性检查 + reject 兜底）',
    typeof sandbox.copyTextSafe === 'function' && typeof sandbox.clipboardWrite === 'function' &&
    typeof sandbox.showTextFallback === 'function');
  ok3('四个导出入口都改走统一提示词弹窗（>= 3 处调用）', js.split('openAiPrompt(').length - 1 >= 4);

  /* ============ 第三十五轮：UI 层源码断言（js 在本套件可用） ============ */
  ok3('extractPdf 已按行重组（旧实现把整页拼成一行）',
    js.indexOf('pageLines.join') >= 0 && js.indexOf("tc.items.map(it => it.str).join(' ')") < 0);
  ok3('求职偏好区：说明改为「岗位按照匹配度降序检索」，旧的「一个都不选」句式下线',
    js.indexOf('岗位按照匹配度降序检索') >= 0 && js.indexOf('在全部岗位内按匹配度降序检索') < 0);
  ok3('偏好分组折叠 + 姓名姓氏表 + 分制选择器 三件新组件都在',
    js.indexOf('function catFoldHtml') >= 0 && js.indexOf('COMMON_SURNAMES') >= 0 && js.indexOf('data-ksel="gpaScale"') >= 0);
  ok3('paintField 用 closest(.field)（GPA 字段内嵌 flex 行后 parentNode 会刷错容器）',
    js.indexOf("el.closest('.field')") >= 0);
}

out2.push('=== 附加结果 ===' + (pass2 ? '（' + pass2 + ' 项全绿）' : ''));
  console.log(out2.join('\n'));
  if (fail2) process.exitCode = 1;
})();

/* 极简 DOM 桩：importReceipts / importStatusEvents 这类函数末尾会调 renderTrack()，
   而渲染是浏览器的事。给一个「点了没反应」的空元素，让纯逻辑能跑到底而不用把渲染也切开。 */
const elStub = () => ({
  innerHTML: '', textContent: '', value: '',
  style: {}, dataset: {},
  addEventListener: () => {}, removeEventListener: () => {},
  classList: { toggle: () => {}, add: () => {}, remove: () => {}, contains: () => false },
  querySelector: () => elStub(), querySelectorAll: () => []
});
const documentStub = {
  querySelector: () => elStub(),
  querySelectorAll: () => [],
  getElementById: () => elStub(),
  createElement: () => elStub(),
  body: elStub(),
  title: ''
};

const ctx = {
  console, Math, Date, JSON, Object, Array, String, Number, RegExp, Boolean, Error,
  isNaN, parseFloat, parseInt, fs, process, URL,
  document: documentStub,
  HAS_TOP_LEVEL_FILTER_ASSIGN: EXTRA.HAS_TOP_LEVEL_FILTER_ASSIGN,
  HTML_CHARS: EXTRA.HTML_CHARS,
  JS_CHARS: EXTRA.JS_CHARS,
  localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} }
};
vm.createContext(ctx);
try {
  vm.runInContext(core + '\n' + BODY, ctx, { filename: 'zhiyin-core.js' });
} catch (e) {
  console.error('[x] 运行时异常：');
  console.error(e && e.stack ? e.stack : e);
  process.exit(1);
}
