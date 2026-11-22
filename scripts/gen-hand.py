#!/usr/bin/env python3
"""
gen-hand.py — generate, rig and export the wanderer's hand as models/hand.glb.

    pip install numpy scikit-image
    python3 scripts/gen-hand.py            # writes models/hand.glb

GENERATE
  The hand is one implicit surface: a signed-distance field built from
  anatomical parts — a tapered, domed palm, the thenar and hypothenar pads,
  knuckle heads, the wrist and forearm, and each finger as a chain of tapered
  round cones with an elliptical (wider-than-deep) cross-section. Parts are
  joined with a SMOOTH union, so flesh flows between them the way skin does
  (the webs between the fingers, the thumb running into its pad) instead of
  primitives intersecting. Fingers join the palm smoothly but each other only
  with a hard union, so they stay separate fingers rather than a paddle.
  The field is polygonised with marching cubes and Taubin-smoothed.

  Proportions are a real adult hand, in centimetres: palm ~8.4 wide and 9.6
  long; middle finger 8.2, index 7.4, ring 7.7, little 6.0; phalanges in a
  roughly 46 : 29 : 25 ratio; the knuckle line arcs (middle highest).

RIG
  A skeleton of 21 bones: the wrist, and per finger (and the thumb) three
  bones plus a tip end. Every vertex knows which anatomical part it came from
  (the part nearest to it in the field), and is weighted along that part's
  bone chain with smooth blends across each joint — so a knuckle bends like
  flesh, and a finger never drags its neighbour.

  Bind pose: fingers straight, the right hand's back facing +Z, fingers up
  +Y, thumb out toward -X. Finger bones have identity bind rotation, so in the
  game a curl is a rotation about the bone's local X (negative = toward the
  palm). The thumb's bones are rotated so their local Y runs along the thumb
  and local Z out of its nail: its flex is local X as well.

NAILS
  Vertices on the back of each last joint, inside a nail-shaped region, are
  lifted a fraction and their triangles moved to a second primitive with its
  own material. Vertex colours carry the flush of the fingertips and knuckles.

EXPORT
  A hand-written binary glTF 2.0 (no exporter dependency): positions,
  normals, COLOR_0, JOINTS_0, WEIGHTS_0, two indexed primitives, one skin.
"""
import json, math, struct, os, sys
import numpy as np
from skimage import measure

H = 0.17                          # voxel size, cm  (~35k triangles)
OUT = os.path.join(os.path.dirname(__file__), '..', 'models', 'hand.glb')

def norm(v): v = np.asarray(v, float); return v / np.linalg.norm(v)

# ---------------------------------------------------------------- anatomy --
WRIST = np.array([0.0, -4.6, 0.1])
# (name, MCP knuckle position, splay angle (+ leans toward -x / the thumb),
#  length MCP→tip, base radius)
FINGERS = [
    ('index',  np.array([-2.78, 4.55, 0.12]),  0.10, 7.9, 0.86),
    ('middle', np.array([-0.93, 4.98, 0.18]),  0.02, 8.7, 0.89),
    ('ring',   np.array([ 0.93, 4.78, 0.12]), -0.07, 8.2, 0.83),
    ('little', np.array([ 2.72, 4.08, 0.02]), -0.17, 6.4, 0.72),
]
SEG = (0.46, 0.29, 0.25)
FLAT = 0.85                        # finger depth / width

THUMB_CMC = np.array([-2.3, -2.9, -0.55])
THUMB_DIR = norm([-0.60, 0.74, -0.30])
THUMB_LEN = (4.3, 3.3, 2.7)        # metacarpal (mostly inside the pad), proximal, distal
THUMB_R = (1.3, 1.1, 1.0, 0.93)

def frame_from(y, zhint):
    y = norm(y); z = np.asarray(zhint, float); z = norm(z - z.dot(y) * y); x = np.cross(y, z)
    return x, y, z
TX, TY, TZ = frame_from(THUMB_DIR, [-0.3, 0.1, 0.95])

def chain_points(base, d, lens):
    pts = [base]
    for L in lens: pts.append(pts[-1] + d * L)
    return pts

chains = []        # per chain: joints (4 points), dir, radii (4), local frame (x,y,z)
for name, mcp, a, L, r in FINGERS:
    d = np.array([-math.sin(a), math.cos(a), 0.0])
    lens = [L * s for s in SEG]
    lens[2] -= r * 0.62                      # the tip cap adds its own length
    j = chain_points(mcp, d, lens)
    radii = [r, r * 0.9, r * 0.82, r * 0.76]
    chains.append(dict(name=name, j=j, d=d, r=radii, frame=(np.array([math.cos(a), math.sin(a), 0.0]), d, np.array([0, 0, 1.0]))))
tl = list(THUMB_LEN); tl[2] -= THUMB_R[3] * 0.6
chains.append(dict(name='thumb', j=chain_points(THUMB_CMC, THUMB_DIR, tl), d=THUMB_DIR, r=list(THUMB_R), frame=(TX, TY, TZ)))

# ------------------------------------------------------------------- SDF ---
def smin(a, b, k):
    h = np.clip(0.5 + 0.5 * (b - a) / k, 0.0, 1.0)
    return b * (1 - h) + a * h - k * h * (1 - h)

def round_cone(P, a, b, ra, rb, frame=None, flat=1.0):
    """Distance to a tapered capsule a→b (radii ra, rb). With a frame and
    flat<1 the cross-section is an ellipse: depth (frame z) = width * flat."""
    if frame is not None and flat != 1.0:
        fx, fy, fz = frame
        def warp(Q, o):
            q = Q - o
            return np.stack([q @ fx, q @ fy, (q @ fz) / flat], -1)
        Pq = warp(P, a); A = np.zeros(3); B = warp(b[None, :], a)[0]
    else:
        Pq, A, B = P, a, b
    ba = B - A; l2 = ba.dot(ba); l = math.sqrt(l2)
    pa = Pq - A
    t = np.clip((pa @ ba) / l2, 0, 1)
    # tapered: interpolate radius along the axis (good enough for gentle tapers)
    dist = np.linalg.norm(pa - t[..., None] * ba, axis=-1)
    d = dist - (ra + (rb - ra) * t)
    return d

def ellipsoid(P, c, r, rotz=0.0):
    q = P - c
    if rotz:
        cz, sz = math.cos(rotz), math.sin(rotz)
        q = np.stack([q[..., 0] * cz + q[..., 1] * sz, -q[..., 0] * sz + q[..., 1] * cz, q[..., 2]], -1)
    k0 = np.linalg.norm(q / r, axis=-1); k1 = np.linalg.norm(q / (r * r), axis=-1)
    return k0 * (k0 - 1.0) / np.maximum(k1, 1e-6)

def palm_sdf(P):
    x, y, z = P[..., 0], P[..., 1], P[..., 2]
    ky = np.clip((y + 4.6) / 9.4, 0, 1)
    xs = x / (0.84 + 0.16 * ky)                               # narrower at the wrist
    cx = np.clip(np.abs(x) / 4.2, 0, 1)
    ys = y - (0.42 * np.cos(cx * math.pi / 2) - 0.25)         # the knuckle line arcs
    zs = z - 0.28 * np.cos(cx * math.pi / 2)                  # the back of the hand domes
    q = np.stack([np.abs(xs) - 3.05, np.abs(ys - 0.1) - 3.75, np.abs(zs) - 0.22], -1)
    out = np.linalg.norm(np.maximum(q, 0), axis=-1) + np.minimum(np.max(q, -1), 0)
    return out - 1.02

# part ids — the rig uses them to decide which bones a vertex follows
PALM, THENAR, HYPO, ARM = 0, 1, 2, 3
def part_fields(P):
    """Every part's own distance (for labelling), and the blended field."""
    parts = {}
    parts[PALM] = palm_sdf(P)
    parts[THENAR] = ellipsoid(P, np.array([-2.45, -2.35, -0.6]), np.array([2.05, 2.9, 1.42]), 0.42)
    parts[HYPO] = ellipsoid(P, np.array([2.95, -1.1, -0.42]), np.array([1.3, 3.2, 1.15]))
    parts[ARM] = round_cone(P, WRIST + np.array([0, 0.2, 0]), np.array([0, -16.5, 0.35]), 2.55, 3.3,
                            (np.array([1.0, 0, 0]), np.array([0, -1.0, 0]), np.array([0, 0, 1.0])), 0.72)
    body = smin(parts[PALM], parts[THENAR], 1.1)
    body = smin(body, parts[HYPO], 0.9)
    body = smin(body, parts[ARM], 1.3)
    # superficial veins on the back of the hand: thin tubes just under the
    # surface, blended in so they only raise it a little
    vz = lambda x, y: 1.02 + 0.28 * math.cos(min(1, abs(x) / 4.2) * math.pi / 2) - (0.0 if y > -3 else 0.12)
    vein = None
    for (a, b) in [((-0.4, -4.6), (-1.6, 1.2)), ((-1.6, 1.2), (-2.3, 3.4)), ((-1.6, 1.2), (-0.6, 3.6)),
                   ((0.9, -4.2), (1.5, 0.6)), ((1.5, 0.6), (1.9, 3.3)), ((-0.4, -4.6), (0.9, -4.2))]:
        A = np.array([a[0], a[1], vz(*a)]); B = np.array([b[0], b[1], vz(*b)])
        d = round_cone(P, A, B, 0.34, 0.3)
        vein = d if vein is None else np.minimum(vein, d)
    parts[4] = vein
    body = smin(body, vein, 0.6)
    # knuckle heads on the back of the hand
    for ci, c in enumerate(chains[:4]):
        kn = ellipsoid(P, c['j'][0] + np.array([0, -0.35, 0.78]), np.array([0.78, 0.7, 0.5]))
        parts[10 + ci * 10 + 9] = kn
        body = smin(body, kn, 0.55)
    total = None
    for ci, c in enumerate(chains):
        j, r = c['j'], c['r']
        fl = FLAT if ci < 4 else 0.9
        f = None
        for s in range(3):
            d = round_cone(P, j[s], j[s + 1], r[s], r[s + 1], c['frame'], fl)
            if s == 2:   # the pad: a fuller, rounder tip
                d = smin(d, ellipsoid(P, j[3] - c['d'] * r[3] * 0.25 - c['frame'][2] * r[3] * 0.12,
                                      np.array([r[3] * 1.02, r[3] * 1.15, r[3] * 0.92]) if ci < 4 else np.array([r[3]] * 3) * 1.05), 0.35)
            parts[10 + ci * 10 + s] = d
            f = d if f is None else smin(f, d, 0.28)
        k = 0.72 if ci < 4 else 1.1
        joined = smin(body, f, k)
        total = joined if total is None else np.minimum(total, joined)
    return total, parts

# -------------------------------------------------------------- polygonise --
lo = np.array([-10.8, -16.2, -5.4]); hi = np.array([7.4, 14.6, 4.4])
nx, ny, nz = [int(math.ceil((hi[i] - lo[i]) / H)) + 1 for i in range(3)]
print(f'grid {nx}x{ny}x{nz} = {nx*ny*nz/1e6:.1f}M samples', file=sys.stderr)
xs = lo[0] + np.arange(nx) * H; ys = lo[1] + np.arange(ny) * H; zs = lo[2] + np.arange(nz) * H
vol = np.empty((nx, ny, nz), np.float32)
for i in range(nx):                         # slab at a time: memory stays small
    P = np.stack(np.meshgrid(np.full(1, xs[i]), ys, zs, indexing='ij'), -1)[0]
    vol[i] = part_fields(P)[0]
verts, faces, _, _ = measure.marching_cubes(vol, level=0.0, spacing=(H, H, H))
verts = verts + lo
faces = faces.astype(np.int64)
print(f'marching cubes: {len(verts)} verts, {len(faces)} tris', file=sys.stderr)

# ------------------------------------------------------------- smoothing ---
def neighbours(nv, F):
    e = np.concatenate([F[:, [0, 1]], F[:, [1, 2]], F[:, [2, 0]]])
    e = np.concatenate([e, e[:, ::-1]])
    e = np.unique(e, axis=0)
    deg = np.bincount(e[:, 0], minlength=nv).astype(np.float64)
    return e, np.maximum(deg, 1)
E, DEG = neighbours(len(verts), faces)
def laplace(V):
    acc = np.zeros_like(V); np.add.at(acc, E[:, 0], V[E[:, 1]])
    return acc / DEG[:, None] - V
for _ in range(24):                          # Taubin: smooth without shrinking
    verts = verts + 0.5 * laplace(verts)
    verts = verts - 0.53 * laplace(verts)

def vnormals(V, F):
    fn = np.cross(V[F[:, 1]] - V[F[:, 0]], V[F[:, 2]] - V[F[:, 0]])
    n = np.zeros_like(V);
    for k in range(3): np.add.at(n, F[:, k], fn)
    return n / np.maximum(np.linalg.norm(n, axis=1, keepdims=True), 1e-9)
N = vnormals(verts, faces)
# outward? compare with the field's gradient direction at the vertices
g_eps = 0.05
f0 = part_fields(verts)[0]
fx = part_fields(verts + [g_eps, 0, 0])[0] - f0
fy = part_fields(verts + [0, g_eps, 0])[0] - f0
fz = part_fields(verts + [0, 0, g_eps])[0] - f0
grad = np.stack([fx, fy, fz], 1)
if np.mean(np.sum(grad * N, 1)) < 0:
    faces = faces[:, ::-1].copy(); N = -N
print('normals outward', file=sys.stderr)

# ------------------------------------------------------------------ rig -----
_, parts = part_fields(verts)
keys = list(parts.keys())
stack = np.stack([parts[k] for k in keys], 1)
owner = np.array(keys)[np.argmin(stack, 1)]

def sstep(a, b, x):
    t = np.clip((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t)

# bones: 0 wrist; chain c → 1 + c*4 + {0,1,2,3(tip end)}
BONES = ['wrist']
for c in chains:
    BONES += [c['name'] + '1', c['name'] + '2', c['name'] + '3', c['name'] + '_tip']
nb = len(BONES)
W = np.zeros((len(verts), nb))

along = []; lat = []
for c in chains:
    rel = verts - c['j'][0]
    s = rel @ c['d']
    along.append(s); lat.append(np.linalg.norm(rel - s[:, None] * c['d'], axis=1))
along = np.stack(along, 1); lat = np.stack(lat, 1)

chain_of = np.full(len(verts), -1)
for ci in range(5):
    m = (owner >= 10 + ci * 10) & (owner < 20 + ci * 10)
    chain_of[m] = ci
# palm, pads and arm: the nearest of the four fingers' axes, for the blend into its knuckle
nearest4 = np.argmin(lat[:, :4], 1)
body = chain_of < 0
chain_of[body] = nearest4[body]
chain_of[owner == THENAR] = 4
own_finger = ~body | (owner == THENAR)

for ci, c in enumerate(chains):
    m = chain_of == ci
    if not m.any(): continue
    s = along[m, ci]; L = [np.linalg.norm(c['j'][k + 1] - c['j'][k]) for k in range(3)]
    b0 = 1 + ci * 4
    w0 = 0.75 if ci < 4 else 1.0
    a0 = sstep(-w0, w0 * 0.9, s)
    a1 = sstep(L[0] - 0.62, L[0] + 0.62, s)
    a2 = sstep(L[0] + L[1] - 0.5, L[0] + L[1] + 0.5, s)
    # flesh that belongs to the palm only follows the knuckle near it
    if ci < 4:
        own = own_finger[m]
        lf = 1 - sstep(0.7 * c['r'][0], 1.6 * c['r'][0], lat[m, ci])
        a0 = np.where(own, a0, a0 * lf * 0.85)
    else:
        th = (owner[m] == THENAR)
        a0 = np.where(th, sstep(-1.0, 3.2, s) * 0.8, a0)
    idx = np.where(m)[0]
    W[idx, 0] = 1 - a0
    W[idx, b0] = a0 * (1 - a1)
    W[idx, b0 + 1] = a1 * (1 - a2)
    W[idx, b0 + 2] = a2
# the forearm never moves with the fingers
W[owner == ARM] = 0; W[owner == ARM, 0] = 1
W /= np.maximum(W.sum(1, keepdims=True), 1e-9)

top = np.argsort(-W, 1)[:, :4]
JW = np.take_along_axis(W, top, 1)
JW /= np.maximum(JW.sum(1, keepdims=True), 1e-9)
JI = top.astype(np.uint8)
JW[JW < 1e-4] = 0; JW /= JW.sum(1, keepdims=True)

# ------------------------------------------------------------- nails --------
# Each nail is its own small curved plate, built in the last bone's frame and
# draped onto the fingertip: for every point of a nail-shaped grid the skin
# surface is found by bisection along the finger's back direction, and the
# plate sits a hair above it. Skinned 100% to the last bone, so it rides the
# fingertip exactly. A paler free edge at the tip.
f_total = lambda Q: part_fields(Q)[0]
nail_V, nail_F, nail_J, nail_C = [], [], [], []
NU, NW = 14, 9
for ci, c in enumerate(chains):
    j2 = c['j'][2]; fx_, fy_, fz_ = c['frame']; r3 = c['r'][3]
    L3 = np.linalg.norm(c['j'][3] - j2) + r3 * 0.55
    base = len(nail_V)
    for iu in range(NU):
        t = iu / (NU - 1)
        u = L3 * (0.36 + 0.66 * t)
        # outline: narrow-ish at the cuticle, widest two-thirds up, rounded at the tip
        half = r3 * (0.62 + 0.14 * math.sin(min(1, t * 1.4) * math.pi / 2)) * (math.sqrt(max(0, 1 - ((t - 0.78) / 0.24) ** 2)) if t > 0.78 else 1)
        half = max(half, 0.05)
        for iw in range(NW):
            w = (iw / (NW - 1) * 2 - 1) * half
            o = j2 + fy_ * u + fx_ * w
            # never past the end of the finger: pull back until the plate is over flesh
            uu = u
            while f_total(o[None, :])[0] > -0.12 and uu > 0.2:
                uu -= 0.04; o = j2 + fy_ * uu + fx_ * w
            lo_h, hi_h = 0.0, r3 * 2.2                 # inside → outside along the back
            for _ in range(22):
                m_ = 0.5 * (lo_h + hi_h)
                if f_total((o + fz_ * m_)[None, :])[0] < 0: lo_h = m_
                else: hi_h = m_
            edge = abs(w) / half
            h = lo_h + 0.055 - 0.035 * edge ** 4           # proud in the middle, tucked at the sides
            nail_V.append(o + fz_ * h)
            nail_J.append(1 + ci * 4 + 2)
            free = 1.0 if t < 0.84 else 1.0 + (t - 0.84) / 0.16 * 0.35
            nail_C.append([min(1, 0.93 * free), min(1, 0.80 * free), min(1, 0.78 * free)])
    for iu in range(NU - 1):
        for iw in range(NW - 1):
            a0 = base + iu * NW + iw; b0 = a0 + 1; c0 = a0 + NW; d0 = c0 + 1
            nail_F += [[a0, b0, d0], [a0, d0, c0]]
nail_V = np.array(nail_V); nail_F = np.array(nail_F, np.int64)
# orient the plates outward (along each finger's back)
nn = vnormals(nail_V, nail_F)
if np.mean(nn[:, 2]) < 0: nail_F = nail_F[:, ::-1].copy()
print(f'nails: {len(nail_V)} verts', file=sys.stderr)

# ------------------------------------------------------------ colours -------
col = np.ones((len(verts), 3))
flush = np.zeros(len(verts))
for ci, c in enumerate(chains):
    m = chain_of == ci
    s = along[:, ci]; L = [np.linalg.norm(c['j'][k + 1] - c['j'][k]) for k in range(3)]
    tip = sstep(L[0] + L[1] + 0.2, sum(L) + 0.6, s) * m
    dorsal = verts[:, 2] > 0.2
    kn = 0
    for J in (0.0, L[0], L[0] + L[1]):
        kn = np.maximum(kn, (1 - sstep(0.0, 0.75, np.abs(s - J))) * dorsal * m * 0.7)
    flush = np.maximum(flush, np.maximum(tip, kn))
palmside = sstep(0.0, -1.2, verts[:, 2]) * (owner != ARM)
col[:, 0] = 1.0 + 0.04 * palmside
col[:, 1] = 1.0 - 0.18 * flush + 0.03 * palmside
col[:, 2] = 1.0 - 0.22 * flush + 0.02 * palmside
col = np.clip(col * np.array([0.98, 0.98, 0.98]), 0, 1)

# --------------------------------------------------------- primitives -------
nv = len(verts)
skin_faces = faces
nail_faces = nail_F + nv
JI = np.concatenate([JI, np.stack([np.array(nail_J), np.zeros(len(nail_J)), np.zeros(len(nail_J)), np.zeros(len(nail_J))], 1).astype(np.uint8)])
JW = np.concatenate([JW, np.tile([[1.0, 0, 0, 0]], (len(nail_V), 1))])
col = np.concatenate([col, np.array(nail_C)])
NORM_ALL = np.concatenate([vnormals(verts, faces), vnormals(nail_V, nail_F)])
verts = np.concatenate([verts, nail_V])
print(f'skin tris {len(skin_faces)}, nail tris {len(nail_faces)}', file=sys.stderr)

# ------------------------------------------------------------ skeleton ------
def quat_from_frame(x, y, z):
    m = np.array([x, y, z]).T
    t = np.trace(m)
    if t > 0:
        s = math.sqrt(t + 1) * 2; w = s / 4; qx = (m[2, 1] - m[1, 2]) / s; qy = (m[0, 2] - m[2, 0]) / s; qz = (m[1, 0] - m[0, 1]) / s
    elif m[0, 0] > m[1, 1] and m[0, 0] > m[2, 2]:
        s = math.sqrt(1 + m[0, 0] - m[1, 1] - m[2, 2]) * 2; w = (m[2, 1] - m[1, 2]) / s; qx = s / 4; qy = (m[0, 1] + m[1, 0]) / s; qz = (m[0, 2] + m[2, 0]) / s
    elif m[1, 1] > m[2, 2]:
        s = math.sqrt(1 + m[1, 1] - m[0, 0] - m[2, 2]) * 2; w = (m[0, 2] - m[2, 0]) / s; qx = (m[0, 1] + m[1, 0]) / s; qy = s / 4; qz = (m[1, 2] + m[2, 1]) / s
    else:
        s = math.sqrt(1 + m[2, 2] - m[0, 0] - m[1, 1]) * 2; w = (m[1, 0] - m[0, 1]) / s; qx = (m[0, 2] + m[2, 0]) / s; qy = (m[1, 2] + m[2, 1]) / s; qz = s / 4
    return [qx, qy, qz, w]

nodes = []
world = []          # world 4x4 per bone (bind)
def mat(t, R=np.eye(3)):
    M = np.eye(4); M[:3, :3] = R; M[:3, 3] = t; return M
nodes.append(dict(name='wrist', translation=WRIST.tolist(), children=[]))
world.append(mat(WRIST))
for ci, c in enumerate(chains):
    R = np.eye(3) if ci < 4 else np.array(c['frame']).T
    parent = 0
    for k in range(4):
        idx = len(nodes)
        Pw = world[parent]
        if k == 0:
            local_t = (np.linalg.inv(Pw) @ np.append(c['j'][0], 1))[:3]
            node = dict(name=BONES[idx], translation=local_t.tolist(), children=[])
            if ci == 4: node['rotation'] = quat_from_frame(*c['frame'])
            world.append(mat(c['j'][0], R))
        else:
            L = np.linalg.norm(c['j'][k] - c['j'][k - 1])
            node = dict(name=BONES[idx], translation=[0.0, float(L), 0.0], children=[])
            world.append(world[parent] @ mat([0, L, 0]))
        nodes.append(node); nodes[parent]['children'].append(idx)
        parent = idx
ibm = np.array([np.linalg.inv(Mw).T.reshape(-1) for Mw in world], np.float32)  # column-major

# -------------------------------------------------------------- write GLB ---
bin_ = bytearray(); views = []; accs = []
def add(arr, target=None, comp=5126, typ='VEC3', normalized=False, minmax=False):
    global bin_
    while len(bin_) % 4: bin_ += b'\0'
    b = arr.tobytes()
    v = dict(buffer=0, byteOffset=len(bin_), byteLength=len(b))
    if target: v['target'] = target
    views.append(v); bin_ += b
    a = dict(bufferView=len(views) - 1, componentType=comp, count=int(arr.shape[0]), type=typ)
    if normalized: a['normalized'] = True
    if minmax: a['min'] = arr.min(0).tolist(); a['max'] = arr.max(0).tolist()
    accs.append(a); return len(accs) - 1
iP = add(verts.astype(np.float32), 34962, minmax=True)
iN = add(NORM_ALL.astype(np.float32), 34962)
iC = add(col.astype(np.float32), 34962)
iJ = add(JI, 34962, comp=5121, typ='VEC4')
iW = add(JW.astype(np.float32), 34962, typ='VEC4')
big = len(verts) > 65535
itype, icomp = (np.uint32, 5125) if big else (np.uint16, 5123)
iS = add(skin_faces.reshape(-1).astype(itype), 34963, comp=icomp, typ='SCALAR')
iNl = add(nail_faces.reshape(-1).astype(itype), 34963, comp=icomp, typ='SCALAR')
iI = add(ibm, None, typ='MAT4')
attrs = dict(POSITION=iP, NORMAL=iN, COLOR_0=iC, JOINTS_0=iJ, WEIGHTS_0=iW)
mesh_node = len(nodes)
nodes.append(dict(name='Hand', mesh=0, skin=0))
gltf = dict(
    asset=dict(version='2.0', generator='abductor scripts/gen-hand.py'),
    scene=0, scenes=[dict(nodes=[0, mesh_node])],
    nodes=nodes,
    meshes=[dict(name='Hand', primitives=[dict(attributes=attrs, indices=iS, material=0),
                                          dict(attributes=attrs, indices=iNl, material=1)])],
    materials=[dict(name='skin', pbrMetallicRoughness=dict(baseColorFactor=[0.69, 0.36, 0.23, 1], metallicFactor=0, roughnessFactor=0.55)),
               dict(name='nail', pbrMetallicRoughness=dict(baseColorFactor=[0.84, 0.56, 0.48, 1], metallicFactor=0, roughnessFactor=0.25))],
    skins=[dict(name='HandRig', joints=list(range(nb)), skeleton=0, inverseBindMatrices=iI)],
    accessors=accs, bufferViews=views, buffers=[dict(byteLength=len(bin_))],
)
js = json.dumps(gltf, separators=(',', ':')).encode()
while len(js) % 4: js += b' '
while len(bin_) % 4: bin_ += b'\0'
glb = struct.pack('<III', 0x46546C67, 2, 12 + 8 + len(js) + 8 + len(bin_))
glb += struct.pack('<II', len(js), 0x4E4F534A) + js + struct.pack('<II', len(bin_), 0x004E4942) + bytes(bin_)
os.makedirs(os.path.dirname(OUT), exist_ok=True)
open(OUT, 'wb').write(glb)
print(f'wrote {OUT}: {len(glb)/1e6:.2f} MB, {len(verts)} verts, {len(skin_faces)+len(nail_faces)} tris, {nb} bones', file=sys.stderr)
