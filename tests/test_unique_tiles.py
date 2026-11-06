"""Exact tile deduplication and Godot atlas export regression tests, no game ROM assets."""
import io
import json
import shutil
import zipfile
from pathlib import Path
from PIL import Image
from playwright.sync_api import sync_playwright
from test_renderer import inline_test_html


def synthetic_duplicate_rom():
    patterns = [
        bytes(16),
        bytes([255] * 8 + [0] * 8),
        bytes([0] * 8 + [255] * 8),
        bytes([0xAA, 0x55] * 8),
    ]
    chr_data = b''.join(patterns[i % 4] for i in range(512))
    header = b'NES\x1a' + bytes([1, 1, 0, 0]) + bytes(8)
    return header + bytes(16384) + chr_data, patterns


def main():
    rom, patterns = synthetic_duplicate_rom()
    binary = shutil.which('chromium') or shutil.which('google-chrome')
    with sync_playwright() as pw:
        browser = pw.chromium.launch(headless=True, executable_path=binary,
                                     args=['--no-sandbox'] if binary else [])
        try:
            page = browser.new_page(accept_downloads=True, viewport={'width': 1400, 'height': 1000})
            errors = []
            page.on('pageerror', lambda e: errors.append(str(e)))
            page.set_content(inline_test_html(), wait_until='load')
            page.locator('#files').set_input_files({
                'name': 'repeated_tiles.nes', 'mimeType': 'application/octet-stream', 'buffer': rom
            })
            page.wait_for_function("()=>!document.querySelector('#uniqueAnalyze').disabled")
            page.locator('#uniqueAnalyze').click()
            assert '512 original tiles' in page.locator('#uniqueStatus').inner_text()
            assert '4 unique tile patterns' in page.locator('#uniqueStatus').inner_text()
            assert page.locator('#uniquePreview').evaluate('(e)=>[e.width,e.height]') == [128, 8]
            # A unique-atlas tile is linked back to the correct original ROM tile.
            bounds = page.locator('#uniquePreview').bounding_box()
            page.locator('#uniquePreview').click(position={
                'x': bounds['width'] * 1.5 / 16, 'y': bounds['height'] / 2
            })
            assert 'Tile #1' in page.locator('#tileInfo').inner_text()
            with page.expect_download() as future:
                page.locator('#uniqueExport').click()
            with zipfile.ZipFile(io.BytesIO(future.value.path().read_bytes())) as archive:
                assert archive.testzip() is None
                assert set(archive.namelist()) == {
                    'unique_tiles.png', 'unique_tiles.json', 'unique_tiles.chr', 'README.txt'
                }
                assert archive.read('unique_tiles.chr') == b''.join(patterns)
                meta = json.loads(archive.read('unique_tiles.json'))
                assert meta['verifiedTileSource'] is True
                assert meta['firstOriginalTile'] == 0
                assert meta['uniqueTileCount'] == 4
                assert meta['duplicateTileCount'] == 508
                assert meta['originalToAtlasIndex'] == [i % 4 for i in range(512)]
                assert [x['occurrences'] for x in meta['uniqueTiles']] == [128]*4
                assert [x['romFileOffset'] for x in meta['uniqueTiles']] == [16400 + i*16 for i in range(4)]
                png = Image.open(io.BytesIO(archive.read('unique_tiles.png'))).convert('RGBA')
                assert png.size == (128, 8)
                assert png.getpixel((0, 0))[3] == 0  # color index 0 transparent
                assert png.getpixel((8, 0)) == (85, 85, 85, 255)
                assert png.getpixel((16, 0)) == (170, 170, 170, 255)

            # Scope / bank changes invalidate the prior cache and update mapping.
            page.locator('#bankSize').select_option('1024')
            assert page.locator('#uniqueExport').is_disabled()
            page.locator('#bank').select_option('1')
            page.locator('#uniqueAnalyze').click()
            with page.expect_download() as future:
                page.locator('#uniqueExport').click()
            with zipfile.ZipFile(io.BytesIO(future.value.path().read_bytes())) as archive:
                meta = json.loads(archive.read('unique_tiles.json'))
                assert meta['firstOriginalTile'] == 64
                assert meta['originalTileCount'] == 64
                assert meta['uniqueTileCount'] == 4
                assert meta['originalToAtlasIndex'] == [i % 4 for i in range(64)]
                assert meta['uniqueTiles'][0]['romFileOffset'] == 16400 + 64*16

            # Palette assignments do not silently change dedup identities.
            page.locator('#scope').select_option('all')
            page.locator('#uniqueAnalyze').click()
            assert '4 unique tile patterns' in page.locator('#uniqueStatus').inner_text()
            assert not errors, errors
            print('PASS: exact tile identity, deterministic maps, raw unique bytes, PNG pixels, invalidation and bank offsets')
        finally:
            browser.close()


if __name__ == '__main__':
    main()
