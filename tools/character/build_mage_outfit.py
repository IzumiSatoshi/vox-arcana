"""Dress a VRM 1.0 humanoid as a battle mage, headless in Blender.

Run with Blender 4.2+ (or the `bpy` wheel) and the VRM Add-on for Blender enabled:

    blender -b -P tools/character/build_mage_outfit.py -- in.vrm out.vrm

The outfit is modelled from the body itself: bodice, collar, sleeves and boots are rings fitted to the body's own
cross-sections (T-pose), the coat skirt flares from the waist and splits at the front, and the witch hat sits on the
head. Everything is skinned from the body (Data Transfer), except the skirt, whose weights blend hips into the legs so
it swings with the stride, and the hat, which follows the head. The T-shirt and shorts are removed.

Material names are part of the game contract: `Robe`, `Lining` and `Hat` are tinted per mage in anime-mage.js.
Coordinates: Blender Z-up, the model faces -Y, left arm along +X.
"""
import math
import sys

import bpy
from mathutils import Vector

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else sys.argv[-2:]
SRC, DST = argv[0], argv[1]

bpy.ops.wm.read_factory_settings(use_empty=True)
import addon_utils  # noqa: E402

addon_utils.enable('io_scene_vrm', default_set=True, persistent=True)
bpy.ops.import_scene.vrm(filepath=SRC)
arm = bpy.data.objects['Armature']
body = bpy.data.objects['Body']
TAU = math.tau

# ------------------------------------------------------------------ materials
TEMPLATE = bpy.data.materials['Tops_01_CLOTH']


def mtoon(name, color, shade, outline=0.0008, double=False):
    m = TEMPLATE.copy()
    m.name = name
    ext = m.vrm_addon_extension.mtoon1
    ext.pbr_metallic_roughness.base_color_texture.index.source = None
    ext.pbr_metallic_roughness.base_color_factor = (*color, 1.0)
    mt = ext.extensions.vrmc_materials_mtoon
    mt.shade_color_factor = shade
    mt.shading_toony_factor = 0.92
    mt.shading_shift_factor = -0.1
    mt.outline_width_factor = outline
    mt.outline_color_factor = (0.05, 0.03, 0.06)
    ext.double_sided = double
    return m


def srgb(h):
    c = [((h >> s) & 255) / 255 for s in (16, 8, 0)]
    return tuple(x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4 for x in c)


def dim(c, k):
    return tuple(x * k for x in c)


ROBE = srgb(0x3a3f86)
MATS = {
    'Robe': mtoon('Robe', ROBE, dim(ROBE, 0.55)),
    'Lining': mtoon('Lining', srgb(0xb8364f), dim(srgb(0xb8364f), 0.5), 0.0),
    'Trim': mtoon('Trim', srgb(0xe8c066), srgb(0x9c6a2a), 0.0005),
    'Leather': mtoon('Leather', srgb(0x4a2f24), srgb(0x24140f), 0.0006),
    'Hat': mtoon('Hat', srgb(0x2b2750), srgb(0x16132c), 0.001),
}

# ------------------------------------------------------------------ strip the T-shirt and shorts
me = body.data
drop = {i for i, m in enumerate(me.materials) if m and (m.name.startswith('Tops') or m.name.startswith('Bottoms'))}
bpy.context.view_layer.objects.active = body
bpy.ops.object.mode_set(mode='EDIT')
bpy.ops.mesh.select_all(action='DESELECT')
bpy.ops.object.mode_set(mode='OBJECT')
for p in me.polygons:
    p.select = p.material_index in drop
bpy.ops.object.mode_set(mode='EDIT')
bpy.ops.mesh.delete(type='FACE')
bpy.ops.object.mode_set(mode='OBJECT')

# body vertices with their dominant bone, for sampling cross-sections
names = {g.index: g.name for g in body.vertex_groups}
VERTS = []
for v in me.vertices:
    if not v.groups:
        continue
    g = max(v.groups, key=lambda g: g.weight)
    VERTS.append((body.matrix_world @ v.co, names[g.group]))
ARMISH = ('UpperArm', 'LowerArm', 'Hand', 'Thumb', 'Index', 'Middle', 'Ring', 'Little')
LEGISH = ('UpperLeg', 'LowerLeg', 'Foot', 'Toe')


def smooth(vals, passes=2):
    n = len(vals)
    for _ in range(passes):
        vals = [(vals[i - 1] + 2 * vals[i] + vals[(i + 1) % n]) / 4 for i in range(n)]
    return vals


def fill(vals):
    n = len(vals)
    known = [i for i in range(n) if vals[i] is not None]
    if not known:
        return [0.05] * n
    out = []
    for i in range(n):
        if vals[i] is not None:
            out.append(vals[i])
            continue
        a = max((k for k in known if k < i), default=known[-1] - n)
        b = min((k for k in known if k > i), default=known[0] + n)
        t = (i - a) / (b - a)
        out.append(vals[a % n] * (1 - t) + vals[b % n] * t)
    return out


def section_torso(z, yc, bins, band=0.018, legs=False):
    """Max radius per angle (0 = front, -Y) of the torso at height z, arms excluded."""
    r = [None] * bins
    for co, g in VERTS:
        if abs(co.z - z) > band or any(k in g for k in ARMISH) or (not legs and any(k in g for k in LEGISH)):
            continue
        dx, dy = co.x, co.y - yc
        a = math.atan2(dx, -dy) % TAU
        i = int(a / TAU * bins) % bins
        d = math.hypot(dx, dy)
        if r[i] is None or d > r[i]:
            r[i] = d
    return smooth(fill(r))


def section_limb(p0, axis, s, bins, keys, band=0.014, rmin=0.03):
    """Max radius per angle round a limb axis at distance s from p0."""
    c = p0 + axis * s
    up = Vector((0, 0, 1)) if abs(axis.z) < 0.9 else Vector((0, -1, 0))
    u = (up - axis * up.dot(axis)).normalized()
    w = axis.cross(u)
    r = [None] * bins
    for co, g in VERTS:
        if not any(k in g for k in keys):
            continue
        d = co - c
        if abs(d.dot(axis)) > band:
            continue
        pu, pw = d.dot(u), d.dot(w)
        a = math.atan2(pw, pu) % TAU
        i = int(a / TAU * bins) % bins
        rr = math.hypot(pu, pw)
        if rr < 0.2 and (r[i] is None or rr > r[i]):
            r[i] = rr
    return [max(rmin, x) for x in smooth(fill(r))], c, u, w


def bone_head(n):
    return arm.matrix_world @ arm.data.bones[n].head_local


# ------------------------------------------------------------------ mesh building
PIECES = []


def grid(name, rings, mat, closed=True, weights=None, face='out', axis=None):
    """rings: list of lists of Vector (same length). Quads between consecutive rings.

    face: which way the surface faces -- 'out'/'in' (away from / toward the ring's centre, or `axis(co)` when given),
    'up' or 'down'. Faces are wound to match, so MToon's outline hull always wraps the outside.
    """
    verts = [v for ring in rings for v in ring]
    n = len(rings[0])
    cents = [sum(r, Vector()) / len(r) for r in rings]
    faces = []
    for j in range(len(rings) - 1):
        for i in range(n if closed else n - 1):
            a, b = j * n + i, j * n + (i + 1) % n
            faces.append((a, b, b + n, a + n))
    score = 0.0
    for f in faces:
        p = [verts[k] for k in f]
        nrm = (p[1] - p[0]).cross(p[3] - p[0])
        c = sum(p, Vector()) / 4
        if face in ('up', 'down'):
            ref = Vector((0, 0, 1 if face == 'up' else -1))
        else:
            ctr = axis(c) if axis else (cents[f[0] // n] + cents[f[3] // n]) / 2
            ref = (c - ctr) * (1 if face == 'out' else -1)
        score += nrm.dot(ref)
    if score < 0:
        faces = [tuple(reversed(f)) for f in faces]
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata([tuple(v) for v in verts], [], faces)
    mesh.update()
    uv = mesh.uv_layers.new(name='UVMap')
    for poly in mesh.polygons:
        for li in poly.loop_indices:
            vi = mesh.loops[li].vertex_index
            j, i = divmod(vi, n)
            uv.data[li].uv = (i / n, j / max(1, len(rings) - 1))
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(obj)
    mesh.materials.append(MATS[mat])
    for poly in mesh.polygons:
        poly.use_smooth = True
    PIECES.append((obj, weights))
    return obj


def ring_torso(z, yc, radii, off, a0=0.0, a1=TAU, count=None, depth=1.0):
    bins = len(radii)
    count = count or bins
    pts = []
    closed = (a1 - a0) >= TAU - 1e-6
    for k in range(count):
        a = a0 + (a1 - a0) * (k / count if closed else k / (count - 1))
        f = (a % TAU) / TAU * bins
        i0 = int(f) % bins
        t = f - int(f)
        r = radii[i0] * (1 - t) + radii[(i0 + 1) % bins] * t + off
        pts.append(Vector((math.sin(a) * r, yc - math.cos(a) * r * depth, z)))
    return pts


def spine_y(z):
    pts = [bone_head(n) for n in ('J_Bip_C_Hips', 'J_Bip_C_Spine', 'J_Bip_C_Chest', 'J_Bip_C_UpperChest', 'J_Bip_C_Neck', 'J_Bip_C_Head')]
    for a, b in zip(pts, pts[1:]):
        if a.z <= z <= b.z:
            t = (z - a.z) / (b.z - a.z)
            return a.y * (1 - t) + b.y * t
    return pts[0].y if z < pts[0].z else pts[-1].y


BINS = 40
# bodice: waist to neck, fitted over the skin
bodice = []
zs = [0.9 + k * 0.02 for k in range(24)]  # 0.90 .. 1.36
secs = [smooth(section_torso(z, spine_y(z), BINS), 3) for z in zs]
for _ in range(3):  # smooth down the body too, so cloth bridges the bust instead of creasing into it
    secs = [[(secs[max(0, j - 1)][i] + 2 * secs[j][i] + secs[min(len(secs) - 1, j + 1)][i]) / 4 for i in range(BINS)] for j in range(len(secs))]
for z, sec in zip(zs, secs):
    bodice.append(ring_torso(z, spine_y(z), sec, 0.014 if z < 1.3 else 0.011))
grid('Bodice', bodice, 'Robe')

# high collar: flares out from the neck, open at the throat
nz = 1.345
nrad = section_torso(nz, spine_y(nz), BINS)
col = []
OPEN = math.radians(26)
for k in range(6):
    t = k / 5
    z = nz + t * 0.13
    col.append(ring_torso(z, spine_y(nz) + t * 0.01, nrad, 0.012 + t * t * 0.05, OPEN, TAU - OPEN, 30))
grid('Collar', col, 'Robe', closed=False, axis=lambda c: Vector((0, spine_y(nz), c.z)))
grid('CollarLining', [[p + (Vector((0, spine_y(nz), p.z)) - Vector((p.x, p.y, p.z))).normalized() * 0.004 for p in r] for r in col], 'Lining', closed=False, face='in', axis=lambda c: Vector((0, spine_y(nz), c.z)))
grid('CollarTrim', [col[-1], [p + Vector((0, 0, 0.018)) + (Vector((p.x, p.y - spine_y(nz), 0)).normalized() * 0.006) for p in col[-1]]], 'Trim', closed=False, axis=lambda c: Vector((0, spine_y(nz), c.z)))

# capelet: a short shoulder cape over the collar seam, skinned to the chest and shoulders (it drapes as the arms fall)
cap = []
cz0, cz1 = 1.355, 1.17
COPEN = math.radians(24)
for k in range(6):
    t = k / 5
    z = cz0 - t * (cz0 - cz1)
    yc = spine_y(z)
    sec = section_torso(max(z, 1.22), yc, BINS)
    ring = []
    for i in range(40):
        a = COPEN + (TAU - 2 * COPEN) * i / 39  # open at the front so the placket shows
        rr = sec[int((a % TAU) / TAU * BINS) % BINS]
        r = max(rr, 0.07 + (1 - (1 - t) ** 3) * 0.11 * (0.55 + 0.45 * abs(math.sin(a)))) + 0.018 + 0.012 * t  # rounds over the shoulder, then falls
        ring.append(Vector((math.sin(a) * r, yc - math.cos(a) * r * 0.85, z)))
    cap.append(ring)
CAX = lambda c: Vector((0, spine_y(c.z), c.z))  # noqa: E731


def cape_w(co):  # rides the chest and shoulders only: arm weights would crumple it when the arms fall
    k = max(0.0, min(1.0, (abs(co.x) - 0.05) / 0.12)) * 0.6
    side = 'L' if co.x > 0 else 'R'
    return {'J_Bip_C_UpperChest': 1 - k, f'J_Bip_{side}_Shoulder': k}


grid('Capelet', cap, 'Robe', closed=False, axis=CAX, weights=cape_w)
grid('CapeletLining', [[p - (p - CAX(p)).normalized() * 0.004 for p in r] for r in cap], 'Lining', closed=False, face='in', axis=CAX, weights=cape_w)
grid('CapeletHem', [[p + (p - CAX(p)).normalized() * 0.003 + Vector((0, 0, 0.04)) for p in cap[-1]], [p + (p - CAX(p)).normalized() * 0.003 for p in cap[-1]]], 'Trim', closed=False, axis=CAX, weights=cape_w)

# front closure: a gold placket down the bodice with three buttons
def bodice_front(z, lift):
    """Point on the bodice's centre front at height z, lifted off the cloth."""
    j = min(range(len(zs)), key=lambda q: abs(zs[q] - z))
    p = bodice[j][0]
    c = Vector((0, spine_y(p.z), p.z))
    return p + (p - c).normalized() * lift


plk = [[bodice_front(zs[j], 0.003) + Vector((x, 0, 0)) for x in (-0.012, 0, 0.012)] for j in range(3, 20)]
grid('Placket', plk, 'Trim', closed=False, axis=lambda c: Vector((0, c.y + 1, c.z)))
for z in (1.02, 1.1, 1.18):
    p = bodice_front(z, 0.006)
    btn = [[p + Vector((math.cos(a) * r, -h, math.sin(a) * r)) for a in (TAU * i / 10 for i in range(10))] for r, h in ((0.011, 0.0), (0.009, 0.006), (0.001, 0.008))]
    grid(f'Button{z}', btn, 'Trim', axis=lambda c: Vector((c.x, c.y + 1, c.z)))

# coat skirt: from the waist to the ankles, flaring, split at the front
SPLIT = math.radians(30)
ztop = 0.92
top = section_torso(ztop, spine_y(ztop), BINS, legs=True)
sm = lambda t: 0.04 + 0.96 * min(1.0, max(0.0, (t - 0.12) / 0.3)) ** 2 * (3 - 2 * min(1.0, max(0.0, (t - 0.12) / 0.3)))  # noqa: E731  closed over the hips, split below
skirt = []
SK = 16
for k in range(SK + 1):
    t = k / SK
    z = ztop - t * (ztop - 0.13)
    skirt.append(ring_torso(z, spine_y(ztop) + t * 0.02, top, 0.018 + 0.3 * t ** 1.15 * (ztop - 0.13), SPLIT * sm(t), TAU - SPLIT * sm(t), 44, depth=0.92 + 0.08 * t))


def skirt_weights(co):
    t = max(0.0, min(1.0, (0.86 - co.z) / 0.62))
    side = co.x / max(0.05, math.hypot(co.x, co.y))
    wl = t * 0.8 * max(0.0, min(1.0, (side + 0.25) / 0.85))
    wr = t * 0.8 * max(0.0, min(1.0, (-side + 0.25) / 0.85))
    return {'J_Bip_C_Hips': max(0.0, 1 - wl - wr), 'J_Bip_L_UpperLeg': wl, 'J_Bip_R_UpperLeg': wr}


TAX = lambda c: Vector((0, spine_y(ztop), c.z))  # noqa: E731
grid('Skirt', skirt, 'Robe', closed=False, weights=skirt_weights, axis=TAX)
inward = lambda ring, d: [p - Vector((p.x, p.y - spine_y(ztop), 0)).normalized() * d for p in ring]  # noqa: E731
grid('SkirtLining', [inward(r, 0.005) for r in skirt], 'Lining', closed=False, weights=skirt_weights, face='in', axis=TAX)
outward = lambda ring, d: [p + Vector((p.x, p.y - spine_y(ztop), 0)).normalized() * d for p in ring]  # noqa: E731
hem = skirt[-1]
grid('SkirtHem', [outward([p + Vector((0, 0, 0.055)) for p in hem], 0.004), outward(hem, 0.004)], 'Trim', closed=False, weights=skirt_weights, axis=TAX)
for edge in (0, -1):  # gold facing down both edges of the front split
    strip = []
    for r in skirt:
        p = r[edge]
        c = Vector((0, spine_y(ztop), p.z))
        tang = (Vector((p.x, p.y, 0)) - Vector((0, c.y, 0))).normalized().cross(Vector((0, 0, 1))) * (1 if edge == 0 else -1)
        o = (p - c).normalized() * 0.004
        strip.append([p + o, p + o + Vector((tang.x, tang.y, 0)).normalized() * 0.035])
    rings = [[s[0] for s in strip], [s[1] for s in strip]]
    grid(f'SkirtFacing{edge}', [list(x) for x in zip(*rings)], 'Trim', closed=False, weights=skirt_weights, axis=TAX)

# belt with a buckle
bz = 0.935
brad = section_torso(bz, spine_y(bz), BINS, legs=True)
grid('Belt', [ring_torso(bz - 0.028, spine_y(bz), brad, 0.03), ring_torso(bz + 0.028, spine_y(bz), brad, 0.03)], 'Leather')
fr = ring_torso(bz, spine_y(bz), brad, 0.036, 0, TAU, BINS)[0]
buck = []
for k in range(5):
    z = bz - 0.03 + k * 0.015
    buck.append([fr + Vector((x, 0, z - bz)) for x in (-0.03, -0.015, 0, 0.015, 0.03)])
grid('Buckle', buck, 'Trim', closed=False, axis=lambda c: Vector((0, c.y + 1, c.z)))

# sleeves: fitted from the shoulder, belling out past the wrist; lining inside the bell, a gold cuff at its mouth
for side, s in (('L', 1), ('R', -1)):
    p0 = bone_head(f'J_Bip_{side}_UpperArm')
    wrist = bone_head(f'J_Bip_{side}_Hand')
    axis = (wrist - p0).normalized()
    L = (wrist - p0).length
    rings, bell0 = [], L * 0.72
    samples = [-0.03 + k * 0.03 for k in range(int((L + 0.015) / 0.03) + 1)]  # the mouth stops at the wrist: in first person a longer bell hides the hands
    for d in samples:
        dd = min(max(d, 0.04), L - 0.02)
        radii, c, u, w = section_limb(p0, axis, dd, 24, ('UpperArm', 'LowerArm', 'Roll', 'Aim'), rmin=0.032)
        c = p0 + axis * d
        flare = max(0.0, (d - bell0) / (L + 0.015 - bell0)) ** 1.6 * 0.05
        rings.append([c + (u * math.cos(a) + w * math.sin(a)) * (radii[i] + 0.014 + flare + (0.01 if d < 0.03 else 0)) for i, a in enumerate(TAU * k / 24 for k in range(24))])
    grid(f'Sleeve{side}', rings, 'Robe')
    k0 = next(i for i, d in enumerate(samples) if d > bell0)
    grid(f'SleeveLining{side}', [[c - (c - (p0 + axis * samples[j])).normalized() * 0.004 for c in rings[j]] for j in range(k0, len(rings))], 'Lining', face='in')
    mouth = rings[-1]
    grid(f'Cuff{side}', [mouth, [p + axis * -0.03 + (p - (p0 + axis * samples[-1])).normalized() * 0.004 for p in mouth]], 'Trim')

# boots: over the shins, a folded cuff under the knee
for side in ('L', 'R'):
    k = bone_head(f'J_Bip_{side}_LowerLeg')
    a = bone_head(f'J_Bip_{side}_Foot')
    axis = (a - k).normalized()
    L = (a - k).length
    rings = []
    for j in range(12):
        d = L * (0.2 + 0.8 * j / 11)
        radii, c, u, w = section_limb(k, axis, d, 20, ('LowerLeg', 'Foot'), rmin=0.03)
        rings.append([c + (u * math.cos(t) + w * math.sin(t)) * (radii[i] + 0.012) for i, t in enumerate(TAU * q / 20 for q in range(20))])
    grid(f'Boot{side}', rings, 'Leather')
    c0 = k + axis * L * 0.2
    top = rings[0]
    grid(f'BootCuff{side}', [[p + (p - c0).normalized() * 0.012 + axis * 0.04 for p in top], [p + (p - c0).normalized() * 0.016 - axis * 0.012 for p in top]], 'Leather')

# witch hat: drooping brim, crown bent back at the tip, gold band
head = bone_head('J_Bip_C_Head')
HB = Vector((0, head.y - 0.005, 1.565))


def hat_w(co):
    return {'J_Bip_C_Head': 1.0}


brim = []
for j, (r, dz) in enumerate([(0.15, 0.012), (0.2, 0.01), (0.27, 0.0), (0.34, -0.018), (0.41, -0.045)]):
    ring = []
    for i in range(48):
        a = TAU * i / 48
        droop = max(0.0, math.cos(a)) * (r - 0.15) * 0.25  # front (-Y) dips a little lower
        ring.append(HB + Vector((math.sin(a) * r, -math.cos(a) * r, dz - droop + math.sin(a * 3) * 0.006 * r)))
    brim.append(ring)
grid('HatBrim', brim, 'Hat', weights=hat_w, face='up')
grid('HatBrimUnder', [[p - Vector((0, 0, 0.006)) for p in r] for r in brim], 'Hat', weights=hat_w, face='down')
crown = []
prof = [(0.165, 0.0), (0.16, 0.08), (0.135, 0.18), (0.1, 0.3), (0.065, 0.42), (0.035, 0.52), (0.012, 0.6), (0.001, 0.64)]
for r, h in prof:
    k = max(0.0, h - 0.2)
    ring = []
    for i in range(32):
        a = TAU * i / 32
        ring.append(HB + Vector((math.sin(a) * r, -math.cos(a) * r + k * k * 2.1, h - k * k * 0.7)))
    crown.append(ring)
grid('HatCrown', crown, 'Hat', weights=hat_w)
grid('HatBand', [[HB + Vector((math.sin(a) * 0.168, -math.cos(a) * 0.168, 0.012)) for a in (TAU * i / 32 for i in range(32))],
                 [HB + Vector((math.sin(a) * 0.162, -math.cos(a) * 0.162, 0.06)) for a in (TAU * i / 32 for i in range(32))]], 'Trim', weights=hat_w)

# ------------------------------------------------------------------ skin everything to the armature
for obj, wfn in PIECES:
    for g in body.vertex_groups:
        obj.vertex_groups.new(name=g.name)
    if wfn:
        for v in obj.data.vertices:
            for gname, wt in wfn(obj.matrix_world @ v.co).items():
                if wt > 1e-4:
                    obj.vertex_groups[gname].add([v.index], wt, 'REPLACE')
    else:
        bpy.context.view_layer.objects.active = obj
        mod = obj.modifiers.new('xfer', 'DATA_TRANSFER')
        mod.object = body
        mod.use_vert_data = True
        mod.data_types_verts = {'VGROUP_WEIGHTS'}
        mod.vert_mapping = 'POLYINTERP_NEAREST'
        mod.layers_vgroup_select_src = 'ALL'
        mod.layers_vgroup_select_dst = 'NAME'
        bpy.ops.object.modifier_apply(modifier=mod.name)
        # the bell of a sleeve past the wrist must not twist with the hand
        if obj.name.startswith(('Sleeve', 'Cuff')):
            side = obj.name[-1]
            wrist = bone_head(f'J_Bip_{side}_Hand')
            for v in obj.data.vertices:
                if (v.co.x - wrist.x) * (1 if side == 'L' else -1) > -0.05:
                    for g in list(v.groups):
                        n = obj.vertex_groups[g.group].name
                        if 'Hand' in n or any(f in n for f in ('Thumb', 'Index', 'Middle', 'Ring', 'Little')):
                            obj.vertex_groups[g.group].remove([v.index])
                    obj.vertex_groups[f'J_Bip_{side}_LowerArm'].add([v.index], 0.6, 'ADD')
    obj.parent = arm
    mod = obj.modifiers.new('Armature', 'ARMATURE')
    mod.object = arm

bpy.ops.object.select_all(action='DESELECT')
for obj, _ in PIECES:
    obj.select_set(True)
bpy.context.view_layer.objects.active = PIECES[0][0]
bpy.ops.object.join()
outfit = bpy.context.view_layer.objects.active
outfit.name = 'Outfit'
bpy.ops.object.vertex_group_normalize_all(lock_active=False)
bpy.ops.object.shade_smooth()
print('outfit verts', len(outfit.data.vertices))

# ------------------------------------------------------------------ smaller textures, then export
for img in bpy.data.images:
    if img.size[0] > 1024 and not img.name.startswith('Thumbnail'):
        img.scale(1024, 1024 * img.size[1] // img.size[0])
try:
    arm.data.vrm_addon_extension.vrm1.meta.vrm_name = 'Vox Arcana Mage'
except AttributeError:
    pass
bpy.ops.object.select_all(action='SELECT')
bpy.context.view_layer.objects.active = arm
print('export', bpy.ops.export_scene.vrm(filepath=DST, armature_object_name='Armature'))
