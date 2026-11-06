"""8x16 NES PPU OAM-indexed sprite pair regression and Godot fixture."""
import io, json, shutil, sys, zipfile
from pathlib import Path
from PIL import Image
from playwright.sync_api import sync_playwright
from test_renderer import inline_test_html

def synthetic_rom():
    chr_bytes=bytearray(16384)
    def pixel(tile,x,y,value):
        if value&1: chr_bytes[tile*16+y]|=1<<(7-x)
        if value&2: chr_bytes[tile*16+8+y]|=1<<(7-x)
    pixel(0,0,0,1)
    pixel(1,0,0,2)
    pixel(256,0,0,3)
    pixel(257,7,7,1)
    pixel(512,0,0,2)
    return b'NES\x1a'+bytes((1,2,0,0))+bytes(8)+bytes(16384)+bytes(chr_bytes)

def exported(page):
    with page.expect_download() as pending:
        page.locator('#pairExport').click()
    with zipfile.ZipFile(io.BytesIO(pending.value.path().read_bytes())) as z:
        assert z.testzip() is None
        prefix=next(p.removesuffix('sprite_pairs.json') for p in z.namelist() if p.endswith('/sprite_pairs.json'))
        return {n.removeprefix(prefix):z.read(n) for n in z.namelist()},prefix

def image(files,key):
    return Image.open(io.BytesIO(files[key])).convert('RGBA')

def main():
    rom=synthetic_rom()
    binary=shutil.which('chromium') or shutil.which('google-chrome')
    with sync_playwright() as pw:
        browser=pw.chromium.launch(headless=True,executable_path=binary,args=['--no-sandbox'] if binary else [])
        try:
            page=browser.new_page(accept_downloads=True)
            errors=[]
            page.on('pageerror',lambda e:errors.append(str(e)))
            page.set_content(inline_test_html(),wait_until='load')
            page.locator('#files').set_input_files({'name':'pair-test.nes','mimeType':'application/octet-stream','buffer':rom})
            page.wait_for_function("()=>!document.querySelector('#pairExport').disabled")
            assert page.locator('#pairBank option').count()==2
            assert page.locator('#pairPreview').evaluate('e=>[e.width,e.height]')==[128,256]
            page.locator('#pairPreview').click(position={'x':11,'y':4})
            assert 'ROM tiles 256 + 257' in page.locator('#pairInfo').inner_text()
            files,prefix=exported(page)
            assert set(files)=={'sprite_pairs.png','flip_horizontal.png','flip_vertical.png',
                'flip_both.png','original_8kb_chr.chr','sprite_pairs.json','sprite_pairs.tres','README.txt'}
            assert files['original_8kb_chr.chr']==rom[16400:16400+8192]
            pic=image(files,'sprite_pairs.png')
            assert pic.size==(128,256)
            assert pic.getpixel((0,0))==(85,85,85,255)
            assert pic.getpixel((0,8))==(170,170,170,255)
            assert pic.getpixel((8,0))==(255,255,255,255)
            assert pic.getpixel((15,15))==(85,85,85,255)
            assert pic.getpixel((0,1))[3]==0
            assert image(files,'flip_horizontal.png').getpixel((7,0))==(85,85,85,255)
            assert image(files,'flip_vertical.png').getpixel((0,15))==(85,85,85,255)
            assert image(files,'flip_both.png').getpixel((7,15))==(85,85,85,255)
            meta=json.loads(files['sprite_pairs.json'])
            assert meta['schema']=='nes-asset-sprite-pairs-v1'
            assert not meta['verifiedRuntimeBankMapping']
            assert meta['pairCount']==256
            assert [(x['topTileIndex'],x['bottomTileIndex']) for x in meta['spriteCandidates'][:3]]==[(0,1),(256,257),(2,3)]
            assert meta['spriteCandidates'][1]['patternTablePPUAddress']==4096
            assert meta['spriteCandidates'][1]['romTopFileOffset']==16400+256*16
            assert meta['spriteCandidates'][255]['topTileIndex']==510
            tres=files['sprite_pairs.tres'].decode()
            assert 'tile_size = Vector2i(8, 16)' in tres
            assert 'texture_region_size = Vector2i(8, 16)' in tres
            assert tres.count('/0 = 0')==256
            assert 'res://'+prefix+'sprite_pairs.png' in tres
            if '--fixture-dir' in sys.argv:
                root=Path(sys.argv[sys.argv.index('--fixture-dir')+1])
                root.mkdir(parents=True,exist_ok=True)
                for name,blob in files.items():
                    dest=root/prefix/name
                    dest.parent.mkdir(parents=True,exist_ok=True)
                    dest.write_bytes(blob)
                if not (root/'project.godot').exists():
                    (root/'project.godot').write_text('config_version=5\n\n[application]\nconfig/name="NESAssetDump tests"\n')
                shutil.copyfile(Path(__file__).parent/'godot_verify_pairs.gd',root/'godot_verify_pairs.gd')
            page.locator('#pairBank').select_option('1')
            second,_=exported(page)
            assert second['original_8kb_chr.chr']==rom[16400+8192:]
            assert image(second,'sprite_pairs.png').getpixel((0,0))==(170,170,170,255)
            page.locator('#source').select_option('prg')
            assert page.locator('#pairExport').is_disabled()
            assert errors==[],errors
            print('PASS: 8x16 sprite pairs, OAM order, pixel flips, ROM offsets and Godot TileSet')
        finally:
            browser.close()

if __name__=='__main__':
    main()
