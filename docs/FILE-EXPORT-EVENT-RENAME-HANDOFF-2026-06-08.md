# 交接：file.export 事件去版本号改名（electron-hiprint）

> 日期：2026-06-08
> 目标文件：`tools/utils.js`
> 性质：**flag-day 协调改名**（该导出协议未铺开现网，无需兼容旧版）。
> 配套规范见 vue3-print 仓 `docs/FILE-EXPORT-EVENT-RENAME-2026-06-08.md`。

## 0. 背景

`file.export.v1` 是 **socket.io 事件名**（跨进程网络协议频道名），`v1` 是版本号。该功能尚未发布，
决定**去掉过早的版本后缀**：三端统一把 `file.export.v1*` 改成 `file.export*`。payload 不变，
功能零差异。因无现网旧装机依赖 `file.export.v1`，**无需双版本兼容**。

## 1. 改动（仅事件名，3 处）

`tools/utils.js`（交接时行号，套用前以实际为准）：

| 位置 | 旧 | 新 |
|---|---|---|
| 监听注册（约 1397） | `client.on("file.export.v1", (data) => {...})` | `client.on("file.export", (data) => {...})` |
| `handleFileExportTask` emit error（约 610） | `client.emit("file.export.v1.error", {...})` | `client.emit("file.export.error", {...})` |
| `handleFileExportTask` emit success（约 652） | `client.emit("file.export.v1.success", {...})` | `client.emit("file.export.success", {...})` |

```js
// ① 约 1397
client.on("file.export", (data) => {
  console.log(`中转服务 ${client.id}: file.export`);
  handleFileExportTask(client, data);
});

// ② handleFileExportTask 内
client.emit("file.export.error",   {...});   // was file.export.v1.error
client.emit("file.export.success", {...});   // was file.export.v1.success
```

> `getExportCapability()` **无需新增字段**（去版本化方案不需要能力协商）。
> `.progress` 当前本端不发，若将来加用 `file.export.progress`。

## 2. 验收

- [ ] `grep -r "file.export.v1" tools/` = 0。
- [ ] 发送方发 `file.export` → 本端写盘 → 回 `file.export.success`；错误 → `file.export.error`。
- [ ] payload 字段未变（taskId / replyId / fileName / sha256 / conflictPolicy / mode / payload）。

## 3. 注意

- 三端必须**同期改名**（否则 dev 期间收发对不上）。vue3-print 端已就绪。
- 本仓 `tools/utils.js` 当前处于在途改动（脏树），建议在干净/独立分支落地，避免缠绕。
- 若日后真需版本化：事件名固定 `file.export`，版本号放进 payload（`task.version`），不再用事件名后缀。
