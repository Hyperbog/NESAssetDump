"""Browser regression tests for multi-animation sprite projects and Godot 4 exports.
Usage: python tests/test_sprite_editor.py [--fixture-dir /tmp/godot-fixture]
"""
import io
import json
import re
import shutil
import sys
import zipfile
from pathlib import Path
from PIL import Image
from playwright.sync_api import sync_playwright
from test_renderer import make_rom, inline_test_html


def main():
    chromium = shutil.which('chromium') or shutil.which('google-chrome')
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=True, executable_path=chromium,
                                             args=['--no-sandbox'] if chromium else [])
        try:
            page = browser.new_page(accept_downloads=True, viewport={'width': 1400, 'height': 1100})
            errors = []
            page.on('pageerror', lambda e: errors.append(str(e)))
            page.set_content(inline_test_html(), wait_until='load')
            page.locator('#files').set_input_files({'name': 'SyntheticCHR.nes',
                                                      'mimeType': 'application/octet-stream',
                                                      'buffer': make_rom()})
            page.wait_for_function("()=>!document.querySelector('#spriteExport').disabled")
            assert page.locator('#spriteAnimation option').all_text_contents() == ['idle']

            atlas = page.locator('#preview').bounding_box()
            page.locator('#preview').click(position={'x': atlas['width'] * 1.5 / 16,
                                                     'y': atlas['width'] * .5 / 16})
            assert 'tile #1' in page.locator('#spriteChoice').inner_text()
            board = page.locator('#spriteCanvas').bounding_box()
            def stamp(x, y=0, button='left'):
                page.locator('#spriteCanvas').click(position={
                    'x': board['width'] * (x + .5) / 4,
                    'y': board['height'] * (y + .5) / 4}, button=button)

            # Idle consists of two independently edited frames.
            stamp(0)
            stamp(1)
            page.locator('#spriteAdd').click()
            stamp(1, button='right')
            assert page.locator('#spriteFrame option').count() == 2
            page.locator('#spriteFps').fill('7')
            page.locator('#spriteFps').press('Tab')
            page.locator('#spriteLoop').uncheck()

            # Add and rename an independent walk animation.
            page.locator('#spriteAnimAdd').click()
            page.locator('#spriteAnimName').fill('walk')
            page.locator('#spriteAnimRename').click()
            assert page.locator('#spriteAnimation option').all_text_contents() == ['idle', 'walk']
            page.locator('#spriteFps').fill('12')
            page.locator('#spriteFps').press('Tab')
            stamp(2)
            page.locator('#spriteAdd').click()
            stamp(3)
            assert page.locator('#spriteFrame option').count() == 2

            # Change between animations; FPS and looping must follow each animation.
            page.locator('#spriteAnimation').select_option(label='idle')
            assert page.locator('#spriteFps').input_value() == '7'
            assert not page.locator('#spriteLoop').is_checked()
            page.locator('#spriteAnimation').select_option(label='walk')
            assert page.locator('#spriteFps').input_value() == '12'
            assert page.locator('#spriteLoop').is_checked()
            page.locator('#spriteName').fill('Hero')
            with page.expect_download() as d:
                page.locator('#spriteSave').click()
            saved = json.loads(d.value.path().read_text())
            assert saved['schema'] == 'nes-asset-sprite-project-v2'
            assert saved['projectName'] == 'Hero'
            assert [a['name'] for a in saved['animations']] == ['idle', 'walk']
            assert [a['fps'] for a in saved['animations']] == [7, 12]
            assert [a['loop'] for a in saved['animations']] == [False, True]
            assert saved['animations'][0]['frames'][0][0] == {'tile': 1, 'group': 0}
            assert saved['animations'][0]['frames'][1][1] is None
            assert saved['animations'][1]['frames'][1][3] == {'tile': 1, 'group': 0}

            with page.expect_download() as d:
                page.locator('#spriteExport').click()
            payload = d.value.path().read_bytes()
            with zipfile.ZipFile(io.BytesIO(payload)) as z:
                assert z.testzip() is None
                names = z.namelist()
                png_name = next(n for n in names if n.endswith('/sprite_sheet.png'))
                tres_name = next(n for n in names if n.endswith('/sprite_frames.tres'))
                scene_name = next(n for n in names if n.endswith('/sprite_scene.tscn'))
                png = Image.open(io.BytesIO(z.read(png_name))).convert('RGBA')
                assert png.size == (128, 32), png.size
                # Four frames, each 32x32; cells drawn in their correct frame regions.
                assert png.getpixel((8+1, 5))[3] != 0
                assert png.getpixel((32+8+1, 5))[3] == 0
                assert png.getpixel((64+16+1, 5))[3] != 0
                assert png.getpixel((96+24+1, 5))[3] != 0
                tres = z.read(tres_name).decode('utf-8')
                assert tres.count('[sub_resource type="AtlasTexture"') == 4
                assert tres.count('"name": &"idle"') == 1
                assert tres.count('"name": &"walk"') == 1
                assert '"speed": 7.00' in tres and '"speed": 12.00' in tres
                assert '"loop": false' in tres and '"loop": true' in tres
                for x in range(0, 128, 32):
                    assert f'Rect2({x}, 0, 32, 32)' in tres
                assert f'res://{png_name}' in tres
                assert f'res://{tres_name}' in z.read(scene_name).decode('utf-8')
                assert json.loads(z.read(next(n for n in names if n.endswith('sprite_project.json')))) == saved
                if '--fixture-dir' in sys.argv:
                    directory = Path(sys.argv[sys.argv.index('--fixture-dir') + 1])
                    directory.mkdir(parents=True, exist_ok=True)
                    z.extractall(directory)
                    (directory/'project.godot').write_text('config_version=5\n\n[application]\nconfig/name="NESAssetDump integration fixture"\n')
                    shutil.copyfile(Path(__file__).parent / 'godot_verify.gd', directory / 'godot_verify.gd')

            # Save/restore v2, with all animation names, frame contents and FPS retained.
            page.locator('#spriteLoad').set_input_files({'name': 'saved.json',
                'mimeType': 'application/json', 'buffer': json.dumps(saved).encode()})
            page.wait_for_function("()=>document.querySelector('#spriteStatus').textContent.includes('Restored 2 animation(s)')")
            with page.expect_download() as d:
                page.locator('#spriteSave').click()
            assert json.loads(d.value.path().read_text())['animations'] == saved['animations']

            # Legacy v1 projects must load as one animation.
            legacy = {k: v for k, v in saved.items() if k not in ('projectName', 'animations')}
            legacy['schema'] = 'nes-asset-sprite-project-v1'
            legacy['frames'] = saved['animations'][0]['frames']
            legacy['animation'] = {'name': 'legacy', 'fps': 6, 'loop': True}
            page.locator('#spriteLoad').set_input_files({'name': 'old.json',
                'mimeType': 'application/json', 'buffer': json.dumps(legacy).encode()})
            page.wait_for_function("()=>document.querySelector('#spriteStatus').textContent.includes('Restored 1 animation(s)')")
            assert page.locator('#spriteAnimation option').all_text_contents() == ['legacy']
            assert page.locator('#spriteFps').input_value() == '6'
            assert not errors, errors
            print('PASS: multi-animation editing, independent FPS/loop, Godot export, v2 save/load, v1 migration')
        finally:
            browser.close()


if __name__ == '__main__':
    main()