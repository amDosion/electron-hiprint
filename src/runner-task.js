"use strict";

function completeRunnerTask(doneMap, taskId) {
  if (!taskId || !doneMap) return false;
  const done = doneMap[taskId];
  delete doneMap[taskId];
  if (typeof done !== "function") return false;
  done();
  return true;
}

function completePrintTask(data, { doneMap, runner, getAppWindow }) {
  completeRunnerTask(doneMap, data && data.taskId);
  const win = getAppWindow && getAppWindow();
  if (win && !win.isDestroyed()) {
    win.webContents.send(
      "printTask",
      !!(runner && typeof runner.isBusy === "function" && runner.isBusy()),
    );
  }
}

function completeRenderTask(data, { doneMap }) {
  completeRunnerTask(doneMap, data && data.taskId);
}

module.exports = {
  completeRunnerTask,
  completePrintTask,
  completeRenderTask,
};
