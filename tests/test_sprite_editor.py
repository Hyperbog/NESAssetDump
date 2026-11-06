"""End-to-end synthetic-ROM tests for manual sprite composition and Godot export."""
import io
import json
import re
import shutil
import zipfile
from pathlib import Path

from PIL import Image
from playwright.sync_api import sync_playwright
from test_renderer import ROOT, make_rom, inline_test_html


def main():
    chromium = shutil.which('chromium') or shutil.which('google-chrome')
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True, executable_path=chromium, args=['--no-sandbox'] if chromium else [])
        try:
            page = browser.new_page(accept_downloads=True, viewport={'width': 1400, 'height': 1000})
            errors = []
            page.on('pageerror', lambda e: errors.append(str(e)))
            page.set_content(inline_test_html(), wait_until='load')
            page.locator('#files').set_input_files({'name':'SyntheticCHR.nes','mimeType':'application/octet-stream','buffer':make_rom()})
            page.wait_for_function("()=>!document.querySelector('#spriteExport').disabled")

            # Select second tile from original CHR atlas and stamp two sprite cells.
            atlas = page.locator('#preview').bounding_box()
            page.locator('#preview').click(position={'x':atlas['width']*1.5/16,'y':atlas['width']*0.5/16})
            assert 'tile #1' in page.locator('#spriteChoice').inner_text()
            board = page.locator('#spriteCanvas').bounding_box()
            page.locator('#spriteCanvas').click(position={'x':board['width']*0.125,'y':board['height']*0.125})
            page.locator('#spriteCanvas').click(position={'x':board['width']*0.375,'y':board['height']*0.125})
            page.locator('#spriteAdd').click()
            assert page.locator('#spriteFrame option').count() == 2
            # Second animation frame: remove one placed cell using right click.
            page.locator('#spriteCanvas').click(position={'x':board['width']*0.375,'y':board['height']*0.125},button='right')

            with page.expect_download() as d:
                page.locator('#spriteSave').click()
            saved = json.loads(d.value.path().read_text())
            assert saved['schema'] == 'nes-asset-sprite-project-v1'
            assert saved['sourceKind'] == 'chr'
            assert saved['widthTiles'] == 4 and saved['heightTiles'] == 4
            assert saved['frames'][0][0] == {'tile':1, 'group':0}
            assert saved['frames'][0][1] == {'tile':1, 'group':0}
            assert saved['frames'][1][1] is None

            with page.expect_download() as d:
                page.locator('#spriteExport').click()
            with zipfile.ZipFile(io.BytesIO(d.value.path().read_bytes())) as z:
                assert z.testzip() is None
                names=z.namelist()
                png=next(n for n in names if n.endswith('/sprite_sheet.png'))
                tres=next(n for n in names if n.endswith('/sprite_frames.tres'))
                scene=next(n for n in names if n.endswith('/sprite_scene.tscn'))
                png_bytes=z.read(png)
                sheet=Image.open(io.BytesIO(png_bytes)).convert('RGBA')
                assert sheet.size == (64,32),sheet.size
                assert sheet.getpixel((20,5))[3] == 0 # unused cells always transparent
                assert sheet.getpixel((64-8,5))[3] == 0
                assert sheet.getpixel((9,5))[3] != 0 # first frame contains tile at (1,0)
                assert sheet.getpixel((32+9,5))[3] == 0 # second frame cell erased
                resource=z.read(tres).decode()
                assert 'type="SpriteFrames"' in resource
                assert 'Rect2(0, 0, 32, 32)' in resource
                assert 'Rect2(32, 0, 32, 32)' in resource
                assert '"speed": 8.0' in resource
                assert '"name": &"idle"' in resource
                assert f'res://{png}' in resource
                assert f'res://{tres}' in z.read(scene).decode()
                assert json.loads(z.read(next(n for n in names if n.endswith('/sprite_project.json')))) == saved

            page.locator('#spriteClear').click()
            page.locator('#spriteLoad').set_input_files({'name':'saved.json','mimeType':'application/json','buffer':json.dumps(saved).encode()})
            page.wait_for_function("()=>document.querySelector('#spriteStatus').textContent.includes('Restored 2 frames')")
            with page.expect_download() as d:
                page.locator('#spriteSave').click()
            restored = json.loads(d.value.path().read_text())
            assert restored['frames'] == saved['frames']
            assert not errors, errors
            print('PASS: tile placement, per-frame edits, transparent PNG, Godot .tres paths, project round trip')
        finally:
            browser.close()

if __name__ == '__main__':
    main()