# @dong-victor/dsh-opencodego-usage

查看**链接的 opencode Go 套餐余额**的 DSH Web GUI 插件：侧边栏「Go 余额」入口 + 中央列面板，展示 `rolling / weekly / monthly` 三档用量百分比、状态徽章、重置时间与实时倒计时；同时提供 agent 工具 `opencode_go_balance` 与系统提示词声明，让助手也能直接回答「opencode Go 套餐还剩多少」。

完全复用 DSH 已有的 LLM 接线（`llm-deepseek` 设置 + credentials 服务），**无需再配一把密钥**。

## 数据来源

官方端点（OpenAI 兼容网关的用量接口）：

```
GET https://opencode.ai/zen/go/v1/usage
Authorization: Bearer <key>
```

响应：

```json
{
  "usage": {
    "rolling": { "status": "ok", "percent": 1,  "resetsAt": "2026-08-14T06:44:12.569Z" },
    "weekly":  { "status": "ok", "percent": 12, "resetsAt": "2026-08-17T00:00:00.569Z" },
    "monthly": { "status": "ok", "percent": 35, "resetsAt": "2026-08-30T02:03:31.569Z" }
  }
}
```

- `percent` = 该窗口已使用的百分比（`100 - percent` 即剩余额度）；
- `status` = `ok`（正常）或其它（如超额时提示注意）；
- `resetsAt` = 该窗口重置时间（ISO），面板显示本地时间 + 每秒跳动的倒计时。

> 无密钥 / 无效密钥 → HTTP 401；本插件把 401/403 转成可读错误「密钥缺失、过期或无 Go 套餐权限」。
> 其它路径（`/zen/go/v1/subscription`、`/api/usage` 等）均为 404，`/zen/go/v1/usage` 是唯一可用余额端点（已实测验证）。

## 架构

双面插件（同 dsh-ssh 模式），零构建依赖、纯 JS、即装即用。运行时唯一的外部依赖是 `@deepseek-ai/dsh-tools`（工具注册契约，peer 依赖 `^0.1.0-rc.6`，与 dsh-ssh 等官方插件声明一致）——由 DSH 宿主按官方版本提供，插件不自带固定旧版副本、不随包维护：

```
dsh-opencodego-usage/
├── package.json          # dsh.bundle.patch + dsh.client 声明（exports["./client"]）+ dsh-tools peer 依赖
├── cordis.patch.yml      # 向 web profile 行列插入 {id: opencode-go}
├── lib/
│   ├── index.js          # 宿主半面（ESM）：余额服务 + 路由 + 工具 + 提示词
│   └── client.js         # 浏览器半面（手写 CJS bundle，零外部 require）
└── test/                 # host-boot + client-smoke 两套回归测试
```

### 宿主半面 `lib/index.js`

| 能力 | 说明 |
| --- | --- |
| `GET /api/dsh-opencode-go/balance` | 回环防护（仅本机/同源），`?refresh=1` 绕过缓存；返回 `{ok, fetchedAt, cached, source, usage?, error?}` |
| 密钥/端点解析 | 默认取 `settings.get('llm-deepseek')` 的 `baseURL`（取 origin）与 `apiKeyEnv`；credentials 服务 `resolve(ref)`，`process.env` 兜底；可用插件 config 覆盖 |
| 缓存 | 内存 30s TTL（可配 `cacheTtlMs`），缓存命中不触发上游请求 |
| 工具 | `opencode_go_balance`（dsh-tools `defineTool`，结构化 schema + markdown render） |
| 提示词 | `plugin:dsh-opencode-go` 段（order 150），声明能力与限制 |

插件 config（在 patch 入口的 `config` 字段配置，均可选）：

```yaml
- insert:
    - id: opencode-go
      name: '@dong-victor/dsh-opencodego-usage'
      config:
        enabled: true          # 总开关
        announceToAgent: true  # 是否向 agent 声明
        # apiBaseUrl: 'https://opencode.ai'      # 覆盖端点（默认取 llm-deepseek baseURL 的 origin）
        # apiKeyEnv: 'OPENCODE_GO_API_KEY'          # 覆盖凭据引用
        # cacheTtlMs: 30000
        # timeoutMs: 15000
```

### 浏览器半面 `lib/client.js`

- 侧边栏入口：DOM 级注入（MutationObserver 自愈，React 重渲染后同帧复位），**余额直接显示在侧边栏、无需点击**——头部（图标 + 「Go 余额」）+ 三行明细（5小时 / 周 / 余额），每行含进度条（>60% 变黄、≥90% 变红）、已用百分比、重置时间（24h 内显示 HH:mm，否则 MM/DD HH:mm），60s 自动刷新（宿主 30s 缓存兜底）；悬停 tooltip 显示完整明细；
- 点击条目打开中央列面板：`[data-pane="conversation"]` 内绝对定位容器（**不透明背景**，避免对话文本透底）+ `<html data-dsh-opencode-go-active>` 控制显隐，与 SSH / 任务看板面板互斥（跨插件 `dsh-panel-activate` 事件协调）；
- 三张用量卡：进度条（>60% 变黄、≥90% 变红）、状态徽章、已用/剩余百分比、重置时间 + 每秒倒计时；
- 刷新按钮（`?refresh=1`）、关闭按钮、错误横幅、端点/密钥元信息（密钥只显示掩码 `sk-yAE…eLEj`）；
- 样式全部走 dsh `--dsw-*` 主题 token，跟随皮肤明暗；中英双语（`document.lang` 自动切换）。

## 安装

```powershell
# 在插件目录（本包）外执行，把本地链接装进 web profile 并加入 bundle 层
dsh plugin --profile web add link:C:\Users\dongz\.dsh\workspace\dsh-opencodego-usage
```

- `dsh plugin` 会向 `~/.dsh/profiles/web` 跑 `pnpm add link:<绝对路径>`，然后把声明了 `dsh.bundle` 的包名写进 `dsh.profile.bundles`；
- **重启 `dsh web`** 使新的 bundle 层生效（浏览器刷新不够——宿主 loader 在启动时读 bundle 层；`/plugins/<id>/client.js` 是启动后按需加载的）。
- 卸载：`dsh plugin --profile web remove @dong-victor/dsh-opencodego-usage`，再重启。

## 开源发布与命令行安装

包已按 npm 发布标准整理（`files` 只含 `lib/`、`cordis.patch.yml`、`README.md`、`LICENSE`，无 node_modules/lockfile；`npm pack --dry-run` 已核对）。发布后任何机器都能：

```powershell
# 安装（会加入 dsh.profile.bundles，重启 dsh web 生效）
dsh plugin --profile web add @dong-victor/dsh-opencodego-usage

# 卸载
dsh plugin --profile web remove @dong-victor/dsh-opencodego-usage
```

发布步骤（一次性）：

```bash
# 1) 推送到 GitHub（仓库名建议与包名一致）
cd dsh-opencodego-usage
git remote add origin git@github.com:<你的账号>/dsh-opencodego-usage.git
git push -u origin main

# 2) 发布到 npm 官方源（注意：scope @dong-victor 必须是你自己的 npm 用户名/org；
#    本机 registry 若配了 npmmirror 镜像，发布必须显式走官方源）
npm login --registry=https://registry.npmjs.org     # 账号必须是 dong-victor
npm publish --access public --registry=https://registry.npmjs.org

# 之后每次改代码：npm version patch && npm publish --registry=https://registry.npmjs.org
```

安装侧注意事项：

- **registry**：本机 pnpm/npm 若指向 npmmirror 镜像，新包同步有延迟；想立即安装可在 `dsh plugin` 命令后追加 pnpm 参数：`dsh plugin --profile web add @dong-victor/dsh-opencodego-usage --registry=https://registry.npmjs.org`。
- **依赖随宿主**：`@deepseek-ai/dsh-tools` 声明为 peer 依赖（`^0.1.0-rc.6`，同官方插件），运行时解析到 DSH 宿主安装的官方版本，插件不随包维护固定旧版；本地开发/测试时 npm 会自动装上该 peer。
- **`dsh.bundle` 自动接线**：安装后 `dsh plugin` 自动把包名写入 `dsh.profile.bundles`（reconcile 机制），无需手动改 profile；`remove` 会自动移除。
- **版本升级**：`dsh plugin --profile web update`（pnpm update）拉取新版本，重启生效。
- 已验证（tarball 等价流程）：临时 profile 上 `add file:<tgz>` → 依赖安装 + bundles 自动加入 + `import()` 解析正常 + `remove` 干净卸载。

## 前置条件

- web profile 已配置 `llm-deepseek.baseURL = https://opencode.ai/zen/go/v1`（即本机现状）；
- `OPENCODE_GO_API_KEY` 已通过 credentials 服务保存（`~/.dsh/.credentials.yaml`，Web「模型」设置页写入），且该 key 享有 opencode Go 套餐。

## 安全与限制

- 余额查询是只读操作；路由带 loopback/same-origin 防护；
- 密钥仅在本机用于请求上游，响应中只回传掩码 `keyHint`；
- 依赖 opencode 官方端点可用性与套餐有效性；网络不可达/密钥失效时面板显示错误横幅，agent 工具返回 `ok:false + error`；
- 上游用量数据是分档百分比，无余额数值（官方端点不提供），面板按「已用/剩余 % + 重置时间」呈现。

## 开发者自测

插件对 `@deepseek-ai/dsh-tools` 只声明 peer 依赖（`^0.1.0-rc.6`），npm 安装时自动带上官方版本，测试只需 jsdom：

```bash
cd dsh-opencodego-usage
npm install            # 首次（装 jsdom；dsh-tools peer 依赖自动带上）
npm test               # 两套测试：
                       #  host-boot.test.mjs    模拟 loader 调 apply()：路由/工具/提示词注册、
                       #                         工具 schema 编译、execute/render/dispose（12 项断言）
                       #  client-smoke.test.mjs jsdom DOM 冒烟：注册/挂载/渲染/倒计时/刷新/错误/销毁（28 项断言）

# 宿主逻辑（真实请求，需要可用密钥；密钥默认走 credentials 服务 / 环境变量）
node -e "import('./lib/index.js').then(async m => {
  const s = await m.resolveSource({ get(){return undefined} }, {});
  console.log(s);
  const svc = new m.BalanceService({ getSource: () => m.resolveSource({ get(){return undefined} }, {}) });
  console.log(await svc.get({ refresh: true }));
})"
```
