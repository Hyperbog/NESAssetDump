# NESAssetDump

A **local desktop NES asset ripper** focused on lossless 8×8 CHR-ROM extraction, palette editing, manual sprite animation assembly, and Godot 4 exports. Built with Electron; ROMs are opened and processed locally, with no emulator, cloud account, or ROM uploads.

## Download the desktop app

Open **[Actions → Build desktop apps](https://github.com/Hyperbog/NESAssetDump/actions/workflows/build-desktop.yml)**, choose a successful run on `main`, and download the artifact for your platform:

| OS | Build artifact | Output |
| --- | --- | --- |
| Windows | `NESAssetDump-Windows` | Installer `.exe` |
| macOS | `NESAssetDump-macOS` | Disk image `.dmg` |
| Linux | `NESAssetDump-Linux` | AppImage |

The workflow packages installers after pushes to `main` and can be started manually. **Until a build succeeds, the above links are build targets, not verified downloads.** Installers are currently unsigned; Windows SmartScreen and macOS Gatekeeper may warn. The Linux AppImage may require the distribution's AppImage/FUSE support. The program runs without internet access once installed.

## Run from source (developers)

Requires Node.js and npm.

```sh
npm install
npm start
```

To build an installer locally, run `npm run dist` on the target operating system. The desktop app saves exports using the platform's normal **Save As** dialog.

## ROM and tile support

- Open individual `.nes` ROMs or ZIP archives of NES games, then select a ROM.
- Read iNES and NES 2.0 headers, identify the mapper, and locate CHR-ROM / PRG-ROM data.
- Browse native-resolution 8×8, 2bpp CHR graphics and export original tile data.
- Export lossless PNG atlas sheets, per-bank ZIPs, JSON tile metadata, and raw CHR bytes.
- Select 1, 2, 4, or 8 KiB banks; configure atlas columns and transparent pixel index 0.
- **Experimental CHR-RAM game mode:** scan PRG-ROM bytes as possible 2bpp graphics. This is **not** decoding of compressed/game-specific CHR-RAM graphics.

## Palette exports

Select an imported 16/32-byte NES palette, or an **unverified** candidate scanned from PRG data. The app can export:

- **NES Palette `.pal`:** exact 16/32-byte NES color indices from the selected palette.
- **Swatches PNG:** 4 colors per sub-palette, in 32×32 swatches, suitable as a reference while working in Godot.
- **CSV:** background/sprite role, group, pixel index, raw NES index, RGB hex, transparency information, origin, and original ROM byte offset (when present).
- **JSON:** indices, approximate RGB values, source provenance, manual tile associations, and unverified status.
- **Palette Pack ZIP:** all the above in one package, plus a **192-byte RGB master palette**.
- **Master RGB `.pal`:** 64 colors × RGB888; either the built-in NTSC-style reference or a user-imported 192-byte palette.

**Important:** A raw CHR tile has 2-bit pixel indices but does *not* identify its palette, sprite, or animation. PRG palette scans are only candidates. Even imported raw PPU palette bytes do not reveal which tile or sprite used a particular palette. NES palette RAM contains four background and four sprite sub-palettes; background attribute bytes or sprite OAM attributes determine the selected group at runtime ([NESdev PPU palettes](https://www.nesdev.org/wiki/PPU_palettes)). The app preserves manual assignments but does not call them verified original colors.

## Godot 4

For the exported PNG atlas, use **Nearest** texture filtering and an 8×8 `TileSetAtlasSource` region size, with zero margins and separation. PNGs use RGBA and native pixel dimensions. Sprite PNGs can render pixel value 0 transparent.

## Validation

- Both supplied Castlevania III ROMs and the user's multi-game ZIP were checked with browser regression tests during development.
- A **synthetic-ROM browser test** is available at `tests/test_renderer.py`. It needs Python Playwright, Pillow, and Chromium. No copyrighted ROMs are included in this repository.
- Renderer syntax tests run with `npm run check`.
- The native installers and signing are not yet validated on physical Windows, macOS, or Linux machines.

## Development scope

This repository is the source of truth for the desktop app. Native source files are `main.cjs`, `index.html`, `renderer.js`, and `styles.css`; packaging configuration is in `package.json`. Dependencies are developer/build dependencies, not runtime services or cloud requirements.

No copyrighted game ROMs, original game graphics, or user asset dumps are distributed with this app.

## Multi-animation sprite assembly and Godot export (v0.4)

The **Sprite assembly & animation** workspace lets you create an editable sprite project containing several named animations, such as `idle`, `walk`, and `attack`. Each clip has its own frames (up to 64), speed (1–60 FPS), and looping setting. Up to 16 clips and 512 total frames are supported in one project.

1. Open a ROM and select an 8×8 tile in the CHR atlas.
2. Choose a sprite size (1–16 tiles per axis); click the editing grid to place the selected tile, or right-click to erase it. Each placed tile retains your selected sprite palette group.
3. **Duplicate frame** to add poses. Use **New animation**, **Rename**, **Delete animation**, and the animation dropdown to manage separate clips.
4. **Save sprite project JSON** to preserve animation names, grids, per-frame tile indices, palette groups, FPS, and looping. Existing v0.3 single-clip project files are imported and converted to the v2 multi-clip schema.
5. **Export Godot 4 SpriteFrames ZIP** to create an atlas and Godot resources for *all* animations at once.

### Export package and importing it

Unzip the exported folder directly into your **Godot 4 project root**, retaining the `nes_assets/` directory:

- `sprite_sheet.png` — unscaled RGBA sheet, packed in rows, with every frame occupying an exactly sized region.
- `sprite_frames.tres` — a `SpriteFrames` resource containing every named clip, its frame rectangles, playback FPS, and loop setting.
- `sprite_scene.tscn` — an `AnimatedSprite2D` scene with nearest filtering, initialized to the first animation.
- `sprite_project.json` — editable multi-animation project with selected palette data and provenance.
- `README.txt` — instructions and accuracy limitations.

Open `sprite_scene.tscn` in Godot, or assign `sprite_frames.tres` to an existing `AnimatedSprite2D` node. Resource paths assume the ZIP folder structure is preserved under `res://nes_assets/`.

**Accuracy:** These sprite assemblies, colors, and timings are edited by the user; they are not automatically recovered from original NES gameplay. CHR-RAM game graphics found with the PRG byte scanner remain experimental.

### Tests

The synthetic-ROM tests require Playwright, Pillow, and Chromium:

```sh
python tests/test_renderer.py
python tests/test_sprite_editor.py
python tests/test_unique_tiles.py
```

The new [Godot validation workflow](.github/workflows/godot-validation.yml) extracts a synthetic sprite export into a temporary Godot project and runs official Godot 4.7.2 in headless mode. Its script verifies the imported sheet texture, animation names, frame counts, FPS, looping settings, and `AnimatedSprite2D` scene. No copyrighted ROM assets are included in these tests. CI results, rather than mere presence of the workflow, determine whether Godot import is verified.

## Unique 8×8 atlas and duplicate detection (v0.5)

Use **Unique 8×8 tile atlas** to analyze the currently selected CHR-ROM bank or **All tiles**. Exact duplicates are identified by comparing all 16 source bytes of each 8×8 2bpp tile. This is independent of the displayed palette, and **does not** consider flip/rotation equivalence.

1. Select a ROM and graphics source, and choose bank/all tiles and atlas columns.
2. Click **Analyze duplicate tiles** to count repeated raw patterns and inspect the compact sheet. Clicking a unique tile selects its first original ROM occurrence in the main inspector.
3. Click **Export unique atlas ZIP**, which contains `unique_tiles.png`, exact `unique_tiles.chr` (or `.bin` for experimental PRG scans), `unique_tiles.json`, and `README.txt`.

The JSON schema `nes-asset-unique-tiles-v1` preserves source ROM offsets, the selected range's `firstOriginalTile`, every unique atlas tile's location and occurrence count, and `originalToAtlasIndex`. The Nth mapping entry locates source tile `firstOriginalTile + N` in the unique atlas. Manual palette assignments remain associated with **original** tile indices in metadata; the PNG uses one chosen preview palette so duplicates are not incorrectly split by color. The metadata labels PRG-ROM scans as experimental, not confirmed graphics.

A regression test, `python tests/test_unique_tiles.py`, validates exact deduplication, source offset mapping, exported tile bytes and PNG pixels, and bank-change invalidation with a synthetic freely generated ROM.

## Searchable tile catalog and native Godot TileSet (v0.6)

Use **Section 8 — Searchable tile catalog** after loading a ROM to search the entire selected graphics source, independent of the visible CHR bank. Search absolute tile indices in decimal or `0x` hexadecimal, raw tile-byte prefixes such as `hex:FF 00`, or filter for unique, repeated, blank, and nonblank 16-byte patterns. The preview is paginated at 128 tiles; click a result to inspect its original source index and ROM offset.

**Export filtered Godot TileSet ZIP** exports every matching tile, not just the preview page, in the game-specific folder `nes_assets/<game>_<sourceCRC32>/tile_catalog/`:

- `tileset_atlas.png` — 8×8 pixels per tile, 16 columns, no margins or separation.
- `tileset.tres` — native Godot 4 `TileSet` with a `TileSetAtlasSource` (source ID 0), registering each exported tile.
- `tileset_metadata.json` — original tile indices, byte offsets, 8 KiB bank indices, atlas coordinates, duplicate counts, and palette provenance.
- `README.txt` — extraction and import instructions.

Extract the `nes_assets/` folder into your Godot project root and assign the exported `tileset.tres` to a `TileMapLayer` node's TileSet property. Set nearest-neighbor filtering. **Palette colors are previews, not verified per-sprite/background in-game associations.** CHR-ROM 2bpp decoding is exact; PRG-ROM scanning in CHR-RAM games remains experimental and can include non-graphics data. Large filtered selections may need smaller limits to fit into browser canvas dimensions.
