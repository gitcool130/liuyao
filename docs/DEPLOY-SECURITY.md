# 部署与加固清单（2026-11-09 复核）

> 对应 `liuyao-security-review.md` 中的高危/中危项。代码侧已改完并通过
> `npm test` + `test:fn`（392 项）；**Functions 与 `public/` 都有变更，必须重新部署**
> 才生效（secret 变更同样需要重新部署一次，见 README）。

## 一、本次改了什么

| # | 文件 | 行为变更 | 旧行为的问题 |
|---|---|---|---|
| 1 | `functions/api/_lib.js` | `writeGuard()`：写请求强制 `Content-Type: application/json`（415）+ `Origin` 同源（403，可用 `ALLOWED_ORIGINS` 放行） | `text/plain` 属浏览器「简单请求」不触发预检，任意网页可借访客 IP 调付费端点 |
| 2 | `functions/api/_lib.js` | `readJsonLimited()`：按实际字节流式累计，超限即 `cancel()` 上游流 | 只信 `Content-Length`，不带该头的 600 KB body 实测直接进业务逻辑 |
| 3 | `functions/api/_lib.js` | `rateLimit()`：默认开启，interpret 20/min、vote 6/min，`0` 才关闭 | 未配置即不限流 = 无边界；vote 一次 3 票 ≈ 17 neurons |
| 4 | `functions/api/_lib.js` | `json()` 单点加 `Cache-Control: no-store` + `X-Content-Type-Options: nosniff` | 三份拷贝，加头只改一处 |
| 5 | `functions/api/_lib.js` | `isSafeProviderBase()`：`CUSTOM_PROVIDERS[].base` 只收 https 公网主机名 | 配置层可指向 `169.254.169.254` / 内网（SSRF 跳板） |
| 6 | `interpret.js` / `vote.js` / `records.js` / `readings.js` | 上述守卫接入各写路径 | — |
| 7 | `functions/index.js` | 改写过的 HTML 显式补 HSTS + nosniff | `_headers` 只管静态资产，Functions 响应漏网 |
| 8 | `public/_headers` | 静态资源加 `Strict-Transport-Security: max-age=31536000; includeSubDomains` | 线上无 HSTS |

**行为上唯一需要留意的**：`RATE_LIMIT_PER_MIN` 从「可选」变成「默认 20/6」。若某天要做压测，
显式设 `RATE_LIMIT_PER_MIN=0` 再部署。

## 二、部署（按顺序）

```bash
# 0) 确认工作区干净、测试全绿
git status --short
npm test && npm run test:fn

# 1) 轮换口令（值走 stdin，不要写进任何文件/命令历史）
npx wrangler pages secret put LIB_CODE --project-name=liuyao
# 如启用全站口令：npx wrangler pages secret put ACCESS_CODE --project-name=liuyao

# 2) 部署（部署根是 public/，LF 归一化副本见 README §部署）
npx wrangler pages deploy public --project-name=liuyao --branch=main \
  --commit-hash=$(git rev-parse HEAD) --commit-message="sec: 写路径守卫/流式限量/默认限流/HSTS"

# 3) 若换了 API Token，顺手重设（CLOUDFLARE_API_TOKEN 只放本机环境变量）
export CLOUDFLARE_API_TOKEN='<新token>'
```

## 三、部署后验收（逐条应命中预期码）

```bash
B=https://liuyao.dhxlsfn.dpdns.org

# ① 跨站 + 简单请求 → 415（旧版会越过守卫进入业务逻辑）
curl -s -o /dev/null -w '%{http_code}\n' -X POST "$B/api/interpret" \
  -H 'content-type: text/plain' -H 'Origin: https://evil.example' --data '{}'

# ② 跨站 JSON → 403
curl -s -o /dev/null -w '%{http_code}\n' -X POST "$B/api/interpret" \
  -H 'content-type: application/json' -H 'Origin: https://evil.example' --data '{}'

# ③ 600 KB 且不带 Content-Length → 413
curl -s -o /dev/null -w '%{http_code}\n' -X POST "$B/api/interpret" \
  -H 'content-type: application/json' -H 'Transfer-Encoding: chunked' \
  --data-binary @<(python3 -c 'print("{\"panText\":\""+"A"*614400+"\"}")')

# ④ 默认限流：同一 IP 连打 25 次，应出现 429
for i in $(seq 1 25); do
  curl -s -o /dev/null -w '%{http_code} ' -X POST "$B/api/vote" \
    -H 'content-type: application/json' --data '{"state":"x"}'
done; echo

# ⑤ HSTS 已下发
curl -sI "$B/" | grep -i strict-transport

# ⑥ 全站口令仍有效（设了 ACCESS_CODE 时）
curl -s -o /dev/null -w '%{http_code}\n' "$B/api/records"
```

期望：① `415`　② `403`　③ `413`　④ 前若干 `400/200`、之后 `429`　⑤ 有该头　⑥ `401`（未设口令则 `200`）。
③ 若返回 `400`，说明 curl 未能构造出无 `Content-Length` 的请求——改用浏览器 DevTools 或
`node -e` 以 `ReadableStream` 作 body 复验（`test-functions.mjs` 的 #26 组即此写法）。

## 四、Cloudflare 后台必做（CLI 不支持）

代码侧的限流是**每 isolate 一份内存**，挡不住分布式重放。控制台补一条兜底规则：

1. Security → WAF → Rate limiting rules → Create rule
2. 表达式：`(http.request.uri.path in {"/api/interpret" "/api/vote"})`
3. 速率：`60 requests / 1 minute`，按 `IP`，动作 `Block`，时长 `1 minute`
4. 再加一条针对 `/api/records` 的 `120 / 1 minute`（正常翻页够用）

另建议：SSL/TLS → Edge Certificates 确认 **Always Use HTTPS** 与 **HSTS** 已开（本次代码只是补头，
HSTS 一旦被浏览器记住就不可撤回，确认后再开）。

## 五、若凭据曾经外泄

轮换顺序（前一项做完再做下一项，避免中途互相依赖）：

1. **GitHub PAT** → Settings → Developer settings → Tokens → 删除/重发；随后查 security log 有无陌生 IP。
2. **Cloudflare API Token** → My Profile → API Tokens → Roll；查 Audit Log 最近 24h。
3. **Tunnel token（`cfut_`）** → `cloudflared tunnel token <name>` 重签，旧 token 立即失效。
4. **站点口令**（`LIB_CODE` / `ACCESS_CODE`）→ 重新 `secret put` + 重新部署。
5. 最后再换 CI 里的 `CLOUDFLARE_API_TOKEN`。

> Account ID / D1 UUID 不是凭据，但已存在于公开仓库的历史提交中（`3e473e2`、`0e49ec6`），
> 无需改写历史；只要 token 轮换过，它们的暴露不构成直接风险。
