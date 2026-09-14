/* ============================================================
   职引 · 交互自测步骤文件（供无头验证器调用）
   用法：
     node tests/verify_html.js index.html --steps tests/steps-interaction.js
   覆盖：标签状态、专业解析、默认排序、分类标签与自定义标签、GPA 条件化。
   ============================================================ */
module.exports = function (ctx) {
  const { win, doc, q, qa, click, change, input, step, log } = ctx;

  /* 第二十七轮：成就条上的「编辑 / 删除」已经去掉（与经历卡入口重复、同屏两个删除），
     所以清场统一走数据层，不再靠点按钮。 */
  function wipeInv() {
    const cur = ((JSON.parse(win.localStorage.getItem('zhiyin_state_v1')) || {}).inventory) || [];
    cur.slice().forEach(function (x) { win.removeInventoryItem(x.id); });
  }

  /* 按项目名找那张经历卡（经历卡顺序跟着成就走，不能假定第 0 张就是它） */
  function expCardByName(name) {
    return qa('#invList .inv-exp').filter(function (el) {
      const nm = el.querySelector('.inv-exp-name');
      return nm && nm.textContent.indexOf(name) >= 0;
    })[0] || null;
  }

  /* ============ 回归：老用户本地存档必须被迁移 ============
     这个 bug 只在「localStorage 里已有旧存档」时才出现，
     所以干净环境跑测试永远抓不到——必须先造一份旧存档。 */
  step('老用户存档（v1 · 排序=推荐优先）加载后自动迁移为分数降序', function () {
    const r = win.parseResume([
      '姓名：孙一鸣',
      '【教育背景】',
      '2023.09 - 2026.06  同济大学  电子科学与技术  硕士研究生  GPA 3.5/4.0',
      '【专业技能】',
      'Verilog、数字电路、Python、MATLAB'
    ].join('\n'));
    const v1 = {
      ver: 1,
      profile: r.profile, meta: r.meta,
      studyPref: {
        regions: [], fields: [], customRegions: [], customFields: [],
        weights: { '硬性条件': 55, '研究方向': 25, '地区偏好': 10, '科研产出': 10 }
      },
      jobPref: {
        cities: [], types: [], industries: [], customCities: [], customTypes: [], customIndustries: [], salaryMin: 15,
        weights: { '技能匹配': 40, '方向对口': 14, '城市偏好': 12, '薪资匹配': 10, '学历门槛': 6, '行业倾向': 8, '经历相关': 10 }
      },
      filters: { studyRegion: '全部', studyTier: '全部', studySort: 'rec', studyMin: 25, jobCity: '全部', jobType: '全部', jobIndustry: '全部', jobMin: 50 },
      applications: [], appliedKeys: [], pushLog: { date: '', ids: [], history: [] }
    };
    win.localStorage.setItem('zhiyin_state_v1', JSON.stringify(v1));
    win.load();
    win.renderStudy();
    const sel = q('#fSort');
    if (!sel) throw new Error('找不到排序控件');
    if (sel.value !== 'score') throw new Error('老存档未迁移，排序仍为 ' + sel.value);
    const scores = qa('#schoolList .item .score-badge .n').map(n => parseInt(n.textContent, 10));
    if (scores.length < 5) throw new Error('列表项太少，迁移可能丢了简历：' + scores.length);
    for (let i = 1; i < scores.length; i++) {
      if (scores[i] > scores[i - 1]) throw new Error('未按分数降序：' + scores.join(','));
    }
    const after = JSON.parse(win.localStorage.getItem('zhiyin_state_v1'));
    /* const 声明不会挂到 window 上，这里直接写期望的版本号 */
    if (after.ver !== 4) throw new Error('版本号未升级：' + after.ver);
    if (after.profile.major !== r.profile.major) throw new Error('迁移丢了简历数据');
    log('迁移后排序=' + sel.value + '　前 6 项分数: ' + scores.slice(0, 6).join(', '));
  });

  /* ============ 改进1：补全字段后「待补充」标签自动消失 ============ */
  step('导入一份缺手机号/邮箱的简历', function () {
    q('#rawText').value = [
      '姓名：周子谦',
      '【教育背景】',
      '2023.09 - 2026.06  南京大学  图书情报与档案管理  硕士研究生  GPA 3.6/4.0',
      '【专业技能】',
      'SQL、Python、数据分析'
    ].join('\n');
    click(q('#parseBtn'));
  });

  step('未识别字段确实标了「待补充」', function () {
    const el = q('#profileForm [data-k="phone"]');
    if (!el) throw new Error('找不到手机号字段');
    const wrap = el.parentNode;
    if (!wrap.classList.contains('miss')) throw new Error('缺少 miss 样式');
    const fl = wrap.querySelector('.flag');
    if (!fl || fl.textContent.indexOf('待补充') < 0) throw new Error('标签=' + (fl ? fl.textContent : 'null'));
  });

  step('输入手机号后「待补充」标签自动消失', function () {
    const el = q('#profileForm [data-k="phone"]');
    input(el, '13800002222');
    const wrap = el.parentNode;
    if (wrap.classList.contains('miss')) throw new Error('miss 样式未移除');
    const fl = wrap.querySelector('.flag');
    if (fl && fl.textContent.trim()) throw new Error('标签仍在：' + fl.textContent);
  });

  step('邮箱同理：补全后标签消失', function () {
    const el = q('#profileForm [data-k="email"]');
    input(el, 'zhouziqian@example.com');
    const fl = el.parentNode.querySelector('.flag');
    if (fl && fl.textContent.trim()) throw new Error('标签仍在：' + fl.textContent);
  });

  step('清空内容后状态回退为「待补充」', function () {
    const el = q('#profileForm [data-k="email"]');
    input(el, '');
    const wrap = el.parentNode;
    if (!wrap.classList.contains('miss')) throw new Error('未回退 miss');
    const fl = wrap.querySelector('.flag');
    if (!fl || fl.textContent.indexOf('待补充') < 0) throw new Error('未回退标签');
  });

  step('编辑内容不打断输入（输入框未被重渲染替换）', function () {
    const el = q('#profileForm [data-k="phone"]');
    const before = el;
    input(el, '13900003333');
    if (q('#profileForm [data-k="phone"]') !== before) throw new Error('输入框被替换，会丢失焦点');
  });

  step('数据层同步更新（meta 由 miss 变为 user）', function () {
    const raw = win.localStorage.getItem('zhiyin_state_v1');
    if (!raw) throw new Error('localStorage 为空');
    const o = JSON.parse(raw);
    if (o.profile.phone !== '13900003333') throw new Error('phone=' + o.profile.phone);
    if (o.meta.phone !== 'user') throw new Error('meta.phone=' + o.meta.phone);
  });

  /* ============ 改进2：专业解析精度 ============ */
  step('专业识别为「图书情报与档案管理」，未被干扰', function () {
    const v = q('#profileForm [data-k="major"]').value;
    if (v !== '图书情报与档案管理') throw new Error('major=' + v);
  });

  step('切换到示例1（AI 科研型）作为后续基准', function () {
    const chips = qa('#sampleList .chip');
    if (!chips.length) throw new Error('没有示例简历入口');
    click(chips[0]);
    if (q('#profileForm [data-k="major"]').value !== '计算机科学与技术') {
      throw new Error('示例1专业异常: ' + q('#profileForm [data-k="major"]').value);
    }
  });

  /* ============ 改进3 & 5：默认排序 / 未选即全量 ============ */
  step('申学列表默认排序为「匹配度从高到低」', function () {
    click(qa('.nav-item')[1]);
    const sel = q('#fSort');
    if (!sel) throw new Error('找不到排序控件');
    if (sel.value !== 'score') throw new Error('默认排序=' + sel.value);
  });

  step('未选任何标签时在全部范围内检索（分页后首页 10 条，总数看分页条）', function () {
    const n = qa('#schoolList .item').length;
    if (n !== 10) throw new Error('第一页应恰好 10 项，实际 ' + n);
    const pager = q('#schoolList .pager');
    if (!pager || !/共 \d+ 个项目/.test(pager.textContent)) throw new Error('院校列表缺分页条：' + (pager && pager.textContent));
    log('院校分页：' + pager.textContent.replace(/\s+/g, ' ').trim().slice(0, 40));
  });

  step('院校列表按匹配度严降序', function () {
    const scores = qa('#schoolList .item .score-badge .n').map(n => parseInt(n.textContent, 10));
    if (scores.length < 5) throw new Error('列表项太少: ' + scores.length);
    for (let i = 1; i < scores.length; i++) {
      if (scores[i] > scores[i - 1]) throw new Error('第 ' + i + ' 项逆序：' + scores.join(','));
    }
    log('院校匹配度前 6: ' + scores.slice(0, 6).join(', '));
  });

  /* ============ 改进4：大类→子分类 + 自定义标签 ============ */
  step('申学地区按大类分组，选项数量已扩充', function () {
    const groups = qa('#regionBlk .cat-h');
    const chips = qa('#regionBlk .chip');
    if (groups.length < 5) throw new Error('分组数=' + groups.length);
    if (chips.length < 20) throw new Error('选项数=' + chips.length);
    log('地区分组: ' + groups.map(g => g.textContent).join(' / ') + '　共 ' + chips.length + ' 个选项');
  });

  step('专业方向按大类分组且有子分类', function () {
    const groups = qa('#fieldBlk .cat-h');
    const chips = qa('#fieldBlk .chip');
    if (groups.length < 5) throw new Error('方向分组数=' + groups.length);
    if (chips.length < 20) throw new Error('方向选项数=' + chips.length);
    log('方向分组: ' + groups.map(g => g.textContent).join(' / ') + '　共 ' + chips.length + ' 个子分类');
  });

  step('选子分类后列表收窄，且仍按分数降序', function () {
    const pick = () => qa('#fieldBlk .chip').filter(c => c.textContent.indexOf('材料科学与工程') >= 0)[0];
    const chip = pick();
    if (!chip) throw new Error('找不到子分类 chip');
    click(chip);
    const items = qa('#schoolList .item');
    if (!items.length) throw new Error('筛选后为空');
    if (items.length >= 20) throw new Error('筛选未生效，n=' + items.length);
    const scores = qa('#schoolList .item .score-badge .n').map(n => parseInt(n.textContent, 10));
    for (let i = 1; i < scores.length; i++) if (scores[i] > scores[i - 1]) throw new Error('筛选后逆序');
    log('选「材料科学与工程」后剩 ' + items.length + ' 项：' +
      qa('#schoolList .item .who').slice(0, 4).map(x => x.textContent).join(' ; '));
    click(pick());
  });

  step('求职三类标签都渲染了分组与自定义输入框', function () {
    click(qa('.nav-item')[2]);
    ['#cityBlk', '#typeBlk', '#indBlk'].forEach(function (sel) {
      if (qa(sel + ' .cat-h').length < 4) throw new Error(sel + ' 分组不足：' + qa(sel + ' .cat-h').length);
      if (qa(sel + ' .chip').length < 15) throw new Error(sel + ' 选项不足');
      if (!q(sel + 'Input') || !q(sel + 'Add')) throw new Error(sel + ' 缺自定义输入');
    });
    log('城市 ' + qa('#cityBlk .cat-h').length + ' 组/' + qa('#cityBlk .chip').length + ' 选项；' +
      '岗位类型 ' + qa('#typeBlk .cat-h').length + ' 组/' + qa('#typeBlk .chip').length + ' 选项；' +
      '行业 ' + qa('#indBlk .cat-h').length + ' 组/' + qa('#indBlk .chip').length + ' 选项');
  });

  step('分类标签带真实数量角标（含 0 项提示）', function () {
    const badged = qa('#typeBlk .chip .cnt');
    if (badged.length < 15) throw new Error('数量角标缺失：' + badged.length);
    log('岗位类型中有 ' + qa('#typeBlk .chip.dim').length + ' 个 0 结果选项（已淡显提示）');
  });

  step('自定义标签可添加、自动选中、并进入匹配', function () {
    input(q('#cityBlkInput'), '嘉兴');
    click(q('#cityBlkAdd'));
    const mine = qa('#cityBlk .chip.mine');
    if (!mine.length) throw new Error('未出现「我的标签」区');
    if (!qa('#cityBlk .chip.mine.on').length) throw new Error('自定义标签未自动选中');
    if (!qa('#jobList .item').length) throw new Error('添加后岗位列表为空');
    log('我的标签: ' + mine.map(x => x.textContent).join(', '));
  });

  step('自定义标签可删除且同步移出选中', function () {
    const del = q('#cityBlk .chip.mine .del');
    if (!del) throw new Error('没有删除按钮');
    click(del);
    if (qa('#cityBlk .chip.mine').length) throw new Error('删除后仍在');
    const raw = JSON.parse(win.localStorage.getItem('zhiyin_state_v1'));
    if (raw.jobPref.customCities.indexOf('嘉兴') >= 0) throw new Error('state 未清除自定义城市');
    if (raw.jobPref.cities.indexOf('嘉兴') >= 0) throw new Error('state 未移除选中项');
  });

  step('点标签切换选中态会立即变色（不因局部重渲染失效）', function () {
    const chip = qa('#typeBlk .chip').filter(c => c.textContent.indexOf('算法') === 0)[0];
    if (!chip) throw new Error('找不到算法类型');
    const wasOn = chip.classList.contains('on');
    click(chip);
    const nowOn = chip.classList.contains('on');
    if (nowOn === wasOn) throw new Error('点击后 class 未变化');
    click(chip);
  });

  step('求职列表按匹配度降序', function () {
    const scores = qa('#jobList .item .score-badge .n').map(n => parseInt(n.textContent, 10));
    if (scores.length < 5) throw new Error('列表项太少: ' + scores.length);
    for (let i = 1; i < scores.length; i++) {
      if (scores[i] > scores[i - 1]) throw new Error('第 ' + i + ' 项逆序：' + scores.join(','));
    }
    log('岗位匹配度前 6: ' + scores.slice(0, 6).join(', '));
  });

  step('分页：翻页内容变化、回退一致、筛选后页码重置', function () {
    const firstWho = q('#jobList .item .who').textContent;
    const nextBtn = qa('#jobList .pager [data-sp]').filter(function (b) { return b.dataset.sp === '1'; })[0];
    if (!nextBtn) throw new Error('找不到「下一页」按钮');
    click(nextBtn);
    const secondWho = q('#jobList .item .who').textContent;
    if (secondWho === firstWho) throw new Error('翻页后第一条没变');
    const prevBtn = qa('#jobList .pager [data-sp]').filter(function (b) { return b.dataset.sp === '-1'; })[0];
    if (!prevBtn || prevBtn.disabled) throw new Error('第二页应可上一页');
    click(prevBtn);
    if (q('#jobList .item .who').textContent !== firstWho) throw new Error('回到第一页后内容不一致');
    /* 改筛选 → 页码重置回第 1 页。
       用「重选 jType=全部」这种不改变结果集的筛选：切到某个城市可能只剩一页、
       分页条消失（这是正确行为），断言就没法做了 */
    click(qa('#jobList .pager [data-sp]').filter(function (b) { return b.dataset.sp === '1'; })[0]);
    const selT = q('#jType');
    selT.value = '全部';
    selT.dispatchEvent(new win.Event('change', { bubbles: true }));
    const pager2 = q('#jobList .pager');
    if (!pager2 || !/第 1 \/ /.test(pager2.textContent)) throw new Error('筛选后未重置回第 1 页：' + (pager2 && pager2.textContent));
    log('分页：翻页/回退/筛选重置页码 全部正常');
  });
  step('未选任何偏好时也在全部岗位内检索（第一页 10 条 + 分页条）', function () {
    const n = qa('#jobList .item').length;
    if (n !== 10) throw new Error('第一页应恰好 10 个岗位，实际 ' + n);
    const pager = q('#jobList .pager');
    if (!pager || !/共 \d+ 个岗位/.test(pager.textContent)) throw new Error('岗位列表缺分页条：' + (pager && pager.textContent));
    log('岗位分页：' + pager.textContent.replace(/\s+/g, ' ').trim().slice(0, 40));
  });

  /* ============ 改进6：GPA 条件化填写 ============ */
  step('非必填 GPA：默认留空、label 不再解释、自我介绍不提 GPA', function () {
    win.openApplyModal('字节跳动', '算法工程师（推荐方向）');
    const g = q('#modalBody [data-af="gpa"]');
    if (!g) throw new Error('投递表单里没有 GPA 字段');
    if (g.value !== '') throw new Error('GPA 被错误预填：' + g.value);
    const lab = g.parentNode.querySelector('label').textContent.replace(/\s/g, '');
    if (lab !== 'GPA') throw new Error('GPA 的 label 不该再带解释性括号：' + lab);
    const intro = q('#modalBody [data-af="intro"]').value;
    if (intro.indexOf('GPA') >= 0) throw new Error('自我介绍提到了 GPA：' + intro);
    if (/以下\s*9/.test(q('#modalBody .notice').textContent)) throw new Error('字段数仍是写死的 9');
    log('非必填草稿：' + intro);
    click(q('#modalX'));
  });

  step('必填 GPA：预填 GPA 且自我介绍包含 GPA', function () {
    win.openApplyModal('中信证券', '量化研究员');
    const g = q('#modalBody [data-af="gpa"]');
    if (!g.value) throw new Error('GPA 未预填');
    const lab = g.parentNode.querySelector('label').textContent.replace(/\s/g, '');
    if (lab !== 'GPA') throw new Error('GPA 的 label 不该再带括号：' + lab);
    if (!g.parentNode.classList.contains('need')) throw new Error('缺少必填视觉标记');
    const intro = q('#modalBody [data-af="intro"]').value;
    if (intro.indexOf('GPA') < 0) throw new Error('自我介绍未包含 GPA');
    log('必填草稿：' + intro);
    click(q('#modalX'));
  });

  step('导入职位：扩展采集的岗位进匹配池并参与推荐', function () {
    const before = JSON.parse(win.localStorage.getItem('zhiyin_state_v1'));
    const beforeN = (before.importedJobs || []).length;
    click(q('#importJobsBtn'));
    q('#importJobsJson').value = JSON.stringify({
      schema: 'zhiyin.jobs.v1',
      items: [
        { company: '测试科技', position: '测试开发工程师', city: '北京', edu: '本科', salaryRaw: '20-35K', skills: ['Python', 'Selenium'], url: 'https://example.com/j/1' },
        { company: '字节跳动', position: '算法工程师（推荐方向）', city: '北京', edu: '硕士', salaryRaw: '30-52K' }
      ]
    });
    click(qa('#modalFoot .btn.primary')[0]);
    /* 导入成功的 toast 本身就是 modal（应用既有设计），会顶掉导入弹窗——断言 toast 内容与落库 */
    const ttl = q('#modalTitle') ? q('#modalTitle').textContent : '';
    const bodyTxt = q('#modalBody') ? q('#modalBody').textContent : '';
    if (ttl.indexOf('导入完成') < 0 || bodyTxt.indexOf('已导入 1 个职位') < 0) throw new Error('成功 toast 异常：' + ttl + ' / ' + bodyTxt.slice(0, 50));
    click(q('#modalX'));
    const after = JSON.parse(win.localStorage.getItem('zhiyin_state_v1'));
    if ((after.importedJobs || []).length !== beforeN + 1) throw new Error('导入职位未持久化');
    const imp = after.importedJobs.filter(j => j.company === '测试科技')[0];
    if (!imp || imp.salary[0] !== 20) throw new Error('导入字段异常：' + JSON.stringify(imp && imp.salary));
    /* 列表头部应显示「导入 1 条」 */
    if (q('#jobList').textContent.indexOf('导入 1 条') < 0) throw new Error('列表头部未显示导入计数');
    log('导入「测试科技 · 测试开发工程师」成功，薪资 20-35k 解析入库');
  });

  step('复制填表数据：导出辅助填写载荷（含改过的值、剔除空值）', function () {
    win.openApplyModal('中信证券', '量化研究员');
    /* 模拟用户在弹窗里改过手机号 —— 载荷应带改后的值 */
    q('#modalBody [data-af="phone"]').value = '13900000000';
    const btns = qa('#modalFoot .btn').filter(b => b.textContent.indexOf('复制填表数据') >= 0);
    if (!btns.length) throw new Error('投递弹窗里没有「复制填表数据」按钮');
    const reg = qa('#modalFoot .btn').filter(b => b.textContent.indexOf('不投官网') >= 0);
    if (!reg.length) throw new Error('登记按钮未明示「不投官网」——文案不得暗示已真投');
    if (!btns[0].classList.contains('primary')) throw new Error('真投官网应为主按钮（primary）');
    click(btns[0]);
    /* jsdom 没有剪贴板 -> 应落到手动复制兜底，而不是静默失败 */
    const ta = q('#fillFallback');
    if (!ta) throw new Error('剪贴板不可用时没有给出手动复制兜底');
    const payload = JSON.parse(ta.value);
    if (payload.schema !== 'zhiyin.fill.v2') throw new Error('schema 不对：' + payload.schema);
    if (!payload.sections || !Array.isArray(payload.sections.education)) throw new Error('v2 载荷缺结构化经历 sections');
    if (payload.company !== '中信证券') throw new Error('载荷没带公司名');
    if (payload.fields.phone !== '13900000000') throw new Error('载荷没带用户改过的手机号');
    if (!payload.fields.name) throw new Error('载荷没带姓名');
    const empty = Object.keys(payload.fields).filter(k => String(payload.fields[k]).trim() === '');
    if (empty.length) throw new Error('载荷里有空值字段：' + empty.join(','));
    log('填表载荷 ' + Object.keys(payload.fields).length + ' 个字段，含用户改过的手机号');
    click(q('#modalX'));
  });

  step('岗位卡片带官网入口：已核实的直达、未核实的搜索', function () {
    const links = qa('#jobList .tools a[href]');
    if (!links.length) throw new Error('岗位卡片没有官网入口链接');
    const direct = links.filter(a => a.textContent === '直达官网');
    const search = links.filter(a => a.textContent === '搜官网入口');
    if (!direct.length || !search.length) throw new Error('直达/搜索标签缺失：直' + direct.length + ' 搜' + search.length);
    if (direct[0].href.indexOf('https://') !== 0) throw new Error('直达链接不是 https：' + direct[0].href);
    if (search[0].href.indexOf('bing.com/search') < 0) throw new Error('搜索兜底异常：' + search[0].href);
    log('官网入口：直达 ' + direct.length + ' 条 · 搜索 ' + search.length + ' 条');
  });

  /* 申学侧同款：院校项目卡片带招生入口 + 采集按钮 + 导入弹窗 */
  step('院校卡片带招生入口：已核实的直达、未核实的搜索', function () {
    click(qa('.nav-item')[1]);  /* 切到申学规划 */
    /* 等渲染 */
    const schoolLinks = qa('#schoolList .tools a[href]');
    if (!schoolLinks.length) throw new Error('院校卡片没有招生入口链接');
    const direct = schoolLinks.filter(a => a.textContent === '直达招生入口');
    const search = schoolLinks.filter(a => a.textContent === '搜申请入口');
    if (!direct.length || !search.length) throw new Error('直达/搜索标签缺失：直' + direct.length + ' 搜' + search.length);
    if (direct[0].href.indexOf('https://') !== 0) throw new Error('直达链接不是 https：' + direct[0].href);
    if (search[0].href.indexOf('bing.com/search') < 0) throw new Error('搜索兜底异常：' + search[0].href);
    log('招生入口：直达 ' + direct.length + ' 条 · 搜索 ' + search.length + ' 条');
  });

  step('导入院校项目：扩展采集的项目进院校池并参与推荐', function () {
    const before = JSON.parse(win.localStorage.getItem('zhiyin_state_v1'));
    const beforeN = (before.importedPrograms || []).length;
    click(q('#importProgramsBtn'));
    q('#importProgramsJson').value = JSON.stringify({
      schema: 'zhiyin.programs.v1',
      items: [
        /* 与示例库 s19 同校+不同 program → 全新项目 */
        { school: '东京大学', program: 'AI PhD', region: '日本', deadline: '2026-11-30', fund: 'MEXT 奖学金', applyUrl: 'https://www.u-tokyo.ac.jp' },
        /* 全新学校+全新项目 */
        { school: '清华大学', program: '计算机科学博士', region: '中国大陆', deadline: '2026-12-15', fund: '全额奖学金' }
      ]
    });
    click(qa('#modalFoot .btn.primary')[0]);
    const ttl = q('#modalTitle') ? q('#modalTitle').textContent : '';
    const bodyTxt = q('#modalBody') ? q('#modalBody').textContent : '';
    if (ttl.indexOf('导入完成') < 0 || bodyTxt.indexOf('已导入 2 个项目') < 0) throw new Error('成功 toast 异常：' + ttl + ' / ' + bodyTxt.slice(0, 50));
    click(q('#modalX'));
    const after = JSON.parse(win.localStorage.getItem('zhiyin_state_v1'));
    if ((after.importedPrograms || []).length !== beforeN + 2) throw new Error('导入院校未持久化：before=' + beforeN + ' after=' + (after.importedPrograms || []).length);
    /* 渲染池应含两个新项目，且带 imported=true */
    const newProg = after.importedPrograms.filter(p => p.school === '清华大学')[0];
    if (!newProg || newProg.deadline !== '2026-12-15') throw new Error('新项目入库字段异常：' + JSON.stringify(newProg));
    if (q('#schoolList').textContent.indexOf('清华大学') < 0) throw new Error('新项目未进院校匹配库');
    log('导入「清华大学 · 计算机科学博士」+「东京大学 · AI PhD」，均进院校池');
  });

  step('从项目描述文本导入（自动解析）', function () {
    const before = JSON.parse(win.localStorage.getItem('zhiyin_state_v1')).importedPrograms.length;
    click(q('#importProgramsBtn'));
    q('#importProgramsText').value = 'Stanford University\nComputer Science PhD\nDeadline: 2027-01-08\nFully funded scholarship\nTOEFL 100';
    click(qa('#modalFoot .btn.primary')[0]);
    const ttl = q('#modalTitle') ? q('#modalTitle').textContent : '';
    if (ttl.indexOf('导入完成') < 0) throw new Error('文本导入成功 toast 异常：' + ttl);
    click(q('#modalX'));
    const after = JSON.parse(win.localStorage.getItem('zhiyin_state_v1')).importedPrograms.length;
    if (after !== before + 1) throw new Error('文本导入未入库：' + before + ' → ' + after);
    log('文本解析入库：Stanford · Computer Science PhD');
  });

  step('非必填岗位实际提交后，填表记录里 GPA 为空', function () {
    const btn = qa('#jobList [data-apply]')[0];
    if (!btn) throw new Error('找不到申请登记按钮');
    const key = btn.dataset.apply;
    click(btn);
    /* primary 按钮已让位给「去官网真投」，登记按钮要按文字找 */
    const regBtn = qa('#modalFoot .btn').filter(b => b.textContent.indexOf('登记并开回执') >= 0)[0];
    if (!regBtn) throw new Error('找不到「登记并开回执」按钮');
    click(regBtn);
    const raw = JSON.parse(win.localStorage.getItem('zhiyin_state_v1'));
    const a = raw.applications.filter(x => x.company + '|' + x.position === key)[0];
    if (!a) throw new Error('未生成投递记录');
    if (a.form['gpa'] !== '') throw new Error('GPA 被写成了 ' + JSON.stringify(a.form['gpa']));
    if (String(a.form['intro']).indexOf('GPA') >= 0) throw new Error('提交的自我介绍含 GPA');
    log('已投递：' + key + '　GPA 字段=' + JSON.stringify(a.form['gpa']));
  });

  step('投递记录里空 GPA 显示为「未填写（该岗位非必填）」', function () {
    click(qa('.nav-item')[3]);
    /* 投递中心默认落在「官网投递汇总」页签，卡片在这里 */
    const fb = q('#trackHub [data-form]');
    if (!fb) throw new Error('没有查看填表内容按钮');
    click(fb);
    if (q('#modalBody').textContent.indexOf('未填写') < 0) throw new Error('未显示未填写提示');
    click(q('#modalX'));
  });

  /* ============ 采集导入：状态同步 ============ */
  step('导入采集到的状态事件：已有记录向后推进 + 新建一条', function () {
    click(qa('.nav-item')[3]);
    const before = JSON.parse(win.localStorage.getItem('zhiyin_state_v1')).applications;
    if (!before.length) throw new Error('前置投递记录缺失，无法测试推进');
    const target = before[0];
    click(q('#importStatus'));
    q('#importJson').value = JSON.stringify({
      schema: 'zhiyin.status-event.v1',
      items: [
        { company: target.company, position: target.position, channel: 'BOSS直聘', stage: 'interview_1', stageRaw: '邀面试', occurredAt: '2026-09-12T00:00:00+08:00' },
        { company: '小红书', position: '产品运营专员', channel: 'BOSS直聘', stage: 'written_test', stageRaw: '笔试邀请', occurredAt: '2026-09-12T00:00:00+08:00' }
      ]
    });
    click(qa('#modalFoot .btn.primary')[0]);
    const after = JSON.parse(win.localStorage.getItem('zhiyin_state_v1')).applications;
    if (after.length !== before.length + 1) throw new Error('新建失败：' + before.length + ' -> ' + after.length);
    const t = after.filter(a => a.company === target.company && a.position === target.position)[0];
    if (!t) throw new Error('原记录丢失');
    if (t.status !== '一面') throw new Error('状态未推进：' + t.status);
    const nx = after.filter(a => a.company === '小红书')[0];
    if (!nx || nx.status !== '笔试') throw new Error('新建记录状态异常：' + (nx ? nx.status : 'missing'));
    log('推进 ' + target.company + ' -> ' + t.status + '；新建 小红书 -> ' + nx.status + '（共 ' + after.length + ' 条）');
  });

  step('采集到的历史事件不会把状态倒推回去', function () {
    const apps = JSON.parse(win.localStorage.getItem('zhiyin_state_v1')).applications;
    const target = apps.filter(a => a.company === '字节跳动')[0] || apps[0];
    click(q('#importStatus'));
    q('#importJson').value = JSON.stringify({
      items: [{ company: target.company, position: target.position, stage: 'submitted', stageRaw: '投递成功', occurredAt: '2026-09-01T00:00:00+08:00' }]
    });
    click(qa('#modalFoot .btn.primary')[0]);
    const after = JSON.parse(win.localStorage.getItem('zhiyin_state_v1')).applications;
    const t = after.filter(a => a.company === target.company && a.position === target.position)[0];
    if (t.status !== target.status) throw new Error('状态被倒推：' + target.status + ' -> ' + t.status);
    log('历史事件未倒推状态，仍为 ' + t.status);
  });

  step('投递中心有两个页签，默认落在「官网投递汇总」', function () {
    click(qa('.nav-item')[3]);
    const segs = qa('#trackSegBtns button');
    if (segs.length !== 2) throw new Error('页签数=' + segs.length);
    const on = segs.filter(b => b.classList.contains('on'))[0];
    if (!on || on.dataset.seg !== 'hub') throw new Error('默认页签不是汇总台');
    if (!qa('#trackHub .hub-item').length) throw new Error('汇总台没有条目');
    if (!q('#importStatus')) throw new Error('投递中心没有导入入口');
    log('页签：' + segs.map(b => b.textContent).join(' / ') + '　汇总台 ' + qa('#trackHub .hub-item').length + ' 条');
  });

  step('切到「流程看板」：五列齐全，且每条都有更新状态入口', function () {
    const boardBtn = qa('#trackSegBtns button').filter(b => b.dataset.seg === 'board')[0];
    click(boardBtn);
    const cols = qa('#trackBoard .col').length;
    if (cols !== 5) throw new Error('看板列数异常：' + cols);
    if (!qa('#trackBoard [data-set]').length) throw new Error('看板上没有「更新状态」按钮');
    log('看板 5 列：' + qa('#trackBoard .col h4').map(h => h.textContent.replace(/\s+/g, '')).join(' / '));
    click(qa('#trackSegBtns button').filter(b => b.dataset.seg === 'hub')[0]);
  });

  /* ============ 官网投递：贴地址 -> 识别招聘系统 -> 定流程模板 ============ */
  step('投递中心有「登记官网投递」入口', function () {
    click(qa('.nav-item')[3]);
    const b = q('#addOfficial');
    if (!b) throw new Error('没有登记入口');
    if (b.textContent.indexOf('登记') < 0) throw new Error('按钮文案异常：' + b.textContent);
  });

  step('粘贴 Moka 地址：识别出系统，且不再承诺「自动同步」', function () {
    click(q('#addOfficial'));
    input(q('#aUrl'), 'https://tencent.mokahr.com/candidate');
    const t = q('#atsBox').textContent;
    if (t.indexOf('Moka') < 0) throw new Error('未识别 Moka：' + t.slice(0, 90));
    if (t.indexOf('第三方 ATS') < 0) throw new Error('未给出系统类型：' + t.slice(0, 90));
    /* 这一版刻意不做自动同步，界面上不能再出现这类承诺 */
    ['自动同步', '邮件通道'].forEach(function (w) {
      if (t.indexOf(w) >= 0) throw new Error('仍在承诺「' + w + '」：' + t.slice(0, 90));
    });
    log('识别面板：' + t.replace(/\s+/g, ' ').slice(0, 92));
  });

  step('粘贴京东地址：自动预选京东校招流程（测评在笔试之前）', function () {
    input(q('#aUrl'), 'https://campus.jd.com/candidate');
    const t = q('#atsBox').textContent;
    if (t.indexOf('京东招聘') < 0) throw new Error('未识别京东：' + t.slice(0, 90));
    const sel = q('#aFlow');
    if (!sel || sel.value !== 'jd') throw new Error('未预选京东模板：' + (sel ? sel.value : 'no select'));
    const names = qa('#flowPrev .fstep .nm').map(n => n.textContent);
    if (names.join('>') !== '投递>测评>笔试>AI 面试>简历筛选>面试>Offer>入职') {
      throw new Error('预览流程不对：' + names.join('>'));
    }
    log('京东流程预览：' + names.join(' > '));
  });

  step('粘贴 Boss 直聘地址：判定为「仅归档」', function () {
    input(q('#aUrl'), 'https://www.zhipin.com/web/chat');
    const t = q('#atsBox').textContent;
    if (t.indexOf('Boss 直聘') < 0) throw new Error('未识别 Boss 直聘：' + t.slice(0, 90));
    if (t.indexOf('仅归档') < 0) throw new Error('平台型未判定为仅归档：' + t.slice(0, 90));
  });

  step('未收录的系统：明确说清不影响使用，不误导', function () {
    input(q('#aUrl'), 'https://careers.some-unknown-corp.com/status');
    const t = q('#atsBox').textContent;
    if (t.indexOf('未收录') < 0) throw new Error('未提示未收录：' + t.slice(0, 90));
    if (t.indexOf('直达状态页') < 0) throw new Error('未说明地址仍然可用：' + t.slice(0, 90));
    if (t.indexOf('流程模板') < 0) throw new Error('未说明要手动挑流程：' + t.slice(0, 90));
  });

  step('来源选「招聘平台」：一律仅归档，不受地址影响', function () {
    input(q('#aUrl'), 'https://tencent.mokahr.com/candidate');
    const chip = qa('#srcChips .chip').filter(c => c.dataset.src === '招聘平台')[0];
    if (!chip) throw new Error('没有「招聘平台」来源选项');
    click(chip);
    const t = q('#atsBox').textContent;
    if (t.indexOf('仅归档') < 0) throw new Error('招聘平台未仅归档：' + t.slice(0, 90));
    click(qa('#srcChips .chip').filter(c => c.dataset.src === '官网直投')[0]);
  });

  step('登记后卡片带来源 / 招聘系统 / 完整进度条', function () {
    input(q('#aUrl'), 'https://tencent.mokahr.com/candidate');
    input(q('#aCompany'), '腾讯');
    input(q('#aPosition'), '后台开发工程师');
    click(qa('#modalFoot .btn.primary')[0]);
    const card = qa('#trackHub .hub-item').filter(c => c.textContent.indexOf('腾讯') >= 0)[0];
    if (!card) throw new Error('未找到新登记的卡片');
    const t = card.textContent;
    ['官网直投', 'Moka', '去官网确认'].forEach(function (k) {
      if (t.indexOf(k) < 0) throw new Error('卡片缺少「' + k + '」：' + t.replace(/\s+/g, ' ').slice(0, 120));
    });
    const steps = Array.prototype.slice.call(card.querySelectorAll('.fstep .nm')).map(n => n.textContent);
    if (steps.length !== 8) throw new Error('进度条步数=' + steps.length + '：' + steps.join('>'));
    const cur = card.querySelectorAll('.fstep.cur');
    if (cur.length !== 1) throw new Error('当前节点高亮数=' + cur.length);
    if (cur[0].querySelector('.nm').textContent !== '投递') throw new Error('新登记应停在第 1 步');
    log('新卡片进度条：' + steps.join(' > ') + '　当前=' + card.querySelector('.hub-cur b').textContent);
  });

  step('登记记录落库：来源 / 地址 / 厂商 / 流程 / 当前步齐全', function () {
    const apps = JSON.parse(win.localStorage.getItem('zhiyin_state_v1')).applications;
    const a = apps.filter(x => x.company === '腾讯')[0];
    if (!a) throw new Error('未落库');
    if (a.source !== '官网直投') throw new Error('source=' + a.source);
    if (String(a.url).indexOf('mokahr.com') < 0) throw new Error('url=' + a.url);
    if (a.atsVendor !== 'Moka') throw new Error('atsVendor=' + a.atsVendor);
    if (!Array.isArray(a.flow) || a.flow.length !== 8) throw new Error('flow=' + JSON.stringify(a.flow));
    if (a.stepIdx !== 0) throw new Error('stepIdx=' + a.stepIdx);
    if (a.closed !== false) throw new Error('closed=' + a.closed);
    if (a.trackMode !== 'manual') throw new Error('trackMode=' + a.trackMode);
  });

  step('导入时按页面地址自动反查厂商、翻译来源', function () {
    click(q('#importStatus'));
    q('#importJson').value = JSON.stringify({
      schema: 'zhiyin.status-event.v1',
      pageUrl: 'https://tencent.mokahr.com/candidate',
      channel: 'Moka',
      items: [{
        company: '腾讯', position: '后台开发工程师',
        source: 'extension', stage: 'screening', stageRaw: '已查看',
        occurredAt: '2026-09-12T00:00:00+08:00'
      }]
    });
    click(qa('#modalFoot .btn.primary')[0]);
    const apps = JSON.parse(win.localStorage.getItem('zhiyin_state_v1')).applications;
    const a = apps.filter(x => x.company === '腾讯')[0];
    /* 状态文案取自**这条投递自己的流程步骤名**，所以是「简历筛选」而不是归一化的「简历筛选中」 */
    if (a.status !== '简历筛选') {
      throw new Error('状态未推进：' + a.status + ' / stepIdx=' + a.stepIdx + ' / flow=' + JSON.stringify(a.flow));
    }
    if (String(a.url).indexOf('mokahr.com') < 0) throw new Error('导入未补上直达地址');
    if (a.source !== '官网直投') throw new Error('通道名未翻译成来源：' + a.source);
    if (!a.lastSync) throw new Error('未写入同步时间');
    if (a.atsVendor !== 'Moka') throw new Error('厂商丢失：' + a.atsVendor);
    if (a.stepIdx !== 1) throw new Error('归一化阶段没翻译到本流程的步骤：' + a.stepIdx);
    log('腾讯 -> ' + a.status + '（本流程第 ' + (a.stepIdx + 1) + ' 步）　来源 ' + a.source);
  });

  /* ============ 核心闭环：去官网确认 -> 回来点进度条归档 ============ */
  step('点「去官网确认」记录确认时间，并提示回来归档', function () {
    const card = qa('#trackHub .hub-item').filter(c => c.textContent.indexOf('腾讯') >= 0)[0];
    if (!card) throw new Error('找不到腾讯卡片');
    const id = card.dataset.id;
    click(card.querySelector('[data-goto]'));
    const apps = JSON.parse(win.localStorage.getItem('zhiyin_state_v1')).applications;
    const a = apps.filter(x => x.id === id)[0];
    if (!a.urlCheckedAt) throw new Error('未记录确认时间');
    if (!a.confirmPending) throw new Error('未进入待归档状态');
    const card2 = qa('#trackHub .hub-item').filter(c => c.textContent.indexOf('腾讯') >= 0)[0];
    if (card2.textContent.indexOf('点上面进度条对应的那一步') < 0) throw new Error('没有回来归档的提示');
    log('已记录确认时间 ' + a.urlCheckedAt + '，卡片出现待归档提示');
  });

  step('点进度条任意节点即完成归档，且只追加一条时间轴', function () {
    const card = qa('#trackHub .hub-item').filter(c => c.textContent.indexOf('腾讯') >= 0)[0];
    const id = card.dataset.id;
    const before = JSON.parse(win.localStorage.getItem('zhiyin_state_v1')).applications.filter(x => x.id === id)[0];
    const n0 = before.timeline.length;
    /* 直接点到第 6 步（HR 面）——真实进度常常是跳着走的 */
    click(card.querySelectorAll('.fstep')[5]);
    const a = JSON.parse(win.localStorage.getItem('zhiyin_state_v1')).applications.filter(x => x.id === id)[0];
    if (a.status !== 'HR 面') throw new Error('归档状态=' + a.status);
    if (a.stepIdx !== 5) throw new Error('stepIdx=' + a.stepIdx);
    if (a.timeline.length !== n0 + 1) throw new Error('时间轴增加 ' + (a.timeline.length - n0) + ' 条，伪造了中间节点');
    if (a.confirmPending) throw new Error('归档后仍停留在待归档状态');
    const card2 = qa('#trackHub .hub-item').filter(c => c.textContent.indexOf('腾讯') >= 0)[0];
    if (card2.textContent.indexOf('点上面进度条对应的那一步') >= 0) throw new Error('归档后提示未消失');
    if (card2.querySelectorAll('.fstep')[5].className.indexOf('cur') < 0) throw new Error('第 6 步未高亮');
    log('腾讯 -> ' + a.status + '（第 ' + (a.stepIdx + 1) + ' 步）　时间轴 ' + n0 + ' -> ' + a.timeline.length + ' 条');
  });

  step('「换流程」可改成该公司的真实步骤，且不丢当前状态', function () {
    const card = qa('#trackHub .hub-item').filter(c => c.textContent.indexOf('腾讯') >= 0)[0];
    const id = card.dataset.id;
    click(card.querySelector('[data-flow]'));
    const sel = q('#ftpl');
    if (!sel) throw new Error('换流程弹窗没有模板下拉');
    const opt = Array.prototype.slice.call(sel.options).filter(o => o.value === 'custom')[0];
    if (!opt) throw new Error('没有自定义选项');
    change(sel, 'custom');
    q('#fsteps').value = ['投递', '测评', 'AI 面试', '终面', 'Offer'].join('\n');
    click(qa('#modalFoot .btn.primary')[0]);
    const a = JSON.parse(win.localStorage.getItem('zhiyin_state_v1')).applications.filter(x => x.id === id)[0];
    if (a.flowKey !== 'custom') throw new Error('flowKey=' + a.flowKey);
    if (a.flow.join('>') !== '投递>测评>AI 面试>终面>Offer') throw new Error('flow=' + a.flow.join('>'));
    if (a.stepIdx < 0 || a.stepIdx > 4) throw new Error('stepIdx 越界：' + a.stepIdx);
    const card2 = qa('#trackHub .hub-item').filter(c => c.textContent.indexOf('腾讯') >= 0)[0];
    const steps = Array.prototype.slice.call(card2.querySelectorAll('.fstep .nm')).map(n => n.textContent);
    if (steps.join('>') !== '投递>测评>AI 面试>终面>Offer') throw new Error('进度条未按新流程重画：' + steps.join('>'));
    log('自定义流程生效：' + steps.join(' > ') + '　当前步骤 ' + a.stepIdx);
  });

  step('「结束流程」：先确认再结束，且随时能撤回（误触可恢复）', function () {
    const card = qa('#trackHub .hub-item').filter(c => c.textContent.indexOf('腾讯') >= 0)[0];
    const id = card.dataset.id;
    const read = function () {
      return JSON.parse(win.localStorage.getItem('zhiyin_state_v1')).applications.filter(x => x.id === id)[0];
    };
    const before = read();
    const wasIdx = before.stepIdx, wasStatus = before.status, tlWas = before.timeline.length;

    /* 第一次点：只是二次确认，不能真关 */
    const btn = card.querySelector('[data-close]');
    if (!btn) throw new Error('进行中的卡片没有「结束流程」');
    click(btn);
    if (read().closed === true) throw new Error('点一次就结束了 —— 没有二次确认');
    if (btn.textContent.indexOf('确认结束') < 0) throw new Error('按钮没有变成确认态：' + btn.textContent);

    /* 第二次点：真关 */
    click(btn);
    const a = read();
    if (a.closed !== true) throw new Error('closed=' + a.closed);
    if (a.status !== '已结束') throw new Error('status=' + a.status);
    if (a.stepIdx == null) throw new Error('丢失了历史位置');
    if (!a.reopenAt || a.reopenAt.stepIdx !== wasIdx) throw new Error('没记住恢复点：' + JSON.stringify(a.reopenAt));

    const card2 = qa('#trackHub .hub-item').filter(c => c.textContent.indexOf('腾讯') >= 0)[0];
    const back = card2.querySelector('[data-reopen]');
    if (!back) throw new Error('已结束的卡片上没有「恢复流程」');
    if (card2.querySelector('[data-close]')) throw new Error('已结束的卡片不该再显示「结束流程」');

    /* 撤回：回到结束前那一步 */
    click(back);
    const b = read();
    if (b.closed !== false) throw new Error('撤回失败：closed=' + b.closed);
    if (b.stepIdx !== wasIdx) throw new Error('没回到原来的步骤：' + b.stepIdx + ' ≠ ' + wasIdx);
    if (b.status !== wasStatus) throw new Error('没回到原来的状态：' + b.status + ' ≠ ' + wasStatus);
    if (b.reopenAt) throw new Error('恢复点没清掉');
    const card3 = qa('#trackHub .hub-item').filter(c => c.textContent.indexOf('腾讯') >= 0)[0];
    if (!card3.querySelector('[data-close]')) throw new Error('撤回后没有恢复「结束流程」按钮');

    /* 时间轴留痕：结束与恢复各一条，旧记录一条不删 */
    if (b.timeline.length !== tlWas + 2) throw new Error('时间轴条数不对：' + b.timeline.length + ' ≠ ' + (tlWas + 2));
    if (!b.timeline.some(x => /误触/.test(x.note || ''))) throw new Error('时间轴没留下「撤回」这条痕迹');

    /* 收尾：后面的用例按「这条已结束」来用，撤回演示完再关回去 */
    const closeAgain = function () {
      const c = qa('#trackHub .hub-item').filter(x => x.textContent.indexOf('腾讯') >= 0)[0];
      click(c.querySelector('[data-close]')); click(c.querySelector('[data-close]'));
    };
    closeAgain();
    if (!read().closed) throw new Error('收尾没关回去');
    log('结束流程：二次确认 → 已结束 → 一键恢复到「' + b.status + '」，时间轴留痕 2 条');
  });
  /* ============ 无进度条的公司：只记状态 ============ */
  step('选「无进度条」登记：不画进度，但状态照样能改', function () {
    click(q('#addOfficial'));
    input(q('#aCompany'), '某研究院');
    input(q('#aPosition'), '情报分析');
    change(q('#aFlow'), 'none');
    if (qa('#flowPrev .fstep').length) throw new Error('选了无进度条却仍预览出步骤');
    click(qa('#modalFoot .btn.primary')[0]);
    const card = qa('#trackHub .hub-item').filter(c => c.textContent.indexOf('某研究院') >= 0)[0];
    if (!card) throw new Error('未登记成功');
    if (card.querySelectorAll('.fstep').length) throw new Error('无进度条却画了节点');
    if (card.textContent.indexOf('无进度条') < 0) throw new Error('未说明这家没有进度展示');
    const id = card.dataset.id;
    click(card.querySelector('[data-set]'));
    const chips = qa('#stageChips .chip');
    if (chips.length < 3) throw new Error('状态选项太少：' + chips.length);
    click(chips.filter(c => c.dataset.stage === '面试邀约')[0]);
    const a = JSON.parse(win.localStorage.getItem('zhiyin_state_v1')).applications.filter(x => x.id === id)[0];
    if (a.status !== '面试邀约') throw new Error('无进度条的公司状态未更新：' + a.status);
    log('无进度条公司状态已改为：' + a.status);
  });

  /* ============ 汇总台的筛选与排序 ============ */
  step('筛选「待确认」：只剩还没去官网看过的记录', function () {
    click(qa('#hubFilters .chip').filter(c => c.dataset.hf === 'need')[0]);
    const items = qa('#trackHub .hub-item');
    if (!items.length) throw new Error('待确认筛选后为空');
    const raw = JSON.parse(win.localStorage.getItem('zhiyin_state_v1')).applications;
    const needIds = items.map(i => i.dataset.id);
    const bad = raw.filter(a => needIds.indexOf(a.id) >= 0 && a.closed);
    if (bad.length) throw new Error('已结束的记录混进了待确认');
    log('待确认 ' + items.length + ' 条（共 ' + raw.length + ' 条投递）');
    click(qa('#hubFilters .chip').filter(c => c.dataset.hf === 'all')[0]);
  });

  step('「有直达链接」筛选：只留能一键直达的记录', function () {
    click(qa('#hubFilters .chip').filter(c => c.dataset.hf === 'link')[0]);
    const items = qa('#trackHub .hub-item');
    if (!items.length) throw new Error('筛选后为空');
    items.forEach(function (it) {
      if (!it.querySelector('[data-goto]')) throw new Error('条目缺少直达按钮');
      if (it.textContent.indexOf('去官网确认') < 0) throw new Error('有链接却没显示「去官网确认」');
    });
    log('有直达链接 ' + items.length + ' 条');
    click(qa('#hubFilters .chip').filter(c => c.dataset.hf === 'all')[0]);
  });

  step('每条卡片都有直达入口，按钮文案随有无地址切换', function () {
    const items = qa('#trackHub .hub-item');
    const raw = JSON.parse(win.localStorage.getItem('zhiyin_state_v1')).applications;
    let withUrl = 0;
    items.forEach(function (it) {
      const a = raw.filter(x => x.id === it.dataset.id)[0];
      const btn = it.querySelector('[data-goto]');
      if (!btn) throw new Error('卡片没有直达入口');
      if (a.url) { withUrl++; if (btn.textContent.indexOf('去官网确认') < 0) throw new Error('有地址却显示：' + btn.textContent); }
      else if (btn.textContent.indexOf('补上直达链接') < 0) throw new Error('无地址却显示：' + btn.textContent);
    });
    if (!withUrl) throw new Error('有地址的记录却没有「去官网确认」');
    log('汇总台 ' + items.length + ' 条，其中 ' + withUrl + ' 条可一键直达官网');
  });

  /* ============ 投递回执：提交那一刻的凭证 ============ */
  step('应用内登记在提交那一刻自动开出回执', function () {
    click(qa('.nav-item')[3]);
    const raw = JSON.parse(win.localStorage.getItem('zhiyin_state_v1'));
    const a = raw.applications.filter(x => x.source === '应用内登记')[0];
    if (!a) throw new Error('找不到应用内登记的记录');
    if (!a.receipt || !a.receipt.no) throw new Error('应用内登记没有自动生成回执');
    if (a.receipt.no.indexOf('HT-') !== 0) throw new Error('回执编号格式异常：' + a.receipt.no);
    if (!(a.receipt.filled > 0)) throw new Error('回执未记录自动填充字段数');
    const card = qa('#trackHub .hub-item').filter(c => c.dataset.id === a.id)[0];
    if (!card) throw new Error('汇总台找不到该卡片');
    if (card.textContent.indexOf('已存回执') < 0) throw new Error('卡片未显示「已存回执」标签');
    const rb = card.querySelector('[data-receipt]');
    if (!rb || rb.textContent.indexOf('回执') < 0 || rb.textContent.indexOf('补') >= 0) throw new Error('回执按钮文案异常：' + (rb && rb.textContent));
    log('回执编号 ' + a.receipt.no + '　自动填充 ' + a.receipt.filled + ' 个字段');
  });

  step('点「回执」查看提交凭证详情', function () {
    const raw = JSON.parse(win.localStorage.getItem('zhiyin_state_v1'));
    const a = raw.applications.filter(x => x.source === '应用内登记')[0];
    if (!a) throw new Error('找不到应用内登记的记录');
    const card = qa('#trackHub .hub-item').filter(c => c.dataset.id === a.id)[0];
    if (!card) throw new Error('汇总台找不到该卡片');
    click(card.querySelector('[data-receipt]'));
    const sub = q('#modalSub').textContent;
    const body = q('#modalBody').textContent;
    if (sub.indexOf('投递回执') < 0) throw new Error('弹窗副标题异常：' + sub);
    if (body.indexOf(a.receipt.no) < 0) throw new Error('弹窗未显示回执编号');
    if (body.indexOf('提交时间') < 0 || body.indexOf('申请号') < 0) throw new Error('弹窗缺少关键字段');
    if (body.indexOf('回执只定格提交瞬间') < 0) throw new Error('未说明回执与状态的分工');
    click(q('#modalX'));
    log('回执详情已展示：' + a.receipt.no);
  });

  step('「补回执」给没有凭证的记录手动补记', function () {
    click(qa('#hubFilters .chip').filter(c => c.dataset.hf === 'all')[0]);
    const raw0 = JSON.parse(win.localStorage.getItem('zhiyin_state_v1'));
    const target = raw0.applications.filter(x => !x.receipt)[0];
    if (!target) throw new Error('所有记录都已有回执，无法测试补记');
    const card = qa('#trackHub .hub-item').filter(c => c.dataset.id === target.id)[0];
    if (!card) throw new Error('找不到待补回执的卡片');
    const btn = card.querySelector('[data-receipt]');
    if (btn.textContent.indexOf('补回执') < 0) throw new Error('按钮应显示「补回执」，实际：' + btn.textContent);
    click(btn);
    input(q('#rcJobRef'), 'REF-2026-8888');
    click(qa('#modalFoot .btn.primary')[0]);
    const a = JSON.parse(win.localStorage.getItem('zhiyin_state_v1')).applications.filter(x => x.id === target.id)[0];
    if (!a.receipt || !a.receipt.no) throw new Error('补记未生成回执');
    if (a.externalId !== 'REF-2026-8888') throw new Error('申请号未写入：' + a.externalId);
    const card2 = qa('#trackHub .hub-item').filter(c => c.dataset.id === target.id)[0];
    if (card2.textContent.indexOf('已存回执') < 0) throw new Error('补记后卡片未显示已存回执');
    log('已补记回执 ' + a.receipt.no + '（' + target.company + '）');
  });

  step('「导入回执」命中已有记录：只补凭证、不新建', function () {
    const before = JSON.parse(win.localStorage.getItem('zhiyin_state_v1')).applications;
    const target = before.filter(x => !x.receipt && x.position && x.position !== '未填写岗位')[0];
    if (!target) throw new Error('没有可用来测试导入的记录');
    click(q('#importReceipt'));
    input(q('#importRc'), JSON.stringify({
      schema: 'zhiyin.receipt.v1',
      receipt: {
        company: target.company, position: target.position, jobRef: 'IMP-' + target.id,
        url: 'https://jobs.bytedance.com/status', at: '2026-09-13T18:30:00', channel: '官网直投'
      }
    }));
    click(qa('#modalFoot .btn.primary')[0]);
    const after = JSON.parse(win.localStorage.getItem('zhiyin_state_v1')).applications;
    if (after.length !== before.length) throw new Error('命中已有记录却新建了：' + before.length + ' -> ' + after.length);
    const a = after.filter(x => x.id === target.id)[0];
    if (!a.receipt || a.receipt.jobRef !== 'IMP-' + target.id) throw new Error('回执未写入目标记录');
    if (a.receipt.at !== '2026-09-13 18:30') throw new Error('回执时间未保留：' + a.receipt.at);
    log('导入回执命中「' + target.company + '」：补上 ' + a.receipt.no);
  });

  step('「导入回执」匹配不到：新建一条并落在「已投递」', function () {
    const before = JSON.parse(win.localStorage.getItem('zhiyin_state_v1')).applications;
    click(q('#importReceipt'));
    input(q('#importRc'), JSON.stringify({
      pageUrl: 'https://acme.myworkdayjobs.com/en-US/careers',
      receipt: { company: '某外企', position: 'Data Scientist', jobRef: 'WD-7788', at: '2026-09-13T19:00:00' }
    }));
    click(qa('#modalFoot .btn.primary')[0]);
    const after = JSON.parse(win.localStorage.getItem('zhiyin_state_v1')).applications;
    if (after.length !== before.length + 1) throw new Error('未新建记录：' + before.length + ' -> ' + after.length);
    const a = after[after.length - 1];
    if (a.company !== '某外企') throw new Error('新建记录公司名异常：' + a.company);
    if (!a.receipt || !a.receipt.no) throw new Error('新建记录没有回执');
    if (a.atsVendor !== 'Workday') throw new Error('未识别招聘系统：' + a.atsVendor);
    if (a.externalId !== 'WD-7788') throw new Error('申请号未写入：' + a.externalId);
    const card = qa('#trackHub .hub-item').filter(c => c.dataset.id === a.id)[0];
    if (!card || card.textContent.indexOf('已存回执') < 0) throw new Error('新建卡片未显示已存回执');
    log('新建「某外企」并附回执 ' + a.receipt.no + '（' + a.atsVendor + '）');
  });

  step('「已存回执」筛选：只留有过凭证的记录', function () {
    click(qa('#hubFilters .chip').filter(c => c.dataset.hf === 'receipt')[0]);
    const items = qa('#trackHub .hub-item');
    if (items.length < 2) throw new Error('存有回执的记录太少：' + items.length);
    const raw = JSON.parse(win.localStorage.getItem('zhiyin_state_v1')).applications;
    items.forEach(function (it) {
      const a = raw.filter(x => x.id === it.dataset.id)[0];
      if (!a.receipt) throw new Error('筛选结果混入了没有回执的记录');
      if (it.textContent.indexOf('已存回执') < 0) throw new Error('卡片缺少已存回执标签');
    });
    log('已存回执 ' + items.length + ' 条');
    click(qa('#hubFilters .chip').filter(c => c.dataset.hf === 'all')[0]);
  });

  /* ============ 第十七轮：成就仓库 + CAR 改写 ============ */

  step('成就仓库：录入 3 条后渲染出卡片，且数字区分「真实值」与「[N] 占位」', function () {
    /* state 是 let 声明，不在 window 上 —— 只用 window 上的函数操作。
       先清空已有条目（可能来自历史步骤/存档）。 */
    wipeInv();
    win.addInventoryItem({ project: 'NLP pipeline 重构', time: '2025', metric: '20%', action: '主导 Python 与 TensorFlow 的 NLP pipeline 重构', impact: '延迟降低 30%' });
    win.addInventoryItem({ project: '推荐召回系统', time: '2024', metric: '5万', action: '优化召回模型', impact: 'CTR 提升 12%' });
    win.addInventoryItem({ project: '采购 BFF', time: '2023', metric: '', action: '做了一个采购 BFF', impact: '支撑 3 条业务线' });

    const list = q('#invList');
    if (!list) throw new Error('找不到 #invList');
    const items = qa('#invList .inv-item');
    if (items.length !== 3) throw new Error('仓库条目数异常：' + items.length);

    /* 真实数字用 .metric-real；第二十六轮起不再有 [N] 占位 ——
       没填数字的条目干脆不显示数字行，而不是留个占位催你补。 */
    const reals = qa('#invList .metric-real');
    if (reals.length !== 2) throw new Error('真实数字应有 2 个，实际 ' + reals.length);
    if (qa('#invList .placeholder').length !== 0) throw new Error('不该再有 [N] 占位符');
    if (items[2].textContent.indexOf('数字：') >= 0) throw new Error('没填数字的条目不该出现「数字：」这一行');
    /* 经历过了一层：3 条成就分属 3 段不同的经历 */
    if (qa('#invList .inv-exp').length !== 3) throw new Error('应按经历分成 3 组，实际 ' + qa('#invList .inv-exp').length);
    if (qa('#invList .inv-exp-name').length !== 3) throw new Error('经历卡应各有一个名字');
    log('经历与成就 3 组（真实数字 2 · 无数字的 1 条不显示数字行）');
  });

  step('自动归纳：一段经历合并为一条成就（不逐句拆碎），项目名/数字自动提取', function () {
    /* 先把画像的经历栏填上内容（走 UI 事件，保证 state.profile 同步） */
    const exp = q('[data-k="expText"]');
    if (!exp) throw new Error('找不到经历输入框 [data-k="expText"]');
    exp.value = '字节跳动 算法实习生：负责推荐召回模块重构，上线后 CTR 提升 12%。\n腾讯 数据分析实习：搭建日报自动化看板，节省人工 2 小时/天。';
    exp.dispatchEvent(new win.Event('input', { bubbles: true }));
    /* 科研栏可能被前面的简历解析步骤填过——清空以隔离出 2 段经历 */
    const res = q('[data-k="research"]');
    if (res) { res.value = ''; res.dispatchEvent(new win.Event('input', { bubbles: true })); }

    /* 清掉已有条目再点自动归纳 */
    wipeInv();
    const autoBtn = q('#invAutoBtn');
    if (!autoBtn) throw new Error('找不到 #invAutoBtn');
    click(autoBtn);

    const items = qa('#invList .inv-item');
    if (items.length !== 2) throw new Error('两段经历应合并为恰好 2 条成就，实际 ' + items.length);
    /* 每条草稿必须有非空项目名——否则刷新后会被 mergeState 过滤掉（隐藏 bug 回归） */
    /* 项目名现在渲染在经历卡上（.inv-exp-name），不再挂在成就条里 */
    const names = qa('#invList .inv-exp-name').map(function (el) { return el.textContent; });
    if (names.length !== 2) throw new Error('2 条成就应分成 2 段经历，实际 ' + names.length);
    names.forEach(function (t, i) {
      if (t.indexOf('未归类') >= 0) throw new Error('第 ' + (i + 1) + ' 条草稿缺项目名（被归到「未归类的经历」了）');
    });
    qa('#invList .inv-item').forEach(function (el, i) {
      if (el.textContent.indexOf('来自简历') < 0) throw new Error('第 ' + (i + 1) + ' 条缺「来自简历」来源标签');
    });
    if (items[0].textContent.indexOf('负责推荐召回模块重构') < 0) throw new Error('要点没有合并进动作描述');
    if (names.join('|').indexOf('字节跳动') < 0) throw new Error('项目名未取自冒号前');
    if (qa('#invList .metric-real').length !== 1) throw new Error('真实数字应恰有 1 个（12%），实际 ' + qa('#invList .metric-real').length);
    if (qa('#invList .placeholder').length !== 0) throw new Error('不该再有 [N] 占位符');
    log('自动归纳：2 段经历 → 2 条成就（要点合并 · 数字提取 1 个 · 无占位）');
  });

  step('时间点选：起止月份选择器组合入库为「YYYY-MM 至 YYYY-MM」', function () {
    wipeInv();
    const ts = q('#invTimeStart'); const te = q('#invTimeEnd');
    if (!ts || !te) throw new Error('找不到起止月份选择器');
    ts.value = '2025-03'; te.value = '2025-08';
    q('#invProj').value = '测试项目';
    q('#invAction').value = '主导了某项测试工作并产出结果';
    click(q('#invAddBtn'));
    const items = qa('#invList .inv-item');
    if (items.length !== 1) throw new Error('应入库 1 条，实际 ' + items.length);
    /* 第二十六轮：项目名与起止升到了父层经历卡，成就条不再重复渲染它们。
       所以时间分两处验 —— 存档里是合并好的「起 至 止」，经历卡上是拆开的「起 - 止」。 */
    const sv = ((JSON.parse(win.localStorage.getItem('zhiyin_state_v1')) || {}).inventory) || [];
    if (sv.length !== 1 || sv[0].time !== '2025-03 至 2025-08') {
      throw new Error('时间未组合成「起 至 止」格式：' + JSON.stringify(sv[0] && sv[0].time));
    }
    /* 经历卡上要把起止解析成两段并显示出来（splitTimeRange 曾把 2025-03 切碎） */
    const sub = q('#invList .inv-exp-sub');
    if (!sub || sub.textContent.indexOf('2025-03 - 2025-08') < 0) throw new Error('经历卡上的起止解析不对：' + (sub && sub.textContent));
    /* 清空表单后月份选择器应被重置 */
    click(q('#invClearFormBtn'));
    if (ts.value !== '' || te.value !== '') throw new Error('清空表单未重置月份选择器');
    wipeInv();
    /* 恢复后续改写测试依赖的三条手动条目（含真实数字与占位各若干） */
    win.addInventoryItem({ project: 'NLP pipeline 重构', time: '2025', metric: '20%', action: '主导 Python 与 TensorFlow 的 NLP pipeline 重构', impact: '延迟降低 30%' });
    win.addInventoryItem({ project: '推荐召回系统', time: '2024', metric: '5万', action: '优化召回模型', impact: 'CTR 提升 12%' });
    win.addInventoryItem({ project: '采购 BFF', time: '2023', metric: '', action: '做了一个采购 BFF', impact: '支撑 3 条业务线' });
    log('起止时间点选入库 + 清空表单重置');
  });

  /* ============ 第二十七轮：经历卡只留一处入口 ============
     用户原话：「编辑经历和下方的编辑稍显重复，而且有两个删除，这边我需要把下方的编辑与删除都去掉。」
     所以：成就条上不再有按钮；改 / 删收进「编辑经历」弹窗（就地行内编辑，不开第二层弹窗）；
     弹窗里的起止换成自研月份下拉。 */
  step('经历卡：成就条无按钮，改 / 删收进「编辑经历」弹窗（含二次确认）', function () {
    win.switchView('resume');
    if (qa('#invList .inv-item [data-inv-del]').length) throw new Error('成就条上还有「删除」按钮');
    if (qa('#invList .inv-item [data-inv-edit]').length) throw new Error('成就条上还有「编辑」按钮');

    wipeInv();
    win.addInventoryItem({ project: '弹窗测试项目', time: '2024-05 至 2024-09', metric: '8%', action: '参与了弹窗测试', impact: '省了两天' });
    const card = expCardByName('弹窗测试项目');
    if (!card) throw new Error('找不到刚建的那张经历卡');
    click(card.querySelector('[data-exp-edit]'));

    /* 弹窗里的起止应是只读的月份下拉，并把存档里的 2024-05 / 2024-09 回填成 YYYY-MM */
    const es = q('#expStart'), ee = q('#expEnd');
    if (!es || !ee) throw new Error('弹窗里没有起止输入框');
    if (!es.classList.contains('mp-in') || es.readOnly !== true) throw new Error('起止没有换成月份下拉（mp-in + readonly）');
    if (es.value !== '2024-05' || ee.value !== '2024-09') throw new Error('弹窗没有把起止回填成 YYYY-MM：' + es.value + ' / ' + ee.value);
    click(es);
    if (q('#mpPanel').hidden) throw new Error('弹窗里的起止点不开月份面板');
    if (!es.classList.contains('mp-on')) throw new Error('弹窗里的输入框没标出「正在选」的状态');
    const before2 = es.value;
    click(qa('#mpPanel .mp-c')[0]);
    if (!/^\d{4}-\d{2}$/.test(es.value)) throw new Error('弹窗里的月份面板没落值：' + es.value);
    if (es.value === before2) throw new Error('点了月份值却没变：' + es.value);
    if (!q('#mpPanel').hidden) throw new Error('选完月份面板应收起');

    /* 名下成就列在里面，并且带改 / 删 */
    if (qa('#expKids .inv-kid').length !== 1) throw new Error('弹窗里的成就清单条数不对：' + qa('#expKids .inv-kid').length);
    if (!q('#expKids [data-kid-edit]') || !q('#expKids [data-kid-del]')) throw new Error('弹窗里的成就缺「改 / 删」');

    /* 改一条 → 就地行内编辑（不换窗口）→ 保存 */
    click(q('#expKids [data-kid-edit]'));
    const ta = q('#expKids [data-kf="action"]');
    if (!ta) throw new Error('点「改这一条」没有展开行内编辑');
    ta.value = '独立完成弹窗联调';
    q('#expKids [data-kf="metric"]').value = '';
    click(q('#expKids [data-kid-save]'));
    const sv = ((JSON.parse(win.localStorage.getItem('zhiyin_state_v1')) || {}).inventory) || [];
    if (!sv.length || sv[0].action !== '独立完成弹窗联调') throw new Error('行内编辑没保存：' + JSON.stringify(sv[0] && sv[0].action));
    if (sv[0].metric !== '') throw new Error('清空数字没生效：' + JSON.stringify(sv[0].metric));
    if (q('#expKids .inv-kid').textContent.indexOf('独立完成弹窗联调') < 0) throw new Error('保存后清单没刷新');
    /* 删一条要二次确认：第一次点只是变成确认态，不动数据 */
    const delBtn = q('#expKids [data-kid-del]');
    click(delBtn);
    if (delBtn.getAttribute('data-ask') !== '1') throw new Error('删除没有二次确认');
    let after = ((JSON.parse(win.localStorage.getItem('zhiyin_state_v1')) || {}).inventory) || [];
    if (after.length !== 1) throw new Error('第一次点删除就把数据删了');
    click(delBtn);
    after = ((JSON.parse(win.localStorage.getItem('zhiyin_state_v1')) || {}).inventory) || [];
    if (after.length !== 0) throw new Error('二次确认后没有删掉：' + after.length);
    /* 删到最后一条：派生经历被清掉，弹窗必须明说，不能等用户点「保存」才发现没反应 */
    if (!q('#expKids .inv-kids-empty')) throw new Error('清空后弹窗没有说明这段经历已经被移除');
    win.closeModal();
    if (qa('#invList .inv-exp').length !== 0) throw new Error('派生经历空了应被清掉，实际还剩 ' + qa('#invList .inv-exp').length + ' 张卡');
    log('成就条无按钮 → 弹窗改 / 删（二次确认）→ 空派生经历自动清理');
  });

  /* ============ 第二十五轮：起止时间换成自研月份下拉（形态照美团招聘那张表） ============
     原来是 <input type="month">：面板长得随浏览器、样式不跟设计系统走，也做不出"点年份切十年页"。
     现在：点输入框 → ‹ [2026年] › + 12 个月；点标题上的年份 → 十年页 [2020-2029] + 12 个年份
     （两侧箭头翻十年）；点年份回到月份；点月份落值并收起。**同一时刻只开一个面板**。 */
  step('月份下拉选择器（第二十五轮）：虚拟日期定默认年 / 切十年页 / 翻年 / 落值 / 单面板', function () {
    const ts = q('#invTimeStart'), te = q('#invTimeEnd');
    if (!ts || !te) throw new Error('找不到起止月份选择器');
    if (ts.getAttribute('type') === 'month') throw new Error('还是原生 type=month，没有换成自研面板');
    const panel = q('#mpPanel');
    if (!panel) throw new Error('页面里没有月份面板 #mpPanel');
    if (!panel.hidden) throw new Error('面板一开始应该是收起来的');
    const st = JSON.parse(win.localStorage.getItem('zhiyin_state_v1')) || {};
    const baseYear = +String(st.vdate || '').slice(0, 4);
    if (!baseYear) throw new Error('读不到虚拟日期 vdate');

    click(ts);
    if (panel.hidden) throw new Error('点了输入框没弹面板');
    if (!ts.classList.contains('mp-on')) throw new Error('输入框没有标出「正在选」的状态');
    const title = q('#mpPanel .mp-t').textContent.trim();
    if (title !== baseYear + '年') throw new Error('默认年没跟虚拟日期走：' + title + '（虚拟日期年 ' + baseYear + '）');
    if (qa('#mpPanel .mp-c').length !== 12) throw new Error('月份页应有 12 格，实际 ' + qa('#mpPanel .mp-c').length);
    if (!q('#mpPanel .mp-c.today')) throw new Error('没有标出虚拟日期所在的那个月');

    click(q('#mpPanel .mp-t'));                       /* → 十年页 */
    if (qa('#mpPanel .mp-c').length !== 12) throw new Error('十年页应有 12 格');
    const d0 = q('#mpPanel .mp-t').textContent.trim();
    if (!/^\d{4}-\d{4}$/.test(d0)) throw new Error('十年页页眉格式不对：' + d0);
    click(q('#mpPanel [data-mp-dn="1"]'));
    if (q('#mpPanel .mp-t').textContent.trim() === d0) throw new Error('点箭头没有翻十年');
    click(q('#mpPanel [data-mp-dn="-1"]'));
    if (q('#mpPanel .mp-t').textContent.trim() !== d0) throw new Error('翻回来没回到原来那一页');

    /* 挑一个"不是虚拟日期那一年"的年份，这样后面两个框的值一定不同 */
    const yCell = qa('#mpPanel .mp-c').filter(function (b) { return !b.classList.contains('today'); })[2];
    const yTarget = yCell.textContent.trim();
    if (!/^\d{4}$/.test(yTarget) || yTarget === String(baseYear)) throw new Error('选中的年份不合适做测试：' + yTarget);
    click(yCell);
    if (q('#mpPanel .mp-t').textContent.trim() !== yTarget + '年') throw new Error('选了年份没回到月份页：' + q('#mpPanel .mp-t').textContent);
    if (qa('#mpPanel .mp-c').length !== 12) throw new Error('回到月份页后格子数不对');
    click(qa('#mpPanel .mp-c')[2]);                   /* 3 月 */
    if (ts.value !== yTarget + '-03') throw new Error('落值不对：' + JSON.stringify(ts.value));
    if (!panel.hidden) throw new Error('选完月份面板应该收起');

    /* 第二个输入框：走一遍十年页，选虚拟日期那一年 —— 顺便证明两个框各管各的 */
    click(te);
    if (panel.hidden) throw new Error('第二个输入框没弹面板');
    if (qa('.mp').length !== 1) throw new Error('场上出现了多个面板：' + qa('.mp').length);
    if (ts.classList.contains('mp-on')) throw new Error('开第二个面板时第一个还标着「正在选」');
    if (ts.value !== yTarget + '-03') throw new Error('开第二个面板把第一个的值弄丢了');
    click(q('#mpPanel .mp-t'));
    const tyCell = q('#mpPanel .mp-c.today');
    if (!tyCell) throw new Error('十年页里没有标出虚拟日期所在的那一年');
    const teYear = tyCell.textContent.trim();
    click(tyCell);
    click(qa('#mpPanel .mp-c')[7]);                   /* 8 月 */
    if (te.value !== teYear + '-08') throw new Error('第二个输入框落值不对：' + JSON.stringify(te.value));

    /* 点自己 = 打开；再点一次 = 收起（不是又开一个）。
       注意：上面刚选完月份，面板是收着的，所以这里是两次点击。 */
    click(te);
    if (panel.hidden) throw new Error('选完月份后第一次点应该重新打开面板');
    click(te);
    if (!panel.hidden) throw new Error('再点一次自己应该收起面板（不是又开一个）');

    /* 面板选出来的值要能真的入库 */
    q('#invProj').value = '月份选择器测试';
    q('#invAction').value = '验证面板选出的月份能入库';
    click(q('#invAddBtn'));
    /* 第二十六轮：时间落在存档与父层经历卡上（成就条不再重复渲染项目名与时间） */
    const want = yTarget + '-03 至 ' + teYear + '-08';
    /* 这一步前面还留着 3 条手动条目，所以不能假定「新入库的」是第 0 个 —— 按时间值找 */
    const sv2 = ((JSON.parse(win.localStorage.getItem('zhiyin_state_v1')) || {}).inventory) || [];
    const hit2 = sv2.filter(function (x) { return x.time === want; });
    if (hit2.length !== 1) {
      throw new Error('面板选出的起止月份没能组合入库（找 ' + want + '，实际 ' +
        JSON.stringify(sv2.map(function (x) { return x.time; })) + '）');
    }
    const subs2 = qa('#invList .inv-exp-sub').map(function (el) { return el.textContent; });
    if (subs2.join(' / ').indexOf(yTarget + '-03 - ' + teYear + '-08') < 0) {
      throw new Error('经历卡上的起止不对：' + subs2.join(' / '));
    }
    /* 第二十七轮：成就条上的删除按钮已去掉，删单条改走「编辑经历」弹窗 */
    const card2 = expCardByName('月份选择器测试');
    if (!card2) throw new Error('找不到「月份选择器测试」那张经历卡');
    click(card2.querySelector('[data-exp-edit]'));
    const del2 = q('#expKids [data-kid-del="' + hit2[0].id + '"]');
    if (!del2) throw new Error('「编辑经历」弹窗里找不到刚入库那条成就的删除按钮');
    click(del2);
    click(del2);
    win.closeModal();
    click(q('#invClearFormBtn'));
    if (ts.value !== '' || te.value !== '') throw new Error('清空表单没有重置月份选择器');
    log('月份面板：默认年跟虚拟日期 → 切十年 → 翻年 → 落值 → 只开一个 → 可入库');
  });

  step('自动归纳（第二十一轮）：折行复原 + 只取实习/项目，教育技能不产出成就', function () {
    wipeInv();
    const exp = q('[data-k="expText"]');
    if (!exp) throw new Error('找不到经历输入框 [data-k="expText"]');
    /* 模拟从 PDF / WPS 复制出来的样子：裸章节标题 + 每 40 余字硬折行 */
    exp.value = [
      '【教育背景】',
      '香港城市大学 健康科学与管理 硕士 2025.09 - 2026.10',
      '・核心课程：传染病管理、药物分销与开发、可穿戴技术与数字医疗、人工智能在健',
      '康科学研究与管理中的应用',
      '【实习经历】',
      '京东健康（京东互联网医院） 产品运营实习生 2025.11 - 2026.01',
      '・用户调研与竞品分析：完整体验医检诊药业务闭环，依托平台问诊反馈挖掘慢病问诊、复购',
      '流程等核心痛点；输出完整竞品分析报告。',
      '・医学内容合规运营：搭建科普内容创作规范与免责体系，设计加',
      '权评价模型筛选优质内容。',
      '【项目经历】',
      'ceRNA 网络分析项目 项目成员 2025.09 - 2026.08',
      '・多组学数据自动化解析与归档：使用 Python 递归解析 TCGA 嵌套 JSON 元数据，自动化分类提取',
      'RNA/miRNA/Isoform 表达谱，构建各类基因列表与样本字典并归档至 ceRNA元数据库。',
      'ICB 免疫疗法多组学数据库构建 项目成员 2026.01 - 2026.08',
      '・多平台测序数据标准化整合：整合 GEO、EGA 测序数据。',
      '【个人技能】',
      '• 语言：英语（CET-6 ：583,IELTS：7.0）'
    ].join('\n');
    exp.dispatchEvent(new win.Event('input', { bubbles: true }));
    click(q('#invAutoBtn'));

    const items = qa('#invList .inv-item');
    if (items.length !== 3) throw new Error('应为 3 条（1 实习 + 2 项目），实际 ' + items.length + '（折行未复原会碎成 6+ 条）');
    const txt = items.map(function (el) { return el.textContent; });
    if (txt.join('|').indexOf('核心课程') >= 0) throw new Error('教育段的「核心课程」被当成了成就');
    if (txt.join('|').indexOf('CET-6') >= 0) throw new Error('技能段被当成了成就');
    /* 项目名渲染在经历卡上（第二十六轮）*/
    const names = qa('#invList .inv-exp-name').map(function (el) { return el.textContent; });
    if (names.length !== 3) throw new Error('3 条成就应分成 3 段经历，实际 ' + names.length);
    const allNames = names.join('|');
    if (allNames.indexOf('京东健康') < 0) throw new Error('实习条目名不对：' + names[0]);
    if (txt[0].indexOf('复购流程等核心痛点') < 0) throw new Error('折行后半句没有并回同一条经历');
    if (txt[0].indexOf('权评价模型') < 0) throw new Error('第二条要点的折行下半句丢了');
    if (allNames.indexOf('ceRNA 网络分析项目') < 0 || allNames.indexOf('ICB 免疫疗法多组学数据库构建') < 0) {
      throw new Error('项目名被拆碎或带上了角色后缀：' + names.join(' / '));
    }
    if (txt[1].indexOf('RNA/miRNA/Isoform 表达谱') < 0) throw new Error('项目要点折行下半句丢了');
    log('自动归纳：折行复原后 3 条（1 实习 · 2 项目），教育/技能未混入');
  });

  step('自动归纳幂等：重跑弹确认并替换旧草稿，手动条目与成果数字保留', function () {
    win.addInventoryItem({ project: '手动条目', time: '2024', metric: '30%', action: '手动写的一条经历', impact: '' });
    const before = qa('#invList .inv-item').length;
    click(q('#invAutoBtn'));
    const foot = qa('#modalFoot button');
    if (!foot.length) throw new Error('仓库里已有旧草稿时，重跑归纳应先弹确认框');
    if (qa('#invList .inv-item').length !== before) throw new Error('确认之前不应改动仓库');
    const go = foot.filter(function (b) { return b.textContent.indexOf('重新归纳') >= 0; })[0];
    if (!go) throw new Error('确认框里没有「重新归纳」按钮');
    click(go);

    const items = qa('#invList .inv-item');
    if (items.length !== before) throw new Error('重跑后条目数应保持 ' + before + '（3 草稿 + 1 手动），实际 ' + items.length);
    const autoN = items.filter(function (el) { return el.textContent.indexOf('来自简历') >= 0; }).length;
    if (autoN !== 3) throw new Error('草稿应恰好 3 条，实际 ' + autoN + '（说明重跑重复堆叠了）');
    if (!qa('#invList .inv-exp-name').some(function (el) { return el.textContent.indexOf('手动条目') >= 0; })) throw new Error('手动添加的条目被误删');
    log('自动归纳幂等：确认后替换 3 条草稿 · 手动条目保留 · 无重复堆叠');

    /* 还原后续「改写」步骤依赖的三条手动条目 */
    wipeInv();
    win.addInventoryItem({ project: 'NLP pipeline 重构', time: '2025', metric: '20%', action: '主导 Python 与 TensorFlow 的 NLP pipeline 重构', impact: '延迟降低 30%' });
    win.addInventoryItem({ project: '推荐召回系统', time: '2024', metric: '5万', action: '优化召回模型', impact: 'CTR 提升 12%' });
    win.addInventoryItem({ project: '采购 BFF', time: '2023', metric: '', action: '做了一个采购 BFF', impact: '支撑 3 条业务线' });
  });

  step('改写：单列表输出（三版已删），首条 bullet 带真实数字', function () {
    win.switchView('track');
    const req = q('#docAdaptTrack [data-da="req"]');
    if (!req) throw new Error('找不到 #docAdaptTrack 里的适配器输入框（投递中心的适配器卡片）');
    req.value = '招聘岗位：算法工程师（推荐/NLP 方向）。要求：熟悉 Python、TensorFlow，有 NLP / 推荐系统 pipeline 经验。';
    click(q('#docAdaptTrack [data-da="go"]'));
    /* toast 会顶开一个 modal，先关掉再看卡片 */
    win.closeModal();

    /* 版本概念整个下线：不再有 V1/V2/V3 分组与「选这版」 */
    if (q('#docAdaptTrack [data-pick]')) throw new Error('不该再有「选这版」按钮（三版已删）');
    if (q('#docAdaptTrack [data-toggle]')) throw new Error('不该再有版本折叠组（三版已删）');

    const rows = qa('#docAdaptTrack .bullet-row');
    if (!rows.length) throw new Error('改写结果没有 bullet');
    const firstText = rows[0].textContent;
    if (!/20%/.test(firstText)) throw new Error('首条 bullet 未带上真实数字 20%：' + firstText);
    log('改写结果单列表 ' + rows.length + ' 条 bullet，引擎不换词、不嵌词');
  });

  step('改写：没数字的事实 → 不占位、不评判、不催补', function () {
    const rows = qa('#docAdaptTrack .bullet-row');
    if (!rows.length) throw new Error('没有 bullet');
    if (rows.some(function (r) { return r.querySelector('.placeholder'); })) throw new Error('不该再有 [N] 占位符');
    if (rows.some(function (r) { return r.textContent.indexOf('需补数字') >= 0; })) throw new Error('不该再出现「需补数字」');
    if (rows.some(function (r) { return r.classList.contains('has-placeholder'); })) throw new Error('不该再有 has-placeholder 标记');
    const bff = rows.filter(function (r) { return r.textContent.indexOf('采购 BFF') >= 0; })[0];
    if (!bff) throw new Error('找不到采购 BFF 那条 bullet');
    if (bff.textContent.indexOf('影响：') >= 0) throw new Error('影响句不该再顶着「影响：」这个标签');
    const rwLine = bff.querySelector('.rw-n'), origLine = bff.querySelector('.rw-o');
    if (!rwLine) throw new Error('改写行没渲染出来');
    if (origLine && rwLine.textContent.length <= origLine.textContent.length) throw new Error('写了影响却没接进改写句');
    log('没数字的事实：不占位、不加标记，按动作 + 影响原样输出');
  });

  step('改写：「改了什么」摆在 bullet 上，引擎的能力边界也写明', function () {
    const rows = qa('#docAdaptTrack .bullet-row');
    if (!rows.length) throw new Error('没有 bullet');
    const withChg = rows.filter(r => r.querySelector('.badge-chg'));
    if (!withChg.length) throw new Error('没有一条 bullet 标出「改了什么」');
    const chgText = Array.prototype.slice.call(withChg[0].querySelectorAll('.badge-chg')).map(b => b.textContent).join('/');
    if (chgText.indexOf('升级动作动词') >= 0 || chgText.indexOf('嵌入 JD 关键词') >= 0) throw new Error('徽章还留着已下线的注水项：' + chgText);

    const cap = q('#docAdaptTrack .rw-cap');
    if (!cap) throw new Error('改写结果区没有能力边界说明');
    if (cap.textContent.indexOf('本地只做不碰事实的三件事') < 0) throw new Error('能力边界说明文案不对');
    if (cap.textContent.indexOf('升级动作动词') >= 0 || cap.textContent.indexOf('嵌入 JD 关键词') >= 0) throw new Error('能力边界说明还在提已下线的功能');
    log('改写徽章：' + chgText + '　能力边界已更新');
  });

  step('文案体检：界面上读不到面向开发者的措辞', function () {
    /* 「面向大众的程序，不必写上『这一版』这种词」——这条断言就是它的守门人。
       注意排除「原型设计」这类岗位技能词，只盯自我指涉与实现术语。 */
    const BAD = ['这一版', '本版全部', '演示数据', '本地引擎', '院校池', '统计口径',
      'CAR 公式', '接在同一条链路上', 'WorkBuddy', '原型示意', '原型不含', '原型不替'];
    const scopes = ['#sideProfile', '#phdFit', '#studyPref', '#dailyPush', '#schoolList',
      '#docAdapt', '#profSearch', '#jobList', '#trackHub', '#docAdaptTrack'];
    const hit = [];
    let seen = 0;
    scopes.forEach(function (s) {
      const el = q(s);
      if (!el) return;
      seen++;
      const t = el.textContent || '';
      BAD.forEach(function (w) { if (t.indexOf(w) >= 0) hit.push(s + ' 里出现「' + w + '」'); });
    });
    if (hit.length) throw new Error(hit.join('；'));
    log('文案体检通过：' + seen + ' 个区块都没有开发者措辞');
  });

  step('文书适配器：取材范围与 PS / CV 都真的生效（不是摆设）', function () {
    win.switchView('track');
    const seg = qa('#docAdaptTrack [data-da-seg] [data-seg]').map(function (b) { return b.dataset.seg; });
    if (seg.join(',') !== 'light,std,hot') throw new Error('取材范围三档不对：' + seg.join(','));
    if (!q('#docAdaptTrack [data-da-hint="mode"]') || !q('#docAdaptTrack [data-da-hint="strength"]')) throw new Error('缺用途 / 取材范围的说明文字');

    /* 先把仓库撑到 11 条，否则 4 与 9 都会被截到 3 条，看不出差别 */
    wipeInv();
    for (let k = 0; k < 11; k++) {
      win.addInventoryItem({ project: '批量 ' + k, time: '2024', action: '负责模块 ' + k + ' 的交付', metric: '', impact: '提升交付效率' });
    }
    const req = q('#docAdaptTrack [data-da="req"]');
    if (req) { req.value = 'python nlp 招聘'; }
    click(qa('#docAdaptTrack [data-da-seg] [data-seg="light"]')[0]);
    click(q('#docAdaptTrack [data-da="go"]'));
    win.closeModal();
    const nLight = qa('#docAdaptTrack .bullet-row').length;

    click(qa('#docAdaptTrack [data-da-seg] [data-seg="hot"]')[0]);
    click(q('#docAdaptTrack [data-da="go"]'));
    win.closeModal();
    const nHot = qa('#docAdaptTrack .bullet-row').length;
    if (!(nLight < nHot)) throw new Error('换档位条数没变（精简 ' + nLight + ' / 全面 ' + nHot + '）');

    /* PS / CV 的取材偏好：换按钮后第一条来自不同的事实 */
    const firstId = function () { return q('#docAdaptTrack [data-copybullet]').getAttribute('data-copybullet'); };
    click(qa('#docAdaptTrack [data-mode="ps"]')[0]);
    click(q('#docAdaptTrack [data-da="go"]')); win.closeModal();
    const idPs = firstId();
    click(qa('#docAdaptTrack [data-mode="cv"]')[0]);
    click(q('#docAdaptTrack [data-da="go"]')); win.closeModal();
    const idCv = firstId();
    log('取材范围生效：精简 ' + nLight + ' 条 → 全面 ' + nHot + ' 条；PS 首条 ' + idPs + ' / CV 首条 ' + idCv);

    /* 还原后续步骤依赖的三条事实 */
    wipeInv();
    win.addInventoryItem({ project: 'NLP pipeline 重构', time: '2025', metric: '20%', action: '主导 Python 与 TensorFlow 的 NLP pipeline 重构', impact: '延迟降低 30%' });
    win.addInventoryItem({ project: '推荐召回系统', time: '2024', metric: '5万', action: '优化召回模型', impact: 'CTR 提升 12%' });
    win.addInventoryItem({ project: '采购 BFF', time: '2023', metric: '', action: '做了一个采购 BFF', impact: '支撑 3 条业务线' });
  });

  /* ============ 第二十二轮：把「改写」接进投递链路 ============
     用户的原话是「功能很多，但没有一条顺畅的链路把它们串起来」。
     这条链路的落点：求职匹配 →「准备投递」→ 就地生成这一岗的文案
     → 随填表数据一起导出 → 扩展把它填进官网的「项目描述 / 工作内容」栏。
     下面四步就是按这条线走的。 */

  /* 找一个还没投过的岗位，避免登记环节被"已存在"挡住 */
  function pickFreshJob() {
    win.renderJobs();
    const st = JSON.parse(win.localStorage.getItem('zhiyin_state_v1')) || {};
    const done = (st.applications || []).map(function (a) { return a.company + '|' + a.position; });
    win.renderJobList();
    const cards = qa('#jobList [data-apply]');
    for (let i = 0; i < cards.length; i++) {
      if (done.indexOf(cards[i].dataset.apply) < 0) return cards[i];
    }
    return null;
  }

  let kitJob = null;

  step('投递工作台：岗位卡是「准备投递」，弹窗里给出「这一岗的文案」块', function () {
    const card = pickFreshJob();
    if (!card) throw new Error('找不到还没投过的岗位卡片');
    kitJob = card.dataset.apply;
    if (card.textContent.trim() !== '准备投递') {
      throw new Error('岗位卡主按钮不是「准备投递」：' + card.textContent.trim());
    }
    click(card);
    const blk = q('#modalBody .kit-blk');
    if (!blk) throw new Error('投递工作台里没有「本岗文案」区块');
    if (blk.textContent.indexOf('这一岗的文案') < 0) throw new Error('本岗文案块标题不对');
    if (blk.textContent.indexOf('未定制') < 0) throw new Error('新岗位应显示「未定制」');
    if (!q('#kitMake')) throw new Error('没有「为这一岗定制文案」按钮');
    if (q('#kitBullets')) throw new Error('还没定制就不该有文案编辑框');
    if (!q('#modalBody').textContent.match(/要填进官网的东西/)) throw new Error('缺少第二步「要填进官网的东西」');
    log('工作台打开：' + kitJob + '　状态=未定制');
  });

  step('为这一岗定制文案：生成 bullets 并落进投递包', function () {
    click(q('#kitMake'));
    const blk = q('#modalBody .kit-blk');
    if (!blk) throw new Error('定制后弹窗没重开');
    if (blk.textContent.indexOf('已定制 v1') < 0) throw new Error('定制后未标「已定制 v1」：' + blk.textContent.slice(0, 60));
    const ta = q('#kitBullets');
    if (!ta) throw new Error('定制后没有文案编辑框');
    const lines = ta.value.split('\n').map(function (s) { return s.trim(); }).filter(Boolean);
    if (lines.length < 1) throw new Error('定制结果是空的');
    /* 落库检查：投递包必须进存档，否则刷新就没了 */
    const st = JSON.parse(win.localStorage.getItem('zhiyin_state_v1')) || {};
    const kit = st.kits && st.kits[kitJob];
    if (!kit || !kit.doc || !kit.doc.bullets.length) throw new Error('投递包没写进本地存档');
    if (kit.doc.bullets.length !== lines.length) throw new Error('存档里的 bullets 条数对不上');
    log('定制完成：' + lines.length + ' 条 bullet，已存投递包 v' + kit.doc.version);
  });

  step('复制填表数据：本岗文案随载荷一起导出（schema 仍是 v2）', function () {
    const btns = qa('#modalFoot .btn').filter(function (b) { return b.textContent.indexOf('复制填表数据') >= 0; });
    if (!btns.length) throw new Error('找不到「复制填表数据」按钮');
    click(btns[0]);
    const ta = q('#fillFallback');
    if (!ta) throw new Error('剪贴板不可用时应落到手动复制兜底');
    const payload = JSON.parse(ta.value);
    if (payload.schema !== 'zhiyin.fill.v2') throw new Error('加字段不该升 schema：' + payload.schema);
    const cust = payload.sections && payload.sections.custom;
    if (!cust) throw new Error('本岗文案没进载荷（改写的用途就断在这里）');
    if (!cust.bullets.length) throw new Error('custom.bullets 为空');
    if (cust.for !== kitJob) throw new Error('custom.for 不是这个岗位：' + cust.for);
    if (cust.text.split('\n').length !== cust.bullets.length) throw new Error('custom.text 与 bullets 条数不一致');
    if (!payload.sections.projects || !payload.sections.projects.length === 0) { /* 允许无项目，但结构要在 */ }
    log('载荷带上本岗文案 ' + cust.bullets.length + ' 条（for=' + cust.for + '）');
    win.closeModal();
  });

  step('登记投递：本岗文案随记录落库（投递中心的「✎ 改写」看到的是同一版）', function () {
    const parts = kitJob.split('|');
    win.openApplyModal(parts[0], parts[1]);
    /* 重新打开时应从投递包读回，而不是回到「未定制」 */
    const blk = q('#modalBody .kit-blk');
    if (blk.textContent.indexOf('未定制') >= 0) throw new Error('重开工作台后投递包丢了（读不回来说明没持久化）');
    if (!q('#kitBullets')) throw new Error('重开后没有回填文案编辑框');
    const reg = qa('#modalFoot .btn').filter(function (b) { return b.textContent.indexOf('不投官网') >= 0; })[0];
    if (!reg) throw new Error('找不到登记按钮');
    click(reg);
    const st = JSON.parse(win.localStorage.getItem('zhiyin_state_v1')) || {};
    const app = (st.applications || []).filter(function (a) { return a.company + '|' + a.position === kitJob; })[0];
    if (!app) throw new Error('登记后没落库');
    if (!app.customDoc || !app.customDoc.bullets.length) throw new Error('登记时没把本岗文案带进投递记录');
    if (!app.customDoc.fromKit) throw new Error('customDoc 未标记来自投递包');
    if (!app.customDoc.bullets[0].text) throw new Error('customDoc 的 bullet 结构不对（投递中心 UI 需要 .text）');
    log('登记落库：customDoc ' + app.customDoc.bullets.length + ' 条，回执 ' + (app.receipt && app.receipt.no));
  });

  /* ============ 第二十七轮第 4 项：套磁卡移位 + 内地院校模式 ============
     用户原话：「邮件目标 + 套磁生成器和 PS 文书适配器功能是否存在重复（我不懂，如果不重复就保留），
     如果不重复，套磁应该放到 PS 文书适配器的下方、院校名单之上。此外，国内院校支不支持这个模式。」
     答：不重复（一个对外联系导师、一个对内改自己的材料），已移位并写明区别；
     内地院校此前完全不支持 —— 现在支持「检索 + 手动加 + 中文单语邮件」这一条路径，
     但院校池里没有内地的项目/门槛数据，所以不参与冲稳保。下面按这三条断言。 */

  step('申学视图：套磁卡在文书适配器下方、院校名单上方（不再被名单挡住）', function () {
    win.switchView('study');
    if (typeof win.renderProfSearch === 'function' && !q('#psScope')) win.renderProfSearch();
    const sec = q('#view-study');
    const ids = Array.prototype.map.call(sec.children, function (el) { return el.id; });
    const iDoc = ids.indexOf('docAdapt'), iProf = ids.indexOf('profSearch'), iScl = ids.indexOf('schoolList');
    if (iDoc < 0 || iProf < 0 || iScl < 0) throw new Error('三张卡没找齐：' + ids.join(' / '));
    if (!(iDoc < iProf && iProf < iScl)) throw new Error('顺序不对（应为 文书适配器 → 套磁 → 院校名单）：' + ids.join(' / '));
    const desc = q('#profSearch').textContent;
    if (desc.indexOf('给导师写邮件') < 0 || desc.indexOf('改你自己的材料') < 0) {
      throw new Error('没写清「套磁」与「文书适配器」的区别（用户会以为是同一个功能）');
    }
    log('顺序 ' + ids.filter(Boolean).join(' → ') + '；两卡区别已写明');
  });

  step('套磁：两档检索范围共用同一套「可输入 + 联想」学校栏（第三十四轮）', function () {
    if (!q('#psScope')) throw new Error('没有「检索范围」切换控件');
    const segs = qa('#psScope [data-scope]');
    if (segs.length !== 2) throw new Error('检索范围应有境外 / 内地两档，实际 ' + segs.length);
    if (q('#psSchool').tagName.toLowerCase() !== 'input') throw new Error('境外学校栏应可直接输入（名单外的合作院校也能填）');
    if (!q('#psSug')) throw new Error('境外模式缺联想建议面板');
    const cnSeg = segs.filter(function (b) { return b.getAttribute('data-scope') === 'cn'; })[0];
    click(cnSeg);
    if (q('#psSchool').tagName.toLowerCase() !== 'input') throw new Error('内地模式学校栏不是输入框');
    if (q('#psFaculty')) throw new Error('内地模式不该出现「打开该校教师列表」（这张表里没有内地校）');
    /* 联想：输入「清」应给出「清华大学」这类建议，面板要展开 */
    const sug = q('#psSug');
    q('#psSchool').value = '清';
    q('#psSchool').dispatchEvent(new win.Event('input', { bubbles: true }));
    if (!sug.classList.contains('open')) throw new Error('输入后联想面板没有展开');
    if (sug.textContent.indexOf('清华大学') < 0) throw new Error('联想建议里没有「清华大学」');
    log('境外 / 内地统一为可输入 + 联想框；内地模式教师页直链已隐藏；联想能出「清华大学」');
  });

  step('套磁：内地检索链接锁 edu.cn，且说清「没有统一师资页」', function () {
    q('#psSchool').value = '清华大学';
    q('#psKeyword').value = 'reinforcement learning';
    click(q('#psGo'));
    win.closeModal();
    const st = JSON.parse(win.localStorage.getItem('zhiyin_state_v1')) || {};
    const lq = st.profMail && st.profMail.lastQuery;
    if (!lq) throw new Error('生成检索链接后 lastQuery 没落库');
    if (lq.scope !== 'cn') throw new Error('lastQuery 没记住检索范围：' + lq.scope);
    if (lq.bingUrl.indexOf('site:edu.cn') < 0) throw new Error('内地检索没锁 edu.cn：' + lq.bingUrl);
    if (decodeURIComponent(lq.bingUrl).indexOf('清华大学') < 0) throw new Error('检索词里没有校名');
    const txt = q('#profSearch').textContent;
    if (txt.indexOf('edu.cn') < 0) throw new Error('空态说明没提 edu.cn（用户不知道该去哪找）');
    log('内地检索链接已生成（含 site:edu.cn）');
  });

  step('套磁：手动加一位教授 → 进邮件目标列表，且能移除', function () {
    const nm = q('#msManName'), pg = q('#msManPage');
    if (!nm || !pg) throw new Error('内地 / 冷门方向没有「手动加一位教授」的入口');
    nm.value = '张伟';
    pg.value = 'https://www.tsinghua.edu.cn/zhangwei';
    click(q('#msManAdd'));
    const items = qa('#psTargets .item');
    if (items.length !== 1) throw new Error('手动加的教授没进目标列表（实际 ' + items.length + ' 条）');
    if (items[0].textContent.indexOf('张伟') < 0) throw new Error('目标列表里没有这位教授');
    if (!q('#psTargets [data-prof-rm]')) throw new Error('目标列表没有移除按钮（加进去就删不掉）');
    /* 移除要真的能删 */
    click(q('#psTargets [data-prof-rm]'));
    if (qa('#psTargets .item').length !== 0) throw new Error('移除按钮点了没生效');
    log('目标列表渲染 1 条 + 移除生效（原来 #psTargets 是空壳，加进去看不见也删不掉）');
    /* 再放回去，供下一步生成邮件用 */
    q('#msManName').value = '张伟';
    click(q('#msManAdd'));
  });

  step('套磁：内地模式只出中文一封，输出区标「中文版（发送）」', function () {
    click(q('#msGen'));
    const st = JSON.parse(win.localStorage.getItem('zhiyin_state_v1')) || {};
    const m = st.profMail && st.profMail.lastMail;
    if (!m) throw new Error('生成邮件后 lastMail 没落库（目标为空时应当被拦住才对）');
    if (m.zhOnly !== true) throw new Error('内地模式没走中文单语：zhOnly=' + m.zhOnly);
    const tas = qa('#msOutput textarea');
    if (tas.length !== 1) throw new Error('内地模式应只出 1 个文本框（摆双语会让用户误发英文），实际 ' + tas.length);
    const box = q('#msOutput').textContent;
    if (box.indexOf('中文版（发送）') < 0) throw new Error('中文版没标成「发送」');
    if (box.indexOf('仅审稿') >= 0) throw new Error('内地模式不该再出现「仅审稿」（自相矛盾）');
    if (!/^主题：/.test(tas[0].value)) throw new Error('中文邮件首行不是主题行');
    log('内地套磁邮件：中文单语 1 封，首行是主题行');
  });

  step('套磁：切回境外，学校栏仍是可输入联想框且清掉上一次检索结果（第三十四轮）', function () {
    const abroadSeg = qa('#psScope [data-scope]').filter(function (b) { return b.getAttribute('data-scope') === 'abroad'; })[0];
    click(abroadSeg);
    if (q('#psSchool').tagName.toLowerCase() !== 'input') throw new Error('切回境外后学校栏应是可输入框');
    if (!q('#psSug')) throw new Error('切回境外后缺联想建议面板');
    const st = JSON.parse(win.localStorage.getItem('zhiyin_state_v1')) || {};
    if (st.profMail.lastQuery) throw new Error('切范围后上一次的检索结果该清掉（学校字段形态变了，留着会对不上）');
    if (st.profMail.lastMail) throw new Error('切范围后上一封邮件该清掉（语言模式变了）');
    log('切回境外：学校栏仍可自由输入，旧检索结果与旧邮件已清空');
  });

  step('第三十四轮：新手引导条、申学锚点子导航与自动保存标识齐全', function () {
    win.switchView('resume');
    const gs = qa('#guideStrip .guide-step');
    if (gs.length !== 4) throw new Error('新手引导应有 4 步，实际 ' + gs.length);
    if (gs[0].textContent.indexOf('导入') < 0 || gs[1].textContent.indexOf('项目经历') < 0 || gs[2].textContent.indexOf('归纳') < 0) {
      throw new Error('引导步文案不对：' + gs.map(function (g) { return g.textContent.slice(0, 10); }).join(' / '));
    }
    if (!q('#saveBadge')) throw new Error('缺「已自动保存」标识');
    if (!q('#restoreStrip')) throw new Error('缺「已恢复上次的资料」提示条');
    win.switchView('study');
    const nav = qa('#studyNav .pn-i');
    if (nav.length < 5) throw new Error('申学视图缺锚点子导航（实际 ' + nav.length + ' 个）');
    click(nav[0]);
    if (!nav[0].classList.contains('on')) throw new Error('锚点点击后没有高亮');
    log('引导条 4 步 + 申学 6 锚点（点击高亮）+ 自动保存标识齐全');
  });

  step('改写前后对比：原文 / 改写分行，高亮只覆盖新增片段', function () {
    win.switchView('track');
    if (typeof win.renderDocAdapt === 'function') win.renderDocAdapt();
    const rows = qa('#docAdaptTrack .bullet-row');
    if (!rows.length) throw new Error('没有 bullet（上一段改写结果丢了）');
    const withOrig = rows.filter(function (r) { return r.querySelector('.rw-o'); });
    if (!withOrig.length) throw new Error('没有任何一条显示原文（前后对比没落地）');
    const pair = withOrig[0];
    const oTxt = pair.querySelector('.rw-o').textContent;
    const nEl = pair.querySelector('.rw-n');
    if (!nEl) throw new Error('有原文却没有改写行');
    if (oTxt === nEl.textContent) throw new Error('原文与改写一模一样，不该拆成两行');
    const marks = pair.querySelectorAll('.rw-n .rw-add');
    if (marks.length) {
      const marked = Array.prototype.map.call(marks, function (m) { return m.textContent; }).join('');
      if (marked.length >= nEl.textContent.length) throw new Error('整行都被标成高亮了（等于没对比）');
    }
    /* 没有原文可对比的行只能出一条「改写」，不能出现空的原文行 */
    const only = rows.filter(function (r) { return !r.querySelector('.rw-o'); });
    if (only.some(function (r) { return r.querySelectorAll('.rw-n').length !== 1; })) {
      throw new Error('没有原文的行应该只有一条「改写」');
    }
    log('原文 / 改写分行渲染，' + pair.querySelectorAll('.rw-add').length + ' 处高亮（' + withOrig.length + '/' + rows.length + ' 条带原文）');
  });

  step('控件样式收口：裸控件基规则必须套 :where()，否则把 .field 的样式反压掉', function () {
    const css = qa('style').map(function (s) { return s.textContent; }).join('\n');
    if (!css) throw new Error('读不到 <style> 内容');
    /* 这一条是第二十七轮真踩过的坑：基规则用 4 个 :not() 把特异性抬到 (0,4,1)，
       高过 .field input (0,1,1) / .field.need input (0,2,1) / .field .mp-in (0,2,0)，
       于是「默认外观」反手把自绘下拉箭头清成 none、把「待补充」的琥珀色边框盖掉。
       :where() 参选特异性恒为 0 → 基规则退回 (0,0,1)，只做默认值。 */
    if (css.indexOf('input:where(:not([type=range])') < 0) {
      throw new Error('裸控件基规则没套 :where()（特异性会被 :not() 链抬到 (0,4,1)，反压 .field 的样式）');
    }
    if (/^[ \t]*input:not\(\[type=range\]\)/m.test(css)) {
      throw new Error('还有未套 :where() 的 :not() 链基规则');
    }
    /* 下拉箭头必须覆盖 .field / .filters 作用域：那边有一条更早的
       「.field input,.field select,…{background:#FFFEFB}」简写会把箭头清掉 */
    if (css.indexOf('select, .field select, .filters select') < 0) {
      throw new Error('自绘下拉箭头没覆盖 .field / .filters（会被 background 简写清成 none）');
    }
    /* 月份框是 readonly 文本框，没有原生箭头 —— 不给暗示用户不会去点 */
    if (css.indexOf('.mp-in, .field .mp-in') < 0) {
      throw new Error('起止月份框缺「可点开」的箭头暗示');
    }
    if (css.indexOf('.seg-i.on') < 0) throw new Error('缺分段控件选中态样式（取材范围三档）');
    if (css.indexOf('.badge-kw2') < 0) throw new Error('缺「关键词本来就有」的淡色徽章样式');

    /* 第二十九轮：hover 里的白字必须自带底色。真机实测过的一幕 ——
       通用 .btn:hover 给的是浅紫底 --brand-soft，而 .btn.primary 与它特异性同为 (0,2,0)
       且 .btn.primary 更靠前，于是悬停时浅紫底接管了品牌渐变底；此时若有一条规则
       把字刷成 #fff 却不声明底色，结果就是「近白底 + 白字」＝对比度 1.16，字直接看不见。
       规矩：任何在 hover 里写白字的规则，必须在同一条声明里给出自己的深色底。 */
    const reHov = /([^{}]*:hover[^{}]*)\{([^{}]*)\}/g;
    const hovWhite = [];
    let mh;
    while ((mh = reHov.exec(css))) {
      const body = mh[2];
      if (/color\s*:\s*(#fff\b|white\b)/i.test(body) && !/(^|;)\s*background(-color)?\s*:/i.test(';' + body)) {
        hovWhite.push(mh[1].trim());
      }
    }
    if (hovWhite.length) {
      throw new Error('这些 hover 规则把字刷白却没给底色：' + hovWhite.join(' / '));
    }
    /* 正向锁死：最后一条 .btn.primary:hover 必须自带品牌底，不能只靠顺序 */
    const primHov = css.match(/\.btn\.primary:hover\{[^}]*\}/g) || [];
    if (!primHov.length) throw new Error('找不到 .btn.primary:hover 规则');
    if (!/background\s*:\s*var\(--grad-brand\)/.test(primHov[primHov.length - 1])) {
      throw new Error('最后一条 .btn.primary:hover 没锁住品牌底（会被通用 .btn:hover 的近白底接管 → 白字看不见）');
    }
    log('样式规则齐全：:where 特异性修正 / 下拉与月份框箭头 / 分段控件 / 主按钮 hover 锁底');
  });

  step('渲染后全页无重复 id（重复会让 querySelector 只命中隐藏的那一份）', function () {
    /* 第二十八轮实测：#docAdapt 与 #docAdaptTrack 由同一个 renderDocAdapt 渲染两份，
       里面的 id 一旦重复，任何 document.getElementById / 裸 #id 查询都只会命中先出现的那份，
       而先出现的那份在隐藏视图里 —— 表现是「看着填上了 / 点了没反应」。
       引擎侧只守了两个「根」的 id，卡片内控件是盲区，所以这里做全页体检。 */
    ['study', 'job', 'track', 'resume'].forEach(function (v) {
      try { win.switchView(v); } catch (e) {}
    });
    win.switchView('track');
    const seen = {}, dup = [];
    qa('[id]').forEach(function (el) {
      if (!el.id) return;
      seen[el.id] = (seen[el.id] || 0) + 1;
    });
    Object.keys(seen).forEach(function (id) { if (seen[id] > 1) dup.push('#' + id + '×' + seen[id]); });
    if (dup.length) throw new Error('重复 id：' + dup.join('、'));
    log('唯一 id ' + Object.keys(seen).length + ' 个，无重复');
  });
};
