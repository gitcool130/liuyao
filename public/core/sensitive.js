/* ============================================================
 * 敏感问题确定性分流 (core/sensitive.js)
 *
 * 纯字符串判定的确定性分流层，不依赖大模型、不作吉凶判断。
 * 参考外部 Agent Skill 的「确定性敏感分流」思路，但分档改为三档
 * （block / advisory / pass），以适配本仓定位：
 *
 *   block    —— 不进入 AI 断卦，直接给现实帮助渠道。
 *               自伤暴力、胎儿性别与母婴安危、失踪/生死定位、
 *               确诊类医疗与生死预后、倾家荡产级财法决策。
 *   advisory —— 允许排盘与断卦，但必须附「不替代就医」提示。
 *               一般健康、疾病恢复类占问（六爻本有此占，不宜一刀切）。
 *   pass     —— 正常放行。
 *
 * 为什么不用「一档全拦」：外部实现把「疾病」整词列入拦截，而本仓
 * 所测之事里「官鬼」本就对应疾病（传统占问之一），全拦会让正常功能失效。
 * 故只拦「确诊 / 手术方案 / 能活多久」这类现实决策，其余走 advisory。
 *
 * 判定全部为子串匹配，零依赖、可单测；命中顺序固定（urgent 优先），
 * 不因对象遍历顺序产生结果漂移。
 * ============================================================ */
(function (root) {
  const LY = root.LY = root.LY || {};

  // 阻断档：命中即不进入 AI 断卦
  const BLOCK_TERMS = {
    self_harm_or_violence: ['想自杀', '不想活', '自杀', '自残', '伤害自己', '结束生命', '杀人', '伤害别人'],
    // 词表刻意避开裸「生」「生产」「生死」「晚期」等高频歧义词：
    //   「这条产线下月能不能生产」「公司生死存亡」「项目晚期还能不能救」
    //   都是正常商事占问，裸词会把它们整批拦死（test-absorb.js 有防回归断言）。
    // 收窄为「医疗/孕产语境下才可能出现的复合词」，宁可漏拦也不误拦正常功能。
    pregnancy_or_child: ['胎儿性别', '男女胎', '男胎', '女胎', '胎儿', '母婴', '保胎', '流产', '能不能生育', '能不能顺产', '生男生女', '预产期'],
    medical_decision: ['确诊', '癌症', '肿瘤晚期', '癌症晚期', '手术方案', '治疗方案', '用药方案', '能活多久', '还能撑多久', '还剩多久', '生死未卜', '性命', '病危'],
    missing_or_crime: ['失踪', '下落不明', '被绑架', '凶手', '是否还活着', '尸体', '埋尸'],
    high_stakes: ['倾家荡产', '全部身家', '高利贷', '借高利贷', '官司一定赢', '能不能逃税']
  };

  // 提示档：可断卦，须附现实提示
  const ADVISORY_TERMS = {
    general_health: ['病情', '重病', '疾病', '康复', '身体恢复', '手术', '住院', '体检', '健康']
  };

  // 无论命中哪一档，只要出现这些词，提示语前置紧急引导
  const URGENT = ['大出血', '出血不止', '剧烈腹痛', '呼吸困难', '昏迷', '失去意识', '想自杀', '自残', '不想活'];

  const MESSAGES = {
    self_harm_or_violence: '这件事不能用卦象判断后果，也请不要独自承受。请立即联系当地急救或心理危机热线，并让可信赖的人陪在身边。',
    pregnancy_or_child: '怀孕结果、胎儿性别与母婴安危不能由卦象判断，请咨询产科或正规医疗机构。',
    medical_decision: '确诊、治疗方案与生死预后不能由卦象判断，请前往正规医疗机构，遵医嘱。',
    missing_or_crime: '失踪者下落、生死与犯罪事实不能由卦象确认，请尽快联系警方或救援机构。',
    high_stakes: '涉及全部身家、高利借贷或诉讼胜负的重大决定，不应由卦象替代，请咨询律师等专业人士。',
    general_health: '卦象可作传统参考，但不能替代医学诊断与治疗；如有不适请及时就医。'
  };

  function hasAny(text, terms) {
    for (let i = 0; i < terms.length; i++) {
      if (text.indexOf(terms[i]) >= 0) return true;
    }
    return false;
  }

  /**
   * 分流主函数。
   * @param {string} question 用户所测之事（可为空；为空直接 pass）
   * @returns {{category:string, action:'block'|'advisory'|'pass', urgent:boolean, message:string}}
   */
  function classifySensitive(question) {
    const text = String(question == null ? '' : question).trim();
    if (!text) return { category: 'not_sensitive', action: 'pass', urgent: false, message: '' };
    const urgent = hasAny(text, URGENT);

    const blockOrder = ['self_harm_or_violence', 'pregnancy_or_child', 'medical_decision', 'missing_or_crime', 'high_stakes'];
    for (let i = 0; i < blockOrder.length; i++) {
      const k = blockOrder[i];
      if (hasAny(text, BLOCK_TERMS[k])) {
        return {
          category: k,
          action: 'block',
          urgent: urgent,
          message: (urgent ? '你描述的情况可能需要立即处理。' : '') + MESSAGES[k]
        };
      }
    }
    const advOrder = ['general_health'];
    for (let i = 0; i < advOrder.length; i++) {
      const k = advOrder[i];
      if (hasAny(text, ADVISORY_TERMS[k])) {
        return {
          category: k,
          action: 'advisory',
          urgent: urgent,
          message: (urgent ? '你描述的情况可能需要立即处理。' : '') + MESSAGES[k]
        };
      }
    }
    return { category: 'not_sensitive', action: 'pass', urgent: false, message: '' };
  }

  LY.classifySensitive = classifySensitive;
  LY.SENSITIVE_BLOCK_TERMS = BLOCK_TERMS;
  LY.SENSITIVE_ADVISORY_TERMS = ADVISORY_TERMS;
})(typeof window !== 'undefined' ? window : globalThis);
