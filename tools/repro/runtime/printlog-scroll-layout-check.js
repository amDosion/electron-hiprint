"use strict";

// 打印记录窗口布局回归（需真实 Electron）。
// 守护用户报告的缺陷：旧版用脆弱的 calc(100vh - …) 固定表高，搜索卡换行/尺寸变化时
// 整窗滚动、分页被顶出视口。修复为 flex 纵向布局：搜索卡与分页 flex:0 0 auto 固定，
// 表格区 .table-wrap flex:1 + min-height:0，el-table height="100%" 由表体内部滚动。
//
// 经 app:// 加载已构建的 assets/printLog.html，附真实 preload，注入 50 行后断言四不变式：
//   1) 整窗不滚动（documentElement 不溢出视口）
//   2) 表体可内部滚动（el-scrollbar__wrap scrollHeight > clientHeight）
//   3) 分页固定且完整可见（getBoundingClientRect().bottom <= innerHeight）
//   4) 表格区有确定高度（flex 解析出像素高，>0）
// 运行：npx electron tools/repro/runtime/printlog-scroll-layout-check.js
// 约定：stdout 打印 LAYOUT_RESULT <json>，failed=false 且退出码 0 表示通过。

const path = require("path");
const REPO_ROOT = path.resolve(__dirname, "../../..");

const electron = require("electron");
const { app, BrowserWindow, ipcMain } = electron;

app.getAppPath = () => REPO_ROOT;

ipcMain.on("hiprint:store-get", (event, key) => {
  event.returnValue = key === "rePrint" ? 1 : undefined;
});

const {
  registerAssetSchemeAsPrivileged,
  registerAssetProtocol,
} = require(path.join(REPO_ROOT, "src/asset-protocol"));

registerAssetSchemeAsPrivileged();
app.disableHardwareAcceleration();

function mockRows(n) {
  const rows = [];
  for (let i = 0; i < n; i++) {
    rows.push({
      id: i + 1,
      timestamp: Date.now() - i * 1000,
      clientType: i % 2 ? "transit" : "local",
      printer: "Printer-" + (i % 3),
      templateId: "tpl-" + i,
      pageNum: (i % 4) + 1,
      status: i % 5 ? "success" : "failed",
      errorMessage: i % 5 ? "" : "示例错误信息",
      rePrintAble: 1,
    });
  }
  return rows;
}

function fail(message) {
  console.log("LAYOUT_RESULT " + JSON.stringify({ failed: true, message }));
  app.exit(1);
}

app.whenReady().then(async () => {
  registerAssetProtocol();
  const win = new BrowserWindow({
    width: 1100,
    height: 600,
    show: false,
    webPreferences: {
      preload: path.join(REPO_ROOT, "src/preload/printLog.js"),
      sandbox: true,
      contextIsolation: true,
    },
  });

  const consoleErrors = [];
  win.webContents.on("console-message", (_e, level, message) => {
    // type.text 弃用提示是 element-plus 既有噪声，非本窗口缺陷，过滤掉
    if (level >= 2 && !/type\.text is about to be deprecated/.test(message)) {
      consoleErrors.push(message);
    }
  });

  try {
    await win.loadURL("app://bundle/printLog.html");
  } catch (err) {
    fail("loadURL failed: " + (err && err.message));
    return;
  }

  win.webContents.send("print-logs", { rows: mockRows(50), total: 200 });
  await new Promise((r) => setTimeout(r, 600));

  const geom = await win.webContents.executeJavaScript(`(() => {
    const tableWrap = document.querySelector('.table-wrap');
    const bodyWrap = document.querySelector('.table .el-scrollbar__wrap')
      || document.querySelector('.table .el-table__body-wrapper');
    const pager = document.querySelector('.pagination');
    const pr = pager ? pager.getBoundingClientRect() : null;
    return {
      winH: window.innerHeight,
      docScrollable: document.documentElement.scrollHeight > window.innerHeight + 1,
      tableWrapH: tableWrap ? tableWrap.clientHeight : -1,
      bodyScrollH: bodyWrap ? bodyWrap.scrollHeight : -1,
      bodyClientH: bodyWrap ? bodyWrap.clientHeight : -1,
      bodyScrollable: bodyWrap ? bodyWrap.scrollHeight > bodyWrap.clientHeight + 1 : false,
      rowCount: document.querySelectorAll('.table .el-table__body tr').length,
      paginationBottom: pr ? Math.round(pr.bottom) : -1,
      paginationVisible: pr ? (pr.bottom <= window.innerHeight + 1 && pr.top >= 0) : false,
    };
  })()`);

  win.destroy();

  const checks = {
    "window-not-scrollable": geom.docScrollable === false,
    "table-body-scrolls": geom.bodyScrollable === true,
    "pagination-fixed-visible": geom.paginationVisible === true,
    "table-region-has-height": geom.tableWrapH > 0,
    "rows-rendered": geom.rowCount === 50,
    "no-console-errors": consoleErrors.length === 0,
  };
  const failedChecks = Object.keys(checks).filter((k) => !checks[k]);

  console.log(
    "LAYOUT_RESULT " +
      JSON.stringify({
        failed: failedChecks.length > 0,
        failedChecks,
        geom,
        consoleErrors,
      }),
  );
  app.exit(failedChecks.length > 0 ? 1 : 0);
});
