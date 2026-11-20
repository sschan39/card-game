# i18n 待迁清单（B2 界面文案全量）

**生成：** 2026-11-17 · **来源：** `scripts/i18n/inventory.mjs`
**完整数据：** `output/2026-11-17/162930/i18n-inventory.csv`（494 行，列 `file,line,kind,text,chars,suggestedKey`）

## 现状

| 项 | 数值 |
|---|---|
| 已国际化键 | 138（`packages/ui/src/i18n/messages/en.json`） |
| 待迁文案 | **494** |
| 涉及文件 | 96 |
| 总字符 | 10,620 |

inventory 只扫**字面量**——已经走 `t('key')` 的地方不会被计入，所以这 494 条就是剩余的全部。

## 按 app 分布

| app | 条数 | 占比 |
|---|---|---|
| `apps/game-client` | 182 | 37% |
| `apps/admin` | 180 | 36% |
| `apps/deck-builder` | 105 | 21% |
| `packages/ui` | 27 | 5% |

## 按类型

| kind | 条数 | 说明 |
|---|---|---|
| `jsx-text` | 273 | JSX 里的可见文本 |
| `literal` | 206 | 工具函数/常量里的字符串：错误消息、日志文案、标签 |
| `jsx-attr` | 15 | `aria-label` / `title` / `placeholder`，**最容易漏** |

## 最重的文件

| 文件 | 条数 |
|---|---|
| `apps/deck-builder/App.tsx` | 75 |
| `apps/admin/pages/Scenarios.tsx` | 66 |
| `apps/admin/pages/Rooms.tsx` | 26 |
| `apps/admin/App.tsx` | 25 |
| `apps/admin/pages/Configuration.tsx` | 19 |
| `apps/admin/pages/Accounts.tsx` | 18 |
| `apps/game-client/store/gameStore.ts` | 15 |
| `apps/admin/pages/Logs.tsx` | 15 |
| `apps/game-client/components/AccountControls.tsx` | 14 |
| `apps/game-client/auth-state.ts` | 14 |
| `apps/game-client/components/CardObservations.tsx` | 13 |
| `apps/game-client/socket.ts` | 12 |

## 分批计划

| 批次 | 范围 | 条数 | 状态 |
|---|---|---|---|
| B2-1 | game-client：首页、大厅、对局、账户表单、卡牌详情 | 182 | 待做 |
| B2-2 | deck-builder：组牌台、目录、面板、账户 | 105 | 待做 |
| B2-3 | admin：登录页、侧栏、四个页签 | 180 | 待做 |
| B2-4 | `packages/ui` 共享层 | 27 | 待做 |

每批做完立即跑 `npx vitest run tests/client/i18n-parity.test.ts`，确认 en / zh-Hant 键集没有漂移，再进下一批。

## 键命名约定

现有键是 dotted 扁平结构（`nav.home`、`locale.switchTo`、`header.copyRoomId`），按归属分层：

| 前缀 | 归属 |
|---|---|
| `common.*` | 跨 app 通用（guest / loading / retry / close） |
| `nav.*` | 顶栏导航 |
| `header.*` | 顶栏其余（环境状态、房间号） |
| `locale.*` | 语言切换器 |
| `player.*` | game-client |
| `builder.*` | deck-builder |
| `admin.*` | admin |

CSV 的 `suggestedKey` 是脚本自动生成的（例如 `player.app.prefers-reduced-motion-reduce`），**仅作参考**，实际命名以可读、可分组为准。

## 不计入迁移的字面量

inventory 会把非文案字符串也扫进来，以下类别应排除并在此登记：

- CSS 媒体查询与属性值（`(prefers-reduced-motion: reduce)`）
- 单元标识、class 名、事件名、协议字段名
- 调试/测试占位串

逐条判断；不确定的保留原文，并在本文件追加一行说明原因。

## 排除记录

| 文件 | 文本 | 原因 |
|---|---|---|
| `apps/game-client/App.tsx:39` | `(prefers-reduced-motion: reduce)` | CSS 媒体查询字符串，不是界面文案 |
