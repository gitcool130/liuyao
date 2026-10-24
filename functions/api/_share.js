/* functions/api/_share.js —— Worker 侧门面，不含任何解码逻辑。
 * 顺序不可换：share.js 在模块求值期就要读 LY.jdn 算 BASE_JDN（share.js:42），
 * 且 decodeCast 依赖 LY.jdnToDate；calendar 必须先于 share 执行。
 * data/data-jieqi 是 calendar 的节气表依赖，paipan 供 OG 组卦名（见 proposal-og-preview.md §四）。
 * 红线：禁止在此 import analyze / yingqi-window / sensitive 等断语层模块。
 * 防漂移：全仓 share 码编解码物理实现仅 public/core/share.js 一份（test-functions.mjs
 * 有「门面与 core.js 的 decodeCast 同一函数引用」断言钉住，红掉即意味着此处私藏了第二份实现）。
 */
import '../../public/core/data.js';
import '../../public/core/data-jieqi.js';
import '../../public/core/calendar.js';
import '../../public/core/paipan.js';
import '../../public/core/share.js';

// 五个 import 求值完毕后 globalThis.LY 已挂好（ESM 保证依赖先于本模块体执行；
// share 是挂全局、非 ESM 导出，只能从 globalThis 取）。直接绑定原函数引用而非
// 包一层转发：test-functions.mjs 以「门面 decodeCast === core.js 的 LY.decodeCast」
// 严格相等钉死单一实现——包转发会让该断言永红，也让「私藏第二份实现」失去探测手段。
const LY = globalThis.LY;
export const decodeCast = LY.decodeCast;
export const dateOfWall = LY.dateOfWall;
export const fourPillars = LY.fourPillars;
export const paipan = LY.paipan;
