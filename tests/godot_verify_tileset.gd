extends SceneTree
# Load the actual Godot resource; do not validate only its textual representation.
func _initialize() -> void:
    var folders := DirAccess.get_directories_at("res://nes_assets")
    var root := ""
    for folder in folders:
        var candidate := "res://nes_assets/" + folder + "/tile_catalog/"
        if FileAccess.file_exists(candidate + "tileset.tres"):
            root = candidate
            break
    if root.is_empty():
        _fail("No TileSet export directory was found.")
        return
    var image := load(root + "tileset_atlas.png") as Texture2D
    var tileset := load(root + "tileset.tres") as TileSet
    if image == null or tileset == null:
        _fail("Could not load PNG or TileSet resource.")
        return
    if image.get_size() != Vector2(128, 8):
        _fail("Wrong atlas dimensions.")
        return
    if tileset.tile_size != Vector2i(8, 8) or tileset.get_source_count() != 1:
        _fail("TileSet tile size / source count mismatch.")
        return
    var atlas := tileset.get_source(0) as TileSetAtlasSource
    if atlas == null or atlas.get_tiles_count() != 4 or atlas.texture_region_size != Vector2i(8, 8):
        _fail("Atlas source type, count or region size mismatch.")
        return
    for x in range(4):
        if not atlas.has_tile(Vector2i(x, 0)):
            _fail("Missing tile at " + str(x))
            return
        if atlas.get_tile_texture_region(Vector2i(x, 0)) != Rect2i(x * 8, 0, 8, 8):
            _fail("Wrong atlas region at " + str(x))
            return
    print("PASS: native TileSet with 4 indexed 8x8 tiles and exact texture regions")
    quit(0)

func _fail(message: String) -> void:
    push_error(message)
    quit(1)
