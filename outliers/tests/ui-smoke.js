// DOM interaction check, not a visual browser test.
// deno run --allow-read --allow-write=/tmp/outliers-lab-qa outliers/tests/ui-smoke.js
import { parseHTML } from "npm:linkedom@0.18.12";
const base = new URL("../lab/", import.meta.url);
const { document, window: dom } = parseHTML(await Deno.readTextFile(new URL("index.html", base)));
// LinkeDOM deliberately has no layout engine or native form state.
Object.defineProperty(dom.HTMLSelectElement.prototype, "value", {
  get() { return this.querySelector("option[selected]")?.getAttribute("value") ?? this.querySelector("option")?.getAttribute("value") ?? ""; },
  set(value) { for (const option of this.querySelectorAll("option")) { if (option.getAttribute("value") === String(value)) option.setAttribute("selected", ""); else option.removeAttribute("selected"); } },
});
Object.defineProperty(dom.Element.prototype, "clientWidth", { get() { return 800; } });
Object.defineProperty(dom.Element.prototype, "viewBox", { get() { return { baseVal: { width: +(this.getAttribute("viewBox") || "0 0 800 350").split(" ")[2] } }; } });
const frames = [];
Object.assign(globalThis, {
  document, parent: globalThis, location: { hash: "", origin: "http://localhost" },
  requestAnimationFrame: fn => frames.push(fn), addEventListener: () => {},
  ResizeObserver: class { observe() {} },
});
let downloaded;
URL.createObjectURL = blob => { downloaded = blob; return "blob:qa"; };
URL.revokeObjectURL = () => {};
for (const file of ["engine.js", "data.js", "app.js"]) (0, eval)(await Deno.readTextFile(new URL(file, base)));
const $ = id => document.getElementById(id);
function assert(value, message) { if (!value) throw new Error(message); }
let renders = 0;
function flush() {
  while (frames.length) { frames.shift()(); renders++; }
  for (const element of document.querySelectorAll("svg path, svg circle, svg rect, svg line")) {
    for (const name of ["d", "cx", "cy", "x", "y", "x1", "x2", "y1", "y2", "width", "height"]) {
      assert(!/NaN|Infinity|undefined/.test(element.getAttribute(name) || ""), `Invalid SVG coordinate in ${name}`);
    }
  }
}
function change(id, value) { $(id).value = String(value); $(id).dispatchEvent(new dom.Event("input")); $(id).dispatchEvent(new dom.Event("change")); flush(); }
function check(id, value) { $(id).checked = value; $(id).dispatchEvent(new dom.Event("input")); flush(); }
function click(id) { $(id).click(); flush(); }
flush();
assert($("detect-chart").querySelectorAll("path").length > 0, "Default graph missing");
assert(!$("detect-stage").hidden && $("fill-stage").hidden, "Wrong default stage");
for (const key of ["spike", "cluster", "stuck", "step", ...Object.keys(OutlierData.challenges)]) {
  change("dataset", key);
  for (const method of ["z", "iqr", "mad"]) {
    change("method", method); change("size", 5); change("position", 0); check("full", true);
    change("size", 201); change("position", +$("position").max); check("full", false);
  }
  change("scope", "global"); assert($("size").disabled, "Global reference should disable width");
  change("scope", "rolling"); change("alignment", "trailing"); change("alignment", "center");
}
click("reset"); click("pin"); change("threshold", 5);
assert(!$("pin-legend").hidden, "Pinned comparison missing"); click("clear-pin");
change("dataset", "challenge1D"); check("plateau", true);
assert(+document.querySelectorAll("#detection-metrics strong")[2].textContent >= 709, "Known 709-sample run was not flagged");
click("transfer"); assert(!$("fill-stage").hidden, "Transfer did not switch stages");
assert($("gap-data").value === "transfer", "Transfer did not select snapshot");
assert($("gap-truth-control").hidden, "Challenge data must not invent ground truth");
click("detect-mode"); change("dataset", "spike"); click("transfer"); check("gap-truth", true);
assert($("gap-metrics").textContent.includes("RMSE"), "Gap evaluation missing");
for (const key of ["mis_1", "mis_2", "mis_3", "custom"]) {
  change("gap-data", key);
  for (const method of ["none", "forward", "backward", "linear", "cubic"]) {
    change("fill-method", method); check("gap-truth", true); change("max-gap", 1); change("max-gap", 201);
  }
  change("gap-view", "all"); change("gap-view", "focus");
  assert($("comparison").children.length === 5, "Comparison rows missing");
}
change("gap-position", 0); change("gap-length", 84); change("gap-position", 660);
change("fill-method", "linear"); click("export");
await Deno.mkdir("/tmp/outliers-lab-qa", { recursive: true });
await Deno.writeTextFile("/tmp/outliers-lab-qa/outliers-gaps.csv", await downloaded.text());
await Deno.writeTextFile("/tmp/outliers-lab-qa/gaps.py", $("python-code").textContent);
assert((await downloaded.text()).startsWith("time,input,raw,flagged"), "CSV columns missing");
click("reset"); click("export");
await Deno.writeTextFile("/tmp/outliers-lab-qa/outliers-detection.csv", await downloaded.text());
await Deno.writeTextFile("/tmp/outliers-lab-qa/detection.py", $("python-code").textContent);
for (const button of document.querySelectorAll("[data-preset]")) { button.click(); flush(); }
// The second notebook embeds the same lab directly in the gaps stage.
location.hash = "#gaps"; (0, eval)(await Deno.readTextFile(new URL("app.js", base))); flush();
assert(!$("fill-stage").hidden, "Direct #gaps entry did not open gap filling");
console.log(`PASS: ${renders} DOM renders; all datasets, methods, boundary controls, presets, transfer, reveal, pinning and CSV exports.`);
