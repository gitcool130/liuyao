/* ============================================================
 * 神煞（core/shensha.js）
 *
 * 用途：排盘后可选显示一行神煞（驿马、桃花、贵人、卦身…）。
 * 这一层**不参与断卦**——analyze.js 明确「专凭五行生克，不用神煞」，
 * 所以神煞只做「展示事实」，不给吉凶判断，也不影响任何分析结论。
 *
 * 口径与校验：全部按传世口诀实现，并用两张「六爻排盘宝」实拍盘逐项对过
 * （丙午年 己亥月 乙未日，雷水解 / 雷天大壮）：
 *   驿马巳 桃花子 禄神卯 贵人子申 文昌午 劫煞申 华盖未 将星卯
 *   天喜未 天医戌 阳刃寅 灾煞酉 谋星丑
 *   雷水解 → 卦身丑，香闺子亥（土克水），床帐申酉（土生金）
 *   雷天大壮 → 卦身卯，香闺辰戌丑未（木克土），床帐巳午（木生火）
 * 另用两个古籍通例钉住卦身：乾为天卦身巳、坤为地卦身亥。
 * ============================================================ */
(function (root) {
  const LY = root.LY = root.LY || {};
  const ZHI = LY.ZHI || ['子', '丑', '寅', '卯', '辰', '巳', '午', '未', '申', '酉', '戌', '亥'];
  const GAN = LY.GAN || ['甲', '乙', '丙', '丁', '戊', '己', '庚', '辛', '壬', '癸'];
  const ZHI_WX = LY.ZHI_WX || [
    '水', '土', '木', '木', '土', '火', '火', '土', '金', '金', '土', '水'
  ];

  /* 三合局：日支落在哪一组，决定驿马/桃花/华盖/将星/劫煞/灾煞/谋星 */
  const SANHE_GROUP = {
    申: 'shenzichen', 子: 'shenzichen', 辰: 'shenzichen',
    寅: 'yinwuxu', 午: 'yinwuxu', 戌: 'yinwuxu',
    巳: 'siyouchou', 酉: 'siyouchou', 丑: 'siyouchou',
    亥: 'haimaowei', 卯: 'haimaowei', 未: 'haimaowei'
  };

  /* 各神煞按三合组取值（口诀见每条注释） */
  const BY_GROUP = {
    // 驿马：申子辰马在寅，寅午戌马在申，巳酉丑马在亥，亥卯未马在巳
    驿马: { shenzichen: '寅', yinwuxu: '申', siyouchou: '亥', haimaowei: '巳' },
    // 桃花（咸池）：申子辰见酉，寅午戌见卯，巳酉丑见午，亥卯未见子
    桃花: { shenzichen: '酉', yinwuxu: '卯', siyouchou: '午', haimaowei: '子' },
    // 华盖：申子辰见辰，寅午戌见戌，巳酉丑见丑，亥卯未见未
    华盖: { shenzichen: '辰', yinwuxu: '戌', siyouchou: '丑', haimaowei: '未' },
    // 将星：三合局的中神（子午酉卯）
    将星: { shenzichen: '子', yinwuxu: '午', siyouchou: '酉', haimaowei: '卯' },
    // 劫煞：申子辰见巳，寅午戌见亥，巳酉丑见寅，亥卯未见申
    劫煞: { shenzichen: '巳', yinwuxu: '亥', siyouchou: '寅', haimaowei: '申' },
    // 灾煞：申子辰见午，寅午戌见子，巳酉丑见卯，亥卯未见酉
    灾煞: { shenzichen: '午', yinwuxu: '子', siyouchou: '卯', haimaowei: '酉' },
    // 谋星：申子辰见戌，巳酉丑见未，寅午戌见辰，亥卯未见丑
    // （即三合局的墓库，取「对面那一局」的墓——按六爻实务口径）
    谋星: { shenzichen: '戌', yinwuxu: '辰', siyouchou: '未', haimaowei: '丑' }
  };

  /* 日干类 */
  const LU = { 甲: '寅', 乙: '卯', 丙: '巳', 丁: '午', 戊: '巳', 己: '午', 庚: '申', 辛: '酉', 壬: '亥', 癸: '子' };
  const WENCHANG = { 甲: '巳', 乙: '午', 丙: '申', 丁: '酉', 戊: '申', 己: '酉', 庚: '亥', 辛: '子', 壬: '寅', 癸: '卯' };
  // 阳刃（羊刃）：甲卯 乙寅 丙午 丁巳 戊午 己巳 庚酉 辛申 壬子 癸亥
  const YANGREN = { 甲: '卯', 乙: '寅', 丙: '午', 丁: '巳', 戊: '午', 己: '巳', 庚: '酉', 辛: '申', 壬: '子', 癸: '亥' };
  /* 天乙贵人：甲戊庚牛羊，乙己鼠猴乡，丙丁猪鸡位，壬癸蛇兔藏，六辛逢马虎
   * 竖排是「昼贵、夜贵」两支，两支都显示（排盘宝也是两个字都印）。 */
  const GUIREN = {
    甲: ['丑', '未'], 戊: ['丑', '未'], 庚: ['丑', '未'],
    乙: ['子', '申'], 己: ['子', '申'],
    丙: ['亥', '酉'], 丁: ['亥', '酉'],
    壬: ['巳', '卯'], 癸: ['巳', '卯'],
    辛: ['午', '寅']
  };

  /* 天喜：春戌 夏丑 秋辰 冬未（按季节；以月建所在季取） */
  function tianxi(monthZhi) {
    // 寅卯辰=春 巳午未=夏 申酉戌=秋 亥子丑=冬
    if (monthZhi === 2 || monthZhi === 3 || monthZhi === 4) return '戌';
    if (monthZhi === 5 || monthZhi === 6 || monthZhi === 7) return '丑';
    if (monthZhi === 8 || monthZhi === 9 || monthZhi === 10) return '辰';
    return '未';
  }

  /* 天医：月建退一位（亥月→戌） */
  function tianyi(monthZhi) {
    return ZHI[(monthZhi + 11) % 12];
  }

  /* ---------- 卦身 ----------
   * 阳世从子起、阴世从午起，自初爻向上数至世爻之位，所得地支即卦身。
   * 口诀：「阳世则从子月起，阴世则从午月生，俱从初爻数至世，便知何月为卦身」 */
  function guaShenOf(pan) {
    const L = pan.lines[pan.shi];
    if (!L) return null;
    const base = L.yang ? 0 : 6;              // 子=0；午=6
    const idx = (base + pan.shi) % 12;
    return { zhi: ZHI[idx], wx: ZHI_WX[idx], shiYang: L.yang, shiPos: pan.shi + 1 };
  }

  /* 香闺 / 床帐：由卦身推——
   *   卦身所克者为香闺（我克之五行）
   *   卦身所生者为床帐（我生之五行） */
  const KE = { 木: '土', 土: '水', 水: '火', 火: '金', 金: '木' };
  const SHENG = { 木: '火', 火: '土', 土: '金', 金: '水', 水: '木' };

  /* 取某五行的所有地支。
   * 顺序按「四季土」的习惯写法排：辰戌丑未（排盘宝也是这个次第），
   * 其余按十二支自然序；不这么排会输出「丑辰未戌」，看着别扭。 */
  const TU_ORDER = ['辰', '戌', '丑', '未'];
  function zhiOfWx(wx) {
    const out = [];
    for (let i = 0; i < 12; i++) if (ZHI_WX[i] === wx) out.push(ZHI[i]);
    if (wx === '土') return TU_ORDER.filter(function (z) { return out.indexOf(z) >= 0; });
    return out;
  }

  /* 主入口：pan 是 C.paipan() 的输出
   * 返回 { list:[{name, zhi:[], wx, onLines:[]}], guaShen:{}, xiangGui:[], chuangZhang:[] }
   * onLines 记「这个神煞落在本卦第几爻（1 基）」，用于在界面上标出来 */
  function compute(pan) {
    if (!pan || !pan.pillars) return null;
    const pil = pan.pillars;
    const dayZhiIdx = (typeof pil.dayZhi === 'number') ? pil.dayZhi : ZHI.indexOf(String(pil.dayGZ || '').charAt(1));
    const dayGan = String(pil.dayGZ || '').charAt(0) || GAN[pil.dayIdx % 10];
    const monthZhiIdx = pil.monthZhi;
    const group = SANHE_GROUP[ZHI[dayZhiIdx]];

    const out = [];
    const push = function (name, zhiList, basis) {
      if (!zhiList || !zhiList.length) return;
      const onLines = [];
      pan.lines.forEach(function (L) {
        if (zhiList.indexOf(L.zhi) >= 0) onLines.push(L.pos + 1);
      });
      out.push({ name: name, zhi: zhiList, wx: ZHI_WX[ZHI.indexOf(zhiList[0])], onLines: onLines, basis: basis });
    };

    if (group) {
      const dayZhi = ZHI[dayZhiIdx];
      push('驿马', [BY_GROUP.驿马[group]], '日支' + dayZhi + '（' + groupName(group) + '）');
      push('桃花', [BY_GROUP.桃花[group]], '日支' + dayZhi);
      push('禄神', LU[dayGan] ? [LU[dayGan]] : [], '日干' + dayGan);
      push('贵人', GUIREN[dayGan] || [], '日干' + dayGan);
      push('文昌', WENCHANG[dayGan] ? [WENCHANG[dayGan]] : [], '日干' + dayGan);
      push('阳刃', YANGREN[dayGan] ? [YANGREN[dayGan]] : [], '日干' + dayGan);
      push('劫煞', [BY_GROUP.劫煞[group]], '日支' + dayZhi);
      push('华盖', [BY_GROUP.华盖[group]], '日支' + dayZhi);
      push('将星', [BY_GROUP.将星[group]], '日支' + dayZhi);
      push('天喜', [tianxi(monthZhiIdx)], '月建' + ZHI[monthZhiIdx] + '（' + seasonName(monthZhiIdx) + '）');
      push('天医', [tianyi(monthZhiIdx)], '月建' + ZHI[monthZhiIdx] + '退一位');
      push('灾煞', [BY_GROUP.灾煞[group]], '日支' + dayZhi);
      push('谋星', [BY_GROUP.谋星[group]], '日支' + dayZhi);
    }

    const gs = guaShenOf(pan);
    let xg = [], cz = [];
    if (gs) {
      xg = zhiOfWx(KE[gs.wx] || '');      // 香闺：卦身所克之五行
      cz = zhiOfWx(SHENG[gs.wx] || '');   // 床帐：卦身所生之五行
    }

    return {
      list: out,
      guaShen: gs,
      xiangGui: xg,       // 香闺：卦身所克
      chuangZhang: cz,    // 床帐：卦身所生
      dayGan: dayGan,
      dayZhi: ZHI[dayZhiIdx],
      monthZhi: ZHI[monthZhiIdx]
    };
  }

  function groupName(g) {
    return { shenzichen: '申子辰', yinwuxu: '寅午戌', siyouchou: '巳酉丑', haimaowei: '亥卯未' }[g] || g;
  }
  function seasonName(m) {
    if (m === 2 || m === 3 || m === 4) return '春';
    if (m === 5 || m === 6 || m === 7) return '夏';
    if (m === 8 || m === 9 || m === 10) return '秋';
    return '冬';
  }

  /* 一行文本（古籍版式/复制用；不含样式标记） */
  function toText(s) {
    if (!s) return '';
    const seg = s.list.map(function (it) { return it.name + '-' + it.zhi.join(''); });
    if (s.guaShen) seg.unshift('卦身-' + s.guaShen.zhi);
    return seg.join('　');
  }

  LY.shensha = {
    compute: compute,
    toText: toText,
    guaShenOf: guaShenOf,
    _internals: { SANHE_GROUP: SANHE_GROUP, BY_GROUP: BY_GROUP, LU: LU, GUIREN: GUIREN, WENCHANG: WENCHANG, YANGREN: YANGREN, tianxi: tianxi, tianyi: tianyi, KE: KE, SHENG: SHENG }
  };
})(typeof window !== 'undefined' ? window : globalThis);
