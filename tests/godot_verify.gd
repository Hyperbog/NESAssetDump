extends SceneTree
# Called by CI after importing the synthetic sprite export project in headless Godot.
func _initialize() -> void:
    var dir := "res://nes_assets/SyntheticCHR_Hero"
    var sheet := load(dir + "/sprite_sheet.png") as Texture2D
    var sprite_frames := load(dir + "/sprite_frames.tres") as SpriteFrames
    var packed := load(dir + "/sprite_scene.tscn") as PackedScene
    if sheet == null or sprite_frames == null or packed == null:
        _fail("Unable to import PNG, SpriteFrames resource, or AnimatedSprite2D scene.")
        return
    if sheet.get_width() != 128 or sheet.get_height() != 32:
        _fail("Sprite sheet texture dimensions differ from expected 128x32.")
        return
    if sprite_frames.get_animation_names().size() != 2:
        _fail("Expected exactly two named animations.")
        return
    for name in ["idle", "walk"]:
        if not sprite_frames.has_animation(name) or sprite_frames.get_frame_count(name) != 2:
            _fail("Missing or incomplete animation: " + name)
            return
    if not is_equal_approx(sprite_frames.get_animation_speed("idle"), 7.0) or not is_equal_approx(sprite_frames.get_animation_speed("walk"), 12.0):
        _fail("Animation FPS was not preserved.")
        return
    if sprite_frames.get_animation_loop("idle") or not sprite_frames.get_animation_loop("walk"):
        _fail("Independent looping settings were not preserved.")
        return
    var instance := packed.instantiate()
    if not instance is AnimatedSprite2D:
        _fail("Exported scene is not an AnimatedSprite2D node.")
        return
    if instance.animation != &"idle" or instance.sprite_frames == null:
        instance.free()
        _fail("Exported scene did not link to the idle SpriteFrames resource.")
        return
    instance.free()
    print("PASS: Godot imported PNG, 2 animations, frame counts, FPS, looping, and AnimatedSprite2D scene")
    quit(0)

func _fail(message: String) -> void:
    push_error(message)
    quit(1)