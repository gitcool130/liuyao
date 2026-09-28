/* ============================================================
 * (tests/guji/lib/hexname.mjs)
 * 卦名 → 卦画（六爻阴阳，自下而上）归一化解析
 *
 * 用途：古籍排版把「卦画」以卦名文字印刷（如「地雷复之火雷噬嗑」），
 * 而引擎入参需要爻值。本模块把卦名文本规范化为引擎 HEXNAMES 字典中的
 * 标准名，再取其 bits。
 *
 * 定位说明（防止自证）：卦名 ↔ 卦画 是**命名约定（字典）**，与被测的
 * 「卦画 → 装卦」算法无关。此处只做输入规范化，期望值仍全部取自古籍
 * 印刷的装卦内容。字典取自 public/core/data.js 的静态 HEXNAMES。
 * ============================================================ */
import LY from '../../../core.js';

const NAME2KEY = {};
Object.keys(LY.HEXNAMES).forEach(function (k) { NAME2KEY[LY.HEXNAMES[k]] = k; });
const NAMES = Object.keys(LY.HEXNAMES).map(function (k) { return LY.HEXNAMES[k]; });

/** 古籍常见异体/形近字 → 通行字（据实见排版逐字登记） */
const VARIANTS = [
  [/干/g, '乾'],   // 干为天 / 干宫  （「乾」避讳写作「干」）
  [/遯/g, '遁'],
  [/箤/g, '萃'],
  [/同火/g, '同人'],
  [/暌/g, '睽'],
  [/歸/g, '归'],
  [/為/g, '为'],
  [/風/g, '风'],
  [/澤/g, '泽'],
  [/節/g, '节'],
  [/漸/g, '渐'],
  [/隨/g, '随'],
  [/蠱/g, '蛊'],
  [/豐/g, '丰'],
  [/師/g, '师'],
  [/謙/g, '谦'],
  [/觀/g, '观'],
  [/剝/g, '剥'],
  [/晉/g, '晋'],
  [/損/g, '损'],
  [/夬/g, '夬'],
  [/姤/g, '姤'],
  [/渙/g, '涣'],
  [/旅/g, '旅'],
  [/艮/g, '艮'],
  [/震/g, '震']
];

export function normalizeName(s) {
  let x = String(s || '').trim();
  VARIANTS.forEach(function (p) { x = x.replace(p[0], p[1]); });
  return x;
}

function lev(a, b) {
  const dp = [];
  for (let i = 0; i <= a.length; i++) dp.push([i].concat(new Array(b.length).fill(0)));
  for (let j = 0; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
  }
  return dp[a.length][b.length];
}

/**
 * 卦名（可含异体字，允许 1 字之差）→ { name, bits }
 * bits 自下而上（初爻→上爻），1 = 阳
 * @returns {{name:string,bits:number[]}|null}
 */
export function nameToBits(raw) {
  const s = normalizeName(raw);
  let name = NAME2KEY[s] ? s : null;
  if (!name) {
    let bd = 99;
    for (const n of NAMES) { const d = lev(s, n); if (d < bd) { bd = d; name = n; } }
    if (bd > 1) return null;
  }
  const key = NAME2KEY[name];                 // key = 下卦名 + 上卦名
  return { name: name, bits: LY.TRIG[key[0]].bits.concat(LY.TRIG[key[1]].bits) };
}

/** 「X之Y」拆本卦/变卦；无「之」时变卦为 null */
export function splitBiangua(raw) {
  const parts = String(raw || '').split(/之/);
  return { ben: parts[0] || '', bian: parts[1] || null };
}
