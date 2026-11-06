# NESAssetDump

A standalone, browser-based NES graphics ripper for exporting 8×8 tile atlases to **Godot 4**.

**Run the application:** Download [`index.html`](index.html) and open it in a modern browser. All ROM parsing and image export happen locally in your browser. No installation, emulator, scripts, or command-line setup required.

## Features

- Open a single `.nes` ROM or a `.zip` containing multiple NES ROMs, then select a game.
- Parse iNES / NES 2.0 ROM headers and show mapper and PRG/CHR sizes.
- View raw 8×8, 2-bit-per-pixel CHR-ROM tile sheets.
- Export native-resolution PNG atlases, per-bank PNG/JSON ZIP packs, and original CHR binary data.
- Choose atlas columns and bank sizes (1, 2, 4, or 8 KiB).
- Set NES pixel value 0 transparent for sprite-friendly previews.
- Preview four NES sub-palette variants; import raw palette indices or a 64-color RGB master palette.
- Manually assign sub-palettes to tiles and export the palette and tile metadata.

## Quick start

1. Open `index.html`.
2. Load a legally obtained `.nes` file or a ZIP containing NES ROMs.
3. Select the game and, for **CHR-ROM** games, choose **CHR-ROM — verified tiles**.
4. Set **16 tiles per row**, an **8 KiB bank**, and transparency if needed.
5. Download **Atlas PNG**, **Atlas JSON**, or **All banks ZIP**.

## Godot 4

Import the exported PNG into Godot and set texture filtering to **Nearest**. For `TileSetAtlasSource`, use:

- Tile / texture region size: **8 × 8 pixels**
- Margins: **0 × 0**
- Separation: **0 × 0**

The exported JSON associates tile indices with the original ROM byte positions. Use a palette variant PNG or import/assign colors as needed.

## Accuracy and limitations

| Source / feature | Accuracy |
| --- | --- |
| Uncompressed **CHR-ROM** tiles | Exact 8×8 2bpp decoding of ROM bytes |
| CHR-ROM binary export | Original source bytes |
| Raw **PRG-ROM** graphics scan for CHR-RAM games | **Experimental**: arbitrary 16-byte windows are not guaranteed to be actual graphics; compressed/game-specific formats are not decoded |
| Potential PRG palette tables | **Unverified candidates** until associated with game behavior |
| Four palette variants | Color options, **not** proof of which sprite/tile uses which palette |
| Manually assigned palettes | User annotations; not automatically recovered gameplay attributes |
| Complete multi-tile character sprites and animations | **Not automatically reconstructed** |

NES palette assignments depend on background attributes, OAM sprite attributes, and runtime state. CHR-ROM alone generally does not establish the original per-sprite colors.

## Scope

This project is a **general-purpose NES tile ripper** that aims to support many games. CHR-RAM games may require format-specific graphics decompression to recover their real assets. Do not redistribute copyrighted ROMs or game asset dumps without authorization.

## Development

The application currently resides in a single self-contained `index.html` file, making it simple to use offline or deploy as a static site. The repository is the source of truth for future changes.

GitHub Pages is optional and **not enabled automatically** by adding `index.html`. To publish it through GitHub Pages, configure Pages in the repository settings to deploy from the root of the `main` branch.
