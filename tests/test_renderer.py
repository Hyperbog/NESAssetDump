"""Browser integration smoke test. Uses synthetic ROMs; requires Playwright and Pillow."""
import io
import json
import re
import shutil
import zipfile
from pathlib import Path

from PIL import Image
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent

def synthetic(chr_rom=True):
    header = b'NES\x1a' + bytes([1, int(chr_rom), 0, 0]) + bytes(8)
    prg = bytes(16384)
    chr_data = bytes((i * 73 + i // 16) & 255 for i in range(8192)) if chr_rom else b''
    return header + prg + chr_data

def html_for_browser_test():
    html = (ROOT / 'index.html').read_text()
    # Inlined only in this test because the sandbox blocks http:// and file:// navigations.
    html = re.sub(r'<meta http-equiv="Content-Security-Policy"[^>]*>', '', html)
    html = html.replace('<link rel="stylesheet" href="styles.css">', '<style>' + (ROOT / 'styles.css').read_text() + '</style>')
    html = html.replace('<script defer src="renderer.js"></script>', '<script>' + (ROOT / 'renderer.js').read_text() + '</script>')
    return html

def test():
    rom = synthetic()
    executable = shutil.which('chromium') or shutil.which('google-chrome')
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True, executable_path=executable, args=['--no-sandbox'] if executable else [])
        try:
            page = browser.new_page(accept_downloads=True)
            errors = []
            page.on('pageerror', lambda e: errors.append(str(e)))
            page.set_content(html_for_browser_test(), wait_until='load')
            page.locator('#files').set_input_files({'name': 'synthetic.nes', 'mimeType': 'application/octet-stream', 'buffer': rom})
            page.wait_for_function("()=>document.querySelector('#source').value==='chr' && !document.querySelector('#png').disabled")
            assert page.locator('#paletteRaw').is_disabled()
            with page.expect_download() as d:
                page.locator('#png').click()
            atlas = Image.open(d.value.path()).convert('RGBA')
            assert atlas.size == (128, 256)
            for t in (0, 34, 511):
                for y in range(8):
                    lo, hi = rom[16400 + t * 16 + y], rom[16408 + t * 16 + y]
                    for x in range(8):
                        v = ((lo >> (7-x)) & 1) | (((hi >> (7-x)) & 1) << 1)
                        assert atlas.getpixel((t%16*8+x, t//16*8+y)) == (v*85,v*85,v*85,0 if v==0 else 255)
            pal = bytes([15, 2, 17, 32]*4 + [15, 6, 22, 48]*4)
            page.locator('#paletteFile').set_input_files({'name':'colors.pal','mimeType':'application/octet-stream','buffer':pal})
            page.wait_for_function("()=>!document.querySelector('#paletteRaw').disabled")
            with page.expect_download() as d:
                page.locator('#paletteRaw').click()
            assert d.value.path().read_bytes() == pal
            with page.expect_download() as d:
                page.locator('#palettePack').click()
            with zipfile.ZipFile(io.BytesIO(d.value.path().read_bytes())) as z:
                assert z.testzip() is None
                assert z.read('nes_palette_indices_32b.pal') == pal
                assert not json.loads(z.read('palette_metadata.json'))['verifiedRuntime']
            with page.expect_download() as d:
                page.locator('#pack').click()
            with zipfile.ZipFile(io.BytesIO(d.value.path().read_bytes())) as z:
                assert z.read('original_chr.chr') == rom[16400:]
            buf = io.BytesIO()
            with zipfile.ZipFile(buf,'w',zipfile.ZIP_DEFLATED) as z:
                z.writestr('synthetic_ram.nes',synthetic(False))
            page.locator('#files').set_input_files({'name':'games.zip','mimeType':'application/zip','buffer':buf.getvalue()})
            page.wait_for_function("()=>document.querySelector('#game').options.length===2")
            page.locator('#game').select_option(label='synthetic_ram.nes')
            page.wait_for_function("()=>document.querySelector('#status').textContent.includes('CHR-RAM cartridge')")
            assert page.locator('#source').input_value() == 'prg'
            assert not errors,errors
            print('PASS: CHR decoding, raw palettes, palette pack, CHR ZIP integrity, CHR-RAM indication')
        finally:
            browser.close()

if __name__ == '__main__':
    test()
