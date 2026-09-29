import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import * as puzzleModule from "../src/content/image-puzzle.js";

// Matches Bing Spotlight's public markup and legal click behavior, inspected 2026-09-29.
function puzzleDocument(initial, { revamped = false, ignoreMoves = false, showSuccess = true } = {}) {
  const board = [...initial];
  const moves = [];
  let started = !revamped;
  let completed = false;
  const cells = board.map((_, index) => ({
    getAttribute(name) { return String(name === "x" ? Math.floor(index / 3) : index % 3); },
    querySelector(selector) {
      return selector === "img.tile" && board[index] >= 0 ? { id: `img${board[index]}` } : null;
    },
    click() {
      if (!started) { started = true; return; }
      if (ignoreMoves) return;
      const empty = board.indexOf(-1);
      assert.equal(Math.abs(Math.floor(empty / 3) - Math.floor(index / 3)) + Math.abs(empty % 3 - index % 3), 1);
      [board[empty], board[index]] = [board[index], board[empty]];
      moves.push(index);
      completed = showSuccess && board.every((value, position) => value === (position === 8 ? -1 : position));
    },
  }));
  return {
    board, moves,
    querySelectorAll(selector) { return selector === "#tiles div.tile" ? cells : []; },
    getElementById(id) {
      if (id === "final_parentTile" && !started) return { parentElement: cells[board.indexOf(-1)] };
      if (id === "congrats") return { classList: { contains: (name) => name === "b_hide" && !completed } };
      return null;
    },
  };
}

const options = { waitAttempts: 2, pollMs: 0, moveDelayMs: 0 };
const userscript = await readFile(new URL("../userscript/bing-rewards-auto-claim.user.js", import.meta.url), "utf8");

for (const runtime of ["extension", "userscript"]) {
  function loadSolver(document) {
    const context = vm.createContext({ document, URL, setTimeout, location: { href: "https://www.bing.com/spotlight/imagepuzzle" }, __BING_REWARDS_USERSCRIPT_TEST__: true });
    if (runtime === "extension") {
      // executeScript serializes the function, so it cannot depend on module closures.
      return vm.runInContext(`(${puzzleModule.solveImagePuzzle.toString()})`, context);
    }
    vm.runInContext(userscript, context);
    return context.__BING_REWARDS_USERSCRIPT_API__.solveImagePuzzle;
  }

  test(`${runtime} solves a difficult 3x3 board using only legal tile clicks`, async () => {
    const document = puzzleDocument([7, 5, 6, 1, 4, 3, 2, -1, 0]);
    const result = await loadSolver(document)(options);
    assert.equal(result.solved, true);
    assert.equal(result.moves, 31);
    assert.equal(document.moves.length, 31);
    assert.deepEqual(document.board, [0, 1, 2, 3, 4, 5, 6, 7, -1]);
  });

  test(`${runtime} starts the revamped puzzle before moving tiles`, async () => {
    const document = puzzleDocument([0, 1, 2, 3, 4, 5, 6, -1, 7], { revamped: true });
    assert.equal((await loadSolver(document)(options)).solved, true);
    assert.equal(document.moves.length, 1);
  });

  test(`${runtime} triggers native completion if the random board starts solved`, async () => {
    const document = puzzleDocument([0, 1, 2, 3, 4, 5, 6, 7, -1]);
    assert.equal((await loadSolver(document)(options)).solved, true);
    assert.equal(document.moves.length, 2);
  });

  test(`${runtime} rejects unsolvable and unknown boards without clicking`, async () => {
    for (const board of [[1, 0, 2, 3, 4, 5, 6, 7, -1], [0, 1, 2, -1]]) {
      const document = puzzleDocument(board);
      await assert.rejects(loadSolver(document)(options), /PUZZLE_(UNSOLVABLE|LAYOUT_UNSUPPORTED)/);
      assert.equal(document.moves.length, 0);
    }
  });

  test(`${runtime} does not call an ignored move or absent success marker complete`, async () => {
    for (const flags of [{ ignoreMoves: true }, { showSuccess: false }]) {
      const document = puzzleDocument([0, 1, 2, 3, 4, 5, 6, -1, 7], flags);
      await assert.rejects(loadSolver(document)(options), /PUZZLE_(MOVE_FAILED|NOT_CONFIRMED)/);
    }
  });
}

test("userscript resumes a navigated puzzle before recording completion", async () => {
  const document = puzzleDocument([0, 1, 2, 3, 4, 5, 6, -1, 7]);
  const location = { href: "https://www.bing.com/spotlight/imagepuzzle", assign(url) { this.href = url; } };
  const store = new Map();
  const context = vm.createContext({
    document, location, URL, __BING_REWARDS_USERSCRIPT_TEST__: true,
    console: { info() {} },
    setTimeout: (callback) => { callback(); return 1; },
    GM_getValue: (key, fallback) => store.get(key) ?? fallback,
    GM_setValue: (key, value) => store.set(key, structuredClone(value)),
  });
  vm.runInContext(userscript, context);
  const api = context.__BING_REWARDS_USERSCRIPT_API__;
  const state = api.createRun("manual");
  const entry = { title: "拼图", text: "拼图 +5", kind: "link", url: location.href, section: "每日活动" };
  state.catalog = [entry];
  state.pending = { entry, recognition: api.classifyEntry(entry), startedAt: Date.now() };
  state.phase = "execute-link-wait";
  await api.resumePhase(state);
  assert.equal(document.moves.length, 1);
  assert.equal(state.results[0].reason, "PUZZLE_COMPLETED");
  assert.equal(state.phase, "rescan-dashboard");
  assert.equal(location.href, "https://rewards.bing.com/dashboard");
});
