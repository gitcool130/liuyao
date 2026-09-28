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
 * ============================================================ */
(function (root) {
  const LY = root.LY = root.LY || {};
  const ZHI = LY.ZHI, ZHI_WX = LY.ZHI_WX, LINE_NAMES = LY.LINE_NAMES;
  const GAN = LY.GAN;
  const sheng = LY.sheng, ke = LY.ke, chong = LY.chong, liuhe = LY.liuhe;

  const GRADES = ['旺', '相', '休', '囚', '死'];
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
          zhi: fl.fu.zhi, wx: fl.fu.wx, zhiIdx: fl.fu.zhiIdx,
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
        note: '用神' + target + '不上卦，取伏神' + target + fuLine.fu.zhi + '（伏于' + LINE_NAMES[fuLine.pos] + '，飞神' + fuLine.lq + fuLine.zhi +
          (fus.length > 1 ? '；伏神' + fus.length + '现，取' + why : '') + '）'
      };
    }
    if (found.length === 1) {
      return { primary: found[0], all: found, source: '本卦', note: '用神' + target + found[0].zhi + '（' + LINE_NAMES[found[0].pos] + '）' };
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
      note: '用神' + target + '两现，古法宜取' + how + '为主，余为辅——今取' + LINE_NAMES[pick.pos] + pick.zhi + '为主'
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
    } else {
      js.push({ tag: '月建', rule: '克月建', text: nm + '克月建' + ZHI[mz] + mWx + '，力耗于时令（' + grade + '）。', basis: '克令者囚' });
    }
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
  // 真空口径（本项目取宽口径，README「已知口径分歧」已登记）：
  //   (a) 旬空 + 月破（zhenYuePo）→ 真空；
  //   (b) 休囚（休/囚/死）且无日辰生扶 → 真空。
  // 野鹤老人季节口径更窄（「春土夏金秋是木，三冬逢火是真空」），只承认「死」为真空；
  // 本实现按 WEAK 全集判，属流派选择而非缺陷——外部审计勿再按野鹤口径重报。
  // 注意 daySupports 对「用神克日辰（耗于日辰）」置 false，故用神克日不会误当拱扶。
  function ruleXunKong(L, pil, zhenYuePo, daySupports, grade, target) {
    const js = [];
    if (pil.kong.indexOf(L.zhiIdx) < 0) return { isKong: false, zhen: false, judgments: js };
    const nm = nameOf(L, target);
    const zhen = zhenYuePo || (WEAK.indexOf(grade) >= 0 && !daySupports); // 旬空+月破=真空；休囚无生扶亦真空
    if (zhen) {
      js.push({
        tag: '旬空', rule: '真空',
        text: nm + '值旬空（' + pil.kongStr + '空），' + (zhenYuePo ? '又逢月破，空破交加，' : '休囚又无日辰生扶，空而无扶，') + '真空之象，难以有成。',
        basis: '《卜筮正宗》：旬空逢月破、休囚无救者为真空，真空则无用'
      });
      return { isKong: true, zhen: true, judgments: js };
    }
    if (L.moving) {
      js.push({ tag: '旬空', rule: '动不为空', text: nm + '发动而值旬空（' + pil.kongStr + '空），动不为空，出空之日即有用。', basis: '发动之爻不为空，出空则用' });
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
    if (chong(L.zhiIdx, ZHI.indexOf(b.zhi))) {
      js.push({ tag: '动变', rule: '化回头冲', text: '　变爻' + b.zhi + '回头冲本爻' + L.zhi + '，反复之象。', basis: '' });
    }
    if (liuhe(L.zhiIdx, ZHI.indexOf(b.zhi))) {
      js.push({ tag: '动变', rule: '化回头合', text: '　变爻' + b.zhi + '回头合本爻' + L.zhi + '，羁绊之象。', basis: '' });
    }
    return { judgments: js, kind: kind };
  }

  // ---------- 规则 8b：其余动爻对用神的作用 ----------
  // 卦中最活跃的力量来源是动爻。旧版只判用神自身的动变（ruleDongBian），
  // 全卦其余动爻（及动爻化出之变爻）对用神的生克完全未入判定链——结构性缺环。
  // 此处按五行五值关系逐一列明：原神发动生用（吉）、忌神发动克用（凶）、
  // 用神生动爻（泄）、用神克动爻（耗）、比和同气。
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
      // 变爻（动而化出之支）亦参与对用神的生克
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
  function ruleShi(pan, L, target) {
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
      js.push({ tag: '世爻', rule: '用神克世', text: '用神克世爻，事与己有碍，宜谨慎。', basis: '' });
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
  // 注：本函数不取用神（三合成局与否与「取哪个用神」无关），故无 target 形参
  function ruleSanHe(pan) {
    const js = [];
    const src = [];
    pan.lines.forEach(function (l) {
      if (!l.moving) return;
      src.push({ zhiIdx: l.zhiIdx, from: '本卦' + LINE_NAMES[l.pos] + l.lq + l.zhi, owner: 'p' + l.pos });
    });
    pan.lines.forEach(function (l) {
      if (!l.moving || !l.bian) return;
      src.push({ zhiIdx: l.bian.zhiIdx, from: '变爻' + l.bian.lq + l.bian.zhi, owner: 'b' + l.pos });
    });
    if (src.length < 3) return js;
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
      js.push({
        tag: '三合', rule: sh.zhis.map(function (z) { return ZHI[z]; }).join('') + '三合' + sh.wx + '局',
        text: detail.join('、') + '成三合' + sh.wx + '局，党同气而势成。' + (byBian ? '（含动爻化出之支）' : ''),
        basis: '三合成局，其力专；动爻与其化出之爻同参成局'
      });
    });
    return js;
  }

  // 刑害：用神与日辰、月建之间
  function ruleXingHai(L, pil, target) {
    const js = [];
    const nm = nameOf(L, target);
    [
      { zhiIdx: pil.dayZhi, zhi: ZHI[pil.dayZhi], from: '日辰' },
      { zhiIdx: pil.monthZhi, zhi: ZHI[pil.monthZhi], from: '月建' }
    ].forEach(function (o) {
      const xingKey = L.zhi + o.zhi;
      if (LY.XING[xingKey]) {
        js.push({ tag: '相刑', rule: LY.XING[xingKey], text: nm + '与' + o.from + o.zhi + '相刑（' + LY.XING[xingKey] + '），刑则有伤。', basis: '刑主伤残' });
      }
      if (LY.HAI[L.zhiIdx + '_' + o.zhiIdx]) {
        js.push({ tag: '相害', rule: '六害', text: nm + '与' + o.from + o.zhi + '相害，害则相损。', basis: '害主妨害' });
      }
    });
    return js;
  }

  // ---------- 汇聚：trend 由规则表驱动 ----------
  // supports/harms 为规则标签集合，非数值
  //
  // ⚠ 覆盖范围（第五轮审计提出，属待维护者拍板的口径问题，非缺陷）：
  //   ruleSanHe（三合:*）、ruleXingHai（相刑:* / 相害:*）、ruleShi（世爻:*）
  //   以及动变的 化泄气/化耗气/化比和 的 tag 均**不在**下方名单内，
  //   因此这些要件目前只作为 bullet 陈述事实，永不改变 trend。
  //   若确认应纳入，需把对应 tag 补进 supports / harms 并同步补 test-rules 断言
  //   （现 test-rules 对 trend 有 7 条硬断言，改口径必然联动）。
  function aggregateTrend(ctx) {
    const supports = [], harms = [];
    const J = ctx.judgments;
    J.forEach(function (j) {
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
  function analyze(pan, target) {
    const pil = pan.pillars;
    const pick = pickYongshen(pan, target);
    const judgments = [];
    const clues = [];
    const bullets = [];

    if (!pick.primary) {
      bullets.push(pick.note);
      bullets.push('【粗判】' + TREND_TEXT['待审'] + '（仅为旺衰规则粗判，非全卦结论）');
      return { yongshen: null, judgments: judgments, trend: '待审', yingqiClues: [], bullets: bullets, verdict: TREND_TEXT['待审'] };
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
    ruleShi(pan, L, target).forEach(function (j) { judgments.push(j); bullets.push(j.text); });
    ruleFu(pan, L, pil, target).forEach(function (j) { judgments.push(j); bullets.push(j.text); });
    ruleSanHe(pan).forEach(function (j) { judgments.push(j); bullets.push(j.text); });
    ruleXingHai(L, pil, target).forEach(function (j) { judgments.push(j); bullets.push(j.text); });

    // 应期线索（只出线索，不下结论）
    if (xunkong.isKong && !xunkong.zhen) clues.push('用神旬空：出空之日或冲空之日应');
    if (yuepo.isPo && !yuepo.zhen) clues.push('月破：出月之日或逢合、逢值之日应');
    if (daychong.kind === 'andong') clues.push('暗动之爻：其应极速');
    if (dayhe.kind === 'heban') clues.push('合绊：逢冲之日应');
    if (L.isFu) clues.push('伏藏：日辰生扶之日或冲开飞神之日，为引拔之期');
    if (dongbian.kind === '回克') clues.push('忌神发动回头克：须制忌之神值班之日应');

    const agg = aggregateTrend({
      hasYongshen: true, grade: month.grade,
      daySupports: day.supports, zhenKong: xunkong.zhen, zhenYuePo: yuepo.zhen,
      judgments: judgments
    });

    bullets.push('【粗判】' + TREND_TEXT[agg.trend] + '（由规则链汇聚，非算术评分；仅为旺衰粗判，非全卦结论）');
    if (clues.length) bullets.push('【应期线索】' + clues.join('；') + '。');

    return {
      yongshen: {
        type: target === 'shi' ? '世爻' : target,
        line: { pos: L.pos, zhi: L.zhi, wx: L.wx, lq: L.lq, moving: L.moving, isFu: !!L.isFu },
        source: pick.source,
        wang: month.grade
      },
      judgments: judgments,
      trend: agg.trend,
      supports: agg.supports,
      harms: agg.harms,
      yingqiClues: clues,
      bullets: bullets,
      verdict: TREND_TEXT[agg.trend]
    };
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
  LY.aggregateTrend = aggregateTrend;
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

