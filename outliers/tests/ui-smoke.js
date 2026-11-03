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
function assertRawDisplay() {
  assert(!$("detection-enabled").checked, "Detection should be off");
  assert($("inspector").hidden && $("detection-metrics").hidden, "Raw display reveals decisions");
  assert($("limits-legend").hidden && $("flags-legend").hidden && $("pin-legend").hidden, "Raw display reveals overlay legends");
  assert(!$("detect-chart").querySelector('[stroke="#087f79"], [stroke="#bc482b"], [stroke="#b07b22"], rect'), "Raw chart contains detection overlays");
  assert($("transfer").disabled && $("pin").disabled, "Detection actions should be disabled");
}
assertRawDisplay();
click("export");
let csvRows = (await downloaded.text()).split("\n").slice(1).map(row => row.split(","));
assert(csvRows.every(row => row[3] === "0" && row[1] === row[5] && row[8] === "" && row[9] === ""), "Off-state export removed observations or exposed limits");
assert($("python-code").textContent.includes("Detection is off"), "Off-state Python should not run detection");
check("detection-enabled", true);
assert(!$("inspector").hidden && !$("detection-metrics").hidden, "Enabling detection did not reveal decisions");
click("pin"); const originalMetrics = $("detection-metrics").textContent;
check("show-envelope", false);
assert(!$("detect-chart").querySelector('[stroke="#087f79"], [stroke="#b07b22"], rect'), "Envelope switch left limits or shading visible");
assert($("detect-chart").querySelector('[stroke="#bc482b"]'), "Hiding envelope also hid flags");
assert($("detection-metrics").textContent === originalMetrics, "Display-only envelope switch changed decisions");
check("detection-enabled", false); assertRawDisplay();
check("detection-enabled", true);
assert($("detection-metrics").textContent === originalMetrics, "Detection toggle did not restore identical results");
assert(!$("show-envelope").checked, "Detection toggle reset envelope preference");
check("show-envelope", true); assert(!$("pin-legend").hidden, "Pinned limits not restored");
click("clear-pin"); change("method", "fixed"); check("use-lower", false); change("upper-limit", 20);
assert($("reference-controls").hidden && $("multiplier-control").hidden, "Fixed rule still exposes statistical controls");
assert(!$("fixed-controls").hidden, "Fixed threshold controls missing");
assert($("calculation").textContent.includes("FLAGGED"), "Upper-only threshold missed the spike");
click("export");
csvRows = (await downloaded.text()).split("\n").slice(1).map(row => row.split(","));
assert(csvRows.every(row => row[3] === String(+(Number(row[1]) > 20)) && row[8] === "" && row[9] === "20"), "Fixed-threshold CSV differs from the configured upper-only rule");
assert($("python-code").textContent.includes("flagged = (s > 20)"), "Python does not match upper-only rule");
await Deno.mkdir("/tmp/outliers-lab-qa", { recursive: true });
await Deno.writeTextFile("/tmp/outliers-lab-qa/fixed.py", $("python-code").textContent);
change("upper-slider", 19); assert($("upper-limit").value === "19", "Threshold slider and numeric field are not synchronized");
change("amplitude", 12); assert($("upper-limit").value === "19", "Fixed threshold moved with event height");
change("upper-limit", ""); assert(!$("fixed-error").hidden && $("transfer").disabled, "Blank enabled threshold accepted");
check("use-lower", true); change("lower-limit", 0); check("use-upper", false);
assert($("fixed-error").hidden, "Disabled blank threshold should not invalidate lower-only rule");
check("use-upper", true); assert(!$("fixed-error").hidden, "Invalid numeric threshold confused with disabled threshold in cache");
change("upper-limit", 20); change("lower-limit", 21);
assert(!$("fixed-error").hidden && $("pin").disabled, "Reversed thresholds accepted");
change("lower-limit", 0); assert($("fixed-error").hidden, "Valid limits did not clear error");
click("transfer"); assert($("gap-data").value === "transfer", "Fixed-threshold cleaning did not transfer to gaps");
click("reset"); check("detection-enabled", true);
for (const key of ["spike", "cluster", "stuck", "step", ...Object.keys(OutlierData.challenges)]) {
  change("dataset", key);
  for (const method of ["z", "iqr", "mad"]) {
    change("method", method); change("size", 5); change("position", 0); check("full", true);
    change("size", 201); change("position", +$("position").max); check("full", false);
  }
  change("scope", "global"); assert($("size").disabled, "Global reference should disable width");
  change("scope", "rolling"); change("alignment", "trailing"); change("alignment", "center");
}
click("reset"); check("detection-enabled", true); click("pin"); change("threshold", 5);
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
click("reset"); check("detection-enabled", true); click("export");
await Deno.writeTextFile("/tmp/outliers-lab-qa/outliers-detection.csv", await downloaded.text());
await Deno.writeTextFile("/tmp/outliers-lab-qa/detection.py", $("python-code").textContent);
for (const button of document.querySelectorAll("[data-preset]")) { button.click(); flush(); }
// The second notebook embeds the same lab directly in the gaps stage.
location.hash = "#gaps"; (0, eval)(await Deno.readTextFile(new URL("app.js", base))); flush();
assert(!$("fill-stage").hidden, "Direct #gaps entry did not open gap filling");
console.log(`PASS: ${renders} DOM renders; all datasets, methods, boundary controls, presets, transfer, reveal, pinning and CSV exports.`);
