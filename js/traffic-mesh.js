/**
 * Lean civilian traffic meshes.
 * Prototypes + shared materials → spawn is cheap, draw cost stays low.
 * (Full procedural cars were ~20+ meshes × unique StandardMaterials each.)
 */
import * as THREE from "three";

const PROFILES = {
  sedan:   { w: 1.9, h: 0.55, L: 4.2, cabinH: 0.55, cabinL: 1.7, cabinZ: -0.15, wheelY: 0.38, wheelS: 1.0, wx: 0.95, wz: 1.35 },
  taxi:    { w: 1.92, h: 0.56, L: 4.25, cabinH: 0.58, cabinL: 1.75, cabinZ: -0.1, wheelY: 0.38, wheelS: 1.0, wx: 0.96, wz: 1.35 },
  hatch:   { w: 1.75, h: 0.62, L: 3.55, cabinH: 0.7, cabinL: 2.15, cabinZ: -0.05, wheelY: 0.36, wheelS: 0.92, wx: 0.88, wz: 1.15 },
  coupe:   { w: 1.95, h: 0.42, L: 4.3, cabinH: 0.42, cabinL: 1.35, cabinZ: -0.35, wheelY: 0.34, wheelS: 1.05, wx: 1.0, wz: 1.4 },
  van:     { w: 2.05, h: 1.15, L: 4.6, cabinH: 1.05, cabinL: 3.4, cabinZ: -0.15, wheelY: 0.42, wheelS: 1.08, wx: 1.0, wz: 1.45 },
  pickup:  { w: 1.95, h: 0.7, L: 4.8, cabinH: 0.72, cabinL: 1.45, cabinZ: 0.55, wheelY: 0.42, wheelS: 1.1, wx: 0.98, wz: 1.55 },
  muscle:  { w: 2.1, h: 0.48, L: 4.6, cabinH: 0.45, cabinL: 1.4, cabinZ: -0.25, wheelY: 0.36, wheelS: 1.12, wx: 1.08, wz: 1.5 },
  beater:  { w: 1.7, h: 0.58, L: 3.4, cabinH: 0.55, cabinL: 1.5, cabinZ: -0.05, wheelY: 0.34, wheelS: 0.88, wx: 0.82, wz: 1.1 },
  suv:     { w: 2.05, h: 0.85, L: 4.35, cabinH: 0.85, cabinL: 2.4, cabinZ: -0.05, wheelY: 0.46, wheelS: 1.15, wx: 1.02, wz: 1.4 },
  wagon:   { w: 1.88, h: 0.6, L: 4.55, cabinH: 0.68, cabinL: 2.6, cabinZ: -0.2, wheelY: 0.38, wheelS: 1.0, wx: 0.94, wz: 1.4 },
  minibus: { w: 2.15, h: 1.35, L: 5.4, cabinH: 1.25, cabinL: 4.2, cabinZ: -0.15, wheelY: 0.48, wheelS: 1.15, wx: 1.05, wz: 1.7 },
  sports:  { w: 2.0, h: 0.35, L: 4.15, cabinH: 0.36, cabinL: 1.15, cabinZ: -0.4, wheelY: 0.3, wheelS: 1.08, wx: 1.05, wz: 1.35 },
  boxtruck:{ w: 2.35, h: 0.85, L: 7.2, cabinH: 1.15, cabinL: 1.7, cabinZ: 2.15, wheelY: 0.55, wheelS: 1.28, wx: 1.12, wz: 2.15, truck: true },
  dump:    { w: 2.4, h: 0.95, L: 6.4, cabinH: 1.2, cabinL: 1.65, cabinZ: 1.85, wheelY: 0.58, wheelS: 1.32, wx: 1.15, wz: 1.95, truck: true },
  flatbed: { w: 2.3, h: 0.75, L: 6.8, cabinH: 1.05, cabinL: 1.55, cabinZ: 2.05, wheelY: 0.52, wheelS: 1.25, wx: 1.1, wz: 2.05, truck: true },
};

/** Shared cheap materials (Lambert — far fewer GPU instructions than Standard). */
const shared = {
  glass: new THREE.MeshLambertMaterial({
    color: 0x3a6a9a,
    transparent: true,
    opacity: 0.45,
    depthWrite: false,
  }),
  black: new THREE.MeshLambertMaterial({ color: 0x0a0c10 }),
  tire: new THREE.MeshLambertMaterial({ color: 0x111114 }),
  head: new THREE.MeshLambertMaterial({
    color: 0xe8f2ff,
    emissive: 0x88b8e8,
    emissiveIntensity: 0.55,
  }),
  tail: new THREE.MeshLambertMaterial({
    color: 0xff2020,
    emissive: 0xaa0000,
    emissiveIntensity: 0.5,
  }),
};

const wheelGeoCache = new Map();
function wheelGeo(scale) {
  const key = scale.toFixed(2);
  if (!wheelGeoCache.has(key)) {
    wheelGeoCache.set(
      key,
      new THREE.CylinderGeometry(0.4 * scale, 0.4 * scale, 0.28 * scale, 8)
    );
  }
  return wheelGeoCache.get(key);
}

const bodyMatCache = new Map();
function bodyMats(color, dark) {
  const key = `${color}|${dark}`;
  if (!bodyMatCache.has(key)) {
    bodyMatCache.set(key, {
      body: new THREE.MeshLambertMaterial({ color }),
      dark: new THREE.MeshLambertMaterial({ color: dark }),
    });
  }
  return bodyMatCache.get(key);
}

const protoCache = new Map();

function buildLeanProto(type) {
  const body = type.body || type.id || "sedan";
  const p = PROFILES[body] || PROFILES.sedan;
  const mats = bodyMats(type.color, type.dark);
  const g = new THREE.Group();

  const rocker = new THREE.Mesh(
    new THREE.BoxGeometry(p.w, p.h * 0.7, p.L),
    mats.body
  );
  rocker.position.y = p.wheelY + p.h * 0.2;
  g.add(rocker);

  const cabin = new THREE.Mesh(
    new THREE.BoxGeometry(p.w * 0.92, p.cabinH, p.cabinL),
    body === "van" || body === "minibus" || p.truck ? mats.dark : shared.glass
  );
  cabin.position.set(0, p.wheelY + p.h * 0.35 + p.cabinH * 0.48, p.cabinZ);
  g.add(cabin);

  if (p.truck) {
    const cargo = new THREE.Mesh(
      new THREE.BoxGeometry(p.w * 0.95, p.h * 1.4, p.L * 0.55),
      mats.dark
    );
    cargo.position.set(0, p.wheelY + p.h * 0.9, -p.L * 0.12);
    g.add(cargo);
  }

  const headL = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.16, 0.1), shared.head);
  headL.position.set(p.w * 0.32, p.wheelY + p.h * 0.45, p.L * 0.48);
  g.add(headL);
  const headR = headL.clone();
  headR.position.x = -p.w * 0.32;
  g.add(headR);

  const tailL = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.14, 0.08), shared.tail);
  tailL.position.set(p.w * 0.32, p.wheelY + p.h * 0.4, -p.L * 0.48);
  g.add(tailL);
  const tailR = tailL.clone();
  tailR.position.x = -p.w * 0.32;
  g.add(tailR);

  const frontWheels = [];
  const rearWheels = [];
  const placements = [
    { x: p.wx, z: p.wz, front: true },
    { x: -p.wx, z: p.wz, front: true },
    { x: p.wx, z: -p.wz, front: false },
    { x: -p.wx, z: -p.wz, front: false },
  ];
  for (const wp of placements) {
    const pivot = new THREE.Group();
    const roller = new THREE.Mesh(wheelGeo(p.wheelS), shared.tire);
    roller.rotation.z = Math.PI / 2;
    roller.userData.rollAxis = "x";
    pivot.add(roller);
    pivot.position.set(wp.x, p.wheelY, wp.z);
    pivot.userData.isTrafficWheel = true;
    pivot.userData.isFront = wp.front;
    pivot.userData.roller = roller;
    g.add(pivot);
    if (wp.front) frontWheels.push(pivot);
    else rearWheels.push(pivot);
  }

  g.userData.wheels = [...frontWheels, ...rearWheels];
  g.userData.frontWheels = frontWheels;
  g.userData.rearWheels = rearWheels;
  g.userData.guide = null;
  g.userData.body = body;
  g.userData.trafficLean = true;

  g.traverse((obj) => {
    if (obj.isMesh) {
      obj.castShadow = false;
      obj.receiveShadow = false;
      obj.frustumCulled = true;
      obj.matrixAutoUpdate = true;
    }
  });

  return g;
}

function rewireWheels(clone) {
  const frontWheels = [];
  const rearWheels = [];
  const wheels = [];
  clone.traverse((child) => {
    if (!child.userData?.isTrafficWheel) return;
    const roller = child.children.find((c) => c.isMesh) || child.children[0];
    if (roller) {
      roller.userData.rollAxis = "x";
      child.userData.roller = roller;
    }
    wheels.push(child);
    if (child.userData.isFront) frontWheels.push(child);
    else rearWheels.push(child);
  });
  clone.userData.frontWheels = frontWheels;
  clone.userData.rearWheels = rearWheels;
  clone.userData.wheels = wheels;
  clone.userData.guide = null;
  clone.userData.trafficLean = true;
}

/**
 * Spawn a traffic car mesh — clones a cached prototype and shares materials.
 */
export function createTrafficMesh(type) {
  const key = type.id || type.body || "sedan";
  if (!protoCache.has(key)) {
    protoCache.set(key, buildLeanProto(type));
  }
  const proto = protoCache.get(key);
  const g = proto.clone(true);

  // Share materials with prototype (clone() duplicates them by default)
  const protoMeshes = [];
  proto.traverse((o) => {
    if (o.isMesh) protoMeshes.push(o);
  });
  let i = 0;
  g.traverse((o) => {
    if (o.isMesh) {
      const src = protoMeshes[i++];
      if (src) o.material = src.material;
      o.castShadow = false;
      o.receiveShadow = false;
    }
  });

  rewireWheels(g);
  g.userData.body = type.body || type.id || "sedan";
  return g;
}

/** Prebuild prototypes for every traffic type (call once during load). */
export function warmTrafficPrototypes(types) {
  for (const t of types) {
    const key = t.id || t.body || "sedan";
    if (!protoCache.has(key)) protoCache.set(key, buildLeanProto(t));
  }
}
