# Builds the Agent Office roster as stylised low-poly sci-fi 3D characters,
# renders a 3/4 portrait of each, exports each as .glb and renders a lineup.
#
# Run by server/blender-bridge.mjs (or by hand):
#   blender --background --factory-startup --python tools/blender/build_characters.py -- roster.json out_dir
# It also runs with the `bpy` Python module:
#   python3 tools/blender/build_characters.py -- roster.json out_dir
#
# Options after the two paths: --engine auto|cycles|eevee  --samples N  --no-glb  --no-lineup  --no-blend
#   --sprites       also render <id>_sprites.webp: an 8-frame strip (idle, walk0-3, sit, talk, work),
#                   each frame 128x192, same orthographic 3/4 camera and scale for every character
#   --sprites-only  only the sprite strips (no portraits, .glb, lineup or .blend)
#
# roster.json: { "characters": [ { "id": "agent_orion", "name": "ORION", "title": "President",
#                                  "appearance": { ...Appearance from src/model/types.ts } } ] }
# Writes <id>.png (512x768, transparent), <id>.glb and lineup.png into out_dir, then prints one
# JSON line: {"ok":true,"outputs":[...file names relative to out_dir...], ...}.
# Every appearance field is optional; unknown values fall back to defaults instead of failing.
import sys
import os
import re
import json
import math
import time
import subprocess
import tempfile

import bpy
import bmesh
from mathutils import Vector, Matrix, Euler

MAX_CHARACTERS = 60
ID_RE = re.compile(r'^[A-Za-z0-9_-]{1,64}$')
PORTRAIT = (512, 768)

# ------------------------------------------------------------------ arguments

def parse_args(argv):
    args = argv[argv.index('--') + 1:] if '--' in argv else argv[1:]
    opts = {'engine': os.environ.get('AGENT_OFFICE_RENDER_ENGINE', 'auto'), 'samples': 24, 'glb': True, 'lineup': True}
    pos = []
    i = 0
    while i < len(args):
        a = args[i]
        if a == '--engine' and i + 1 < len(args):
            opts['engine'] = args[i + 1]; i += 2; continue
        if a == '--samples' and i + 1 < len(args):
            try: opts['samples'] = max(1, min(512, int(args[i + 1])))
            except ValueError: pass
            i += 2; continue
        if a == '--no-glb': opts['glb'] = False
        elif a == '--no-lineup': opts['lineup'] = False
        elif a == '--no-blend': opts['blend'] = False
        elif a == '--sprites': opts['sprites'] = True
        elif a == '--sprites-only': opts['sprites'] = opts['sprites_only'] = True
        else: pos.append(a)
        i += 1
    if len(pos) < 2:
        raise SystemExit('usage: build_characters.py -- <roster.json> <out_dir> [--engine auto|cycles|eevee] [--samples N]')
    return pos[0], pos[1], opts

# ------------------------------------------------------------------ appearance

DEFAULTS = {
    'height': 1.0, 'build': 'average', 'skinTone': '#c68e5f', 'faceShape': 'oval', 'eyeStyle': 'almond', 'eyeColor': '#2b1d10',
    'brows': 'thin', 'hairStyle': 'short', 'hairColor': '#2a1d14', 'facialHair': 'none', 'top': 'uniform', 'topColor': '#1d3b4f',
    'bottom': 'pants', 'bottomColor': '#1b1f26', 'shoes': 'sneakers', 'shoeColor': '#20242a', 'headwear': 'none',
    'headwearColor': '#39ff88', 'glasses': 'none', 'jewelry': 'none', 'equipment': 'none', 'accent': '#39ff88',
    'trimColor': '', 'faceMarkings': 'none', 'robotic': 'none', 'shoulders': 'none', 'gloves': 'none', 'gloveColor': '#2a2f33',
    'belt': 'none', 'accessories': [], 'idlePose': 'stand',
}
ENUMS = {
    'build': {'slim', 'average', 'broad'}, 'faceShape': {'round', 'oval', 'square'}, 'eyeStyle': {'dot', 'almond', 'wide', 'visor'},
    'brows': {'none', 'thin', 'thick', 'angled'}, 'hairStyle': {'bald', 'buzz', 'short', 'long', 'bun', 'ponytail', 'mohawk', 'curly'},
    'facialHair': {'none', 'stubble', 'beard', 'mustache'},
    'top': {'tshirt', 'hoodie', 'suit', 'labcoat', 'coverall', 'uniform', 'vest', 'jacket', 'robe', 'armor', 'longcoat'},
    'bottom': {'pants', 'shorts', 'skirt'}, 'shoes': {'sneakers', 'boots', 'dress'},
    'headwear': {'none', 'cap', 'hardhat', 'helmet', 'beanie', 'headset', 'mask', 'full-helmet'},
    'glasses': {'none', 'round', 'square', 'visor', 'ar-glasses'}, 'jewelry': {'none', 'earrings', 'necklace', 'badge'},
    'equipment': {'none', 'tablet', 'wrench', 'clipboard', 'laptop', 'toolbelt', 'briefcase', 'drafting-tablet', 'holo-catalog'},
    'faceMarkings': {'none', 'freckles', 'scar', 'tattoo', 'circuit'}, 'robotic': {'none', 'eyepiece', 'jaw', 'half-face', 'full'},
    'shoulders': {'none', 'pads', 'metallic', 'armored'}, 'gloves': {'none', 'work', 'tech', 'formal'},
    'belt': {'none', 'belt', 'harness', 'utility'}, 'idlePose': {'stand', 'arms-crossed', 'hands-hips'},
}
COLOR_KEYS = {'skinTone', 'eyeColor', 'hairColor', 'topColor', 'bottomColor', 'shoeColor', 'headwearColor', 'accent', 'trimColor', 'gloveColor'}
HEX_RE = re.compile(r'^#?([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$')


def norm_hex(v):
    if not isinstance(v, str): return None
    m = HEX_RE.match(v.strip())
    if not m: return None
    h = m.group(1)
    if len(h) == 3: h = ''.join(c * 2 for c in h)
    return '#' + h.lower()


class Look:
    """Appearance with every field validated and defaulted."""
    def __init__(self, raw):
        raw = raw if isinstance(raw, dict) else {}
        for k, d in DEFAULTS.items():
            v = raw.get(k, d)
            if k in ENUMS: v = v if v in ENUMS[k] else d
            elif k in COLOR_KEYS: v = norm_hex(v) or norm_hex(d)
            elif k == 'height':
                try: v = min(1.15, max(0.85, float(v)))
                except (TypeError, ValueError): v = 1.0
            elif k == 'accessories':
                v = [x for x in v if isinstance(x, str)][:16] if isinstance(v, list) else []
            setattr(self, k, v)
        if not self.trimColor: self.trimColor = self.accent
        fx = raw.get('effects') if isinstance(raw.get('effects'), dict) else {}
        self.fx = {k: bool(fx.get(k, False)) for k in ('aura', 'holoOutline', 'eyeGlow', 'particles', 'energyAccents', 'robotics')}
        try: self.intensity = min(1.0, max(0.0, float(fx.get('intensity', 0.4))))
        except (TypeError, ValueError): self.intensity = 0.4

    def has(self, acc): return acc in self.accessories


def shade(hexc, amt):
    """Same lighten/darken rule as src/characters/color.ts."""
    h = norm_hex(hexc) or '#808080'
    n = int(h[1:], 16)
    out = []
    for c in ((n >> 16) & 255, (n >> 8) & 255, n & 255):
        c = c * (1 + amt) if amt < 0 else c + (255 - c) * amt
        out.append(max(0, min(255, round(c))))
    return '#%02x%02x%02x' % tuple(out)


def mix(a, b, t):
    ha, hb = int((norm_hex(a) or '#808080')[1:], 16), int((norm_hex(b) or '#808080')[1:], 16)
    ca = [(ha >> s) & 255 for s in (16, 8, 0)]; cb = [(hb >> s) & 255 for s in (16, 8, 0)]
    return '#%02x%02x%02x' % tuple(round(x + (y - x) * t) for x, y in zip(ca, cb))


def lin(hexc):
    h = norm_hex(hexc) or '#808080'
    def ch(c):
        c = c / 255.0
        return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4
    return (ch(int(h[1:3], 16)), ch(int(h[3:5], 16)), ch(int(h[5:7], 16)), 1.0)

# ------------------------------------------------------------------ materials

_mats = {}

def _set(node, names, value):
    for n in names:
        s = node.inputs.get(n)
        if s is not None:
            try: s.default_value = value
            except (TypeError, ValueError): pass
            return


def mat(hexc, kind='cloth', emit=0.0):
    """kind: cloth | skin | hair | metal | gloss | plastic | glow | screen | eye | dark"""
    key = (norm_hex(hexc) or '#808080', kind, round(emit, 2))
    if key in _mats: return _mats[key]
    m = bpy.data.materials.new('%s_%s' % (kind, key[0][1:]))
    if bpy.app.version < (5, 0, 0):   # node materials are always on from 5.0 (use_nodes is deprecated)
        m.use_nodes = True
    b = next((n for n in m.node_tree.nodes if n.type == 'BSDF_PRINCIPLED'), None)
    if b is None:
        b = m.node_tree.nodes.new('ShaderNodeBsdfPrincipled')
    col = lin(hexc)
    rough, metal, coat = {
        'cloth': (0.78, 0.0, 0.0), 'skin': (0.5, 0.0, 0.0), 'hair': (0.55, 0.0, 0.0), 'metal': (0.34, 0.75, 0.0), 'robot': (0.3, 0.45, 0.3),
        'gloss': (0.22, 0.0, 0.4), 'plastic': (0.4, 0.0, 0.0), 'glow': (0.3, 0.0, 0.0), 'screen': (0.15, 0.0, 0.6),
        'eye': (0.08, 0.0, 0.0), 'dark': (0.5, 0.2, 0.0),
    }.get(kind, (0.6, 0.0, 0.0))
    _set(b, ['Base Color'], col)
    _set(b, ['Roughness'], rough)
    _set(b, ['Metallic'], metal)
    _set(b, ['Coat Weight', 'Clearcoat'], coat)
    if kind == 'skin':
        _set(b, ['Subsurface Weight'], 0.08)
        _set(b, ['Subsurface Radius'], (0.6, 0.25, 0.15))
        _set(b, ['Subsurface Scale'], 0.02)
    if emit > 0:
        _set(b, ['Emission Color', 'Emission'], col)
        _set(b, ['Emission Strength'], emit)
    m.diffuse_color = col
    _mats[key] = m
    return m

# ------------------------------------------------------------------ mesh helpers

class Builder:
    def __init__(self, coll, root):
        self.coll, self.root, self.count = coll, root, 0
        self.group = 'body'   # which rig part new objects belong to (see Figure.rig)
        self.parts = {}

    def add(self, name, bm, material, smooth=True):
        me = bpy.data.meshes.new(name)
        bm.normal_update()
        bm.to_mesh(me); bm.free()
        if smooth:
            try: me.shade_smooth()
            except AttributeError:
                for p in me.polygons: p.use_smooth = True
        me.materials.append(material)
        ob = bpy.data.objects.new('%s.%s' % (self.root.name, name), me)
        self.coll.objects.link(ob)
        ob.parent = self.root
        self.parts.setdefault(self.group, []).append(ob)
        self.count += 1
        return ob


def xf(bm, M):
    bmesh.ops.transform(bm, matrix=M, verts=bm.verts[:])
    return bm


def place(bm, loc=(0, 0, 0), rot=(0, 0, 0), scale=(1, 1, 1)):
    M = Matrix.Translation(Vector(loc)) @ Euler(rot).to_matrix().to_4x4() @ Matrix.Diagonal(Vector((*scale, 1.0)))
    return xf(bm, M)


def sphere(r=1.0, seg=24, rings=15):
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=seg, v_segments=rings, radius=r)
    return bm


def rbox(sx, sy, sz, r=0.03, cuts=11, taper=None):
    """Rounded box centred on the origin. taper=(sx_bottom_factor, sy_bottom_factor) narrows the -Z end."""
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=2.0)
    bmesh.ops.subdivide_edges(bm, edges=bm.edges[:], cuts=cuts, use_grid_fill=True)
    hs = (sx / 2, sy / 2, sz / 2)
    r = max(0.0005, min(r, *hs))
    inner = [h - r for h in hs]
    for v in bm.verts:
        p = []
        for c, h, i in zip(v.co, hs, inner):
            a = min(1.0, abs(c))
            m = a / 0.5 * i if a <= 0.5 else i + (a - 0.5) / 0.5 * r
            p.append(math.copysign(m, c))
        p = Vector(p)
        q = Vector([max(-i, min(i, c)) for c, i in zip(p, inner)])
        d = p - q
        if d.length > 1e-9: p = q + d.normalized() * r
        v.co = p
    if taper:
        for v in bm.verts:
            t = (v.co.z + hs[2]) / (2 * hs[2])
            v.co.x *= taper[0] + (1 - taper[0]) * t
            v.co.y *= taper[1] + (1 - taper[1]) * t
    bmesh.ops.remove_doubles(bm, verts=bm.verts[:], dist=1e-5)
    return bm


def capsule(p0, p1, r, seg=16, rings=11):
    p0, p1 = Vector(p0), Vector(p1)
    d = p1 - p0
    L = d.length
    bm = sphere(r, seg, rings)
    for v in bm.verts:
        v.co.z += L / 2 if v.co.z > 0 else -L / 2
    q = d.normalized().to_track_quat('Z', 'Y') if L > 1e-6 else Euler().to_quaternion()
    return xf(bm, Matrix.Translation((p0 + p1) / 2) @ q.to_matrix().to_4x4())


def cyl(r1, r2, depth, seg=24, caps=True):
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=caps, cap_tris=False, segments=seg, radius1=r1, radius2=r2, depth=depth)
    return bm


def torus(R, r, seg=32, rseg=10, arc=2 * math.pi, start=0.0):
    """Torus in the XY plane; a partial arc when arc < 2pi (ends are capped)."""
    bm = bmesh.new()
    closed = arc >= 2 * math.pi - 1e-6
    n = seg if closed else seg + 1
    rings = []
    for i in range(n):
        a = start + arc * i / seg
        c, s = math.cos(a), math.sin(a)
        ring = []
        for j in range(rseg):
            b = 2 * math.pi * j / rseg
            rr = R + r * math.cos(b)
            ring.append(bm.verts.new((rr * c, rr * s, r * math.sin(b))))
        rings.append(ring)
    for i in range(n if closed else n - 1):
        A, B = rings[i], rings[(i + 1) % n]
        for j in range(rseg):
            bm.faces.new((A[j], B[j], B[(j + 1) % rseg], A[(j + 1) % rseg]))
    if not closed:
        bm.faces.new(rings[0][::-1]); bm.faces.new(rings[-1])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    return bm


def shell(r, zlo=-1.0, zhi=1.0, az=(-math.pi, math.pi), thickness=0.012, scale=(1, 1, 1), seg=40, rings=14):
    """A smooth-edged patch of a sphere. Azimuth 0 faces front (-Y), +pi/2 faces +X.
    zlo/zhi (unit-sphere heights) may be functions of the azimuth, so hairlines and visors get clean edges."""
    f_lo = zlo if callable(zlo) else (lambda _a, v=zlo: v)
    f_hi = zhi if callable(zhi) else (lambda _a, v=zhi: v)
    full = az[1] - az[0] >= 2 * math.pi - 1e-6
    cols = seg if full else seg + 1
    pole = full and f_hi(0.0) >= 0.999
    bm = bmesh.new()
    grid = []
    for j in range(cols):
        a = az[0] + (az[1] - az[0]) * j / seg
        lo = math.asin(max(-0.999, min(0.999, f_lo(a))))
        hi = math.asin(max(-0.999, min(0.999, f_hi(a))))
        col = []
        for k in range(rings + 1):
            lat = lo + (hi - lo) * k / rings
            c = math.cos(lat)
            col.append(bm.verts.new((math.sin(a) * c * r * scale[0], -math.cos(a) * c * r * scale[1], math.sin(lat) * r * scale[2])))
        grid.append(col)
    for j in range(cols if full else cols - 1):
        A, Bc = grid[j], grid[(j + 1) % cols]
        for k in range(rings):
            bm.faces.new((A[k], Bc[k], Bc[k + 1], A[k + 1]))
    if pole:
        top = bm.verts.new((0, 0, r * scale[2]))
        for j in range(cols):
            bm.faces.new((grid[j][-1], grid[(j + 1) % cols][-1], top))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    # outward normals: flip if they point inwards
    f0 = bm.faces[0]
    f0.normal_update()
    if f0.normal.dot(f0.calc_center_median()) < 0:
        bmesh.ops.reverse_faces(bm, faces=bm.faces[:])
    if thickness:
        bmesh.ops.solidify(bm, geom=bm.faces[:], thickness=thickness)
    return bm


def lerp(a, b, t): return a + (b - a) * t

def hairline(front_z, back_z, side_z=None):
    """Edge height around the head: front at azimuth 0, sides at +-pi/2, back at +-pi (smoothstep between)."""
    side_z = (front_z + back_z) / 2 if side_z is None else side_z
    def f(az):
        t = min(1.0, abs(az) / math.pi)
        if t < 0.5:
            u = t / 0.5; u = u * u * (3 - 2 * u)
            return lerp(front_z, side_z, u)
        u = (t - 0.5) / 0.5; u = u * u * (3 - 2 * u)
        return lerp(side_z, back_z, u)
    return f

# ------------------------------------------------------------------ character

HELD = ('tablet', 'clipboard', 'laptop', 'drafting-tablet', 'holo-catalog', 'wrench')   # carried in front, right hand
BUILD = {'slim': (0.30, 0.19, 0.047, 0.066), 'average': (0.35, 0.21, 0.053, 0.074), 'broad': (0.43, 0.26, 0.066, 0.088)}
HEAD_Z, HEAD_R = 1.19, 0.215
HIP_Z, KNEE_Z, SKIRT_Z = 0.5, 0.29, 0.62   # rig pivots (character space, before the height scale)


class Figure:
    def __init__(self, B, a):
        self.B, self.a = B, a
        self.W, self.D, self.arm_r, self.leg_r = BUILD[a.build]
        self.robot = a.robotic == 'full'
        self.skin = '#c3cad2' if self.robot else a.skinTone
        self.skin_kind = 'robot' if self.robot else 'skin'
        self.glow = 2.2 + 3.0 * a.intensity if a.fx['energyAccents'] else 1.6 + 1.2 * a.intensity
        fs = {'round': (1.02, 0.98, 0.96), 'oval': (0.93, 0.92, 1.05), 'square': (1.0, 0.95, 0.98)}[a.faceShape]
        self.hs = fs  # head scale
        self.hand_l = self.hand_r = None
        self.chest_y = -self.D / 2

    # surface point on the head (front is -Y); x, z relative to head centre, as fraction of radius
    def head_pt(self, fx, fz, out=0.0):
        R = HEAD_R
        sx, sy, sz = self.hs
        u, w = fx, fz
        y2 = max(0.0, 1 - u * u - w * w)
        return Vector((u * R * sx, -math.sqrt(y2) * R * sy - out, HEAD_Z + w * R * sz))

    def build(self):
        a = self
        self.legs(); self.torso(); self.arms(); self.head()
        self.top_details(); self.belt(); self.shoulders(); self.headwear(); self.glasses()
        self.equipment(); self.accessories(); self.robotics(); self.effects()
        self.rig()

    def rig(self):
        """Parent limbs to joint empties (body > shoulder > elbow, body > hip > knee, body > skirt) so the
        figure can be posed by rotating them. At rest nothing moves: the geometry is baked in root space."""
        B, root, pv = self.B, self.B.root, self.pivots
        pv['body'] = Vector((0, 0, 0))
        pv['skirt'] = Vector((0, 0, SKIRT_Z))
        parent_of = {'body': None, 'skirt': 'body'}
        for s in ('r', 'l'):
            parent_of.update({'shoulder_' + s: 'body', 'elbow_' + s: 'shoulder_' + s, 'hip_' + s: 'body', 'knee_' + s: 'hip_' + s})
        joints = {}
        for name in ('body', 'skirt', 'shoulder_r', 'shoulder_l', 'elbow_r', 'elbow_l', 'hip_r', 'hip_l', 'knee_r', 'knee_l'):
            e = bpy.data.objects.new('%s.pv.%s' % (root.name, name), None)
            e.empty_display_type = 'SPHERE'; e.empty_display_size = 0.03
            B.coll.objects.link(e)
            par = parent_of[name]
            e.parent = joints[par] if par else root
            e.location = pv[name] - (pv[par] if par else Vector((0, 0, 0)))
            e.rotation_mode = 'XYZ'
            joints[name] = e
        part_joint = {'body': 'body', 'skirt': 'skirt'}
        for s in ('r', 'l'):
            part_joint.update({'upper_' + s: 'shoulder_' + s, 'fore_' + s: 'elbow_' + s, 'thigh_' + s: 'hip_' + s, 'shin_' + s: 'knee_' + s})
        for part, obs in B.parts.items():
            j = part_joint.get(part, 'body')
            for ob in obs:
                ob.parent = joints[j]
                ob.matrix_parent_inverse = Matrix.Translation(-pv[j])
        self.joints = joints
        root['agent_office_rig'] = 1

    # ---- lower body
    def legs(self):
        a, B = self.a, self.B
        coverall = a.top == 'coverall'
        robe = a.top == 'robe'
        leg_col = a.topColor if coverall else a.bottomColor
        bare = a.bottom in ('shorts', 'skirt') and not coverall
        lx = self.W * 0.25
        boots = a.shoes == 'boots'
        self.pivots = getattr(self, 'pivots', {})
        for side in (-1, 1):
            x = side * lx
            s = 'r' if side < 0 else 'l'
            self.pivots['hip_' + s] = Vector((x, 0, HIP_Z))
            self.pivots['knee_' + s] = Vector((x, 0, KNEE_Z))
            B.group = 'thigh_' + s
            if bare:
                B.add('thigh', capsule((x, 0, KNEE_Z), (x, 0, 0.46), self.leg_r * 0.86), mat(self.skin, self.skin_kind))
                if a.bottom == 'shorts':
                    B.add('shorts', capsule((x, 0, 0.32), (x, 0, 0.5), self.leg_r * 1.08), mat(leg_col))
                B.group = 'shin_' + s
                B.add('shin', capsule((x, 0, 0.1), (x, 0, KNEE_Z), self.leg_r * 0.84), mat(self.skin, self.skin_kind))
            else:
                B.add('thigh', capsule((x, 0, KNEE_Z), (x, 0, 0.5), self.leg_r), mat(leg_col))
                B.group = 'shin_' + s
                B.add('shin', capsule((x, 0, 0.1), (x, 0, KNEE_Z), self.leg_r * 0.97), mat(leg_col))
            # shoes
            col = a.shoeColor
            if a.shoes == 'dress':
                B.add('shoe', place(rbox(self.leg_r * 2.2, 0.2, 0.07, 0.032), (x, -0.035, 0.035)), mat(col, 'gloss'))
            elif boots:
                B.add('boot', place(rbox(self.leg_r * 2.45, 0.21, 0.09, 0.035), (x, -0.035, 0.045)), mat(col, 'plastic'))
                B.add('bootcuff', place(cyl(self.leg_r * 1.22, self.leg_r * 1.12, 0.13, 20), (x, 0.0, 0.14)), mat(col, 'plastic'))
                B.add('bootband', place(cyl(self.leg_r * 1.26, self.leg_r * 1.26, 0.018, 20), (x, 0.0, 0.18)), mat(a.trimColor, 'glow', self.glow * 0.6))
            else:
                B.add('shoe', place(rbox(self.leg_r * 2.15, 0.19, 0.075, 0.034), (x, -0.03, 0.05)), mat(col, 'plastic'))
                B.add('sole', place(rbox(self.leg_r * 2.25, 0.2, 0.028, 0.012), (x, -0.03, 0.014)), mat(shade(col, 0.55) if col != '#ffffff' else '#c9d0d6', 'plastic'))
                B.add('stripe', place(rbox(self.leg_r * 2.22, 0.05, 0.012, 0.005), (x, -0.015, 0.058)), mat(a.accent, 'glow', self.glow * 0.5))
            B.group = 'body'
        if a.bottom == 'skirt' and not coverall and not robe:
            B.group = 'skirt'
            B.add('skirt', place(cyl(self.W * 0.5, self.W * 0.66, 0.2, 28), (0, 0, 0.42), scale=(1, self.D / self.W * 1.25, 1)), mat(a.bottomColor))
        B.group = 'body'
        # hips
        hip_col = a.topColor if coverall else a.bottomColor
        B.add('hips', place(rbox(self.W * 0.98, self.D * 0.95, 0.14, 0.05), (0, 0, 0.53)), mat(hip_col))

    # ---- torso and the long garments
    def torso(self):
        a, B = self.a, self.B
        W, D = self.W, self.D
        bulk = 1.06 if a.top in ('jacket', 'hoodie', 'armor', 'longcoat') else 1.0
        self.tW, self.tD = W * bulk, D * bulk
        B.add('torso', place(rbox(W * bulk, D * bulk, 0.42, 0.075, taper=(0.86, 0.92)), (0, 0, 0.75)), mat(a.topColor))
        self.chest_y = -D * bulk / 2
        # neck
        B.add('neck', place(cyl(0.05, 0.055, 0.12, 16), (0, 0, 0.98)), mat(self.skin, self.skin_kind))
        B.group = 'skirt'   # long garments fold up when sitting
        if a.top == 'robe':
            B.add('robe', place(cyl(W * 0.5, W * 0.8, 0.66, 32), (0, 0, 0.42), scale=(1, D / W * 1.3, 1)), mat(a.topColor))
            B.add('hem', place(torus(W * 0.82, 0.014, 40, 8), (0, 0, 0.095), scale=(1, D / W * 1.3, 1)), mat(a.trimColor, 'glow', self.glow * 0.7))
        if a.top in ('labcoat', 'longcoat'):
            bottom = 0.3 if a.top == 'labcoat' else 0.16
            h = 0.6 - bottom
            col = a.topColor
            for side in (-1, 1):
                B.add('coatpanel', place(rbox(W * 0.52, D * 1.08, h, 0.03, taper=(1.07, 1.04)), (side * W * 0.255, 0, bottom + h / 2)), mat(col))
            B.add('coatback', place(rbox(W * 1.02, 0.04, h, 0.02, taper=(1.06, 1)), (0, D * 0.52, bottom + h / 2)), mat(col))
            if a.top == 'longcoat':
                for side in (-1, 1):
                    B.add('coattrim', place(rbox(0.012, 0.012, h + 0.36, 0.005), (side * 0.035, -D * 0.56, bottom + (h + 0.36) / 2)), mat(a.trimColor, 'glow', self.glow * 0.7))
        B.group = 'body'

    # ---- arms; one arm bends forward to hold equipment
    def arms(self):
        a, B = self.a, self.B
        sx = self.tW / 2 + self.arm_r * 0.75
        top_z = 0.9
        holds = a.equipment in HELD
        self.pivots = getattr(self, 'pivots', {})
        sleeve = shade(a.topColor, 0.35) if a.top == 'vest' else a.topColor
        hand = a.gloveColor if a.gloves != 'none' else self.skin
        hand_kind = {'formal': 'gloss', 'tech': 'plastic', 'work': 'cloth'}.get(a.gloves, self.skin_kind)
        for side in (-1, 1):
            sh = Vector((side * sx, 0.0, top_z))
            if holds and side == -1:   # character's right arm (viewer's left) holds the item in front
                elbow = Vector((side * (sx + 0.015), 0.02, 0.69))
                hand_p = Vector((side * (sx - 0.04), -0.2, 0.71))
            elif a.idlePose == 'hands-hips':
                elbow = Vector((side * (sx + 0.1), 0.02, 0.7))
                hand_p = Vector((side * (sx - 0.005), 0.0, 0.56))
            else:
                elbow = Vector((side * (sx + 0.03), 0.01, 0.69))
                hand_p = Vector((side * (sx + 0.04), -0.01, 0.49))
            fore_col = self.skin if a.top == 'tshirt' else sleeve
            upper_col = sleeve
            r = self.arm_r * (1.25 if a.top == 'robe' else 1.0)
            s = 'r' if side < 0 else 'l'
            self.pivots['shoulder_' + s], self.pivots['elbow_' + s] = sh.copy(), elbow.copy()
            B.group = 'upper_' + s
            B.add('upperarm', capsule(sh, elbow, r), mat(upper_col))
            if a.top == 'tshirt':
                B.add('sleeve', capsule(sh, sh.lerp(elbow, 0.55), self.arm_r * 1.12), mat(a.topColor))
            B.group = 'fore_' + s
            if a.top == 'tshirt':
                B.add('forearm', capsule(elbow, hand_p, self.arm_r * 0.85), mat(self.skin, self.skin_kind))
            else:
                B.add('forearm', capsule(elbow, hand_p, r * 0.95), mat(fore_col))
                cuff = elbow.lerp(hand_p, 0.82)
                d = (hand_p - elbow).normalized()
                q = d.to_track_quat('Z', 'Y').to_matrix().to_4x4()
                cuff_col = a.trimColor if a.top in ('uniform', 'longcoat', 'robe') else shade(fore_col, -0.3)
                cuff_kind = 'glow' if a.top in ('uniform', 'longcoat', 'robe') else 'cloth'
                B.add('cuff', xf(cyl(r * 1.02, r * 1.02, 0.03, 20), Matrix.Translation(cuff) @ q), mat(cuff_col, cuff_kind, self.glow * 0.6 if cuff_kind == 'glow' else 0))
            hp = hand_p + (hand_p - elbow).normalized() * 0.05
            B.add('hand', place(sphere(0.052, 16, 11), hp, scale=(0.9, 1.0, 1.1)), mat(hand, hand_kind))
            if a.gloves == 'tech':
                B.add('glovedot', place(sphere(0.012, 10, 7), hp + Vector((0, -0.045, 0.01))), mat(a.accent, 'glow', self.glow))
            if side == -1: self.hand_r, self.elbow_r = hp, elbow
            else: self.hand_l, self.elbow_l = hp, elbow
        B.group = 'body'

    # ---- head, face and hair
    def head(self):
        a, B = self.a, self.B
        R = HEAD_R
        sx, sy, sz = self.hs
        bm = sphere(R, 32, 21)
        if a.faceShape == 'square':  # flatten the jaw a little
            for v in bm.verts:
                if v.co.z < 0: v.co.x = math.copysign(min(abs(v.co.x) * 1.08, R * 0.98), v.co.x)
        B.add('head', place(bm, (0, 0, HEAD_Z), scale=self.hs), mat(self.skin, self.skin_kind))
        for side in (-1, 1):  # ears
            B.add('ear', place(sphere(0.045, 12, 9), (side * R * sx * 0.97, 0.01, HEAD_Z - 0.01), scale=(0.5, 0.8, 1.1)), mat(self.skin, self.skin_kind))
        # eyes
        eye_glow = a.fx['eyeGlow'] or self.robot
        if a.eyeStyle == 'visor':
            self.visor_band(a.accent, 0.03, 0.06)
        else:
            for side in (-1, 1):
                p = self.head_pt(side * 0.36, 0.02, -0.004)
                if a.eyeStyle == 'wide':
                    B.add('sclera', place(sphere(0.034, 16, 11), p, scale=(1, 0.5, 0.85)), mat('#f4f4ef', 'eye'))
                    B.add('iris', place(sphere(0.02, 14, 9), p + Vector((0, -0.014, 0))), mat(a.eyeColor, 'eye', 3.0 if eye_glow else 0))
                else:
                    sc = (1.25, 0.55, 0.8) if a.eyeStyle == 'almond' else (0.85, 0.55, 0.95)
                    B.add('eye', place(sphere(0.026, 16, 11), p, scale=sc), mat(a.eyeColor, 'eye', 3.0 if eye_glow else 0))
                B.add('glint', place(sphere(0.007, 8, 5), p + Vector((0.008, -0.013, 0.008))), mat('#ffffff', 'eye', 2.0))
                if a.brows != 'none' and not self.robot:
                    bp = self.head_pt(side * 0.36, 0.22, -0.002)
                    th = 0.016 if a.brows == 'thick' else 0.009
                    rot = (0, side * (0.3 if a.brows == 'angled' else 0.06), 0)
                    B.add('brow', place(rbox(0.07, 0.016, th, th / 2.2), bp, rot=rot), mat(shade(a.hairColor, -0.1), 'hair'))
        # nose and mouth
        if not self.robot:
            B.add('nose', place(sphere(0.022, 12, 9), self.head_pt(0, -0.14, -0.012), scale=(0.8, 0.9, 1)), mat(shade(self.skin, -0.06), 'skin'))
            mp = self.head_pt(0, -0.38, 0.0)
            B.add('mouth', place(torus(0.03, 0.006, 16, 6, arc=math.pi * 0.7, start=math.pi * 1.15), mp + Vector((0, 0, 0.022)), rot=(math.pi / 2 - 0.3, 0, 0)), mat(shade(self.skin, -0.42), 'skin'))
        # face markings
        fm = a.faceMarkings
        if fm == 'circuit' or fm == 'tattoo':
            col, kind, e = (a.accent, 'glow', self.glow) if fm == 'circuit' else (shade(self.skin, -0.5), 'skin', 0)
            for (fx, fz, rz) in ((0.52, -0.12, 0.0), (0.6, -0.25, 1.1), (0.45, -0.32, 0.0)):
                B.add('mark', place(rbox(0.05, 0.008, 0.007, 0.003), self.head_pt(fx, fz, -0.001), rot=(0, rz, -0.5)), mat(col, kind, e))
        elif fm == 'scar':
            B.add('scar', place(rbox(0.012, 0.008, 0.09, 0.004), self.head_pt(-0.42, 0.06, -0.001), rot=(0, 0.35, 0.4)), mat(shade(self.skin, -0.3), 'skin'))
        elif fm == 'freckles':
            for side in (-1, 1):
                for (fx, fz) in ((0.32, -0.16), (0.42, -0.12), (0.37, -0.22)):
                    B.add('freckle', place(sphere(0.006, 8, 5), self.head_pt(side * fx, fz)), mat(shade(self.skin, -0.3), 'skin'))
        self.hair()
        self.facial_hair()

    def visor_band(self, col, z0, h, strength=None):
        """Curved glowing visor band across the eyes, following the head."""
        R = HEAD_R * 1.1
        sx, sy, sz = self.hs
        zc = z0 / R
        bm = shell(R, zc - h / R / 2, zc + h / R / 2, az=(-1.25, 1.25), thickness=0.01, scale=(sx, sy, sz), seg=32, rings=3)
        place(bm, (0, -0.004, HEAD_Z))
        self.B.add('visor', bm, mat(col, 'glow', strength if strength is not None else self.glow + 1.0))

    def hair(self):
        a, B = self.a, self.B
        st = a.hairStyle
        if st == 'bald' or self.robot or a.headwear == 'full-helmet':
            return
        R = HEAD_R
        sx, sy, sz = self.hs
        col = a.hairColor
        hm = mat(col, 'hair')

        if st == 'buzz' or st == 'mohawk':
            m = mat(shade(col, 0.1) if st == 'buzz' else mix(col, self.skin, 0.72), 'hair')
            B.add('hair', place(shell(R * 1.012, hairline(0.5, -0.3, 0.15), thickness=0.006, scale=self.hs), (0, 0, HEAD_Z)), m)
            if st == 'mohawk':
                bm = sphere(1.0, 24, 15)
                for v in bm.verts:
                    v.co = Vector((v.co.x * 0.032, v.co.y * R * 0.95, max(v.co.z, -0.3) * 0.1))
                B.add('mohawk', place(bm, (0, 0.02, HEAD_Z + R * sz * 0.92), rot=(-0.25, 0, 0)), hm)
            return
        B.add('hair', place(shell(R * 1.05, hairline(0.42, -0.42, 0.0), thickness=0.022, scale=(sx, sy * 1.02, sz)), (0, 0, HEAD_Z)), hm)
        # fringe sweep
        B.add('fringe', place(sphere(R * 0.62, 24, 15), (R * 0.22, -R * 0.42, HEAD_Z + R * 0.66), rot=(0.5, 0.35, -0.3), scale=(1.0, 0.5, 0.42)), hm)
        if st == 'long':
            B.add('hairback', place(rbox(R * 1.95 * sx, 0.11, 0.42, 0.05, taper=(0.86, 1)), (0, R * 0.6, HEAD_Z - 0.12)), hm)
            for side in (-1, 1):
                B.add('lock', capsule((side * R * sx * 0.93, -0.02, HEAD_Z + 0.04), (side * R * sx * 0.9, 0.02, HEAD_Z - 0.29), 0.045), hm)
        elif st == 'bun':
            B.add('bun', place(sphere(0.085, 20, 13), (0, R * 0.35, HEAD_Z + R * sz * 1.02)), hm)
            B.add('bunband', place(torus(0.06, 0.012, 20, 6), (0, R * 0.3, HEAD_Z + R * sz * 0.94), rot=(-0.35, 0, 0)), mat(a.accent, 'glow', self.glow * 0.6))
        elif st == 'ponytail':
            top = Vector((0, R * 0.98, HEAD_Z + 0.08))
            B.add('tiebase', place(sphere(0.05, 16, 11), top), hm)
            B.add('tail', capsule(top + Vector((0, 0.04, -0.02)), Vector((0, R * 1.05, HEAD_Z - 0.25)), 0.042), hm)
            B.add('tieband', place(torus(0.045, 0.01, 16, 6), top + Vector((0, 0.03, -0.03)), rot=(1.2, 0, 0)), mat(a.accent, 'glow', self.glow * 0.6))
        elif st == 'curly':
            n = 0
            for ring_z, cnt in ((0.92, 1), (0.7, 6), (0.42, 10), (0.12, 12)):
                for k in range(cnt):
                    ang = 2 * math.pi * k / cnt + ring_z
                    rr = math.sqrt(max(0.0, 1 - ring_z * ring_z))
                    v = Vector((math.cos(ang) * rr, math.sin(ang) * rr, ring_z))
                    if v.y < -0.45 and ring_z < 0.5: continue  # keep the face clear
                    p = Vector((v.x * R * sx * 1.07, v.y * R * sy * 1.07, HEAD_Z + v.z * R * sz * 1.07))
                    B.add('curl', place(sphere(0.062, 14, 9), p), hm); n += 1

    def facial_hair(self):
        a, B = self.a, self.B
        if a.facialHair == 'none' or self.robot or a.headwear in ('mask', 'full-helmet'):
            return
        R = HEAD_R
        if a.facialHair in ('beard', 'stubble'):
            th = 0.02 if a.facialHair == 'beard' else 0.003
            rr = 1.05 if a.facialHair == 'beard' else 1.006
            col = a.hairColor if a.facialHair == 'beard' else mix(self.skin, a.hairColor, 0.38)
            top = lambda az: lerp(-0.5, 0.0, min(1.0, abs(az) / 1.4) ** 1.5)
            B.add('beard', place(shell(R * rr, -0.97, top, az=(-1.75, 1.75), thickness=th, scale=self.hs), (0, 0, HEAD_Z)), mat(col, 'hair'))
        if a.facialHair in ('beard', 'mustache'):
            p = self.head_pt(0, -0.27, -0.008)
            B.add('mustache', place(torus(0.045, 0.012, 16, 6, arc=math.pi * 0.8, start=math.pi * 0.1), p + Vector((0, 0, -0.03)), rot=(math.pi / 2, 0, 0)), mat(a.hairColor, 'hair'))

    # ---- garment details
    def top_details(self):
        a, B = self.a, self.B
        W, D, cy = self.tW, self.tD, self.chest_y
        g = self.glow
        top, tc = a.top, a.trimColor
        front = lambda x, z, out=0.0: Vector((x, cy - out, z))
        collar_col = shade(a.topColor, -0.25)
        if top == 'tshirt':
            B.add('collar', place(torus(0.062, 0.012, 24, 8), (0, 0, 0.955), scale=(1, 0.9, 1)), mat(collar_col))
            B.add('chestline', place(rbox(W * 0.6, 0.01, 0.012, 0.005), front(0, 0.82, 0.002)), mat(a.accent, 'glow', g * 0.6))
        elif top == 'hoodie':
            B.add('hood', place(torus(0.1, 0.045, 28, 10), (0, 0.035, 0.96), rot=(0.2, 0, 0), scale=(1.15, 1, 1)), mat(shade(a.topColor, -0.1)))
            B.add('pocket', place(rbox(W * 0.6, 0.02, 0.1, 0.02), front(0, 0.63, 0.002)), mat(shade(a.topColor, -0.15)))
            for side in (-1, 1):
                B.add('string', capsule(front(side * 0.03, 0.93, 0.01), front(side * 0.035, 0.82, 0.012), 0.006), mat('#e6e6e6', 'plastic'))
                B.add('stringtip', place(sphere(0.011, 8, 5), front(side * 0.035, 0.815, 0.014)), mat(a.accent, 'glow', g))
        elif top == 'suit':
            B.add('shirt', place(cyl(0.07, 0.0, 0.16, 3), front(0, 0.86, -0.002), rot=(math.pi, 0, math.pi / 2), scale=(0.5, 1, 1)), mat('#e9ecef', 'cloth'))
            for side in (-1, 1):
                B.add('lapel', place(rbox(0.035, 0.02, 0.2, 0.01), front(side * 0.055, 0.85, 0.004), rot=(0, side * 0.38, 0)), mat(shade(a.topColor, -0.3), 'gloss'))
            if not a.has('illuminated-tie'):
                self.tie(tc, 0)
            for i in range(2):
                B.add('button', place(sphere(0.011, 10, 7), front(0.0, 0.66 - i * 0.07, 0.006)), mat(tc, 'metal'))
        elif top == 'labcoat':
            B.add('innershirt', place(rbox(0.07, 0.02, 0.34, 0.01), front(0, 0.76, -0.004)), mat(shade(a.topColor, -0.55)))
            for side in (-1, 1):
                B.add('lapel', place(rbox(0.04, 0.02, 0.17, 0.01), front(side * 0.055, 0.86, 0.006), rot=(0, side * 0.35, 0)), mat(shade(a.topColor, -0.08)))
            B.add('pocket', place(rbox(0.07, 0.015, 0.06, 0.008), front(W * 0.27, 0.78, 0.004)), mat(shade(a.topColor, -0.12)))
            B.add('pen', capsule(front(W * 0.25, 0.79, 0.012), front(W * 0.25, 0.83, 0.012), 0.006), mat(a.accent, 'glow', g))
        elif top == 'coverall':
            for side in (-1, 1):
                B.add('pocket', place(rbox(0.08, 0.015, 0.07, 0.01), front(side * W * 0.25, 0.8, 0.004)), mat(shade(a.topColor, -0.2)))
            B.add('zip', place(rbox(0.012, 0.012, 0.36, 0.005), front(0, 0.76, 0.004)), mat(shade(a.topColor, -0.35), 'metal'))
            B.add('collar', place(torus(0.068, 0.016, 24, 8), (0, 0, 0.955)), mat(shade(a.topColor, -0.15)))
            B.add('stripe', place(rbox(W * 1.04, D * 1.04, 0.02, 0.01), (0, 0, 0.6)), mat(a.accent, 'glow', g * 0.6))
        elif top == 'uniform':
            B.add('band', place(rbox(W * 1.03, D * 1.04, 0.026, 0.012, taper=(0.99, 0.99)), (0, 0, 0.83)), mat(a.accent, 'glow', g))
            B.add('collar', place(cyl(0.068, 0.064, 0.05, 24), (0, 0, 0.965)), mat(tc, 'cloth'))
            B.add('placket', place(rbox(0.02, 0.012, 0.3, 0.006), front(0.04, 0.72, 0.003)), mat(shade(a.topColor, -0.3)))
            B.add('tab', place(rbox(0.06, 0.012, 0.035, 0.008), front(W * 0.27, 0.9, 0.004)), mat(a.accent, 'glow', g * 0.8))
        elif top == 'vest':
            for z in (0.8, 0.69):
                B.add('reflect', place(rbox(W * 1.04, D * 1.04, 0.028, 0.012), (0, 0, z)), mat(a.accent, 'glow', g * 0.8))
            B.add('vzip', place(rbox(0.035, 0.012, 0.4, 0.006), front(0, 0.75, 0.003)), mat(shade(a.topColor, 0.35)))
        elif top == 'jacket':
            B.add('collar', place(cyl(0.085, 0.075, 0.07, 24, caps=False), (0, 0.005, 0.965)), mat(shade(a.topColor, -0.15)))
            B.add('zip', place(rbox(0.016, 0.012, 0.4, 0.006), front(0, 0.75, 0.004)), mat(shade(a.topColor, 0.25), 'metal'))
            B.add('hemband', place(rbox(W * 1.0, D * 1.02, 0.03, 0.014, taper=(0.99, 0.99)), (0, 0, 0.57)), mat(tc, 'glow', g * 0.5))
            for side in (-1, 1):
                B.add('seam', place(rbox(0.012, 0.012, 0.32, 0.005), front(side * 0.06, 0.76, 0.004), rot=(0, side * 0.08, 0)), mat(shade(a.topColor, -0.4)))
        elif top == 'robe':
            for side in (-1, 1):
                B.add('robetrim', place(rbox(0.024, 0.015, 0.24, 0.008), front(side * 0.05, 0.84, 0.004), rot=(0, side * 0.38, 0)), mat(tc, 'glow', g * 0.8))
            B.add('sash', place(rbox(W * 1.05, D * 1.08, 0.04, 0.018, taper=(0.98, 0.98)), (0, 0, 0.62)), mat(tc, 'cloth'))
        elif top == 'armor':
            for i in range(3):
                B.add('plate', place(rbox(W * 0.88, 0.03, 0.08, 0.02), front(0, 0.84 - i * 0.1, 0.006)), mat(shade(a.topColor, 0.12 - i * 0.06), 'metal'))
            B.add('core', place(cyl(0.032, 0.032, 0.02, 24), front(0, 0.86, 0.025), rot=(math.pi / 2, 0, 0)), mat(tc, 'glow', g * 1.4))
            B.add('gorget', place(torus(0.075, 0.022, 24, 8), (0, 0, 0.96)), mat(shade(a.topColor, -0.2), 'metal'))
        elif top == 'longcoat':
            B.add('highcollar', place(cyl(0.1, 0.085, 0.11, 28, caps=False), (0, 0.01, 0.985)), mat(a.topColor))
            for side in (-1, 1):
                B.add('lapel', place(rbox(0.035, 0.02, 0.18, 0.01), front(side * 0.06, 0.86, 0.008), rot=(0, side * 0.35, 0)), mat(tc, 'glow', g * 0.6))
            for i in range(3):
                B.add('button', place(sphere(0.012, 10, 7), front(0.05, 0.78 - i * 0.07, 0.01)), mat(tc, 'metal'))

    def tie(self, col, emit):
        B, cy = self.B, self.chest_y
        B.add('knot', place(rbox(0.035, 0.02, 0.03, 0.01), (0, cy - 0.006, 0.92)), mat(col, 'cloth' if not emit else 'glow', emit))
        B.add('tie', place(cyl(0.022, 0.032, 0.2, 4), (0, cy - 0.008, 0.8), rot=(0, 0, math.pi / 4), scale=(1, 0.35, 1)), mat(col, 'cloth' if not emit else 'glow', emit))

    def belt(self):
        a, B = self.a, self.B
        if a.belt == 'none' and a.equipment != 'toolbelt' and not a.has('data-cartridges'):
            return
        W, D = self.W, self.D
        if a.belt in ('belt', 'utility') or a.equipment == 'toolbelt' or a.has('data-cartridges'):
            B.add('belt', place(rbox(W * 1.02, D * 1.02, 0.045, 0.02), (0, 0, 0.585)), mat('#1e2226', 'plastic'))
            B.add('buckle', place(rbox(0.06, 0.02, 0.04, 0.008), (0, -D * 0.52, 0.585)), mat(a.accent, 'glow', self.glow))
        if a.belt == 'utility' or a.equipment == 'toolbelt':
            for side in (-1, 1):
                B.add('pouch', place(rbox(0.07, 0.05, 0.08, 0.015), (side * W * 0.42, -D * 0.25, 0.55)), mat(shade(a.bottomColor, 0.15)))
        if a.equipment == 'toolbelt':
            for k, x in enumerate((-0.4, 0.42)):
                B.add('toolgrip', capsule((x * W, -D * 0.5, 0.55), (x * W + 0.01, -D * 0.5, 0.64), 0.012), mat('#f0b429', 'plastic'))
        if a.belt == 'harness' or a.has('tool-harness'):
            for side in (-1, 1):
                B.add('strap', place(rbox(0.035, 0.012, 0.44, 0.006), (side * 0.06, self.chest_y - 0.008, 0.76), rot=(0, side * 0.35, 0)), mat('#2b2f33', 'plastic'))
            B.add('hub', place(cyl(0.03, 0.03, 0.02, 20), (0, self.chest_y - 0.02, 0.78), rot=(math.pi / 2, 0, 0)), mat(a.accent, 'glow', self.glow))
        if a.has('data-cartridges'):
            for i in range(4):
                B.add('cartridge', place(rbox(0.025, 0.03, 0.05, 0.006), (W * 0.1 + i * 0.033, -D * 0.53, 0.575)), mat(shade(a.accent, -0.2), 'glow', self.glow * 0.5))

    def shoulders(self):
        a, B = self.a, self.B
        if a.shoulders == 'none': return
        sx = self.tW / 2 + self.arm_r * 0.6
        for side in (-1, 1):
            p = Vector((side * sx, 0, 0.9))
            if a.shoulders == 'pads':
                B.add('pad', place(shell(0.085, -0.1, 1.0, thickness=0.012), p, scale=(1.05, 1, 0.7)), mat(shade(a.topColor, 0.15)))
            elif a.shoulders == 'metallic':
                B.add('pauldron', place(shell(0.09, -0.15, 1.0, thickness=0.014), p, scale=(1.1, 1, 0.7)), mat(a.trimColor if a.trimColor != a.accent else '#b8c2cc', 'metal'))
            else:
                for i, (r, dz) in enumerate(((0.11, 0.0), (0.095, -0.05))):
                    B.add('armorplate', place(shell(r, -0.05, 1.0, thickness=0.015), p + Vector((side * 0.01 * i, 0, dz)), rot=(0, side * -0.25, 0), scale=(1.1, 1.0, 0.65)), mat(shade('#8d98a3', -0.15 * i), 'metal'))
                B.add('armoredge', place(torus(0.105, 0.007, 28, 6), p + Vector((side * 0.012, 0, -0.012)), rot=(0, side * -0.25, 0), scale=(1.1, 1, 1)), mat(a.accent, 'glow', self.glow))

    def headwear(self):
        a, B = self.a, self.B
        hw = a.headwear
        if hw == 'none': return
        R = HEAD_R
        sx, sy, sz = self.hs
        col = a.headwearColor
        if hw == 'cap':
            B.add('cap', place(shell(R * 1.1, 0.22, 1.0, thickness=0.012, scale=self.hs), (0, 0, HEAD_Z)), mat(col))
            B.add('brim', place(cyl(R * 0.75, R * 0.75, 0.016, 28), (0, -R * 0.82, HEAD_Z + R * 0.45), rot=(-0.12, 0, 0), scale=(1, 0.75, 1)), mat(shade(col, -0.2)))
            B.add('capbutton', place(sphere(0.018, 10, 7), (0, 0, HEAD_Z + R * sz * 1.09)), mat(shade(col, -0.2)))
        elif hw == 'hardhat':
            B.add('hardhat', place(shell(R * 1.14, 0.15, 1.0, thickness=0.02, scale=self.hs), (0, 0, HEAD_Z + 0.01)), mat(col, 'gloss'))
            B.add('hatbrim', place(torus(R * 1.14, 0.02, 40, 8), (0, -0.01, HEAD_Z + R * 0.2), scale=(sx * 1.08, sy * 1.12, 1)), mat(shade(col, -0.15), 'gloss'))
            B.add('ridge', place(rbox(0.04, R * 2.0, 0.03, 0.012), (0, 0, HEAD_Z + R * sz * 1.1), rot=(0, 0, 0)), mat(shade(col, 0.25), 'gloss'))
            B.add('lamp', place(cyl(0.03, 0.03, 0.03, 16), (0, -R * 1.08, HEAD_Z + R * 0.45), rot=(math.pi / 2, 0, 0)), mat('#fff4c2', 'glow', 4.0))
        elif hw == 'helmet':
            B.add('helmet', place(shell(R * 1.14, hairline(0.34, -0.6, -0.1), 1.0, thickness=0.02, scale=self.hs), (0, 0, HEAD_Z)), mat(col, 'gloss'))
            self.visor_band(a.accent, R * 0.3, 0.03, self.glow * 0.8)
        elif hw == 'beanie':
            B.add('beanie', place(shell(R * 1.09, 0.12, 1.0, thickness=0.02, scale=self.hs), (0, 0, HEAD_Z)), mat(col))
            B.add('fold', place(torus(R * 1.07, 0.03, 40, 8), (0, 0, HEAD_Z + R * 0.2), scale=(sx, sy, 1)), mat(shade(col, -0.2)))
            B.add('pompom', place(sphere(0.045, 14, 9), (0, 0, HEAD_Z + R * sz * 1.12)), mat(shade(col, 0.2)))
        elif hw == 'headset':
            B.add('band', place(torus(R * 1.1, 0.012, 32, 8, arc=math.pi, start=0), (0, 0, HEAD_Z + 0.02), rot=(math.pi / 2, 0, 0), scale=(sx, 1, sz)), mat(col, 'plastic'))
            for side in (-1, 1):
                B.add('earcup', place(cyl(0.05, 0.05, 0.04, 20), (side * R * sx * 1.05, 0, HEAD_Z + 0.01), rot=(0, math.pi / 2, 0)), mat(shade(col, -0.3), 'plastic'))
                B.add('earlight', place(torus(0.04, 0.006, 20, 6), (side * R * sx * 1.05 + side * 0.021, 0, HEAD_Z + 0.01), rot=(0, math.pi / 2, 0)), mat(a.accent, 'glow', self.glow))
            p0 = Vector((-R * sx * 1.05, -0.02, HEAD_Z - 0.01))
            p1 = Vector((-0.06, -R * sy * 1.02, HEAD_Z - 0.09))
            B.add('boom', capsule(p0, p1, 0.007), mat(shade(col, -0.3), 'plastic'))
            B.add('mic', place(sphere(0.016, 10, 7), p1), mat(a.accent, 'glow', self.glow))
        elif hw == 'mask':
            B.add('mask', place(shell(R * 1.06, -0.75, lambda az: lerp(-0.08, -0.3, min(1.0, abs(az) / 1.3)), az=(-1.35, 1.35), thickness=0.02, scale=self.hs), (0, 0, HEAD_Z)), mat(col, 'plastic'))
            for side in (-1, 1):
                B.add('filter', place(cyl(0.032, 0.03, 0.04, 18), self.head_pt(side * 0.55, -0.42, 0.02), rot=(math.pi / 2, 0, side * 0.5)), mat(shade(col, -0.35), 'metal'))
                B.add('filterring', place(torus(0.031, 0.005, 18, 6), self.head_pt(side * 0.55, -0.42, 0.035), rot=(math.pi / 2, 0, side * 0.5)), mat(a.accent, 'glow', self.glow))
        elif hw == 'full-helmet':
            B.add('fullhelmet', place(sphere(R * 1.2, 32, 21), (0, 0.005, HEAD_Z), scale=(sx, sy, sz * 1.02)), mat(col, 'gloss'))
            B.add('faceplate', place(shell(R * 1.215, -0.45, 0.42, az=(-1.1, 1.1), thickness=0.012, scale=(sx, sy, sz)), (0, 0.004, HEAD_Z)), mat('#0b1016', 'screen'))
            self.visor_band(a.accent, 0.02, 0.025, self.glow * 1.3)
            B.add('neckring', place(torus(0.07, 0.02, 24, 8), (0, 0, 0.99)), mat(shade(col, -0.25), 'metal'))

    def glasses(self):
        a, B = self.a, self.B
        g = a.glasses
        if g == 'none' or a.headwear == 'full-helmet' or a.eyeStyle == 'visor': return
        frame = mat('#14181c', 'plastic')
        if g == 'visor':
            self.visor_band(a.accent, 0.02, 0.07, self.glow * 0.9)
            return
        pts = [self.head_pt(side * 0.36, 0.02, 0.024) for side in (-1, 1)]
        for p in pts:
            if g == 'round':
                B.add('rim', place(torus(0.042, 0.006, 24, 6), p, rot=(math.pi / 2, 0, 0)), frame)
            elif g == 'square':
                B.add('rim', place(torus(0.05, 0.007, 4, 6, start=math.pi / 4), p, rot=(math.pi / 2, 0, 0), scale=(1.05, 1, 0.68)), frame)
            else:  # ar-glasses: tinted glowing lens
                B.add('arlens', place(rbox(0.085, 0.006, 0.055, 0.014), p), mat(a.accent, 'glow', self.glow * 0.7))
                B.add('arrim', place(torus(0.05, 0.004, 4, 6, start=math.pi / 4), p + Vector((0, -0.004, 0)), rot=(math.pi / 2, 0, 0), scale=(1.05, 1, 0.75)), mat('#d0eef0', 'metal'))
        B.add('bridge', capsule(pts[0] + Vector((0.04, 0, 0.005)), pts[1] + Vector((-0.04, 0, 0.005)), 0.004), frame)
        for side, p in zip((-1, 1), pts):
            B.add('arm', capsule(p + Vector((side * 0.045, 0.01, 0.005)), Vector((side * HEAD_R * self.hs[0] * 0.98, 0.04, HEAD_Z + 0.02)), 0.004), frame)

    def equipment(self):
        a, B = self.a, self.B
        eq = a.equipment
        g = self.glow
        h = self.hand_r
        if h is None or eq in ('none', 'toolbelt'): return
        B.group = 'fore_l' if eq == 'briefcase' else 'fore_r'   # equipment moves with the hand holding it
        try:
            self._equipment(eq, g, h)
        finally:
            B.group = 'body'

    def _equipment(self, eq, g, h):
        a, B = self.a, self.B
        if eq == 'tablet':
            c = h + Vector((0.07, -0.02, 0.06))
            B.add('tablet', place(rbox(0.17, 0.014, 0.23, 0.014), c, rot=(-0.35, 0, 0.25)), mat('#11161b', 'gloss'))
            B.add('screen', place(rbox(0.145, 0.004, 0.2, 0.008), c + Vector((0.0, -0.009, 0.003)), rot=(-0.35, 0, 0.25)), mat(a.accent, 'screen', g * 0.9))
        elif eq == 'drafting-tablet':
            c = h + Vector((0.09, -0.02, 0.06))
            B.add('dtablet', place(rbox(0.24, 0.014, 0.18, 0.014), c, rot=(-0.4, 0, 0.2)), mat('#1b2229', 'gloss'))
            B.add('dscreen', place(rbox(0.21, 0.004, 0.15, 0.008), c + Vector((0, -0.009, 0.003)), rot=(-0.4, 0, 0.2)), mat(shade(a.accent, -0.3), 'screen', g * 0.8))
            for i in range(3):
                B.add('gridline', place(rbox(0.19, 0.003, 0.004, 0.001), c + Vector((0, -0.013, -0.04 + i * 0.04)), rot=(-0.4, 0, 0.2)), mat('#ffffff', 'glow', 1.5))
        elif eq == 'clipboard':
            c = h + Vector((0.06, -0.02, 0.06))
            B.add('board', place(rbox(0.17, 0.012, 0.23, 0.008), c, rot=(-0.3, 0, 0.25)), mat('#7a5a34', 'plastic'))
            B.add('paper', place(rbox(0.14, 0.004, 0.19, 0.003), c + Vector((0.0, -0.008, -0.008)), rot=(-0.3, 0, 0.25)), mat('#f0f0ea', 'cloth'))
            B.add('clip', place(rbox(0.06, 0.016, 0.025, 0.006), c + Vector((-0.003, -0.006, 0.11)), rot=(-0.3, 0, 0.25)), mat('#b8c0c8', 'metal'))
        elif eq == 'laptop':
            c = h + Vector((0.08, -0.05, 0.02))
            B.add('lapbase', place(rbox(0.26, 0.18, 0.016, 0.01), c, rot=(0, 0, 0.2)), mat('#2a2f33', 'metal'))
            lid = c + Vector((-0.018, 0.085, 0.085))
            B.add('lid', place(rbox(0.26, 0.012, 0.17, 0.01), lid, rot=(-0.2, 0, 0.2)), mat('#2a2f33', 'metal'))
            B.add('lapscreen', place(rbox(0.23, 0.004, 0.14, 0.006), lid + Vector((0.002, -0.008, 0)), rot=(-0.2, 0, 0.2)), mat(a.accent, 'screen', g * 0.8))
        elif eq == 'wrench':
            p0 = h + Vector((0, -0.01, -0.05))
            p1 = h + Vector((0.0, -0.05, 0.17))
            B.add('handle', capsule(p0, p1, 0.016), mat('#9aa4a8', 'metal'))
            B.add('jaw', place(torus(0.035, 0.014, 16, 6, arc=math.pi * 1.4, start=-math.pi * 0.2), p1 + Vector((0, -0.005, 0.03)), rot=(math.pi / 2, 0, 0)), mat('#9aa4a8', 'metal'))
            B.add('grip', capsule(p0 + Vector((0, 0, 0.0)), p0.lerp(p1, 0.45), 0.02), mat(a.accent, 'plastic'))
        elif eq == 'briefcase':
            hl = self.hand_l if self.hand_l is not None else h
            c = hl + Vector((0, 0, -0.12))
            B.add('case', place(rbox(0.07, 0.24, 0.17, 0.02), c), mat('#2b2118', 'gloss'))
            B.add('casehandle', place(torus(0.03, 0.007, 12, 6, arc=math.pi), c + Vector((0, 0, 0.085)), rot=(math.pi / 2, 0, math.pi / 2)), mat('#1a1410', 'plastic'))
            B.add('casetrim', place(rbox(0.075, 0.245, 0.012, 0.004), c + Vector((0, 0, 0.03))), mat(a.trimColor, 'metal'))
        elif eq == 'holo-catalog':
            for i in range(3):
                c = h + Vector((-0.06 - i * 0.025, -0.06 - i * 0.02, 0.1 + i * 0.055))
                B.add('holopanel', place(rbox(0.12, 0.003, 0.07, 0.008), c, rot=(-0.2, 0, 0.45 - i * 0.12)), mat(a.accent, 'glow', g * (1.0 - i * 0.2)))
            B.add('emitter', place(cyl(0.02, 0.026, 0.015, 16), h + Vector((0, -0.01, 0.05))), mat('#c8d0d8', 'metal'))

    def accessories(self):
        a, B = self.a, self.B
        g, cy, W = self.glow, self.chest_y, self.tW
        front = lambda x, z, out=0.0: Vector((x, cy - out, z))
        for acc in a.accessories:
            B.group = {'wrist-display': 'fore_l', 'drafting-rig': 'fore_l', 'shoulder-patch': 'upper_l'}.get(acc, 'body')
            if acc == 'wrist-display' and self.hand_l is not None:
                w = self.elbow_l.lerp(self.hand_l, 0.72)
                d = (self.hand_l - self.elbow_l).normalized()
                q = d.to_track_quat('Z', 'Y').to_matrix().to_4x4()
                B.add('wristband', xf(cyl(self.arm_r * 1.12, self.arm_r * 1.12, 0.05, 20), Matrix.Translation(w) @ q), mat('#1e2328', 'plastic'))
                B.add('wristscreen', place(rbox(0.05, 0.012, 0.045, 0.008), w + Vector((0.0, -self.arm_r * 1.1, 0))), mat(a.accent, 'screen', g))
                B.add('wristholo', place(rbox(0.07, 0.002, 0.05, 0.004), w + Vector((0.035, -self.arm_r - 0.05, 0.05)), rot=(-0.4, 0, -0.5)), mat(a.accent, 'glow', g * 0.7))
            elif acc == 'rank-insignia':
                for i in range(2):
                    for side in (-1, 1):
                        B.add('chevron', place(rbox(0.04, 0.008, 0.01, 0.004), front(W * 0.27 + side * 0.016, 0.86 - i * 0.022, 0.006), rot=(0, side * 0.6, 0)), mat(a.trimColor, 'metal'))
            elif acc == 'exec-insignia':
                B.add('crest', place(cyl(0.022, 0.022, 0.01, 6), front(-W * 0.28, 0.87, 0.008), rot=(math.pi / 2, 0, 0)), mat('#d4a84a', 'metal'))
                B.add('crestgem', place(sphere(0.009, 10, 7), front(-W * 0.28, 0.87, 0.015)), mat(a.accent, 'glow', g))
            elif acc == 'lapel-pin':
                B.add('pin', place(sphere(0.012, 10, 7), front(-W * 0.24, 0.9, 0.008)), mat('#d4a84a', 'metal'))
            elif acc == 'shoulder-patch' and self.hand_l is not None:
                sx = self.tW / 2 + self.arm_r * 0.75
                B.add('patch', place(cyl(0.032, 0.032, 0.01, 20), (sx + self.arm_r * 0.85, 0, 0.82), rot=(0, math.pi / 2, 0)), mat(a.accent, 'glow', g * 0.6))
            elif acc == 'holo-badge':
                B.add('holobadge', place(rbox(0.05, 0.003, 0.065, 0.008), front(W * 0.32, 0.77, 0.035), rot=(0, 0, -0.25)), mat(a.accent, 'glow', g * 1.2))
                B.add('badgeclip', place(rbox(0.03, 0.01, 0.012, 0.004), front(W * 0.32, 0.81, 0.004)), mat('#c8d0d8', 'metal'))
            elif acc == 'illuminated-tie':
                self.tie(a.accent, g * 1.2)
            elif acc == 'floating-assistant':
                c = Vector((0.36, 0.02, 1.32))
                B.add('drone', place(sphere(0.05, 20, 13), c), mat('#e8eef2', 'gloss'))
                B.add('droneeye', place(sphere(0.022, 14, 9), c + Vector((-0.012, -0.04, 0)), scale=(1, 0.5, 1)), mat(a.accent, 'glow', g * 1.5))
                B.add('dronering', place(torus(0.075, 0.006, 32, 6), c + Vector((0, 0, -0.01)), rot=(0.2, 0.1, 0)), mat(a.accent, 'glow', g))
            elif acc == 'data-device':
                B.add('slate', place(rbox(0.05, 0.012, 0.08, 0.008), (self.W * 0.42, -self.D * 0.45, 0.5), rot=(0, 0, -0.3)), mat('#1b2229', 'gloss'))
                B.add('slatescreen', place(rbox(0.04, 0.004, 0.06, 0.004), (self.W * 0.42 - 0.003, -self.D * 0.45 - 0.008, 0.5), rot=(0, 0, -0.3)), mat(a.accent, 'screen', g * 0.8))
            elif acc == 'ledger-slate':
                B.add('ledger', place(rbox(0.06, 0.015, 0.09, 0.008), (-self.W * 0.44, -self.D * 0.4, 0.49), rot=(0, 0, 0.3)), mat('#d4a84a', 'metal'))
            elif acc == 'diagnostic-visor':
                p = self.head_pt(0.36, 0.02, 0.03)
                B.add('monocle', place(cyl(0.045, 0.045, 0.012, 24), p, rot=(math.pi / 2, 0, 0)), mat(a.accent, 'glow', g * 0.9))
                B.add('monoclearm', capsule(p + Vector((0.04, 0.0, 0)), Vector((HEAD_R * self.hs[0] * 0.98, 0.0, HEAD_Z + 0.03)), 0.006), mat('#9aa4a8', 'metal'))
            elif acc == 'catalog-interface':
                c = Vector((-0.34, -0.06, 1.18))
                for i in range(2):
                    B.add('catpanel', place(rbox(0.12, 0.003, 0.08, 0.008), c + Vector((-0.02 * i, 0.02 * i, 0.06 * i)), rot=(0, 0, 0.5)), mat(a.accent, 'glow', g * (1 - 0.3 * i)))
            elif acc == 'drafting-rig' and self.hand_l is not None:
                w = self.elbow_l.lerp(self.hand_l, 0.5)
                B.add('rig', place(rbox(0.035, 0.07, 0.1, 0.01), w + Vector((self.arm_r * 1.05, 0, 0))), mat('#3a4248', 'metal'))
                B.add('riglight', place(rbox(0.006, 0.05, 0.07, 0.004), w + Vector((self.arm_r * 1.05 + 0.019, 0, 0))), mat(a.accent, 'glow', g))
            elif acc == 'comms-relay':
                p = Vector((HEAD_R * self.hs[0] * 1.0, -0.02, HEAD_Z - 0.02))
                B.add('earpiece', place(sphere(0.025, 12, 9), p), mat('#20262c', 'plastic'))
                B.add('earpiecelight', place(sphere(0.01, 8, 5), p + Vector((0.018, -0.008, 0))), mat(a.accent, 'glow', g * 1.4))
            # unknown ids are skipped on purpose
        B.group = 'body'
        if a.jewelry == 'earrings':
            for side in (-1, 1):
                B.add('earring', place(sphere(0.012, 10, 7), (side * HEAD_R * self.hs[0] * 0.98, -0.005, HEAD_Z - 0.06)), mat('#d4a84a', 'metal'))
        elif a.jewelry == 'necklace':
            B.add('necklace', place(torus(0.07, 0.006, 32, 6), (0, -0.01, 0.93), rot=(0.35, 0, 0)), mat('#d4a84a', 'metal'))
        elif a.jewelry == 'badge' and not a.has('holo-badge'):
            B.add('badge', place(rbox(0.04, 0.01, 0.05, 0.008), front(W * 0.28, 0.86, 0.004)), mat(a.accent, 'glow', g))

    def robotics(self):
        a, B = self.a, self.B
        r = a.robotic
        if r == 'none' or r == 'full' and False: return
        R = HEAD_R
        metal = mat('#8d98a3', 'metal')
        if r == 'eyepiece':
            p = self.head_pt(-0.36, 0.02, 0.012)
            B.add('eyepiece', place(cyl(0.04, 0.034, 0.04, 20), p, rot=(math.pi / 2, 0, 0)), metal)
            B.add('lens', place(cyl(0.026, 0.026, 0.01, 20), p + Vector((0, -0.022, 0)), rot=(math.pi / 2, 0, 0)), mat('#ff3b3b', 'glow', 4.0))
        elif r == 'jaw':
            B.add('jaw', place(shell(R * 1.02, -0.97, lambda az: lerp(-0.42, -0.1, min(1.0, abs(az) / 1.7)), az=(-1.7, 1.7), thickness=0.015, scale=self.hs), (0, 0, HEAD_Z)), metal)
            B.add('jawlight', place(rbox(0.08, 0.006, 0.008, 0.003), self.head_pt(0, -0.62, 0.012)), mat(a.accent, 'glow', self.glow))
        elif r == 'half-face':
            B.add('halfplate', place(shell(R * 1.012, -0.85, 0.75, az=(0.06, 1.9), thickness=0.012, scale=self.hs), (0, 0, HEAD_Z)), metal)
            B.add('seam', place(rbox(0.006, 0.01, R * 1.6, 0.003), self.head_pt(0.06, 0.0, 0.012)), mat(a.accent, 'glow', self.glow))
            B.add('roboeye', place(sphere(0.026, 14, 9), self.head_pt(0.36, 0.02, 0.006), scale=(1, 0.5, 1)), mat('#ff3b3b', 'glow', 4.0))
        elif r == 'full':
            for z in (0.94, 0.98, 1.02):
                B.add('neckring', place(torus(0.055, 0.008, 20, 6), (0, 0, z)), mat('#5d6670', 'metal'))
            B.add('headseam', place(torus(HEAD_R * 1.003, 0.004, 48, 6), (0, 0, HEAD_Z), rot=(0, math.pi / 2, 0), scale=(1, self.hs[1], self.hs[2])), mat(a.accent, 'glow', self.glow))

    def effects(self):
        a, B = self.a, self.B
        fx, g = a.fx, self.glow
        if fx['aura'] or fx['holoOutline']:
            B.add('aura', place(torus(0.42, 0.008, 64, 6), (0, 0, 0.012)), mat(a.accent, 'glow', g * (0.8 + a.intensity)))
            B.add('aura2', place(torus(0.34, 0.004, 64, 6), (0, 0, 0.012)), mat(a.accent, 'glow', g * 0.6))
        if fx['particles']:
            import random
            rnd = random.Random(hash(a.accent) & 0xffff)
            for i in range(9):
                ang = rnd.uniform(0, 2 * math.pi)
                rr = rnd.uniform(0.3, 0.42)
                B.add('mote', place(sphere(0.008, 8, 5), (math.cos(ang) * rr, math.sin(ang) * rr, rnd.uniform(0.2, 1.4))), mat(a.accent, 'glow', g * 1.5))

# ------------------------------------------------------------------ scene

def reset_scene():
    for ob in list(bpy.data.objects): bpy.data.objects.remove(ob, do_unlink=True)
    for coll in list(bpy.data.collections): bpy.data.collections.remove(coll)
    scene = bpy.context.scene
    world = bpy.data.worlds.new('studio')
    world.use_nodes = True
    bg = world.node_tree.nodes.get('Background')
    if bg:
        bg.inputs[0].default_value = (0.045, 0.052, 0.07, 1.0)
        bg.inputs[1].default_value = 0.55
    scene.world = world
    try:
        scene.view_settings.view_transform = 'Standard'
        scene.view_settings.look = 'None'
    except TypeError:
        pass
    scene.render.film_transparent = True
    scene.render.image_settings.file_format = 'PNG'
    scene.render.image_settings.color_mode = 'RGBA'
    scene.render.image_settings.color_depth = '8'
    scene.render.resolution_percentage = 100
    return scene


def try_engine(scene, ids):
    for e in ids:
        try:
            scene.render.engine = e
            if scene.render.engine == e: return e
        except TypeError:
            continue
    return None


def eevee_ids():
    return ['BLENDER_EEVEE_NEXT', 'BLENDER_EEVEE']  # 4.2-4.x name first, then 5.x / 3.x name


def probe_eevee():
    """EEVEE needs a GPU context; without one Blender aborts the whole process, so test it in a child Blender."""
    binary = getattr(bpy.app, 'binary_path', '') or ''
    if not binary or not os.path.exists(binary) or 'python' in os.path.basename(binary).lower():
        return False
    with tempfile.TemporaryDirectory() as td:
        out = os.path.join(td, 'probe.png')
        expr = ("import bpy\ns=bpy.context.scene\n"
                "for e in ('BLENDER_EEVEE_NEXT','BLENDER_EEVEE'):\n"
                "    try:\n        s.render.engine=e\n        break\n    except TypeError: pass\n"
                "s.render.resolution_x=s.render.resolution_y=16\ns.render.filepath=%r\n"
                "bpy.ops.render.render(write_still=True)\n") % out
        try:
            r = subprocess.run([binary, '--background', '--factory-startup', '--python-expr', expr], capture_output=True, timeout=90)
            return r.returncode == 0 and os.path.exists(out)
        except Exception:
            return False


def setup_engine(scene, choice, samples):
    engine = None
    if choice in ('eevee',) or (choice == 'auto' and probe_eevee()):
        engine = try_engine(scene, eevee_ids())
    if engine is None:
        engine = try_engine(scene, ['CYCLES'])
    if engine == 'CYCLES':
        c = scene.cycles
        c.device = 'CPU'
        c.samples = samples
        for k, v in (('use_adaptive_sampling', True), ('adaptive_threshold', 0.04), ('use_denoising', True),
                     ('max_bounces', 4), ('diffuse_bounces', 2), ('glossy_bounces', 2), ('transmission_bounces', 2),
                     ('transparent_max_bounces', 4), ('caustics_reflective', False), ('caustics_refractive', False),
                     ('blur_glossy', 1.0)):
            try: setattr(c, k, v)
            except (AttributeError, TypeError): pass
        try: c.denoiser = 'OPENIMAGEDENOISE'
        except TypeError: pass
        scene.render.use_persistent_data = True
    elif engine:
        ee = scene.eevee
        for k, v in (('taa_render_samples', max(16, samples)), ('use_gtao', True), ('use_shadows', True), ('use_bloom', True), ('bloom_intensity', 0.03)):
            try: setattr(ee, k, v)
            except (AttributeError, TypeError): pass
    return engine or scene.render.engine


def look_at(ob, target):
    d = Vector(target) - ob.location
    ob.rotation_euler = d.to_track_quat('-Z', 'Y').to_euler()


def add_light(scene, name, kind, energy, color, size, loc, target):
    ld = bpy.data.lights.new(name, kind)
    ld.energy = energy
    ld.color = color
    if kind == 'AREA':
        ld.shape = 'DISK'
        ld.size = size
    ob = bpy.data.objects.new(name, ld)
    scene.collection.objects.link(ob)
    ob.location = loc
    look_at(ob, target)
    return ob


def rig_lights(scene, cam_az, center, scale=1.0, rim_color=(0.75, 0.9, 1.0)):
    """Soft three-point light, placed relative to the camera direction."""
    cz = center[2]
    def at(az, dist, z):
        return Vector((math.sin(az) * dist + center[0], -math.cos(az) * dist + center[1], z))
    s = scale * scale
    lights = [
        add_light(scene, 'key', 'AREA', 210 * s, (1.0, 0.96, 0.9), 2.4 * scale, at(cam_az - 0.75, 3.2 * scale, cz + 2.0 * scale), center),
        add_light(scene, 'fill', 'AREA', 70 * s, (0.82, 0.9, 1.0), 3.0 * scale, at(cam_az + 1.0, 3.4 * scale, cz + 0.6 * scale), center),
        add_light(scene, 'rim', 'AREA', 240 * s, rim_color, 1.6 * scale, at(cam_az + math.pi * 0.85, 2.8 * scale, cz + 1.7 * scale), center),
    ]
    return lights


def shadow_catcher(scene, engine, size, loc=(0, 0, 0)):
    if engine != 'CYCLES': return None
    bm = bmesh.new()
    bmesh.ops.create_grid(bm, x_segments=1, y_segments=1, size=size)
    me = bpy.data.meshes.new('floor'); bm.to_mesh(me); bm.free()
    ob = bpy.data.objects.new('floor', me)
    scene.collection.objects.link(ob)
    ob.location = loc
    try: ob.is_shadow_catcher = True
    except AttributeError:
        bpy.data.objects.remove(ob, do_unlink=True); return None
    return ob


def make_camera(scene, name, ortho=False):
    cd = bpy.data.cameras.new(name)
    cd.sensor_fit = 'VERTICAL'
    cd.sensor_height = 24
    if ortho: cd.type = 'ORTHO'
    cam = bpy.data.objects.new(name, cd)
    scene.collection.objects.link(cam)
    scene.camera = cam
    return cam


def world_bbox(objs):
    lo = Vector((1e9, 1e9, 1e9)); hi = Vector((-1e9, -1e9, -1e9))
    for ob in objs:
        if ob.type != 'MESH': continue
        for c in ob.bound_box:
            w = ob.matrix_world @ Vector(c)
            lo = Vector(map(min, lo, w)); hi = Vector(map(max, hi, w))
    return lo, hi


def render_to(scene, path):
    scene.render.filepath = path
    bpy.ops.render.render(write_still=True)


def export_glb(root, path):
    for ob in bpy.context.view_layer.objects: ob.select_set(False)
    objs = [root] + list(root.children_recursive)
    for ob in objs: ob.select_set(True)
    bpy.context.view_layer.objects.active = root
    kw = dict(filepath=path, export_format='GLB', use_selection=True, export_apply=True, export_yup=True)
    try:
        bpy.ops.export_scene.gltf(**kw, export_materials='EXPORT')
    except TypeError:
        bpy.ops.export_scene.gltf(**kw)
    for ob in objs: ob.select_set(False)


def text_obj(coll, body, size, loc, color_hex, emit=1.0, bold=False):
    cu = bpy.data.curves.new('label', 'FONT')
    cu.body = body
    cu.size = size
    cu.align_x = 'CENTER'
    cu.align_y = 'CENTER'
    cu.extrude = 0.0
    ob = bpy.data.objects.new('label', cu)
    coll.objects.link(ob)
    ob.location = loc
    ob.rotation_euler = (math.pi / 2, 0, 0)
    cu.materials.append(mat(color_hex, 'glow', emit))
    return ob


# ------------------------------------------------------------------ sprites

SPRITE_FRAMES = ['idle', 'walk0', 'walk1', 'walk2', 'walk3', 'sit', 'talk', 'work']
SPRITE_W, SPRITE_H = 128, 192
SPRITE_VIEW_H = 2.0            # metres visible top to bottom: one scale for everyone
SPRITE_BASELINE_PX = 8         # feet sit this far above the frame bottom
SPRITE_AZ, SPRITE_TILT = -0.75, math.radians(15)   # 3/4 view, facing screen-right, looking slightly down
SPRITE_SAMPLES = 12


class SpriteRig:
    """A second scene that renders all 8 poses of one character in a single render: eight posed copies
    stand side by side across one wide orthographic camera (one frame each), staggered in depth along the
    view axis so they never shadow each other. Sun lights keep the lighting identical in every frame."""
    def __init__(self, main_scene, engine):
        sc = bpy.data.scenes.new('sprites')
        sc.world = main_scene.world
        try:
            sc.view_settings.view_transform = 'Standard'; sc.view_settings.look = 'None'
        except TypeError:
            pass
        r = sc.render
        r.film_transparent = True
        r.resolution_x, r.resolution_y, r.resolution_percentage = SPRITE_W * len(SPRITE_FRAMES), SPRITE_H, 100
        r.image_settings.file_format = 'WEBP'
        r.image_settings.color_mode = 'RGBA'
        try: r.image_settings.quality = 85
        except AttributeError: pass
        self.engine = setup_engine(sc, 'eevee' if engine != 'CYCLES' else 'cycles', SPRITE_SAMPLES)
        if self.engine == 'CYCLES':
            try: sc.cycles.adaptive_threshold = 0.06
            except AttributeError: pass
        self.scene = sc
        self.coll = bpy.data.collections.new('sprite_poses')
        sc.collection.children.link(self.coll)
        ct, st = math.cos(SPRITE_TILT), math.sin(SPRITE_TILT)
        self.f = Vector((-math.sin(SPRITE_AZ) * ct, math.cos(SPRITE_AZ) * ct, -st))   # view direction
        self.right = Vector((math.cos(SPRITE_AZ), math.sin(SPRITE_AZ), 0.0))
        up = self.right.cross(self.f).normalized()
        if up.z < 0: up = -up
        # put the world origin (the feet) SPRITE_BASELINE_PX above the bottom of the frame
        zt = (0.5 - SPRITE_BASELINE_PX / SPRITE_H) * SPRITE_VIEW_H / up.z
        self.target = Vector((0, 0, zt))
        cd = bpy.data.cameras.new('sprite_cam')
        cd.type = 'ORTHO'
        cd.sensor_fit = 'VERTICAL'
        cd.ortho_scale = SPRITE_VIEW_H   # with a VERTICAL sensor fit this is the visible height
        cd.clip_start, cd.clip_end = 0.1, 400
        cam = bpy.data.objects.new('sprite_cam', cd)
        sc.collection.objects.link(cam)
        cam.location = self.target - self.f * 60
        cam.rotation_euler = self.f.to_track_quat('-Z', 'Y').to_euler()
        sc.camera = cam
        self.frame_w = SPRITE_VIEW_H * SPRITE_W / SPRITE_H
        # sun lights, placed like the portrait rig but with a stronger rim so silhouettes read on a dark floor
        def sun(name, energy, color, az, elev, angle):
            ld = bpy.data.lights.new(name, 'SUN')
            ld.energy, ld.color = energy, color
            try: ld.angle = math.radians(angle)
            except AttributeError: pass
            ob = bpy.data.objects.new(name, ld)
            sc.collection.objects.link(ob)
            d = Vector((math.sin(az) * math.cos(elev), -math.cos(az) * math.cos(elev), math.sin(elev)))
            ob.rotation_euler = (-d).to_track_quat('-Z', 'Y').to_euler()
        # azimuth 0 is the character's front; the character faces screen-right, so the key comes from there
        sun('sp_key', 4.2, (1.0, 0.96, 0.9), 0.35, math.radians(45), 12)
        sun('sp_fill', 1.3, (0.82, 0.9, 1.0), SPRITE_AZ - 0.7, math.radians(20), 25)
        sun('sp_rim', 5.5, (0.75, 0.9, 1.0), 2.4, math.radians(38), 10)

    def slot(self, k):
        """World position for frame k: its column on screen, pushed back along the view axis."""
        return self.right * ((k - (len(SPRITE_FRAMES) - 1) / 2) * self.frame_w) + self.f * (9.0 * k)

    def copy_figure(self, root):
        mapping = {}
        for ob in [root] + list(root.children_recursive):
            c = ob.copy()
            self.coll.objects.link(c)
            mapping[ob] = c
        for ob, c in mapping.items():
            if ob.parent in mapping:
                c.parent = mapping[ob.parent]
                c.matrix_parent_inverse = ob.matrix_parent_inverse.copy()
        return mapping

    def stool(self, root, fig):
        seat_top = KNEE_Z - fig.leg_r * 0.95
        dark, trim = mat('#1a1f26', 'plastic'), mat(fig.a.accent, 'glow', 1.6)
        parts = [
            (place(cyl(0.15, 0.15, 0.05, 28), (0, 0.03, seat_top - 0.025)), dark),
            (place(torus(0.15, 0.007, 40, 6), (0, 0.03, seat_top - 0.012)), trim),
            (place(cyl(0.026, 0.026, seat_top - 0.07, 14), (0, 0.03, (seat_top - 0.05) / 2 + 0.01)), mat('#5d6670', 'metal')),
            (place(cyl(0.11, 0.12, 0.022, 24), (0, 0.03, 0.011)), dark),
        ]
        obs = []
        for bm, m in parts:
            me = bpy.data.meshes.new('stool'); bm.to_mesh(me); bm.free()
            try: me.shade_smooth()
            except AttributeError: pass
            me.materials.append(m)
            ob = bpy.data.objects.new('stool', me)
            self.coll.objects.link(ob)
            ob.parent = root
            obs.append(ob)
        return obs

    def render(self, root, fig, path):
        made = []
        holding = 'l' if fig.a.equipment == 'briefcase' else ('r' if fig.a.equipment in HELD else None)
        try:
            for k, frame in enumerate(SPRITE_FRAMES):
                mapping = self.copy_figure(root)
                made += list(mapping.values())
                croot = mapping[root]
                croot.location = self.slot(k)
                croot.rotation_euler = (0, 0, 0)
                joints = {name: mapping[e] for name, e in fig.joints.items()}
                pose(joints, frame, holding)
                if frame == 'sit':
                    made += self.stool(croot, fig)
            self.scene.render.filepath = path
            bpy.ops.render.render(write_still=True, scene=self.scene.name)
        finally:
            remove_ids(made)


def remove_ids(ids):
    """Delete many datablocks at once (much faster than one remove() per object on a big scene)."""
    ids = [i for i in ids if i is not None]
    if not ids: return
    try:
        bpy.data.batch_remove(ids)
    except (AttributeError, RuntimeError, TypeError, ReferenceError):
        for ob in ids:
            try: bpy.data.objects.remove(ob, do_unlink=True)
            except (ReferenceError, RuntimeError, TypeError): pass


def pose(J, frame, holding):
    """Set joint rotations for one sprite frame. Joint X rotation: negative swings a limb forward (-Y);
    positive bends a knee back. The held item stays in the holding hand, so that arm moves least."""
    for e in J.values():
        e.rotation_euler = (0, 0, 0)
    J['body'].location = (0, 0, 0)
    J['skirt'].scale = (1, 1, 1)
    free = [s for s in ('r', 'l') if s != holding]
    other = {'r': 'l', 'l': 'r'}

    def rot(name, x=0.0, y=0.0):
        J[name].rotation_euler = (x, y, 0)

    def arm(s, shoulder, elbow=0.0):
        if s == holding:
            rot('shoulder_' + s, shoulder * 0.25)
        else:
            rot('shoulder_' + s, shoulder); rot('elbow_' + s, elbow)

    if frame.startswith('walk'):
        k = int(frame[-1])
        J['body'].rotation_euler = (-0.035, 0, 0)
        if k in (0, 2):     # contact: front leg forward, back leg behind, opposite arm forward
            front = 'l' if k == 0 else 'r'
            back = other[front]
            a = 0.36
            rot('hip_' + front, -a); rot('knee_' + front, 0.05)
            rot('hip_' + back, a * 0.9); rot('knee_' + back, 0.16)
            arm(back, -0.42, -0.3); arm(front, 0.38, -0.12)
            J['body'].location = (0, 0, -HIP_Z * (1 - math.cos(a)) * 0.92)
        else:               # passing: stance leg under the body, swing leg lifted with the knee bent
            swing = 'r' if k == 1 else 'l'
            stance = other[swing]
            rot('hip_' + stance, 0.06)
            rot('hip_' + swing, -0.28); rot('knee_' + swing, 0.72)
            arm(swing, 0.1, -0.15); arm(stance, -0.1, -0.2)
            J['body'].location = (0, 0, 0.006)
    elif frame == 'sit':
        J['body'].location = (0, 0, -(HIP_Z - KNEE_Z))
        for s in ('r', 'l'):
            rot('hip_' + s, -math.pi / 2); rot('knee_' + s, math.pi / 2)
        J['skirt'].scale = (1, 1, 0.45)
        for s in ('r', 'l'):
            arm(s, -0.4, -0.95)
    elif frame == 'talk':
        g = 'l' if holding != 'l' else 'r'
        out = -0.3 if g == 'l' else 0.3
        rot('shoulder_' + g, -0.5, out); rot('elbow_' + g, -1.55)
    elif frame == 'work':
        for s in ('r', 'l'):
            arm(s, -0.32, -1.1)

# ------------------------------------------------------------------ main

def load_roster(path):
    with open(path, 'r', encoding='utf-8') as f:
        data = json.load(f)
    chars = data.get('characters') if isinstance(data, dict) else data
    if not isinstance(chars, list): raise ValueError('roster must be {"characters": [...]}')
    out, seen = [], set()
    for c in chars:
        if not isinstance(c, dict): continue
        cid = c.get('id')
        if not isinstance(cid, str) or not ID_RE.match(cid) or cid in seen: continue
        seen.add(cid)
        name = c.get('name') if isinstance(c.get('name'), str) else cid
        title = c.get('title') if isinstance(c.get('title'), str) else ''
        out.append({'id': cid, 'name': name[:24], 'title': title[:32], 'look': Look(c.get('appearance'))})
        if len(out) >= MAX_CHARACTERS: break
    return out


def main():
    t0 = time.time()
    roster_path, out_dir, opts = parse_args(sys.argv)
    os.makedirs(out_dir, exist_ok=True)
    roster = load_roster(roster_path)
    scene = reset_scene()
    engine = setup_engine(scene, opts['engine'], opts['samples'])
    log = lambda *m: print('[characters]', *m, file=sys.stderr, flush=True)
    log('engine', engine, 'characters', len(roster))

    outputs, errors, timings, built = [], [], {}, []
    # portrait rig: 3/4 view from the character's right-front, slightly above
    cam_az = -0.55
    center = Vector((0, 0, 0.86))
    cam = make_camera(scene, 'portrait_cam')
    cam.data.lens = 85
    portrait_lights = rig_lights(scene, cam_az, center)
    floor = shadow_catcher(scene, engine, 4.0)
    sprites_only = opts.get('sprites_only', False)
    sprite_rig = SpriteRig(scene, engine) if opts.get('sprites') else None

    for ch in roster:
        ts = time.time()
        coll = bpy.data.collections.new('char_' + ch['id'])
        scene.collection.children.link(coll)
        root = bpy.data.objects.new(ch['id'], None)
        root.empty_display_type = 'PLAIN_AXES'
        coll.objects.link(root)
        try:
            if sprite_rig and ch['look'].idlePose == 'hands-hips':
                ch['look'].idlePose = 'stand'   # sprite poses start from relaxed arms
            fig = Figure(Builder(coll, root), ch['look'])
            fig.build()
            root.scale = (ch['look'].height,) * 3
        except Exception as e:  # keep going: one bad character must not lose the rest
            errors.append({'id': ch['id'], 'error': str(e)})
            log('build failed', ch['id'], e)
            for ob in list(coll.objects): bpy.data.objects.remove(ob, do_unlink=True)
            bpy.data.collections.remove(coll)
            continue
        built.append((ch, coll, root))
        for _, other, _r in built[:-1]:
            if other is not None: other.hide_render = True
        coll.hide_render = False
        bpy.context.view_layer.update()
        # frame: fixed scale so heights compare, widened if accessories stick out
        lo, hi = world_bbox(coll.objects)
        top = max(1.62, hi.z + 0.05)
        half_h = top / 2 + 0.02
        vfov = 2 * math.atan(12 / cam.data.lens)
        aspect = PORTRAIT[0] / PORTRAIT[1]
        half_w = max(abs(lo.x), abs(hi.x), abs(lo.y), abs(hi.y)) + 0.05
        dist = max(half_h / math.tan(vfov / 2), half_w / math.tan(vfov / 2) / aspect) + 0.3
        tgt = Vector((0, 0, top / 2 - 0.01))
        elev = 0.12
        cam.location = Vector((math.sin(cam_az) * dist * math.cos(elev), -math.cos(cam_az) * dist * math.cos(elev), tgt.z + math.sin(elev) * dist))
        look_at(cam, tgt)
        scene.render.resolution_x, scene.render.resolution_y = PORTRAIT
        try:
            if sprite_rig:
                tsp = time.time()
                sprite_rig.render(root, fig, os.path.join(out_dir, ch['id'] + '_sprites.webp'))
                outputs.append(ch['id'] + '_sprites.webp')
                timings[ch['id'] + '_sprites'] = round(time.time() - tsp, 2)
            if not sprites_only:
                png = os.path.join(out_dir, ch['id'] + '.png')
                render_to(scene, png)
                outputs.append(ch['id'] + '.png')
            if opts['glb'] and not sprites_only:
                export_glb(root, os.path.join(out_dir, ch['id'] + '.glb'))
                outputs.append(ch['id'] + '.glb')
        except Exception as e:
            errors.append({'id': ch['id'], 'error': str(e)})
            log('render/export failed', ch['id'], e)
        if sprites_only:   # nothing else needs this character: free it so later characters stay fast
            meshes = [ob.data for ob in coll.objects if ob.type == 'MESH']
            remove_ids(list(coll.objects))
            remove_ids([m for m in meshes if m.users == 0])
            bpy.data.collections.remove(coll)
            built[-1] = (ch, None, None)
        timings[ch['id']] = round(time.time() - ts, 2)
        log('done', ch['id'], timings[ch['id']], 's')

    if opts['lineup'] and built and not sprites_only:
        ts = time.time()
        for ob in portrait_lights: bpy.data.objects.remove(ob, do_unlink=True)
        if floor: bpy.data.objects.remove(floor, do_unlink=True)
        n = len(built)
        rows = math.ceil(n / 12)
        cols = math.ceil(n / rows)
        sx, sz = 0.95, 1.95
        labels = bpy.data.collections.new('labels'); scene.collection.children.link(labels)
        for i, (ch, coll, root) in enumerate(built):
            coll.hide_render = False
            r, c = divmod(i, cols)
            in_row = min(cols, n - r * cols)
            x = (c - (in_row - 1) / 2) * sx
            z = (rows - 1 - r) * sz
            root.location = (x, 0, z)
            root.rotation_euler = (0, 0, -0.35)
            plate = bpy.data.objects.new('plate', None)
            bm = rbox(0.86, 0.02, 0.2, 0.04)
            me = bpy.data.meshes.new('plate'); bm.to_mesh(me); bm.free(); me.materials.append(mat('#0d141b', 'plastic'))
            plate = bpy.data.objects.new('plate', me); labels.objects.link(plate)
            plate.location = (x, -0.45, z - 0.16)
            text_obj(labels, ch['name'], 0.085, (x, -0.47, z - 0.13), '#ffffff', 1.0)
            if ch['title']:
                text_obj(labels, ch['title'], 0.05, (x, -0.47, z - 0.215), ch['look'].accent, 1.0)
            edge = bpy.data.meshes.new('edge'); bm = rbox(0.86, 0.022, 0.012, 0.005); bm.to_mesh(edge); bm.free()
            edge.materials.append(mat(ch['look'].accent, 'glow', 2.0))
            eo = bpy.data.objects.new('edge', edge); labels.objects.link(eo); eo.location = (x, -0.452, z - 0.06)
            if engine == 'CYCLES':
                shadow_catcher(scene, engine, 0.45, (x, 0, z))
        world_w = cols * sx + 0.3
        world_h = (rows - 1) * sz + 2.0
        px_w = int(min(2400, max(480, cols * 200)))
        px_h = int(round(px_w * world_h / world_w))
        if px_h > 2400:
            px_h = 2400; px_w = int(round(px_h * world_w / world_h))
        scene.render.resolution_x, scene.render.resolution_y = px_w, px_h
        lcam = make_camera(scene, 'lineup_cam', ortho=True)
        lcam.data.sensor_fit = 'AUTO'
        lcam.data.ortho_scale = max(world_w, world_h)
        mid = Vector((0, 0, ((rows - 1) * sz + 1.7 - 0.3) / 2))
        lcam.location = mid + Vector((0, -12, 0.0))
        look_at(lcam, mid)
        scene.camera = lcam
        span = max(world_w, world_h)
        rig_lights(scene, 0.0, mid, scale=max(1.0, span / 2.0))
        if engine == 'CYCLES':
            try: scene.cycles.samples = max(8, opts['samples'] // 2)
            except AttributeError: pass
        try:
            render_to(scene, os.path.join(out_dir, 'lineup.png'))
            outputs.append('lineup.png')
        except Exception as e:
            errors.append({'id': 'lineup', 'error': str(e)})
        timings['lineup'] = round(time.time() - ts, 2)

    # keep a .blend of the finished scene so the designs can be opened and edited in Blender
    if built and opts.get('blend', True) and not sprites_only:
        try:
            bpy.ops.wm.save_as_mainfile(filepath=os.path.join(out_dir, 'characters.blend'), compress=True)
            outputs.append('characters.blend')
        except Exception as e:
            errors.append({'id': 'blend', 'error': str(e)})

    result = {'ok': bool(outputs) or not roster, 'outputs': outputs, 'engine': engine, 'blender': bpy.app.version_string,
              'count': len(built), 'seconds': round(time.time() - t0, 2), 'timings': timings}
    if sprite_rig: result['sprites'] = {'frames': SPRITE_FRAMES, 'w': SPRITE_W, 'h': SPRITE_H}
    if errors: result['errors'] = errors[:20]
    print(json.dumps(result), flush=True)
    return 0 if result['ok'] else 1


if __name__ == '__main__':
    try:
        code = main()
    except SystemExit:
        raise
    except Exception as e:
        print(json.dumps({'ok': False, 'error': str(e)}), flush=True)
        code = 1
    if code:
        sys.exit(code)
