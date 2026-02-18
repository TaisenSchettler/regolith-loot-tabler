# loot_tabler (Regolith filter)

Assign loot tables to Bedrock `.mcstructure` files by:
- folder scope (`folders` rules)
- structure filename prefix (`structure_overrides`)
- block entity id (`Chest`, `Barrel`, `BrushableBlock`, `DecoratedPot`, ...)

## Install

```bash
regolith install github.com/TaisenSchettler/regolith-loot-tabler/loot_tabler
```

## Config

```json
{
  "regolith": {
    "filterDefinitions": {
      "loot_tabler": {
        "url": "github.com/TaisenSchettler/regolith-loot-tabler/loot_tabler",
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
          {
            "filter": "loot_tabler",
            "settings": {
                "diagnostic": true,
                "loot_config_path": "data/loot-config.json",
                "only_unassigned": false,
                "report_loot": true,
                "structures_dir": "./BP/structures"
            }
        },
        ]
      }
    }
  }
}
```

An example config can be found at [HERE](https://github.com/TaisenSchettler/regolith-loot-tabler/blob/main/loot_tabler/examples/loot-config.example.json)

