"""Browser regression and Godot fixture test for the NES searchable TileSet catalog."""
import io
import json
import shutil
import sys
import zipfile
from pathlib import Path

from PIL import Image
from playwright.sync_api import sync_playwright
from test_renderer import inline_test_html
from test_unique_tiles import synthetic_duplicate_rom


def main():
    rom, patterns = synthetic_duplicate_rom()
    executable = shutil.which("chromium") or shutil.which("google-chrome")
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True, executable_path=executable,
                                    args=["--no-sandbox"] if executable else [])
        try:
            page = browser.new_page(accept_downloads=True)
            errors = []
            page.on("pageerror", lambda e: errors.append(str(e)))
            page.set_content(inline_test_html(), wait_until="load")
            page.locator("#files").set_input_files({
                "name": "Repeated.nes", "mimeType": "application/octet-stream", "buffer": rom})
            page.wait_for_function("()=>!document.querySelector('#png').disabled")
            page.locator("#tileFind").click()
            assert "512 matching tiles" in page.locator("#tileCatalogStatus").inner_text()
            assert "4 distinct patterns" in page.locator("#tileCatalogStatus").inner_text()
            assert page.locator("#tilePage").inner_text() == "Page 1 / 4"
            page.locator("#tileNext").click()
            assert page.locator("#tilePage").inner_text() == "Page 2 / 4"
            page.locator("#tileFilter").select_option("blank")
            assert "128 matching tiles" in page.locator("#tileCatalogStatus").inner_text()
            page.locator("#tileFilter").select_option("nonblank")
            assert "384 matching tiles" in page.locator("#tileCatalogStatus").inner_text()
            page.locator("#tileFilter").select_option("duplicate")
            assert "512 matching tiles" in page.locator("#tileCatalogStatus").inner_text()
            page.locator("#tileFilter").select_option("unique")
            assert "4 matching tiles" in page.locator("#tileCatalogStatus").inner_text()
            page.locator("#tileSearch").fill("0x2")
            page.locator("#tileFind").click()
            assert "1 matching tiles" in page.locator("#tileCatalogStatus").inner_text()
            page.locator("#tileSearch").fill("hex:FF FF")
            page.locator("#tileFind").click()
            assert "1 matching tiles" in page.locator("#tileCatalogStatus").inner_text()
            page.locator("#tileSearch").fill("hex:" + "FF " * 17)
            page.locator("#tileFind").click()
            assert "only 16 source bytes" in page.locator("#tileCatalogStatus").inner_text()
            page.locator("#tileSearch").fill("")
            page.locator("#tileFind").click()
            page.locator("#tileCatalog").click(position={"x": 20, "y": 3})
            assert "Tile #2" in page.locator("#tileInfo").inner_text()
            with page.expect_download() as future:
                page.locator("#tileSetExport").click()
            with zipfile.ZipFile(io.BytesIO(future.value.path().read_bytes())) as archive:
                assert archive.testzip() is None
                resource_paths = [name for name in archive.namelist() if name.endswith("/tileset.tres")]
                assert len(resource_paths) == 1
                prefix = resource_paths[0].removesuffix("tileset.tres")
                assert set(archive.namelist()) == {
                    prefix + name for name in
                    ["tileset_atlas.png", "tileset.tres", "tileset_metadata.json", "README.txt"]}
                image = Image.open(io.BytesIO(archive.read(prefix + "tileset_atlas.png"))).convert("RGBA")
                assert image.size == (128, 8)
                assert image.getpixel((0, 0))[3] == 0
                assert image.getpixel((8, 0)) == (85, 85, 85, 255)
                meta = json.loads(archive.read(prefix + "tileset_metadata.json"))
                assert meta["verifiedTileSource"] is True
                assert [tile["tileIndex"] for tile in meta["tiles"]] == [0, 1, 2, 3]
                assert [tile["atlasCoords"] for tile in meta["tiles"]] == [[0,0],[1,0],[2,0],[3,0]]
                assert [tile["romFileOffset"] for tile in meta["tiles"]] == [16400+i*16 for i in range(4)]
                resource = archive.read(resource_paths[0]).decode()
                assert resource.startswith('[gd_resource type="TileSet"')
                assert "tile_size = Vector2i(8, 8)" in resource
                assert "texture_region_size = Vector2i(8, 8)" in resource
                assert resource.count("/0 = 0") == 4
                assert f"res://{prefix}tileset_atlas.png" in resource
                if "--fixture-dir" in sys.argv:
                    dest = Path(sys.argv[sys.argv.index("--fixture-dir") + 1])
                    dest.mkdir(parents=True, exist_ok=True)
                    archive.extractall(dest)
                    if not (dest / "project.godot").exists():
                        (dest / "project.godot").write_text(
                            'config_version=5\n\n[application]\nconfig/name="NESAssetDump Tests"\n')
                    shutil.copyfile(Path(__file__).parent / "godot_verify_tileset.gd",
                                    dest / "godot_verify_tileset.gd")
            page.locator("#source").select_option("prg")
            assert page.locator("#tileSetExport").is_disabled()
            assert not errors, errors
            print("PASS: catalog search, paging, source mapping, PNG, Godot TileSet export")
        finally:
            browser.close()


if __name__ == "__main__":
    main()
