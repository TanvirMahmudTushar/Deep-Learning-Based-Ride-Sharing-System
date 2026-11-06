"use client";

import { useEffect, useRef } from "react";
import * as THREE from "three";

/**
 * A looping 3D story of one ride: demand heats up a zone, a passenger requests, nearby riders are
 * scored, one is matched, drives to the pickup and then along the trip route to the drop.
 * Everything else (ambient traffic, demand glow, camera drift) is there to make the city feel alive.
 */

const N = 5; // grid half-extent in blocks
const S = 4; // distance between roads
const ROAD_W = 1.1;
const LANE = 0.24;
const BG = 0x0a0a0a;
const ACCENT = new THREE.Color(0x2dd4bf);
const AMBER = new THREE.Color(0xf59e0b);
const WHITE = new THREE.Color(0xf5f5f4);
const VEHICLE = new THREE.Color(0x9a9a9e);

type Node = { x: number; z: number };
type Kind = "bike" | "cng" | "car";

const SPEED: Record<Kind, number> = { bike: 2.6, cng: 1.9, car: 2.3 };
const ZONES: Node[] = [
  { x: -3, z: -2 },
  { x: 2, z: 3 },
  { x: 3, z: -3 },
  { x: -2, z: 3 },
];

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const same = (a: Node, b: Node) => a.x === b.x && a.z === b.z;
const inBounds = (n: Node) => Math.abs(n.x) <= N && Math.abs(n.z) <= N;
const toWorld = (n: Node, y = 0) => new THREE.Vector3(n.x * S, y, n.z * S);
const rand = (min: number, max: number) => min + Math.random() * (max - min);
const damp = (current: number, target: number, dt: number, rate = 4) => current + (target - current) * Math.min(1, dt * rate);

function randomNeighbor(from: Node, prev: Node | null): Node {
  const options: { n: Node; w: number }[] = [];
  const heading = prev ? { x: from.x - prev.x, z: from.z - prev.z } : null;
  for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    const n = { x: from.x + dx, z: from.z + dz };
    if (!inBounds(n) || (prev && same(n, prev))) continue;
    options.push({ n, w: heading && heading.x === dx && heading.z === dz ? 3 : 1 });
  }
  let r = Math.random() * options.reduce((s, o) => s + o.w, 0);
  for (const o of options) {
    r -= o.w;
    if (r <= 0) return o.n;
  }
  return options[0].n;
}

function manhattan(a: Node, b: Node, xFirst: boolean): Node[] {
  const nodes = [a];
  let { x, z } = a;
  const stepX = () => {
    while (x !== b.x) nodes.push({ x: (x += Math.sign(b.x - x)), z });
  };
  const stepZ = () => {
    while (z !== b.z) nodes.push({ x, z: (z += Math.sign(b.z - z)) });
  };
  if (xFirst) {
    stepX();
    stepZ();
  } else {
    stepZ();
    stepX();
  }
  return nodes;
}

/** Grid route a -> b that never starts by turning back onto `avoid` (a vehicle can't U-turn). */
function routeBetween(a: Node, b: Node, avoid: Node | null): Node[] {
  const options = [manhattan(a, b, true), manhattan(a, b, false)].filter((r) => r.length < 2 || !avoid || !same(r[1], avoid));
  if (options.length) return options[Math.floor(Math.random() * options.length)];
  const alongX = avoid!.z === a.z;
  const mid = alongX ? { x: a.x, z: a.z < N ? a.z + 1 : a.z - 1 } : { x: a.x < N ? a.x + 1 : a.x - 1, z: a.z };
  return [a, ...manhattan(mid, b, alongX)];
}

function glowTexture() {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 64;
  const g = canvas.getContext("2d")!;
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, "rgba(255,255,255,1)");
  grad.addColorStop(0.4, "rgba(255,255,255,0.25)");
  grad.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function flatRing() {
  const geo = new THREE.RingGeometry(0.94, 1, 64);
  geo.rotateX(-Math.PI / 2);
  return geo;
}

function glowMaterial(color: THREE.Color, map: THREE.Texture, opacity = 1) {
  return new THREE.MeshBasicMaterial({ color, map, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false });
}

function ringMaterial(color: THREE.Color) {
  return new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false });
}

/* ------------------------------------------------------------------ city */

function buildCity(scene: THREE.Scene, glow: THREE.Texture) {
  const reach = N * S + 8;
  const ground = new THREE.Mesh(new THREE.CircleGeometry(120, 64), new THREE.MeshBasicMaterial({ color: BG }));
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.02;
  scene.add(ground);

  // Roads: one strip per grid line in each direction, plus a faint centre line.
  const lines = 2 * N + 1;
  const roads = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 0.02, 1), new THREE.MeshBasicMaterial({ color: 0x151517 }), lines * 2);
  const centres = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 0.02, 1), new THREE.MeshBasicMaterial({ color: 0x2a2a2e }), lines * 2);
  const m = new THREE.Object3D();
  for (let i = 0; i < lines; i++) {
    const c = (i - N) * S;
    for (const [k, alongX] of [[0, true], [1, false]] as const) {
      const idx = i * 2 + k;
      for (const [mesh, width, y] of [[roads, ROAD_W, 0], [centres, 0.03, 0.012]] as const) {
        m.position.set(alongX ? 0 : c, y, alongX ? c : 0);
        m.scale.set(alongX ? reach * 2 : width, 1, alongX ? width : reach * 2);
        m.updateMatrix();
        mesh.setMatrixAt(idx, m.matrix);
      }
    }
  }
  scene.add(roads, centres);

  // Buildings: each block holds one big building or up to four small ones; taller towards the centre.
  const boxes: { x: number; z: number; w: number; d: number; h: number }[] = [];
  const inner = S - ROAD_W - 0.1;
  const sub = (inner - 0.15) / 2;
  const off = sub / 2 + 0.075;
  for (let i = -N; i < N; i++) {
    for (let j = -N; j < N; j++) {
      const cx = (i + 0.5) * S;
      const cz = (j + 0.5) * S;
      const centre = 1 - Math.min(1, Math.hypot(cx, cz) / (N * S));
      const height = () => 0.3 + Math.random() * 0.7 + centre * centre * Math.random() * 3.5;
      if (Math.random() < 0.25) {
        boxes.push({ x: cx, z: cz, w: inner, d: inner, h: height() });
      } else {
        for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
          if (Math.random() < 0.12) continue;
          boxes.push({ x: cx + sx * off, z: cz + sz * off, w: sub, d: sub, h: height() });
        }
      }
    }
  }
  const buildings = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial({ roughness: 0.9, metalness: 0 }), boxes.length);
  const tint = new THREE.Color();
  const edges: number[] = [];
  boxes.forEach((b, i) => {
    m.position.set(b.x, b.h / 2, b.z);
    m.scale.set(b.w, b.h, b.d);
    m.updateMatrix();
    buildings.setMatrixAt(i, m.matrix);
    buildings.setColorAt(i, tint.setScalar(rand(0.018, 0.04)));
    const [x0, x1, z0, z1] = [b.x - b.w / 2, b.x + b.w / 2, b.z - b.d / 2, b.z + b.d / 2];
    for (const y of [0, b.h]) edges.push(x0, y, z0, x1, y, z0, x1, y, z0, x1, y, z1, x1, y, z1, x0, y, z1, x0, y, z1, x0, y, z0);
    for (const [x, z] of [[x0, z0], [x1, z0], [x1, z1], [x0, z1]]) edges.push(x, 0, z, x, b.h, z);
  });
  scene.add(buildings);
  const edgeGeo = new THREE.BufferGeometry();
  edgeGeo.setAttribute("position", new THREE.Float32BufferAttribute(edges, 3));
  scene.add(new THREE.LineSegments(edgeGeo, new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.16 })));

  scene.add(new THREE.HemisphereLight(0x9aa8c0, 0x000000, 0.35));
  const sun = new THREE.DirectionalLight(0xffffff, 0.7);
  sun.position.set(-18, 30, 12);
  scene.add(sun);

  // Demand zones: pulsing amber heat on the ground.
  return ZONES.map((node, i) => {
    const mat = glowMaterial(AMBER, glow, 0.3);
    const mesh = new THREE.Mesh(new THREE.CircleGeometry(1, 48).rotateX(-Math.PI / 2), mat);
    mesh.position.copy(toWorld(node, 0.04));
    scene.add(mesh);
    return { node, mesh, mat, phase: i * 1.7, radius: 6 + (i % 2) * 1.5, energy: 0 };
  });
}

/* -------------------------------------------------------------- vehicles */

function vehicleBody(kind: Kind, material: THREE.Material) {
  const group = new THREE.Group();
  const add = (w: number, h: number, d: number, y: number, z = 0) => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
    mesh.position.set(0, y + h / 2, z);
    group.add(mesh);
  };
  if (kind === "bike") {
    add(0.14, 0.16, 0.6, 0.02);
    add(0.12, 0.2, 0.14, 0.16, -0.05);
  } else if (kind === "cng") {
    add(0.4, 0.3, 0.62, 0.03);
    add(0.34, 0.08, 0.5, 0.33);
  } else {
    add(0.42, 0.18, 0.95, 0.03);
    add(0.34, 0.14, 0.46, 0.21, -0.05);
  }
  return group;
}

class Vehicle {
  readonly group = new THREE.Group();
  readonly pos = new THREE.Vector3();
  private readonly body: THREE.MeshBasicMaterial;
  private readonly glow: THREE.SpriteMaterial;
  readonly halo: THREE.MeshBasicMaterial;
  private readonly speed: number;
  from: Node;
  to: Node;
  t = Math.random();
  route: Node[] | null = null;
  routeIdx = 0;
  onDone: ((at: Node, prev: Node) => Node[] | void) | null = null;
  boost = 1;
  lane = LANE;
  laneTarget = LANE;
  private heading = 0;
  private highlight = 0;

  constructor(kind: Kind, glowTex: THREE.Texture, ringGeo: THREE.BufferGeometry) {
    this.body = new THREE.MeshBasicMaterial({ color: VEHICLE });
    this.glow = new THREE.SpriteMaterial({ map: glowTex, color: VEHICLE, transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false });
    this.halo = ringMaterial(ACCENT);
    this.speed = SPEED[kind] * rand(0.85, 1.15);
    this.group.add(vehicleBody(kind, this.body));
    this.group.scale.setScalar(2);
    const sprite = new THREE.Sprite(this.glow);
    sprite.scale.setScalar(1);
    sprite.position.y = 0.2;
    const halo = new THREE.Mesh(ringGeo, this.halo);
    halo.scale.setScalar(0.9);
    halo.position.y = 0.05;
    this.group.add(sprite, halo);

    this.from = { x: Math.round(rand(-N, N)), z: Math.round(rand(-N, N)) };
    this.to = randomNeighbor(this.from, null);
  }

  get routeProgress() {
    return this.route ? Math.max(0, this.routeIdx - 1 + this.t) * S : 0;
  }

  setRoute(nodes: Node[], atNode: boolean) {
    this.route = nodes;
    this.routeIdx = atNode ? 1 : 0;
    if (atNode) this.to = nodes[1];
  }

  setHighlight(h: number) {
    this.highlight = h;
    this.body.color.lerpColors(VEHICLE, ACCENT, h);
    this.glow.color.lerpColors(VEHICLE, ACCENT, h);
    this.glow.opacity = 0.35 + 0.5 * h;
  }

  private arrive() {
    const prev = this.from;
    this.from = this.to;
    if (this.route) {
      if (this.routeIdx < this.route.length - 1) {
        this.to = this.route[++this.routeIdx];
        return;
      }
      const done = this.onDone;
      this.route = null;
      this.onDone = null;
      const next = done?.(this.from, prev);
      if (next && next.length > 1) {
        this.setRoute(next, true);
        return;
      }
    }
    this.to = randomNeighbor(this.from, prev);
  }

  update(dt: number) {
    this.t += (dt * this.speed * this.boost) / S;
    while (this.t >= 1) {
      this.t -= 1;
      this.arrive();
    }
    const { from: a, to: b } = this;
    const dx = Math.sign(b.x - a.x);
    const dz = Math.sign(b.z - a.z);
    const delta = Math.atan2(Math.sin(Math.atan2(dx, dz) - this.heading), Math.cos(Math.atan2(dx, dz) - this.heading));
    this.heading += delta * Math.min(1, dt * 10);
    this.lane = damp(this.lane, this.laneTarget, dt);
    // Traffic keeps left: the offset is the left-hand normal of the direction of travel.
    this.pos.set((a.x + (b.x - a.x) * this.t) * S + dz * this.lane, 0, (a.z + (b.z - a.z) * this.t) * S - dx * this.lane);
    this.group.position.copy(this.pos);
    this.group.rotation.y = this.heading;
  }
}

/* ---------------------------------------------------- beacons and trails */

class Beacon {
  readonly group = new THREE.Group();
  private readonly rings: THREE.Mesh[] = [];
  private readonly mats: THREE.MeshBasicMaterial[] = [];
  private readonly beam: THREE.MeshBasicMaterial;
  private readonly dot: THREE.SpriteMaterial;
  alpha = 0;
  target = 0;

  constructor(color: THREE.Color, glow: THREE.Texture, ringGeo: THREE.BufferGeometry) {
    for (let i = 0; i < 3; i++) {
      const mat = ringMaterial(color);
      this.mats.push(mat);
      const ring = new THREE.Mesh(ringGeo, mat);
      ring.position.y = 0.06;
      this.rings.push(ring);
      this.group.add(ring);
    }
    this.beam = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.22, 7, 20, 1, true), this.beam);
    beam.position.y = 3.5;
    this.dot = new THREE.SpriteMaterial({ map: glow, color, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false });
    const dot = new THREE.Sprite(this.dot);
    dot.scale.setScalar(2.4);
    dot.position.y = 0.3;
    this.group.add(beam, dot);
    this.group.visible = false;
  }

  place(p: THREE.Vector3) {
    this.group.position.copy(p);
  }

  update(time: number, dt: number) {
    this.alpha = damp(this.alpha, this.target, dt, 5);
    this.group.visible = this.alpha > 0.01;
    this.beam.opacity = this.alpha * 0.28;
    this.dot.opacity = this.alpha * (0.7 + 0.2 * Math.sin(time * 5));
    this.rings.forEach((ring, i) => {
      const u = (time * 0.6 + i / 3) % 1;
      ring.scale.setScalar(0.3 + u * 2);
      this.mats[i].opacity = (1 - u) * this.alpha * 0.8;
    });
  }
}

class Trail {
  readonly group = new THREE.Group();
  private readonly mat: THREE.MeshBasicMaterial;
  private readonly segs: { mesh: THREE.Mesh; a: THREE.Vector3; dir: THREE.Vector3; len: number; start: number }[] = [];
  private readonly geo: THREE.BoxGeometry;
  readonly total: number;

  constructor(nodes: Node[], color: THREE.Color, width: number) {
    this.mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 1 });
    const geo = (this.geo = new THREE.BoxGeometry(1, 0.03, width));
    let start = 0;
    for (let i = 0; i + 1 < nodes.length; i++) {
      const a = toWorld(nodes[i], 0.05);
      const b = toWorld(nodes[i + 1], 0.05);
      const len = a.distanceTo(b);
      const mesh = new THREE.Mesh(geo, this.mat);
      mesh.rotation.y = nodes[i].x === nodes[i + 1].x ? Math.PI / 2 : 0;
      mesh.visible = false;
      this.group.add(mesh);
      this.segs.push({ mesh, a, dir: b.clone().sub(a).normalize(), len, start });
      start += len;
    }
    this.total = start;
  }

  set(dist: number) {
    for (const s of this.segs) {
      const covered = clamp01((dist - s.start) / s.len) * s.len;
      s.mesh.visible = covered > 0.001;
      s.mesh.scale.x = Math.max(covered, 0.001);
      s.mesh.position.copy(s.a).addScaledVector(s.dir, covered / 2);
    }
  }

  fade(opacity: number) {
    this.mat.opacity = opacity;
  }

  dispose() {
    this.geo.dispose();
    this.mat.dispose();
  }
}

class Link {
  readonly line: THREE.Line;
  private readonly mat: THREE.LineBasicMaterial;
  private readonly pts = new Float32Array(25 * 3);
  alpha = 0;
  target = 0;

  constructor(readonly vehicle: Vehicle) {
    this.mat = new THREE.LineBasicMaterial({ color: ACCENT, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false });
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(this.pts, 3));
    this.line = new THREE.Line(geo, this.mat);
    this.line.frustumCulled = false;
  }

  update(to: THREE.Vector3, dt: number) {
    this.alpha = damp(this.alpha, this.target, dt, 6);
    this.mat.opacity = this.alpha;
    this.line.visible = this.alpha > 0.01;
    const from = this.vehicle.pos;
    const lift = 1.2 + from.distanceTo(to) * 0.28;
    for (let i = 0; i <= 24; i++) {
      const u = i / 24;
      this.pts[i * 3] = from.x + (to.x - from.x) * u;
      this.pts[i * 3 + 1] = 0.35 + Math.sin(u * Math.PI) * lift;
      this.pts[i * 3 + 2] = from.z + (to.z - from.z) * u;
    }
    this.line.geometry.attributes.position.needsUpdate = true;
  }

  dispose() {
    this.line.geometry.dispose();
    this.mat.dispose();
  }
}

/* -------------------------------------------------------------- the show */

type Phase = "spawn" | "search" | "match" | "pickup" | "trip" | "arrive";

function createShow(container: HTMLElement) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setClearColor(BG);
  container.appendChild(renderer.domElement);
  renderer.domElement.style.display = "block";

  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(BG, 70, 135);
  const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 300);

  const glow = glowTexture();
  const ringGeo = flatRing();
  const zones = buildCity(scene, glow);

  const kinds: Kind[] = ["bike", "bike", "bike", "bike", "bike", "bike", "cng", "cng", "cng", "cng", "cng", "car", "car", "car", "car", "car", "car", "bike", "cng", "car"];
  const vehicles = kinds.map((k) => new Vehicle(k, glow, ringGeo));
  vehicles.forEach((v) => scene.add(v.group));

  const pickupBeacon = new Beacon(AMBER, glow, ringGeo);
  const dropBeacon = new Beacon(WHITE, glow, ringGeo);
  scene.add(pickupBeacon.group, dropBeacon.group);

  const searchMat = ringMaterial(ACCENT);
  const searchRing = new THREE.Mesh(ringGeo, searchMat);
  searchRing.position.y = 0.07;
  const burstMat = ringMaterial(WHITE);
  const burstRing = new THREE.Mesh(ringGeo, burstMat);
  burstRing.position.y = 0.07;
  scene.add(searchRing, burstRing);

  // Ride state
  let phase: Phase = "spawn";
  let phaseTime = 0;
  let pickup: Node = ZONES[0];
  let drop: Node = ZONES[1];
  let pickupPos = new THREE.Vector3();
  let dropPos = new THREE.Vector3();
  let chosen: Vehicle | null = null;
  let links: Link[] = [];
  let pickupTrail: Trail | null = null;
  let tripTrail: Trail | null = null;
  let highlight = 0;
  let zoneIdx = 0;

  const enter = (next: Phase) => {
    phase = next;
    phaseTime = 0;
  };

  const clearRide = () => {
    for (const l of links) {
      scene.remove(l.line);
      l.dispose();
    }
    links = [];
    for (const t of [pickupTrail, tripTrail]) {
      if (!t) continue;
      scene.remove(t.group);
      t.dispose();
    }
    pickupTrail = tripTrail = null;
    for (const v of vehicles) v.halo.opacity = 0;
    if (chosen) {
      chosen.laneTarget = LANE;
      chosen.boost = 1;
      chosen.setHighlight(0);
    }
    chosen = null;
    highlight = 0;
  };

  const startSpawn = () => {
    clearRide();
    zoneIdx = (zoneIdx + 1 + Math.floor(Math.random() * (ZONES.length - 1))) % ZONES.length;
    const z = ZONES[zoneIdx];
    do {
      pickup = { x: z.x + Math.round(rand(-1, 1)), z: z.z + Math.round(rand(-1, 1)) };
      drop = { x: Math.round(rand(-N, N)), z: Math.round(rand(-N, N)) };
    } while (!inBounds(pickup) || Math.abs(drop.x - pickup.x) + Math.abs(drop.z - pickup.z) < 6);
    pickupPos = toWorld(pickup);
    dropPos = toWorld(drop);
    pickupBeacon.place(pickupPos);
    dropBeacon.place(dropPos);
    pickupBeacon.target = 1;
    dropBeacon.target = 0;
    enter("spawn");
  };

  const startSearch = () => {
    const free = vehicles.filter((v) => v.route === null).sort((a, b) => a.pos.distanceTo(pickupPos) - b.pos.distanceTo(pickupPos));
    const candidates = free.slice(0, 4);
    // Rank by pickup distance weighted by a random cancellation risk, so the nearest isn't always the winner.
    const score = new Map(candidates.map((v) => [v, v.pos.distanceTo(pickupPos) * rand(0.8, 1.6)]));
    chosen = candidates.reduce((best, v) => (score.get(v)! < score.get(best)! ? v : best));
    links = candidates.map((v) => {
      const l = new Link(v);
      scene.add(l.line);
      return l;
    });
    enter("search");
  };

  const startMatch = () => {
    const rider = chosen!;
    rider.laneTarget = 0;
    rider.boost = 1.5;
    rider.setRoute(routeBetween(rider.to, pickup, rider.from), false);
    pickupTrail = new Trail(rider.route!, ACCENT, 0.16);
    pickupTrail.fade(0.55);
    scene.add(pickupTrail.group);
    rider.onDone = (_at, prev) => {
      const trip = routeBetween(pickup, drop, prev);
      tripTrail = new Trail(trip, ACCENT, 0.2);
      scene.add(tripTrail.group);
      pickupTrail?.set(pickupTrail.total);
      pickupBeacon.target = 0;
      dropBeacon.target = 1;
      for (const l of links) l.target = 0;
      rider.onDone = () => {
        tripTrail?.set(tripTrail.total);
        enter("arrive");
      };
      enter("trip");
      return trip;
    };
    enter("match");
  };

  startSpawn();

  const focus = new THREE.Vector3();
  const lookAt = new THREE.Vector3();
  const pointer = { x: 0, y: 0, tx: 0, ty: 0 };

  const update = (dt: number, time: number) => {
    phaseTime += dt;
    for (const v of vehicles) v.update(dt);

    // Demand glow: every zone breathes, the one with the request flares up.
    zones.forEach((z, i) => {
      z.energy = damp(z.energy, i === zoneIdx && phase !== "arrive" ? 1 : 0, dt, 2);
      const breathe = 0.5 + 0.5 * Math.sin(time * 0.9 + z.phase);
      z.mat.opacity = 0.14 + 0.16 * breathe + 0.38 * z.energy;
      z.mesh.scale.setScalar(z.radius * (0.92 + 0.1 * breathe + 0.12 * z.energy));
    });

    searchMat.opacity = 0;
    burstMat.opacity = 0;

    switch (phase) {
      case "spawn":
        if (phaseTime > 1.2) startSearch();
        break;
      case "search": {
        const u = clamp01(phaseTime / 1.8);
        searchRing.position.x = pickupPos.x;
        searchRing.position.z = pickupPos.z;
        searchRing.scale.setScalar(1 + (1 - (1 - u) ** 3) * 16);
        searchMat.opacity = (1 - u) * 0.7;
        links.forEach((l, i) => {
          l.target = phaseTime > 0.3 + i * 0.25 ? 0.6 : 0;
        });
        if (phaseTime > 2.4) startMatch();
        break;
      }
      case "match":
      case "pickup":
        highlight = damp(highlight, 1, dt, 3);
        chosen!.setHighlight(highlight);
        for (const l of links) {
          const win = l.vehicle === chosen;
          l.target = win ? 1 : 0;
        }
        pickupTrail?.set(chosen!.routeProgress);
        if (phase === "match" && phaseTime > 1) enter("pickup");
        break;
      case "trip":
        chosen!.halo.opacity = damp(chosen!.halo.opacity, 0, dt, 3);
        pickupTrail?.fade(damp(0.55, 0.15, phaseTime, 1.5));
        tripTrail?.set(chosen!.routeProgress);
        break;
      case "arrive": {
        const u = clamp01(phaseTime / 1.8);
        burstRing.position.x = dropPos.x;
        burstRing.position.z = dropPos.z;
        burstRing.scale.setScalar(1 + (1 - (1 - u) ** 3) * 10);
        burstMat.opacity = (1 - u) * 0.9;
        dropBeacon.target = phaseTime > 1.2 ? 0 : 1;
        highlight = damp(highlight, 0, dt, 1.5);
        chosen!.setHighlight(highlight);
        chosen!.laneTarget = LANE;
        chosen!.boost = 1;
        const fade = 1 - clamp01((phaseTime - 0.6) / 1.8);
        tripTrail?.fade(fade);
        pickupTrail?.fade(0.15 * fade);
        if (phaseTime > 3.2) startSpawn();
        break;
      }
    }

    for (const l of links) {
      l.update(pickupPos, dt);
      if (l.vehicle !== chosen) l.vehicle.halo.opacity = l.alpha;
      else if (phase !== "trip") l.vehicle.halo.opacity = 1;
    }
    pickupBeacon.update(time, dt);
    dropBeacon.update(time, dt);

    // Camera: slow orbit, nudged by the pointer and drifting towards whatever is happening.
    pointer.x = damp(pointer.x, pointer.tx, dt, 2);
    pointer.y = damp(pointer.y, pointer.ty, dt, 2);
    const wanted = phase === "trip" || phase === "pickup" || phase === "match" ? chosen!.pos : phase === "arrive" ? dropPos : pickupPos;
    focus.lerp(wanted, Math.min(1, dt * 1.2));
    lookAt.copy(focus).multiplyScalar(0.4);
    const aspect = camera.aspect;
    const radius = 46 * (aspect < 1 ? Math.min(1.9, 1 / Math.pow(aspect, 0.75)) : 1);
    const angle = time * 0.055 + Math.sin(time * 0.1) * 0.35 + pointer.x * 0.3;
    camera.position.set(lookAt.x + Math.cos(angle) * radius, radius * (0.78 - pointer.y * 0.1), lookAt.z + Math.sin(angle) * radius);
    camera.lookAt(lookAt);
  };

  const resize = () => {
    const w = Math.max(1, container.clientWidth);
    const h = Math.max(1, container.clientHeight);
    renderer.setSize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  };
  const onPointer = (e: PointerEvent) => {
    const r = container.getBoundingClientRect();
    pointer.tx = ((e.clientX - r.left) / r.width - 0.5) * 2;
    pointer.ty = ((e.clientY - r.top) / r.height - 0.5) * 2;
  };
  resize();
  const observer = new ResizeObserver(resize);
  observer.observe(container);
  window.addEventListener("pointermove", onPointer);

  const clock = new THREE.Clock();
  renderer.setAnimationLoop(() => {
    update(Math.min(clock.getDelta(), 0.05), clock.elapsedTime);
    renderer.render(scene, camera);
  });

  return () => {
    renderer.setAnimationLoop(null);
    observer.disconnect();
    window.removeEventListener("pointermove", onPointer);
    scene.traverse((o) => {
      const obj = o as THREE.Mesh;
      obj.geometry?.dispose();
      for (const mat of ([] as THREE.Material[]).concat(obj.material ?? [])) {
        (mat as THREE.MeshBasicMaterial).map?.dispose();
        mat.dispose();
      }
    });
    glow.dispose();
    renderer.dispose();
    renderer.domElement.remove();
  };
}

export default function CityScene({ className }: { className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    try {
      return createShow(el);
    } catch {
      // No WebGL: leave the plain background.
    }
  }, []);
  return <div ref={ref} className={className} aria-hidden />;
}
