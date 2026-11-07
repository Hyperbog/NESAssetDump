"""Tile catalog annotations, curated collection export, workspace persistence and rollback."""
import io
import json
import shutil
import zipfile
from PIL import Image
from playwright.sync_api import sync_playwright
from test_renderer import make_rom, inline_test_html


def atlas_tile(page, tile):
    canvas = page.locator('#preview')
    box = canvas.bounding_box()
    width, height = canvas.evaluate('(el)=>[el.width,el.height]')
    x = tile % 16 * 8 + 4
    y = tile // 16 * 8 + 4
    canvas.click(position={'x': x * box['width'] / width, 'y': y * box['height'] / height})
    assert f'tile #{tile}' in page.locator('#tagSelected').inner_text().lower()


def main():
    chromium = shutil.which('chromium') or shutil.which('google-chrome')
    with sync_playwright() as pw:
        browser = pw.chromium.launch(headless=True, executable_path=chromium,
                                     args=['--no-sandbox'] if chromium else [])
        try:
            page = browser.new_page(accept_downloads=True, viewport={'width': 1350, 'height': 1050})
            errors=[]
            page.on('pageerror', lambda e: errors.append(str(e)))
            page.set_content(inline_test_html(), wait_until='load')
            page.locator('#files').set_input_files({'name': 'TagTest.nes', 'mimeType': 'application/octet-stream', 'buffer': make_rom()})
            page.wait_for_function("()=>!document.querySelector('#tagCreate').disabled")
            atlas_tile(page, 1)
            page.locator('#tagLabel').fill('Knight helmet')
            page.locator('#tagTags').fill('hero, idle, hero')
            page.locator('#tagNotes').fill('Upper half of the helmet; user-assigned')
            page.locator('#tagSave').click()
            page.locator('#tagCollectionName').fill('Hero tiles')
            page.locator('#tagCreate').click()
            page.locator('#tagToggle').click()
            atlas_tile(page, 18)
            page.locator('#tagToggle').click()
            page.locator('#tileSearch').fill('tag:idle')
            page.locator('#tileFind').click()
            assert '1 matching tiles' in page.locator('#tileCatalogStatus').inner_text()
            page.locator('#tagFind').click()
            assert '2 matching tiles' in page.locator('#tileCatalogStatus').inner_text()
            with page.expect_download() as future:
                page.locator('#tagGodot').click()
            with zipfile.ZipFile(io.BytesIO(future.value.path().read_bytes())) as z:
                assert z.testzip() is None
                base=next(x.removesuffix('tileset_metadata.json') for x in z.namelist()
                          if x.endswith('tileset_metadata.json'))
                assert '/filtered_collection_Hero_tiles_' in base
                meta=json.loads(z.read(base+'tileset_metadata.json'))
                png=Image.open(io.BytesIO(z.read(base+'tileset_atlas.png')))
                assert png.size==(128,8)
                assert [x['tileIndex'] for x in meta['tiles']]==[1,18]
                assert meta['tiles'][0]['annotation']['label']=='Knight helmet'
                assert meta['tiles'][0]['annotation']['tags']==['hero','idle']
                assert meta['tiles'][0]['collections']==['Hero tiles']
                assert meta['tiles'][1]['collections']==['Hero tiles']
                assert z.read(base+'tileset.tres').startswith(b'[gd_resource type="TileSet"')
            with page.expect_download() as future:
                page.locator('#workspaceSave').click()
            saved=json.loads(future.value.path().read_text())
            assert saved['tileLibrary']['annotations']['chr:1']['label']=='Knight helmet'
            assert saved['tileLibrary']['collections'][0]['tiles']==['chr:1','chr:18']
            # Invalid annotations must be rejected before existing edits are changed.
            bad=json.loads(json.dumps(saved))
            bad['tileLibrary']['collections'][0]['tiles'].append('chr:999999')
            page.locator('#workspaceLoad').set_input_files({'name':'invalid.json','mimeType':'application/json',
                 'buffer':json.dumps(bad).encode()})
            page.wait_for_function("()=>document.querySelector('#workspaceStatus').textContent.includes('Invalid tile reference')")
            assert page.evaluate('window.NES_TILE_LIBRARY.snapshot().collections[0].tiles.length')==2
            # Changing ROM clears annotations; the saved workspace restores them with matching ROM.
            changed=bytearray(make_rom());changed[22]^=0x12
            page.locator('#files').set_input_files({'name':'Other.nes','mimeType':'application/octet-stream','buffer':bytes(changed)})
            page.locator('#game').select_option(label='Other.nes')
            page.wait_for_function("()=>document.querySelector('#status').textContent.includes('Other.nes')")
            assert page.evaluate('window.NES_TILE_LIBRARY.snapshot().collections.length')==0
            page.locator('#game').select_option(label='TagTest.nes')
            page.wait_for_function("()=>document.querySelector('#status').textContent.includes('TagTest.nes')")
            page.locator('#workspaceLoad').set_input_files({'name':'saved.json','mimeType':'application/json',
                 'buffer':json.dumps(saved).encode()})
            page.wait_for_function("()=>document.querySelector('#workspaceStatus').textContent.includes('Restored workspace')")
            assert page.evaluate('window.NES_TILE_LIBRARY.snapshot().collections[0].tiles.length')==2
            atlas_tile(page,1)
            assert page.locator('#tagLabel').input_value()=='Knight helmet'
            assert page.locator('#tagNotes').input_value().startswith('Upper half')
            # Older workspaces without annotations load as an empty tile library.
            legacy=json.loads(json.dumps(saved));del legacy['tileLibrary']
            page.locator('#workspaceLoad').set_input_files({'name':'legacy.json','mimeType':'application/json',
                 'buffer':json.dumps(legacy).encode()})
            page.wait_for_function("()=>window.NES_TILE_LIBRARY.snapshot().collections.length===0")
            assert page.locator('#workspaceStatus').inner_text().startswith('Restored workspace')
            assert errors==[],errors
            print('PASS: tile labels, tag search, collections, Godot export, workspace rollback/restore and legacy files')
        finally:
            browser.close()


if __name__=='__main__':
    main()