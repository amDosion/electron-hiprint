# Release Build CI 交接 - 2026-06-22

更新时间：2026-06-22 17:00 +08:00

## 当前结论

`1.0.89` 已经把 Release Build 链路跑通，`自动发布 Release` 也成功发布资产。

之前 `1.0.87` / `1.0.88` 里看到的 `Release Build / 自动发布 Release` 显示 `Skipped` 不是发布 job 自身失败，而是前置矩阵 job `打包 (windows-2025-vs2026, build-w-64, win_x64)` 失败后，`release` job 因为 `needs: build` 被 GitHub Actions 默认跳过。

失败根因集中在 Windows x64 的发布前 smoke 无法恢复 dev Electron runtime，导致 `验证 packaged 主进程启动日志落库` 无法启动 Electron。`5e11504 Restore Electron runtime for release smoke` 已修复该问题。

## 已查证的失败链

### 1.0.87

- Run: https://github.com/amDosion/electron-hiprint/actions/runs/27939852037
- 结论：failure
- 失败 job: `打包 (windows-2025-vs2026, build-w-64, win_x64)`
- 失败 step: `验证 packaged 主进程启动日志落库`
- 日志关键行：

```text
Electron install script did not create D:\a\electron-hiprint\electron-hiprint\node_modules\electron\path.txt
```

该版本已经把 workflow 从 `npx electron ...` 改为：

```text
node tools/repro/runtime/run-electron-script.js tools/repro/runtime/packaged-main-startup-log-check.js
```

但第一版 runner 仍只尝试执行 `node_modules/electron/install.js`，执行后没有生成 `path.txt` 就失败。

### 1.0.88

- Run: https://github.com/amDosion/electron-hiprint/actions/runs/27940242737
- 结论：failure
- 失败 job: `打包 (windows-2025-vs2026, build-w-64, win_x64)`
- 失败 step: `验证 packaged 主进程启动日志落库`
- 日志关键行仍是：

```text
Electron install script did not create D:\a\electron-hiprint\electron-hiprint\node_modules\electron\path.txt
```

这说明 `e783292 Restore Electron path metadata for release smoke` 还不够。原因是它只在 `node_modules/electron/dist/electron.exe` 已存在时恢复 `path.txt`；CI 中该路径仍不满足，runner 继续走 `install.js`，最终仍无 `path.txt`。

### 1.0.89

- Run: https://github.com/amDosion/electron-hiprint/actions/runs/27940866586
- 结论：success
- Tag/head: `1.0.89` / `f42d8dc`
- 该 tag 是 `5e11504 Restore Electron runtime for release smoke` 后的版本 bump，应包含第二版修复。
- Windows x64 job 已通过：
  - `验证 packaged 主进程启动日志落库`
  - `验证在线升级安装后可重启`
- `自动发布 Release` 已通过。

可复查命令：

```powershell
gh run view 27940866586 --repo amDosion/electron-hiprint --json status,conclusion,url,jobs
gh release view 1.0.89 --repo amDosion/electron-hiprint --json tagName,name,publishedAt,url,assets
```

## 当前本地仓库状态

仓库路径：

```text
E:\Source_code\electron-hiprint
```

当前状态：

```text
## master...origin/master [behind 1]
 M docs/HANDOFF-LOG-WINDOW-SPINNER-2026-06-22.md
?? docs/HANDOFF-RELEASE-BUILD-CI-2026-06-22.md
```

本地 `master` 在：

```text
5e11504 Restore Electron runtime for release smoke
```

远端 `origin/master` 在：

```text
f42d8dc chore(release): client 1.0.89 (code change, patch)
```

`origin/master` 只比本地多一个版本 bump：

```text
package.json      1.0.88 -> 1.0.89
package-lock.json 1.0.88 -> 1.0.89
```

注意：本地已有脏文件 `docs/HANDOFF-LOG-WINDOW-SPINNER-2026-06-22.md`，这不是本次 CI 诊断生成的文件，不要随手回滚。

## 相关提交

```text
f42d8dc chore(release): client 1.0.89 (code change, patch)
5e11504 Restore Electron runtime for release smoke
a2a0c52 chore(release): client 1.0.88 (code change, patch)
e783292 Restore Electron path metadata for release smoke
f6ce413 chore(release): client 1.0.87 (code change, patch)
e61386f Keep upgrade smoke independent of npx electron
```

重点看：

- `tools/repro/runtime/run-electron-script.js`
- `tools/repro/build/build-pipeline-check.js`
- `.github/workflows/release.yml`
- `.github/workflows/installers.yml`

## 本地已跑过的验证

在包含第二版修复的本地状态下跑过：

```powershell
node --check tools/repro/runtime/run-electron-script.js
node --check tools/repro/build/build-pipeline-check.js
node tools/repro/build/build-pipeline-check.js
```

结果：

```json
{
  "repoRoot": "E:\\Source_code\\electron-hiprint",
  "observed": 0,
  "risks": []
}
```

## 通过证据

Windows x64 job 日志里在线升级 smoke 的关键结果：

```text
==> Previous install app.asar version verified: 1.0.80
==> Deferred launcher completed
==> Upgraded install app.asar version verified: 1.0.89
SMOKE_RESULT ... "missing": [], "failed": false
==> Startup sqlite log verified ... ==> Electron-hiprint 启动 <==
==> Installed online-upgrade smoke passed
```

Release `1.0.89` 已上传资产：

```text
hiprint_win_x64-1.0.89.exe
hiprint_win_x64-1.0.89.exe.blockmap
hiprint_win_x32-1.0.89.exe
hiprint_win_x32-1.0.89.exe.blockmap
hiprint_mac_arm64-1.0.89.dmg
hiprint_mac_x64-1.0.89.dmg
hiprint_mac_universal-1.0.89.dmg
hiprint_linux_64-1.0.89.deb
hiprint_linux_64-1.0.89.tar.xz
hiprint_linux_arm64-1.0.89.deb
hiprint_linux_arm64-1.0.89.tar.xz
hiprint_Kylin_64-1.0.89.deb
hiprint_Kylin_64-1.0.89.tar.xz
```

## 后续建议

1. 不要回滚现有脏文档。
2. 本地 `master` 可在合适时机执行 `git pull --ff-only origin master` 同步自动版本提交。
3. Release Build 这条链路已经闭环；不要把它误当成软件日志 / 打印记录 spinner 的修复证据。
4. Spinner 复发请按 `docs/HANDOFF-LOG-WINDOW-SPINNER-2026-06-22.md` 的安装态窗口验收继续处理。

如果后续新 release 再失败，优先下载 Windows x64 job 日志：

```powershell
gh run view 27940866586 --repo amDosion/electron-hiprint --json jobs
gh api repos/amDosion/electron-hiprint/actions/jobs/<FAILED_JOB_ID>/logs --header "Accept: application/vnd.github+json" > ci-win-x64.log
```

然后查：

```powershell
Select-String -Path .\ci-win-x64.log -Pattern "MAIN_STARTUP_LOG_RESULT","path.txt","Electron install script","startup-log-missing","require-main-failed","Process completed" -Context 2,4
```

如果再次是 Electron runtime/path 问题，继续修 `tools/repro/runtime/run-electron-script.js`；如果进入 `MAIN_STARTUP_LOG_RESULT`，则说明 runtime 已修好，下一层才是主进程启动日志/SQLite 落库问题。

## 可复制给下一轮 Codex 的提示

```text
我们切到 E:\Source_code\electron-hiprint 继续处理 GitHub Actions Release Build/在线升级验证。

先不要回滚本地脏文件 docs/HANDOFF-LOG-WINDOW-SPINNER-2026-06-22.md。

请先阅读 docs/HANDOFF-RELEASE-BUILD-CI-2026-06-22.md，然后检查最新 Release Build run：
https://github.com/amDosion/electron-hiprint/actions/runs/27940866586

背景：
- 1.0.87 和 1.0.88 都失败在 Windows x64 job 的 `验证 packaged 主进程启动日志落库`。
- 关键错误是 `Electron install script did not create ... node_modules\electron\path.txt`。
- `自动发布 Release` 是因为 `needs: build` 被跳过，不是发布 job 自己失败。
- `5e11504 Restore Electron runtime for release smoke` 是第二版修复；`1.0.89` 应包含它。

任务：
1. 先确认 1.0.89 release 仍存在且资产完整。
2. 若后续新 release 失败，下载失败 job 日志，不要凭 skipped 状态判断 release job 自身失败。
3. 根据真实日志修根因，跑本地 `node --check` 和 `node tools/repro/build/build-pipeline-check.js`，必要时提交并触发新 release tag。
```
