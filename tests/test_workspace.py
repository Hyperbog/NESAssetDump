"""Full-workspace save/load regression using synthetic NES ROMs."""
import json
import shutil
from playwright.sync_api import sync_playwright
from test_renderer import make_rom, inline_test_html


def main():
    chromium = shutil.which('chromium') or shutil.which('google-chrome')
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True, executable_path=chromium,
                                    args=['--no-sandbox'] if chromium else [])
        try:
            page = browser.new_page(accept_downloads=True, viewport={'width': 1400, 'height': 1050})
            errors = []
            page.on('pageerror', lambda exc: errors.append(str(exc)))
            page.set_content(inline_test_html(), wait_until='load')
            page.locator('#files').set_input_files({'name': 'Original.nes', 'mimeType': 'application/octet-stream', 'buffer': make_rom()})
            page.wait_for_function("()=>!document.querySelector('#workspaceSave').disabled")
            palette = bytes(([15, 2, 17, 32] * 4) + ([15, 6, 22, 48] * 4))
            page.locator('#paletteFile').set_input_files({'name': 'mycolors.pal', 'mimeType': 'application/octet-stream', 'buffer': palette})
            page.wait_for_function("()=>document.querySelector('#paletteVariant').selectedOptions[0].textContent.includes('mycolors.pal')")
            page.locator('#paletteGroup').select_option('2')
            page.locator('#paint').check()
            box = page.locator('#preview').bounding_box()
            page.locator('#preview').click(position={'x': box['width'] * 1.5 / 16,
                                                     'y': box['width'] * .5 / 16})
            assert 'Palette group: 2' in page.locator('#tileInfo').inner_text()
            page.locator('#spriteCanvas').click(position={'x': 12, 'y': 12})
            page.locator('#spriteAnimAdd').click()
            page.locator('#spriteAnimName').fill('walk')
            page.locator('#spriteAnimRename').click()
            page.locator('#spriteFps').fill('11')
            page.locator('#spriteFps').press('Tab')
            page.locator('#spriteAdd').click()
            page.locator('#spriteName').fill('hero')
            page.locator('#tilePaletteMode').select_option('uniform')
            page.locator('#scope').select_option('all')
            page.locator('#transparent').uncheck()
            # Record source state through the native download, not private Python state.
            with page.expect_download() as d:
                page.locator('#workspaceSave').click()
            saved = json.loads(d.value.path().read_text())
            assert saved['schema'] == 'nes-asset-workspace-v1'
            assert saved['graphics']['assignments']['chr:1'] == 2
            assert saved['graphics']['options']['tilePaletteMode'] == 'uniform'
            assert saved['graphics']['options']['transparent'] is False
            assert [a['name'] for a in saved['sprite']['animations']] == ['idle', 'walk']
            assert saved['sprite']['animations'][1]['fps'] == 11
            assert saved['sprite']['animations'][1]['frames'][1][0] is None  # New animation initially blank
            assert saved['rom']['romCRC32'] == saved['graphics']['romCRC32']
            assert len(json.dumps(saved)) < 1_000_000
            changed = bytearray(make_rom())
            changed[22] ^= 0x44
            page.locator('#files').set_input_files({'name': 'Other.nes', 'mimeType': 'application/octet-stream', 'buffer': bytes(changed)})
            page.locator('#game').select_option(label='Other.nes')
            page.wait_for_function("()=>document.querySelector('#status').textContent.includes('Other.nes')")
            page.locator('#workspaceLoad').set_input_files({'name': 'old.json', 'mimeType': 'application/json', 'buffer': json.dumps(saved).encode()})
            page.wait_for_function("()=>document.querySelector('#workspaceStatus').textContent.includes('mismatch')")
            assert page.locator('#spriteAnimation option').all_text_contents() == ['idle']
            assert page.evaluate('window.NES_ASSET_API.workspaceSnapshotGraphics().assignments') == {}
            page.locator('#game').select_option(label='Original.nes')
            page.wait_for_function("()=>document.querySelector('#status').textContent.includes('Original.nes')")
            invalid = json.loads(json.dumps(saved))
            invalid['graphics']['activeVariant']['name'] = 'nonexistent saved palette'
            page.locator('#workspaceLoad').set_input_files({'name': 'malformed.json', 'mimeType': 'application/json', 'buffer': json.dumps(invalid).encode()})
            page.wait_for_function("()=>document.querySelector('#workspaceStatus').textContent.includes('Saved palette was not found')")
            assert page.locator('#spriteAnimation option').all_text_contents() == ['idle']
            assert page.evaluate('window.NES_ASSET_API.workspaceSnapshotGraphics().assignments') == {}
            page.locator('#workspaceLoad').set_input_files({'name': 'workspace.json', 'mimeType': 'application/json', 'buffer': json.dumps(saved).encode()})
            page.wait_for_function("()=>document.querySelector('#workspaceStatus').textContent.includes('Restored workspace')")
            assert page.locator('#spriteAnimation option').all_text_contents() == ['idle', 'walk']
            assert page.locator('#spriteFps').input_value() == '11'
            assert page.locator('#tilePaletteMode').input_value() == 'uniform'
            assert not page.locator('#transparent').is_checked()
            assert page.locator('#scope').input_value() == 'all'
            assert page.locator('#paletteGroup').input_value() == '2'
            with page.expect_download() as d:
                page.locator('#workspaceSave').click()
            restored = json.loads(d.value.path().read_text())
            assert restored['graphics']['assignments'] == saved['graphics']['assignments']
            assert restored['graphics']['activeVariant'] == saved['graphics']['activeVariant']
            assert restored['sprite']['animations'] == saved['sprite']['animations']
            assert errors == [], errors
            print('PASS: workspace ROM binding, palette/tile state, sprite animations, mismatch rejection and round trip')
        finally:
            browser.close()

if __name__ == '__main__':
    main()
