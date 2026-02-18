# loot_tabler settings

Assign loot tables to Bedrock `.mcstructure` files based on folder scope,
structure filename, and block entity type.

This filter is commonly used to populate custom villages, dungeons, and
structures with vanilla or custom loot tables.

---

## structures_dir

Path to the `BP/structures` directory that will be scanned for `.mcstructure`
files.

This path is resolved relative to the project root unless an absolute path is
provided.

Default: ./BP/structures

---

## loot_config_path

Path to the loot tabler configuration JSON file.

This configuration defines:

- folder-based rules (`folders`)
- structure filename overrides (`structure_overrides`)
- default loot per block entity (`structure_defaults`)
- global fallback rules

The path is resolved relative to the project root unless absolute.

Example value:
data/loot-config.json

---

## diagnostic

When enabled, prints detailed diagnostics for each processed structure,
including:

- block names found in the structure
- block entity (tile entity) IDs present
- counts per block and block entity

Useful for debugging why a loot rule did or did not apply.

Default: false

---

## only_unassigned

When enabled, loot tables are only assigned if the block entity does NOT
already have a LootTable set.

This is useful when:

- structures already contain hand-authored loot
- you want to avoid overwriting existing assignments

If disabled, overwriting behavior is controlled by
`defaults.override_existing` in the loot config.

Default: false

---

## report_loot

When enabled, prints a summary report after processing each structure,
listing all block entities found and their assigned LootTable values.

This report reflects the final state after changes.

Useful for verifying large batches of structures.

Default: false
