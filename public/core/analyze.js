/* ============================================================
 * 断卦符号层 (core/analyze.js)
 * 规则判定链：每条规则独立成函数（可单测），输出结构化 judgments[]。
 * 依据《增删卜易》《卜筮正宗》主流传世规则，专凭五行生克，不用神煞。
 *
 * 设计原则（M3）：
 *  - 废弃评分制：本文件禁止出现任何 score 加减
 *  - trend 由规则汇聚表驱动，非算术和
 *  - 暗动闭环：静爻被日冲，先查月令旺衰（旺相=暗动，休囚=日破）
 *  - 只出应期线索（yingqiClues），不下应期结论
 * M16 新增三族陈述层规则（卦型 / 生旺墓绝 / 元神忌神仇神），均依定本回溯落地，
 * 按纳入准则只陈述、不入 trend（吉凶随占类翻转或与既有五行判定维度重叠）。
 * ============================================================ */
(function (root) {
  const LY = root.LY = root.LY || {};
  const ZHI = LY.ZHI, ZHI_WX = LY.ZHI_WX, LINE_NAMES = LY.LINE_NAMES;
  const GAN = LY.GAN;
  const sheng = LY.sheng, ke = LY.ke, chong = LY.chong, liuhe = LY.liuhe;

  const GRADES = ['旺', '相', '休', '囚', '死'];
  /* M18（任务⑥）：取用神两现口径开关（模式照抄 calendar.js 的 LY.nightZiMode 三件套）。
   * LY.ysDupMode = 'priority'（默认）：两现/多现按通行次序取舍——
   *   发动者 → 临世应者 → 旺者 → 在前之爻，空破不入取舍维度（古法次序，test-rules §11·六 锁定）。
   * LY.ysDupMode = 'kongpo'：《增删卜易·两现章第三十二》野鹤法——两现遇空破，
   *   「舍其不空而用旬空」「用逢破之爻」，以空破之爻为【应期之锚】；
   *   主用爻与吉断仍按次序链，两派并置陈述（仅新增一条带门派标注的陈述层断语，
   *   不改 pickYongshen、不改 trend——依据：01406 野鹤吉断仍用旺者未财，空者辰土承担应期）。
   * ============================================================ */
  LY.ysDupMode = 'priority'; // 'priority' | 'kongpo'
  const STRONG = ['旺', '相'];   // 旺相
  const WEAK = ['休', '囚', '死']; // 休囚

  // 五行关系：以 myWx（我）为主体，返回「我」对 otherWx（彼）的状态（五值完备，供各规则共用）
  //   '比和'（同五行）｜'得生'（彼生我）｜'受克'（彼克我）｜'泄'（我生彼，泄气）｜'耗'（我克彼，力耗）
  // 五行两两之间必居其一，故本函数对所有输入都有确定返回值——
  // 各规则禁止再用 else 兜底猜「非生非克即某关系」（同五行不同支会被吞掉）。
  // ⚠️ 切勿与下面的 relationText 记混：relationText 的文案是「彼对我做了什么」的旧版命名，视角相反。
  function relation5(myWx, otherWx) {
    if (myWx === otherWx) return '比和';
    if (sheng(otherWx, myWx)) return '得生';
    if (ke(otherWx, myWx)) return '受克';
    if (sheng(myWx, otherWx)) return '泄';
    if (ke(myWx, otherWx)) return '耗';
    return '比和'; // 不可达：五行关系完备，兜底防脏数据
  }

  // ---------- 规则 1：取用神 ----------
  // target: '妻财'|'官鬼'|'父母'|'子孙'|'兄弟'|'shi'
  // 返回 { primary, all, source: '本卦'|'伏神'|'两现取舍'|null, note }
  function pickYongshen(pan, target) {
    if (target === 'shi') {
      return { primary: pan.lines[pan.shi], all: [pan.lines[pan.shi]], source: '世爻', note: '所测为自身，以世爻为用神' };
    }
    const found = pan.lines.filter(function (l) { return l.lq === target; });
    if (found.length === 0) {
      // 伏神多现：按古法次序取——临世应者 → 月令旺相者 → 在前之爻
      // （旧版 find 取首个匹配，与 ruleFu/ruleShi 的解读口径不一致）
      const fus = pan.lines.filter(function (l) { return l.fu && l.fu.lq === target; });
      if (!fus.length) return { primary: null, all: [], source: null, note: '卦中无' + target + '，亦无伏神，宜另择用神' };
      const mz0 = pan.pillars ? pan.pillars.monthZhi : 0;
      const makeFu = function (fl) {
        return Object.assign({}, fl, {
          gan: fl.fu.gan, zhi: fl.fu.zhi, wx: fl.fu.wx, zhiIdx: fl.fu.zhiIdx,
          lq: target, isFu: true, moving: false, bian: null
        });
      };
      let host = fus.filter(function (l) { return l.pos === pan.shi || l.pos === pan.ying; })[0];
      let why = '临世应者';
      if (!host) {
        const best = fus.map(function (l) {
          const g = wangXiangXiuQiuSi(l.fu.wx, mz0);
          const r = GRADES.indexOf(g);
          return { l: l, g: g, rank: r < 0 ? GRADES.length : r };
        }).sort(function (a, b) { return a.rank - b.rank; });
        host = best[0].l;
        why = best.length > 1 && best[0].rank === best[1].rank
          ? '在前之爻（皆不临世应且月令旺衰相同）'
          : '月令' + ZHI[mz0] + '下旺相者（' + best[0].g + '）';
      }
      const fuLine = host;
      const v = makeFu(fuLine);
      return {
        primary: v, all: fus.map(makeFu), source: '伏神',
        note: '用神' + target + '不上卦，取伏神' + target + (fuLine.fu.gan || '') + fuLine.fu.zhi + '（伏于' + LINE_NAMES[fuLine.pos] + '，飞神' + fuLine.lq + fuLine.zhi +
          (fus.length > 1 ? '；伏神' + fus.length + '现，取' + why : '') + '）'
      };
    }
    if (found.length === 1) {
      return { primary: found[0], all: found, source: '本卦', note: '用神' + target + (found[0].gan || '') + found[0].zhi + '（' + LINE_NAMES[found[0].pos] + '）' };
    }
    // 两现取舍（古法次序）：发动者 → 临世应者 → 旺者 → 在前之爻
    let pick = found.find(function (l) { return l.moving; });
    let how = '发动者';
    if (!pick) { pick = found.find(function (l) { return l.shi || l.ying; }); how = '临世应者'; }
    if (!pick) {
      // 皆静且不临世应：按月令旺相休囚死比较取旺者（旺＞相＞休＞囚＞死）
      const mz = pan.pillars ? pan.pillars.monthZhi : 0;
      const scored = found.map(function (l) {
        const g = wangXiangXiuQiuSi(l.wx, mz);
        return { l: l, g: g, rank: GRADES.indexOf(g) < 0 ? GRADES.length : GRADES.indexOf(g) };
      });
      const bestRank = Math.min.apply(null, scored.map(function (s) { return s.rank; }));
      const best = scored.filter(function (s) { return s.rank === bestRank; });
      if (best.length === 1) {
        pick = best[0].l;
        how = '月令' + ZHI[mz] + '下之旺者（' + best[0].g + '，另一现为' +
          scored.filter(function (s) { return s !== best[0]; }).map(function (s) { return s.g; }).join('/') + '）';
      } else {
        pick = found[0];
        how = '在前之爻（皆静不临世应，且月令旺衰相同' + (best[0].g ? '，同为' + best[0].g : '') + '，姑取初现）';
      }
    }
    return {
      primary: pick, all: found, source: '两现取舍',
      note: '用神' + target + '两现，古法宜取' + how + '为主，余为辅——今取' + LINE_NAMES[pick.pos] + (pick.gan || '') + pick.zhi + '为主'
    };
  }

  // ---------- 规则 2：月建档（旺相休囚死） ----------
  // 以月令当令五行为纲：当令者旺，令生者相，生令者休，克令者囚，令克者死
  function wangXiangXiuQiuSi(lineWx, monthZhiIdx) {
    const mWx = ZHI_WX[monthZhiIdx];
    if (lineWx === mWx) return '旺';
    if (sheng(mWx, lineWx)) return '相';
    if (sheng(lineWx, mWx)) return '休';
    if (ke(lineWx, mWx)) return '囚';
    if (ke(mWx, lineWx)) return '死';
    return '';
  }

  function nameOf(L, target) {
    return (target === 'shi' ? '世爻' : '用神') + L.zhi + L.wx + '（' + LINE_NAMES[L.pos] + '）';
  }

  // 月建对用神的作用（事实陈述，不与月破叠加扣减——只有事实，没有扣减）
  function ruleMonth(L, pil, target) {
    const js = [];
    const mz = pil.monthZhi, mWx = ZHI_WX[mz];
    const grade = wangXiangXiuQiuSi(L.wx, mz);
    const nm = nameOf(L, target);
    const rel = relation5(L.wx, mWx);
    if (mz === L.zhiIdx) {
      js.push({ tag: '月建', rule: '临月建', text: nm + '临月建' + ZHI[mz] + '，当令最旺。', basis: '月建为提纲，临之则旺' });
    } else if (rel === '比和') {
      // 同五行不同支（如月建子水、用神亥水）：得月令同气之扶，非当令，亦非克耗
      js.push({
        tag: '月建', rule: '月建同气',
        text: nm + '与月建' + ZHI[mz] + '同属' + mWx + '，同气而扶（' + grade + '），虽不如临月建之当令，亦为得令有气。',
        basis: '月建同五行异支者，同气相扶而得令，不作克月建论'
      });
    } else if (rel === '得生') {
      js.push({ tag: '月建', rule: '月建生扶', text: nm + '得月建' + ZHI[mz] + mWx + '生扶（' + grade + '）。', basis: '得令者相' });
    } else if (rel === '受克') {
      js.push({ tag: '月建', rule: '月建克伤', text: nm + '被月建' + ZHI[mz] + mWx + '所克（' + grade + '），失令。', basis: '月建为提纲，克则衰' });
    } else if (rel === '泄') {
      js.push({ tag: '月建', rule: '泄气于月', text: nm + '生月建' + ZHI[mz] + mWx + '，泄气于时令（' + grade + '）。', basis: '生令者休' });
    } else if (rel === '耗') {
      // 用神克月建 = 耗气（与 ruleDay 的「耗于日辰」同口径，两处均显式写「耗」而不用 else 兜底）。
      // 旧版此处为 else：五值当时恰好穷举，故等价；但一旦 relation5 返回意外值就会被静默判成克月建。
      js.push({ tag: '月建', rule: '克月建', text: nm + '克月建' + ZHI[mz] + mWx + '，力耗于时令（' + grade + '）。', basis: '克令者囚' });
    }
    // 五值（比和/得生/受克/泄/耗）已穷举，故**不设 else 兜底**：
    // 宁可这一条不出断语，也不把未预期的关系静默判成「克月建」（ruleDay 同此处理）。
    return { grade: grade, judgments: js };
  }


  // ---------- 规则 3：月破（真假之辨） ----------
  function ruleYuePo(L, pil, grade, daySupports, target) {
    const js = [];
    if (!chong(L.zhiIdx, pil.monthZhi)) return { isPo: false, zhen: false, judgments: js };
    const nm = nameOf(L, target);
    const zhen = WEAK.indexOf(grade) >= 0 && !daySupports; // 休囚又无日辰生扶 = 真破
    js.push({
      tag: '月破', rule: zhen ? '真月破' : '月破有救（假破）',
      text: nm + '与月建' + ZHI[pil.monthZhi] + '相冲为月破' + (zhen ? '，休囚无救，真破难扶。' : '，' + (STRONG.indexOf(grade) >= 0 ? '旺相' : '得日辰生扶') + '为假破，出月或逢合、逢值之日可解。'),
      basis: '《增删卜易》：月破而旺相、得日辰生扶者，出月可用；休囚无救者真破'
    });
    return { isPo: true, zhen: zhen, judgments: js };
  }

  // ---------- 规则 4：日辰档 ----------
  function ruleDay(L, pil, target) {
    const js = [];
    const dz = pil.dayZhi, dWx = ZHI_WX[dz];
    const nm = nameOf(L, target);
    const rel = relation5(L.wx, dWx);
    let supports = false; // 日辰生扶与否（供月破真假判定）
    if (dz === L.zhiIdx) {
      supports = true;
      js.push({ tag: '日辰', rule: '临日辰', text: nm + '临日辰' + ZHI[dz] + '，得日主拱扶。', basis: '日辰为六爻之主宰，临之则旺' });
    } else if (rel === '得生') {
      supports = true;
      js.push({ tag: '日辰', rule: '日辰生扶', text: nm + '得日辰' + ZHI[dz] + dWx + '生扶。', basis: '日辰生用，衰亦有用' });
    } else if (rel === '受克') {
      js.push({ tag: '日辰', rule: '日辰克伤', text: nm + '被日辰' + ZHI[dz] + dWx + '所克。', basis: '日辰克用，旺相亦损' });
    } else if (rel === '泄') {
      js.push({ tag: '日辰', rule: '泄气于日', text: nm + '生日辰' + ZHI[dz] + dWx + '，泄气于日。', basis: '用神泄气，力量外散' });
    } else if (rel === '耗') {
      // 用神克日辰：耗气而非受克，更非比和拱扶（不可计入 daySupports）
      js.push({
        tag: '日辰', rule: '耗于日辰',
        text: nm + '克日辰' + ZHI[dz] + dWx + '，力耗于日，非受克亦非得扶，用神耗气则力减。',
        basis: '用神克日辰为耗气，不为拱扶，故月破真假、真空判定不以此作救'
      });
    } else {
      supports = true; // 比和亦为拱扶
      js.push({ tag: '日辰', rule: '日辰比和', text: nm + '与日辰' + ZHI[dz] + dWx + '比和拱扶。', basis: '比和者拱' });
    }
    return { supports: supports, judgments: js };
  }


  // ---------- 规则 5：日冲分支（暗动闭环的关键） ----------
  // 动爻被冲=冲散；静爻被冲：先查旺衰——旺相=暗动，休囚=日破
  function ruleDayChong(L, pil, grade, target) {
    const js = [];
    if (!chong(L.zhiIdx, pil.dayZhi)) return { kind: null, judgments: js };
    const nm = nameOf(L, target);
    const kong = pil.kong.indexOf(L.zhiIdx) >= 0;
    if (L.moving) {
      js.push({ tag: '日冲', rule: '冲散', text: nm + '发动而被日辰' + ZHI[pil.dayZhi] + '冲，动逢冲为冲散，事体恐有反复。', basis: '动而逢日冲则散' });
      return { kind: 'chongsan', judgments: js };
    }
    if (STRONG.indexOf(grade) >= 0) {
      js.push({
        tag: '日冲', rule: '暗动', kong: kong,
        text: nm + '安静而旺相，被日辰' + ZHI[pil.dayZhi] + '冲之，为暗动——事机已在暗中萌动，其应极速。' + (kong ? '惟爻值旬空，动而未实，出空之日方显。' : ''),
        basis: '《增删卜易》：旺相之爻被日辰冲之则暗动，暗动则有力'
      });
      return { kind: 'andong', judgments: js };
    }
    js.push({
      tag: '日冲', rule: '日破',
      text: nm + '安静而休囚，被日辰' + ZHI[pil.dayZhi] + '冲之，为日破，败象已成。' + (kong ? '又值旬空，冲空之期或有微应。' : ''),
      basis: '休囚之爻被日辰冲之则日破'
    });
    return { kind: 'ripo', judgments: js };
  }

  // ---------- 规则 6：日合 ----------
  function ruleDayHe(L, pil, grade, target) {
    const js = [];
    if (!liuhe(L.zhiIdx, pil.dayZhi)) return { kind: null, judgments: js };
    const nm = nameOf(L, target);
    if (L.moving) {
      js.push({ tag: '日合', rule: '合绊', text: nm + '发动而被日辰' + ZHI[pil.dayZhi] + '合，动而逢合为合绊，事被牵住难行，逢冲之日可应。', basis: '动而逢合则绊' });
      return { kind: 'heban', judgments: js };
    }
    const kind = STRONG.indexOf(grade) >= 0 ? '合起' : '合绊';
    js.push({
      tag: '日合', rule: kind,
      text: nm + '安静而被日辰' + ZHI[pil.dayZhi] + '合，' + (kind === '合起' ? '旺相之爻逢合则合起，由静转旺。' : '衰弱之爻逢合为合绊，事多牵滞，逢冲之日应。'),
      basis: '静而逢合，旺则起，衰则绊'
    });
    return { kind: kind, judgments: js };
  }

  // ---------- 规则 7：旬空（静空/动空/真空） ----------
  // 真空口径依《卜筮正宗·旬空论第十》两侧清单：
  //   「到底有用」：旺相旬空、**休囚发动**、日辰生扶、动爻生扶、动爻变空、伏而旺相
  //   「真空到底空」：**休囚安静**、日辰克动、爻克伏而被克、**静逢月破**值此旬空者
  // → 真空的两个分支皆以「安静」为前提，故 moving 是真空的**前置守卫**，而非优先级问题。
  //   《增删卜易·旬空章第二十六》同调：「旺不为空，动不为空，有日建动爻生扶者不为空……」。
  //   旧版缺此守卫：动爻遇旬空且休囚即被误判真空（实例 zsby-3190，原文作「动不为空」）。
  // 另：《增删卜易》与《卜筮正宗·用神空亡诀》的真空另取季节口径（「春土夏金秋树木，三冬逢火
  //   是真空」，即仅「死」地为真空），比本实现的「休/囚/死」窄 —— 该宽窄属流派选择，
  //   README「已知口径分歧」已登记，外部审计勿按季节口径重报。
  // 注意 daySupports 对「用神克日辰（耗于日辰）」置 false，故用神克日不会误当拱扶。
  function ruleXunKong(L, pil, zhenYuePo, daySupports, grade, target) {
    const js = [];
    if (pil.kong.indexOf(L.zhiIdx) < 0) return { isKong: false, zhen: false, judgments: js };
    const nm = nameOf(L, target);
    const jing = !L.moving; // 真空以安静为前提（旬空论第十：休囚安静 / 静逢月破）
    const zhen = jing && (zhenYuePo || (WEAK.indexOf(grade) >= 0 && !daySupports)); // 静∧（空+月破 ∨ 休囚无扶）
    if (zhen) {
      js.push({
        tag: '旬空', rule: '真空',
        text: nm + '安静而值旬空（' + pil.kongStr + '空），' + (zhenYuePo ? '又逢月破，空破交加，' : '休囚又无日辰生扶，空而无扶，') + '真空之象，难以有成。',
        basis: '《卜筮正宗·旬空论第十》：休囚安静、静逢月破值此旬空者，谓之真空到底空'
      });
      return { isKong: true, zhen: true, judgments: js };
    }
    if (L.moving) {
      js.push({ tag: '旬空', rule: '动不为空', text: nm + '发动而值旬空（' + pil.kongStr + '空），动不为空，出空之日即有用。', basis: '《卜筮正宗·旬空论第十》「休囚发动……到底有用」；《增删卜易·旬空章第二十六》「旺不为空，动不为空」' });
    } else {
      js.push({ tag: '旬空', rule: '旬空待时', text: nm + '安静而值旬空（' + pil.kongStr + '空），旺不惧空、衰不竞空，出空之日或冲空之日可应。', basis: '旬空者待时也，出空冲空则应' });
    }
    return { isKong: true, zhen: false, judgments: js };
  }

  // ---------- 规则 8：动变（回头生克冲合、进神退神） ----------
  function ruleDongBian(L, target) {
    const js = [];
    if (!L.moving || !L.bian) return { judgments: js, kind: null };
    const b = L.bian, nm = nameOf(L, target);
    js.push({ tag: '动变', rule: '发动', text: nm + '发动，化出' + b.lq + b.zhi + b.wx + '。', basis: '' });
    let kind = null;
    if (sheng(b.wx, L.wx)) {
      kind = '回生';
      js.push({ tag: '动变', rule: '化回头生', text: '　化回头生，后援来济，吉象。', basis: '动化回头生，得生扶之象' });
    } else if (ke(b.wx, L.wx)) {
      kind = '回克';
      js.push({ tag: '动变', rule: '化回头克', text: '　化回头克，变生仇敌，凶象，恐生变故。', basis: '动化回头克，受伤之象' });
    } else if (L.wx === b.wx) {
      if (LY.JINSHEN[L.zhi] === b.zhi) {
        kind = '进神';
        js.push({ tag: '动变', rule: '化进神', text: '　' + L.zhi + '化' + b.zhi + '为进神，同气渐进，其势日增。', basis: '《增删卜易》：寅化卯、巳化午之类为进神' });
      } else if (LY.TUISHEN[L.zhi] === b.zhi) {
        kind = '退神';
        js.push({ tag: '动变', rule: '化退神', text: '　' + L.zhi + '化' + b.zhi + '为退神，同气渐退，其势日衰。', basis: '《增删卜易》：卯化寅、午化巳之类为退神' });
      } else {
        kind = '比和'; // 与本函数其余分支一致：动变五值（比和/回生/回克/泄/耗）必有 kind
        js.push({ tag: '动变', rule: '化比和', text: '　化比和，其气不变。', basis: '' });
      }
    } else if (sheng(L.wx, b.wx)) {
      kind = '化泄';
      js.push({ tag: '动变', rule: '化泄气', text: '　化泄气，力量外散。', basis: '动而生变爻，泄气之象' });
    } else if (ke(L.wx, b.wx)) {
      // 五行关系五值完备（比和/得生/受克/泄/耗），此处补齐最后一值「耗」。
      // 旧版缺此分支：用神木化土（木克土）一类动变整条无判定输出，analyze 对之失声。
      kind = '化耗';
      js.push({
        tag: '动变', rule: '化耗气',
        text: '　化耗气，克制变爻而自损其力。',
        basis: '用神克变爻为耗气，力有所损；非「四大凶」（月克/日克/动爻克/化回头克），故与化泄同等不计入 harms'
      });
    }
    // 回头冲／回头合：与上方五行分支**并行**的另一维度（地支关系），故不写在 if/else 链内。
    // ——口径已定（据原文定夺）——
    // 《增删卜易·反伏章第二十八》：「以上用神旺相，不变冲克者，虽则反伏，事亦必成，只恐
    //   用神化回头之冲克者，即如卦变，大凶之象」，实例「比之井」世爻乙卯动化辛酉，
    //   卯酉**既冲且克**——其「克」向量已由上方「化回头克」计入 harms；只冲不克者
    //   （丑未、辰戌同为土）原文未论。
    // 《增删卜易·六合章第十九》：「爻動化出之爻回頭相合者，謂之**化扶**，得他扶助之意」；
    //   同章又谓「凡得諸合，諸占皆以為吉，然必用神有氣相宜，用若失陷無益」。
    //   ⚠️ 注意同章把「動而逢合」区分为两种：与**日月动爻**合者才是「合絆」（＝上方
    //   ruleDayHe 的「日合:合绊」）；**化出之爻回头**合者称「化扶」。故此处文本用「化扶」，
    //   不用「羁绊」。
    // 两条均**不入汇聚表**：aggregateTrend 的纳入准则是「直接、单向地作用于用神力量且
    //   吉凶不依赖占类」。「合」的吉凶随用神旺衰翻转（「用若失陷無益」），「冲」的克向量
    //   已由化回头克承担——均非单向，故只陈述、不改 trend（与相刑/相害、世爻关系同处理）。
    if (chong(L.zhiIdx, ZHI.indexOf(b.zhi))) {
      js.push({
        tag: '动变', rule: '化回头冲',
        text: '　变爻' + b.zhi + '回头冲本爻' + L.zhi + '，反复之象。',
        basis: '《增删卜易·反伏章第二十八》「只恐用神化回头之冲克者，即如卦变，大凶之象」（原文为冲克并见，其克已由「化回头克」单独计入 harms）'
      });
    }
    if (liuhe(L.zhiIdx, ZHI.indexOf(b.zhi))) {
      js.push({
        tag: '动变', rule: '化回头合',
        text: '　变爻' + b.zhi + '回头合本爻' + L.zhi + '，谓之化扶，得他扶助之意。',
        basis: '《增删卜易·六合章第十九》「爻動化出之爻回頭相合者，謂之化扶，得他扶助之意」'
      });
    }
    return { judgments: js, kind: kind };
  }

  // ---------- 规则 8b：其余动爻对用神的作用 ----------
  // 卦中最活跃的力量来源是动爻。旧版只判用神自身的动变（ruleDongBian），
  // 全卦其余动爻对用神的生克完全未入判定链——结构性缺环。
  // 此处按五行五值关系逐一列明：原神发动生用（吉）、忌神发动克用（凶）、
  // 用神生动爻（泄）、用神克动爻（耗）、比和同气。
  // ⚠️ 另含一处**已登记口径分歧**：他动爻化出之变爻亦参与对用神的生克（同书两处口径不一，
  //    详见下方分支注释与 tests/guji/README.md §七）。
  function ruleMovingOthers(pan, L, target) {
    const js = [];
    if (!pan || !pan.lines) return js;
    pan.lines.forEach(function (M) {
      if (!M.moving) return;
      if (M.pos === L.pos) return; // 用神自身动变由 ruleDongBian 判。
      // 用神为伏神时 L.pos 承自飞神（makeFu 用 Object.assign 保留 pos），故 M.pos === L.pos
      // 即「飞神自身发动」——此路径被跳过：飞伏生克（含飞神及其变爻对伏神的作用）统一由
      // ruleFu 处理，此处不重复判，也不单独检查飞神化出之变爻。属可接受边界，非缺陷。
      const rel = relation5(L.wx, M.wx);
      const who = LINE_NAMES[M.pos] + M.lq + M.zhi + M.wx;
      if (rel === '得生') {
        js.push({ tag: '动爻', rule: '动爻生用', text: '他爻' + who + '发动来生用神，原神有力，事有可图。', basis: '原神发动生用，为吉' });
      } else if (rel === '受克') {
        js.push({ tag: '动爻', rule: '动爻克用', text: '他爻' + who + '发动来克用神，忌神当道，用神受伤。', basis: '忌神发动克用，为凶' });
      } else if (rel === '泄') {
        js.push({ tag: '动爻', rule: '泄于动爻', text: '用神生' + who + '而发动，用神泄气于动爻，力量外散。', basis: '用神生动爻为泄气' });
      } else if (rel === '耗') {
        js.push({ tag: '动爻', rule: '耗于动爻', text: '用神克' + who + '而发动，用神虽能制之，亦自耗其力。', basis: '用神克动爻为耗' });
      } else {
        js.push({ tag: '动爻', rule: '动爻比和', text: '他爻' + who + '发动，与用神比和同气，可相助而不相伤。', basis: '比和同气' });
      }
      // 变爻（动而化出之支）亦参与对用神的生克 —— ★已登记口径分歧（保留实现、锁定现状）
      //
      // 立论一侧（主张「变爻不能生克他爻」）：
      //   《增删卜易·动变生克冲合章第十五》：「卦有动爻，动而必变，夫变出之爻能生克冲合
      //     本位之动爻，**不能生克他爻**，而他爻与本位之动爻，亦不能生克变爻。」
      //   同章卦例（子月卯日占得坤卦变火地晋）逐句印证：「变爻之巳火能回头克本位之酉金，
      //     **并不能克生他爻**……而**变出之酉金亦不能生克他爻**。」
      //   《增删卜易·增删黄金策千金赋》注（占脱役例）重申：「况**变爻戌土从无帮助正卦之爻**。」
      //
      // 反论一侧（主张「变爻能生扶用神」）：
      //   《增删卜易·各门类题头总注章》：「用神宜旺……但得用神临日月、或遇日月动爻
      //     **变爻生扶**、或用爻遇长生逢帝旺，皆谓之旺。」
      //
      // ★同一部书内两处口径不一（与 zsby-0542「暗动 vs 日破」同类）。按本回归的分类法，
      //   同书自相矛盾者登记为**分歧**而非**缺陷**：保留实现口径、登记分歧、锁定现状。
      //   用例见 tests/guji/cases/zengshan-boyi.json 的 zsby-0633-bianyao-shengyong。
      //   若将来按〈动变生克冲合章〉口径撤除本分支，该用例会转红，提示同步更新分歧表。
      if (M.bian) {
        const rb = relation5(L.wx, M.bian.wx);
        const bw = '变爻' + M.bian.lq + M.bian.zhi + M.bian.wx;
        if (rb === '得生') {
          js.push({ tag: '动爻', rule: '变爻生用', text: who + '化出' + bw + '，变爻生用神，助力在后。', basis: '变爻生用' });
        } else if (rb === '受克') {
          js.push({ tag: '动爻', rule: '变爻克用', text: who + '化出' + bw + '，变爻克用神，后患在变。', basis: '变爻克用' });
        }
      }
    });
    return js;
  }

  // ---------- 规则 9：与世爻关系 ----------
  /**
   * 「用神克世」的文案须随占类翻转。
   * 《黄金策》《增删卜易》：「用克世勿作凶看……如占求财，财爻克世者必得；占行人，
   * 用神克世者即归；占医药，子孙克世者即愈。外此数占，俱不宜用神而克世也。
   * 若占功名，官鬼克世，非祸即灾。」
   *
   * 旧版把这条压成固定一句「事与己有碍，宜谨慎」：trend 层本已不纳入（口径正确），
   * 但文案层仍是单一方向，模型读到就当凶判——guji 用例 zsby-1406（求财，书断
   * 「应临月建之财以克世，许之必得」）即因此被判成凶。
   *
   * topic 缺省（只选了宽泛类别）时不猜：把四类书证一并给出，由模型按所问自取，
   * 避免用「官鬼」这个含功名/官司/疾病三类的大类去做错误分流。
   */
  function keShiText(target, topic) {
    const t = String(topic || '').trim();
    const general = '用神克世爻，吉凶随占类翻转（《黄金策》）：占求财「财爻克世者必得」、' +
      '占行人「用神克世者即归」、占医药「子孙克世者即愈」；占功名则「官鬼克世，非祸即灾」；' +
      '其余占类方作有碍看。须按所问之事择一，不得一概断凶。';
    if (!t) return general;
    if (/病|疾|医|药|健康|就诊|手术/.test(t)) {
      if (target === '子孙') return '用神（子孙）克世爻，占医药者「子孙克世者即愈」，主药力及身、病可解。';
      // 占病正取官鬼（病神）；若取到别的六亲，说明取用有误，不可硬套「鬼克世」文案
      if (target === '官鬼') return '用神（官鬼）克世爻，占病者鬼来克世，病势切身，主缠绵难退；须并看用神旺衰与日月生扶。';
      return '用神（' + target + '）克世爻，占病者用神来克世，病势切身；占病正取官鬼为病神、子孙为医药，' +
        '今取' + target + '，须先复核取用是否得当。';
    }
    if (/求财|财运|生意|投资|回款|买卖|借贷|讨债|营收/.test(t)) {
      if (target === '妻财') return '用神（妻财）克世爻，占求财者「财爻克世者必得」——财来就我，主可得，惟得之须费些心力。';
      return general;
    }
    if (/行人|寻人|走失|失联|外出|归来|回来|回程|返程|到家/.test(t)) return '用神克世爻，占行人者「用神克世者即归」——主其人自回。';
    if (/功名|求官|升迁|仕途|科举|应试|考试|录取/.test(t)) {
      if (target === '官鬼') return '用神（官鬼）克世爻，占功名者「官鬼克世，非祸即灾」，主求名反受其累。';
      return general;
    }
    return general;
  }

  function ruleShi(pan, L, target, topic) {
    const js = [];
    if (target === 'shi') return js;
    const S = pan.lines[pan.shi];
    if (L.pos === pan.shi) {
      if (L.isFu) {
        // 用神为伏神、伏于世爻之下：pos 承自飞神（世爻），不可误断「用神持世」
        js.push({
          tag: '世爻', rule: '用神伏世下',
          text: '用神不上卦，伏于世爻之下（飞神' + S.lq + S.zhi + '），事体切身而伏藏，须待出伏之日方可发用。',
          basis: '伏神伏于世上，事关于己；须冲飞、生扶之日得出'
        });
      } else {
        js.push({ tag: '世爻', rule: '用神持世', text: '用神持世，事在己身，吉凶应之最切。', basis: '用神持世，事体切身' });
      }
    } else if (sheng(L.wx, S.wx)) {
      js.push({ tag: '世爻', rule: '用神生世', text: '用神生世爻（' + S.lq + S.zhi + '），事来就我。', basis: '' });
    } else if (ke(L.wx, S.wx)) {
      js.push({ tag: '世爻', rule: '用神克世', text: keShiText(target, topic), basis: '' });
    } else if (sheng(S.wx, L.wx)) {
      js.push({ tag: '世爻', rule: '世生用神', text: '世爻生用神，我求于事，须费力。', basis: '' });
    } else if (ke(S.wx, L.wx)) {
      js.push({ tag: '世爻', rule: '世克用神', text: '世爻克用神，我能制事，亦有损耗。', basis: '' });
    } else {
      js.push({ tag: '世爻', rule: '比和', text: '用神与世爻比和。', basis: '' });
    }
    return js;
  }

  // ---------- 规则 10：伏神专用 ----------
  function ruleFu(pan, L, pil, target) {
    const js = [];
    if (!L.isFu) return js;
    const fly = pan.lines[L.pos]; // 飞神（伏于其下之本卦爻）
    js.push({
      tag: '伏神', rule: '伏藏待引',
      text: '用神伏而不现，事体隐而未显。',
      basis: ''
    });
    if (sheng(fly.wx, L.wx)) {
      js.push({ tag: '伏神', rule: '飞来生伏', text: '飞神' + fly.lq + fly.zhi + fly.wx + '生伏神，伏而得生，如得长生，终可出而有用。', basis: '飞来生伏得长生' });
    } else if (ke(fly.wx, L.wx)) {
      js.push({ tag: '伏神', rule: '飞来克伏', text: '飞神' + fly.lq + fly.zhi + fly.wx + '克伏神，伏被压伤，难于引拔。', basis: '飞来克伏遭害' });
    } else if (fly.wx === L.wx) {
      js.push({ tag: '伏神', rule: '飞伏同气', text: '飞神' + fly.lq + fly.zhi + '与伏神同属' + fly.wx + '，同气相求，伏而不伤，引来较易。', basis: '飞伏同气，伏而可出' });
    } else if (ke(L.wx, fly.wx)) {
      js.push({ tag: '伏神', rule: '伏克飞神', text: '伏神克飞神' + fly.lq + fly.zhi + fly.wx + '，伏而能制飞，虽耗己力，出伏之门可开。', basis: '伏克飞者，伏神有力可出' });
    } else {
      js.push({ tag: '伏神', rule: '伏生飞神', text: '伏神生飞神' + fly.lq + fly.zhi + fly.wx + '，伏而泄气于飞，须日月生扶方易引出。', basis: '伏生飞为泄气，待生扶之期' });
    }
    if (chong(fly.zhiIdx, pil.dayZhi)) {
      js.push({ tag: '伏神', rule: '日冲飞神', text: '日辰冲开飞神，伏神得出之机已现。', basis: '冲飞则伏出' });
    }
    return js;
  }

  // ---------- M4：三合局 / 刑 / 害（卦内动爻 + 日月） ----------
  // 三合局：卦中动爻地支三支成局；变爻亦参与——
  // 旧版只统计本卦动爻，漏判「两动爻 + 一变爻」型三合（如动爻申、动爻子，另一动爻化辰）。
  // 取源顺序把本卦动爻排在变爻之前，贪心匹配优先用本卦动爻，避免同爻本变双算。
  // target 只参与「吉凶映射」，不参与成局筛选——成局与否与取哪个用神无关，
  // 但成局之吉凶与用神有关，故本函数仍需用神（第五轮曾把 target 误判为死形参而删除，
  // 现依经典恢复启用）。
  // 依据《增删卜易·六合章第十九》：「三合其局者，用神旺则无不为吉」，其吉凶由
  // 「局五行 对 用神五行」的生克定——原文以「如占功名，合成官局谓之官旺；合成财局，
  // 财旺生官；倘合成子孙局者，乃伤用之神也」为例，而「合成子孙局」正是「局泄用神」
  // 一类的五行表述，故本质即局与用神的同气／生／克。据此：
  //   局与用神同气（比和）｜局生用神  → 助，入 supports
  //   局克用神                        → 伤，入 harms
  //   泄（用神生局）｜耗（用神克局）  → 不入汇聚表，与既定的「泄气于月不入 harms」同口径
  function ruleSanHe(pan, target) {
    const js = [];
    const src = [];
    pan.lines.forEach(function (l) {
      if (!l.moving) return;
      src.push({ zhiIdx: l.zhiIdx, from: '本卦' + LINE_NAMES[l.pos] + l.lq + l.zhi, owner: 'p' + l.pos });
    });
    pan.lines.forEach(function (l) {
      if (!l.moving || !l.bian) return;
      // bian 对象（paipan.js）只有 { gan, zhi, wx, lq }，没有 zhiIdx——
      // 旧版直接读 l.bian.zhiIdx 得 undefined，而下方按 x.zhiIdx === z（0–11 整数）
      // 匹配，变爻地支永远命中不了，三合局退化成「只可能由本卦动爻凑成」。
      src.push({ zhiIdx: ZHI.indexOf(l.bian.zhi), from: '变爻' + l.bian.lq + l.bian.zhi, owner: 'b' + l.pos });
    });
    if (src.length < 3) return js;
    // 用神：仅供吉凶映射。取不到（或调用方未传 target）则只陈述成局事实，不下助伤之断。
    const pickS = target ? pickYongshen(pan, target) : null;
    const Y = pickS && pickS.primary ? pickS.primary : null;
    const REL_SANHE = {
      '比和': { relation: '同气', verdict: '局与用神同气，帮身而势成。' },
      '得生': { relation: '生用', verdict: '局生用神，得局之助。' },
      '受克': { relation: '克用', verdict: '局反克用神，成局而受伤。' },
      '泄': { relation: '泄用', verdict: '用神泄气于局，成而力耗。' },
      '耗': { relation: '耗用', verdict: '用神克局，成之亦费力。' }
    };
    LY.SANHE.forEach(function (sh) {
      const used = [], detail = [];
      const hit = sh.zhis.every(function (z) {
        const s = src.filter(function (x) { return x.zhiIdx === z && used.indexOf(x.owner) < 0; })[0];
        if (!s) return false;
        used.push(s.owner);
        detail.push(ZHI[z] + '（' + s.from + '）');
        return true;
      });
      if (!hit) return;
      const byBian = detail.some(function (d) { return d.indexOf('（变爻') >= 0; });
      const rel = Y ? (REL_SANHE[relation5(Y.wx, sh.wx)] || { relation: '', verdict: '' }) : { relation: '', verdict: '' };
      js.push({
        tag: '三合', rule: sh.zhis.map(function (z) { return ZHI[z]; }).join('') + '三合' + sh.wx + '局',
        relation: rel.relation,
        text: detail.join('、') + '成三合' + sh.wx + '局，党同气而势成。' + (byBian ? '（含动爻化出之支）' : '') + rel.verdict,
        basis: '三合成局，其力专；动爻与其化出之爻同参成局' +
          (Y ? '。局之吉凶依《增删卜易·六合章》「用神旺则无不为吉」，局生用神为助、局克用神为伤' : '')
      });
    });
    return js;
  }

  // 刑害：用神与日辰、月建之间
  // 不参与 trend 汇聚（见 aggregateTrend 注释与 README「已知口径分歧」）：
  // 《增删卜易·三刑章第二十一》野鹤老人自述「只以三刑为证而应验，这数十年，我只得到
  // 这一卦」，且谓子卯、丑未之刑「多是附和为凶」——刑非凶之主因，其「附和」语义
  // 恰由「WEAK + 有伤克 → 凶」分支天然表达，故此处只陈述、不改 trend。
  function ruleXingHai(L, pil, target) {
    const js = [];
    const nm = nameOf(L, target);
    // 日支与月支同支时合并为一条：否则同一刑害关系会被陈述两遍
    // （如辰月辰日遇用神辰 → 旧版输出两条「自刑」，rule 完全相同）。
    // desc 是完整的「来源＋地支」表述；非同支路径下 desc === 旧版的 from + zhi，
    // 故那些文本逐字不变，只有同支这一种新场景的措辞不同。
    const sameZhi = pil.dayZhi === pil.monthZhi;
    const srcs = sameZhi
      ? [{ zhiIdx: pil.dayZhi, zhi: ZHI[pil.dayZhi], desc: '日辰月建（同支' + ZHI[pil.dayZhi] + '）' }]
      : [
        { zhiIdx: pil.dayZhi, zhi: ZHI[pil.dayZhi], desc: '日辰' + ZHI[pil.dayZhi] },
        { zhiIdx: pil.monthZhi, zhi: ZHI[pil.monthZhi], desc: '月建' + ZHI[pil.monthZhi] }
      ];
    srcs.forEach(function (o) {
      const xingKey = L.zhi + o.zhi;
      if (LY.XING[xingKey]) {
        js.push({ tag: '相刑', rule: LY.XING[xingKey], text: nm + '与' + o.desc + '相刑（' + LY.XING[xingKey] + '），刑则有伤。', basis: '刑主伤残；然《增删卜易·三刑章》谓刑多「附和为凶」，非凶之主因，须用神本衰方验' });
      }
      if (LY.HAI[L.zhiIdx + '_' + o.zhiIdx]) {
        js.push({ tag: '相害', rule: '六害', text: nm + '与' + o.desc + '相害，害则相损。', basis: '害主妨害，其力逊于冲克，列入汇聚会失之过重' });
      }
    });
    return js;
  }

  // ---------- M16：卦型判定（六冲 / 六合 / 游魂归魂） ----------
  // 依据《增删卜易·六冲章第二十》《六合章第十九》《归魂游魂章第又二十六》。
  // 卦型的吉凶随占类翻转（「占凶事宜于冲散、占吉事而不宜」「宜合吉，不宜合凶」），
  // 且野鹤老人明言游魂归魂「须以用神为主，然后以此参之，若舍用神执此而断者，谬也」——
  // 按 aggregateTrend 的纳入准则（吉凶方向不依赖占类才入表），本组只陈述、不入 trend
  // （与相刑/相害、世爻关系同处理）。
  // 六冲卦十卦（八纯 + 无妄 + 大壮）与六合卦八卦的口径见 paipan.js chongGua/heGua，
  // 已由 test-gua-types.js 按京房八宫卦次整表锁定；此处只作断卦层陈述。
  function ruleGuaXing(pan) {
    const js = [];
    const benName = pan.benName;
    if (pan.isLiuChong) {
      js.push({
        tag: '卦型', rule: '六冲卦',
        text: '本卦' + benName + '为六冲卦（八纯加天雷无妄、雷天大壮共十卦）——冲者散也：占凶事宜冲散，占吉事不宜，必兼用神而言，用神旺虽冲不破，用神失陷凶而又凶。',
        basis: '《增删卜易·六冲章第二十》：「六冲卦者乾为天、坎为水、艮为山、震为雷、巽为风、离为火、坤为地、兑为泽，此八宫第一卦皆是六冲卦，再者天雷无妄、雷天大壮也是六冲卦一共十卦」「冲者散也，凡占凶事宜于冲散、占吉事而不宜，必兼用神而言，用神旺虽冲不破，用神失陷凶而又凶」'
      });
    }
    if (pan.isLiuHe) {
      js.push({
        tag: '卦型', rule: '六合卦',
        text: '本卦' + benName + '为六合卦，内外六爻自相和合——诸占皆以为吉，然必用神有气相宜，用若失陷无益；惟占讼狱不利。',
        basis: '《增删卜易·六合章第十九》：「卦逢六合者即如天地否卦内外六爻自相和合是也」「凡得诸合，诸占皆以为吉……然必用神有气相宜，用若失陷无益」「惟占讼狱不利」'
      });
    }
    if (pan.soul === '游魂') {
      js.push({
        tag: '卦型', rule: '游魂卦',
        text: '本卦' + benName + '为游魂卦（各宫第七卦）——古以游魂行千里，心无定向，迁改不常；野鹤老人谓须以用神为主，以此参之，不可舍用神而执此独断。',
        basis: '《增删卜易·归魂游魂章第又二十六》：「游魂卦为各宫之第七卦，如乾宫中之火地晋」「古以游魂行千里，我行此事而欲久者，游魂而不能久，心无定向，迁改不常。野鹤曰：须以用神为主，然后以此参之，若舍用神执此而断者，谬也」'
      });
    }
    if (pan.soul === '归魂') {
      js.push({
        tag: '卦型', rule: '归魂卦',
        text: '本卦' + benName + '为归魂卦（各宫第八卦）——古以归魂不出疆，诸事拘泥不行；野鹤老人谓亦须以用神为主。',
        basis: '《增删卜易·归魂游魂章第又二十六》：「归魂卦为各宫之第八卦，如乾宫中之火天大有」「古以归魂不出疆，诸事拘泥不行，与游魂卦相反而断之，可也。野鹤曰：亦须以用神为主」'
      });
    }
    if (pan.hasBian) {
      // 卦变关系（相冲六法之三/四、相合六法之五/六；「卦变六冲」见六合章「合而变冲，不久之兆」）
      const bianLC = LY.chongGua(pan.bianBits), bianLH = LY.heGua(pan.bianBits);
      if (pan.isLiuChong && bianLH) {
        js.push({
          tag: '卦型', rule: '六冲变六合',
          text: '六冲卦变六合卦——散而复聚，离而必合：占婚姻先吴越而后朱陈，占功名始则艰阻终顷荣显，占求谋先难后易。',
          basis: '《增删卜易·六合章第十九》：「屡验六冲变合，散而复聚，离而必合，此婚一定还成」「占婚姻先吴越而后朱陈，占夫妻先参商后必合好，占功名始则艰驻，终顷荣显。占求谋先难后易」'
        });
      } else if (pan.isLiuHe && bianLC) {
        js.push({
          tag: '卦型', rule: '六合变六冲',
          text: '六合卦变六冲卦——诸占先合后离、先亲后疏、先浓后淡、始荣终悴、得而复失成而后败，惟占官非盗贼事者宜之。',
          basis: '《增删卜易·六合章第十九》：「凡得六合变六冲者，诸占先合后离、先亲后疏、先浓后淡，始荣终悴，得而复失成而后败、惟占官非，盗贼事者宜之」'
        });
      } else if (pan.isLiuHe && bianLH) {
        js.push({
          tag: '卦型', rule: '六合变六合',
          text: '六合卦变六合卦——爻逢六合已为吉兆，动而变六合谓始终而作合：占风水百代显荣，占婚姻白头相守；不宜合凶之事。',
          basis: '《增删卜易·六合章第十九》：「六合卦变六合。爻逢六合已为吉兆，动而变六合谓始终而作合也。占风水百代显荣……占婚姻白头相守，宜合吉，不宜合凶」'
        });
      } else if (pan.isLiuChong && bianLC) {
        js.push({
          tag: '卦型', rule: '六冲变六冲',
          text: '六冲卦变六冲卦——相冲六法之「冲变六冲」，冲而又冲，事体反复难留。',
          basis: '《增删卜易·六冲章第二十》：「相冲之法有六。日月冲爻者一也，卦逢六冲二也，六合卦变六冲三也，冲变六冲四也。动爻变冲五也、爻与爻冲六也」'
        });
      } else if (bianLC) {
        js.push({
          tag: '卦型', rule: '卦变六冲',
          text: '卦变六冲——合而变冲，不久之兆，图事难成，有始无终。',
          basis: '《增删卜易·六合章第十九》：「独嫌卦变六冲，合而变冲，不久之兆」；《六冲章第二十》：「六合卦变六冲卦者，用神旺者始吉终凶，图事难成，有始无终也」'
        });
      }
    }
    return js;
  }

  // ---------- M16：生旺墓绝（长生十二宫四正位） ----------
  // 依据《增删卜易·生旺墓绝章第又二十六》：
  //   「且如主事爻属木，若在亥日占卦即主事爻长生于亥日。若在卯日占卦，木旺于卯。
  //    若在未日占卦，木墓于未。若在申日占卦，木绝于申，其馀仿此。又如主事爻属木，
  //    动而变出亥水者，谓之化长生，动而变出卯木者谓之化旺，动而变出未土者谓之化墓，
  //    动而变出申金者谓之化绝，馀仿此。」
  // 觉子曰三宽（旺衰守卫，本实现逐条落地）：
  //   长生：「且宜金爻旺相，或日月动爻生扶，再遇巳日……皆谓长生。倘若金爻休囚无气，
  //          再遇巳午火多者，烈火煎金，论克不论生也」（惟金之长生支巳火克金，故有此宽）；
  //   墓  ：「金爻虽墓于丑土，若得未土冲动，或卦中土多生金，论生不论墓也」（取逢冲一支）；
  //   绝  ：「土爻虽绝於巳，必须休囚无气，又逢巳爻谓之绝。若土爻旺相，或得日月动爻生扶，
  //          再遇巳爻，巳火反能生土，论生不论绝也」（惟土之绝支巳火生土，故有此宽）。
  // 本组皆只陈述、不入 trend：墓/绝的吉凶依赖占类与旺衰组合（如占病喜鬼入墓），
  // 长生/帝旺在日月层与既有「临日月」「日月生扶」重复（帝旺支即当令支），
  // 化旺/化墓与化比和/化耗气的五行判定是同一动变的两个维度，方向可能相反
  // （如辰土化子水：十二宫谓化旺、五行谓化耗）——按纳入准则不作单向映射。
  function ruleChangsheng(pan, L, pil, grade, daySupports, target) {
    const js = [];
    const T = LY.SHENGWANG_MUJUE[L.wx];
    if (!T) return js;
    const nm = nameOf(L, target);
    // 旺衰守卫：旺相、得日辰生扶、或有动爻生扶，视为「有气」
    const dongSheng = pan.lines.some(function (M) { return M.moving && sheng(M.wx, L.wx); });
    const strong = STRONG.indexOf(grade) >= 0 || daySupports || dongSheng;
    // 墓支逢冲（日辰/月建/动爻）则论生不论墓
    const muOpeners = [pil.dayZhi, pil.monthZhi].concat(
      pan.lines.filter(function (M) { return M.moving; }).map(function (M) { return M.zhiIdx; }));
    const muOpened = function (muZhi) {
      return muOpeners.some(function (z) { return z !== muZhi && chong(z, muZhi); });
    };
    // 日支与月支同支时合并为一条，与 ruleXingHai:575-581 同口径：
    // 旧版两条循环各自输出，辰月辰日 + 用神水会得两条「入墓」（rule 与 basis
    // 完全相同，纯重复陈述）；月日同支约占全年 1/12，属常见场景。
    // 非同支路径下 who 逐字等于旧版的 '月建' / '日辰'，文本不变。
    const sameZhi = pil.dayZhi === pil.monthZhi;
    const srcs = sameZhi
      ? [{ zhiIdx: pil.dayZhi, who: '日辰月建同支' }]
      : [
        { zhiIdx: pil.monthZhi, who: '月建' },
        { zhiIdx: pil.dayZhi, who: '日辰' }
      ];
    srcs.forEach(function (o) {
      const z = o.zhiIdx, who = o.who;
      if (z === T.sheng) {
        if (strong || !ke(ZHI_WX[z], L.wx)) {
          js.push({
            tag: '生旺墓绝', rule: '长生于' + who,
            text: nm + '长生于' + who + ZHI[z] + '，得生发之机。',
            basis: '《增删卜易·生旺墓绝章第又二十六》「若在亥日占卦即主事爻长生于亥日」；〈各门类题头总注章〉「用爻遇长生逢帝旺，皆谓之旺」'
          });
        } else {
          js.push({
            tag: '生旺墓绝', rule: '论克不论生',
            text: nm + '休囚无气，' + who + ZHI[z] + '虽为' + L.wx + '长生之地，然' + ZHI_WX[z] + '克' + L.wx + '，烈火煎金，论克不论生。',
            basis: '《增删卜易·生旺墓绝章第又二十六》觉子曰：「倘若金爻休囚无气，再遇巳午火多者，烈火煎金，论克不论生也」'
          });
        }
      }
      if (z === T.mu) {
        // 论生不论墓（觉子曰原文本限于金）：金墓于丑而丑土生金（土生金）——墓支与生支
        // 同体，故逢冲（丑未相冲）或土多时论生不论墓。馀四行之墓支不生本行
        // （辰土克水、未为木克、戌为火生、辰土比和），无「生」可论，不作此宽。
        if (L.wx === '金' && muOpened(z)) {
          js.push({
            tag: '生旺墓绝', rule: '论生不论墓',
            text: nm + '墓于' + who + ZHI[z] + '，然墓支被冲开，论生不论墓。',
            basis: '《增删卜易·生旺墓绝章第又二十六》觉子曰：「金爻虽墓于丑土，若得未土冲动，或卦中土多生金，论生不论墓也」'
          });
        } else {
          js.push({
            tag: '生旺墓绝', rule: '墓于' + who,
            text: nm + '入墓于' + who + ZHI[z] + '，用神入墓，事体拘滞难行。',
            basis: '《增删卜易·生旺墓绝章第又二十六》「若在未日占卦，木墓于未」；〈各门类题头总注章〉总注「墓之、绝之者爻墓绝于日月也」'
          });
        }
      }
      if (z === T.jue) {
        if (strong && sheng(ZHI_WX[z], L.wx)) {
          // 惟土绝于巳：巳火生土，旺相得扶则论生不论绝（觉子之宽）
          js.push({
            tag: '生旺墓绝', rule: '论生不论绝',
            text: nm + '逢' + who + ZHI[z] + '（' + L.wx + '绝地），然旺相得生扶，' + ZHI_WX[z] + '反能生' + L.wx + '，论生不论绝。',
            basis: '《增删卜易·生旺墓绝章第又二十六》觉子曰：「若土爻旺相，或得日月动爻生扶，再遇巳爻，巳火反能生土，论生不论绝也」'
          });
        } else {
          js.push({
            tag: '生旺墓绝', rule: '绝于' + who,
            text: nm + (strong ? '虽旺' : '休囚无气') + '，逢' + who + ZHI[z] + '为' + L.wx + '绝地，衰绝之象，须待冲绝之日。',
            basis: '《增删卜易·生旺墓绝章第又二十六》「若在申日占卦，木绝于申」；〈反伏章第二十八〉实例「世爻绝于申日又化回头冲克」（旺相亦谓之绝，惟土绝于巳得生者不论）'
          });
        }
      }
    });
    // 动变四态：化长生 / 化旺 / 化墓 / 化绝（帝旺支即当令支，月日层已由「临日月」覆盖，
    // 故此处只判动变，不重复判月建/日辰之帝旺）
    // 觉子曰三宽于动变层同样成立（原文逐字含动变）：
    //   长生：「或是金爻动而化出巳火，皆谓长生。倘若金爻休囚无气，再遇巳午火多者，
    //          烈火煎金，论克不论生也」——惟金长生支巳火克金，馀四行长生支皆生本行；
    //   墓  ：「若得未土冲动……论生不论墓也」（墓支逢冲则不开墓，丑未、辰戌相冲）；
    //   绝  ：「必须休囚无气，又逢巳爻谓之绝……巳火反能生土，论生不论绝也」（惟土绝巳）。
    if (L.moving && L.bian) {
      const b = L.bian, bz = ZHI.indexOf(b.zhi);
      if (bz === T.sheng) {
        if (L.wx === '金' && !strong) {
          // 烈火煎金：休囚无气——巳午火多则论克不论生；火不甚多则本支巳火克金，
          // 由主链「动变:化回头克」覆盖，此处不再判化长生（长生以旺相或生扶为前提）
          const huo = [pil.monthZhi, pil.dayZhi]
            .concat(pan.lines.map(function (M) { return M.zhiIdx; }))
            .concat(pan.lines.filter(function (M) { return M.moving && M.bian; })
              .map(function (M) { return ZHI.indexOf(M.bian.zhi); }));
          const huoDuo = huo.filter(function (z) { return z === 5 || z === 6; }).length >= 2;
          if (huoDuo) {
            js.push({
              tag: '生旺墓绝', rule: '论克不论生',
              text: '　' + L.zhi + '化' + b.zhi + '，虽变出' + L.wx + '长生之地，然' + L.wx + '休囚无气，又逢巳午火多，烈火煎金，论克不论生。',
              basis: '《增删卜易·生旺墓绝章第又二十六》觉子曰：「或是金爻动而化出巳火，皆谓长生。倘若金爻休囚无气，再遇巳午火多者，烈火煎金，论克不论生也」'
            });
          }
        } else {
          js.push({
            tag: '生旺墓绝', rule: '化长生',
            text: '　' + L.zhi + '化' + b.zhi + '，动而变出' + L.wx + '长生之地，谓之化长生。',
            basis: '《增删卜易·生旺墓绝章第又二十六》「动而变出亥水者，谓之化长生」；觉子曰：「或是金爻动而化出巳火，皆谓长生」（以旺相或得生扶为前提）'
          });
        }
      }
      if (bz === T.wang) {
        js.push({
          tag: '生旺墓绝', rule: '化旺',
          text: '　' + L.zhi + '化' + b.zhi + '，动而变出' + L.wx + '帝旺之地，谓之化旺，其气日盛。',
          basis: '《增删卜易·生旺墓绝章第又二十六》「动而变出卯木者谓之化旺」；〈各门类题头总注章〉「用爻遇长生逢帝旺，皆谓之旺」'
        });
      }
      if (bz === T.mu) {
        // 同月日层：论生不论墓本限于金（丑墓生金，逢冲则论生不论墓）
        if (L.wx === '金' && muOpened(bz)) {
          // 觉子曰「若得未土冲动……论生不论墓也」——墓支被日月动爻冲开则不成墓
          // （〈随鬼入墓章第三十〉实例：「丑墓月破，破罗破网，容易而出」）
          js.push({
            tag: '生旺墓绝', rule: '论生不论墓',
            text: '　' + L.zhi + '化' + b.zhi + '，虽变出' + L.wx + '墓库，然墓支被冲开，破罗破网，论生不论墓。',
            basis: '《增删卜易·生旺墓绝章第又二十六》觉子曰：「金爻虽墓于丑土，若得未土冲动，或卦中土多生金，论生不论墓也」；〈随鬼入墓章第三十〉「丑墓月破，破罗破网，容易而出」'
          });
        } else {
          js.push({
            tag: '生旺墓绝', rule: '化墓',
            text: '　' + L.zhi + '化' + b.zhi + '，动而变出' + L.wx + '墓库，谓之化墓，事体入于收藏。',
            basis: '《增删卜易·生旺墓绝章第又二十六》「动而变出未土者谓之化墓」；〈随鬼入墓章第三十〉「世爻随鬼入动墓，又动而化墓」'
          });
        }
      }
      if (bz === T.jue) {
        if (L.wx === '土' && strong) {
          // 惟土绝于巳（巳火生土）：旺相得扶则论生不论绝（觉子之宽）
          js.push({
            tag: '生旺墓绝', rule: '论生不论绝',
            text: '　' + L.zhi + '化' + b.zhi + '，虽变出' + L.wx + '绝地，然旺相得生扶，' + ZHI_WX[bz] + '反能生' + L.wx + '，论生不论绝。',
            basis: '《增删卜易·生旺墓绝章第又二十六》觉子曰：「若土爻旺相，或得日月动爻生扶，再遇巳爻，巳火反能生土，论生不论绝也」'
          });
        } else {
          js.push({
            tag: '生旺墓绝', rule: '化绝',
            text: '　' + L.zhi + '化' + b.zhi + '，动而变出' + L.wx + '绝地，谓之化绝，气尽之象。',
            basis: '《增删卜易·生旺墓绝章第又二十六》「动而变出申金者谓之化绝」'
          });
        }
      }
    }
    return js;
  }

  // ---------- M16：元神 / 忌神 / 仇神 ----------
  // 《增删卜易·用神元神忌神仇神章第九》：「元神，生用神之神即为元神。忌神克用神之爻也。
  //   仇神者克元神而生忌神也。」
  // 《卜筮正宗·原忌仇神论第四》：「生用神之爻即是原神也」「克用神之爻即是忌神也」
  //   「先看制克原神生扶忌神者，即是仇神也」。
  // 候选源：本卦六爻 + 月建 + 日辰（《卜筮正宗》「得原神动来生之，或日辰月建作原神生之」）。
  // 有力/无力判定依《增删卜易·元神忌神衰旺章第十》两侧清单（元神五条有力/六条无力、
  // 忌神五条有力/七条无力）与《卜筮正宗·原忌仇神论第四》（贪生忘克、贼先受害）。
  // ★已登记口径存疑：该章忌神有力第二条原文作「忌神动化回头生扶退神者二也」，
  //   与同章无力第四条「忌神衰动化退神四也」及元神有力第二条「元神动化回头生及化进神者
  //   二也」对照——若按字面「退神」解，则衰忌神化退神同时命中有力/无力两侧，自相矛盾；
  //   本实现取对称解（化回头生 / 化进神），并按旺衰与无力④各自归位。详见 README。
  function identifyYJC(pan, L) {
    const out = { yuanshen: [], jishen: [], choushen: [] };
    if (!L) return out;
    const cands = [];
    pan.lines.forEach(function (M) {
      if (M.pos === L.pos) return; // 用神自身不计入三神
      cands.push({ line: M, from: '卦中' + LINE_NAMES[M.pos], wx: M.wx, moving: M.moving, zhiIdx: M.zhiIdx });
    });
    [['月建', pan.pillars.monthZhi], ['日辰', pan.pillars.dayZhi]].forEach(function (o) {
      cands.push({ line: null, from: o[0], wx: ZHI_WX[o[1]], moving: false, zhiIdx: o[1], isRiYue: true });
    });
    cands.forEach(function (c) {
      if (sheng(c.wx, L.wx)) out.yuanshen.push(c);
      else if (ke(c.wx, L.wx)) out.jishen.push(c);
    });
    // 仇神须同时满足「克某个元神」与「生某个忌神」（两书定义皆含两个条件）
    cands.forEach(function (c) {
      const keYS = out.yuanshen.some(function (y) { return ke(c.wx, y.wx); });
      const shengJS = out.jishen.some(function (j) { return sheng(c.wx, j.wx); });
      if (keYS && shengJS) out.choushen.push(c);
    });
    return out;
  }

  // 候选神的状态快照（旺衰/临日月/生扶/空破/动变），供 ruleYJC 判定有力无力
  function yjcState(pan, pil, c) {
    const mz = pil.monthZhi, dz = pil.dayZhi;
    const st = {
      grade: c.isRiYue ? '旺' : wangXiangXiuQiuSi(c.wx, mz),
      linYue: c.zhiIdx === mz, linRi: c.zhiIdx === dz,
      kong: pil.kong.indexOf(c.zhiIdx) >= 0,
      po: chong(c.zhiIdx, mz),
      moving: !!c.moving,
      bianKind: null, huiTouHe: false, huaJue: false
    };
    const mWx = ZHI_WX[mz], dWx = ZHI_WX[dz];
    st.riSheng = relation5(c.wx, dWx) === '得生' || relation5(c.wx, dWx) === '比和';
    st.yueSheng = relation5(c.wx, mWx) === '得生' || relation5(c.wx, mWx) === '比和';
    st.dongSheng = pan.lines.some(function (M) {
      return M.moving && M.pos !== (c.line ? c.line.pos : -1) && sheng(M.wx, c.wx);
    });
    const T = LY.SHENGWANG_MUJUE[c.wx];
    if (T) {
      st.shengwangYuRi = dz === T.sheng || dz === T.wang; // 长生帝旺于日辰
      st.jueYuRi = dz === T.jue;
      st.muYuRiYue = dz === T.mu || mz === T.mu;          // 入三墓（简化：日月之墓）
    }
    if (c.line && c.line.moving && c.line.bian) {
      st.bianKind = ruleDongBian(c.line, '官鬼').kind;
      const bz = ZHI.indexOf(c.line.bian.zhi);
      st.huiTouHe = liuhe(c.line.zhiIdx, bz);
      st.huaJue = !!T && bz === T.jue;
      st.huaPo = chong(bz, mz);
      st.huaSan = st.bianKind === '回克'; // 化克（回头克）
    }
    st.strong = STRONG.indexOf(st.grade) >= 0 || st.linYue || st.linRi || st.riSheng || st.yueSheng || st.dongSheng;
    return st;
  }

  function ruleYJC(pan, L, target, yjc) {
    const js = [];
    if (!L || (!yjc.yuanshen.length && !yjc.jishen.length && !yjc.choushen.length)) return js;
    const pil = pan.pillars;
    const jsMoving = yjc.jishen.filter(function (c) { return c.line && c.line.moving; });
    const ysMoving = yjc.yuanshen.filter(function (c) { return c.line && c.line.moving; });

    // —— 元神：有力五条 / 无力六条（静元神亦判：旺相或得日月生扶即可生用） ——
    // 月建/日辰候选不进判定输出：其旺衰克生已由主链「月建」「日辰」两族规则完整
    // 覆盖，在此复述会造成同一事实两条断语；identifyYJC 结构中仍保留（仇神检测需要）。
    yjc.yuanshen.forEach(function (c) {
      if (c.isRiYue) return;
      const st = yjcState(pan, pil, c);
      const who = c.from + (c.line ? c.line.lq + c.line.zhi : ZHI[c.zhiIdx]) + c.wx;
      const reasons = [];
      if (STRONG.indexOf(st.grade) >= 0 || st.linYue || st.linRi) reasons.push('旺相或临日月');
      if (st.riSheng || st.yueSheng || st.dongSheng) reasons.push('得日月动爻生扶');
      if (st.moving && (st.bianKind === '回生' || st.bianKind === '进神')) reasons.push('动化回头生或化进神');
      if (st.shengwangYuRi) reasons.push('长生帝旺于日辰');
      if (st.moving && jsMoving.length) reasons.push('与忌神同动（忌神反生元神）');
      if (st.moving && STRONG.indexOf(st.grade) >= 0 && st.kong) reasons.push('旺动临空化空');
      if (reasons.length) {
        js.push({
          tag: '元神', rule: '元神有力',
          text: '元神' + who + '生用神——' + reasons.join('、') + '，元神有力，事有可图。',
          basis: '《增删卜易·元神忌神衰旺章第十》：「元神能生用神者有五：元神旺相或临日月或日月动爻生扶者一也。元神动化回头生及化进神者二也。元神长生帝旺于日辰三也。元神与忌神同动四也。元神旺动临空化空五也」'
        });
      } else {
        const bad = [];
        if (STRONG.indexOf(st.grade) < 0 && !st.moving) bad.push('休囚不动');
        if (st.moving && STRONG.indexOf(st.grade) < 0) bad.push('动而休囚');
        if (STRONG.indexOf(st.grade) < 0 && (st.kong || st.po)) bad.push('休囚又逢空破');
        if (st.moving && STRONG.indexOf(st.grade) < 0 && st.bianKind === '退神') bad.push('休囚动化退神');
        if (st.jueYuRi) bad.push('衰而又绝');
        if (st.muYuRiYue) bad.push('入三墓');
        if (st.moving && STRONG.indexOf(st.grade) < 0 && (st.huaJue || st.huaSan || st.huaPo)) bad.push('休囚动而化绝化克化破');
        js.push({
          tag: '元神', rule: '元神无力',
          text: '元神' + who + '生用神，然' + (bad.length ? bad.join('、') : '休囚无气') + '，无力生用，虽有如无。',
          basis: '《增删卜易·元神忌神衰旺章第十》：「元神虽现又有不能生用神者有六：元神休囚，不动或动而休囚又被伤克者一也。元神休囚又逢自空、月破二也。元神休囚动化退神三也。元神衰而又绝四也。元神入三墓五也。元神休囚动而化绝、化克、化破、化散六也。以上元神无力生用神，无用之元神也，虽有如无」'
        });
      }
    });

    // —— 忌神：只判发动之爻（「忌神宜静不宜兴」）与日月忌神；有力五条 / 无力七条 ——
    // 贪生忘克（《卜筮正宗·原忌仇神论第四》）：忌神动而生元神——五行中克用神者必然
    // 生元神（克X者生「生X者」：金克木而生水、水生木……五循环皆然），故忌神与元神
    // 同动时贪生忘克恒成立，本实现以此覆盖有力/无力两侧的「同动」条目。
    const tanSheng = jsMoving.length > 0 && ysMoving.length > 0 &&
      jsMoving.some(function (j) { return ysMoving.some(function (y) { return sheng(j.wx, y.wx); }); });
    yjc.jishen.forEach(function (c) {
      if (c.isRiYue) return; // 日月忌神由主链「日辰:日辰克伤」覆盖，见元神处同注
      const st = yjcState(pan, pil, c);
      const who = c.from + (c.line ? c.line.lq + c.line.zhi : ZHI[c.zhiIdx]) + c.wx;
      if (!c.line || !c.line.moving) return; // 静爻不判（忌神宜静不宜兴）
      if (tanSheng && c.line && c.line.moving) {
        js.push({
          tag: '忌神', rule: '忌神无力',
          text: '忌神' + who + '发动克用神，然与元神同动，忌神反生元神，谓之贪生忘克——用神根蒂深固，化凶而为吉。',
          basis: '《卜筮正宗·原忌仇神论第四》：「倘卦中又动出一爻原神生用，则忌神反生原神，是名贪生忘克，则用神根蒂深固矣，其吉更倍矣」；《增删卜易·元神忌神衰旺章第十》：「忌神与元神同动七也。此忌神者乃无力之忌神也，诸占化凶为吉」'
        });
        return;
      }
      const reasons = [];
      if (STRONG.indexOf(st.grade) >= 0 || st.linYue || st.linRi) reasons.push('旺相或临日月');
      if (st.riSheng || st.yueSheng || st.dongSheng) reasons.push('得日月动爻生扶');
      if (st.moving && st.bianKind === '回生') reasons.push('动化回头生');
      if (st.moving && st.bianKind === '进神') reasons.push('动化进神');
      if (st.moving && STRONG.indexOf(st.grade) >= 0 && st.kong) reasons.push('旺动临空化空');
      if (st.shengwangYuRi) reasons.push('长生帝旺与日辰');
      const chouDong = yjc.choushen.some(function (x) { return x.line && x.line.moving; });
      if (chouDong) reasons.push('与仇神同动');
      if (reasons.length) {
        js.push({
          tag: '忌神', rule: '忌神有力',
          text: '忌神' + who + '克用神——' + reasons.join('、') + '，忌神当道，诸占大凶。',
          basis: '《增删卜易·元神忌神衰旺章第十》：「忌神动而克害用神者有五……以上之忌神者如斧戟之忌神，诸占大凶」；《卜筮正宗·忌神歌》「看卦先须看忌神，忌神宜静不宜兴，忌神急要逢伤克，若遇生扶用受刑」'
        });
      } else {
        const bad = [];
        if (STRONG.indexOf(st.grade) < 0 && !st.moving) bad.push('休囚不动');
        if (st.moving && STRONG.indexOf(st.grade) < 0) bad.push('动而休囚');
        if (st.kong || st.po) bad.push('临空破');
        if (st.muYuRiYue) bad.push('入三墓');
        if (st.moving && STRONG.indexOf(st.grade) < 0 && st.bianKind === '退神') bad.push('衰动化退神');
        if (st.jueYuRi) bad.push('衰而又绝');
        if (st.moving && (st.huaJue || st.huaSan || st.huaPo)) bad.push('动化绝化破化克');
        js.push({
          tag: '忌神', rule: '忌神无力',
          text: '忌神' + who + '虽现，然' + (bad.length ? bad.join('、') : '休囚无气') + '，无力克用，诸占化凶为吉。',
          basis: '《增删卜易·元神忌神衰旺章第十》：「忌神虽动，不能克用神者有七……此忌神者乃无力之忌神也，诸占化凶为吉」'
        });
      }
    });

    // —— 仇神发动：原神被伤，用神无根，忌神倍力 ——
    yjc.choushen.forEach(function (c) {
      if (!c.line || !c.line.moving) return; // 「如卦中仇神发动」——只判动爻
      const who = c.from + c.line.lq + c.line.zhi + c.wx;
      js.push({
        tag: '仇神', rule: '仇神发动',
        text: '仇神' + who + '发动——仇神克元神而生忌神：原神被伤，用神无根，忌神倍力，其祸可胜道耶。',
        basis: '《增删卜易·用神元神忌神仇神章第九》「仇神者克元神而生忌神也」；《卜筮正宗·原忌仇神论第四》「如卦中仇神发动，则原神被伤，用神无根，忌神倍力，其祸可胜道耶」'
      });
    });
    return js;
  }

  // ---------- 汇聚：trend 由规则表驱动 ----------
  // supports/harms 为规则标签集合，非数值
  //
  // 纳入准则（第五轮提出，第六轮依经典定论）：
  //   trend 的语义是「用神旺衰粗判」（见 TREND_TEXT 与 verdict 文案），故纳入与否取决于
  //   「该要件是否直接、单向地作用于用神自身的力量」，且「其吉凶方向不依赖占类」。
  //
  //   ① 三合局 → 纳入。依《增删卜易·六合章第十九》「三合其局者，用神旺则无不为吉」，
  //      吉凶由局与用神的生克定，直接作用于用神力量。由 ruleSanHe 产出 relation
  //      （同气／生用 → supports；克用 → harms；泄用／耗用不入表）。
  //   ② 刑害（相刑:*/相害:*）→ 不纳入。依《增删卜易·三刑章第二十一》，野鹤老人自述
  //      「只以三刑为证而应验，这数十年，我只得到这一卦」，且「子卯、辰、戌、丑未亦有
  //      应验，但多是附和为凶」——刑非凶之主因，只在用神本已虚弱时「附和」——此语义
  //      恰由下方 `harms.length > 0 && !supports.length && WEAK` 分支天然实现（虚弱＋有伤
  //      → 凶），无需再入表；若强行入 harms，反而会让「旺相用神遇单刑」由吉降平，
  //      与「旺者不畏刑」相悖。
  //   ③ 世爻关系（世爻:*）→ 不纳入。依《黄金策》《增删卜易》「用克世勿作凶看……如占求财，
  //      财爻克世者必得；占行人，用神克世者即归；占医药，子孙克世者即愈。外此数占，俱不宜
  //      用神而克世也。若占功名，官鬼克世，非祸即灾」——同一「用神克世」的吉凶随占类翻转，
  //      无法映射为单一方向；且其作用对象是世爻（事与己），非用神旺衰。故只作 bullet 陈述。
  function aggregateTrend(ctx) {
    const supports = [], harms = [];
    const J = ctx.judgments;
    J.forEach(function (j) {
      // 三合局：tag 固定「三合」，rule 为具体局名（申子辰三合水局…），吉凶须看 j.relation
      // （见 ruleSanHe）。relation 缺省（未传用神）时不入表，只陈述成局事实。
      if (j.tag === '三合') {
        const e = '三合:' + j.rule + '（' + j.relation + '）';
        if (j.relation === '同气' || j.relation === '生用') supports.push(e);
        else if (j.relation === '克用') harms.push(e);
        return;
      }
      const t = j.tag + ':' + j.rule;
      if (['月建:临月建', '月建:月建同气', '月建:月建生扶', '日辰:临日辰', '日辰:日辰生扶', '日辰:日辰比和',
        '动变:化回头生', '动变:化进神', '日冲:暗动', '日合:合起', '伏神:飞来生伏', '伏神:飞伏同气', '伏神:日冲飞神',
        '动爻:动爻生用', '动爻:变爻生用'].indexOf(t) >= 0) supports.push(t);
      if (['月建:月建克伤', '月破:真月破', '日辰:日辰克伤', '日冲:日破', '日冲:冲散',
        '旬空:真空', '动变:化回头克', '动变:化退神', '日合:合绊', '伏神:飞来克伏',
        '动爻:动爻克用', '动爻:变爻克用'].indexOf(t) >= 0) harms.push(t);
    });
    let trend;
    if (!ctx.hasYongshen) {
      trend = '待审';
    } else if (ctx.zhenKong || (ctx.zhenYuePo && !ctx.daySupports)) {
      trend = '凶';
    } else if (harms.length > 0 && supports.length === 0 && WEAK.indexOf(ctx.grade) >= 0) {
      trend = '凶';
    } else if (harms.length === 0 && supports.length === 0) {
      trend = '平';
    } else if (harms.length === 0 && supports.length > 0) {
      // 有生扶而无伤克：旺相（得月令）者直判吉；休囚失令者虽得日辰生扶，亦不与吉断。
      // 旧版此处原为两条等价分支（「STRONG→吉」+「有生扶→吉」），后者把前者的 STRONG 门
      // 完全废掉——「月建泄气/克月建（休囚）＋日辰生扶」被静默判吉，与《增删卜易》
      // 「月建为提纲，失令者纵得日生亦难成」相左。二者合并后 STRONG 门真正生效。
      trend = STRONG.indexOf(ctx.grade) >= 0 ? '吉' : '平';
    } else {
      trend = '平';  // 生克互见，成败在应期细审
    }
    return { supports: supports, harms: harms, trend: trend };
  }

  const TREND_TEXT = {
    '吉': '用神得生扶而有力，事体可图。',
    '凶': '用神受伤失援，事体难成，宜缓图或另择。',
    '平': '用神旺衰中和、生克互见，成败在动爻与应期之细审。',
    '待审': '卦中未见用神，宜另择用神或以世爻参断。'
  };

  // ---------- 主函数 ----------
  // target: '妻财'|'官鬼'|'父母'|'子孙'|'兄弟'|'shi'
  // 返回 { yongshen, judgments, trend, yingqiClues, bullets, verdict }
  function analyze(pan, target, opts) {
    const topic = (opts && opts.topic) || '';
    const pil = pan.pillars;
    const pick = pickYongshen(pan, target);
    const judgments = [];
    const clues = [];
    const bullets = [];

    if (!pick.primary) {
      bullets.push(pick.note);
      bullets.push('【粗判】' + TREND_TEXT['待审'] + '（仅为旺衰规则粗判，非全卦结论）');
      // 形状与正常分支保持一致：消费侧可无条件读 yingqiLayers 三个数组
      const outNo = { yongshen: null, judgments: judgments, trend: '待审', yingqiClues: [], yingqiLayers: { main: [], auxiliary: [], risk: [] }, bullets: bullets, verdict: TREND_TEXT['待审'] };
      // 应期域层同样给形状（blocked: no_yongshen），消费侧不必分支
      if (typeof LY.yingqiWindow === 'function') {
        try { outNo.yingqiWindow = LY.yingqiWindow(pan, outNo); } catch (e) { outNo.yingqiWindow = null; }
      }
      return outNo;
    }

    const L = pick.primary;
    bullets.push((target === 'shi' ? '所测为自身运势，以世爻为用。' : pick.note + '。'));

    // 判定链按序执行
    const month = ruleMonth(L, pil, target);
    const day = ruleDay(L, pil, target);
    const yuepo = ruleYuePo(L, pil, month.grade, day.supports, target);
    const daychong = ruleDayChong(L, pil, month.grade, target);
    const dayhe = ruleDayHe(L, pil, month.grade, target);
    const xunkong = ruleXunKong(L, pil, yuepo.zhen, day.supports, month.grade, target);
    const dongbian = ruleDongBian(L, target);
    const others = ruleMovingOthers(pan, L, target);

    [month.judgments, day.judgments, yuepo.judgments, daychong.judgments, dayhe.judgments,
      xunkong.judgments, dongbian.judgments, others].forEach(function (arr) {
      arr.forEach(function (j) { judgments.push(j); bullets.push(j.text); });
    });
    ruleShi(pan, L, target, topic).forEach(function (j) { judgments.push(j); bullets.push(j.text); });
    ruleFu(pan, L, pil, target).forEach(function (j) { judgments.push(j); bullets.push(j.text); });
    ruleSanHe(pan, target).forEach(function (j) { judgments.push(j); bullets.push(j.text); });
    ruleXingHai(L, pil, target).forEach(function (j) { judgments.push(j); bullets.push(j.text); });
    // M16 三族：卦型（盘级）/ 生旺墓绝 / 元神忌神仇神——均为陈述层，不入 trend（理由见各函数注释）
    ruleGuaXing(pan).forEach(function (j) { judgments.push(j); bullets.push(j.text); });
    ruleChangsheng(pan, L, pil, month.grade, day.supports, target).forEach(function (j) { judgments.push(j); bullets.push(j.text); });
    const yjc = identifyYJC(pan, L);
    ruleYJC(pan, L, target, yjc).forEach(function (j) { judgments.push(j); bullets.push(j.text); });

    // 应期线索（只出线索，不下结论）
    // 分层口径：主应期 = 用神解除受制的直接窗口（出空、出月）；
    //           辅助节点 = 触发性的冲合节点（暗动、合绊）；
    //           风险窗口 = 使结论转向的条件（伏藏待引拔、忌神回克）。
    // 线索文本与旧版逐字一致，只是另按层归档——`yingqiClues` 保持原有扁平顺序，
    // 便于既有测试与排盘文本继续消费；`yingqiLayers` 为新增的结构化视图。
    const layers = { main: [], auxiliary: [], risk: [] };
    if (xunkong.isKong && !xunkong.zhen) {
      clues.push('用神旬空：出空之日或冲空之日应');
      layers.main.push('用神旬空：出空之日或冲空之日应');
    }
    if (yuepo.isPo && !yuepo.zhen) {
      clues.push('月破：出月之日或逢合、逢值之日应');
      layers.main.push('月破：出月之日或逢合、逢值之日应');
    }
    if (daychong.kind === 'andong') {
      clues.push('暗动之爻：其应极速');
      layers.auxiliary.push('暗动之爻：其应极速');
    }
    if (dayhe.kind === 'heban') {
      clues.push('合绊：逢冲之日应');
      layers.auxiliary.push('合绊：逢冲之日应');
    }
    if (L.isFu) {
      clues.push('伏藏：日辰生扶之日或冲开飞神之日，为引拔之期');
      layers.risk.push('伏藏：日辰生扶之日或冲开飞神之日，为引拔之期');
    }
    if (dongbian.kind === '回克') {
      clues.push('忌神发动回头克：须制忌之神值班之日应');
      layers.risk.push('忌神发动回头克：须制忌之神值班之日应');
    }

    // M18（任务⑥）：两现口径 kongpo 分支——纯增量守卫，默认 'priority' 时不触发，既有路径零改动。
    // 只新增一条陈述层断语（不入 aggregateTrend 白名单，trend 不受影响）与一条应期锚点线索。
    // 边界（§3.3）：空破分歧才有并置；锚点地支须唯一；伏神/世爻/无分歧 → 静默回退。
    if (LY.ysDupMode === 'kongpo' && target !== 'shi' && !L.isFu &&
        pick.source === '两现取舍' && pick.all.length >= 2) {
      const kong = pick.all.filter(function (x) { return pil.kong.indexOf(x.zhiIdx) >= 0; });
      const buKong = pick.all.filter(function (x) { return pil.kong.indexOf(x.zhiIdx) < 0; });
      const po = pick.all.filter(function (x) { return chong(x.zhiIdx, pil.monthZhi); });
      const buPo = pick.all.filter(function (x) { return !chong(x.zhiIdx, pil.monthZhi); });
      let anchor = null, kind = null;
      if (kong.length && buKong.length && kong.every(function (x) { return x.zhiIdx === kong[0].zhiIdx; })) {
        anchor = kong[0]; kind = 'kong';
      } else if (!kong.length && po.length && buPo.length && po.every(function (x) { return x.zhiIdx === po[0].zhiIdx; })) {
        anchor = po[0]; kind = 'po';
      }
      if (anchor) {
        const dupDesc = pick.all.map(function (x) {
          return LINE_NAMES[x.pos] + x.zhi + (pil.kong.indexOf(x.zhiIdx) >= 0 ? '值旬空' : '') +
            (chong(x.zhiIdx, pil.monthZhi) ? '逢月破' : '') + (x.pos === L.pos ? '（主用爻）' : '');
        }).join('、');
        const j = kind === 'kong' ? {
          tag: '两现', rule: '用空破者应期',
          text: '用神' + target + '两现（' + dupDesc + '）——《增删卜易·两现章第三十二》「舍其不空而用旬空」（野鹤法）：以' +
            anchor.zhi + '出空之日为应期之锚；主用爻仍取' + L.zhi + '（通行次序，两派并置）。',
          basis: '《增删卜易·两现章第三十二》：「却得于辰土出空之日，此乃舍其不空而用旬空」；同章「此乃卦中用神三现，而用逢破之爻也」——LY.ysDupMode="kongpo"（野鹤法）口径；默认 LY.ysDupMode="priority" 为通行次序取舍，两派并置互不覆盖',
          anchor: { zhi: anchor.zhi, zhiIdx: anchor.zhiIdx, kind: 'kong' }
        } : {
          tag: '两现', rule: '用空破者应期',
          text: '用神' + target + '两现（' + dupDesc + '）——《增删卜易·两现章第三十二》「用逢破之爻」（野鹤法）：以' +
            anchor.zhi + '实破（逢值）之期为应（年/月级陈述）；主用爻仍取' + L.zhi + '（通行次序，两派并置）。',
          basis: '《增删卜易·两现章第三十二》：「两爻巳火逢月破许巳年脱厄，乃实破之年也」——LY.ysDupMode="kongpo"（野鹤法）口径；默认 LY.ysDupMode="priority" 为通行次序取舍，两派并置互不覆盖',
          anchor: { zhi: anchor.zhi, zhiIdx: anchor.zhiIdx, kind: 'po' }
        };
        const clue = kind === 'kong'
          ? '两现野鹤法：以' + anchor.zhi + '出空之日为应期之锚'
          : '两现野鹤法：以' + anchor.zhi + '实破（逢值）之期为应';
        judgments.push(j); bullets.push(j.text);
        clues.push(clue); layers.main.push(clue);
      }
    }

    const agg = aggregateTrend({
      hasYongshen: true, grade: month.grade,
      daySupports: day.supports, zhenKong: xunkong.zhen, zhenYuePo: yuepo.zhen,
      judgments: judgments
    });

    bullets.push('【粗判】' + TREND_TEXT[agg.trend] + '（由规则链汇聚，非算术评分；仅为旺衰粗判，非全卦结论）');
    if (clues.length) bullets.push('【应期线索】' + clues.join('；') + '。');

    const out = {
      yongshen: {
        type: target === 'shi' ? '世爻' : target,
        line: { pos: L.pos, gan: L.gan || '', zhi: L.zhi, wx: L.wx, lq: L.lq, moving: L.moving, isFu: !!L.isFu },
        source: pick.source,
        dupMode: LY.ysDupMode,
        wang: month.grade
      },
      yjs: {
        yuanshen: yjc.yuanshen.map(function (c) {
          return { from: c.from, lq: c.line ? c.line.lq : c.wx, zhi: c.line ? c.line.zhi : ZHI[c.zhiIdx], wx: c.wx, moving: !!c.moving };
        }),
        jishen: yjc.jishen.map(function (c) {
          return { from: c.from, lq: c.line ? c.line.lq : c.wx, zhi: c.line ? c.line.zhi : ZHI[c.zhiIdx], wx: c.wx, moving: !!c.moving };
        }),
        choushen: yjc.choushen.map(function (c) {
          return { from: c.from, lq: c.line ? c.line.lq : c.wx, zhi: c.line ? c.line.zhi : ZHI[c.zhiIdx], wx: c.wx, moving: !!c.moving };
        })
      },
      judgments: judgments,
      trend: agg.trend,
      supports: agg.supports,
      harms: agg.harms,
      yingqiClues: clues,
      yingqiLayers: layers,
      bullets: bullets,
      verdict: TREND_TEXT[agg.trend]
    };

    // 应期域层（core/yingqi-window.js）：把上面的扁平线索收敛为「区间＋置信度＋依据＋下调原因」。
    // 可选依赖 —— 模块未加载（旧缓存页面）时保持 null，绝不阻断断卦主流程。
    // 放在最后调用：本层读的是 out 自身的 yongshen / yjs / judgments / trend，
    // 不参与排盘，也不改动任何既有字段（不影响 M1–M16 的任何断言）。
    if (typeof LY.yingqiWindow === 'function') {
      try { out.yingqiWindow = LY.yingqiWindow(pan, out); } catch (e) { out.yingqiWindow = null; }
    }
    return out;
  }

  // ---------- 导出（规则函数全部可独立单测） ----------
  LY.relation5 = relation5;
  LY.pickYongshen = pickYongshen;
  LY.wangXiangXiuQiuSi = wangXiangXiuQiuSi;
  LY.ruleMonth = ruleMonth;
  LY.ruleYuePo = ruleYuePo;
  LY.ruleDay = ruleDay;
  LY.ruleDayChong = ruleDayChong;
  LY.ruleDayHe = ruleDayHe;
  LY.ruleXunKong = ruleXunKong;
  LY.ruleDongBian = ruleDongBian;
  LY.ruleMovingOthers = ruleMovingOthers;
  LY.ruleShi = ruleShi;
  LY.ruleFu = ruleFu;
  LY.ruleSanHe = ruleSanHe;
  LY.ruleXingHai = ruleXingHai;
  LY.ruleGuaXing = ruleGuaXing;
  LY.ruleChangsheng = ruleChangsheng;
  LY.identifyYJC = identifyYJC;
  LY.yjcState = yjcState;
  LY.ruleYJC = ruleYJC;
  LY.aggregateTrend = aggregateTrend;

  // ---------- 爻位状态清单（确定性 · 非推断） ----------
  // 逐爻列出「动静、月令旺衰、月破真假、日冲（暗动／日破／冲散）、日合、旬空」。
  // 只陈述规则链判定结果，不作吉凶、不涉用神取舍。
  // 起因：排盘文本原只有「旺衰粗判」，且只围绕用神一条线展开，六爻层面的月破日冲要靠模型心算。
  // 2026-10-30 同盘实测：Gemini 漏掉二爻辰土月破、DeepSeek 把五爻未土（旺相逢日冲）判成日破。
  // 两条都是硬事实层错判，且都是「引擎算得准、却没有输出」——故补此节，让模型只解释、不重算。
  function lineStates(pan) {
    const pil = pan.pillars;
    const rows = [];
    for (let i = 0; i < 6; i++) {
      const L = pan.lines[i];
      const grade = wangXiangXiuQiuSi(L.wx, pil.monthZhi);
      const strong = STRONG.indexOf(grade) >= 0;
      const weak = WEAK.indexOf(grade) >= 0;
      const kong = pil.kong.indexOf(L.zhiIdx) >= 0;
      const yuePo = chong(L.zhiIdx, pil.monthZhi);
      const riChong = chong(L.zhiIdx, pil.dayZhi);
      const riHe = liuhe(L.zhiIdx, pil.dayZhi);
      const rel = relation5(L.wx, ZHI_WX[pil.dayZhi]);
      // 日辰生扶口径与 ruleDay 一致：临日辰、得生、比和算扶；受克／泄／耗不算
      const daySupports = (pil.dayZhi === L.zhiIdx) || rel === '得生' || rel === '比和';
      const marks = [L.moving ? '发动' : '安静', '月令' + grade];
      if (yuePo) {
        const zhen = weak && !daySupports;
        marks.push('月破' + (zhen
          ? '（休囚无救·真破，逢值逢合方解）'
          : '（旺相或得日辰扶·假破，出月或逢合逢值可解）'));
      }
      if (riChong) {
        marks.push(L.moving
          ? '日冲·冲散（动逢冲则散，事多反复）'
          : (strong ? '日冲·暗动（旺相逢冲为冲起，非日破）' : '日冲·日破（休囚逢冲，败象）'));
      } else if (riHe) {
        marks.push(L.moving ? '日合·合绊' : (strong ? '日合·合起' : '日合·合绊'));
      }
      if (kong) marks.push(L.moving ? '旬空（动不为空，出空转实）' : '旬空（静空）');
      rows.push({
        pos: i, kong: kong, yuePo: yuePo, riChong: riChong, grade: grade,
        text: LINE_NAMES[i] + ' ' + L.lq + (L.gan || '') + L.zhi +
          (L.shi ? '（世）' : '') + (L.ying ? '（应）' : '') +
          (L.isFu ? '' : '') + '：' + marks.join('，')
      });
    }
    return rows;
  }
  LY.lineStates = lineStates;

  LY.analyze = analyze;

  // 旧 API 兼容：语义同 relation5，仅输出名沿用旧版。
  // ⚠️ 视角相反：relation5(self, other) 描述「self 对 other 的状态」，relationText 的文案则是
  //    「other 使 self 受到什么待遇」，故 REL_TEXT['耗']='受制' 指的是「other 受制」而非「self 受制」。
  //    例：relation5('木','土')='耗'（木耗气）｜relationText('木','土')='受制'（土受制）。
  const REL_TEXT = { '比和': '比和', '得生': '生我', '泄': '泄气', '受克': '克伤', '耗': '受制' };
  LY.relationText = function (selfWx, otherWx) {
    return REL_TEXT[relation5(selfWx, otherWx)] || '';
  };
})(typeof window !== 'undefined' ? window : globalThis);

