extends SceneTree
func _initialize() -> void:
    var root := ""
    for folder in DirAccess.get_directories_at("res://nes_assets"):
        var candidate := "res://nes_assets/" + folder + "/sprites_8x16/bank_000/"
        if FileAccess.file_exists(candidate + "sprite_pairs.tres"):
            root = candidate
            break
    if root.is_empty():
        _fail("Missing NES 8x16 candidate TileSet")
        return
    var image := load(root + "sprite_pairs.png") as Texture2D
    var tileset := load(root + "sprite_pairs.tres") as TileSet
    if image == null or tileset == null:
        _fail("Could not import candidate atlas or native TileSet")
        return
    if image.get_size() != Vector2(128,256):
        _fail("Incorrect image dimensions")
        return
    if tileset.tile_size != Vector2i(8,16) or tileset.get_source_count() != 1:
        _fail("Incorrect 8x16 TileSet size or source count")
        return
    var atlas := tileset.get_source(0) as TileSetAtlasSource
    if atlas == null or atlas.texture_region_size != Vector2i(8,16) or atlas.get_tiles_count() != 256:
        _fail("Incorrect native atlas source or tile count")
        return
    for pos in [Vector2i(0,0),Vector2i(1,0),Vector2i(15,15)]:
        if not atlas.has_tile(pos) or atlas.get_tile_texture_region(pos) != Rect2i(pos.x*8,pos.y*16,8,16):
            _fail("Tile region mismatch at " + str(pos))
            return
    print("PASS: Godot imported 256 hardware-style 8x16 sprite pairs")
    quit(0)
func _fail(message: String) -> void:
    push_error(message)
    quit(1)
