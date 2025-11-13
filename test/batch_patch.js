// Usage: node batch_patch.js ./input ./output
// - Keeps: macro renames, patches merge, random plan id, "10X " name prefix, "10x_" output filenames
// - New: adds z10x_* patches when their matching DLC patch exists in the plan

import fs from "fs";
import path from "path";
import { XMLParser, XMLBuilder } from "fast-xml-parser";

const [,, inDir, outDir] = process.argv;
if (!inDir || !outDir) {
  console.error("Usage: node batch_patch.js <inputDir> <outputDir>");
  process.exit(1);
}
fs.mkdirSync(outDir, { recursive: true });

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  allowBooleanAttributes: true,
  processEntities: true,
  preserveOrder: false
});
const builder = new XMLBuilder({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  format: true,
  indentBy: "  "
});

// Always add this base patch
const PATCH_10X_MODULES = { "@_extension": "10x_modules", "@_version": "112", "@_name": "10x_modules" };

// DLC → z10x mapping (supports your spellings + common Egosoft variants)
const DLC_Z_MAP = [
  {
    dlcExts: ["dlc_borron", "ego_dlc_boron"],
    zPatch: { "@_extension": "z10x_modules_boron", "@_version": "101", "@_name": "z10x_modules_boron" }
  },
  {
    dlcExts: ["dlc_split", "ego_dlc_split"],
    zPatch: { "@_extension": "z10x_modules_split", "@_version": "104", "@_name": "z10x_modules_split" }
  },
  {
    dlcExts: ["dlc_terrant", "ego_dlc_terran"],
    zPatch: { "@_extension": "z10x_modules_terran", "@_version": "106", "@_name": "z10x_modules_terran" }
  },
  {
    dlcExts: ["dlc_pirate", "ego_dlc_pirate"],
    zPatch: { "@_extension": "z10x_modules_pirate", "@_version": "102", "@_name": "z10x_modules_pirate" }
  },
  {
    dlcExts: ["dlc_timelines", "ego_dlc_timelines"],
    zPatch: { "@_extension": "z10x_modules_timelines", "@_version": "001", "@_name": "z10x_modules_timelines" }
  }
];

// Macro rename rules
const FILE_PREFIX   = "10x_";
const MACRO_PREFIX  = "10x_modules_";
const PROD_RE       = /^prod_.+_macro$/;        // prod_*_macro -> drop suffix, add prefix

// Modules to prefix (keep suffix)
const MODULE_PREFIXES = ["storage_", "hab_"];   // add more if you like

const asArray = v => Array.isArray(v) ? v : (v == null ? [] : [v]);

function randomPlayerId() {
  const n = Math.floor(1e11 + Math.random() * 9e11); // ~12 digits
  return `player_${n}`;
}
function prefixName10X(name) {
  if (!name) return "10X";
  return name.startsWith("10X ") ? name : `10X ${name}`;
}

// --- patches helpers ---
function ensurePatchesObj(plan) {
  // normalize <patchs> -> <patches>
  if (plan.patchs && !plan.patches) {
    plan.patches = plan.patchs;
    delete plan.patchs;
  }
  if (!plan.patches) plan.patches = {};
  let patchArr = [];
  if (Array.isArray(plan.patches.patch)) patchArr = plan.patches.patch;
  else if (plan.patches.patch) patchArr = [plan.patches.patch];
  plan.patches.patch = patchArr;
  return patchArr;
}
function hasPatchExtension(patchArr, ext) {
  return patchArr.some(p => p?.["@_extension"] === ext);
}
function addPatchIfMissing(patchArr, patchDef) {
  if (!hasPatchExtension(patchArr, patchDef["@_extension"])) {
    patchArr.push({ ...patchDef });
  }
}
function addFactionPatchesFromDLC(patchArr) {
  for (const { dlcExts, zPatch } of DLC_Z_MAP) {
    const found = dlcExts.some(ext => hasPatchExtension(patchArr, ext));
    if (found) addPatchIfMissing(patchArr, zPatch);
  }
}

// --- plan helpers ---
function findPlans(root) {
  if (root.plans?.plan) {
    const list = asArray(root.plans.plan);
    return { plans: list, commit: () => { root.plans.plan = list.length === 1 ? list[0] : list; } };
  }
  if (root.plan) {
    const list = asArray(root.plan);
    return { plans: list, commit: () => { root.plan = list.length === 1 ? list[0] : list; } };
  }
  root.plan = {};
  return { plans: [root.plan], commit: () => {} };
}

// --- macro rename logic ---
function shouldPrefixOnly(macro) {
  if (macro.startsWith(MACRO_PREFIX)) return false; // already prefixed
  return MODULE_PREFIXES.some(pref => macro.startsWith(pref));
}
function renameEntryMacros(plan) {
  if (!plan.entry) return;
  const entries = asArray(plan.entry);
  for (const e of entries) {
    const m = e?.["@_macro"];
    if (typeof m !== "string") continue;

    // prod_*_macro -> 10x_modules_prod_*  (drop _macro)
    if (PROD_RE.test(m)) {
      const base = m.slice(0, -"_macro".length);
      e["@_macro"] = MACRO_PREFIX + base;
      continue;
    }
    // module prefixes (storage_, hab_, …) -> just prefix, keep suffix
    if (shouldPrefixOnly(m)) {
      e["@_macro"] = MACRO_PREFIX + m;
      continue;
    }
  }
}

// --- main ---
for (const file of fs.readdirSync(inDir)) {
  if (!file.toLowerCase().endsWith(".xml")) continue;

  const inputPath = path.join(inDir, file);
  const newName = FILE_PREFIX + file;
  const outputPath = path.join(outDir, newName);
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });

  const xml = fs.readFileSync(inputPath, "utf8");
  const obj = parser.parse(xml);

  const { plans, commit } = findPlans(obj);
  for (const plan of plans) {
    const patchArr = ensurePatchesObj(plan);

    // rename macros first
    renameEntryMacros(plan);

    // base patch always present
    addPatchIfMissing(patchArr, PATCH_10X_MODULES);

    // add z10x_* patches according to DLCs present
    addFactionPatchesFromDLC(patchArr);

    // update id & name
    plan["@_id"] = randomPlayerId();
    plan["@_name"] = prefixName10X(plan["@_name"]);
  }
  commit();

  const outXml = builder.build(obj);
  fs.writeFileSync(outputPath, outXml, "utf8");
  console.log(`✔ ${file} → ${newName}`);
}

console.log("✅ Done!");
