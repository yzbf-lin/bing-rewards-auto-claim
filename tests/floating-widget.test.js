import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const source = await readFile(new URL("../src/content/floating-widget.js", import.meta.url), "utf8");

function surface() {
  class Element {
    constructor() { this.style = {}; this.dataset = {}; this.attributes = new Map(); this.listeners = new Map(); this.parts = new Map(); }
    setAttribute(name, value) { this.attributes.set(name, String(value)); }
    getAttribute(name) { return this.attributes.get(name) ?? null; }
    addEventListener(name, listener) { this.listeners.set(name, listener); }
    removeEventListener(name) { this.listeners.delete(name); }
    dispatch(name, data = {}) { this.listeners.get(name)?.({ target: this, button: 0, pointerId: 1, clientX: 0, clientY: 0, preventDefault() {}, stopPropagation() {}, ...data }); }
    attachShadow() { return this.shadowRoot = new Element(); }
    querySelector(selector) { if (!this.parts.has(selector)) this.parts.set(selector, new Element()); return this.parts.get(selector); }
    append(child) { child.isConnected = true; }
    remove() { this.isConnected = false; }
    setPointerCapture() {}
    releasePointerCapture() {}
    focus() { this.focused = true; }
    getBoundingClientRect() { return { left: parseFloat(this.style.left), top: parseFloat(this.style.top), width: parseFloat(this.style.width), height: parseFloat(this.style.height) }; }
  }
  const window = new Element();
  window.innerWidth = 1024;
  window.innerHeight = 800;
  const document = new Element();
  document.documentElement = new Element();
  document.createElement = () => new Element();
  document.getElementById = () => null;
  const context = vm.createContext({ window, document, setTimeout, clearTimeout });
  vm.runInContext(source, context);
  const saved = [];
  const create = (options = {}) => context.createRewardsFloatingWidget({ hostId: "test-orb", savePosition: (value) => saved.push(value), ...options });
  return { create, window, saved };
}

test("orb starts collapsed, expands on click, and closes with focus restored", () => {
  const { create, window } = surface();
  const widget = create();
  const launcher = widget.root.querySelector(".rw-launcher");
  assert.equal(widget.host.dataset.open, "false");
  launcher.dispatch("click", { detail: 1 });
  assert.equal(widget.host.dataset.open, "true");
  assert.equal(launcher.getAttribute("aria-expanded"), "true");
  window.dispatch("keydown", { key: "Escape" });
  assert.equal(widget.host.dataset.open, "false");
  assert.equal(launcher.focused, true);
});

test("dragging clamps to the viewport, saves position, and never opens the panel", () => {
  const { create, saved } = surface();
  const widget = create();
  const launcher = widget.root.querySelector(".rw-launcher");
  launcher.dispatch("pointerdown", { clientX: 970, clientY: 100 });
  launcher.dispatch("pointermove", { clientX: -2000, clientY: 3000 });
  launcher.dispatch("pointerup");
  launcher.dispatch("click", { detail: 1 });
  assert.equal(widget.host.dataset.open, "false");
  assert.equal(parseFloat(widget.host.style.left), 12);
  assert.equal(parseFloat(widget.host.style.top), 800 - 56 - 12);
  assert.equal(saved.length, 1);
  assert.equal(saved[0].xRatio, 0);
  assert.equal(saved[0].yRatio, 1);
  launcher.dispatch("pointerdown");
  launcher.dispatch("pointerup");
  launcher.dispatch("click", { detail: 1 });
  assert.equal(widget.host.dataset.open, "true");
});

test("expanded panel dragging and viewport resize keep both panel and orb reachable", () => {
  const { create, window } = surface();
  const widget = create();
  widget.open();
  const grip = widget.root.querySelector(".rw-grip");
  grip.dispatch("pointerdown");
  grip.dispatch("pointermove", { clientX: 4000, clientY: 4000 });
  grip.dispatch("pointerup");
  window.innerWidth = 320;
  window.innerHeight = 360;
  window.dispatch("resize");
  const bounds = widget.host.getBoundingClientRect();
  assert.ok(bounds.left >= 12 && bounds.top >= 12);
  assert.ok(bounds.left + bounds.width <= 308);
  assert.ok(bounds.top + bounds.height <= 348);
  widget.close();
  assert.ok(parseFloat(widget.host.style.left) <= 252);
  assert.ok(parseFloat(widget.host.style.top) <= 292);
});

test("restores normalized positions but does not overwrite a user's early drag", async () => {
  const { create } = surface();
  const widget = create({ loadPosition: async () => ({ xRatio: 0, yRatio: 1 }) });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(parseFloat(widget.host.style.left), 12);
  assert.equal(parseFloat(widget.host.style.top), 732);
  let restore;
  const second = create({ loadPosition: () => new Promise((resolve) => { restore = resolve; }) });
  const launcher = second.root.querySelector(".rw-launcher");
  launcher.dispatch("pointerdown");
  launcher.dispatch("pointermove", { clientX: -100, clientY: 100 });
  launcher.dispatch("pointerup");
  const left = second.host.style.left;
  restore({ xRatio: 0, yRatio: 0 });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(second.host.style.left, left);
});

test("ignores right-click drags and updates collapsed running status without opening", () => {
  const { create, saved } = surface();
  const widget = create();
  const launcher = widget.root.querySelector(".rw-launcher");
  launcher.dispatch("pointerdown", { button: 2 });
  launcher.dispatch("pointermove", { clientX: 100 });
  launcher.dispatch("pointerup");
  assert.equal(saved.length, 0);
  widget.setStatus({ running: true });
  assert.equal(widget.host.dataset.running, "true");
  assert.equal(widget.host.dataset.open, "false");
  assert.match(launcher.getAttribute("aria-label"), /领取中/);
});
