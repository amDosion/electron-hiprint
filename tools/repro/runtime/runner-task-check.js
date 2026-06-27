"use strict";

const {
  completeRunnerTask,
  completePrintTask,
  completeRenderTask,
} = require("../../../src/runner-task");

function expect(name, ok, details) {
  return { name, ok: Boolean(ok), details };
}

const checks = [];

let doneCalls = 0;
const doneMap = {
  "task-1": () => {
    doneCalls += 1;
  },
};
checks.push(
  expect(
    "complete-runner-task-calls-and-deletes-once",
    completeRunnerTask(doneMap, "task-1") === true &&
      doneCalls === 1 &&
      !Object.prototype.hasOwnProperty.call(doneMap, "task-1") &&
      completeRunnerTask(doneMap, "task-1") === false &&
      doneCalls === 1,
    { doneCalls, doneMap },
  ),
);

const sent = [];
const printDoneMap = {
  "print-1": () => {
    sent.push({ type: "done" });
  },
};
const fakeWindow = {
  isDestroyed: () => false,
  webContents: {
    send(channel, payload) {
      sent.push({ channel, payload });
    },
  },
};
completePrintTask(
  { taskId: "print-1" },
  {
    doneMap: printDoneMap,
    runner: { isBusy: () => false },
    getAppWindow: () => fakeWindow,
  },
);
checks.push(
  expect(
    "complete-print-task-deletes-and-emits-busy",
    sent.some((entry) => entry.type === "done") &&
      sent.some(
        (entry) => entry.channel === "printTask" && entry.payload === false,
      ) &&
      !Object.prototype.hasOwnProperty.call(printDoneMap, "print-1"),
    sent,
  ),
);

const renderDoneMap = {
  "render-1": () => {
    sent.push({ type: "render-done" });
  },
};
completeRenderTask({ taskId: "render-1" }, { doneMap: renderDoneMap });
checks.push(
  expect(
    "complete-render-task-deletes",
    sent.some((entry) => entry.type === "render-done") &&
      !Object.prototype.hasOwnProperty.call(renderDoneMap, "render-1"),
    { sent, renderDoneMap },
  ),
);

const failures = checks.filter((check) => !check.ok);
console.log(
  JSON.stringify(
    {
      observed: failures.length,
      failures,
    },
    null,
    2,
  ),
);

if (failures.length > 0) {
  process.exitCode = 1;
}
