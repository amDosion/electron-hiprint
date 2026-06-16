"use strict";

/**
 * Regression for the print-fragment reassembly hole bug (tools/utils.js
 * `socket.on("printByFragments")`).
 *
 * Old bug: completion was gated on a naive `count === total` where `count++`
 * ran for EVERY received fragment. A duplicate/retransmitted fragment (or an
 * out-of-range index) inflated `count` so it could reach `total` while some
 * index slot was still `undefined`. `fragments.join("")` then emitted the
 * literal string "undefined" in place of the missing slot — a silent hole in
 * the printed output.
 *
 * Fix: only write + count a slot when the index is a valid in-range integer AND
 * the slot is still empty. Then `count === total` is equivalent to "every slot
 * 0..total-1 filled" (no holes).
 *
 * This script (a) behaviourally exercises a reducer mirroring the fixed handler,
 * and (b) asserts the production source still contains the guard, so a future
 * "cleanup" that reverts to the naive counter is caught.
 */

const fs = require("fs");
const path = require("path");

const repoRoot = path.resolve(__dirname, "../../..");
const utilsPath = path.join(repoRoot, "tools/utils.js");
const utilsJs = fs.readFileSync(utilsPath, "utf8");

const risks = [];
function expect(condition, id, detail) {
  if (!condition) risks.push({ id, detail });
}

// --- Reducer mirroring the fixed printByFragments slot/count logic ----------
// `currentInfo` is null for a task's first fragment; ingest lazy-inits it then,
// mirroring the production `PRINT_FRAGMENTS_MAPPING[id] || (... = {...})`. Each
// scenario in run() starts a fresh `info = null`, so state never leaks across
// scenarios.
function ingest(currentInfo, data) {
  const { total, index, htmlFragment } = data;
  if (!currentInfo) currentInfo = { total, fragments: [], count: 0 };
  if (
    Number.isInteger(index) &&
    index >= 0 &&
    index < currentInfo.total &&
    currentInfo.fragments[index] === undefined
  ) {
    currentInfo.fragments[index] = htmlFragment;
    currentInfo.count++;
  }
  const complete =
    currentInfo.total > 0 && currentInfo.count === currentInfo.total;
  return {
    info: currentInfo,
    complete,
    html: complete ? currentInfo.fragments.join("") : null,
  };
}

function run(events) {
  let info = null;
  let last = { complete: false, html: null };
  for (const ev of events) {
    last = ingest(info, ev);
    info = last.info;
  }
  return last;
}

// 1. Happy path: in-order fragments complete and join in order.
{
  const r = run([
    { id: "a", total: 3, index: 0, htmlFragment: "A" },
    { id: "a", total: 3, index: 1, htmlFragment: "B" },
    { id: "a", total: 3, index: 2, htmlFragment: "C" },
  ]);
  expect(
    r.complete && r.html === "ABC",
    "HAPPY-PATH",
    `expected ABC, got ${r.html}`,
  );
}

// 2. Duplicate fragment must NOT trigger premature completion with a hole.
{
  const r = run([
    { id: "a", total: 3, index: 0, htmlFragment: "A" },
    { id: "a", total: 3, index: 0, htmlFragment: "A" }, // duplicate
    { id: "a", total: 3, index: 1, htmlFragment: "B" }, // total real = 2, count must stay 2
  ]);
  expect(
    !r.complete,
    "DUPLICATE-PREMATURE-COMPLETE",
    "duplicate index inflated count → false completion",
  );
}

// 3. Out-of-order fragments still complete correctly with no hole.
{
  const r = run([
    { id: "a", total: 3, index: 2, htmlFragment: "C" },
    { id: "a", total: 3, index: 0, htmlFragment: "A" },
    { id: "a", total: 3, index: 1, htmlFragment: "B" },
  ]);
  expect(
    r.complete && r.html === "ABC",
    "OUT-OF-ORDER",
    `expected ABC, got ${r.html}`,
  );
  expect(
    !r.html || !r.html.includes("undefined"),
    "OUT-OF-ORDER-HOLE",
    "join produced an undefined hole",
  );
}

// 4. Out-of-range / non-integer index is rejected (cannot inflate count).
{
  const r = run([
    { id: "a", total: 2, index: 0, htmlFragment: "A" },
    { id: "a", total: 2, index: 5, htmlFragment: "X" }, // out of range
    { id: "a", total: 2, index: "1", htmlFragment: "Y" }, // non-integer
  ]);
  expect(
    !r.complete,
    "BAD-INDEX-ACCEPTED",
    "out-of-range/non-integer index inflated count",
  );
}

// 5. total=0 must never auto-complete with empty output.
{
  const r = run([{ id: "a", total: 0, index: 0, htmlFragment: "A" }]);
  expect(!r.complete, "ZERO-TOTAL-COMPLETE", "total=0 wrongly completed");
}

// --- Source guard: production handler must keep the hole-safe guard ----------
expect(
  /currentInfo\.fragments\[index\]\s*===\s*undefined/.test(utilsJs) &&
    /Number\.isInteger\(index\)/.test(utilsJs),
  "FRAGMENT-GUARD-MISSING",
  "printByFragments must only count a fresh, valid, in-range index slot; do not revert to a naive count++ per fragment.",
);

const result = { repoRoot, observed: risks.length, risks };
console.log(JSON.stringify(result, null, 2));
process.exitCode = risks.length > 0 ? 1 : 0;
