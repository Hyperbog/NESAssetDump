"""Verify multi-ROM collection export, exact CHR bytes, tile RGB, offsets and CHR-RAM reporting."""
import io
import json
import struct
import zipfile
import os
import shutil
from pathlib import Path
from PIL import Image
from playwright.sync_api import sync_playwright
from test_renderer import inline_test_html


def rom_with_chr(chr_banks, mapper=0):
    header = b'NES\x1a' + bytes([1, chr_banks, (mapper & 0x0F) << 4,
                                 (mapper & 0xF0)]) + bytes(8)
    prg = bytes([0xEA]) * 16384
    chr_data = bytes((i * 19 + (i//16)*7) % 256 for i in range(chr_banks * 8192))
    return header + prg + chr_data


def export(page):
    with page.expect_download(timeout=120000) as pending:
        page.locator('#batchExport').click()
    raw = pending.value.path().read_bytes()
    with zipfile.ZipFile(io.BytesIO(raw)) as z:
        assert z.testzip() is None
        manifest = json.loads(z.read('batch_index.json'))
        report = z.read('compatibility_report.csv').decode()
        data = {name: z.read(name) for name in z.namelist()}
    return manifest, report, data


def test():
    a = rom_with_chr(2, 24)
    b = rom_with_chr(1, 5)
    ram = rom_with_chr(0, 2)
    zipped = io.BytesIO()
    with zipfile.ZipFile(zipped, 'w', zipfile.ZIP_DEFLATED) as zip_data:
        zip_data.writestr('nested/Z Japan.nes', a)
        zip_data.writestr('A USA.nes', b)
        zip_data.writestr('B RAM.nes', ram)
        zip_data.writestr('C Broken.nes', b'bad')
    chromium=os.environ.get('CHROMIUM_EXECUTABLE') or shutil.which('chromium')
    with sync_playwright() as pw:
        browser=pw.chromium.launch(headless=True, executable_path=chromium,
                                  args=['--no-sandbox'] if chromium else [])
        try:
            page=browser.new_page(accept_downloads=True)
            errors=[]
            page.on('pageerror',lambda e:errors.append(str(e)))
            page.set_content(inline_test_html(),wait_until='load')
            page.locator('#files').set_input_files({'name':'collection.zip','mimeType':'application/zip',
                                                    'buffer':zipped.getvalue()})
            page.wait_for_function("()=>document.querySelector('#game').options.length===4")
            page.wait_for_function("()=>!document.querySelector('#batchExport').disabled")
            # First selected ROM is valid; test a later CHR-RAM selection is not changed by the exporter.
            page.locator('#game').select_option(label='B RAM.nes')
            page.wait_for_function("()=>document.querySelector('#source').value==='prg'")
            initial=page.locator('#game').input_value()
            manifest,report,data=export(page)
            assert page.locator('#game').input_value()==initial
            assert manifest['summary']=={'total':4,'exported':2,'needsDecoder':1,'failed':1}
            assert len(manifest['games'])==4
            assert 'requires-game-decoder' in report and 'failed' in report
            rows={r['name']:r for r in manifest['games']}
            assert rows['B RAM.nes']['status']=='requires-game-decoder'
            assert rows['B RAM.nes']['files']==[]
            assert rows['C Broken.nes']['status']=='failed'
            assert 'Unsupported cartridge format' in rows['C Broken.nes']['note']
            for name,rom,mapper in [('A USA.nes',b,5),('Z Japan.nes',a,24)]:
                entry=rows[name]
                assert entry['mapper']==mapper and entry['status']=='exported'
                assert len(entry['banks'])==rom[5]
                raw=next(f for f in entry['files'] if f.endswith('original_chr.chr'))
                assert data[raw]==rom[16+16384:]
                meta_file=next(f for f in entry['files'] if f.endswith('tiles.json'))
                meta=json.loads(data[meta_file])
                assert meta['sourceCRC32']==entry['chrCRC32']
                assert meta['chrROMFileOffset']==16+16384
                assert meta['tileBytes']==16
                for bank in entry['banks']:
                    assert bank['tileCount']==512
                    assert bank['romFileOffset']==16+16384+bank['bank']*8192
                    im=Image.open(io.BytesIO(data[bank['image']])).convert('RGBA')
                    assert im.size==(128,256)
                    for tile in (0,17,511):
                        index=bank['firstTile']+tile
                        lo=rom[16+16384+index*16]
                        hi=rom[16+16384+index*16+8]
                        for x in (0,2,7):
                            pixel=((lo>>(7-x))&1)|(((hi>>(7-x))&1)<<1)
                            assert im.getpixel((tile%16*8+x,tile//16*8)) == (pixel*85,pixel*85,pixel*85,0 if pixel==0 else 255)
            assert 'C Broken' not in ''.join(data.keys())
            assert not errors,errors
            print('PASS: batch mixed ZIP, 2 exact CHR-ROM exports, bank pixels, CRC/offsets, CHR-RAM and invalid-ROM report')
        finally:
            browser.close()

if __name__=='__main__':
    test()