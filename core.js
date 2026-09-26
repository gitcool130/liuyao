/* ============================================================
 * 六爻排盘核心引擎 —— 聚合入口 (core.js)
 *
 * 浏览器（含 file:// 直开）：请按序加载
 *   public/core/data.js → public/core/data-jieqi.js
 *   → public/core/calendar.js → public/core/paipan.js
 *   → public/core/analyze.js
 * （public/index.html 已如此引用；本文件不参与浏览器加载链路）
 *
 * Node：require('./core.js') 聚合全部模块，对外 API 与
 * window.LY 完全一致（测试层入口）。
 * ============================================================ */
if (typeof window === 'undefined') {
  require('./public/core/data.js');
  require('./public/core/data-jieqi.js');
  require('./public/core/calendar.js');
  require('./public/core/paipan.js');
  require('./public/core/analyze.js');
  module.exports = globalThis.LY;
} else {
  // 浏览器兜底：若单独引入本文件（旧页面），提示正确用法与完整顺序
  if (!window.LY || !window.LY.paipan) {
    console.warn('[liuyao] 缺少核心模块。请按以下顺序加载五个文件（顺序不可颠倒，后者依赖前者挂载的全局 LY）：\n' +
      '  <script src="core/data.js"></script>       <!-- 易学常量 -->\n' +
      '  <script src="core/data-jieqi.js"></script> <!-- 节气表（1900-2100） -->\n' +
      '  <script src="core/calendar.js"></script>   <!-- 四柱/旬空/节气 -->\n' +
      '  <script src="core/paipan.js"></script>     <!-- 纳甲排盘 -->\n' +
      '  <script src="core/analyze.js"></script>    <!-- 断卦规则链 -->\n' +
      '（以上路径相对部署根 public/，在仓库根运行测试请用 public/core/ 前缀）');
  }
}
