# Run by server/blender-bridge.mjs:  blender -b scene.blend --python export_glb.py -- out.glb
# Exports the open scene as binary glTF with materials and animations, which
# both Roblox (via FBX/glTF importers) and web renderers can load.
import sys
import bpy

out = sys.argv[sys.argv.index("--") + 1]
bpy.ops.export_scene.gltf(filepath=out, export_format="GLB", export_apply=True, export_animations=True, export_materials="EXPORT")
print(f"exported {out}")
