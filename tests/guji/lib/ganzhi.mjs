/* ============================================================
 * (tests/guji/lib/ganzhi.mjs)
 * 干支等价日期搜索 —— 古籍回归的桥接层
 *
 * 古籍卦例只记「月建 + 日辰干支」（如「辰月戊申日」），不记公历年份；
 * 而排盘引擎 paipan(toss, Date) 需要一个 Date。本模块在 1900–2100
 * 区间内寻找一个「月支与日干支均与古籍相同」的日期，作为等价驱动器。
 *
 * 等价性前提（已被引擎结构保证，见 tests/guji/README.md「等价性论证」）：
 *   断卦规则链只依赖 月支（月令旺衰/月破/相刑相害）、日干支
 *   （日辰生克/日冲/日合/旬空/六神起例），不引用年柱与时柱。
 *   故「月支 + 日干支」相同 ⇒ 断卦结果等价，与具体年份无关。
 *
 * 因此无需把节气表下限从 1900 前推至康熙年间——古籍卦例可直接在现代
 * 日期上等价驱动。
 * ============================================================ */
import LY from '../../../core.js';

const GAN = LY.GAN, ZHI = LY.ZHI;
const YEAR0 = 1900, YEAR1 = 2100;

/** 干支（如「戊申」）→ 60 甲子序号（0=甲子），非法返回 -1 */
export function gzIndex(gz) {
  if (typeof gz !== 'string' || gz.length !== 2) return -1;
  const g = GAN.indexOf(gz[0]), z = ZHI.indexOf(gz[1]);
  if (g < 0 || z < 0) return -1;
  for (let i = 0; i < 60; i++) if (i % 10 === g && i % 12 === z) return i;
  return -1;
}

let INDEX = null;

/* 预建 1900–2100 全量索引：key = "<月支idx>:<日干支idx>" → 首个命中日期 */
function build() {
  const map = new Map();
  const j0 = LY.jdn(YEAR0, 1, 1), j1 = LY.jdn(YEAR1, 12, 31);
  for (let j = j0; j <= j1; j++) {
    const dt = LY.jdnToDate(j);
    const di = LY.dayGanZhiIndex(dt.y, dt.m, dt.d);
    const mz = LY.monthZhiIndex(dt.y, dt.m, dt.d, 12, 0);
    const k = mz + ':' + di;
    if (!map.has(k)) map.set(k, dt);
  }
  return map;
}

/**
 * 求「月建 + 日干支」的等价日期（当地正午 12:00，避开夜子时边界）。
 * @returns {Date|null} 无解返回 null（理论上 1900–2100 覆盖下极少见）
 */
export function dateForPillars(monthZhiIdx, dayIdx) {
  if (!INDEX) INDEX = build();
  const d = INDEX.get(monthZhiIdx + ':' + dayIdx);
  if (!d) return null;
  return new Date(d.y, d.m - 1, d.d, 12, 0, 0, 0);
}

/** 便捷版：传「辰」「戊申」这样的字面 */
export function dateForGZ(monthZhi, dayGZ) {
  return dateForPillars(ZHI.indexOf(monthZhi), gzIndex(dayGZ));
}

/**
 * 「只知日干」的等价日期搜索 —— 供表格型古籍用。
 *
 * 部分古籍卦例（如《卜筮正宗》表格版）只印「日干 + 月建」，不印日支。
 * 而六神起例只取决于**日干**（甲乙起青龙…壬癸起玄武），纳甲/六亲/伏神
 * 更与日辰无关。故只要在 1900 起算的 10 日内取一个日干相符的日期即可，
 * 无需日支。
 *
 * ⚠ 该日期只保证「日干」正确；月支/日支为任意值。因此由它驱动的对账
 *   仅对「与月支、日支无关」的字段（纳甲地支/六亲/六神/伏神）有效。
 * @returns {Date|null}
 */
export function dateForDayGan(ganChar) {
  const g = GAN.indexOf(ganChar);
  if (g < 0) return null;
  const j0 = LY.jdn(YEAR0, 1, 1);
  for (let j = j0; j < j0 + 12; j++) {
    const dt = LY.jdnToDate(j);
    if (LY.dayGanZhiIndex(dt.y, dt.m, dt.d) % 10 === g) {
      return new Date(dt.y, dt.m - 1, dt.d, 12, 0, 0, 0);
    }
  }
  return null;
}

export const RANGE = { from: YEAR0, to: YEAR1 };
