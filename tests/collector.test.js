/* ============================================================
   职引 · 采集自测（无头，不需要浏览器）
   用法：node tests/collector.test.js
   作用：用 jsdom 构造模拟的投递页面，验证采集与状态归一化。
   重点验证两件事：
     1) 归一化映射对不对（各家状态原文 -> 统一阶段）
     2) 页面改版（class 名全换）后，启发式还能不能提取出来
   ============================================================ */
'use strict';
const fs = require('fs');
const path = require('path');

const DIR = path.join(__dirname, '..', 'extension');
const SRC = path.join(DIR, 'extractor.js');
const RULES = path.join(DIR, 'rules.json');
if (!fs.existsSync(SRC) || !fs.existsSync(RULES)) {
  console.error('[x] 找不到 extractor.js / rules.json，请在本目录下运行。');
  process.exit(2);
}
const src = fs.readFileSync(SRC, 'utf8');
const rules = JSON.parse(fs.readFileSync(RULES, 'utf8'));

const JSDOM_PATH = process.env.JSDOM_PATH || 'jsdom';
let JSDOM;
try { JSDOM = require(JSDOM_PATH).JSDOM; }
catch (e) {
  console.error('[x] 需要 jsdom：设置 JSDOM_PATH 指向 node_modules/jsdom，或在 node workspace 下 npm install jsdom。');
  process.exit(2);
}

const out = [];
let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; out.push('  [PASS] ' + name); }
  else { fail++; out.push('  [FAIL] ' + name + (extra ? '  -> ' + extra : '')); }
}

function run(html, url, title) {
  const dom = new JSDOM(
    '<!DOCTYPE html><html><head><title>' + (title || '') + '</title></head><body>' + html + '</body></html>',
    { url: url || 'https://www.zhaopin.com/c/i/myapply', runScripts: 'outside-only' }
  );
  const win = dom.window;
  win.eval(src);
  const res = win.collectFromPage({
    rules: rules.rules, stages: rules.stages, options: rules.options,
    url: win.location.href, title: win.document.title
  });
  win.close();
  return res;
}
function find(res, kw) {
  return res.items.filter(function (i) { return (i.position || '').indexOf(kw) >= 0; })[0];
}

/* ---------- 1. 结构化投递列表页 ---------- */
out.push('=== 1. 结构化投递列表页（启发式） ===');
const pageA = [
  '<div class="apply-list">',
  '<div class="item">',
  '<span class="company">字节跳动</span>',
  '<span class="job-title">算法工程师（推荐方向）</span>',
  '<span class="status">已投递</span>',
  '<a href="/detail?id=12345678">查看</a>',
  '<span class="time">2026-09-10</span>',
  '</div>',
  '<div class="item">',
  '<span class="company">蚂蚁集团</span>',
  '<span class="job-title">风控算法工程师</span>',
  '<span class="status">简历筛选中</span>',
  '<a href="/detail?id=87654321">查看</a>',
  '</div>',
  '<div class="item">',
  '<span class="company">中金公司</span>',
  '<span class="job-title">行业研究分析师</span>',
  '<span class="status">一面邀请</span>',
  '</div>',
  '</div>'
].join('');
const rA = run(pageA, 'https://www.zhaopin.com/c/i/myapply', '我的投递-智联招聘');
ok('提取到 3 条记录', rA.items.length === 3, 'n=' + rA.items.length);
ok('模式为启发式', rA.mode === 'heuristic', rA.mode);
const a1 = find(rA, '算法工程师');
const a2 = find(rA, '风控');
const a3 = find(rA, '行业研究');
ok('公司名提取正确', a1 && a1.company === '字节跳动', a1 && a1.company);
ok('职位名提取正确', a1 && a1.position === '算法工程师（推荐方向）', a1 && a1.position);
ok('已投递 -> submitted', a1 && a1.stage === 'submitted', a1 && a1.stage);
ok('简历筛选中 -> screening', a2 && a2.stage === 'screening', a2 && a2.stage);
ok('一面邀请 -> interview_1', a3 && a3.stage === 'interview_1', a3 && a3.stage);
ok('申请号从 href 中取到', a1 && a1.externalId === '12345678', a1 && a1.externalId);
ok('投递时间解析为 ISO 日期', a1 && a1.occurredAt === '2026-09-10', a1 && a1.occurredAt);
ok('渠道识别为智联招聘', rA.channel === '智联招聘', rA.channel);

/* ---------- 2. 站点规则命中 ---------- */
out.push('');
out.push('=== 2. 站点规则（精确选择器） ===');
const pageB = [
  '<div class="application-list">',
  '<div class="application-item" data-application-id="APP-2026-001">',
  '<span class="company-name">某某科技有限公司</span>',
  '<span class="position-name">后端开发工程师</span>',
  '<span class="status-label">二面通知</span>',
  '<span class="update-time">2026/09/11</span>',
  '</div>',
  '</div>'
].join('');
const rB = run(pageB, 'https://www.example-ats.com/my/applications');
ok('命中规则，模式为 rule', rB.mode === 'rule', rB.mode);
ok('规则提取到 1 条', rB.items.length === 1, 'n=' + rB.items.length);
ok('二面通知 -> interview_2', rB.items[0] && rB.items[0].stage === 'interview_2', rB.items[0] && rB.items[0].stage);
ok('容器自身的 data-application-id 被取到', rB.items[0] && rB.items[0].externalId === 'APP-2026-001', rB.items[0] && rB.items[0].externalId);
ok('斜杠日期也能解析', rB.items[0] && rB.items[0].occurredAt === '2026-09-11', rB.items[0] && rB.items[0].occurredAt);

/* ---------- 3. 归一化映射全覆盖 ---------- */
out.push('');
out.push('=== 3. 状态归一化映射 ===');
const stageCases = [
  ['已投递', 'submitted'],
  ['简历筛选中', 'screening'],
  ['在线测评邀请', 'written_test'],
  ['一面（技术面试）', 'interview_1'],
  ['复试通知', 'interview_2'],
  ['HR 面安排', 'hr'],
  ['恭喜获得 Offer', 'offer'],
  ['很遗憾，未通过', 'closed']
];
const pageC = '<div class="list">' + stageCases.map(function (c, i) {
  return '<div class="item"><span class="company">公司' + (i + 1) + '</span>' +
    '<span class="job-title">后端开发工程师</span>' +
    '<span class="status">' + c[0] + '</span></div>';
}).join('') + '</div>';
const rC = run(pageC, 'https://www.nowcoder.com/my/apply', '我的申请-牛客');
stageCases.forEach(function (c) {
  const hit = rC.items.filter(function (i) { return i.stageRaw === c[0]; })[0];
  ok('「' + c[0] + '」-> ' + c[1], hit && hit.stage === c[1], hit ? hit.stage : '未提取到该条');
});
ok('终局状态优先于过程状态', (function () {
  const both = run('<div class="item"><span class="company">京东</span><span class="job-title">前端开发工程师</span>' +
    '<span class="status">已结束</span></div>', 'https://www.nowcoder.com/my/apply');
  return both.items[0] && both.items[0].stage === 'closed';
})());
ok('牛客渠道识别正确', rC.channel === '牛客', rC.channel);

/* ---------- 4. 页面改版（class 全换）后仍可提取 ---------- */
out.push('');
out.push('=== 4. 页面改版容错 ===');
const pageD = [
  '<div class="a1">',
  '<div class="b2"><div class="c3">美团</div><div class="d4">后端开发工程师</div><div class="e5">笔试邀请</div></div>',
  '<div class="b2"><div class="c3">小红书</div><div class="d4">产品运营专员</div><div class="e5">终面安排</div></div>',
  '</div>'
].join('');
const rD = run(pageD, 'https://www.zhipin.com/web/geek/chat', '我的投递-BOSS直聘');
ok('class 名全换后仍提取到 2 条', rD.items.length === 2, 'n=' + rD.items.length);
const d1 = find(rD, '后端开发');
const d2 = find(rD, '产品运营');
ok('改版后职位名仍正确', d1 && d1.position === '后端开发工程师', d1 && d1.position);
ok('改版后笔试邀请 -> written_test', d1 && d1.stage === 'written_test', d1 && d1.stage);
ok('改版后终面安排 -> hr', d2 && d2.stage === 'hr', d2 && d2.stage);
ok('BOSS直聘渠道识别', rD.channel === 'BOSS直聘', rD.channel);

/* ---------- 5. 不误报 ---------- */
out.push('');
out.push('=== 5. 误报控制 ===');
const rE = run('<div><h1>新闻列表</h1><p>今天天气不错，适合出门走走。</p><p>行业动态：某公司完成新一轮融资。</p></div>',
  'https://news.example.com/', '新闻');
ok('无投递状态的页面不产生记录', rE.items.length === 0, 'n=' + rE.items.length);

/* ---------- 6. 多条记录互不串味 ---------- */
out.push('');
out.push('=== 6. 多条记录的公司与状态一一对应 ===');
const rF = run([
  '<div class="list">',
  '<div class="item"><span class="company">甲公司</span><span class="job-title">后端开发工程师</span><span class="status">已投递</span></div>',
  '<div class="item"><span class="company">乙公司</span><span class="job-title">数据分析师</span><span class="status">已结束</span></div>',
  '</div>'
].join(''), 'https://www.zhaopin.com/c/i/myapply');
const f1 = find(rF, '后端开发');
const f2 = find(rF, '数据分析');
ok('甲公司 = 已投递（未串到乙公司的状态）', f1 && f1.company === '甲公司' && f1.stage === 'submitted',
  f1 ? f1.company + '/' + f1.stage : 'null');
ok('乙公司 = 已结束', f2 && f2.company === '乙公司' && f2.stage === 'closed',
  f2 ? f2.company + '/' + f2.stage : 'null');

/* ---------- 7. 缺字段如实留空 ---------- */
out.push('');
out.push('=== 7. 缺字段不编造 ===');
const rG = run('<div class="item"><span class="status">一面邀请</span></div>', 'https://www.unknown-ats.com/x', '');
ok('无公司名时留空而不是编造', rG.items[0] && rG.items[0].company === '', rG.items[0] && JSON.stringify(rG.items[0].company));
ok('无职位名时留空', rG.items[0] && rG.items[0].position === '', rG.items[0] && JSON.stringify(rG.items[0].position));
ok('状态仍正确识别', rG.items[0] && rG.items[0].stage === 'interview_1', rG.items[0] && rG.items[0].stage);
ok('未知站点回落到「官网直投」', rG.channel === '官网直投', rG.channel);

/* ---------- 8. 只读性 ---------- */
out.push('');
out.push('=== 8. 只读性（不改页面） ===');
const dom = new JSDOM('<!DOCTYPE html><html><body>' + pageA + '</body></html>',
  { url: 'https://www.zhaopin.com/c/i/myapply', runScripts: 'outside-only' });
const before = dom.window.document.body.innerHTML;
dom.window.eval(src);
dom.window.collectFromPage({ rules: rules.rules, stages: rules.stages, options: rules.options, url: 'https://www.zhaopin.com/c/i/myapply', title: '' });
const after = dom.window.document.body.innerHTML;
ok('采集前后页面 DOM 完全一致', before === after);
dom.window.close();

/* ---------- 9. 投递回执采集 ---------- */
out.push('');
out.push('=== 9. 投递回执（提交凭证） ===');
function runReceipt(html, url, title, opts) {
  const dom = new JSDOM(
    '<!DOCTYPE html><html><head><title>' + (title || '') + '</title></head><body>' + html + '</body></html>',
    { url: url || 'https://jobs.bytedance.com/status', runScripts: 'outside-only' }
  );
  const win = dom.window;
  win.eval(src);
  const res = win.collectReceipt(Object.assign({ url: win.location.href, title: win.document.title }, opts || {}));
  win.close();
  return res;
}

/* 场景一：提交成功页，标题带「岗位 - 公司」，页面明文写出申请号 */
const rc1 = runReceipt(
  '<h1>算法工程师（推荐方向）</h1><div>申请编号：JD2026001234</div><div>提交成功</div>',
  'https://jobs.bytedance.com/status?applicationId=987654',
  '算法工程师（推荐方向） - 字节跳动'
);
ok('回执采集到公司名', !!rc1 && rc1.company === '字节跳动', rc1 && rc1.company);
ok('回执采集到岗位名（h1 优先于标题）', !!rc1 && rc1.position === '算法工程师（推荐方向）', rc1 && rc1.position);
ok('申请号优先取页面明文（而不是 URL 参数）', !!rc1 && rc1.jobRef === 'JD2026001234', rc1 && rc1.jobRef);
ok('回执带上页面地址', !!rc1 && rc1.url.indexOf('bytedance.com') >= 0, rc1 && rc1.url);
ok('回执默认状态为「已投递」', !!rc1 && rc1.status === '已投递', rc1 && rc1.status);
ok('回执带上提交时间', !!rc1 && !!rc1.at, rc1 && rc1.at);

/* 场景二：页面没有明文申请号时，从 URL 参数里认 */
const rc2 = runReceipt(
  '<h1>后端开发工程师</h1>',
  'https://tencent.mokahr.com/candidate?jobId=8866123',
  '后端开发工程师 - 腾讯科技'
);
ok('URL 参数里的 jobId 被认成申请号', !!rc2 && rc2.jobRef === '8866123', rc2 && rc2.jobRef);
ok('标题拆出公司名', !!rc2 && rc2.company === '腾讯科技', rc2 && rc2.company);

/* 场景三：招聘平台页面的渠道记为平台名 */
const rc3 = runReceipt(
  '<h1>数据分析师</h1><span class="company">美团</span>',
  'https://www.zhipin.com/web/geek/job',
  '数据分析师'
);
ok('招聘平台页面的渠道记为平台名', !!rc3 && rc3.channel === 'BOSS直聘', rc3 && rc3.channel);
ok('标注为公司的元素不再要求带「有限公司」后缀', !!rc3 && rc3.company === '美团', rc3 && rc3.company);

/* 场景四：页面里找不到公司名 -> 返回 null，不编造 */
const rc4 = runReceipt('<div>提交成功</div>', 'https://example.com/done', '提交成功');
ok('拿不到公司名时返回 null（不编造回执）', rc4 === null, JSON.stringify(rc4));

/* 场景五：只读性 */
const domR = new JSDOM('<!DOCTYPE html><html><body><h1>算法工程师</h1></body></html>',
  { url: 'https://jobs.bytedance.com/status', runScripts: 'outside-only' });
const rb = domR.window.document.body.innerHTML;
domR.window.eval(src);
domR.window.collectReceipt({ url: 'https://jobs.bytedance.com/status', title: '算法工程师 - 字节跳动' });
const ra = domR.window.document.body.innerHTML;
ok('采集回执前后页面 DOM 完全一致', rb === ra);
domR.window.close();

/* ---------- 10. 辅助填写（fillFromPayload） ---------- */
out.push('');
out.push('=== 10. 辅助填写（fillFromPayload） ===');
function runFill(html, fields) {
  const dom = new JSDOM(
    '<!DOCTYPE html><html><head><title>申请表</title></head><body>' + html + '</body></html>',
    { url: 'https://careers.example.com/apply', runScripts: 'outside-only' }
  );
  const win = dom.window;
  win.eval(src);
  const res = win.fillFromPayload({ fields: fields });
  const vals = {};
  win.document.querySelectorAll('[data-t]').forEach(function (el) { vals[el.dataset.t] = el.value; });
  win.close();
  return { res: res, vals: vals };
}

/* 场景一：一张典型官网申请表 —— label[for]、placeholder、包裹 label、name 属性各占一些 */
const FF = {
  name: '杨明翰', phone: '13800000000', email: 'yang@example.com',
  school: '华中科技大学', major: '计算机科学与技术', edu: '硕士',
  gpa: '3.6', gradYear: '2027-06', skills: 'Python、SQL', intro: '希望应聘贵司数据岗位。'
};
const ff1 = runFill([
  '<form>',
  '<label for="nm">姓名</label><input id="nm" data-t="name">',
  '<input placeholder="请输入手机号" data-t="phone">',
  '<label>电子邮箱<input placeholder="name@example.com" data-t="email"></label>',
  '<input name="school" data-t="school">',
  '<label for="mj">所学专业</label><input id="mj" data-t="major">',
  '<label for="ed">最高学历</label><select id="ed" data-t="edu"><option value="">请选择</option><option value="本科">本科</option><option value="硕士">硕士</option></select>',
  '<label for="gp">GPA</label><input id="gp" data-t="gpa">',
  '<label for="gy">毕业时间</label><input id="gy" data-t="gy">',
  '<label for="sk">技能特长</label><input id="sk" data-t="skills">',
  '<textarea placeholder="自我介绍" data-t="intro"></textarea>',
  '<input type="password" placeholder="设置密码" data-t="pwd">',
  '<input type="submit" value="提交申请">',
  '</form>'
].join(''), FF);
ok('label[for] 命中：姓名已填', ff1.vals.name === '杨明翰', ff1.vals.name);
ok('placeholder 命中：手机号已填', ff1.vals.phone === '13800000000', ff1.vals.phone);
ok('包裹 label 命中：邮箱已填', ff1.vals.email === 'yang@example.com', ff1.vals.email);
ok('name 属性命中：毕业院校已填', ff1.vals.school === '华中科技大学', ff1.vals.school);
ok('「所学专业」被专业正则命中', ff1.vals.major === '计算机科学与技术', ff1.vals.major);
ok('select 选项对得上时选中对应项', ff1.vals.edu === '硕士', ff1.vals.edu);
ok('GPA 已填', ff1.vals.gpa === '3.6', ff1.vals.gpa);
ok('毕业时间已填', ff1.vals.gy === '2027-06', ff1.vals.gy);
ok('textarea 自我介绍已填', ff1.vals.intro === '希望应聘贵司数据岗位。', ff1.vals.intro);
ok('密码框绝不动', ff1.vals.pwd === '', ff1.vals.pwd);
ok('返回结构带 untouchedSubmit（不点提交的承诺）', ff1.res.ok === true && ff1.res.untouchedSubmit === true);
ok('技能特长已填', ff1.vals.skills === 'Python、SQL', ff1.vals.skills);
ok('全部字段命中（missed 为空）', ff1.res.filled.length === 10 && ff1.res.missed.length === 0,
  'filled=' + ff1.res.filled.length + ' missed=' + ff1.res.missed.join(','));

/* 场景二：select 选项对不上 -> 跳过并计入 missed，宁可漏填也不选错 */
const ff2 = runFill(
  '<label for="ed">学历</label><select id="ed" data-t="edu"><option value="1">大专</option><option value="2">本科</option></select>',
  { edu: '博士' }
);
ok('select 选项对不上时不动它', ff2.vals.edu === '' || ff2.vals.edu === '1', ff2.vals.edu);
ok('没填上的字段计入 missed', ff2.res.missed.indexOf('edu') >= 0, JSON.stringify(ff2.res.missed));

/* 场景三：载荷里没有的字段不动页面 */
const ff3 = runFill(
  '<label for="nm">姓名</label><input id="nm" data-t="name"><input placeholder="请输入邮箱" data-t="email">',
  { name: '杨明翰' }
);
ok('载荷里没有的字段不动页面（邮箱保持为空）', ff3.vals.email === '', ff3.vals.email);
ok('载荷里的空字符串字段也跳过（应用侧已裁剪，双保险）',
  (function () { const r = runFill('<label for="nm">姓名</label><input id="nm" data-t="name">', { name: '', email: '  ' }); return r.res.filled.length === 0; })());

/* 场景四：一个控件只接收一个字段（姓名不被 name 类英文名误抢） */
const ff4 = runFill(
  '<input placeholder="Last name" data-t="ln"><input placeholder="姓氏（中文）" data-t="xn">',
  { name: '杨明翰' }
);
ok('宽泛的英文 name 正则不误抢 Last name（具体正则优先）', ff4.res.missed.indexOf('name') >= 0 || ff4.vals.xn === '杨明翰',
  'ln=' + ff4.vals.ln + ' xn=' + ff4.vals.xn);

/* 场景五：填入后派发 input 事件（React/Vue 受控表单能感知） */
const domE = new JSDOM(
  '<!DOCTYPE html><html><body><label for="nm">姓名</label><input id="nm"></body></html>',
  { url: 'https://careers.example.com/apply', runScripts: 'outside-only' }
);
let fired = 0;
domE.window.document.getElementById('nm').addEventListener('input', function () { fired++; });
domE.window.eval(src);
domE.window.fillFromPayload({ fields: { name: '杨明翰' } });
ok('填入后派发了 input 事件', fired === 1, 'fired=' + fired);
domE.window.close();

/* ---------- 10.5 国内官网表单：div 标签 + 分段卡片字段（第二十一轮） ---------- */
function runFill2(html, fields, sections) {
  const dom = new JSDOM(
    '<!DOCTYPE html><html><head><title>申请表</title></head><body>' + html + '</body></html>',
    { url: 'https://zhaopin.meituan.com/apply', runScripts: 'outside-only' }
  );
  const win = dom.window;
  win.eval(src);
  const res = win.fillFromPayload({ fields: fields, sections: sections || null });
  const vals = {};
  win.document.querySelectorAll('[data-t]').forEach(function (el) { vals[el.dataset.t] = el.value; });
  win.close();
  return { res: res, vals: vals };
}

/* 场景六：标签写在 div/span 里（Ant Design / 美团 / 京东这类自研组件），
   一个 <label> 都没有 —— 上一版就是这样在美团页面上只填上姓名和邮箱。 */
const ff6 = runFill2([
  '<div class="ant-form-item"><div class="ant-form-item-label"><div>手机号码</div></div>',
  '<div class="ant-form-item-control"><input data-t="phone"></div></div>',
  '<div class="form-item"><div class="label">毕业院校</div><div class="control"><input data-t="school"></div></div>',
  '<div class="form-item"><div class="label">最高学历</div><div class="control"><input data-t="edu"></div></div>',
  '<div class="form-item"><div class="label">所学专业</div><div class="control"><input data-t="major"></div></div>',
  '<div class="form-item"><span class="item-label">毕业时间</span><span><input data-t="gradYear"></span></div>'
].join(''), { phone: '13800000000', school: '香港城市大学', edu: '硕士', major: '健康科学与管理', gradYear: '2026-10' });
ok('div/span 标签：手机号码已填', ff6.vals.phone === '13800000000', ff6.vals.phone);
ok('div/span 标签：毕业院校已填', ff6.vals.school === '香港城市大学', ff6.vals.school);
ok('div/span 标签：学历已填', ff6.vals.edu === '硕士', ff6.vals.edu);
ok('div/span 标签：专业已填', ff6.vals.major === '健康科学与管理', ff6.vals.major);
ok('div/span 标签：毕业时间已填', ff6.vals.gradYear === '2026-10', ff6.vals.gradYear);
ok('div/span 标签：5 项全中且无遗漏', ff6.res.filled.length === 5 && ff6.res.missed.length === 0,
  'filled=' + ff6.res.filled.length + ' missed=' + ff6.res.missed.join(','));

/* 场景七：分段卡片上的字段由 sections 的第一段补（公司名称 / 职位名称 / 项目名称 / 项目描述） */
const ff7 = runFill2([
  '<div class="form-item"><div class="label">公司名称</div><input data-t="company"></div>',
  '<div class="form-item"><div class="label">职位名称</div><input data-t="role"></div>',
  '<div class="form-item"><div class="label">项目名称</div><input data-t="projName"></div>',
  '<div class="form-item"><div class="label">项目描述</div><textarea data-t="projDesc"></textarea></div>',
  '<div class="form-item"><div class="label">学校名称</div><input data-t="school"></div>'
].join(''),
  { name: '杨明翰' },
  {
    education: [{ school: '香港城市大学', major: '健康科学与管理', degree: '硕士', time: '2025.09 - 2026.10', gpa: '', courses: '传染病管理' }],
    work: [{ company: '京东健康（京东互联网医院）', role: '产品运营实习生', time: '2025.11 - 2026.01', bullets: ['用户调研与竞品分析：输出完整竞品分析报告。'] }],
    projects: [{ name: 'ceRNA 网络分析项目', role: '项目成员', time: '2025.09 - 2026.08', description: '参与「ceRNA 网络分析项目」项目', duties: ['多组学数据自动化解析与归档。'] }]
  });
ok('分段卡片：公司名称来自 work[0]', ff7.vals.company === '京东健康（京东互联网医院）', ff7.vals.company);
ok('分段卡片：职位名称来自 work[0].role', ff7.vals.role === '产品运营实习生', ff7.vals.role);
ok('分段卡片：项目名称来自 projects[0]', ff7.vals.projName === 'ceRNA 网络分析项目', ff7.vals.projName);
ok('分段卡片：项目描述含中性描述 + 职责要点', /ceRNA/.test(ff7.vals.projDesc) && /多组学/.test(ff7.vals.projDesc), ff7.vals.projDesc);
ok('分段卡片：学校名称由 education[0] 兜底', ff7.vals.school === '香港城市大学', ff7.vals.school);

/* 场景八：受控表单 —— 必须用原生 setter 赋值。
   模拟 React 的 value tracker：实例上的 value setter 会「吞掉」直接赋值，
   框架据此认为值没变、把界面改回去。只有绕过实例、走原型 setter 才能落下真值。 */
(function () {
  const dom = new JSDOM(
    '<!DOCTYPE html><html><body><div class="form-item"><div class="label">姓名</div><input id="nm"></div></body></html>',
    { url: 'https://zhaopin.meituan.com/apply', runScripts: 'outside-only' }
  );
  const win = dom.window;
  const el = win.document.getElementById('nm');
  const nativeDesc = Object.getOwnPropertyDescriptor(win.HTMLInputElement.prototype, 'value');
  let tracker = '';
  Object.defineProperty(el, 'value', {
    configurable: true,
    get: function () { return nativeDesc.get.call(el); },
    set: function (x) { tracker = x; }        /* 只记进 tracker，不落真值 */
  });
  win.eval(src);
  const r = win.fillFromPayload({ fields: { name: '杨明翰' } });
  ok('受控表单：真实值通过原生 setter 落地', nativeDesc.get.call(el) === '杨明翰', JSON.stringify(nativeDesc.get.call(el)));
  ok('受控表单：没有走会被框架覆盖的直接赋值', tracker === '', 'tracker=' + JSON.stringify(tracker));
  ok('受控表单：计入 filled', r.filled.length === 1, 'filled=' + r.filled.length);
  win.close();
})();

/* ---------- 10.6 本岗改写文案进「项目描述 / 工作内容」栏（第二十二轮） ----------
   这是「CV 改写」唯一的出口：改出来的 bullets 必须能被扩展填进官网的描述栏，
   否则那个功能就只是个看着热闹的孤岛。 */
const ff8 = runFill2([
  '<div class="form-item"><div class="label">项目名称</div><input data-t="projName"></div>',
  '<div class="form-item"><div class="label">项目描述</div><textarea data-t="projDesc"></textarea></div>',
  '<div class="form-item"><div class="label">工作内容</div><textarea data-t="workDesc"></textarea></div>'
].join(''), { name: '杨明翰' }, {
  projects: [{ name: 'ceRNA 网络分析项目', role: '项目成员', description: '参与「ceRNA 网络分析项目」项目', duties: ['多组学数据自动化解析与归档：解析 TCGA 元数据。'] }],
  work: [{ company: '京东健康', role: '产品运营实习生', time: '2025.11 - 2026.01', bullets: ['用户调研与竞品分析：输出完整竞品分析报告。'] }],
  custom: {
    for: '百度|大模型算法工程师', version: 'v2', at: '2026-09-14',
    bullets: ['主导了资料重建，覆盖 [N] 家门店', '独立完成合规审核流程'],
    text: '主导了资料重建，覆盖 [N] 家门店\n独立完成合规审核流程'
  }
});
ok('本岗文案：工作内容栏用定制版而不是简历原文',
  ff8.vals.workDesc === '主导了资料重建，覆盖 [N] 家门店\n独立完成合规审核流程', JSON.stringify(ff8.vals.workDesc));
ok('本岗文案：项目名称仍来自结构化经历（没被文案顶掉）',
  ff8.vals.projName === 'ceRNA 网络分析项目', ff8.vals.projName);
/* 第二十三轮改的口径：**只填一处**。同一段话同时塞进「工作内容」和「项目描述」，
   HR 一眼就看出是复制的 —— 描述型栏按 自我评价 > 工作内容 > 项目描述 取第一个。 */
ok('本岗文案：项目描述保持简历原文，不重复刷屏',
  /ceRNA/.test(ff8.vals.projDesc) && /多组学/.test(ff8.vals.projDesc), ff8.vals.projDesc);
ok('本岗文案：返回结构标明用了定制版 + 填到了哪一栏',
  ff8.res.custom && ff8.res.custom.used === true && ff8.res.custom.bullets === 2 && ff8.res.custom.where === '工作内容',
  JSON.stringify(ff8.res.custom));

/* 回归：没有本岗文案时，项目描述仍用简历原文摘要 */
const ff8b = runFill2([
  '<div class="form-item"><div class="label">项目描述</div><textarea data-t="projDesc"></textarea></div>'
].join(''), { name: '杨明翰' }, {
  projects: [{ name: 'ceRNA 网络分析项目', description: '参与「ceRNA 网络分析项目」项目', duties: ['多组学数据自动化解析与归档。'] }]
});
ok('没有本岗文案时仍用简历原文（回归）',
  /参与「ceRNA/.test(ff8b.vals.projDesc) && /多组学/.test(ff8b.vals.projDesc), ff8b.vals.projDesc);
ok('没有本岗文案时 custom.used 为假', ff8b.res.custom && ff8b.res.custom.used === false);

/* ---------- 10.7 表单结构探针 probeForm（第二十二轮） ----------
   用户实测：公司名称 / 学校名称 / 起止时间这类栏填不动，因为每一家的组件都不一样。
   与其继续猜，不如给一个"把这一页的结构导出来"的按钮。这个函数必须**只读**。 */
(function () {
  const html = [
    '<div class="ant-form-item"><div class="ant-form-item-label"><div>公司名称</div></div>',
    '<div class="ant-form-item-control"><div class="ant-select" role="combobox" aria-haspopup="listbox">',
    '<div class="ant-select-selector"><span class="ant-select-selection-search">',
    '<input id="cbX" class="ant-select-selection-search-input" role="combobox" autocomplete="off">',
    '</span></div></div></div></div>',
    '<div class="ant-form-item"><div class="ant-form-item-label"><div>入学时间</div></div>',
    '<div class="ant-picker"><div class="ant-picker-input"><input id="dtX" readonly placeholder="请选择日期"></div></div></div>',
    '<div class="form-item"><span class="item-label">手机号码</span><input id="phX" name="mobile"></div>',
    '<select id="selX"><option>本科</option><option>硕士</option></select>',
    '<textarea id="taX" aria-label="自我介绍"></textarea>'
  ].join('');
  const dom = new JSDOM('<!DOCTYPE html><html><head><title>申请表</title></head><body>' + html + '</body></html>',
    { url: 'https://zhaopin.meituan.com/apply', runScripts: 'outside-only' });
  const win = dom.window;
  win.eval(src);
  const before = win.document.body.innerHTML;
  const p = win.probeForm();
  ok('探针：返回 ok 且扫到全部控件', p && p.ok && p.controlCount >= 5, 'controlCount=' + (p && p.controlCount));
  ok('探针：只读 —— 前后 DOM 完全一致', win.document.body.innerHTML === before);

  const cb = (p.controls || []).filter(function (x) { return x.id === 'cbX'; })[0];
  ok('探针：检索型下拉被识别出组件外壳 ant-select',
    cb && cb.wrapper && cb.wrapper.sel === '.ant-select', cb && JSON.stringify(cb.wrapper));
  ok('探针：标签来自 .ant-form-item-label（div 当标签）',
    cb && Object.keys(cb.label).some(function (k) { return cb.label[k] === '公司名称'; }),
    cb && JSON.stringify(cb.label));
  ok('探针：input 的 role / aria-haspopup 被带出来',
    cb && cb.role === 'combobox' && cb.hasPopup === 'listbox', cb && JSON.stringify({ role: cb.role, hp: cb.hasPopup }));

  const dt = (p.controls || []).filter(function (x) { return x.id === 'dtX'; })[0];
  ok('探针：日期选择器被识别出组件外壳 ant-picker',
    dt && dt.wrapper && dt.wrapper.sel === '.ant-picker', dt && JSON.stringify(dt.wrapper));
  ok('探针：只读日期框标了 readOnly（这正是"写 value 无效"的原因）', dt && dt.readOnly === true);
  ok('探针：placeholder 也被当作标签来源记下来',
    dt && dt.label && dt.label.placeholder === '请选择日期', dt && JSON.stringify(dt.label));

  const sel = (p.controls || []).filter(function (x) { return x.id === 'selX'; })[0];
  ok('探针：原生 select 带选项数量与样例',
    sel && sel.optionCount === 2 && sel.optionsSample.join('') === '本科硕士', sel && JSON.stringify(sel.optionsSample));

  ok('探针：rich 只列"值得一提"的组件（2 个下拉/日期，不含普通输入框）',
    p.richCount === 2, 'richCount=' + p.richCount);
  ok('探针：给出框架判定（本页无框架标记 → unknown）', p.framework === 'unknown', p.framework);
  win.close();
})();

/* ---------- 10.8 检索型下拉 / 日期控件的填充（第二十二轮） ----------
   这类栏是受控的搜索组件：写 value 一律无效，必须走
   「点开 → 逐字输入 → 等异步选项渲染 → 在选项上点击」。
   这里用 jsdom 搭一个行为接近 Ant Design Select 的替身来锁住这条交互序列。 */
function runCombo(html, fields, sections, onReady) {
  const dom = new JSDOM('<!DOCTYPE html><html><head><title>申请表</title></head><body>' + html + '</body></html>',
    { url: 'https://zhaopin.meituan.com/apply', runScripts: 'outside-only' });
  const win = dom.window;
  win.eval(src);
  if (onReady) onReady(win);
  return win.fillComboFields({ fields: fields, sections: sections || null }).then(function (res) {
    const vals = {};
    win.document.querySelectorAll('[data-t]').forEach(function (el) { vals[el.dataset.t] = el.value; });
    const out = { res: res, vals: vals };
    win.close();
    return out;
  });
}

const comboPage = [
  '<div class="ant-form-item"><div class="ant-form-item-label"><div>公司名称</div></div>',
  '<div class="ant-select" role="combobox" aria-haspopup="listbox">',
  '<div class="ant-select-selector"><input id="cb1" data-t="company" class="ant-select-selection-search-input" role="combobox" autocomplete="off"></div>',
  '</div></div>'
].join('');

/* 替身：输入即弹出（模拟异步返回的候选），点选项即选中并收起 */
function mockAntSelect(win) {
  const doc = win.document;
  doc.addEventListener('input', function (e) {
    if (e.target.id !== 'cb1') return;
    let dd = doc.querySelector('.ant-select-dropdown');
    if (!dd) {
      dd = doc.createElement('div');
      dd.className = 'ant-select-dropdown';
      dd.innerHTML = '<div class="ant-select-item-option" role="option">京东健康（京东互联网医院）</div>' +
        '<div class="ant-select-item-option" role="option">字节跳动</div>';
      doc.body.appendChild(dd);
    }
  });
  doc.addEventListener('click', function (e) {
    const opt = e.target.closest ? e.target.closest('.ant-select-item-option') : null;
    if (!opt) return;
    const inp = doc.getElementById('cb1');
    inp.value = opt.textContent;
    const dd = doc.querySelector('.ant-select-dropdown');
    if (dd) dd.parentNode.removeChild(dd);
  });
}

/* 场景九：检索型下拉 —— 选项文案比载荷里的值长，也要靠"以目标开头"匹配上 */
runCombo(comboPage, { company: '京东健康' }, null, mockAntSelect).then(function (r) {
  ok('检索型下拉：命中并选中了选项', r.res.filled.length === 1 && r.res.filled[0].field === 'company',
    JSON.stringify(r.res.filled) + ' missed=' + JSON.stringify(r.res.missed));
  ok('检索型下拉：填进去的是选项的完整文案（不是硬塞载荷里的值）',
    r.vals.company === '京东健康（京东互联网医院）', JSON.stringify(r.vals.company));
  ok('检索型下拉：标注走的是 combobox 路径', r.res.filled.length === 1 && r.res.filled[0].how === 'combobox');

  /* 场景十：下拉弹不出来 → 必须记 missed 说清原因，不能假装填上了 */
  return runCombo(comboPage, { company: '某不存在公司' }, null, null);
}).then(function (r2) {
  ok('下拉弹不出来：不硬填、记进 missed', r2.res.filled.length === 0 && r2.res.missed.length === 1,
    JSON.stringify(r2.res));
  ok('下拉弹不出来：missed 里写清原因（用户据此决定要不要手动填）',
    r2.res.missed[0] && /下拉没弹出来|没找到匹配项/.test(r2.res.missed[0].reason), JSON.stringify(r2.res.missed));

  /* 场景十一：日期选择器 —— 只读 input 也要能被写成可解析的日期文本 */
  const datePage = [
    '<div class="ant-form-item"><div class="ant-form-item-label"><div>毕业时间</div></div>',
    '<div class="ant-picker"><div class="ant-picker-input"><input id="dp1" data-t="gradYear" placeholder="请选择日期"></div></div></div>'
  ].join('');
  return runCombo(datePage, { gradYear: '2026-10' }, null, null);
}).then(function (r3) {
  ok('日期栏：被识别为日期型并写入', r3.res.filled.length === 1 && r3.res.filled[0].how === 'date',
    JSON.stringify(r3.res));
  ok('日期栏：写进去的是「YYYY-MM」格式', r3.vals.gradYear === '2026-10', JSON.stringify(r3.vals.gradYear));

  /* 场景十二：从结构化经历里取院校名填检索型下拉（不靠载荷字段） */
  return runCombo([
    '<div class="ant-form-item"><div class="ant-form-item-label"><div>毕业院校</div></div>',
    '<div class="ant-select" role="combobox"><div class="ant-select-selector">',
    '<input id="sc1" data-t="school" class="ant-select-selection-search-input"></div></div></div>'
  ].join(''), { name: '杨明翰' }, { education: [{ school: '香港城市大学', degree: '硕士' }] }, function (win) {
    const doc = win.document;
    doc.addEventListener('input', function (e) {
      if (e.target.id !== 'sc1') return;
      if (doc.querySelector('.ant-select-dropdown')) return;
      const dd = doc.createElement('div');
      dd.className = 'ant-select-dropdown';
      dd.innerHTML = '<div class="ant-select-item-option" role="option">香港城市大学</div>';
      doc.body.appendChild(dd);
    });
    doc.addEventListener('click', function (e) {
      const opt = e.target.closest ? e.target.closest('.ant-select-item-option') : null;
      if (!opt) return;
      doc.getElementById('sc1').value = opt.textContent;
      const dd = doc.querySelector('.ant-select-dropdown');
      if (dd) dd.parentNode.removeChild(dd);
    });
  });
}).then(function (r4) {
  ok('检索型下拉：院校名可由结构化经历（education[0]）兜底',
    r4.vals.school === '香港城市大学', JSON.stringify(r4.vals));
  ok('检索型下拉：全部场景结束后进程正常（异步链路没有卡死）', true);
  /* 第二十三轮：美团式自研表单。接在异步链路上，跑完才汇总。 */
  return runMtdSuite().then(function () {
    /* 第二十四轮：注入语义。refactor 掉这条，整个扩展的功能都会静默失效。 */
    return runInjectionSuite().then(function () {
    /* 第三十八轮：牛客式简历页条目错位 —— 复现场景与修复锁定 */
    return runNowcoderReproSuite();
  });
  });
}).then(function () {
  finishCollect();
});

/* ---------- 10.9 美团式自研表单（mtd-*，第二十三轮） ----------
   这一整套是照着用户回传的真实 probeForm JSON 搭的。它逼出了三个真问题：

   ① 段落容器的文本会被当成字段标签。真实数据里「个人照片」那个 file 框的 up3
      是**同一段里第一个字段的「姓名*」** —— 旧实现把 up1..up3 拼成一串做正则，
      结果页面上任何一个认不出标签的栏，都会被填进姓名。
      这里的 [data-t="mystery"] 就是那个"认不出标签的栏"，它必须保持为空。
   ② 同一栏出现 2 段（2 段教育 / 2 段工作 / 2 段项目），文本一模一样，
      只有顺序能区分 —— 不记段号就会全填到第一段。
   ③ 起止时间是 readOnly 的自研日期框：写 value 是**假象**（原生 setter 改得动 DOM，
      组件不读它，用户以为填上了）。必须点开面板，在面板里逐年逐月点。
*/
function mtdEduBlock(k) {
  return [
    '<div class="mtd-form-item"><div class="mtd-form-item__label">学校名称</div>',
    '<div class="mtd-form-item__control"><input data-t="edu' + k + 'School"></div></div>',
    '<div class="mtd-form-item"><div class="mtd-form-item__label">专业</div>',
    '<div class="mtd-form-item__control"><input data-t="edu' + k + 'Major"></div></div>',
    '<div class="mtd-form-item"><div class="mtd-form-item__label">学历</div>',
    '<div class="mtd-form-item__control"><input data-t="edu' + k + 'Degree"></div></div>',
    /* 起止时间：外壳 + 日历图标 + 只读输入框，和真实页面一模一样。
       图标 class 是 mtdicon-calendar-o —— 也命中 [class*="calendar"]，是个陷阱。 */
    '<div class="mtd-form-item"><div class="mtd-form-item__control"><div class="mtd-date-picker">',
    '<span class="mtdicon mtdicon-calendar-o"></span>',
    '<input data-t="edu' + k + 'Start" readonly placeholder="入学时间"></div></div></div>',
    '<div class="mtd-form-item"><div class="mtd-form-item__control"><div class="mtd-date-picker">',
    '<span class="mtdicon mtdicon-calendar-o"></span>',
    '<input data-t="edu' + k + 'End" readonly placeholder="毕业时间"></div></div></div>'
  ].join('');
}
function mtdWorkBlock(k, cbId) {
  return [
    '<div class="mtd-form-item"><div class="mtd-form-item__label">部门名称</div>',
    '<div class="mtd-form-item__control"><input data-t="work' + k + 'Dept" placeholder="请输入部门名称"></div></div>',
    '<div class="mtd-form-item"><div class="mtd-form-item__label">职位名称</div>',
    '<div class="mtd-form-item__control"><input data-t="work' + k + 'Role" placeholder="请输入职位名称"></div></div>',
    '<div class="mtd-form-item"><div class="mtd-form-item__control">',
    '<input data-t="work' + k + 'Start" readonly placeholder="在开始时间"></div></div>',
    '<div class="mtd-form-item"><div class="mtd-form-item__control">',
    '<input data-t="work' + k + 'End" readonly placeholder="结束时间"></div></div>',
    '<div class="mtd-form-item"><div class="mtd-form-item__control">',
    '<textarea data-t="work' + k + 'Desc" placeholder="请输入工作描述"></textarea></div></div>',
    '<div class="mtd-form-item"><div class="mtd-form-item__control">',
    '<input type="checkbox" class="mtd-checkbox-input" id="' + cbId + '">',
    '<label for="' + cbId + '">至今</label></div></div>'
  ].join('');
}
function mtdProjBlock(k, cbId) {
  return [
    '<div class="mtd-form-item"><div class="mtd-form-item__control">',
    '<input data-t="proj' + k + 'Name" placeholder="请输入项目名称"></div></div>',
    '<div class="mtd-form-item"><div class="mtd-form-item__control">',
    '<input data-t="proj' + k + 'Role" placeholder="请输入项目角色"></div></div>',
    '<div class="mtd-form-item"><div class="mtd-form-item__control">',
    '<input data-t="proj' + k + 'Start" readonly placeholder="开始时间"></div></div>',
    '<div class="mtd-form-item"><div class="mtd-form-item__control">',
    '<input data-t="proj' + k + 'End" readonly placeholder="结束时间"></div></div>',
    '<div class="mtd-form-item"><div class="mtd-form-item__control">',
    '<input data-t="proj' + k + 'Link" placeholder="请输入项目链接"></div></div>',
    '<div class="mtd-form-item"><div class="mtd-form-item__control">',
    '<textarea data-t="proj' + k + 'Desc" placeholder="请输入项目描述"></textarea></div></div>',
    '<div class="mtd-form-item"><div class="mtd-form-item__control">',
    '<input type="checkbox" class="mtd-checkbox-input" id="' + cbId + '">',
    '<label for="' + cbId + '">至今</label></div></div>'
  ].join('');
}
const MTD_HTML = [
  /* 头部信息段：一个容器里压着 4 个控件 —— 那段容器文本绝不能当字段标签 */
  '<div class="mtd-form-section">',
  '<div class="mtd-form-item"><div class="mtd-form-item__label">姓名*</div>',
  '<div class="mtd-form-item__control"><input data-t="name" placeholder="请输入你的真实姓名"></div></div>',
  /* 认不出标签的栏：旧实现会把它认成「姓名*」并把名字填进来 */
  '<div class="mtd-form-item"><div class="mtd-form-item__control"><input data-t="mystery"></div></div>',
  '<div class="mtd-form-item"><div class="mtd-form-item__control">',
  '<input data-t="idno" placeholder="请输入证件号码"></div></div>',
  '<div class="mtd-form-item"><div class="mtd-form-item__control">',
  '<input type="file" class="mtd-upload-input" data-t="photo"></div></div>',
  '</div>',
  /* 检索型下拉：自研 mtd-，不是 antd —— 外壳要认得出来 */
  '<div class="mtd-form-item"><div class="mtd-form-item__label">公司名称</div>',
  '<div class="mtd-form-item__control"><div class="mtd-select">',
  '<input data-t="company" placeholder="请选择"></div></div></div>',
  mtdEduBlock(0), mtdEduBlock(1),
  mtdWorkBlock(0, '1'), mtdWorkBlock(1, '1'),   /* 故意撞 id：真实页面上「至今」的 id 就重了 */
  mtdProjBlock(0, '3'), mtdProjBlock(1, '4')
].join('');

const MT_SECTIONS = {
  education: [
    { school: '华中科技大学', major: '计算机科学与技术', degree: '本科', time: '2020.09 - 2024.06' },
    { school: '香港城市大学', major: '健康科学与管理', degree: '硕士', time: '2025.09 - 2026.10' }
  ],
  work: [
    { company: '京东健康', role: '产品运营实习生', time: '2024.11 至 2025.01', bullets: ['用户调研与竞品分析：输出完整竞品分析报告。'] },
    { company: '字节跳动', role: '数据分析实习生', time: '2025.03 至 2025.11', bullets: ['搭建指标看板。'] }
  ],
  projects: [
    { name: 'ceRNA 网络分析项目', role: '项目成员', time: '2025.09 - 2026.08', description: '参与「ceRNA 网络分析项目」项目', duties: ['多组学数据自动化解析与归档。'] },
    { name: '慢病问卷重构', role: '负责人', time: '2025.10 至 至今', description: '重构慢病随访问卷', duties: ['覆盖 12 个科室。'] }
  ],
  custom: {
    for: '美团|产品运营', version: 'v2', at: '2026-09-14',
    bullets: ['主导了资料重建，覆盖 [N] 家门店', '独立完成合规审核流程'],
    text: '主导了资料重建，覆盖 [N] 家门店\n独立完成合规审核流程'
  }
};

/* 自研月历面板的替身（第二十五轮：按用户回传的**面板打开状态**那份真实 JSON 重搭）
   真实结构（zhaopin.meituan.com 实测，类名都挂在叶子上）：
     <div class="mtd-date-picker">                        ← 外壳，点它就弹面板
       <span class="mtdicon mtdicon-calendar-o"></span>   ← 日历图标也命中 [class*=calendar]（陷阱）
       <input readonly placeholder="入学时间">
     </div>
     面板（真实页面是浮层）：
       <div class="mtd-month-calendar">
         <span class="mtd-month-calendar-year-switcher left-switcher" role="button">‹</span>
         <button class="mtd-month-calendar-year-btn">2026年</button>       ← 点它才出年份列表
         <span class="mtd-month-calendar-year-switcher right-switcher" role="button">›</span>
         <span class="mtd-month-calendar-year-header-range">2020-2029</span>
         <div class="mtd-year-panel-list-data">2019</div> …（一页 12 年，默认藏着）
         <div class="mtd-month-panel-list-data">1月</div> … 12 个月
       </div>
   行为：默认显示「某一年的 12 个月」；点年份按钮才露出年份列表（月份同时藏起来）；
        两侧箭头翻十年页；点年份回到月份；点月份落值并**收起面板**。
        「一屏只有一个面板」也照着做 —— 点第二个日期栏时前一个先收掉。
   opts.baseYear —— 面板打开时默认显示哪一年
   opts.deaf     —— 组件"聋"：格子点得动但一点反应都没有（真实自研组件常拦合成事件） */
function mockMtdPicker(win, opts) {
  const doc = win.document;
  const o = opts || {};
  const baseYear = o.baseYear || 2026;
  let curYear = baseYear, decade = Math.floor(baseYear / 10) * 10, showYear = false, forT = null;

  function pan() { return doc.querySelector('.mtd-month-calendar'); }
  function cells(kind) {
    let h = '';
    if (kind === 'y') { for (let i = -1; i <= 10; i++) h += '<div class="mtd-year-panel-list-data">' + (decade + i) + '</div>'; }
    else { for (let m = 1; m <= 12; m++) h += '<div class="mtd-month-panel-list-data">' + m + '月</div>'; }
    return h;
  }
  function render() {
    const p = pan();
    if (!p) return;
    p.setAttribute('data-level', showYear ? 'y' : 'm');
    p.setAttribute('data-year', String(curYear));
    p.querySelector('.mtd-month-calendar-year-btn').textContent = curYear + '年';
    p.querySelector('.mtd-month-calendar-year-header-range').textContent = decade + '-' + (decade + 9);
    const yl = p.querySelector('.mtd-year-panel-list'), ml = p.querySelector('.mtd-month-panel-list');
    yl.innerHTML = cells('y');
    ml.innerHTML = cells('m');
    /* 月份视图下年份列表仍在 DOM 里，只是藏着 —— 真实页面就是这样（陷阱要保持一致） */
    yl.style.display = showYear ? '' : 'none';
    ml.style.display = showYear ? 'none' : '';
  }
  doc.addEventListener('click', function (e) {
    const t = e.target;
    if (!t || !t.closest) return;
    const shell = t.closest('.mtd-date-picker');
    const own = shell ? shell.querySelector('input[readonly]') : t.closest('input[readonly]');
    if (own) {
      const old = pan();
      if (old) old.parentNode.removeChild(old);          /* 一屏只有一个面板 */
      forT = own.dataset.t;
      curYear = baseYear; decade = Math.floor(baseYear / 10) * 10; showYear = false;
      const p = doc.createElement('div');
      p.className = 'mtd-month-calendar';
      p.innerHTML =
        '<div class="mtd-month-calendar-header">' +
        '<span class="mtd-month-calendar-year-switcher left-switcher" role="button">‹</span>' +
        '<button type="button" class="mtd-month-calendar-year-btn"></button>' +
        '<span class="mtd-month-calendar-year-switcher right-switcher" role="button">›</span>' +
        '</div>' +
        '<span class="mtd-month-calendar-year-header-range"></span>' +
        '<div class="mtd-year-panel-list"></div><div class="mtd-month-panel-list"></div>';
      doc.body.appendChild(p);
      render();
      return;
    }
    if (!pan()) return;
    if (t.closest('.mtd-month-calendar-year-btn')) { showYear = true; render(); return; }
    const sw = t.closest('.mtd-month-calendar-year-switcher');
    if (sw) { decade += sw.classList.contains('right-switcher') ? 10 : -10; showYear = true; render(); return; }
    const yc = t.closest('.mtd-year-panel-list-data');
    if (yc) {
      const y = parseInt(String(yc.textContent).trim(), 10);
      if (!isNaN(y)) { curYear = y; decade = Math.floor(y / 10) * 10; showYear = false; render(); }
      return;
    }
    const mc = t.closest('.mtd-month-panel-list-data');
    if (mc) {
      const m = String(mc.textContent).trim().match(/^(\d{1,2})月$/);
      if (!m) return;
      if (!o.deaf) {
        const target = doc.querySelector('input[readonly][data-t="' + forT + '"]');
        if (target) target.value = curYear + '-' + (m[1].length < 2 ? '0' + m[1] : m[1]);
      }
      const p = pan(); if (p) p.parentNode.removeChild(p);
    }
  });
}
/* 自研检索下拉的替身 */
function mockMtdSelect(win) {
  const doc = win.document;
  doc.addEventListener('input', function (e) {
    if (e.target.dataset.t !== 'company') return;
    if (doc.querySelector('.mtd-select-dropdown')) return;
    const dd = doc.createElement('div');
    dd.className = 'mtd-select-dropdown';
    dd.innerHTML = '<div class="mtd-select-item-option">京东健康（京东互联网医院）</div>' +
      '<div class="mtd-select-item-option">字节跳动</div>';
    doc.body.appendChild(dd);
  });
  doc.addEventListener('click', function (e) {
    const opt = e.target.closest ? e.target.closest('.mtd-select-item-option') : null;
    if (!opt) return;
    const inp = doc.querySelector('[data-t="company"]');
    if (inp) inp.value = opt.textContent;
    const dd = doc.querySelector('.mtd-select-dropdown');
    if (dd) dd.parentNode.removeChild(dd);
  });
}

function runMtdSuite() {
  const dom = new JSDOM('<!DOCTYPE html><html><head><title>美团招聘</title></head><body>' + MTD_HTML + '</body></html>',
    { url: 'https://zhaopin.meituan.com/web/delivery-confirm', runScripts: 'outside-only' });
  const win = dom.window;
  win.eval(src);
  mockMtdPicker(win);
  mockMtdSelect(win);
  const r1 = win.fillFromPayload({ fields: { name: '杨明翰' }, sections: MT_SECTIONS });
  const beforeProbe = win.document.body.innerHTML;
  const probe = win.probeForm();
  const sameAfterProbe = win.document.body.innerHTML === beforeProbe;
  return win.fillComboFields({ fields: { name: '杨明翰' }, sections: MT_SECTIONS }).then(function (r2) {
    const vals = {};
    win.document.querySelectorAll('[data-t]').forEach(function (el) { vals[el.dataset.t] = el.value; });

    /* --- 污染守卫：段落标题不得被当成字段标签 --- */
    ok('自研表单：姓名填进了它自己的栏', vals.name === '杨明翰', vals.name);
    ok('自研表单：认不出标签的栏保持为空（段落标题「姓名*」没有被当成它的标签）',
      vals.mystery === '', JSON.stringify(vals.mystery));
    ok('自研表单：探针只给「姓名」这一栏记了标签，认不出的栏没编造',
      (function () {
        const named = (probe.controls || []).filter(function (x) { return x.guess && /姓名/.test(x.guess.text); });
        const m = (probe.controls || []).filter(function (x) { return x.type === 'text' && !x.guess && !x.id; });
        return named.length === 1 && m.length >= 1;
      })(),
      JSON.stringify((probe.controls || []).filter(function (x) { return x.guess && /姓名/.test(x.guess.text); }).map(function (x) { return { i: x.i, g: x.guess }; })));

    /* --- 敏感栏：证件号码 / 文件上传一律不填 --- */
    ok('自研表单：证件号码不代填', vals.idno === '', JSON.stringify(vals.idno));
    ok('自研表单：证件类栏记进 skipped 并说明原因',
      (r1.skipped || []).some(function (s) { return /证件/.test(s.field) && /敏感/.test(s.reason); }),
      JSON.stringify(r1.skipped));
    ok('自研表单：文件上传不代填', vals.photo === '');
    ok('自研表单：文件上传记进 skipped',
      (r1.skipped || []).some(function (s) { return /文件/.test(s.field); }), JSON.stringify(r1.skipped));

    /* --- 两段经历各就各位（段号的作用） --- */
    ok('自研表单：教育第 1 段 → 页面上第 1 段', vals.edu0School === '华中科技大学' && vals.edu0Major === '计算机科学与技术' && vals.edu0Degree === '本科',
      JSON.stringify([vals.edu0School, vals.edu0Major, vals.edu0Degree]));
    ok('自研表单：教育第 2 段 → 页面上第 2 段', vals.edu1School === '香港城市大学' && vals.edu1Major === '健康科学与管理' && vals.edu1Degree === '硕士',
      JSON.stringify([vals.edu1School, vals.edu1Major, vals.edu1Degree]));
    ok('自研表单：工作两段分别落位', vals.work0Role === '产品运营实习生' && vals.work1Role === '数据分析实习生',
      JSON.stringify([vals.work0Role, vals.work1Role]));
    ok('自研表单：项目两段分别落位', vals.proj0Name === 'ceRNA 网络分析项目' && vals.proj1Name === '慢病问卷重构',
      JSON.stringify([vals.proj0Name, vals.proj1Name]));
    ok('自研表单：公司名不被填进「部门名称」（部门 ≠ 公司）', vals.work0Dept === '', JSON.stringify(vals.work0Dept));

    /* --- 本岗文案：只填一处 --- */
    ok('自研表单：本岗文案填进第 1 段工作描述',
      vals.work0Desc === '主导了资料重建，覆盖 [N] 家门店\n独立完成合规审核流程', JSON.stringify(vals.work0Desc));
    ok('自研表单：第 2 段工作描述仍用简历原文（本岗文案不重复刷屏）',
      vals.work1Desc === '搭建指标看板。', JSON.stringify(vals.work1Desc));
    ok('自研表单：项目描述保持简历原文',
      /ceRNA/.test(vals.proj0Desc) && /多组学/.test(vals.proj0Desc) && /重构慢病随访/.test(vals.proj1Desc),
      JSON.stringify([vals.proj0Desc, vals.proj1Desc]));

    /* --- readOnly 日期框：必须点面板，不能靠写 value --- */
    ok('自研表单：只读日期框没被硬写 value（写了也是假象，这里第一遍就放过了）',
      r1.filled.every(function (f) { return !/Start|End/.test(f.field) || f.field === 'custom'; }),
      JSON.stringify(r1.filled.map(function (f) { return f.field; })));
    ok('自研表单：教育起止由日期面板逐年逐月点出来',
      vals.edu0Start === '2020-09' && vals.edu0End === '2024-06' && vals.edu1Start === '2025-09' && vals.edu1End === '2026-10',
      JSON.stringify([vals.edu0Start, vals.edu0End, vals.edu1Start, vals.edu1End]));
    ok('自研表单：工作「2024.11 至 2025.01」切片正确（按连字符切会切成三段）',
      vals.work0Start === '2024-11' && vals.work0End === '2025-01',
      JSON.stringify([vals.work0Start, vals.work0End]));
    ok('自研表单：日期面板路径标注了 how=date-panel',
      r2.filled.some(function (f) { return f.how === 'date-panel'; }), 'FILLED=' + JSON.stringify(r2.filled) + ' MISSED=' + JSON.stringify(r2.missed));

    ok('自研表单：只读日期栏不记进第一遍的「没找到」（那是交给第二遍，不是漏填）',
      r1.missed.every(function (m) { return !/gradYear|gradEnd/.test(String(m)); }), JSON.stringify(r1.missed));
    ok('自研表单：结束时间是「至今」时只提醒勾框，不硬写一个日期进去',
      (r2.notice || []).some(function (t) { return /至今/.test(t); }) && vals.proj1End === '',
      JSON.stringify([r2.notice, vals.proj1End]));

    /* --- 自研检索下拉 --- */
    ok('自研表单：mtd- 检索下拉被点开并选中（写 value 一律无效的那种）',
      vals.company === '京东健康（京东互联网医院）', JSON.stringify(vals.company));

    /* --- 探针 v2 --- */
    ok('探针 v2：识别出 UI 库是自研 mtd-', /mtd/.test(probe.uiKit), probe.uiKit);
    ok('探针 v2：直接给出「这栏叫什么、依据什么」',
      (probe.controls || []).some(function (x) { return x.guess && x.guess.text === '学校名称' && /up|label/.test(x.guess.from); }),
      JSON.stringify((probe.controls || [])[0] && probe.controls[0].guess));
    ok('探针 v2：记下同名栏是第几段', (function () {
      const a = (probe.controls || []).filter(function (x) { return x.guess && x.guess.text === '学校名称'; });
      return a.length === 2 && a[0].block === 0 && a[1].block === 1;
    })(), JSON.stringify((probe.controls || []).filter(function (x) { return x.guess && x.guess.text === '学校名称'; }).map(function (x) { return x.block; })));
    ok('探针 v2：撞了的 id 被标出来（label[for] 会抓错栏）', probe.dupIds && probe.dupIds['1'] === 2, JSON.stringify(probe.dupIds));
    /* 这条原来断言的是「panels 为空」—— 那其实是**在锁一个 bug**：
       探针的可见性判据用了 offsetParent / getClientRects，无头环境里恒为空，
       于是 panels 永远是空的（第二十五轮改判据时抓到的）。
       现在改成断言真正该成立的事：只报"真的开着"的浮层。 */
    ok('探针 v3：只报真的开着的浮层（第一遍填完时场上就 mtd 下拉这一个）',
      (probe.panels || []).length === 1 && probe.panels[0].cls === 'mtd-select-dropdown',
      JSON.stringify((probe.panels || []).map(function (x) { return x.cls; })));
    ok('探针 v2：只读 —— 探测前后 DOM 完全一致', sameAfterProbe);
    ok('探针 v2：给出"点开面板再探一次"的下一步指引', /点开/.test(probe.hint || ''), probe.hint);

    /* --- 探针 v3：把面板的层级说清楚（v2 只能靠人猜 nodeCls），且不把图标当面板 --- */
    win.document.querySelector('[data-t="edu0Start"]')
      .dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
    const probe2 = win.probeForm();
    const mp = (probe2.panels || []).filter(function (x) { return /月历/.test(String(x.kind)); })[0];
    ok('探针 v3：面板被认成「美团月历（月 / 年两级）」', !!mp,
      JSON.stringify((probe2.panels || []).map(function (x) { return { cls: x.cls, kind: x.kind }; })));
    ok('探针 v3：年份按钮 / 十年页眉 / 翻页箭头 / 月·年格子数都报出来',
      !!mp && mp.yearBtn === '2026年' && mp.range === '2020-2029' &&
      (mp.switchers || []).join(' ').indexOf('left-switcher') >= 0 &&
      (mp.switchers || []).join(' ').indexOf('right-switcher') >= 0 &&
      !!mp.cellCount && mp.cellCount.month === 12 && mp.cellCount.year === 12,
      JSON.stringify(mp));
    ok('探针 v3：日历图标不冒充面板（图标也命中 [class*=calendar]，但没有内容）',
      !(probe2.panels || []).some(function (x) { return !x.textSample && !(x.nodeCls || []).length; }),
      JSON.stringify((probe2.panels || []).map(function (x) { return x.cls; })));
    const openPan = win.document.querySelector('.mtd-month-calendar');
    if (openPan) openPan.parentNode.removeChild(openPan);

    /* --- 点击路径可追溯：真点不动时，从 steps 就能看出卡在哪一步 --- */
    const dpf = (r2.filled || []).filter(function (x) { return x.how === 'date-panel'; })[0];
    ok('自研月历：点击路径记进 steps（展开年份 → 选年 → 选月）',
      !!dpf && /展开年份/.test((dpf.steps || []).join('|')) &&
      /选年/.test((dpf.steps || []).join('|')) && /选月/.test((dpf.steps || []).join('|')),
      JSON.stringify(dpf && dpf.steps));
    win.close();
  })
    .then(function () { return runMtdPagingSuite(); })
    .then(function () { return runMtdDeafSuite(); });
}

/* 单个只读日期栏（带外壳 + 图标）的小夹具 */
function mtdDateOnly(tag, ph) {
  return '<div class="mtd-form-item"><div class="mtd-form-item__control"><div class="mtd-date-picker">' +
    '<span class="mtdicon mtdicon-calendar-o"></span>' +
    '<input data-t="' + tag + '" readonly placeholder="' + ph + '"></div></div></div>';
}
function mtdMiniDom(tag, ph) {
  const dom = new JSDOM('<!DOCTYPE html><html><head><title>美团招聘</title></head><body>' +
    mtdDateOnly(tag, ph) + '</body></html>',
    { url: 'https://zhaopin.meituan.com/web/delivery-confirm', runScripts: 'outside-only' });
  dom.window.eval(src);
  return dom.window;
}

/* 目标年不在这一页（一页 12 年）→ 必须先点两侧箭头翻页再选。
   默认页是 2019~2030，2013 落在上一页。 */
function runMtdPagingSuite() {
  const win = mtdMiniDom('gradEnd', '入学时间');
  mockMtdPicker(win, { baseYear: 2026 });
  return win.fillComboFields({ fields: { gradEnd: '2013-05' } }).then(function (r) {
    const el = win.document.querySelector('[data-t="gradEnd"]');
    const f = (r.filled || [])[0] || {};
    ok('自研月历：目标年不在当前页时用箭头翻页翻到（2013 在默认页 2019-2030 之外）',
      el.value === '2013-05', JSON.stringify({ v: el.value, r: r }));
    ok('自研月历：翻页路径完整（展开年份 → 选年 2013 → 选月 5）',
      /展开年份/.test((f.steps || []).join('|')) && /选年 2013/.test((f.steps || []).join('|')) &&
      /选月 5/.test((f.steps || []).join('|')), JSON.stringify(f.steps));

    /* 载荷给到「日」而面板只到「月」：值填上了，但日期部分丢了 ——
       必须提醒手补，不能因为"值变了"就算填完整（不声不响少一位比明说更糟）。 */
    return win.fillComboFields({ fields: { gradEnd: '2013-05-20' } }).then(function (r2) {
      const nt = (r2.notice || []).join('|');
      ok('自研月历：面板只到「月」而载荷给到「日」→ 值填上但要提醒手补日期',
        (r2.filled || []).length === 1 && /只到「月」/.test(nt) && /2013-05-20/.test(nt),
        JSON.stringify({ filled: r2.filled, notice: r2.notice, v: el.value }));
      ok('自研月历：提醒里带上了实际填进去的值（用户照着手补，不用再猜）', /2013-05/.test(nt), nt);
      win.close();
    });
  });
}

/* 组件"聋"：面板能开、格子点得动，但一点反应都没有（真实自研组件常拦合成事件）。
   这时绝不能报"填好了" —— 必须记进 missed，并把当前值一起说出来。 */
function runMtdDeafSuite() {
  const win = mtdMiniDom('gradEnd', '入学时间');
  mockMtdPicker(win, { baseYear: 2026, deaf: true });
  return win.fillComboFields({ fields: { gradEnd: '2026-05' } }).then(function (r) {
    const el = win.document.querySelector('[data-t="gradEnd"]');
    const m = (r.missed || [])[0] || {};
    ok('自研月历：点了但值没落上 → 如实记 missed，不说"填好了"',
      el.value === '' && (r.filled || []).length === 0 && /没变成 2026-05/.test(String(m.reason)),
      JSON.stringify({ v: el.value, filled: r.filled, reason: m.reason }));
    win.close();
  });
}

/* ---------- 10.10 牛客式简历页：条目错位复现与修复锁定（第三十八轮） ----------
   用户实测：ICB 项目被填上深圳海关口岸门诊部的 2024.05-2025.07，ceRNA 项目被填上
   京东健康的起止（年份还被选错成 2026/11），第 2 段工作经历公司名称空着。
   根因：第二遍「载荷第 k 条 ↔ 全页第 k 个时间栏」不分工作 / 项目组。
   这组用例把修复锁死：时间跟着名字走，未来时间宁可不填。 */
function nkProjBlock(pfx) {
  return [
    '<div class="nk-item"><div class="nk-label">项目名称</div><input data-t="' + pfx + 'Name"></div>',
    '<div class="nk-item"><div class="nk-label">项目角色</div><input data-t="' + pfx + 'Role"></div>',
    '<div class="nk-item"><div class="nk-label">项目时间</div>',
    '<div class="mtd-date-picker"><input data-t="' + pfx + 'Start" readonly placeholder="开始时间"></div>',
    '<div class="mtd-date-picker"><input data-t="' + pfx + 'End" readonly placeholder="结束时间"></div></div>',
    '<div class="nk-item"><div class="nk-label">项目描述</div><textarea data-t="' + pfx + 'Desc"></textarea></div>'
  ].join('');
}
function nkWorkBlock(pfx) {
  return [
    '<div class="nk-item"><div class="nk-label">职位名称</div><input data-t="' + pfx + 'Role"></div>',
    '<div class="nk-item"><div class="nk-label">在职时间</div>',
    '<div class="mtd-date-picker"><input data-t="' + pfx + 'Start" readonly placeholder="开始时间"></div>',
    '<div class="mtd-date-picker"><input data-t="' + pfx + 'End" readonly placeholder="结束时间"></div></div>',
    '<div class="nk-item"><div class="nk-label">工作描述</div><textarea data-t="' + pfx + 'Desc"></textarea></div>'
  ].join('');
}
const NK_PAGE = nkProjBlock('p0') + nkProjBlock('p1') + nkWorkBlock('w0');
const NK_PROJECTS = [
  { name: 'ICB 免疫疗法多组学数据库构建', role: '项目成员', time: '2026.01 - 2026.08', description: '多组学数据库整合' },
  { name: 'ceRNA 网络分析项目', role: '项目成员', time: '2025.09 - 2026.08', description: 'ceRNA 网络构建' }
];
const NK_WORKS = [
  { company: '京东健康（京东互联网医院）', role: '产品运营实习生', time: '2025.11 - 2026.01', bullets: ['竞品分析报告'] },
  { company: '深圳海关口岸门诊部', role: '口腔科实习生', time: '2024.05 - 2025.07', bullets: ['临床诊疗支持'] }
];
function nkDom() {
  const dom = new JSDOM('<!DOCTYPE html><html><head><title>在线简历</title></head><body>' + NK_PAGE + '</body></html>',
    { url: 'https://www.nowcoder.com/profile', runScripts: 'outside-only' });
  dom.window.eval(src);
  mockMtdPicker(dom.window);
  return dom.window;
}
function nkVals(win) {
  const v = {};
  win.document.querySelectorAll('[data-t]').forEach(function (el) { v[el.dataset.t] = el.value; });
  return v;
}
function runNowcoderReproSuite() {
  /* 场景 A：项目表单排在工作表单前面（用户实测的 DOM 顺序）。
     旧代码：works[0] 京东健康抢 p0 的时间栏，works[1] 深圳海关抢 p1 的。 */
  const winA = nkDom();
  winA.fillFromPayload({ fields: {}, sections: { work: NK_WORKS, projects: NK_PROJECTS } });
  return winA.fillComboFields({ fields: {}, sections: { work: NK_WORKS, projects: NK_PROJECTS } }).then(function (rA) {
    const v = nkVals(winA);
    ok('牛客复现：ICB 的时间是它自己的（2026-01 / 2026-08），不再被深圳海关那段抢占',
      v.p0Start === '2026-01' && v.p0End === '2026-08',
      JSON.stringify({ s: v.p0Start, e: v.p0End }));
    ok('牛客复现：ceRNA 的时间是它自己的（2025-09 / 2026-08），不再被京东健康那段抢占',
      v.p1Start === '2025-09' && v.p1End === '2026-08',
      JSON.stringify({ s: v.p1Start, e: v.p1End }));
    ok('牛客复现：京东健康的起止时间落在工作表单里（2025-11 / 2026-01）',
      v.w0Start === '2025-11' && v.w0End === '2026-01',
      JSON.stringify({ s: v.w0Start, e: v.w0End }));
    ok('牛客复现：项目名 / 职位名第一遍就填对（内容锚点的前提）',
      v.p0Name === 'ICB 免疫疗法多组学数据库构建' && v.w0Role === '产品运营实习生',
      JSON.stringify({ n: v.p0Name, r: v.w0Role }));
    ok('牛客复现：页面上没有的第 2 段工作经历（深圳海关）如实报「表单不在这页上」',
      (rA.missed || []).some(function (m) { return /深圳海关/.test(String(m.reason)); }),
      JSON.stringify((rA.missed || []).map(function (m) { return m.reason; })));
    winA.close();

    /* 场景 B：重跑对齐 —— 名字是上一轮按旧顺序填的（p0=ICB，p1=ceRNA），
       这一轮载荷把两条项目换了个顺序。锚点必须把时间跟名字对上。 */
    const winB = nkDom();
    winB.fillFromPayload({ fields: {}, sections: { projects: [NK_PROJECTS[0], NK_PROJECTS[1]] } });
    return winB.fillComboFields({ fields: {}, sections: { projects: [NK_PROJECTS[1], NK_PROJECTS[0]] } }).then(function () {
      const v2 = nkVals(winB);
      ok('牛客复现：载荷顺序变了，时间仍跟着项目名走（p0 依然是 ICB 的 2026-01）',
        v2.p0Start === '2026-01' && v2.p1Start === '2025-09',
        JSON.stringify({ p0: v2.p0Start, p1: v2.p1Start }));
      winB.close();

      /* 场景 C：未来时间防呆 —— 开始时间 2027.01（现在是 2026 下半年）不代填，如实报告。 */
      const winC = nkDom();
      return winC.fillComboFields({ fields: {}, sections: { work: [{ company: '某公司', role: '实习生', time: '2027.01 - 至今', bullets: [] }] } }).then(function (rC) {
        const v3 = nkVals(winC);
        ok('未来时间防呆：开始时间在未来 → 不代填',
          v3.w0Start === '', JSON.stringify(v3.w0Start));
        ok('未来时间防呆：missed 里写清原因（含「未来」与当前时间）',
          (rC.missed || []).some(function (m) { return /未来/.test(String(m.reason)); }),
          JSON.stringify((rC.missed || []).map(function (m) { return m.reason; })));
        ok('未来时间防呆：「至今」的结束时间照旧提醒手动勾',
          (rC.notice || []).some(function (n) { return /至今/.test(String(n)); }),
          JSON.stringify(rC.notice));
        winC.close();

        /* 场景 D（第四十二轮）：官网已保存的表单 —— 时间已经是对的，不再重复点面板。
           名称栏是检索组件（读不到文本），靠块内已保存的时间证据对号。 */
        const winD = nkDom();
        winD.document.querySelector('[data-t="w0Start"]').value = '2025-11';
        winD.document.querySelector('[data-t="w0End"]').value = '2026-01';
        return winD.fillComboFields({ fields: {}, sections: { work: [NK_WORKS[0]] } }).then(function (rD) {
          const v4 = nkVals(winD);
          ok('已保存表单：起止时间已经是对的 → 不再重复写（值原样保留）',
            v4.w0Start === '2025-11' && v4.w0End === '2026-01',
            JSON.stringify({ s: v4.w0Start, e: v4.w0End }));
          ok('已保存表单：时间证据把名称为空的块对到京东健康（notice 说明「已经是」）',
            (rD.notice || []).some(function (n) { return /已经是/.test(String(n)); }),
            JSON.stringify(rD.notice));
          winD.close();

          /* 场景 E（第四十三轮反转）：名称栏全空 + 块里也没存过时间 = 全新表单，
             没有任何身份证据 —— 块数与条数相等时按组内顺序配，名称和时间一起落位。
             （第四十二轮的一律拒配被用户实测打回：日期直接填不上。）
             真歧义（名称栏有内容但对不上）的拒配移到场景 E2。 */
          const winE = new JSDOM('<!DOCTYPE html><html><head><title>在线简历</title></head><body>' + nkWorkBlock('w0') + nkWorkBlock('w1') + '</body></html>',
            { url: 'https://www.nowcoder.com/profile', runScripts: 'outside-only' });
          winE.window.eval(src);
          mockMtdPicker(winE.window);
          return winE.window.fillComboFields({ fields: {}, sections: { work: NK_WORKS } }).then(function (rE) {
            const v5 = {};
            winE.window.document.querySelectorAll('[data-t]').forEach(function (el) { v5[el.dataset.t] = el.value; });
            ok('空白等数配对：全新表单两块两条 → 时间按顺序落位（京东健康 w0 / 深圳海关 w1）',
              v5.w0Start === '2025-11' && v5.w0End === '2026-01' && v5.w1Start === '2024-05' && v5.w1End === '2025-07',
              JSON.stringify(v5));
            ok('空白等数配对：职位名称也按同一配对落位（每块内部自洽）',
              v5.w0Role === '产品运营实习生' && v5.w1Role === '口腔科实习生',
              JSON.stringify({ r0: v5.w0Role, r1: v5.w1Role }));
            ok('空白等数配对：不再出「对不上号」的拒配提示',
              !(rE.notice || []).some(function (n) { return /对不上/.test(String(n)); }),
              JSON.stringify(rE.notice));
            winE.window.close();

            /* 场景 E2（第四十三轮）：名称栏「有内容」但和资料对不上 = 真歧义，
               仍然拒配 —— 宁可漏填不填错（保护 42 轮战果）。 */
            const winE2 = new JSDOM('<!DOCTYPE html><html><head><title>在线简历</title></head><body>' + nkWorkBlock('w0') + nkWorkBlock('w1') + '</body></html>',
              { url: 'https://www.nowcoder.com/profile', runScripts: 'outside-only' });
            winE2.window.eval(src);
            mockMtdPicker(winE2.window);
            winE2.window.document.querySelector('[data-t="w0Role"]').value = '某创业公司运营';
            winE2.window.document.querySelector('[data-t="w1Role"]').value = '另一家科技实习';
            return winE2.window.fillComboFields({ fields: {}, sections: { work: NK_WORKS } }).then(function (rE2) {
              const v5b = {};
              winE2.window.document.querySelectorAll('[data-t]').forEach(function (el) { v5b[el.dataset.t] = el.value; });
              ok('真歧义拒配：名称栏有内容但对不上 → 起止时间仍不代填',
                v5b.w0Start === '' && v5b.w1Start === '',
                JSON.stringify({ s0: v5b.w0Start, s1: v5b.w1Start }));
              ok('真歧义拒配：notice 说明「名称栏有内容但对不上」',
                (rE2.notice || []).some(function (n) { return /对不上/.test(String(n)); }),
                JSON.stringify(rE2.notice));
              winE2.window.close();

            /* 场景 F（第四十二轮）：名称栏读不到（检索组件），但块里已保存的时间能对上号
               → 按时间证据配对，DOM 顺序与载荷相反也不串。 */
            const winF = new JSDOM('<!DOCTYPE html><html><head><title>在线简历</title></head><body>' + nkWorkBlock('w0') + nkWorkBlock('w1') + '</body></html>',
              { url: 'https://www.nowcoder.com/profile', runScripts: 'outside-only' });
            winF.window.eval(src);
            mockMtdPicker(winF.window);
            /* w0 里留着深圳海关的旧开始时间、w1 里留着京东健康的旧开始时间（与载荷顺序相反） */
            winF.window.document.querySelector('[data-t="w0Start"]').value = '2024-05';
            winF.window.document.querySelector('[data-t="w1Start"]').value = '2025-11';
            return winF.window.fillComboFields({ fields: {}, sections: { work: NK_WORKS } }).then(function (rF) {
              const v6 = {};
              winF.window.document.querySelectorAll('[data-t]').forEach(function (el) { v6[el.dataset.t] = el.value; });
              ok('时间证据配对：w0 的旧开始时间对上深圳海关 → 结束时间补 2025-07（不串到京东健康）',
                v6.w0Start === '2024-05' && v6.w0End === '2025-07',
                JSON.stringify({ s: v6.w0Start, e: v6.w0End }));
              ok('时间证据配对：w1 对上京东健康 → 结束时间补 2026-01',
                v6.w1Start === '2025-11' && v6.w1End === '2026-01',
                JSON.stringify({ s: v6.w1Start, e: v6.w1End }));
              winF.window.close();

              /* 场景 H（第四十三轮）：全新页面没有经历段块 → autoAddSections 自动点
                 「添加工作经历」补出块，第二遍接着把名称和时间填进去（一次粘贴全搞定）。 */
              const winH = new JSDOM('<!DOCTYPE html><html><head><title>申请表</title></head><body>' +
                '<button id="addWork" type="button">+ 添加工作经历</button><div id="root"></div></body></html>',
                { url: 'https://careers.example.com/apply', runScripts: 'outside-only' });
              winH.window.eval(src);
              mockMtdPicker(winH.window);
              let hn = 0;
              winH.window.document.getElementById('addWork').addEventListener('click', function () {
                winH.window.document.getElementById('root').insertAdjacentHTML('beforeend', nkWorkBlock('hw' + (hn++)));
              });
              return winH.window.autoAddSections({ sections: { work: NK_WORKS } }).then(function (rH0) {
                ok('自动补段：按载荷需要点了 2 次「添加工作经历」，页面多出 2 个工作段块',
                  !!rH0.ok && rH0.added.work === 2 &&
                  !!winH.window.document.querySelector('[data-t="hw0Start"]') &&
                  !!winH.window.document.querySelector('[data-t="hw1Start"]'),
                  JSON.stringify(rH0));
                return winH.window.fillComboFields({ fields: {}, sections: { work: NK_WORKS } }).then(function (rH) {
                  const v7 = {};
                  winH.window.document.querySelectorAll('[data-t]').forEach(function (el) { v7[el.dataset.t] = el.value; });
                  ok('自动补段：补出的块照常按顺序填上时间（一次粘贴全搞定）',
                    v7.hw0Start === '2025-11' && v7.hw0End === '2026-01' && v7.hw1Start === '2024-05' && v7.hw1End === '2025-07',
                    JSON.stringify({ s0: v7.hw0Start, e0: v7.hw0End, s1: v7.hw1Start, e1: v7.hw1End }));
                  winH.window.close();
                  return null;
                }).then(function () {
                  /* 场景 I（第四十四轮）：适配规则 zhiyin.adapt.v1 —— 规则命中的栏精确落位，
                     标签认不出的栏也能填（自服务闭环：探测 → 任何 AI 生成规则 → 贴回扩展）。 */
                  const winI = new JSDOM('<!DOCTYPE html><html><head><title>申请表</title></head><body>' +
                    '<input id="weirdStart" data-t="weirdStart" placeholder="起止年月"></body></html>',
                    { url: 'https://careers.example.com/apply2', runScripts: 'outside-only' });
                  winI.window.eval(src);
                  return winI.window.fillComboFields({
                    fields: {},
                    sections: { projects: [{ name: 'ICB 免疫疗法多组学数据库构建', time: '2026.01-2026.08' }] },
                    adapt: { schema: 'zhiyin.adapt.v1', rules: [
                      { sel: '#weirdStart', get: 'sections.projects.0.time', part: 'start', kind: 'date' },
                      { sel: '#notExist', get: 'fields.email' }
                    ] }
                  }).then(function (rI) {
                    const wv = winI.window.document.getElementById('weirdStart').value;
                    ok('适配规则：选择器命中 + part:start 切出 2026.01 → 精确落位',
                      wv === '2026.01' && (rI.filled || []).some(function (f) { return /projects\.0\.time/.test(String(f.field)); }),
                      JSON.stringify({ v: wv, filled: rI.filled }));
                    ok('适配规则：找不到元素的规则如实报 notice，不误填别处',
                      (rI.notice || []).some(function (n) { return /找不到元素/.test(String(n)); }),
                      JSON.stringify(rI.notice));
                    winI.window.close();
                  });
                }).then(function () {
                  /* 场景 J（第四十四轮）：「点了没出块」绝不能连点 —— 旧版每个名额中途补点一次，
                     两个名额点 4 次，在扫描认不出新块的页面上堆出 4 段空白教育经历（用户实测）。
                     新版：三级回退逐级升级；本组彻底失败就放弃剩余名额并如实报 undetected。 */
                  const winJ = new JSDOM('<!DOCTYPE html><html><head><title>申请表</title></head><body>' +
                    '<button id="addEdu" type="button">添加教育经历</button><div id="root"></div></body></html>',
                    { url: 'https://careers.example.com/apply3', runScripts: 'outside-only' });
                  winJ.window.eval(src);
                  let clicks = 0;
                  winJ.window.document.getElementById('addEdu').addEventListener('click', function () { clicks++; });
                  return winJ.window.autoAddSections({ sections: { education: [{ school: '甲大学' }, { school: '乙大学' }] } }).then(function (rJ) {
                    ok('防连点：点了没出块 → 只尝试一轮（1 次点击），本组剩余名额全部放弃',
                      clicks === 1 && rJ.added.edu === 0 && (rJ.undetected || []).indexOf('edu') >= 0,
                      JSON.stringify({ clicks: clicks, r: rJ }));
                    winJ.window.close();
                  });
                });
              });
            });
          });
        });
      });
    });
  });
});
}

/* ============================================================
   收尾：前面的异步用例跑完才开始汇总（否则会在结果出来前就退出）
   ============================================================ */
function finishCollect() {
  out.push('');
  out.push('=== 结果 ===');
  out.push(pass + ' 项通过' + (fail ? '，' + fail + ' 项失败' : '，全部通过'));
  console.log(out.join('\n'));
  if (fail) process.exitCode = 1;
}

/* ---------- 11. 职位列表页采集（collectJobs） ---------- */
out.push('');
out.push('=== 11. 职位列表页采集（collectJobs） ===');
function runJobs(html, url) {
  const dom = new JSDOM(
    '<!DOCTYPE html><html><head><title>校园招聘</title></head><body>' + html + '</body></html>',
    { url: url || 'https://www.nowcoder.com/jobs', runScripts: 'outside-only' }
  );
  const win = dom.window;
  win.eval(src);
  const res = win.collectJobs({ url: win.location.href });
  win.close();
  return res;
}

/* 场景一：典型的职位列表页（类牛客卡片流） */
const jobPageA = [
  '<div class="job-list">',
  '<div class="job-card">',
  '<div class="company-name">小红书</div>',
  '<a href="/jobs/1001" class="job-title">数据分析师</a>',
  '<div class="job-meta">上海 · 本科及以上 · 18-30K</div>',
  '<div class="tags"><span>SQL</span><span>Python</span><span>Tableau</span></div>',
  '</div>',
  '<div class="job-card">',
  '<div class="company-name">米哈游</div>',
  '<a href="/jobs/1002" class="job-title">游戏策划</a>',
  '<div class="job-meta">上海 · 不限学历 · 1.5-2万</div>',
  '</div>',
  '<div class="job-card">',
  '<div class="company-name">宁德时代</div>',
  '<a href="/jobs/1003" class="job-title">材料研发工程师</a>',
  '<div class="job-meta">宁德 · 硕士及以上 · 20-36K·14薪</div>',
  '</div>',
  '</div>'
].join('');
const jA = runJobs(jobPageA);
ok('采集到 3 个职位', jA.count === 3, 'n=' + jA.count);
const jA1 = jA.items.filter(function (i) { return i.position === '数据分析师'; })[0];
ok('公司名取到', !!jA1 && jA1.company === '小红书', jA1 && jA1.company);
ok('城市识别到上海', !!jA1 && jA1.city === '上海', jA1 && jA1.city);
ok('学历识别到本科', !!jA1 && jA1.edu === '本科', jA1 && jA1.edu);
ok('薪资原文保留（18-30K）', !!jA1 && jA1.salaryRaw.indexOf('18-30K') >= 0, jA1 && jA1.salaryRaw);
ok('技能标签收进来', !!jA1 && jA1.skills.indexOf('SQL') >= 0 && jA1.skills.length >= 2, jA1 && jA1.skills.join(','));
ok('详情链接补成绝对地址', !!jA1 && jA1.url.indexOf('nowcoder.com/jobs/1001') >= 0, jA1 && jA1.url);
const jA2 = jA.items.filter(function (i) { return i.position === '游戏策划'; })[0];
ok('「1.5-2万」这类中文薪资也能取到原文', !!jA2 && jA2.salaryRaw.indexOf('1.5-2万') >= 0, jA2 && jA2.salaryRaw);
ok('学历不限识别为「不限」', !!jA2 && jA2.edu === '不限', jA2 && jA2.edu);
const jA3 = jA.items.filter(function (i) { return i.position === '材料研发工程师'; })[0];
ok('硕士及以上识别为硕士', !!jA3 && jA3.edu === '硕士', jA3 && jA3.edu);

/* 场景二：识别不到公司的职位被丢弃（不编造） */
const jB = runJobs('<a href="/x">算法工程师</a><div class="meta">北京</div>');
ok('识别不到公司的职位被丢弃', jB.count === 0, 'n=' + jB.count);

/* 场景三：投递记录页（带状态词）不会被误当成职位列表 */
const jC = runJobs([
  '<div class="item"><span class="company">字节跳动</span>',
  '<span class="job-title">算法工程师</span><span class="status">已投递</span></div>'
].join(''));
ok('投递记录页不产出职位（状态词防误判）', jC.count === 0, 'n=' + jC.count);

/* 场景四：只读性 */
const domJ = new JSDOM('<!DOCTYPE html><html><body>' + jobPageA + '</body></html>',
  { url: 'https://www.nowcoder.com/jobs', runScripts: 'outside-only' });
const jb = domJ.window.document.body.innerHTML;
domJ.window.eval(src);
domJ.window.collectJobs({ url: 'https://www.nowcoder.com/jobs' });
const ja = domJ.window.document.body.innerHTML;
ok('采集职位前后页面 DOM 完全一致', jb === ja);
domJ.window.close();

/* ---------- 12. 单公司官网采集（公司自建招聘站） ---------- */
/* 真实背景：字节跳动招聘官网（jobs.bytedance.com）这类站点，
   整页只有这一家的岗位，卡片里**没有公司名字段**；标题常带「- 团队」后缀、
   标题本身可能包在 <h3><span> 里；每条另有「城市 | 正式 | 部门 | 职位 ID」元信息行
   和「团队介绍：…」段落；左侧筛选栏里还散落「设计 / 运营 / 产品」等与职位同形的词。
   这一组专门守「整页采不到」这个线上问题。 */
out.push('');
out.push('=== 12. 单公司官网采集（collectJobs） ===');
const jobPageB = [
  '<nav><div>首页</div><div>所有职位</div><div>产品与技术</div><div>我们的文化</div><div>成长与回报</div></nav>',
  '<aside class="filter"><div>职位类别</div>',
  '<label><input type="checkbox">研发</label><label><input type="checkbox">运营</label>',
  '<label><input type="checkbox">产品</label><label><input type="checkbox">设计</label>',
  '<label><input type="checkbox">市场</label><label><input type="checkbox">游戏策划</label>',
  '</aside>',
  '<main><h1>开启新的工作（10000）</h1><div class="job-list">',
  '<div class="position-item">',
  '<h3 class="position-title"><span>财务BP（FP&amp;A方向）</span> - 芯片研发</h3>',
  '<div class="position-meta">北京 | 正式 | 职能 / 支持 | 职位 ID: A67442</div>',
  '<div class="position-desc">团队介绍：字节芯片研发团队目前工作主要集中在芯片设计环节，主要围绕字节自身业务展开芯片探索。</div>',
  '</div>',
  '<div class="position-item">',
  '<h3 class="position-title">资源调度与计算效率研发工程师/架构师 - AI算力基础设施</h3>',
  '<div class="position-meta">北京、杭州、上海 | 正式 | 研发 - 后端 | 职位 ID: A246060A</div>',
  '<div class="position-desc">团队介绍：字节跳动基础设施部门，负责全栈算力基础设施，从芯片服务器产研、到超大规模数据中心。</div>',
  '</div>',
  '<div class="position-item">',
  '<h3 class="position-title">UX设计负责人 - AI创新业务</h3>',
  '<div class="position-meta">北京 | 正式 | 设计 | 职位 ID: A79758</div>',
  '<div class="position-desc">团队介绍：字节跳动内部创新业务团队，专注研究新技术赛道相关领域产品，落地 AI 智能化创新。</div>',
  '</div>',
  '<div class="position-item">',
  '<h3 class="position-title">AI大模型应用能力评测专家（自动评测方向） - AI数据与安全</h3>',
  '<div class="position-meta">北京 | 正式 | 运营 | 职位 ID: A249359A</div>',
  '<div class="position-desc">团队介绍：负责大模型应用能力的自动化评测体系搭建。</div>',
  '</div>',
  '</div></main>'
].join('');
const jD = runJobs(jobPageB, 'https://jobs.bytedance.com/experienced/position');
ok('单公司官网：4 条职位全部采到（曾整页只出 1 条）', jD.count === 4, 'n=' + jD.count);
ok('单公司官网：公司名按域名兜底为「字节跳动」',
  jD.items.length === 4 && jD.items.every(function (i) { return i.company === '字节跳动'; }),
  JSON.stringify(jD.items.map(function (i) { return i.company; })));
ok('单公司官网：标题包在 <h3><span> 里也能取到（直接文本判定）',
  jD.items.some(function (i) { return i.position === '财务BP（FP&A方向）'; }),
  JSON.stringify(jD.items.map(function (i) { return i.position; })));
ok('单公司官网：长标题（含「专家」）不被长度截断',
  jD.items.some(function (i) { return i.position.indexOf('评测专家') >= 0; }),
  JSON.stringify(jD.items.map(function (i) { return i.position; })));
ok('单公司官网：元信息行（城市 | 正式 | 部门 | 职位ID）不会被当成标题',
  !jD.items.some(function (i) { return /职位\s*ID/i.test(i.position); }),
  JSON.stringify(jD.items.map(function (i) { return i.position; })));
ok('单公司官网：「团队介绍：…」段落不会被当成标题',
  !jD.items.some(function (i) { return i.position.indexOf('团队介绍') >= 0; }), '');
ok('单公司官网：职位 ID 被采到（回执对账用）',
  jD.items.length === 4 && jD.items.every(function (i) { return !!i.jobRef; }),
  JSON.stringify(jD.items.map(function (i) { return i.jobRef; })));
ok('单公司官网：左侧筛选词（设计/运营/产品）不被误采成职位',
  !jD.items.some(function (i) { return i.position === '设计' || i.position === '运营' || i.position === '产品'; }),
  JSON.stringify(jD.items.map(function (i) { return i.position; })));
ok('单公司官网：导航项「产品与技术」不被误采',
  !jD.items.some(function (i) { return i.position.indexOf('产品与技术') >= 0; }), '');
ok('单公司官网：城市从元信息行取到',
  jD.items.length === 4 && jD.items.every(function (i) { return i.city === '北京'; }),
  JSON.stringify(jD.items.map(function (i) { return i.city; })));

/* 反向场景：多公司平台绝不能被站点兜底覆盖掉真实公司名 */
const jE = runJobs([
  '<div class="job-card"><div class="company-name">小红书</div>',
  '<a class="job-title">数据分析师</a><div class="meta">上海 · 本科及以上 · 18-30K</div></div>'
].join(''), 'https://jobs.bytedance.com/experienced/position');
ok('卡片里有公司名时，站点兜底不覆盖真实公司名',
  jE.count === 1 && jE.items[0].company === '小红书',
  JSON.stringify(jE.items.map(function (i) { return i.company; })));

/* 反向场景：非官网域名（多公司平台）没有公司名时仍然丢弃，不兜底 */
const jF = runJobs('<a href="/x">算法工程师</a><div class="meta">北京 | 正式</div>', 'https://www.nowcoder.com/jobs');
ok('多公司平台无公司名时仍丢弃（不拿站点名充数）', jF.count === 0 && !jF.companyFallback, 'n=' + jF.count + ' fb=' + jF.companyFallback);

/* ---------- 12. 院校项目详情页采集（collectPrograms） ---------- */
out.push('');
out.push('=== 12. 院校项目详情页采集（collectPrograms） ===');
function runProgram(html, url, title) {
  const dom = new JSDOM(
    '<!DOCTYPE html><html><head><title>' + (title || 'Project') + '</title>' +
    '</head><body>' + html + '</body></html>',
    { url: url || 'https://gradschool.hku.hk/prospective', runScripts: 'outside-only' }
  );
  const win = dom.window;
  win.eval(src);
  const res = win.collectPrograms({ url: win.location.href });
  win.close();
  return res;
}

/* 场景 A：典型 PhD 项目页（h1 + 截止 + 资助 + 语言要求 + 介绍） */
const pA = runProgram(
  '<h1>Computer Science PhD</h1>' +
  '<p>The Department of Computer Science at HKU invites applications for the PhD programme.</p>' +
  '<ul><li>Deadline: 2026-12-15</li><li>Full funding / scholarship provided</li><li>TOEFL 80 / IELTS 6.5 required</li></ul>' +
  '<p>Research areas: artificial intelligence, machine learning, computer vision, NLP.</p>',
  'https://gradschool.hku.hk/prospective/cs-phd'
);
ok('HKU 项目页：识别 school=香港大学',
  pA.ok && pA.items[0].school === '香港大学', JSON.stringify(pA.items[0] || {}));
ok('HKU 项目页：识别 program 含 PhD',
  pA.ok && /PhD/i.test(pA.items[0].program), JSON.stringify(pA.items[0] || {}));
ok('HKU 项目页：识别 region=中国香港（域名兜底）',
  pA.ok && pA.items[0].region === '中国香港', pA.items[0].region);
ok('HKU 项目页：识别 deadline=2026-12-15',
  pA.ok && pA.items[0].deadline === '2026-12-15', pA.items[0].deadline);
ok('HKU 项目页：识别 fund 含 scholarship',
  pA.ok && /scholarship|funded/i.test(pA.items[0].fund), pA.items[0].fund);
ok('HKU 项目页：识别 toefl=80 / ielts=6.5',
  pA.ok && pA.items[0].toefl === 80 && pA.items[0].ielts === 6.5,
  't=' + pA.items[0].toefl + ' i=' + pA.items[0].ielts);
ok('HKU 项目页：识别 field 含 AI 关键词',
  pA.ok && /artificial|machine/i.test(pA.items[0].field), pA.items[0].field);
ok('HKU 项目页：applyUrl = pageUrl',
  pA.ok && pA.items[0].applyUrl === 'https://gradschool.hku.hk/prospective/cs-phd', pA.items[0].applyUrl);

/* 场景 B：MIT 项目页（不在兜底表 + title 不含 University → 与 collectJobs 同原则丢弃） */
const pB = runProgram(
  '<h2>MIT EECS PhD</h2>' +
  '<p>Application deadline December 15, 2026</p>' +
  '<p>Stipend / full funding available.</p>' +
  '<p>TOEFL 100 / IELTS 7.5</p>' +
  '<p>Computer vision, robotics research.</p>',
  'https://www.eecs.mit.edu/academics/graduate/phd',
  'MIT EECS PhD'
);
ok('MIT 项目页：不在兜底表 + title 无大学字样 → 整条丢弃（避免塞进「学校不明」污染院校池）',
  !pB.ok && pB.count === 0 && /校|school/i.test(pB.error || ''), JSON.stringify(pB));

/* 场景 C：中文项目页（"博士" 后缀 + "全额奖学金" 资助） */
const pC = runProgram(
  '<h1>计算机科学博士</h1>' +
  '<p>截止时间 2026-12-01</p>' +
  '<p>全额奖学金 + 助研津贴</p>' +
  '<p>托福 80 / 雅思 6.5</p>' +
  '<p>研究方向：多模态大模型、计算机视觉</p>',
  'https://www.cuhk.edu.hk/phd/cs'
);
ok('CUHK 中文页：识别 program 含「博士」',
  pC.ok && /博士/.test(pC.items[0].program), pC.items[0].program);
ok('CUHK 中文页：识别 fund 含全额奖学金',
  pC.ok && /全额|奖/.test(pC.items[0].fund), pC.items[0].fund);

/* 场景 D：识别不出校名 → 整条丢弃（与 collectJobs 同原则） */
const pD = runProgram(
  '<h1>PhD Programme</h1>' +
  '<p>Deadline 2026-12-01</p>' +
  '<p>Fully funded</p>',
  'https://random-blog.example.com/article'
);
ok('未识别到学校时整条丢弃（与 collectJobs 同原则）',
  !pD.ok && pD.count === 0 && /校|school|大学/i.test(pD.error || ''), JSON.stringify(pD));

/* 场景 E：识别不出项目名 → 整条丢弃 */
const pE = runProgram(
  '<h1>About our department</h1>' +
  '<p>General information about the school</p>',
  'https://gradschool.hku.hk/about'
);
ok('未识别到项目名时整条丢弃',
  !pE.ok && pE.count === 0 && /项目名|program/i.test(pE.error || ''), JSON.stringify(pE));

/* 场景 F：标题里有 "博士" 但 pageUrl 没在兜底表里 → 应被识别出（title 兜底） */
const pF = runProgram(
  '<h1>人工智能博士</h1>' +
  '<p>北京邮电大学招收人工智能博士</p>' +
  '<p>全额奖学金</p>',
  'https://www.bupt.edu.cn/phd'
);
ok('兜底表外的中国大陆校：title 抓「大学」字样',
  pF.ok && /大学/.test(pF.items[0].school || ''), pF.items[0].school);

/* 场景 G：program 名带破折号 "Computer Science DPhil" */
const pG = runProgram(
  '<h1>Computer Science DPhil</h1>' +
  '<p>Deadline: 2027-01-08</p>',
  'https://www.ox.ac.uk/admissions/graduate'
);
ok('牛津 DPhil 项目页：识别 program=DPhil',
  pG.ok && /DPhil/.test(pG.items[0].program), pG.items[0].program);

/* ---------- 13. 院校项目列表页采集（FindaPhD / 爱丁堡嵌入） ---------- */
out.push('');
out.push('=== 13. 院校项目列表页采集（FindaPhD / 爱丁堡嵌入） ===');

/* 场景 H：爱丁堡 study.ed.ac.uk 风格的列表页，3 张 FindaPhD 卡片 */
const pH = runProgram(
  '<div class="API_resultItem_Inner">' +
    '<div class="API_phdTitle col-xs-24"><a href="javascript:;" onclick="...">Molecular engineering of water treatment membranes</a></div>' +
    '<div class="API_schoolTitle col-xs-24"><a href="javascript:;">School of Engineering</a></div>' +
    '<div class="API_categoryDiv col-xs-24">' +
      '<span class="API_label">PhD Research Project</span>' +
      '<span class="API_label">Self Funded</span>' +
    '</div>' +
    '<div class="API_supervisors col-xs-24">' +
      '<a class="supervisorEmail">Dr S Romero-Vargas Castrillon</a>' +
    '</div>' +
    '<div class="API_appDeadline col-xs-24"><span class="API_appDeadline">Application Deadline: 02 March 2027</span></div>' +
    '<div id="PJ198430" class="API_fullDetails"><p>Reverse osmosis (RO) holds significant promise in alleviating global water scarcity.</p></div>' +
  '</div>' +
  '<div class="API_resultItem_Inner">' +
    '<div class="API_phdTitle col-xs-24"><a href="javascript:;">Tomographic Imaging of Dynamic Combustion Plumes</a></div>' +
    '<div class="API_schoolTitle col-xs-24"><a href="javascript:;">School of Engineering</a></div>' +
    '<div class="API_categoryDiv col-xs-24">' +
      '<span class="API_label">PhD Research Project</span>' +
      '<span class="API_label">Self Funded</span>' +
    '</div>' +
    '<div class="API_supervisors col-xs-24">' +
      '<a class="supervisorEmail">Dr N Polydorides</a>' +
      '<a class="supervisorEmail">Dr C Liu</a>' +
    '</div>' +
    '<div class="API_appDeadline col-xs-24"><span class="API_appDeadline">Application Deadline: 11 December 2026</span></div>' +
    '<div id="PJ198389" class="API_fullDetails"><p>Tomographic imaging of dynamic combustion plumes.</p></div>' +
  '</div>' +
  '<div class="API_resultItem_Inner">' +
    '<div class="API_phdTitle col-xs-24"><a href="javascript:;">Unsupervised Statistical Learning for In-Situ Anomaly Detection in LPBF</a></div>' +
    '<div class="API_schoolTitle col-xs-24"><a href="javascript:;">School of Engineering</a></div>' +
    '<div class="API_categoryDiv col-xs-24">' +
      '<span class="API_label">PhD Research Project</span>' +
      '<span class="API_label">Funded</span>' +
    '</div>' +
    '<div class="API_supervisors col-xs-24">' +
      '<a class="supervisorEmail">Dr K Essa</a>' +
    '</div>' +
    '<div class="API_appDeadline col-xs-24"><span class="API_appDeadline">Application Deadline: 15 January 2027</span></div>' +
    '<div id="PJ198401" class="API_fullDetails"><p>Laser powder bed fusion anomaly detection.</p></div>' +
  '</div>',
  'https://study.ed.ac.uk/postgraduate/applying/research-degrees/projects',
  'Advertised PhD research projects and other opportunities'
);
ok('爱丁堡列表页：识别到 3 个项目',
  pH.ok && pH.mode === 'list' && pH.count === 3,
  'mode=' + pH.mode + ' count=' + pH.count);
ok('爱丁堡列表页：校名兜底为爱丁堡大学（ed.ac.uk）',
  pH.ok && pH.items[0].school === '爱丁堡大学', pH.items[0] && pH.items[0].school);
ok('爱丁堡列表页：项目 1 截止日 2027-03-02（英文月份解析）',
  pH.ok && pH.items[0].deadline === '2027-03-02', pH.items[0] && pH.items[0].deadline);
ok('爱丁堡列表页：项目 1 资助=Self Funded',
  pH.ok && pH.items[0].fund === 'Self Funded', pH.items[0] && pH.items[0].fund);
ok('爱丁堡列表页：项目 2 截止日 2026-12-11',
  pH.ok && pH.items[1].deadline === '2026-12-11', pH.items[1] && pH.items[1].deadline);
ok('爱丁堡列表页：项目 2 两位导师用逗号拼接',
  pH.ok && /Dr N Polydorides.*Dr C Liu/.test(pH.items[1].note), pH.items[1] && pH.items[1].note);
ok('爱丁堡列表页：项目 3 资助=Funded',
  pH.ok && pH.items[2].fund === 'Funded', pH.items[2] && pH.items[2].fund);
ok('爱丁堡列表页：备注里带项目 ID（PJxxxxx）',
  pH.ok && /PJ198430/.test(pH.items[0].note), pH.items[0] && pH.items[0].note);
ok('爱丁堡列表页：applyUrl 落回 pageUrl（列表页无真实链接）',
  pH.ok && pH.items[0].applyUrl === 'https://study.ed.ac.uk/postgraduate/applying/research-degrees/projects', pH.items[0] && pH.items[0].applyUrl);

/* 场景 I：列表页里校名兜底失败 → 整页丢弃（与单页一致原则） */
const pI = runProgram(
  '<div class="API_resultItem_Inner">' +
    '<div class="API_phdTitle col-xs-24"><a href="javascript:;">Some PhD Project</a></div>' +
    '<div class="API_categoryDiv col-xs-24">' +
      '<span class="API_label">PhD Research Project</span>' +
    '</div>' +
    '<div class="API_appDeadline col-xs-24"><span class="API_appDeadline">Application Deadline: 01 June 2027</span></div>' +
  '</div>',
  'https://www.findaphd.com/phds/?Keywords=test',
  'FindAPhD'
);
ok('FindaPhD 直接访问：ed.ac.uk 不在域名 → 校名兜底为「菲」开头的英文校名（兜底成功或失败均可，不强制）',
  !pI.ok || /爱丁堡|FindAPhD|University/.test(pI.items[0].school || ''),
  JSON.stringify(pI.items[0] || {}));

/* 场景 J：列表页但卡片缺标题 → 单张丢，整页报错 */
const pJ = runProgram(
  '<div class="API_resultItem_Inner">' +
    '<div class="API_phdTitle col-xs-24"></div>' +
    '<div class="API_categoryDiv col-xs-24"><span class="API_label">PhD Research Project</span></div>' +
  '</div>' +
  '<div class="API_resultItem_Inner">' +
    '<div class="API_phdTitle col-xs-24"><a href="javascript:;">Real Project</a></div>' +
    '<div class="API_categoryDiv col-xs-24"><span class="API_label">PhD Research Project</span></div>' +
    '<div class="API_appDeadline col-xs-24"><span class="API_appDeadline">Application Deadline: 01 June 2027</span></div>' +
  '</div>',
  'https://study.ed.ac.uk/postgraduate/applying/research-degrees/projects',
  'Ed'
);
ok('列表页部分卡片缺标题：有标题的仍识别、空标题的丢弃',
  pJ.ok && pJ.items.length === 1 && /Real Project/.test(pJ.items[0].program),
  'count=' + pJ.count);

/* ---- 第二十轮：popup 辅助填写接受 v1/v2 载荷 + 结构化经历面板 ---- */
const popupSrc20 = require('fs').readFileSync(require('path').join(DIR, 'popup.js'), 'utf8');
ok('popup 辅助填写：schema 校验同时接受 v1 与 v2', /zhiyin\\.fill\\.v\[12\]/.test(popupSrc20));
ok('popup 辅助填写：v2 结构化经历有面板渲染（renderFillSections）', popupSrc20.indexOf('renderFillSections') >= 0);
ok('popup 辅助填写：粘贴前不再锁死 v1 报错文案', popupSrc20.indexOf('zhiyin.fill.v1 或 v2') >= 0);

/* ---- 第二十二轮：popup 要同时调两遍填充（同步字段 + 异步下拉），并接上探针 ---- */
const extractorSrc22 = require('fs').readFileSync(require('path').join(DIR, 'extractor.js'), 'utf8');
ok('popup：填充时第二遍调用 fillComboFields（检索型下拉 / 日期）',
  popupSrc20.indexOf('func: fillComboFields') >= 0);
ok('popup：第二遍失败不影响第一遍结果（包在 try 里）',
  /try \{[\s\S]{0,200}fillComboFields[\s\S]{0,400}\} catch \(e\) \{ c = null; \}/.test(popupSrc20));
ok('popup：第二遍填上的字段要从未命中名单里剔除',
  popupSrc20.indexOf('r.missed = (r.missed || []).filter(') >= 0);
ok('popup：接了「探测表单结构」按钮', popupSrc20.indexOf('probeCurrentPage') >= 0 && popupSrc20.indexOf('bindProbe') >= 0);
ok('popup：探针结果可复制（用户要把它发回来）', popupSrc20.indexOf('doCopyProbe') >= 0);
ok('extractor：导出 fillComboFields / probeForm（popup 靠全局函数注入）',
  extractorSrc22.indexOf('fillComboFields: fillComboFields') >= 0 && extractorSrc22.indexOf('probeForm: probeForm') >= 0);
ok('探针是只读的：函数体里没有赋值给任何 input / 派发事件',
  !/probeForm[\s\S]{0,4000}dispatchEvent/.test(extractorSrc22));
ok('探针 v2：报告 UI 库签名（一眼看出是不是适配过的那两套）',
  extractorSrc22.indexOf('uiKit') >= 0 && extractorSrc22.indexOf('mtd（自研）') >= 0);
ok('探针 v2：报告当前可见的浮层（把日期框点开再探一次，面板结构就在里面）',
  extractorSrc22.indexOf('panels: panels') >= 0 && extractorSrc22.indexOf('pointed') < 0);
ok('探针 v2：报告重复 id（label[for] 会抓错栏）',
  extractorSrc22.indexOf('dupIds') >= 0);

/* ---- 第二十三轮：按真实探针数据（美团 zhaopin.meituan.com 的 mtd-*）定下来的硬规矩 ---- */
ok('标签识别：up2/up3 一律不参与填充（它们常是段落标题，不是字段标签）',
  extractorSrc22.indexOf('function formLabel') >= 0 && !/add\(up\[2\]/.test(extractorSrc22) && !/add\(up\[3\]/.test(extractorSrc22));
ok('标签识别：向上标签只在「容器里只有本控件」时才认（否则就是区块标题）',
  extractorSrc22.indexOf('cnt <= 1') >= 0);
ok('段号按栏目分域计数（工作段和项目段都有「结束时间」，不分域会串段）',
  extractorSrc22.indexOf('SECT_KW') >= 0 && extractorSrc22.indexOf("var key = id + '|' + lb") >= 0 && extractorSrc22.indexOf('assignBlocks') >= 0);
ok('只读日期框不走「写 value」那条路（写了是假象，用户会以为填上了）',
  /inner\.readOnly[\s\S]{0,160}pickDateFromPanel/.test(extractorSrc22));
ok('敏感栏（证件 / 身份证 / 护照）有守卫，并且报 skipped 说清原因',
  extractorSrc22.indexOf('SENSITIVE') >= 0 && extractorSrc22.indexOf('敏感信息') >= 0);
ok('公司名不填进「部门名称」（部门 ≠ 公司，宁可漏填也不填错地方）',
  extractorSrc22.indexOf('/单位/, /company/i') >= 0 && extractorSrc22.indexOf('/单位/, /部门/') < 0);
ok('第一遍不再把只读 / 组合栏记成「没找到」（那是交给第二遍）',
  extractorSrc22.indexOf('function deferrable') >= 0);
ok('popup：汇报里说清本岗文案填到了哪一栏（custom.where）',
  popupSrc20.indexOf('r.custom.where') >= 0);
ok('popup：汇报里说清哪几类栏没动、为什么（skipped）',
  popupSrc20.indexOf('r.skipped') >= 0);
ok('popup：探针提示「先点开面板再探一次」',
  popupSrc20.indexOf('p.panels') >= 0 && popupSrc20.indexOf('点开') >= 0);
/* popup.js 里 $('#xxx') 引用的元素必须真的在 popup.html 里 —— 
   改界面时删了一个 id、JS 那边就静默不工作了，测试全绿也看不出来 */
(function () {
  const popupHtml = require('fs').readFileSync(require('path').join(DIR, 'popup.html'), 'utf8');
  const used = [];
  const reUse = /\$\('#([A-Za-z0-9_-]+)'\)/g;
  let m;
  while ((m = reUse.exec(popupSrc20))) { if (used.indexOf(m[1]) < 0) used.push(m[1]); }
  const defs = [];
  const reDef = /id="([A-Za-z0-9_-]+)"/g;
  while ((m = reDef.exec(popupHtml))) defs.push(m[1]);
  const missing = used.filter(function (i) { return defs.indexOf(i) < 0; });
  ok('popup：JS 引用的元素 id 都在 popup.html 里（界面上少一个 id 会静默失效）',
    used.length >= 20 && missing.length === 0,
    'used=' + used.length + ' missing=' + missing.join(','));
})();


/* 汇总不在这里打印：10.8 里的异步用例（检索型下拉要等选项渲染）还没跑完。
   统一由 finishCollect() 在异步链路末尾输出，见 10.8 节。 */


/* ---------- 10.10 注入语义（第二十四轮） ----------
   真机复现（Edge 153 + 真扩展，两步注入实测，夹具是**浏览器版**那张美团式表单）：
     ① 只 executeScript({ func: probeForm })        → result = null，**不抛错**
     ② 先 executeScript({ files: ['extractor.js'] })
        再 executeScript({ func: probeForm })        → ok:true / controlCount 43 / richCount 13
   （本节跑在 jsdom 的 MTD_HTML 夹具上，控件数与上面不同：41 / 1 —— 所以断言只比
    「注入后的结果 == 直接调用的结果」，不写死数字。）

   为什么 ① 会 null：func: 只序列化**那一个函数**的源码。probeForm 里调用的
   scanForm / labelMatch / timeRange 都是 extractor.js 的顶层函数，在页面里并不存在
   → ReferenceError。而 Chrome 把它吞成 result = null（不是 reject），
   所以 popup 只能报「没读到页面结构 / 什么都没填上」，查不出所以然。

   修法：每个注入入口之前，先 files: ['extractor.js'] 把整包注进同一个隔离世界。
   这一节把两件事都锁住：① 只带函数源码时确实拿不到结果；② 注了整包后必须成功。
   注意：这是"函数必须自足或整包已注入"的守卫 —— 谁把辅助函数挪进 popup.js，
   第 ② 条立刻红。 */
function injectWorld(html, withBundle) {
  const dom = new JSDOM('<!DOCTYPE html><html><head><title>美团招聘</title></head><body>' +
    html + '</body></html>',
    { url: 'https://zhaopin.meituan.com/web/delivery-confirm', runScripts: 'outside-only' });
  if (withBundle) dom.window.eval(src);
  return dom.window;
}
function callAsInjected(win, name, argsJson) {
  /* 完全按 chrome.scripting.executeScript({ func }) 的做法：只把函数源码送过去 */
  const fnSrc = String(win[name]);
  return win.eval('(' + fnSrc + ')(' + (argsJson || '') + ')');
}

function runInjectionSuite() {
  const argJson = JSON.stringify({ fields: { name: '杨明翰' }, sections: MT_SECTIONS });

  /* ① 复现线上那个 bug */
  const wNone = injectWorld(MTD_HTML, false);      /* 页面里没有我们的代码 */
  const wBundle = injectWorld(MTD_HTML, true);     /* 已经注过整包 */
  let thrown = null, resNone = null;
  try { resNone = callAsInjected(wNone, 'probeForm', null); } catch (e) { thrown = e; }
  ok('注入语义：只带函数源码、页面里没有整包 → probeForm 拿不到结果（线上就是这样静默失效的）',
    !!thrown || !(resNone && resNone.ok),
    'thrown=' + (thrown ? thrown.message : '无') + ' res=' + JSON.stringify(resNone));

  /* ② 先注整包 → 三个入口都必须真的能用 */
  let e1 = null, p1 = null;
  try { p1 = callAsInjected(wBundle, 'probeForm', null); } catch (e) { e1 = e; }
  /* 断言不写死数字：夹具改一处，这里就跟着变。用「注入后的结果 == 直接调用的结果」来锁 ——
     比硬编码 41 个控件更能说明问题，也不会因为夹具增删一栏就误报。 */
  ok('注入语义：先注整包 → probeForm 正常返回，结果与直接调用逐字节一致（popup 修的就是这一步）',
    !e1 && !!p1 && p1.ok === true && p1.controlCount > 0 &&
      JSON.stringify(p1) === JSON.stringify(wBundle.probeForm()),
    e1 ? 'thrown=' + e1.message : JSON.stringify(p1 && { ok: p1.ok, c: p1.controlCount, r: p1.richCount }));

  const wFill = injectWorld(MTD_HTML, true);
  let e2 = null, f1 = null;
  try { f1 = callAsInjected(wFill, 'fillFromPayload', argJson); } catch (e) { e2 = e; }
  ok('注入语义：先注整包 → fillFromPayload 正常返回（第一遍填充不再 ReferenceError）',
    !e2 && !!f1 && Array.isArray(f1.filled),
    e2 ? 'thrown=' + e2.message : JSON.stringify(f1 && { filled: (f1.filled || []).length }));

  const wCombo = injectWorld(MTD_HTML, true);
  return new Promise(function (resolve) {
    let p = null;
    try { p = callAsInjected(wCombo, 'fillComboFields', argJson); }
    catch (e) {
      ok('注入语义：先注整包 → fillComboFields 正常返回（第二遍异步链路）', false, 'thrown=' + e.message);
      return resolve();
    }
    Promise.resolve(p).then(function (c) {
      ok('注入语义：先注整包 → fillComboFields 正常返回（第二遍异步链路）',
        !!c && Array.isArray(c.filled), JSON.stringify(c && { filled: (c.filled || []).length }));
      resolve();
    }, function (err) {
      ok('注入语义：先注整包 → fillComboFields 正常返回（第二遍异步链路）', false, 'rejected=' + err.message);
      resolve();
    });
  });
}

/* popup.js：注入入口必须成对出现 —— 漏一次，那个功能在真机上就是静默全废 */
const popupSrc24 = require('fs').readFileSync(require('path').join(DIR, 'popup.js'), 'utf8');
ok('popup：有 injectBundle（把整包 extractor.js 注进页面的隔离世界）',
  /async function injectBundle\(tabId\)/.test(popupSrc24));
ok('popup：injectBundle 注的是「文件」而不是「函数」',
  popupSrc24.indexOf("files: ['extractor.js']") >= 0);
ok('popup：injectBundle 会验一次注入结果并报明原因（真机上失败是静默的：result = null）',
  popupSrc24.indexOf("typeof scanForm === 'function'") >= 0 &&
  popupSrc24.indexOf('扩展脚本没能注入这一页') >= 0);
(function () {
  const names = ['collectFromPage', 'collectReceipt', 'fillFromPayload', 'fillComboFields', 'autoAddSections', 'probeForm', 'collectJobs', 'collectPrograms'];
  const bad = [];
  names.forEach(function (n) {
    const i = popupSrc24.indexOf('func: ' + n + ',');
    if (i < 0) { bad.push(n + '(没有 func:)'); return; }
    const head = popupSrc24.slice(0, i);
    const fnStart = Math.max(head.lastIndexOf('\nasync function '), head.lastIndexOf('\nfunction '));
    if (popupSrc24.slice(fnStart, i).indexOf('await injectBundle(tab.id);') < 0) bad.push(n);
  });
  const calls = (popupSrc24.match(/await injectBundle\(tab\.id\);/g) || []).length;
  ok('popup：' + names.length + ' 个注入入口都在注入前先注了整包（漏一个 = 那个功能整条链路静默失效）',
    bad.length === 0 && calls === names.length,
    'bad=' + bad.join(',') + ' calls=' + calls);
})();
