"""Browser regression test using synthetic, freely generated NES ROMs.
Requires Python Playwright, Pillow, and Chromium; no copyrighted ROMs needed.
The composite HTML bypasses only file/network navigation restrictions in test sandboxes.
"""
import io
import json
import os
import re
import shutil
import zipfile
from pathlib import Path

from PIL import Image
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent


def make_rom(with_chr=True):
    header = b'NES\x1a' + bytes((1, 1 if with_chr else 0, 0, 0)) + bytes(8)
    prg = bytes(16384)
    chr_bytes = bytes((i * 73 + i // 16) & 255 for i in range(8192)) if with_chr else b''
    return header + prg + chr_bytes


def inline_test_html():
    html = (ROOT / 'index.html').read_text()
    html = re.sub(r'<meta http-equiv="Content-Security-Policy"[^>]*>', '', html)
    html = html.replace('<link rel="stylesheet" href="styles.css">', '<style>' + (ROOT / 'styles.css').read_text() + '</style>')
    html = html.replace('<script defer src="renderer.js"></script>', '<script>' + (ROOT / 'renderer.js').read_text() + '</script>')
    html = html.replace('<script defer src="sprite_editor.js"></script>', '<script>' + (ROOT / 'sprite_editor.js').read_text() + '</script>')
    html = html.replace('<script defer src="unique_tiles.js"></script>', '<script>' + (ROOT / 'unique_tiles.js').read_text() + '</script>')
    return html


def main():
    rom = make_rom(True)
    runner = os.environ.get('CHROMIUM_EXECUTABLE') or shutil.which('chromium') or shutil.which('google-chrome')
    with sync_playwright() as pw:
        browser = pw.chromium.launch(headless=True, executable_path=runner, args=['--no-sandbox'] if runner else [])
        try:
            page = browser.new_page(accept_downloads=True)
            errors = []
            page.on('pageerror', lambda err: errors.append(str(err)))
            page.set_content(inline_test_html(), wait_until='load')
            page.locator('#files').set_input_files({'name': 'SyntheticCHR.nes', 'mimeType': 'application/octet-stream', 'buffer': rom})
            page.wait_for_function("()=>document.querySelector('#status').textContent.includes('CHR-ROM 8 KiB')")
            assert page.locator('#source').input_value() == 'chr'
            assert page.locator('#paletteRaw').is_disabled()

            with page.expect_download() as future:
                page.locator('#png').click()
            atlas = Image.open(future.value.path()).convert('RGBA')
            assert atlas.size == (128, 256)
            for tile in (0, 1, 34, 511):
                for y in range(8):
                    lo = rom[16 + 16384 + tile * 16 + y]
                    hi = rom[16 + 16384 + tile * 16 + 8 + y]
                    for x in range(8):
                        value = ((lo >> (7 - x)) & 1) | (((hi >> (7 - x)) & 1) << 1)
                        rgba = atlas.getpixel((tile % 16 * 8 + x, tile // 16 * 8 + y))
                        assert rgba == (value * 85, value * 85, value * 85, 0 if value == 0 else 255)

            pal = bytes([15, 2, 17, 32] * 4 + [15, 6, 22, 48] * 4)
            page.locator('#paletteFile').set_input_files({'name': 'colors.pal', 'mimeType': 'application/octet-stream', 'buffer': pal})
            page.wait_for_function("()=>document.querySelector('#paletteRaw').disabled===false")
            with page.expect_download() as future:
                page.locator('#paletteRaw').click()
            assert future.value.path().read_bytes() == pal
            with page.expect_download() as future:
                page.locator('#paletteSwatch').click()
            assert Image.open(future.value.path()).size == (128, 256)
            with page.expect_download() as future:
                page.locator('#paletteCsv').click()
            assert len(future.value.path().read_text().splitlines()) == 33
            with page.expect_download() as future:
                page.locator('#masterPal').click()
            assert len(future.value.path().read_bytes()) == 192
            with page.expect_download() as future:
                page.locator('#palettePack').click()
            with zipfile.ZipFile(io.BytesIO(future.value.path().read_bytes())) as exported:
                assert exported.testzip() is None
                assert exported.read('nes_palette_indices_32b.pal') == pal
                assert json.loads(exported.read('palette_metadata.json'))['verifiedRuntime'] is False
            with page.expect_download() as future:
                page.locator('#pack').click()
            with zipfile.ZipFile(io.BytesIO(future.value.path().read_bytes())) as exported:
                assert exported.testzip() is None
                assert exported.read('original_chr.chr') == rom[16 + 16384:]

            collection = io.BytesIO()
            with zipfile.ZipFile(collection, mode='w', compression=zipfile.ZIP_DEFLATED) as archive:
                archive.writestr('SyntheticCHR.nes', rom)
                archive.writestr('SyntheticRAM.nes', make_rom(False))
            page.locator('#files').set_input_files({'name': 'synthetic_games.zip', 'mimeType': 'application/zip', 'buffer': collection.getvalue()})
            page.wait_for_function("()=>document.querySelector('#game').options.length===3")
            page.locator('#game').select_option(label='SyntheticRAM.nes')
            page.wait_for_function("()=>document.querySelector('#status').textContent.includes('CHR-RAM cartridge')")
            assert page.locator('#source').input_value() == 'prg'
            with page.expect_download() as future:
                page.locator('#json').click()
            meta = json.loads(future.value.path().read_text())
            assert not meta['verifiedTileSource'] and meta['sourceKind'] == 'prg'
            assert not errors, errors
            print('PASS: synthetic CHR-ROM pixel accuracy, palette exports, ZIP integrity, CHR-RAM labeling')
        finally:
            browser.close()


if __name__ == '__main__':
    main()
