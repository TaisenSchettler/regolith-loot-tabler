# loot_tabler (Regolith filter)

Assign loot tables to Bedrock `.mcstructure` files by:
- folder scope (`folders` rules)
- structure filename prefix (`structure_overrides`)
- block entity id (`Chest`, `Barrel`, `BrushableBlock`, `DecoratedPot`, ...)

## Install

```bash
regolith install github.com/YOURNAME/regolith-loot-tabler/loot_tabler
```

```json
{
  "regolith": {
    "filterDefinitions": {
      "loot_tabler": {
        "url": "github.com/YOURNAME/regolith-loot-tabler/loot_tabler",
        "settings": {
          "loot_config_path": "data/loot-config.json",
          "structures_dir": "./BP/structures",
          "only_unassigned": true,
          "report_loot": false
        }
      }
    },
    "profiles": {
      "default": {
        "filters": [
          { "filter": "loot_tabler" }
        ]
      }
    }
  }
}
```

