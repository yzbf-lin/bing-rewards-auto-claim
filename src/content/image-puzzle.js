// The self-contained page function is injected by chrome.scripting.executeScript.
export async function solveImagePuzzle({ waitAttempts = 60, pollMs = 100, moveDelayMs = 120 } = {}) {
  const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const success = () => {
    const popup = document.getElementById("congrats");
    return Boolean(popup && !popup.hidden && !popup.classList.contains("b_hide"));
  };
  const cells = () => Array.from(document.querySelectorAll("#tiles div.tile"));
  const readBoard = () => cells().map((cell) => {
    const image = cell.querySelector("img.tile");
    if (!image) return -1;
    const match = image.id?.match(/^img([0-7])$/);
    return match ? Number(match[1]) : NaN;
  });

  if (success()) return { solved: true, moves: 0 };
  for (let attempt = 0; cells().length === 0 && attempt < waitAttempts; attempt += 1) {
    await pause(pollMs);
  }
  const boardCells = cells();
  if (boardCells.length !== 9 || boardCells.some((cell, index) =>
    Number(cell.getAttribute("x")) !== Math.floor(index / 3) ||
    Number(cell.getAttribute("y")) !== index % 3
  )) throw new Error("PUZZLE_LAYOUT_UNSUPPORTED");

  // The revamped page uses the empty tile as a start button on the first click.
  const start = document.getElementById("final_parentTile");
  if (start) {
    start.parentElement.click();
    await pause(pollMs);
  }
  const initial = readBoard();
  if (initial.length !== 9 || new Set(initial).size !== 9 ||
      !initial.every((value) => Number.isInteger(value) && value >= -1 && value <= 7)) {
    throw new Error("PUZZLE_LAYOUT_UNSUPPORTED");
  }
  const numbered = initial.filter((value) => value !== -1);
  let inversions = 0;
  numbered.forEach((value, index) => {
    inversions += numbered.slice(index + 1).filter((other) => other < value).length;
  });
  if (inversions % 2) throw new Error("PUZZLE_UNSOLVABLE");

  // IDA* with Manhattan distance bounds memory and yields the shortest legal path.
  const searchBoard = [...initial];
  const path = [];
  const neighbors = Array.from({ length: 9 }, (_, index) =>
    Array.from({ length: 9 }, (_, candidate) => candidate).filter((candidate) =>
      Math.abs(Math.floor(index / 3) - Math.floor(candidate / 3)) +
      Math.abs(index % 3 - candidate % 3) === 1
    )
  );
  const distance = () => searchBoard.reduce((sum, value, index) => sum + (value === -1 ? 0 :
    Math.abs(Math.floor(index / 3) - Math.floor(value / 3)) + Math.abs(index % 3 - value % 3)), 0);
  let visited = 0;
  const search = (empty, depth, bound, previous) => {
    if (++visited > 500_000) throw new Error("PUZZLE_SEARCH_LIMIT");
    const estimate = distance();
    if (depth + estimate > bound) return depth + estimate;
    if (estimate === 0) return true;
    let nextBound = Infinity;
    for (const next of neighbors[empty]) {
      if (next === previous) continue;
      [searchBoard[empty], searchBoard[next]] = [searchBoard[next], searchBoard[empty]];
      path.push(next);
      const result = search(next, depth + 1, bound, empty);
      if (result === true) return true;
      nextBound = Math.min(nextBound, result);
      path.pop();
      [searchBoard[empty], searchBoard[next]] = [searchBoard[next], searchBoard[empty]];
    }
    return nextBound;
  };
  let bound = distance();
  while (bound <= 31) {
    const result = search(initial.indexOf(-1), 0, bound, -1);
    if (result === true) break;
    bound = result;
  }
  if (bound > 31) throw new Error("PUZZLE_UNSOLVABLE");
  // A random shuffle can already be ordered; a legal out-and-back fires the site's check.
  if (path.length === 0) path.push(neighbors[8][0], 8);

  const expected = [...initial];
  let empty = expected.indexOf(-1);
  for (const next of path) {
    if (readBoard().some((value, index) => value !== expected[index])) {
      throw new Error("PUZZLE_STATE_CHANGED");
    }
    cells()[next].click();
    [expected[empty], expected[next]] = [expected[next], expected[empty]];
    empty = next;
    await pause(moveDelayMs);
    if (!success() && readBoard().some((value, index) => value !== expected[index])) {
      throw new Error("PUZZLE_MOVE_FAILED");
    }
  }
  for (let attempt = 0; attempt < waitAttempts; attempt += 1) {
    if (success()) return { solved: true, moves: path.length };
    await pause(pollMs);
  }
  throw new Error("PUZZLE_NOT_CONFIRMED");
}
