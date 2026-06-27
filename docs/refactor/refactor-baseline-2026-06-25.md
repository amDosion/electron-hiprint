# 精准重构基线记录

日期：2026-06-25

本文件记录执行 `docs/refactor/precision-refactor-task-list-2026-06-25.md` 前的工作区状态。后续每个重构 task 都应以此为边界，避免把既有未提交改动误认作本轮重构结果。

## 当前工作树

`git status --short --branch`：

```text
## master...origin/master
 M .github/workflows/installers.yml
 M .github/workflows/release.yml
 M package.json
 M src/app-window.js
 M src/renderer/app/windows/console/AppShell.vue
 M src/renderer/app/windows/console/main.ts
 M tools/build-package.js
?? docs/refactor/
```

`git diff --stat` 中既有未提交改动：

```text
.github/workflows/installers.yml              |  3 --
.github/workflows/release.yml                 |  9 ----
package.json                                  |  1 -
src/app-window.js                             | 60 +++++++++++++++++++++------
src/renderer/app/windows/console/AppShell.vue |  4 ++
src/renderer/app/windows/console/main.ts      | 41 +++++++++++-------
tools/build-package.js                        |  5 ---
7 files changed, 77 insertions(+), 46 deletions(-)
```

## 基线解释

- CI/release/build target 改动已经存在于工作区；本轮精准重构不应擅自恢复或扩大这些改动。
- console 启动和 Element Plus 按需加载改动已经存在于工作区；后续性能相关检查应以当前工作树为当前基线。
- `docs/refactor/` 是本轮新增的重构跟踪目录。

## 重构约束

- 先修复验证护栏，再重构业务边界。
- 每个 task 只修改自己的归属边界。
- 触碰 release workflow、preload、Socket.IO、SQL、路径、网络或文件导出时，必须明确不变量和验证命令。
- 不用宽泛 catch、静默失败、跳过测试、类型弱化或 warning suppression 来制造通过结果。
