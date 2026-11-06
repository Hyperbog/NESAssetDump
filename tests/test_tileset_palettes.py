"""Regression: user-assigned palette groups must affect TileSet PNGs and metadata."""
import io
import json
import shutil
import zipfile
from PIL import Image
from playwright.sync_api import sync_playwright
from test_renderer import inline_test_html
from test_unique_tiles import synthetic_duplicate_rom

def download_export(page):
    with page.expect_download() as pending:
        page.locator('#tileSetExport').click()
    with zipfile.ZipFile(io.BytesIO(pending.value.path().read_bytes())) as z:
        assert z.testzip() is None
        base = next(x.removesuffix('tileset_metadata.json') for x in z.namelist()
                    if x.endswith('/tileset_metadata.json'))
        return (Image.open(io.BytesIO(z.read(base+'tileset_atlas.png'))).convert('RGBA'),
                json.loads(z.read(base+'tileset_metadata.json')),
                z.read(base+'tileset.tres').decode())

def select_tile(page,tile):
    canvas=page.locator('#preview')
    box=canvas.bounding_box()
    dims=canvas.evaluate('(e)=>[e.width,e.height]')
    canvas.click(position={'x':(tile%16*8+4)*box['width']/dims[0],
                           'y':(tile//16*8+4)*box['height']/dims[1]})

def main():
    rom,_=synthetic_duplicate_rom()
    chromium=shutil.which('chromium') or shutil.which('google-chrome')
    with sync_playwright() as playwright:
        browser=playwright.chromium.launch(headless=True,executable_path=chromium,
                                           args=['--no-sandbox'] if chromium else [])
        try:
            page=browser.new_page(accept_downloads=True,viewport={'width':1400,'height':1100})
            errors=[]
            page.on('pageerror',lambda e:errors.append(str(e)))
            page.set_content(inline_test_html(),wait_until='load')
            page.locator('#files').set_input_files({'name':'palette_test.nes',
                'mimeType':'application/octet-stream','buffer':rom})
            page.wait_for_function("()=>!document.querySelector('#png').disabled")
            # Distinct sprite sub-palettes in a 32-byte PPU palette dump.
            raw=bytes([0,1,2,3,0,4,5,6,0,7,8,9,0,10,11,12]*2)
            page.locator('#paletteFile').set_input_files({'name':'test.pal',
                'mimeType':'application/octet-stream','buffer':raw})
            page.wait_for_function("()=>!document.querySelector('#paletteRaw').disabled")
            page.locator('#paletteLayer').select_option('sprite')
            page.locator('#paint').check()
            page.locator('#paletteGroup').select_option('2')
            select_tile(page,1)
            assert 'Palette group: 2' in page.locator('#tileInfo').inner_text()
            page.locator('#paletteGroup').select_option('3')
            select_tile(page,2)
            assert 'Palette group: 3' in page.locator('#tileInfo').inner_text()
            page.locator('#paletteGroup').select_option('0')
            page.locator('#tileFilter').select_option('unique')
            page.locator('#tileFind').click()
            assert '4 matching tiles' in page.locator('#tileCatalogStatus').inner_text()
            rgb=page.evaluate('window.NES_ASSET_API.getContext().masterColors')
            pic,meta,tres=download_export(page)
            assert pic.size==(128,8)
            assert pic.getpixel((8,0))==(*rgb[7],255)
            assert pic.getpixel((16,0))==(*rgb[11],255)
            assert meta['palette']['exportMode']=='manual-per-tile'
            assert meta['palette']['assignedTileCount']==2
            assert meta['palette']['verifiedRuntime'] is False
            assert [t['effectivePaletteGroup'] for t in meta['tiles']]==[0,2,3,0]
            assert meta['tiles'][1]['paletteGroupSource']=='manual'
            assert 'TileSetAtlasSource' in tres
            page.locator('#tilePaletteMode').select_option('uniform')
            uniform,meta2,_=download_export(page)
            assert uniform.getpixel((8,0))==(*rgb[1],255)
            assert uniform.getpixel((16,0))==(*rgb[2],255)
            assert meta2['palette']['exportMode']=='uniform-preview'
            assert meta2['tiles'][1]['manuallyAssignedGroup']==2
            assert meta2['tiles'][1]['effectivePaletteGroup']==0
            assert errors==[],errors
            print('PASS: palette-aware TileSet PNG, original tile associations, and uniform fallback')
        finally:
            browser.close()

if __name__=='__main__':
    main()
