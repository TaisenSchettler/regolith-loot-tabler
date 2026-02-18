#!/usr/bin/env node
/* eslint-disable no-console */

// Regolith Loot Tabler Filter (NodeJS)
// - Scans BP/structures for .mcstructure files (recursively)
// - Applies loot tables based on block entity id (Chest, Barrel, BrushableBlock, DecoratedPot, etc.)
// - Supports folder-scoped rules via config.folders (most-specific match wins)
// - Supports per-structure (filename-prefix) overrides for Chest/Barrel/etc. via:
//     folderRule.structure_defaults: { "Chest": "<loot>", "Barrel": "<loot>", ... }
//     folderRule.structure_overrides: { "armorer": { "Chest": "<loot>", "Barrel": "<loot>" }, ... }
// - Settings come from Regolith as JSON string in argv[2]
// - Option B: can write an example loot config into the project on demand (write_example_config)

const fs = require("fs");
const path = require("path");
const nbt = require("prismarine-nbt");

// -------------------- settings + fs helpers --------------------

function readSettingsArg() {
  const raw = process.argv[2];
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch (e) {
    throw new Error(
      `Failed to parse Regolith settings JSON (first arg). Got: ${String(raw).slice(0, 200)}...`
    );
  }
}

async function fileExists(p) {
  try {
    await fs.promises.access(p, fs.constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function walk(dir) {
  const out = [];
  const entries = await fs.promises.readdir(dir, { withFileTypes: true });
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...(await walk(p)));
    else if (e.isFile()) out.push(p);
  }
  return out;
}

// -------------------- path scoping helpers --------------------

function normRel(p) {
  // normalize to forward slashes, no leading/trailing slashes, no '.' prefix
  const s = String(p).replace(/\\/g, "/");
  return s.replace(/^\/+|\/+$/g, "").replace(/^\.\//, "");
}

function getRelativeToStructures(filePath, structuresDir) {
  const rel = path.relative(structuresDir, filePath);
  return normRel(rel);
}

function pickFolderRule(config, relToStructures) {
  // relToStructures like: "sndbx_vc/village/desert/houses/armorer_1.mcstructure"
  const folders = config.folders || {};
  const relDir = normRel(path.dirname(relToStructures)); // "sndbx_vc/village/desert/houses"

  // find all folder keys that are prefixes of relDir; pick the longest (most specific)
  let bestKey = null;
  let bestLen = -1;

  for (const key of Object.keys(folders)) {
    const k = normRel(key);
    if (!k) continue;

    if (relDir === k || relDir.startsWith(k + "/")) {
      if (k.length > bestLen) {
        bestKey = key;
        bestLen = k.length;
      }
    }
  }

  return bestKey ? folders[bestKey] : null;
}

function getTileMap(scopeObj) {
  if (!scopeObj) return {};
  return scopeObj.tile_entities || scopeObj.containers || {};
}

// -------------------- per-structure (filename) override helpers --------------------

function getStructureBaseName(filePath) {
  // "armorer_1.mcstructure" -> "armorer_1"
  const base = path.basename(filePath);
  return base.toLowerCase().replace(/\.mcstructure$/i, "");
}

function pickStructureOverride(folderRule, structureBaseName) {
  if (!folderRule || !folderRule.structure_overrides) return null;
  const overrides = folderRule.structure_overrides;

  // match by prefix (key "armorer" matches "armorer_1", "armorer_2", etc.)
  let bestKey = null;
  let bestLen = -1;

  for (const k of Object.keys(overrides)) {
    const key = String(k).toLowerCase();
    if (structureBaseName === key || structureBaseName.startsWith(key + "_")) {
      if (key.length > bestLen) {
        bestKey = k;
        bestLen = key.length;
      }
    }
  }

  return bestKey ? overrides[bestKey] : null;
}

function buildPerFileTileConfig(config, folderRule, filePath) {
  // Build the effective tile config for THIS structure file.
  // Priority order (later overrides earlier):
  // 1) config.global.tile_entities
  // 2) folderRule.tile_entities
  // 3) folderRule.structure_defaults (maps tileId -> loot_table path)
  // 4) folderRule.structure_overrides (picked by filename prefix; maps tileId -> loot_table path)

  const out = {};

  // 1) global tile_entities
  const globalScope = config.global || null;
  const g = getTileMap(globalScope);
  for (const k of Object.keys(g)) out[k] = g[k];

  // 2) folder tile_entities
  const folderTile = getTileMap(folderRule);
  for (const k of Object.keys(folderTile)) out[k] = folderTile[k];

  // 3) structure_defaults
  const defaults = folderRule && folderRule.structure_defaults ? folderRule.structure_defaults : null;
  if (defaults && typeof defaults === "object") {
    for (const tileId of Object.keys(defaults)) {
      const lt = defaults[tileId];
      if (!lt) continue;
      out[tileId] = { loot_table: lt };
    }
  }

  // 4) structure_overrides (by filename prefix)
  const baseName = getStructureBaseName(filePath);
  const override = pickStructureOverride(folderRule, baseName);
  if (override && typeof override === "object") {
    for (const tileId of Object.keys(override)) {
      const lt = override[tileId];
      if (!lt) continue;
      out[tileId] = { loot_table: lt };
    }
  }

  return out;
}

// -------------------- nbt helpers --------------------

function getListValues(listTag) {
  if (!listTag || listTag.type !== "list") return [];
  return listTag.value || [];
}

function asInt(tag) {
  if (!tag) return undefined;
  return tag.value;
}

// -------------------- diagnostics --------------------

function buildBlockStats(blockPalette, primaryLayer) {
  const stats = new Map();
  for (let i = 0; i < primaryLayer.length; i++) {
    const idxTag = primaryLayer[i];
    if (!idxTag) continue;

    const paletteIndex = asInt(idxTag);
    if (paletteIndex == null || paletteIndex < 0 || paletteIndex >= blockPalette.length) continue;

    const blockStateTag = blockPalette[paletteIndex];
    if (!blockStateTag || blockStateTag.type !== "compound") continue;

    const nameTag = blockStateTag.value.name;
    if (!nameTag || nameTag.type !== "string") continue;

    const blockName = nameTag.value;
    if (!stats.has(blockName)) {
      stats.set(blockName, { count: 0, paletteIndices: new Set() });
    }
    const s = stats.get(blockName);
    s.count++;
    s.paletteIndices.add(paletteIndex);
  }
  return stats;
}

function buildTileEntityStats(blockPosDataTag) {
  const stats = new Map();
  if (!blockPosDataTag || blockPosDataTag.type !== "compound") return stats;

  const posMap = blockPosDataTag.value;
  for (const indexKey of Object.keys(posMap)) {
    const posEntryTag = posMap[indexKey];
    if (!posEntryTag || posEntryTag.type !== "compound") continue;

    const bedTag = posEntryTag.value.block_entity_data;
    if (!bedTag || bedTag.type !== "compound") continue;

    const idTag = bedTag.value.id;
    if (!idTag || idTag.type !== "string") continue;

    const id = idTag.value;
    stats.set(id, (stats.get(id) || 0) + 1);
  }
  return stats;
}

function printDiagnostics(fileName, blockPalette, primaryLayer, blockPosDataTag) {
  console.log(`\n=== Diagnostic for ${fileName} ===`);

  const blockStats = buildBlockStats(blockPalette, primaryLayer);
  const tileStats = buildTileEntityStats(blockPosDataTag);

  if (primaryLayer.length === 0 || blockStats.size === 0) {
    console.log("No blocks found in primary layer.");
  } else {
    console.log("\nBlocks (by name):");
    for (const [name, info] of blockStats.entries()) {
      const indicesStr = Array.from(info.paletteIndices).sort((a, b) => a - b).join(", ");
      console.log(`  ${name} -> count=${info.count}, paletteIndices=[${indicesStr}]`);
    }
  }

  if (tileStats.size === 0) {
    console.log("\nTile entities: none found in block_position_data.");
  } else {
    console.log("\nTile entities (block_entity_data.id):");
    for (const [id, count] of tileStats.entries()) {
      console.log(`  ${id} -> count=${count}`);
    }
  }

  console.log("=== End diagnostic ===\n");
}

// -------------------- loot reporting --------------------

function buildLootReport(blockPosDataTag) {
  const rows = [];
  if (!blockPosDataTag || blockPosDataTag.type !== "compound") return rows;

  const posMap = blockPosDataTag.value;
  for (const indexKey of Object.keys(posMap)) {
    const posEntryTag = posMap[indexKey];
    if (!posEntryTag || posEntryTag.type !== "compound") continue;

    const bedTag = posEntryTag.value.block_entity_data;
    if (!bedTag || bedTag.type !== "compound") continue;

    const bedVal = bedTag.value;
    const idTag = bedVal.id;
    if (!idTag || idTag.type !== "string") continue;

    const tileId = idTag.value;
    const lootTable =
      bedVal.LootTable && bedVal.LootTable.type === "string" ? bedVal.LootTable.value : null;

    const lootSeed = bedVal.LootTableSeed
      ? (bedVal.LootTableSeed.value?.toString?.() ?? String(bedVal.LootTableSeed.value))
      : null;

    rows.push({ indexKey, tileId, lootTable, lootSeed });
  }

  return rows;
}

function printLootReport(fileName, rows) {
  console.log(`\n=== LootTable report for ${fileName} ===`);

  if (rows.length === 0) {
    console.log("No containers/tile entities found.");
    console.log("=== End report ===\n");
    return;
  }

  const byType = new Map();
  for (const r of rows) {
    if (!byType.has(r.tileId)) byType.set(r.tileId, []);
    byType.get(r.tileId).push(r);
  }

  for (const [tileId, list] of byType.entries()) {
    const withLoot = list.filter((x) => x.lootTable && String(x.lootTable).trim() !== "");
    const withoutLoot = list.length - withLoot.length;

    console.log(
      `\n${tileId}: total=${list.length}, withLoot=${withLoot.length}, withoutLoot=${withoutLoot}`
    );
    for (const r of list) {
      console.log(
        `  #${r.indexKey}: LootTable=${r.lootTable ?? "(none)"} Seed=${r.lootSeed ?? "(none)"}`
      );
    }
  }

  console.log("\n=== End report ===\n");
}

// -------------------- example-config writer (Option B) --------------------

async function maybeWriteExampleConfig(settings) {
  const enabled = Boolean(settings.write_example_config);
  if (!enabled) return;

  const rootDir = process.env.ROOT_DIR || process.cwd();
  const relPath = settings.example_config_path || "data/loot-config.example.json";
  const outPath = path.isAbsolute(relPath) ? relPath : path.join(rootDir, relPath);

  // do not overwrite
  try {
    await fs.promises.access(outPath, fs.constants.F_OK);
    console.log(`loot_tabler: example config already exists at ${outPath} (skipping).`);
    return;
  } catch {
    // ok, doesn't exist
  }

  // keep the example small and readable
  const example = {
    defaults: { seed: 0, override_existing: false },
    global: {
      tile_entities: {
        DecoratedPot: {
          loot_table: "loot_tables/sndbx_vc/chest/decorated_pots_village.json"
        }
      }
    },
    folders: {
      "sndbx_vc/village/plains": {
        structure_defaults: {
          Chest: "loot_tables/chests/village/village_plains_house.json",
          Barrel: "loot_tables/chests/village/village_plains_house.json"
        },
        structure_overrides: {
          armorer: {
            Chest: "loot_tables/chests/village/village_armorer.json",
            Barrel: "loot_tables/chests/village/village_armorer.json"
          }
        }
      },
      "sndbx_vc/castle": {
        structure_defaults: {
          Chest: "loot_tables/sndbx_vc/chest/castle.json",
          Barrel: "loot_tables/sndbx_vc/chest/castle.json",
          DecoratedPot: "loot_tables/sndbx_vc/chest/decorated_pots_castle.json",
          BrushableBlock: "loot_tables/sndbx_vc/chest/brushable.json"
        }
      }
    }
  };

  await fs.promises.mkdir(path.dirname(outPath), { recursive: true });
  await fs.promises.writeFile(outPath, JSON.stringify(example, null, 2), "utf8");
  console.log(`loot_tabler: wrote example config to ${outPath}`);
  console.log(
    `loot_tabler: tip: point loot_config_path at this file, or copy it to data/loot-config.json and customize.`
  );
}

// -------------------- core processing --------------------

async function processFile(filePath, structuresDir, config, opts) {
  const { diagnostic, onlyUnassigned, reportLoot } = opts;

  const buf = await fs.promises.readFile(filePath);

  // Bedrock .mcstructure: little-endian, uncompressed NBT.
  const root = nbt.parseUncompressed(buf, "little");
  const rootVal = root.value;

  const structureTag = rootVal.structure;
  if (!structureTag || structureTag.type !== "compound") {
    console.warn(`Skipping ${filePath}: no "structure" tag`);
    return { modifiedCount: 0, skipped: true };
  }

  const structureVal = structureTag.value;
  const blockIndicesTag = structureVal.block_indices;
  const paletteTag = structureVal.palette;

  if (!paletteTag || paletteTag.type !== "compound") {
    console.warn(`Skipping ${filePath}: no "palette" compound`);
    return { modifiedCount: 0, skipped: true };
  }

  const defaultPaletteTag = paletteTag.value.default;
  if (!defaultPaletteTag || defaultPaletteTag.type !== "compound") {
    console.warn(`Skipping ${filePath}: no "palette.default"`);
    return { modifiedCount: 0, skipped: true };
  }

  const defaultPaletteVal = defaultPaletteTag.value;

  const blockPaletteTag = defaultPaletteVal.block_palette;
  const blockPalette = blockPaletteTag ? getListValues(blockPaletteTag) : [];

  const blockIndicesLayers = blockIndicesTag ? getListValues(blockIndicesTag) : [];
  const primaryLayer = blockIndicesLayers.length > 0 ? getListValues(blockIndicesLayers[0]) : [];

  // block_position_data holds all block entities (containers, brushables, pots, etc.)
  let blockPosDataTag = defaultPaletteVal.block_position_data;
  if (!blockPosDataTag) {
    blockPosDataTag = { type: "compound", value: {} };
    defaultPaletteVal.block_position_data = blockPosDataTag;
  }
  const blockPosDataVal = blockPosDataTag.value;

  const fileName = path.relative(process.cwd(), filePath);

  // --- Diagnostics ---
  if (diagnostic) {
    printDiagnostics(fileName, blockPalette, primaryLayer, blockPosDataTag);
  }

  // ---------- pick folder rule ----------
  const relToStructures = getRelativeToStructures(filePath, structuresDir);
  const folderRule = pickFolderRule(config, relToStructures);

  // Build per-file tile config using:
  // global + folder tile_entities + structure_defaults + structure_overrides
  const tileConfig = buildPerFileTileConfig(config, folderRule, filePath);

  // Backwards compat: if no global/folders/defaults/overrides used, allow legacy top-level tile_entities/containers
  const legacyTopLevel = getTileMap(config);
  if (Object.keys(tileConfig).length === 0 && Object.keys(legacyTopLevel).length > 0) {
    for (const k of Object.keys(legacyTopLevel)) tileConfig[k] = legacyTopLevel[k];
  }

  const defaults = config.defaults || {};
  const defaultSeed = defaults.seed ?? null;
  const overrideExisting = Boolean(defaults.override_existing);

  let modifiedCount = 0;

  // Iterate over every block entity in block_position_data
  for (const indexKey of Object.keys(blockPosDataVal)) {
    const posEntryTag = blockPosDataVal[indexKey];
    if (!posEntryTag || posEntryTag.type !== "compound") continue;

    const blockEntityDataTag = posEntryTag.value.block_entity_data;
    if (!blockEntityDataTag || blockEntityDataTag.type !== "compound") continue;

    const bedVal = blockEntityDataTag.value;

    const idTag = bedVal.id;
    if (!idTag || idTag.type !== "string") continue;
    const tileId = idTag.value; // e.g. "Chest", "Barrel", "BrushableBlock", "DecoratedPot"

    const perTileConfig = tileConfig[tileId];
    if (!perTileConfig) continue;

    const optLootTable = perTileConfig.loot_table;
    if (!optLootTable) continue;

    const perTileSeed = perTileConfig.seed ?? null;
    const seedToUse = perTileSeed !== null ? perTileSeed : defaultSeed;

    // Determine whether this block entity already has a LootTable
    const existingLTTag = bedVal.LootTable;
    const existingLT =
      existingLTTag && existingLTTag.type === "string" ? existingLTTag.value : null;

    const hasLootAlready = existingLT != null && String(existingLT).trim() !== "";

    // Behavior:
    //  - If onlyUnassigned: never overwrite (only set when missing/empty)
    //  - Else: obey defaults.override_existing
    if (onlyUnassigned) {
      if (hasLootAlready) continue;
    } else {
      if (hasLootAlready && !overrideExisting) continue;
    }

    // Set LootTable (string)
    bedVal.LootTable = { type: "string", value: optLootTable };

    // Set / clear LootTableSeed (long)
    if (seedToUse === null || seedToUse === undefined || seedToUse === "") {
      if (bedVal.LootTableSeed) delete bedVal.LootTableSeed;
    } else {
      const seedBigInt = BigInt(seedToUse);
      bedVal.LootTableSeed = { type: "long", value: seedBigInt };
    }

    modifiedCount++;
  }

  // --- Loot report (after changes) ---
  if (reportLoot) {
    const rows = buildLootReport(blockPosDataTag);
    printLootReport(fileName, rows);
  }

  // Only write back if changed
  if (modifiedCount > 0) {
    const outBuf = nbt.writeUncompressed(root, "little");
    await fs.promises.writeFile(filePath, outBuf);
  }

  return { modifiedCount, skipped: false };
}

// -------------------- config loading --------------------

async function loadLootConfig(settings) {
  // Option A: inline config object
  if (settings.loot_config && typeof settings.loot_config === "object") {
    return settings.loot_config;
  }

  // Option B: path to JSON file (relative to ROOT_DIR or FILTER_DIR, or absolute)
  const cfgPath = settings.loot_config_path || settings.config_path;
  if (!cfgPath) {
    throw new Error(
      "Missing loot config. Provide settings.loot_config (object) or settings.loot_config_path (string)."
    );
  }

  const rootDir = process.env.ROOT_DIR;
  const filterDir = process.env.FILTER_DIR;

  const candidates = [];
  if (path.isAbsolute(cfgPath)) candidates.push(cfgPath);
  if (rootDir) candidates.push(path.join(rootDir, cfgPath));
  if (filterDir) candidates.push(path.join(filterDir, cfgPath));
  candidates.push(path.resolve(cfgPath)); // fallback

  let resolved = null;
  for (const c of candidates) {
    if (await fileExists(c)) {
      resolved = c;
      break;
    }
  }

  if (!resolved) {
    throw new Error(`Could not find loot config file. Tried:\n- ${candidates.join("\n- ")}`);
  }

  const raw = await fs.promises.readFile(resolved, "utf8");
  return JSON.parse(raw);
}

// -------------------- entrypoint --------------------

async function main() {
  const settings = readSettingsArg();

  // Option B: write an example config into the project (one-time, no overwrite)
  await maybeWriteExampleConfig(settings);

  const opts = {
    diagnostic: Boolean(settings.diagnostic),
    onlyUnassigned: Boolean(
      settings.only_unassigned ??
        settings.only_unassigned_loot ??
        settings.only_empty ??
        settings.onlyUnassigned
    ),
    reportLoot: Boolean(settings.report_loot ?? settings.report ?? settings.reportLoot)
  };

  const structuresDir = settings.structures_dir || "./BP/structures";

  if (!(await fileExists(structuresDir))) {
    console.log(`loot_tabler: No structures directory found at ${structuresDir} (skipping).`);
    return;
  }

  const config = await loadLootConfig(settings);

  const files = (await walk(structuresDir)).filter((p) => p.toLowerCase().endsWith(".mcstructure"));

  if (files.length === 0) {
    console.log(`loot_tabler: No .mcstructure files found under ${structuresDir}.`);
    return;
  }

  console.log(`loot_tabler: Found ${files.length} .mcstructure file(s) under ${structuresDir}.`);

  let totalModified = 0;

  for (const f of files) {
    try {
      const { modifiedCount, skipped } = await processFile(f, structuresDir, config, opts);
      if (skipped) continue;

      if (modifiedCount === 0) {
        console.log(`${path.relative(process.cwd(), f)}: no matching block entities found or modified`);
      } else {
        console.log(
          `${path.relative(process.cwd(), f)}: applied loot tables to ${modifiedCount} block entity(ies)`
        );
        totalModified += modifiedCount;
      }
    } catch (err) {
      console.error(`Error processing ${f}: ${err && err.message ? err.message : String(err)}`);
    }
  }

  console.log(`loot_tabler: Done. Total block entities modified: ${totalModified}`);
}

main().catch((err) => {
  console.error("loot_tabler: Fatal error:", err && err.message ? err.message : String(err));
  process.exit(1);
});
