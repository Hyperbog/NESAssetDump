# NESAssetDump

A **local desktop NES asset ripper** focused on lossless 8×8 CHR-ROM extraction, palette editing, and Godot 4 atlas exports. Built with Electron; ROMs are opened and processed locally, with no emulator, cloud account, or ROM uploads.

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