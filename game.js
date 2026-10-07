import * as THREE from "three";
import { Sky } from "three/addons/objects/Sky.js";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import {
  TRAFFIC_COUNT,
  TRAFFIC_SPAWN_BATCH,
  TRAFFIC_ACTIVE_DIST2,
  TRAFFIC_HIDE_DIST2,
  TRAFFIC_FAR_STRIDE,
  TRAFFIC_FRAME_BUDGET_MS,
  MAX_PIXEL_RATIO,
  BUILDING_TEX_W,
  BUILDING_TEX_H,
  ASPHALT_TEX_SIZE,
} from "./js/config.js";
import { FrameBudget, yieldToMain, warmRenderer } from "./js/performance.js";
import { createTrafficMesh, warmTrafficPrototypes } from "./js/traffic-mesh.js";

/** Player car GLBs — realistic free models preferred, then Kenney. */
const CAR_MODEL_FILES = {
  beater: "assets/cars/beater.glb",
  sedan: "assets/cars/sedan.glb",
  coupe: "assets/cars/coupe.glb",
  muscle: "assets/cars/muscle.glb",
  sports: "assets/cars/sports.glb",
  gt: "assets/cars/gt.glb",
};
/** High-detail free GLBs — one distinct body per garage slot. */
const CAR_REALISTIC_FILES = {
  beater: "assets/cars/realistic/beater.glb", // Audi S4-style compact sedan (starter)
  sedan: "assets/cars/realistic/sedan.glb", // Volvo S60R-style sedan
  coupe: "assets/cars/realistic/coupe.glb", // Renault Clio V6 hot hatch
  muscle: "assets/cars/realistic/muscle.glb", // Camaro Z28 muscle
  sports: "assets/cars/realistic/sports.glb", // Corvette C7 sports
  gt: "assets/cars/realistic/gt.glb", // BMW M3 GTR-style GT
};
/** Which realistic file each garage body uses (1:1 distinct shapes). */
const CAR_BODY_REALISTIC = {
  beater: "beater",
  sedan: "sedan",
  coupe: "coupe",
  muscle: "muscle",
  sports: "sports",
  gt: "gt",
};
/** Extra yaw (radians) after normalize — Sketchfab cars face inconsistently. */
const CAR_REALISTIC_YAW = {
  beater: 0,
  sedan: 0,
  coupe: 0,
  muscle: 0,
  sports: 0,
  gt: 0,
};
const carModelCache = new Map();
const carModelMeta = new Map(); // body -> { kenney, realistic, worn, base }
const gltfLoader = new GLTFLoader();
const ROAD_CAR_LENGTH = 4.55;
/** Flatten cars on Y only — width (X) and length (Z) stay the same. */
const CAR_HEIGHT_SCALE = 0.78;

/**
 * Blacktop Dual — getaway / police chase (inspired by Blacktop Police Chase)
 * Pick up robbers → escape cops → deliver to safehouse → unlock faster cars
 */

const canvas = document.getElementById("game");
const loadFill = document.getElementById("load-fill");
const loadStatus = document.getElementById("load-status");
const loadingEl = document.getElementById("loading");

function setLoad(p, msg) {
  loadFill.style.width = `${Math.floor(p * 100)}%`;
  if (msg) loadStatus.textContent = msg;
}

const authScreen = document.getElementById("auth-screen");
const authForm = document.getElementById("auth-form");
const authEmailInput = document.getElementById("auth-email");
const authPasswordInput = document.getElementById("auth-password");
const authErrorEl = document.getElementById("auth-error");
const authSignupBtn = document.getElementById("auth-signup-btn");
const profileBar = document.getElementById("profile-bar");
const profileEmailEl = document.getElementById("profile-email");
const profileSummaryEl = document.getElementById("profile-summary");
const logoutBtn = document.getElementById("logout-btn");
const logoutPauseBtn = document.getElementById("logout-pause-btn");
const startScreen = document.getElementById("start-screen");
const garageScreen = document.getElementById("garage-screen");
const pauseScreen = document.getElementById("pause-screen");
const bustScreen = document.getElementById("bust-screen");
const bustTitle = document.getElementById("bust-title");
const hud = document.getElementById("hud");
const playControls = document.getElementById("play-controls");
const splitLabels = document.getElementById("split-labels");
const splitDivider = document.getElementById("split-divider");
const wantedBanner = document.getElementById("wanted-banner");
const zoneToast = document.getElementById("zone-toast");
const cashDisplay = document.getElementById("cash-display");
const garageCanvas = document.getElementById("garage-canvas");
const garageCarName = document.getElementById("garage-car-name");
const garageCarIndex = document.getElementById("garage-car-index");
const garageCarTitle = document.getElementById("garage-car-title");
const garageCarStatus = document.getElementById("garage-car-status");
const garageSpeedFill = document.getElementById("garage-speed-fill");
const garageArmorFill = document.getElementById("garage-armor-fill");
const garageSpeedVal = document.getElementById("garage-speed-val");
const garageArmorVal = document.getElementById("garage-armor-val");
const garageActionBtn = document.getElementById("garage-action");
const sharedCashEl = document.getElementById("shared-cash");
const damageHud = document.getElementById("damage-hud");
const p1DmgFill = document.getElementById("p1-dmg-fill");
const p2DmgFill = document.getElementById("p2-dmg-fill");

const p1Cash = document.getElementById("p1-cash");
const p1Speed = document.getElementById("p1-speed");
const p1Heat = document.getElementById("p1-heat");
const p1Job = document.getElementById("p1-job");
const p2Cash = document.getElementById("p2-cash");
const p2Speed = document.getElementById("p2-speed");
const p2Heat = document.getElementById("p2-heat");
const p2Job = document.getElementById("p2-job");
const mode1pBtn = document.getElementById("mode-1p");
const mode2pBtn = document.getElementById("mode-2p");
const startEyebrow = document.getElementById("start-eyebrow");
const p1ControlTitle = document.getElementById("p1-control-title");
const switchModeBtn = document.getElementById("switch-mode-btn");
const p1HudLabel = document.querySelector(".p1-hud .hud-label");
const p2HudCard = document.querySelector(".p2-hud");
const dmgPanelRight = document.querySelector(".dmg-panel.right");
const splitLabelLeft = document.querySelector(".split-label.left");

const MAX_DAMAGE = 100;
const DAMAGE_RATE = 0.28; // slower crash damage pacing — bars fill gradually
const CAR_RADIUS = 1.7;

// ——— Cars catalog (slowest → fastest, each step faster than the last) ———
const CAR_CATALOG = [
  { id: "scrap", name: "Scrap Runner", price: 0, maxSpeed: 60, accel: 30, turn: 2.5, armor: 88, color: null, dark: null, body: "beater" },
  { id: "cruiser", name: "City Cruiser", price: 800, maxSpeed: 69, accel: 34, turn: 2.55, armor: 74, color: 0xff5a3c, dark: 0xb8321a, body: "sedan" },
  { id: "night", name: "Night Coupe", price: 1760, maxSpeed: 78, accel: 40, turn: 2.65, armor: 58, color: 0x3a5cff, dark: 0x1a2a8a, body: "coupe" },
  { id: "muscle", name: "Street Muscle", price: 3200, maxSpeed: 87, accel: 46, turn: 2.4, armor: 70, color: 0xff9a1a, dark: 0xc45a00, body: "muscle" },
  { id: "turbo", name: "Turbo Interceptor", price: 5200, maxSpeed: 97, accel: 52, turn: 2.75, armor: 48, color: 0x3dff8a, dark: 0x1a8a45, body: "sports" },
  { id: "phantom", name: "Phantom GT", price: 8000, maxSpeed: 106, accel: 58, turn: 2.95, armor: 36, color: 0xff2d8a, dark: 0xb0105a, body: "gt" },
];
const GARAGE_MAX_SPEED = CAR_CATALOG[CAR_CATALOG.length - 1].maxSpeed;

/** Civilian traffic — each entry is a distinct body shape (not just a recolor). */
const TRAFFIC_TYPES = [
  { id: "sedan", body: "sedan", color: 0xc8cdd4, dark: 0x4a5560, maxSpeed: 26, accel: 12, turn: 1.55 },
  { id: "taxi", body: "taxi", color: 0xf5c518, dark: 0x9a7a10, maxSpeed: 28, accel: 13, turn: 1.65 },
  { id: "hatch", body: "hatch", color: 0x3a8f6e, dark: 0x1e5a42, maxSpeed: 24, accel: 11, turn: 1.75 },
  { id: "coupe", body: "coupe", color: 0xb03050, dark: 0x601828, maxSpeed: 32, accel: 16, turn: 1.85 },
  { id: "van", body: "van", color: 0x5a6a8a, dark: 0x2a3548, maxSpeed: 21, accel: 9, turn: 1.3 },
  { id: "pickup", body: "pickup", color: 0x2a6a9a, dark: 0x1a3a55, maxSpeed: 25, accel: 11, turn: 1.4 },
  { id: "muscle", body: "muscle", color: 0xd45020, dark: 0x7a2810, maxSpeed: 34, accel: 17, turn: 1.7 },
  { id: "beater", body: "beater", color: 0x6a7060, dark: 0x3a3e35, maxSpeed: 19, accel: 8, turn: 1.45 },
  { id: "suv", body: "suv", color: 0x4a5a48, dark: 0x2a3228, maxSpeed: 24, accel: 10, turn: 1.35 },
  { id: "wagon", body: "wagon", color: 0x6a8ab0, dark: 0x3a4a68, maxSpeed: 25, accel: 11, turn: 1.5 },
  { id: "minibus", body: "minibus", color: 0xc45a3a, dark: 0x7a3020, maxSpeed: 20, accel: 8, turn: 1.2 },
  { id: "sports", body: "sports", color: 0x1a1e24, dark: 0x0a0c10, maxSpeed: 36, accel: 18, turn: 1.95 },
  { id: "boxtruck", body: "boxtruck", color: 0xd8dde4, dark: 0x3a4450, maxSpeed: 18, accel: 7, turn: 1.05, hitR: 3.6 },
  { id: "boxtruck2", body: "boxtruck", color: 0x3a7a9a, dark: 0x1a3a4a, maxSpeed: 17, accel: 6.5, turn: 1.0, hitR: 3.6 },
  { id: "dump", body: "dump", color: 0xc45a18, dark: 0x5a2a08, maxSpeed: 16, accel: 6, turn: 0.95, hitR: 3.4 },
  { id: "flatbed", body: "flatbed", color: 0x4a5a68, dark: 0x2a3238, maxSpeed: 19, accel: 7.5, turn: 1.1, hitR: 3.5 },
];
const MAX_STEER = 0.85;
const trafficBudget = new FrameBudget(TRAFFIC_FRAME_BUDGET_MS);
/** Police pressure scales — amount & chase speed (+15% from baseline). */
const COP_AMOUNT_MULT = 1.15;
const COP_SPEED_MULT = 1.15;
const COP_HARD_CAP = Math.round(12 * COP_AMOUNT_MULT);
const COP_COUNT_MULT = 2.2 * COP_AMOUNT_MULT;
const driftSmoke = [];

/** Escalating police fleets — realistic player-grade bodies, police-styled. */
const POLICE_TIERS = [
  {
    id: "patrol",
    name: "City Patrol",
    body: "sedan",
    maxSpeed: 34,
    accel: 16,
    turn: 1.65,
    color: 0xf2f4f8,
    dark: 0x1a2a6a,
    stripe: 0x1a4ccc,
    tank: false,
    lengthScale: 1,
    sirenHigh: false,
  },
  {
    id: "interceptor",
    name: "Interceptor",
    body: "coupe",
    maxSpeed: 42,
    accel: 20,
    turn: 1.9,
    color: 0x1c2430,
    dark: 0x0a1428,
    stripe: 0xffcc00,
    tank: false,
    lengthScale: 0.98,
    sirenHigh: true,
  },
  {
    id: "pursuit",
    name: "Pursuit Muscle",
    body: "muscle",
    maxSpeed: 50,
    accel: 26,
    turn: 2.05,
    color: 0x111318,
    dark: 0x2a1a08,
    stripe: 0xff6600,
    tank: false,
    lengthScale: 1.04,
    sirenHigh: true,
  },
  {
    id: "swat",
    name: "SWAT Cruiser",
    body: "sedan",
    maxSpeed: 46,
    accel: 22,
    turn: 1.55,
    color: 0x2a2e28,
    dark: 0x141810,
    stripe: 0x88aa44,
    tank: true,
    lengthScale: 1.12,
    sirenHigh: false,
  },
  {
    id: "elite",
    name: "Elite Hunter",
    body: "gt",
    maxSpeed: 58,
    accel: 32,
    turn: 2.35,
    color: 0x0a0c12,
    dark: 0x1a1030,
    stripe: 0xff2d8a,
    tank: false,
    lengthScale: 0.96,
    sirenHigh: true,
  },
];

let poolCash = 0;
let unlocked = new Set(["scrap"]);
let equippedId = "scrap";
let playerMode = 1; // 1 = solo (default), 2 = split-screen
let dropCount = 0; // successful safehouse deliveries — upgrades police models (not count)

// ——— Per-email profile saves (localStorage) ———
const PROFILES_KEY = "blacktopDual.profiles.v1";
const SESSION_KEY = "blacktopDual.session.v1";
let currentEmail = null;
let saveTimer = 0;

function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

function defaultProgress() {
  return {
    poolCash: 0,
    unlocked: ["scrap"],
    equippedId: "scrap",
    dropCount: 0,
    playerMode: 1,
    updatedAt: Date.now(),
  };
}

function loadProfilesStore() {
  try {
    const raw = localStorage.getItem(PROFILES_KEY);
    if (!raw) return {};
    const data = JSON.parse(raw);
    return data && typeof data === "object" ? data : {};
  } catch {
    return {};
  }
}

function writeProfilesStore(store) {
  localStorage.setItem(PROFILES_KEY, JSON.stringify(store));
}

async function hashPassword(password) {
  const text = String(password || "");
  if (window.crypto?.subtle) {
    const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
    return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
  }
  // Fallback for rare environments without SubtleCrypto
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return `fnv_${(h >>> 0).toString(16)}`;
}

function snapshotProgress() {
  return {
    poolCash: Math.max(0, Math.round(poolCash) || 0),
    unlocked: [...unlocked],
    equippedId,
    dropCount: Math.max(0, Math.floor(dropCount) || 0),
    playerMode: playerMode === 2 ? 2 : 1,
    updatedAt: Date.now(),
  };
}

function applyProgress(progress) {
  const p = progress && typeof progress === "object" ? progress : defaultProgress();
  const validIds = new Set(CAR_CATALOG.map((c) => c.id));
  const owned = Array.isArray(p.unlocked) ? p.unlocked.filter((id) => validIds.has(id)) : [];
  if (!owned.includes("scrap")) owned.unshift("scrap");
  poolCash = Math.max(0, Math.round(Number(p.poolCash) || 0));
  unlocked = new Set(owned);
  equippedId = validIds.has(p.equippedId) && unlocked.has(p.equippedId) ? p.equippedId : "scrap";
  dropCount = Math.max(0, Math.floor(Number(p.dropCount) || 0));
  setPlayerMode(p.playerMode === 2 ? 2 : 1, { persist: false });
}

function saveCurrentProfile(immediate = false) {
  if (!currentEmail) return;
  const run = () => {
    if (!currentEmail) return;
    const store = loadProfilesStore();
    const profile = store[currentEmail];
    if (!profile) return;
    profile.progress = snapshotProgress();
    store[currentEmail] = profile;
    writeProfilesStore(store);
    localStorage.setItem(SESSION_KEY, JSON.stringify({ email: currentEmail }));
    updateProfileUI();
  };
  if (immediate) {
    if (saveTimer) {
      clearTimeout(saveTimer);
      saveTimer = 0;
    }
    run();
    return;
  }
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveTimer = 0;
    run();
  }, 180);
}

function updateProfileUI() {
  if (!currentEmail) {
    profileBar?.classList.add("hidden");
    return;
  }
  profileBar?.classList.remove("hidden");
  if (profileEmailEl) profileEmailEl.textContent = currentEmail;
  if (profileSummaryEl) {
    const cars = unlocked.size;
    profileSummaryEl.textContent = `$${poolCash} · ${cars} car${cars === 1 ? "" : "s"} · Drop #${dropCount}`;
  }
  const startBtn = document.getElementById("start-btn");
  if (startBtn) {
    const continuing = poolCash > 0 || dropCount > 0 || unlocked.size > 1 || equippedId !== "scrap";
    startBtn.textContent = continuing ? "CONTINUE GETAWAY" : "START GETAWAY";
  }
}

function showAuthError(msg) {
  if (!authErrorEl) return;
  if (!msg) {
    authErrorEl.textContent = "";
    authErrorEl.classList.add("hidden");
    return;
  }
  authErrorEl.textContent = msg;
  authErrorEl.classList.remove("hidden");
}

function enterMenuForProfile() {
  authScreen?.classList.add("hidden");
  startScreen.classList.remove("hidden");
  pauseScreen.classList.add("hidden");
  bustScreen.classList.add("hidden");
  garageScreen?.classList.add("hidden");
  hud.classList.add("hidden");
  playControls?.classList.add("hidden");
  damageHud?.classList.add("hidden");
  state = "menu";
  applyModeUI();
  updateProfileUI();
  updateHUD();
}

async function createProfile(email, password) {
  const key = normalizeEmail(email);
  if (!key || !key.includes("@")) throw new Error("Enter a valid email.");
  if (String(password || "").length < 4) throw new Error("Password must be at least 4 characters.");
  const store = loadProfilesStore();
  if (store[key]) throw new Error("That email already has a profile. Sign in instead.");
  store[key] = {
    email: key,
    passwordHash: await hashPassword(password),
    createdAt: Date.now(),
    progress: defaultProgress(),
  };
  writeProfilesStore(store);
  currentEmail = key;
  applyProgress(store[key].progress);
  saveCurrentProfile(true);
  enterMenuForProfile();
}

async function loginProfile(email, password) {
  const key = normalizeEmail(email);
  if (!key || !key.includes("@")) throw new Error("Enter a valid email.");
  const store = loadProfilesStore();
  const profile = store[key];
  if (!profile) throw new Error("No profile for that email. Create one first.");
  const hash = await hashPassword(password);
  if (profile.passwordHash !== hash) throw new Error("Wrong password for that email.");
  currentEmail = key;
  applyProgress(profile.progress || defaultProgress());
  saveCurrentProfile(true);
  enterMenuForProfile();
}

function logoutProfile() {
  saveCurrentProfile(true);
  currentEmail = null;
  applyProgress(defaultProgress());
  localStorage.removeItem(SESSION_KEY);
  updateProfileUI();
  state = "menu";
  startScreen.classList.add("hidden");
  pauseScreen.classList.add("hidden");
  bustScreen.classList.add("hidden");
  garageScreen?.classList.add("hidden");
  hud.classList.add("hidden");
  playControls?.classList.add("hidden");
  damageHud?.classList.add("hidden");
  authScreen?.classList.remove("hidden");
  showAuthError("");
  if (authPasswordInput) authPasswordInput.value = "";
  if (authEmailInput) authEmailInput.focus();
}

function tryRestoreSession() {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return false;
    const session = JSON.parse(raw);
    const key = normalizeEmail(session?.email);
    if (!key) return false;
    const store = loadProfilesStore();
    const profile = store[key];
    if (!profile) {
      localStorage.removeItem(SESSION_KEY);
      return false;
    }
    currentEmail = key;
    applyProgress(profile.progress || defaultProgress());
    return true;
  } catch {
    return false;
  }
}

/** Fixed police count — pressure rises via faster models, not more cars. */
function getMaxCops() {
  return Math.min(COP_HARD_CAP, Math.round(5 * COP_AMOUNT_MULT));
}

/** How many patrol cars stay out after heat cools — none before the first delivery. */
function getPatrolCops() {
  if (dropCount <= 0) return 0;
  return Math.min(getMaxCops(), Math.round(2 * COP_AMOUNT_MULT));
}

/** Current police fleet tier — climbs slowly toward faster-looking cars (every 6 deliveries). */
function getPoliceTierIndex() {
  return Math.min(POLICE_TIERS.length - 1, Math.floor(dropCount / 6));
}

function getPoliceTier(index = getPoliceTierIndex()) {
  return POLICE_TIERS[Math.min(POLICE_TIERS.length - 1, Math.max(0, index))];
}

// ——— City grid (island metro: wide streets, canal, ocean rim) ———
const BLOCK = 58;
const ROAD_W = 16; // default street width
const ROAD_W_AVENUE = 22;
const ROAD_W_ALLEY = 9;
const ROAD_W_BRIDGE = 18;
const GRID = 12; // 12x12 intersections
const CITY = (GRID - 1) * BLOCK;
const HALF = CITY / 2;
const CANAL_J = 5; // canal corridor between j=5 and j=6
const CANAL_WATER_W = 28;

function intersectionPos(i, j) {
  return {
    x: -HALF + i * BLOCK,
    z: -HALF + j * BLOCK,
  };
}

function classifyRoad(a, b) {
  const minJ = Math.min(a.j, b.j);
  const maxJ = Math.max(a.j, b.j);
  const minI = Math.min(a.i, b.i);
  // Bridges cross the canal on every N–S span between the banks
  if (maxJ - minJ === 1 && minJ === CANAL_J) {
    return { type: "bridge", w: ROAD_W_BRIDGE };
  }
  // Perimeter + main cross + canal bank boulevards
  const onRing =
    a.i === 0 || a.i === GRID - 1 || b.i === 0 || b.i === GRID - 1 ||
    a.j === 0 || a.j === GRID - 1 || b.j === 0 || b.j === GRID - 1;
  const mainCross =
    a.i === 5 || b.i === 5 || a.j === 3 || b.j === 3 || a.j === 8 || b.j === 8;
  const canalBank = a.j === CANAL_J || b.j === CANAL_J || a.j === CANAL_J + 1 || b.j === CANAL_J + 1;
  if (onRing || mainCross || canalBank) {
    return { type: "avenue", w: ROAD_W_AVENUE };
  }
  // Narrow service alleys woven through quieter blocks
  if ((minI + minJ) % 3 === 0) {
    return { type: "alley", w: ROAD_W_ALLEY };
  }
  return { type: "street", w: ROAD_W };
}

// Road graph: nodes at intersections, edges along streets
const nodes = [];
for (let i = 0; i < GRID; i++) {
  for (let j = 0; j < GRID; j++) {
    const p = intersectionPos(i, j);
    nodes.push({ i, j, x: p.x, z: p.z, id: i * GRID + j });
  }
}

function nodeAt(i, j) {
  if (i < 0 || j < 0 || i >= GRID || j >= GRID) return null;
  return nodes[i * GRID + j];
}

const edges = [];
const edgesByNode = new Map(); // node.id → edges
function linkEdge(e) {
  edges.push(e);
  if (!edgesByNode.has(e.a.id)) edgesByNode.set(e.a.id, []);
  if (!edgesByNode.has(e.b.id)) edgesByNode.set(e.b.id, []);
  edgesByNode.get(e.a.id).push(e);
  edgesByNode.get(e.b.id).push(e);
}
for (let i = 0; i < GRID; i++) {
  for (let j = 0; j < GRID; j++) {
    if (i < GRID - 1) {
      const a = nodeAt(i, j), b = nodeAt(i + 1, j);
      const cls = classifyRoad(a, b);
      linkEdge({ a, b, type: cls.type, w: cls.w });
    }
    if (j < GRID - 1) {
      const a = nodeAt(i, j), b = nodeAt(i, j + 1);
      const cls = classifyRoad(a, b);
      linkEdge({ a, b, type: cls.type, w: cls.w });
    }
  }
}

function nearestNode(x, z) {
  let best = nodes[0], bestD = Infinity;
  for (const n of nodes) {
    const d = (n.x - x) ** 2 + (n.z - z) ** 2;
    if (d < bestD) { bestD = d; best = n; }
  }
  return best;
}

/** Distance to nearest road — only checks streets near the local grid cell. */
function nearestRoad(x, z) {
  const fi = (x + HALF) / BLOCK;
  const fj = (z + HALF) / BLOCK;
  const i0 = Math.max(0, Math.min(GRID - 1, Math.round(fi)));
  const j0 = Math.max(0, Math.min(GRID - 1, Math.round(fj)));
  let best = Infinity;
  let halfW = ROAD_W / 2;
  const seen = new Set();
  for (let di = -1; di <= 1; di++) {
    for (let dj = -1; dj <= 1; dj++) {
      const n = nodeAt(i0 + di, j0 + dj);
      if (!n) continue;
      const list = edgesByNode.get(n.id);
      if (!list) continue;
      for (const e of list) {
        if (seen.has(e)) continue;
        seen.add(e);
        const ax = e.a.x, az = e.a.z, bx = e.b.x, bz = e.b.z;
        const edx = bx - ax, edz = bz - az;
        const len2 = edx * edx + edz * edz || 1;
        let t = ((x - ax) * edx + (z - az) * edz) / len2;
        t = t < 0 ? 0 : t > 1 ? 1 : t;
        const d = Math.hypot(x - (ax + edx * t), z - (az + edz * t));
        if (d < best) {
          best = d;
          halfW = e.w * 0.5;
        }
      }
    }
  }
  return { dist: best, halfW };
}

function distToRoad(x, z) {
  return nearestRoad(x, z).dist;
}

/** slack = extra meters past the lane edge that still counts as "on road". */
function onRoad(x, z, slack = 1.5) {
  const { dist, halfW } = nearestRoad(x, z);
  return dist <= halfW + slack;
}

function randomRoadPoint() {
  const e = edges[(Math.random() * edges.length) | 0];
  const t = 0.2 + Math.random() * 0.6;
  return {
    x: e.a.x + (e.b.x - e.a.x) * t,
    z: e.a.z + (e.b.z - e.a.z) * t,
  };
}

function isCanalBlock(i, j) {
  return j === CANAL_J;
}

// ——— Input ———
const keys = Object.create(null);
window.addEventListener("keydown", (e) => {
  keys[e.code] = true;
  const garageOpen = garageScreen && !garageScreen.classList.contains("hidden");
  if (garageOpen && (e.code === "ArrowLeft" || e.code === "ArrowRight")) {
    e.preventDefault();
    shiftGarageCar(e.code === "ArrowLeft" ? -1 : 1);
    return;
  }
  if (garageOpen && e.code === "Escape") {
    closeGarage();
    return;
  }
  if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Space"].includes(e.code)) e.preventDefault();
  const authOpen = authScreen && !authScreen.classList.contains("hidden");
  if (e.code === "Enter" && state === "menu" && !garageOpen && !authOpen && currentEmail) startGame();
  if ((e.code === "Escape" || e.code === "KeyP") && (state === "playing" || state === "paused")) {
    togglePause();
  }
  if (e.code === "KeyG" && currentEmail && (state === "playing" || state === "paused" || state === "menu")) {
    if (garageOpen) closeGarage();
    else openGarage();
  }
});
window.addEventListener("keyup", (e) => { keys[e.code] = false; });

document.getElementById("start-btn").addEventListener("click", startGame);
document.getElementById("resume-btn").addEventListener("click", () => { if (state === "paused") togglePause(); });
document.getElementById("restart-btn").addEventListener("click", startGame);
document.getElementById("garage-btn").addEventListener("click", openGarage);
document.getElementById("garage-close").addEventListener("click", closeGarage);
document.getElementById("garage-prev").addEventListener("click", () => shiftGarageCar(-1));
document.getElementById("garage-next").addEventListener("click", () => shiftGarageCar(1));
document.getElementById("garage-action").addEventListener("click", onGarageAction);
document.getElementById("play-garage-btn").addEventListener("click", openGarage);
document.getElementById("bust-ok").addEventListener("click", () => {
  bustScreen.classList.add("hidden");
});

if (authForm) {
  authForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    showAuthError("");
    try {
      await loginProfile(authEmailInput?.value, authPasswordInput?.value);
    } catch (err) {
      showAuthError(err?.message || "Could not sign in.");
    }
  });
}
if (authSignupBtn) {
  authSignupBtn.addEventListener("click", async () => {
    showAuthError("");
    try {
      await createProfile(authEmailInput?.value, authPasswordInput?.value);
    } catch (err) {
      showAuthError(err?.message || "Could not create profile.");
    }
  });
}
if (logoutBtn) logoutBtn.addEventListener("click", logoutProfile);
if (logoutPauseBtn) logoutPauseBtn.addEventListener("click", logoutProfile);

window.addEventListener("beforeunload", () => saveCurrentProfile(true));
window.addEventListener("pagehide", () => saveCurrentProfile(true));
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") saveCurrentProfile(true);
});

function setPlayerMode(mode, { restart = false, persist = true } = {}) {
  playerMode = mode === 2 ? 2 : 1;
  document.body.classList.toggle("mode-1p", playerMode === 1);
  document.body.classList.toggle("mode-2p", playerMode === 2);
  if (mode1pBtn) mode1pBtn.classList.toggle("active", playerMode === 1);
  if (mode2pBtn) mode2pBtn.classList.toggle("active", playerMode === 2);
  if (startEyebrow) startEyebrow.textContent = playerMode === 1 ? "GETAWAY · SOLO" : "GETAWAY · SPLIT-SCREEN";
  if (p1ControlTitle) p1ControlTitle.textContent = playerMode === 1 ? "Driver" : "Player 1";
  if (p1HudLabel) p1HudLabel.textContent = playerMode === 1 ? "GETAWAY" : "P1 · GETAWAY";
  if (splitLabelLeft) splitLabelLeft.textContent = playerMode === 1 ? "WASD" : "P1 · WASD";
  // Keep shadows off in split-screen; never force them back on in solo (too expensive)
  if (typeof quality !== "undefined") {
    if (playerMode === 2) quality.shadows = false;
    if (typeof applyQualitySettings === "function") applyQualitySettings();
  }
  if (switchModeBtn) {
    switchModeBtn.textContent = playerMode === 1 ? "SWITCH TO 2 PLAYER" : "SWITCH TO 1 PLAYER";
  }
  viewDirty = true;
  if (persist && currentEmail) saveCurrentProfile();
  if (restart && (state === "playing" || state === "paused")) {
    startGame();
    return;
  }
  if (state === "menu" && typeof createPlayer === "function" && scene) {
    try { resetPlayers(); } catch (_) { /* players not ready yet during first boot */ }
  }
  applyModeUI();
}

function applyModeUI() {
  const dual = playerMode === 2;
  const playing = state === "playing" || state === "paused";
  if (splitLabels) splitLabels.classList.toggle("hidden", !dual || !playing);
  if (splitDivider) splitDivider.classList.toggle("hidden", !dual || !playing);
  if (p2HudCard) p2HudCard.classList.toggle("hidden", !dual);
  if (dmgPanelRight) dmgPanelRight.classList.toggle("hidden", !dual);
}

if (mode1pBtn) mode1pBtn.addEventListener("click", () => setPlayerMode(1));
if (mode2pBtn) mode2pBtn.addEventListener("click", () => setPlayerMode(2));
if (switchModeBtn) {
  switchModeBtn.addEventListener("click", () => {
    setPlayerMode(playerMode === 1 ? 2 : 1, { restart: true });
  });
}

// ——— Renderer ———
setLoad(0.1, "Booting renderer…");
const renderer = new THREE.WebGLRenderer({
  canvas,
  antialias: false,
  powerPreference: "high-performance",
  preserveDrawingBuffer: false,
  stencil: false,
  depth: true,
});
renderer.setPixelRatio(MAX_PIXEL_RATIO);
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setClearColor(0x4a6a82, 1);
renderer.shadowMap.enabled = false;
renderer.shadowMap.type = THREE.BasicShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.9;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.info.autoReset = true;

const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2(0x5a7a94, 0.00095);

const sky = new Sky();
sky.scale.setScalar(8000);
scene.add(sky);
const skyU = sky.material.uniforms;
skyU.turbidity.value = 4.2;
skyU.rayleigh.value = 1.35;
skyU.mieCoefficient.value = 0.006;
skyU.mieDirectionalG.value = 0.75;
const sun = new THREE.Vector3().setFromSphericalCoords(
  1,
  THREE.MathUtils.degToRad(52),
  THREE.MathUtils.degToRad(145)
);
skyU.sunPosition.value.copy(sun);

const hemi = new THREE.HemisphereLight(0xc8d8e8, 0x3a4a40, 0.42);
scene.add(hemi);
const sunLight = new THREE.DirectionalLight(0xffe8c8, 1.25);
sunLight.position.copy(sun.clone().multiplyScalar(380));
sunLight.castShadow = false;
sunLight.shadow.mapSize.set(1024, 1024);
sunLight.shadow.camera.near = 20;
sunLight.shadow.camera.far = 280;
sunLight.shadow.camera.left = -55;
sunLight.shadow.camera.right = 55;
sunLight.shadow.camera.top = 55;
sunLight.shadow.camera.bottom = -55;
sunLight.shadow.bias = -0.0004;
sunLight.shadow.normalBias = 0.05;
scene.add(sunLight);
scene.add(sunLight.target);
scene.add(new THREE.AmbientLight(0xb8c8d4, 0.18));
const fillLight = new THREE.DirectionalLight(0x8898a8, 0.28);
fillLight.position.set(-180, 120, -90);
scene.add(fillLight);

// Soft environment reflections from the sky (one-time bake — cheap at runtime)
let envMap = null;
try {
  const pmrem = new THREE.PMREMGenerator(renderer);
  pmrem.compileEquirectangularShader();
  const envScene = new THREE.Scene();
  const skyClone = sky.clone();
  envScene.add(skyClone);
  envMap = pmrem.fromScene(envScene, 0.04).texture;
  scene.environment = envMap;
  scene.environmentIntensity = 0.58;
  pmrem.dispose();
  envScene.clear();
} catch (_) {
  envMap = null;
  scene.environment = null;
}

/** Adaptive quality — starts lean; only raises detail if frames stay smooth. */
const quality = {
  pixelRatio: MAX_PIXEL_RATIO,
  shadows: false,
  smoke: true,
  avgDt: 0.016,
};

// ——— Build city ———
setLoad(0.3, "Paving streets…");

function makeAsphalt(style = "street") {
  const SIZE = ASPHALT_TEX_SIZE;
  const c = document.createElement("canvas");
  c.width = c.height = SIZE;
  const g = c.getContext("2d", { willReadFrequently: false });
  const palettes = {
    street: ["#5a616c", "#6a717c", "#5a616c"],
    avenue: ["#4e5560", "#5c6470", "#4e5560"],
    alley: ["#6a5e52", "#7a6c5e", "#6a5e52"],
    bridge: ["#5a6270", "#6a7280", "#5a6270"],
  };
  const cols = palettes[style] || palettes.street;
  const base = g.createLinearGradient(0, 0, SIZE, 0);
  base.addColorStop(0, cols[0]);
  base.addColorStop(0.5, cols[1]);
  base.addColorStop(1, cols[2]);
  g.fillStyle = base;
  g.fillRect(0, 0, SIZE, SIZE);
  // Sparse grit — looks similar, avoids 14k fillRect hangs on load
  const grit = style === "alley" ? 900 : 1400;
  for (let i = 0; i < grit; i++) {
    const v = 88 + Math.random() * 50;
    g.fillStyle = `rgba(${v},${v + 2},${v + 6},${0.12 + Math.random() * 0.2})`;
    g.fillRect(Math.random() * SIZE, Math.random() * SIZE, 1 + Math.random() * 2.5, 1 + Math.random() * 2.5);
  }
  if (style === "alley") {
    g.strokeStyle = "rgba(40,30,22,0.35)";
    g.lineWidth = 2;
    for (let y = 0; y < SIZE; y += 28) {
      g.beginPath(); g.moveTo(0, y); g.lineTo(SIZE, y); g.stroke();
      const ox = (y / 28) % 2 === 0 ? 0 : 36;
      for (let x = ox; x < SIZE; x += 72) {
        g.beginPath(); g.moveTo(x, y); g.lineTo(x, y + 28); g.stroke();
      }
    }
  } else {
    g.fillStyle = "rgba(0,0,0,0.08)";
    g.fillRect(SIZE * 0.176, 0, SIZE * 0.088, SIZE);
    g.fillRect(SIZE * 0.736, 0, SIZE * 0.088, SIZE);
    g.strokeStyle = "rgba(255,255,255,0.98)";
    g.lineWidth = style === "avenue" ? 8 : 7;
    g.setLineDash([]);
    g.beginPath(); g.moveTo(SIZE * 0.047, 0); g.lineTo(SIZE * 0.047, SIZE); g.stroke();
    g.beginPath(); g.moveTo(SIZE * 0.953, 0); g.lineTo(SIZE * 0.953, SIZE); g.stroke();
    if (style === "avenue" || style === "bridge") {
      g.strokeStyle = "rgba(255,255,255,0.85)";
      g.lineWidth = 3;
      g.setLineDash([14, 11]);
      g.beginPath(); g.moveTo(SIZE * 0.332, 0); g.lineTo(SIZE * 0.332, SIZE); g.stroke();
      g.beginPath(); g.moveTo(SIZE * 0.668, 0); g.lineTo(SIZE * 0.668, SIZE); g.stroke();
      g.setLineDash([]);
    }
    g.strokeStyle = "rgba(255,214,40,0.98)";
    g.lineWidth = 4;
    g.beginPath(); g.moveTo(SIZE * 0.488, 0); g.lineTo(SIZE * 0.488, SIZE); g.stroke();
    g.beginPath(); g.moveTo(SIZE * 0.512, 0); g.lineTo(SIZE * 0.512, SIZE); g.stroke();
    if (style === "bridge") {
      g.strokeStyle = "rgba(200,80,60,0.7)";
      g.lineWidth = 5;
      g.setLineDash([9, 6]);
      g.beginPath(); g.moveTo(SIZE * 0.088, 0); g.lineTo(SIZE * 0.088, SIZE); g.stroke();
      g.beginPath(); g.moveTo(SIZE * 0.912, 0); g.lineTo(SIZE * 0.912, SIZE); g.stroke();
      g.setLineDash([]);
    }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  return tex;
}

function makeIntersectionTex() {
  const c = document.createElement("canvas");
  c.width = c.height = 512;
  const g = c.getContext("2d");
  g.fillStyle = "#636a75";
  g.fillRect(0, 0, 512, 512);
  for (let i = 0; i < 800; i++) {
    const v = 90 + Math.random() * 45;
    g.fillStyle = `rgba(${v},${v},${v + 4},0.22)`;
    g.fillRect(Math.random() * 512, Math.random() * 512, 2, 2);
  }
  // Crosswalk stripes on all four sides
  g.fillStyle = "rgba(255,255,255,0.95)";
  const stripe = (x0, y0, horiz) => {
    for (let i = 0; i < 8; i++) {
      if (horiz) g.fillRect(x0 + i * 28, y0, 16, 56);
      else g.fillRect(x0, y0 + i * 28, 56, 16);
    }
  };
  stripe(148, 18, true);
  stripe(148, 438, true);
  stripe(18, 148, false);
  stripe(438, 148, false);
  // Stop lines
  g.fillStyle = "rgba(255,255,255,0.9)";
  g.fillRect(120, 86, 272, 8);
  g.fillRect(120, 418, 272, 8);
  g.fillRect(86, 120, 8, 272);
  g.fillRect(418, 120, 8, 272);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
  return tex;
}

function seededRand(seed) {
  let s = (seed * 16807 + 11) % 2147483647;
  return () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

function hsl(h, s, l, a = 1) {
  return a < 1 ? `hsla(${h}, ${s}%, ${l}%, ${a})` : `hsl(${h}, ${s}%, ${l}%)`;
}

const buildingTexCache = new Map();

function makeBuildingTex(seed, type = "apartment") {
  const variant = seed % 6;
  const key = `${type}:${variant}`;
  if (buildingTexCache.has(key)) return buildingTexCache.get(key);

  const c = document.createElement("canvas");
  c.width = BUILDING_TEX_W;
  c.height = BUILDING_TEX_H;
  const g = c.getContext("2d");
  const rnd = seededRand(seed * 97 + variant * 13 + type.length * 31);
  const TW = BUILDING_TEX_W;
  const TH = BUILDING_TEX_H;

  const profiles = {
    apartment: { hue: 18 + variant * 8, sat: 28, lit0: 74, lit1: 52, rows: 14, cols: 6, style: "brick" },
    office: { hue: 205 + variant * 4, sat: 14, lit0: 86, lit1: 68, rows: 18, cols: 8, style: "panel" },
    warehouse: { hue: 38 + variant * 5, sat: 16, lit0: 66, lit1: 48, rows: 6, cols: 5, style: "metal" },
    shop: { hue: 25 + variant * 28, sat: 42, lit0: 72, lit1: 50, rows: 5, cols: 5, style: "stucco" },
    skyscraper: { hue: 210 + variant * 3, sat: 10, lit0: 88, lit1: 72, rows: 28, cols: 10, style: "glass" },
  };
  const p = profiles[type] || profiles.apartment;

  // Base facade with vertical weather gradient
  const grad = g.createLinearGradient(0, 0, 0, TH);
  grad.addColorStop(0, hsl(p.hue, p.sat, p.lit0));
  grad.addColorStop(0.55, hsl(p.hue, Math.max(6, p.sat - 4), (p.lit0 + p.lit1) * 0.5));
  grad.addColorStop(1, hsl(p.hue, Math.max(5, p.sat - 10), p.lit1 - 4));
  g.fillStyle = grad;
  g.fillRect(0, 0, TW, TH);

  // Surface material grain
  if (p.style === "brick") {
    const bh = 14, bw = 28;
    for (let y = 0; y < TH; y += bh) {
      const offset = ((y / bh) | 0) % 2 ? bw * 0.5 : 0;
      for (let x = -bw; x < TW + bw; x += bw) {
        const shade = 46 + rnd() * 18;
        g.fillStyle = hsl(p.hue + rnd() * 6 - 3, p.sat + 8, shade, 0.55);
        g.fillRect(x + offset + 1, y + 1, bw - 2, bh - 2);
        g.fillStyle = "rgba(255,255,255,0.06)";
        g.fillRect(x + offset + 1, y + 1, bw - 2, 2);
        g.fillStyle = "rgba(0,0,0,0.12)";
        g.fillRect(x + offset + 1, y + bh - 3, bw - 2, 2);
      }
    }
    // Mortar lines
    g.strokeStyle = "rgba(210,200,185,0.35)";
    g.lineWidth = 1;
    for (let y = 0; y < TH; y += bh) {
      g.beginPath(); g.moveTo(0, y); g.lineTo(TW, y); g.stroke();
    }
  } else if (p.style === "panel" || p.style === "glass") {
    // Curtain-wall / concrete panel seams
    g.strokeStyle = p.style === "glass" ? "rgba(30,40,55,0.55)" : "rgba(255,255,255,0.28)";
    g.lineWidth = p.style === "glass" ? 3 : 2;
    for (let x = 0; x < TW; x += 32) {
      g.beginPath(); g.moveTo(x, 0); g.lineTo(x, TH); g.stroke();
    }
    for (let y = 0; y < TH; y += 28) {
      g.beginPath(); g.moveTo(0, y); g.lineTo(TW, y); g.stroke();
    }
    // Specular striping for glass towers
    if (p.style === "glass") {
      for (let i = 0; i < 18; i++) {
        const x = rnd() * TW;
        const band = g.createLinearGradient(x, 0, x + 40, 0);
        band.addColorStop(0, "rgba(180,220,255,0)");
        band.addColorStop(0.5, "rgba(210,235,255,0.22)");
        band.addColorStop(1, "rgba(180,220,255,0)");
        g.fillStyle = band;
        g.fillRect(x, 0, 40, TH);
      }
    }
  } else if (p.style === "metal") {
    g.strokeStyle = "rgba(70,60,45,0.35)";
    g.lineWidth = 4;
    for (let x = 0; x < TW; x += 22) {
      g.beginPath(); g.moveTo(x, 0); g.lineTo(x, TH); g.stroke();
      g.fillStyle = "rgba(255,255,255,0.05)";
      g.fillRect(x + 2, 0, 4, TH);
    }
    // Rivet row
    g.fillStyle = "rgba(90,80,60,0.45)";
    for (let y = 40; y < TH; y += 80) {
      for (let x = 10; x < TW; x += 22) {
        g.beginPath();
        g.arc(x, y, 2.2, 0, Math.PI * 2);
        g.fill();
      }
    }
  } else {
    // Stucco noise
    for (let i = 0; i < 2200; i++) {
      const v = 180 + rnd() * 50;
      g.fillStyle = `rgba(${v},${v - 8},${v - 16},${0.08 + rnd() * 0.1})`;
      g.fillRect(rnd() * TW, rnd() * TH, 2 + rnd() * 3, 2 + rnd() * 3);
    }
  }

  // Ground-floor storefront band
  if (type === "shop" || type === "apartment") {
    const bandY = type === "shop" ? (TH * 0.8) | 0 : (TH * 0.88) | 0;
    g.fillStyle = hsl((p.hue + 30) % 360, Math.min(70, p.sat + 20), 42);
    g.fillRect(0, bandY, TW, TH - bandY);
    // Awning stripe
    g.fillStyle = hsl((p.hue + 50) % 360, 55, 48);
    g.fillRect(0, bandY - 18, TW, 18);
    // Display glass
    for (let i = 0; i < 3; i++) {
      const gx = 14 + i * ((TW - 40) / 3);
      const glass = g.createLinearGradient(gx, bandY + 20, gx + 130, bandY + 160);
      glass.addColorStop(0, "rgba(160,210,245,0.85)");
      glass.addColorStop(0.45, "rgba(70,100,130,0.55)");
      glass.addColorStop(1, "rgba(200,230,255,0.7)");
      g.fillStyle = glass;
      g.fillRect(gx, bandY + 12, TW * 0.25, TH * 0.14);
      g.strokeStyle = "rgba(40,40,45,0.7)";
      g.lineWidth = 5;
      g.strokeRect(gx, bandY + 12, TW * 0.25, TH * 0.14);
      // Door mullion
      g.fillStyle = "rgba(30,30,35,0.55)";
      g.fillRect(gx + TW * 0.12, bandY + 12, 3, TH * 0.14);
    }
  }

  // Floors / windows with frames + depth
  const topPad = 28;
  const bottomPad = type === "shop" ? 220 : type === "apartment" ? 130 : 40;
  const usableH = TH - topPad - bottomPad;
  const rowH = usableH / p.rows;
  const sidePad = 22;
  const colW = (TW - sidePad * 2) / p.cols;

  for (let r = 0; r < p.rows; r++) {
    // Floor ledge shadow strip
    const ly = topPad + r * rowH;
    g.fillStyle = "rgba(0,0,0,0.18)";
    g.fillRect(0, ly - 3, TW, 4);
    g.fillStyle = "rgba(255,255,255,0.12)";
    g.fillRect(0, ly - 5, TW, 2);

    for (let col = 0; col < p.cols; col++) {
      const ww = colW * (p.style === "glass" ? 0.88 : p.style === "metal" ? 0.68 : 0.7);
      const hh = rowH * (p.style === "glass" ? 0.72 : 0.58);
      const wx = sidePad + col * colW + (colW - ww) * 0.5;
      const wy = ly + (rowH - hh) * 0.45;

      // Window recess (dark frame)
      g.fillStyle = "rgba(25,28,34,0.92)";
      g.fillRect(wx - 3, wy - 3, ww + 6, hh + 6);

      // Interior / sky reflection
      const tint = rnd();
      let glassGrad;
      if (p.style === "glass") {
        glassGrad = g.createLinearGradient(wx, wy, wx + ww, wy + hh);
        glassGrad.addColorStop(0, `rgba(${140 + rnd() * 40 | 0},${190 + rnd() * 40 | 0},255,0.92)`);
        glassGrad.addColorStop(0.5, `rgba(${40 + rnd() * 30 | 0},${70 + rnd() * 40 | 0},${90 + rnd() * 40 | 0},0.75)`);
        glassGrad.addColorStop(1, `rgba(${170 + rnd() * 50 | 0},${210 + rnd() * 30 | 0},250,0.88)`);
      } else if (tint < 0.2) {
        // Dark blinds / empty
        glassGrad = g.createLinearGradient(wx, wy, wx, wy + hh);
        glassGrad.addColorStop(0, "rgba(55,65,78,0.9)");
        glassGrad.addColorStop(1, "rgba(30,36,45,0.95)");
      } else if (tint < 0.55) {
        glassGrad = g.createLinearGradient(wx, wy, wx + ww, wy + hh);
        glassGrad.addColorStop(0, "rgba(150,195,235,0.8)");
        glassGrad.addColorStop(1, "rgba(60,90,120,0.7)");
      } else {
        // Lit interior (day soft)
        glassGrad = g.createLinearGradient(wx, wy, wx, wy + hh);
        glassGrad.addColorStop(0, "rgba(235,220,180,0.55)");
        glassGrad.addColorStop(1, "rgba(120,110,90,0.45)");
      }
      g.fillStyle = glassGrad;
      g.fillRect(wx, wy, ww, hh);

      // Specular highlight edge
      g.fillStyle = "rgba(255,255,255,0.28)";
      g.fillRect(wx, wy, ww, 2);
      g.fillRect(wx, wy, 2, hh);

      // Mullions
      if (ww > 28) {
        g.fillStyle = "rgba(35,40,50,0.55)";
        g.fillRect(wx + ww * 0.5 - 1, wy, 2, hh);
      }
      if (hh > 22 && p.style !== "metal") {
        g.fillStyle = "rgba(35,40,50,0.4)";
        g.fillRect(wx, wy + hh * 0.5 - 1, ww, 2);
      }

      // Sill
      g.fillStyle = "rgba(220,220,225,0.35)";
      g.fillRect(wx - 4, wy + hh + 1, ww + 8, 3);
    }
  }

  // Parapet / crown
  g.fillStyle = "rgba(0,0,0,0.25)";
  g.fillRect(0, 0, TW, 18);
  g.fillStyle = "rgba(255,255,255,0.18)";
  g.fillRect(0, 16, TW, 4);

  // Corner weathering
  const sideShade = g.createLinearGradient(0, 0, 40, 0);
  sideShade.addColorStop(0, "rgba(0,0,0,0.22)");
  sideShade.addColorStop(1, "rgba(0,0,0,0)");
  g.fillStyle = sideShade;
  g.fillRect(0, 0, 40, TH);
  const sideShade2 = g.createLinearGradient(TW, 0, TW - 40, 0);
  sideShade2.addColorStop(0, "rgba(0,0,0,0.18)");
  sideShade2.addColorStop(1, "rgba(0,0,0,0)");
  g.fillStyle = sideShade2;
  g.fillRect(TW - 40, 0, 40, TH);

  // Base dirt / AO
  const baseAo = g.createLinearGradient(0, TH * 0.88, 0, TH);
  baseAo.addColorStop(0, "rgba(0,0,0,0)");
  baseAo.addColorStop(1, "rgba(0,0,0,0.35)");
  g.fillStyle = baseAo;
  g.fillRect(0, TH * 0.86, TW, TH * 0.14);

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  buildingTexCache.set(key, tex);
  return tex;
}

function makeBuildingBumpTex(seed, type = "apartment") {
  const variant = seed % 6;
  const key = `bump:${type}:${variant}`;
  if (buildingTexCache.has(key)) return buildingTexCache.get(key);
  const c = document.createElement("canvas");
  c.width = 128;
  c.height = 256;
  const g = c.getContext("2d");
  const rnd = seededRand(seed * 41 + 9);
  g.fillStyle = "#808080";
  g.fillRect(0, 0, 128, 256);
  if (type === "apartment" || type === "shop") {
    for (let y = 0; y < 256; y += 8) {
      const off = ((y / 8) | 0) % 2 ? 8 : 0;
      for (let x = -8; x < 128; x += 16) {
        const v = 110 + rnd() * 40;
        g.fillStyle = `rgb(${v},${v},${v})`;
        g.fillRect(x + off, y, 14, 6);
      }
    }
  } else {
    for (let i = 0; i < 400; i++) {
      const v = 100 + rnd() * 55;
      g.fillStyle = `rgb(${v},${v},${v})`;
      g.fillRect(rnd() * 128, rnd() * 256, 2, 2);
    }
    g.strokeStyle = "rgba(60,60,60,0.5)";
    for (let x = 0; x < 128; x += 16) {
      g.beginPath(); g.moveTo(x, 0); g.lineTo(x, 256); g.stroke();
    }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  buildingTexCache.set(key, tex);
  return tex;
}

function makeSidewalkTex() {
  const c = document.createElement("canvas");
  c.width = c.height = 256;
  const g = c.getContext("2d");
  g.fillStyle = "#c8c4b8";
  g.fillRect(0, 0, 256, 256);
  g.strokeStyle = "rgba(110,100,80,0.35)";
  g.lineWidth = 2;
  for (let i = 0; i <= 8; i++) {
    g.beginPath(); g.moveTo(i * 32, 0); g.lineTo(i * 32, 256); g.stroke();
    g.beginPath(); g.moveTo(0, i * 32); g.lineTo(256, i * 32); g.stroke();
  }
  g.fillStyle = "rgba(255,255,255,0.12)";
  for (let i = 0; i < 80; i++) {
    g.fillRect(Math.random() * 256, Math.random() * 256, 3, 3);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

const asphaltTex = makeAsphalt("street");
const avenueTex = makeAsphalt("avenue");
const alleyTex = makeAsphalt("alley");
const bridgeTex = makeAsphalt("bridge");
const roadTexByType = { street: asphaltTex, avenue: avenueTex, alley: alleyTex, bridge: bridgeTex };
const sidewalkTex = makeSidewalkTex();
const intersectionTex = makeIntersectionTex();
const world = new THREE.Group();
scene.add(world);

// Solid collision boxes for buildings, lamps, curbs, props (spatial hash)
const colliders = [];
const COLLIDER_CELL = 40;
const colliderGrid = new Map();

function colliderCellKey(ix, iz) {
  return (ix << 16) ^ (iz & 0xffff);
}

function addBoxCollider(x, z, w, d, kind = "building", bounce = 0.55) {
  const hw = w * 0.5;
  const hd = d * 0.5;
  const box = {
    x, z, hw, hd, kind, bounce,
    minX: x - hw, maxX: x + hw, minZ: z - hd, maxZ: z + hd,
  };
  colliders.push(box);
  const minIX = Math.floor(box.minX / COLLIDER_CELL);
  const maxIX = Math.floor(box.maxX / COLLIDER_CELL);
  const minIZ = Math.floor(box.minZ / COLLIDER_CELL);
  const maxIZ = Math.floor(box.maxZ / COLLIDER_CELL);
  for (let ix = minIX; ix <= maxIX; ix++) {
    for (let iz = minIZ; iz <= maxIZ; iz++) {
      const key = colliderCellKey(ix, iz);
      let cell = colliderGrid.get(key);
      if (!cell) {
        cell = [];
        colliderGrid.set(key, cell);
      }
      cell.push(box);
    }
  }
}

function queryColliders(x, z, reach) {
  const minIX = Math.floor((x - reach) / COLLIDER_CELL);
  const maxIX = Math.floor((x + reach) / COLLIDER_CELL);
  const minIZ = Math.floor((z - reach) / COLLIDER_CELL);
  const maxIZ = Math.floor((z + reach) / COLLIDER_CELL);
  const out = [];
  const seen = new Set();
  for (let ix = minIX; ix <= maxIX; ix++) {
    for (let iz = minIZ; iz <= maxIZ; iz++) {
      const cell = colliderGrid.get(colliderCellKey(ix, iz));
      if (!cell) continue;
      for (const box of cell) {
        if (seen.has(box)) continue;
        seen.add(box);
        out.push(box);
      }
    }
  }
  return out;
}

function circleVsAABB(cx, cz, r, box) {
  const qx = Math.max(box.minX, Math.min(cx, box.maxX));
  const qz = Math.max(box.minZ, Math.min(cz, box.maxZ));
  let dx = cx - qx;
  let dz = cz - qz;
  const dist2 = dx * dx + dz * dz;
  if (dist2 >= r * r) return null;
  let dist = Math.sqrt(dist2);
  if (dist < 1e-5) {
    // Center inside box — push out along shallowest axis
    const left = cx - box.minX;
    const right = box.maxX - cx;
    const top = cz - box.minZ;
    const bottom = box.maxZ - cz;
    const m = Math.min(left, right, top, bottom);
    if (m === left) return { nx: -1, nz: 0, pen: r + left, box };
    if (m === right) return { nx: 1, nz: 0, pen: r + right, box };
    if (m === top) return { nx: 0, nz: -1, pen: r + top, box };
    return { nx: 0, nz: 1, pen: r + bottom, box };
  }
  return { nx: dx / dist, nz: dz / dist, pen: r - dist, box };
}

const waterMat = new THREE.MeshStandardMaterial({
  color: 0x1f7aad,
  roughness: 0.18,
  metalness: 0.45,
  envMapIntensity: 1.35,
  transparent: true,
  opacity: 0.92,
});
const deepOceanMat = new THREE.MeshStandardMaterial({
  color: 0x0d4a72,
  roughness: 0.22,
  metalness: 0.4,
  envMapIntensity: 1.1,
});
const sandMat = new THREE.MeshStandardMaterial({
  color: 0xd8c496,
  roughness: 0.96,
  metalness: 0.02,
});
const grassMat = new THREE.MeshStandardMaterial({
  color: 0x4f9a58,
  roughness: 0.95,
  metalness: 0.02,
});

// Ocean surrounds the entire island city
{
  const ocean = new THREE.Mesh(
    new THREE.PlaneGeometry(CITY + 900, CITY + 900),
    deepOceanMat
  );
  ocean.rotation.x = -Math.PI / 2;
  ocean.position.y = -1.15;
  ocean.receiveShadow = false;
  ocean.frustumCulled = true;
  world.add(ocean);

  // Lighter near-shore water shelf
  const shelf = new THREE.Mesh(
    new THREE.PlaneGeometry(CITY + 180, CITY + 180),
    waterMat
  );
  shelf.rotation.x = -Math.PI / 2;
  shelf.position.y = -0.85;
  shelf.receiveShadow = false;
  world.add(shelf);

  // Island land pad
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(CITY + 70, CITY + 70),
    grassMat
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.12;
  ground.receiveShadow = true;
  world.add(ground);

  // Sandy beaches on all four shores
  const shore = 42;
  const beaches = [
    [0, HALF + shore * 0.5 + 12, CITY + shore * 2 + 24, shore],
    [0, -HALF - shore * 0.5 - 12, CITY + shore * 2 + 24, shore],
    [HALF + shore * 0.5 + 12, 0, shore, CITY + 24],
    [-HALF - shore * 0.5 - 12, 0, shore, CITY + 24],
  ];
  for (const [bx, bz, bw, bd] of beaches) {
    const beach = new THREE.Mesh(new THREE.PlaneGeometry(bw, bd), sandMat);
    beach.rotation.x = -Math.PI / 2;
    beach.position.set(bx, -0.06, bz);
    beach.receiveShadow = true;
    world.add(beach);
  }
}

// Canal running east–west through the city, crossed by bridges
const canalZ = (intersectionPos(0, CANAL_J).z + intersectionPos(0, CANAL_J + 1).z) * 0.5;
{
  const canal = new THREE.Mesh(
    new THREE.PlaneGeometry(CITY + 36, CANAL_WATER_W),
    waterMat.clone()
  );
  canal.material.color = new THREE.Color(0x2a8ec0);
  canal.rotation.x = -Math.PI / 2;
  canal.position.set(0, -0.55, canalZ);
  canal.receiveShadow = true;
  world.add(canal);

  // Stone embankment walls along both banks
  const wallMat = new THREE.MeshStandardMaterial({
    color: 0x8a909a, roughness: 0.82, metalness: 0.12,
  });
  for (const side of [-1, 1]) {
    const wall = new THREE.Mesh(
      new THREE.BoxGeometry(CITY + 20, 1.4, 1.2),
      wallMat
    );
    wall.position.set(0, 0.15, canalZ + side * (CANAL_WATER_W * 0.5 + 0.4));
    wall.castShadow = true;
    wall.receiveShadow = true;
    world.add(wall);
  }

  // Soft water collision between bridge spans (bridges stay open)
  for (let i = 0; i < GRID - 1; i++) {
    const bx = intersectionPos(i, 0).x;
    const nextX = intersectionPos(i + 1, 0).x;
    const left = bx + ROAD_W_BRIDGE * 0.55;
    const right = nextX - ROAD_W_BRIDGE * 0.55;
    const mid = (left + right) * 0.5;
    const w = Math.max(2, right - left);
    if (w > 3) {
      addBoxCollider(mid, canalZ, w, CANAL_WATER_W * 0.85, "curb", 0.15);
    }
  }
}

// Roads + sidewalks (+ bridges over the canal)
const walkMat = new THREE.MeshStandardMaterial({
  map: sidewalkTex, roughness: 0.92, metalness: 0.04,
});
const curbMat = new THREE.MeshStandardMaterial({
  color: 0xd4cfc2, roughness: 0.88, metalness: 0.05,
});
const railMat = new THREE.MeshStandardMaterial({
  color: 0xb8c0cc, metalness: 0.55, roughness: 0.4, envMapIntensity: 0.7,
});
const pierMat = new THREE.MeshStandardMaterial({
  color: 0x7a808a, roughness: 0.75, metalness: 0.2,
});

// Shared road materials (no per-segment texture clones)
const roadMatsH = {};
const roadMatsV = {};
for (const [type, tex] of Object.entries(roadTexByType)) {
  tex.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  tex.repeat.set(4, 1);
  roadMatsH[type] = new THREE.MeshStandardMaterial({
    map: tex,
    roughness: type === "alley" ? 0.9 : 0.82,
    metalness: type === "bridge" ? 0.18 : 0.06,
    envMapIntensity: 0.35,
  });
  const vtex = tex.clone();
  vtex.wrapS = vtex.wrapT = THREE.RepeatWrapping;
  vtex.rotation = Math.PI / 2;
  vtex.center.set(0.5, 0.5);
  vtex.repeat.set(1, 4);
  vtex.anisotropy = tex.anisotropy;
  roadMatsV[type] = new THREE.MeshStandardMaterial({
    map: vtex,
    roughness: type === "alley" ? 0.9 : 0.82,
    metalness: type === "bridge" ? 0.18 : 0.06,
    envMapIntensity: 0.35,
  });
}

for (const e of edges) {
  const dx = e.b.x - e.a.x;
  const dz = e.b.z - e.a.z;
  const len = Math.hypot(dx, dz);
  const horiz = Math.abs(dx) > Math.abs(dz);
  const roadW = e.w;
  const isBridge = e.type === "bridge";
  const trim = Math.max(ROAD_W_ALLEY, Math.min(roadW, ROAD_W_AVENUE));
  const segLen = Math.max(4, len - trim);
  const y = isBridge ? 0.12 : 0.02;
  const mat = (horiz ? roadMatsH : roadMatsV)[e.type] || roadMatsH.street;

  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(horiz ? segLen : roadW, horiz ? roadW : segLen),
    mat
  );
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.set((e.a.x + e.b.x) / 2, y, (e.a.z + e.b.z) / 2);
  mesh.receiveShadow = true;
  world.add(mesh);

  if (isBridge) {
    // Thick bridge deck
    const deck = new THREE.Mesh(
      new THREE.BoxGeometry(horiz ? segLen : roadW + 1.2, 0.55, horiz ? roadW + 1.2 : segLen),
      pierMat
    );
    deck.position.set((e.a.x + e.b.x) / 2, -0.05, (e.a.z + e.b.z) / 2);
    deck.castShadow = false;
    deck.receiveShadow = true;
    world.add(deck);

    // Support piers in the canal
    for (const t of [0.35, 0.65]) {
      const px = e.a.x + (e.b.x - e.a.x) * t;
      const pz = e.a.z + (e.b.z - e.a.z) * t;
      const pier = new THREE.Mesh(
        new THREE.BoxGeometry(horiz ? 2.2 : 1.4, 2.4, horiz ? 1.4 : 2.2),
        pierMat
      );
      pier.position.set(px, -1.0, pz);
      pier.castShadow = false;
      world.add(pier);
    }

    // Railings along both sides
    for (const side of [-1, 1]) {
      const rail = new THREE.Mesh(
        new THREE.BoxGeometry(horiz ? segLen : 0.22, 1.05, horiz ? 0.22 : segLen),
        railMat
      );
      rail.position.set(
        (e.a.x + e.b.x) / 2 + (horiz ? 0 : side * (roadW / 2 + 0.35)),
        0.7,
        (e.a.z + e.b.z) / 2 + (horiz ? side * (roadW / 2 + 0.35) : 0)
      );
      rail.castShadow = true;
      world.add(rail);
      addBoxCollider(
        (e.a.x + e.b.x) / 2 + (horiz ? 0 : side * (roadW / 2 + 0.35)),
        (e.a.z + e.b.z) / 2 + (horiz ? side * (roadW / 2 + 0.35) : 0),
        horiz ? segLen : 0.45,
        horiz ? 0.45 : segLen,
        "curb",
        0.35
      );
    }
    continue; // no standard sidewalks on bridge spans
  }

  // Sidewalks + raised curbs (alleys get narrower walks; fewer curb colliders)
  const walkW = e.type === "alley" ? 2.2 : e.type === "avenue" ? 4.2 : 3.4;
  for (const side of [-1, 1]) {
    const sw = new THREE.Mesh(
      new THREE.PlaneGeometry(horiz ? segLen : walkW, horiz ? walkW : segLen),
      walkMat
    );
    sw.rotation.x = -Math.PI / 2;
    sw.position.set(
      (e.a.x + e.b.x) / 2 + (horiz ? 0 : side * (roadW / 2 + walkW * 0.55)),
      0.05,
      (e.a.z + e.b.z) / 2 + (horiz ? side * (roadW / 2 + walkW * 0.55) : 0)
    );
    sw.receiveShadow = false;
    world.add(sw);

    if (e.type !== "alley") {
      // Visual curb only — cars mount / cross sidewalks freely (no collider)
      const curb = new THREE.Mesh(
        new THREE.BoxGeometry(horiz ? segLen : 0.35, 0.12, horiz ? 0.35 : segLen),
        curbMat
      );
      curb.position.set(
        (e.a.x + e.b.x) / 2 + (horiz ? 0 : side * (roadW / 2 + 0.2)),
        0.06,
        (e.a.z + e.b.z) / 2 + (horiz ? side * (roadW / 2 + 0.2) : 0)
      );
      curb.castShadow = false;
      curb.receiveShadow = false;
      world.add(curb);
    }
  }
}

// Intersection pads sized to the widest adjoining road
const intersectionMat = new THREE.MeshStandardMaterial({
  map: intersectionTex, roughness: 0.74, metalness: 0.1, envMapIntensity: 0.4,
});
function maxRoadAtNode(n) {
  let m = ROAD_W;
  for (const e of edges) {
    if (e.a === n || e.b === n) m = Math.max(m, e.w);
  }
  return m;
}
for (const n of nodes) {
  const padW = maxRoadAtNode(n);
  const pad = new THREE.Mesh(
    new THREE.PlaneGeometry(padW + 0.4, padW + 0.4),
    intersectionMat
  );
  pad.rotation.x = -Math.PI / 2;
  pad.position.set(n.x, 0.03, n.z);
  pad.receiveShadow = true;
  world.add(pad);

  if ((n.i + n.j) % 3 === 0 && n.j !== CANAL_J && n.j !== CANAL_J + 1) {
    const edge = padW / 2 + 1.2;
    for (const [ox, oz] of [[edge, edge]]) {
      const pole = new THREE.Group();
      const post = new THREE.Mesh(
        new THREE.CylinderGeometry(0.08, 0.1, 4.2, 8),
        new THREE.MeshStandardMaterial({ color: 0x4a5560, metalness: 0.55, roughness: 0.45 })
      );
      post.position.y = 2.1;
      pole.add(post);
      const housing = new THREE.Mesh(
        new THREE.BoxGeometry(0.35, 1.1, 0.28),
        new THREE.MeshStandardMaterial({ color: 0x2e3440, roughness: 0.55, metalness: 0.35 })
      );
      housing.position.y = 4.0;
      pole.add(housing);
      const colors = [0xff3b3b, 0xffd23a, 0x2ecc5a];
      colors.forEach((col, i) => {
        const lens = new THREE.Mesh(
          new THREE.CircleGeometry(0.1, 12),
          new THREE.MeshStandardMaterial({ color: col, emissive: col, emissiveIntensity: i === 2 ? 0.85 : 0.15 })
        );
        lens.position.set(0, 4.35 - i * 0.32, 0.15);
        pole.add(lens);
      });
      pole.position.set(n.x + ox, 0, n.z + oz);
      world.add(pole);
      addBoxCollider(n.x + ox, n.z + oz, 0.7, 0.7, "lamp", 0.4);
    }
  }
}

setLoad(0.5, "Raising skyline…");

// ——— Building types + interactive landmarks ———
let bseed = 1;
const neonColors = [0xff4d6d, 0x2eb8ff, 0xffc233, 0x7b5cff, 0x3dd68c, 0xff7a3d];
const landmarks = [];
const landmarkNeons = [];

function pickFillerType(distFromCenter) {
  const r = Math.random();
  const downtown = distFromCenter < CITY * 0.28;
  if (downtown) {
    if (r < 0.22) return "skyscraper";
    if (r < 0.5) return "office";
    if (r < 0.72) return "apartment";
    if (r < 0.88) return "shop";
    return "warehouse";
  }
  if (r < 0.3) return "warehouse";
  if (r < 0.55) return "apartment";
  if (r < 0.72) return "shop";
  if (r < 0.9) return "office";
  return "skyscraper";
}

function dimsForType(type) {
  switch (type) {
    case "skyscraper":
      return { w: 8 + Math.random() * 8, d: 8 + Math.random() * 8, h: 55 + Math.random() * 70 };
    case "office":
      return { w: 9 + Math.random() * 10, d: 9 + Math.random() * 10, h: 28 + Math.random() * 40 };
    case "warehouse":
      return { w: 14 + Math.random() * 12, d: 10 + Math.random() * 10, h: 8 + Math.random() * 10 };
    case "shop":
      return { w: 8 + Math.random() * 6, d: 7 + Math.random() * 5, h: 7 + Math.random() * 6 };
    default: // apartment
      return { w: 8 + Math.random() * 9, d: 8 + Math.random() * 9, h: 16 + Math.random() * 28 };
  }
}

function addRoofClutter(group, h, w, d) {
  if (h < 18) return;
  const metal = new THREE.MeshStandardMaterial({
    color: 0x8a94a3, metalness: 0.65, roughness: 0.35, envMapIntensity: 0.9,
  });
  const dark = new THREE.MeshStandardMaterial({
    color: 0x4a5560, metalness: 0.45, roughness: 0.5,
  });
  // HVAC blocks
  const units = 1 + ((Math.random() * 3) | 0);
  for (let i = 0; i < units; i++) {
    const uw = 1.2 + Math.random() * 2.2;
    const ud = 1.2 + Math.random() * 2.0;
    const uh = 1.4 + Math.random() * 2.8;
    const box = new THREE.Mesh(new THREE.BoxGeometry(uw, uh, ud), i % 2 ? metal : dark);
    box.position.set((Math.random() - 0.5) * w * 0.45, h + uh * 0.5, (Math.random() - 0.5) * d * 0.45);
    box.castShadow = true;
    group.add(box);
  }
  if (h > 45 && Math.random() < 0.55) {
    const mastH = 6 + Math.random() * 10;
    const mast = new THREE.Mesh(
      new THREE.CylinderGeometry(0.1, 0.16, mastH, 8),
      new THREE.MeshStandardMaterial({ color: 0xb0b8c4, metalness: 0.8, roughness: 0.28 })
    );
    mast.position.set(w * 0.18, h + mastH * 0.5, d * 0.12);
    mast.castShadow = true;
    group.add(mast);
    const dish = new THREE.Mesh(
      new THREE.CircleGeometry(0.7, 12),
      new THREE.MeshStandardMaterial({ color: 0xd0d6de, metalness: 0.7, roughness: 0.3, side: THREE.DoubleSide })
    );
    dish.position.set(w * 0.18, h + mastH * 0.65, d * 0.12 + 0.4);
    dish.rotation.y = Math.PI * 0.2;
    group.add(dish);
  }
}

function buildingMaterial(seed, type) {
  const map = makeBuildingTex(seed, type);
  const bump = makeBuildingBumpTex(seed, type);
  const metal =
    type === "skyscraper" ? 0.55 :
    type === "office" ? 0.28 :
    type === "warehouse" ? 0.42 : 0.08;
  const rough =
    type === "skyscraper" ? 0.22 :
    type === "office" ? 0.38 :
    type === "warehouse" ? 0.7 :
    type === "apartment" ? 0.72 : 0.62;
  return new THREE.MeshStandardMaterial({
    map,
    bumpMap: bump,
    bumpScale: type === "apartment" || type === "shop" ? 0.08 : 0.035,
    roughness: rough,
    metalness: metal,
    envMapIntensity: type === "skyscraper" ? 1.35 : type === "office" ? 0.95 : 0.55,
  });
}

function placeFillerBuilding(cx, cz, ox, oz, type) {
  bseed++;
  let { w, d, h } = dimsForType(type);
  // Keep lots clear of road + sidewalk so cars can mount / cross footpaths
  const clear = ROAD_W_AVENUE * 0.5 + 5;
  const maxHalf = BLOCK * 0.5 - clear;
  w = Math.min(w, Math.max(6, maxHalf * 1.55));
  d = Math.min(d, Math.max(6, maxHalf * 1.55));
  const maxOx = Math.max(0.5, maxHalf - w * 0.5);
  const maxOz = Math.max(0.5, maxHalf - d * 0.5);
  ox = Math.max(-maxOx, Math.min(maxOx, ox));
  oz = Math.max(-maxOz, Math.min(maxOz, oz));
  const x = cx + ox;
  const z = cz + oz;
  const group = new THREE.Group();
  group.position.set(x, 0, z);

  const facade = buildingMaterial(bseed, type);
  const concrete = new THREE.MeshStandardMaterial({
    color: 0x9aa3ad, roughness: 0.88, metalness: 0.08, envMapIntensity: 0.3,
  });
  const darkConcrete = new THREE.MeshStandardMaterial({
    color: 0x6a737e, roughness: 0.9, metalness: 0.06,
  });
  const roofMat = new THREE.MeshStandardMaterial({
    color: type === "skyscraper" ? 0x7a8594 : 0x5c6570,
    roughness: 0.82,
    metalness: 0.25,
    envMapIntensity: 0.45,
  });

  // Foundation slab — reads as solid mass on the ground
  const foundation = new THREE.Mesh(
    new THREE.BoxGeometry(w + 1.1, 0.45, d + 1.1),
    darkConcrete
  );
  foundation.position.y = 0.22;
  foundation.receiveShadow = true;
  foundation.castShadow = false;
  group.add(foundation);

  // Ground-floor podium (slightly proud of the tower)
  const podiumH = type === "skyscraper" || type === "office" ? Math.min(6.5, h * 0.12) : Math.min(4.2, h * 0.22);
  const podium = new THREE.Mesh(
    new THREE.BoxGeometry(w + 0.55, podiumH, d + 0.55),
    type === "shop" ? facade : concrete
  );
  podium.position.y = podiumH * 0.5 + 0.4;
  podium.castShadow = false;
  podium.receiveShadow = true;
  group.add(podium);

  // Main tower body
  const bodyH = Math.max(2.5, h - podiumH - 0.6);
  const body = new THREE.Mesh(new THREE.BoxGeometry(w, bodyH, d), facade);
  body.position.y = podiumH + 0.4 + bodyH * 0.5;
  body.castShadow = type === "skyscraper" || type === "office";
  body.receiveShadow = true;
  group.add(body);

  // Mid-belt ledge for tall buildings
  if (h > 28) {
    const beltY = podiumH + 0.4 + bodyH * (0.35 + Math.random() * 0.3);
    const belt = new THREE.Mesh(
      new THREE.BoxGeometry(w + 0.45, 0.55, d + 0.45),
      concrete
    );
    belt.position.y = beltY;
    belt.castShadow = true;
    group.add(belt);
  }

  // Skyscraper setback crown
  let roofY = podiumH + 0.4 + bodyH;
  if (type === "skyscraper" && h > 50) {
    const capW = w * 0.72;
    const capD = d * 0.72;
    const capH = 6 + Math.random() * 10;
    const cap = new THREE.Mesh(new THREE.BoxGeometry(capW, capH, capD), facade);
    cap.position.y = roofY + capH * 0.5;
    cap.castShadow = true;
    group.add(cap);
    roofY += capH;
    const crown = new THREE.Mesh(
      new THREE.BoxGeometry(capW + 0.5, 0.7, capD + 0.5),
      concrete
    );
    crown.position.y = roofY + 0.2;
    crown.castShadow = true;
    group.add(crown);
    roofY += 0.55;
  }

  // Roof deck + parapet walls (reads as a real flat roof)
  const roof = new THREE.Mesh(new THREE.BoxGeometry(w * 0.98, 0.35, d * 0.98), roofMat);
  roof.position.y = roofY + 0.15;
  roof.receiveShadow = true;
  group.add(roof);

  const parapetH = 1.15;
  const parapetMat = concrete;
  const walls = [
    [w + 0.15, parapetH, 0.28, 0, d * 0.5 + 0.05],
    [w + 0.15, parapetH, 0.28, 0, -d * 0.5 - 0.05],
    [0.28, parapetH, d + 0.15, w * 0.5 + 0.05, 0],
    [0.28, parapetH, d + 0.15, -w * 0.5 - 0.05, 0],
  ];
  for (const [pw, ph, pd, px, pz] of walls) {
    const wall = new THREE.Mesh(new THREE.BoxGeometry(pw, ph, pd), parapetMat);
    wall.position.set(px, roofY + ph * 0.5, pz);
    wall.castShadow = true;
    group.add(wall);
  }

  // Corner columns / pilasters for mass
  if (type === "apartment" || type === "office" || type === "shop") {
    const colMat = new THREE.MeshStandardMaterial({
      color: 0xb8c0c8, roughness: 0.55, metalness: 0.15, envMapIntensity: 0.4,
    });
    for (const [sx, sz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
      const col = new THREE.Mesh(
        new THREE.BoxGeometry(0.45, h * 0.92, 0.45),
        colMat
      );
      col.position.set(sx * (w * 0.5 - 0.1), h * 0.46 + 0.3, sz * (d * 0.5 - 0.1));
      col.castShadow = true;
      group.add(col);
    }
  }

  // Shop awning + glass storefront depth
  if (type === "shop") {
    const awning = new THREE.Mesh(
      new THREE.BoxGeometry(w * 0.92, 0.18, 1.6),
      new THREE.MeshStandardMaterial({
        color: neonColors[bseed % neonColors.length],
        roughness: 0.55,
        metalness: 0.2,
        emissive: neonColors[bseed % neonColors.length],
        emissiveIntensity: 0.15,
      })
    );
    awning.position.set(0, podiumH + 0.15, d * 0.5 + 0.7);
    awning.castShadow = true;
    group.add(awning);
    const glass = new THREE.Mesh(
      new THREE.BoxGeometry(w * 0.75, podiumH * 0.7, 0.12),
      new THREE.MeshStandardMaterial({
        color: 0xa8d4ff,
        metalness: 0.85,
        roughness: 0.08,
        transparent: true,
        opacity: 0.55,
        envMapIntensity: 1.4,
      })
    );
    glass.position.set(0, podiumH * 0.45 + 0.35, d * 0.5 + 0.28);
    group.add(glass);
  }

  addRoofClutter(group, roofY, w, d);

  if (type === "shop" || (Math.random() < 0.12 && h > 16)) {
    const neon = neonColors[bseed % neonColors.length];
    const sign = new THREE.Mesh(
      new THREE.BoxGeometry(w * 0.65, type === "shop" ? 1.0 : 1.35, 0.22),
      new THREE.MeshStandardMaterial({
        color: neon, emissive: neon, emissiveIntensity: 0.4, roughness: 0.4, metalness: 0.25,
      })
    );
    sign.position.set(0, type === "shop" ? podiumH + 1.4 : 8 + Math.random() * 10, d * 0.5 + 0.25);
    group.add(sign);
  }

  world.add(group);
  addBoxCollider(x, z, w + 0.6, d + 0.6, "building", 0.62);
}

function landmarkLabelMesh(text, color) {
  const c = document.createElement("canvas");
  c.width = 256; c.height = 64;
  const g = c.getContext("2d");
  g.fillStyle = "rgba(0,0,0,0.55)";
  g.fillRect(0, 0, 256, 64);
  g.font = "bold 36px Orbitron, sans-serif";
  g.fillStyle = color;
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillText(text, 128, 34);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false });
  const spr = new THREE.Sprite(mat);
  spr.scale.set(14, 3.5, 1);
  spr.position.y = 12;
  return spr;
}

function registerLandmark(type, x, z, radius, group, footprint = null) {
  landmarks.push({ type, x, z, radius, mesh: group });
  world.add(group);
  if (footprint) {
    addBoxCollider(x + (footprint.ox || 0), z + (footprint.oz || 0), footprint.w, footprint.d, "building", 0.6);
  } else {
    addBoxCollider(x, z, radius * 1.1, radius * 1.1, "building", 0.6);
  }
}

function buildBank(x, z) {
  const g = new THREE.Group();
  const stone = buildingMaterial(bseed + 11, "office");
  stone.color = new THREE.Color(0xf0e6d0);
  stone.metalness = 0.12;
  stone.roughness = 0.55;
  const body = new THREE.Mesh(new THREE.BoxGeometry(16, 10, 12), stone);
  body.position.y = 5.4;
  body.castShadow = true;
  body.receiveShadow = true;
  g.add(body);
  const ped = new THREE.Mesh(
    new THREE.BoxGeometry(18.5, 1.4, 14.5),
    new THREE.MeshStandardMaterial({ color: 0xb8a878, roughness: 0.82, metalness: 0.08 })
  );
  ped.position.y = 0.7;
  ped.castShadow = true;
  ped.receiveShadow = true;
  g.add(ped);
  const steps = new THREE.Mesh(
    new THREE.BoxGeometry(10, 0.55, 3.2),
    new THREE.MeshStandardMaterial({ color: 0xd4c9a8, roughness: 0.75 })
  );
  steps.position.set(0, 0.35, 7.2);
  g.add(steps);
  for (let i = -2; i <= 2; i++) {
    const col = new THREE.Mesh(
      new THREE.CylinderGeometry(0.55, 0.65, 8.2, 12),
      new THREE.MeshStandardMaterial({ color: 0xf5efe0, roughness: 0.35, metalness: 0.18, envMapIntensity: 0.5 })
    );
    col.position.set(i * 2.8, 5.4, 6.2);
    col.castShadow = true;
    g.add(col);
    const cap = new THREE.Mesh(
      new THREE.BoxGeometry(1.4, 0.35, 1.4),
      new THREE.MeshStandardMaterial({ color: 0xe8dcc0, roughness: 0.45 })
    );
    cap.position.set(i * 2.8, 9.6, 6.2);
    g.add(cap);
  }
  const cornice = new THREE.Mesh(
    new THREE.BoxGeometry(17, 1.1, 13),
    new THREE.MeshStandardMaterial({ color: 0xe8d9b0, roughness: 0.5, metalness: 0.15 })
  );
  cornice.position.y = 10.9;
  cornice.castShadow = true;
  g.add(cornice);
  const trim = new THREE.Mesh(
    new THREE.BoxGeometry(16.5, 1.4, 0.35),
    new THREE.MeshStandardMaterial({ color: 0xffd24a, emissive: 0xcc9900, emissiveIntensity: 0.25, metalness: 0.55 })
  );
  trim.position.set(0, 10.2, 6.15);
  g.add(trim);
  g.add(landmarkLabelMesh("BANK", "#ffd76a"));
  g.position.set(x, 0, z);
  registerLandmark("bank", x, z, 15, g, { w: 18, d: 14 });
}

function buildGasStation(x, z) {
  const g = new THREE.Group();
  const pad = new THREE.Mesh(
    new THREE.BoxGeometry(18, 0.2, 14),
    new THREE.MeshStandardMaterial({ color: 0x6a7180, roughness: 0.85, metalness: 0.1 })
  );
  pad.position.y = 0.1;
  pad.receiveShadow = true;
  g.add(pad);
  const canopy = new THREE.Mesh(
    new THREE.BoxGeometry(16, 0.55, 12),
    new THREE.MeshStandardMaterial({
      color: 0xff7a28, emissive: 0xff5500, emissiveIntensity: 0.22, roughness: 0.45, metalness: 0.35,
    })
  );
  canopy.position.y = 5.2;
  canopy.castShadow = true;
  g.add(canopy);
  const canopyEdge = new THREE.Mesh(
    new THREE.BoxGeometry(16.4, 0.35, 12.4),
    new THREE.MeshStandardMaterial({ color: 0xfff2d0, emissive: 0xffe08a, emissiveIntensity: 0.35, roughness: 0.4 })
  );
  canopyEdge.position.y = 4.85;
  g.add(canopyEdge);
  for (const px of [-4, 4]) {
    const pole = new THREE.Mesh(
      new THREE.CylinderGeometry(0.25, 0.3, 5, 8),
      new THREE.MeshStandardMaterial({ color: 0xf0f2f5, metalness: 0.55, roughness: 0.35 })
    );
    pole.position.set(px, 2.5, 0);
    pole.castShadow = true;
    g.add(pole);
    const pump = new THREE.Mesh(
      new THREE.BoxGeometry(1.2, 2.2, 0.9),
      new THREE.MeshStandardMaterial({ color: 0x1e6bff, metalness: 0.45, roughness: 0.35, envMapIntensity: 0.7 })
    );
    pump.position.set(px, 1.1, 2.5);
    pump.castShadow = true;
    g.add(pump);
  }
  const shopMat = buildingMaterial(bseed + 3, "shop");
  const shop = new THREE.Mesh(new THREE.BoxGeometry(7.2, 3.6, 5.2), shopMat);
  shop.position.set(0, 1.8, -4);
  shop.castShadow = true;
  shop.receiveShadow = true;
  g.add(shop);
  const roof = new THREE.Mesh(
    new THREE.BoxGeometry(7.6, 0.35, 5.6),
    new THREE.MeshStandardMaterial({ color: 0x4a5560, roughness: 0.7, metalness: 0.2 })
  );
  roof.position.set(0, 3.75, -4);
  g.add(roof);
  g.add(landmarkLabelMesh("GAS", "#ff9a4a"));
  g.position.set(x, 0, z);
  registerLandmark("gas", x, z, 13, g, { w: 7.5, d: 5.5, oz: -4 });
}

function buildPrecinct(x, z) {
  const g = new THREE.Group();
  const mat = buildingMaterial(bseed + 7, "office");
  mat.color = new THREE.Color(0x7a9bc4);
  const body = new THREE.Mesh(new THREE.BoxGeometry(18, 12, 14), mat);
  body.position.y = 6.2;
  body.castShadow = true;
  body.receiveShadow = true;
  g.add(body);
  const base = new THREE.Mesh(
    new THREE.BoxGeometry(19, 1.2, 15),
    new THREE.MeshStandardMaterial({ color: 0x4a5568, roughness: 0.85 })
  );
  base.position.y = 0.6;
  base.castShadow = true;
  g.add(base);
  const stripe = new THREE.Mesh(
    new THREE.BoxGeometry(18.2, 1.2, 0.3),
    new THREE.MeshStandardMaterial({ color: 0x3ba7ff, emissive: 0x2266cc, emissiveIntensity: 0.45 })
  );
  stripe.position.set(0, 9, 7.1);
  g.add(stripe);
  const door = new THREE.Mesh(
    new THREE.BoxGeometry(3.5, 4, 0.3),
    new THREE.MeshStandardMaterial({ color: 0x2a3a55, metalness: 0.4, roughness: 0.4 })
  );
  door.position.set(0, 2.2, 7.1);
  g.add(door);
  const cornice = new THREE.Mesh(
    new THREE.BoxGeometry(18.6, 0.8, 14.6),
    new THREE.MeshStandardMaterial({ color: 0x8aa4c4, roughness: 0.5, metalness: 0.2 })
  );
  cornice.position.y = 12.5;
  g.add(cornice);
  const beacon = new THREE.Mesh(
    new THREE.SphereGeometry(0.55, 12, 12),
    new THREE.MeshStandardMaterial({ color: 0x4a9cff, emissive: 0x2266ff, emissiveIntensity: 0.8 })
  );
  beacon.position.set(0, 13.2, 0);
  g.add(beacon);
  landmarkNeons.push({ mesh: beacon, base: 0.7, speed: 3 });
  g.add(landmarkLabelMesh("PRECINCT", "#5aa8ff"));
  g.position.set(x, 0, z);
  registerLandmark("precinct", x, z, 16, g, { w: 18, d: 14 });
}

function buildNightclub(x, z) {
  const g = new THREE.Group();
  const mat = buildingMaterial(bseed + 5, "shop");
  mat.color = new THREE.Color(0x8a5a9a);
  const body = new THREE.Mesh(new THREE.BoxGeometry(14, 9, 12), mat);
  body.position.y = 4.7;
  body.castShadow = true;
  body.receiveShadow = true;
  g.add(body);
  const base = new THREE.Mesh(
    new THREE.BoxGeometry(15, 0.8, 13),
    new THREE.MeshStandardMaterial({ color: 0x2a1a32, roughness: 0.8 })
  );
  base.position.y = 0.4;
  g.add(base);
  const colors = [0xff5ab5, 0xb85aff, 0x3dd6ff];
  for (let i = 0; i < 3; i++) {
    const neon = new THREE.Mesh(
      new THREE.BoxGeometry(10 - i * 1.5, 0.45, 0.2),
      new THREE.MeshStandardMaterial({
        color: colors[i], emissive: colors[i], emissiveIntensity: 0.55, roughness: 0.35, metalness: 0.35,
      })
    );
    neon.position.set(0, 3 + i * 2.2, 6.15);
    g.add(neon);
    landmarkNeons.push({ mesh: neon, base: 0.5, speed: 1.5 + i * 0.4 });
  }
  const awning = new THREE.Mesh(
    new THREE.BoxGeometry(8, 0.3, 3),
    new THREE.MeshStandardMaterial({ color: 0xe84a8a, roughness: 0.55 })
  );
  awning.position.set(0, 3.2, 7.2);
  awning.castShadow = true;
  g.add(awning);
  g.add(landmarkLabelMesh("CLUB", "#ff7ad4"));
  g.position.set(x, 0, z);
  registerLandmark("nightclub", x, z, 13, g, { w: 14, d: 12 });
}

function buildHospital(x, z) {
  const g = new THREE.Group();
  const mat = buildingMaterial(bseed + 9, "office");
  mat.color = new THREE.Color(0xf4f8fc);
  mat.metalness = 0.1;
  mat.roughness = 0.48;
  const body = new THREE.Mesh(new THREE.BoxGeometry(20, 14, 14), mat);
  body.position.y = 7.2;
  body.castShadow = true;
  body.receiveShadow = true;
  g.add(body);
  const base = new THREE.Mesh(
    new THREE.BoxGeometry(21, 1.1, 15),
    new THREE.MeshStandardMaterial({ color: 0xd0dae4, roughness: 0.85 })
  );
  base.position.y = 0.55;
  base.castShadow = true;
  g.add(base);
  const crossV = new THREE.Mesh(
    new THREE.BoxGeometry(1.6, 6, 0.35),
    new THREE.MeshStandardMaterial({ color: 0xff3b55, emissive: 0xcc2233, emissiveIntensity: 0.35 })
  );
  crossV.position.set(0, 10, 7.2);
  g.add(crossV);
  const crossH = new THREE.Mesh(
    new THREE.BoxGeometry(5, 1.6, 0.35),
    new THREE.MeshStandardMaterial({ color: 0xff3b55, emissive: 0xcc2233, emissiveIntensity: 0.35 })
  );
  crossH.position.set(0, 10, 7.2);
  g.add(crossH);
  const wing = new THREE.Mesh(new THREE.BoxGeometry(8, 8, 10), mat);
  wing.position.set(12, 4.2, 0);
  wing.castShadow = true;
  wing.receiveShadow = true;
  g.add(wing);
  const roof = new THREE.Mesh(
    new THREE.BoxGeometry(20.5, 0.5, 14.5),
    new THREE.MeshStandardMaterial({ color: 0xc5d0da, roughness: 0.7, metalness: 0.15 })
  );
  roof.position.y = 14.4;
  g.add(roof);
  g.add(landmarkLabelMesh("HOSPITAL", "#5a9fd4"));
  g.position.set(x, 0, z);
  registerLandmark("hospital", x, z, 15, g, { w: 28, d: 14 });
}

function landmarkSite(i, j, side = 1) {
  // Place near the road edge of a city block so drivers can reach it
  const cx = -HALF + i * BLOCK + BLOCK / 2;
  const cz = -HALF + j * BLOCK + BLOCK / 2;
  const inset = BLOCK / 2 - ROAD_W_AVENUE / 2 - 11;
  if (side === 0) return { x: cx + inset, z: cz };
  if (side === 1) return { x: cx - inset, z: cz };
  if (side === 2) return { x: cx, z: cz + inset };
  return { x: cx, z: cz - inset };
}

function buildParkBlock(i, j) {
  const cx = -HALF + i * BLOCK + BLOCK / 2;
  const cz = -HALF + j * BLOCK + BLOCK / 2;
  const padW = BLOCK - ROAD_W_AVENUE - 6;
  const lawn = new THREE.Mesh(
    new THREE.PlaneGeometry(padW, padW),
    new THREE.MeshStandardMaterial({ color: 0x3f8f4c, roughness: 0.96, metalness: 0.02 })
  );
  lawn.rotation.x = -Math.PI / 2;
  lawn.position.set(cx, 0.01, cz);
  lawn.receiveShadow = true;
  world.add(lawn);

  // Path crossing the park
  const pathMat = new THREE.MeshStandardMaterial({ color: 0xc2b59a, roughness: 0.92 });
  const pathH = new THREE.Mesh(new THREE.PlaneGeometry(padW * 0.85, 3.2), pathMat);
  pathH.rotation.x = -Math.PI / 2;
  pathH.position.set(cx, 0.02, cz);
  world.add(pathH);
  const pathV = new THREE.Mesh(new THREE.PlaneGeometry(3.2, padW * 0.85), pathMat);
  pathV.rotation.x = -Math.PI / 2;
  pathV.position.set(cx, 0.025, cz);
  world.add(pathV);

  // Small plaza fountain / planter
  const rim = new THREE.Mesh(
    new THREE.CylinderGeometry(2.4, 2.6, 0.55, 16),
    new THREE.MeshStandardMaterial({ color: 0xb8b0a0, roughness: 0.7, metalness: 0.1 })
  );
  rim.position.set(cx, 0.3, cz);
  rim.castShadow = true;
  world.add(rim);
  const pool = new THREE.Mesh(
    new THREE.CircleGeometry(1.8, 16),
    waterMat.clone()
  );
  pool.rotation.x = -Math.PI / 2;
  pool.position.set(cx, 0.45, cz);
  world.add(pool);
  addBoxCollider(cx, cz, 5.2, 5.2, "lamp", 0.3);
}

// Interactive landmark buildings (avoid canal corridor j=5)
const landmarkPlan = [
  { type: "bank", i: 2, j: 2, side: 0 },
  { type: "bank", i: 8, j: 7, side: 1 },
  { type: "bank", i: 5, j: 3, side: 2 },
  { type: "gas", i: 1, j: 4, side: 3 },
  { type: "gas", i: 6, j: 1, side: 0 },
  { type: "gas", i: 9, j: 8, side: 1 },
  { type: "gas", i: 4, j: 9, side: 2 },
  { type: "precinct", i: 3, j: 6, side: 0 },
  { type: "precinct", i: 7, j: 4, side: 3 },
  { type: "nightclub", i: 5, j: 7, side: 1 },
  { type: "nightclub", i: 2, j: 8, side: 2 },
  { type: "nightclub", i: 8, j: 2, side: 0 },
  { type: "hospital", i: 4, j: 4, side: 3 },
  { type: "hospital", i: 9, j: 6, side: 1 },
];

const parkBlocks = new Set([
  "1,1", "8,9", "3,8", "9,2", "6,6",
]);

const reservedBlocks = new Set();
for (const plan of landmarkPlan) reservedBlocks.add(`${plan.i},${plan.j}`);
for (const key of parkBlocks) reservedBlocks.add(key);

// Filler skyline, parks, and open canal corridor
for (let i = 0; i < GRID - 1; i++) {
  for (let j = 0; j < GRID - 1; j++) {
    if (isCanalBlock(i, j)) continue; // water + bridges own this strip
    if (parkBlocks.has(`${i},${j}`)) {
      buildParkBlock(i, j);
      continue;
    }
    const isLandmarkBlock = reservedBlocks.has(`${i},${j}`);
    const cx = -HALF + i * BLOCK + BLOCK / 2;
    const cz = -HALF + j * BLOCK + BLOCK / 2;
    const dist = Math.hypot(cx, cz);
    for (let k = 0; k < 4; k++) {
      bseed++;
      if (isLandmarkBlock && k < 3) continue;
      if (Math.random() < 0.2) continue;
      const colN = k % 2;
      const rowN = (k / 2) | 0;
      const ox = (colN - 0.5) * 14 + (Math.random() - 0.5) * 2;
      const oz = (rowN - 0.5) * 16 + (Math.random() - 0.5) * 2;
      if (Math.hypot(ox, oz) < 5) continue;
      if (isLandmarkBlock && Math.hypot(ox, oz) < 16) continue;
      placeFillerBuilding(cx, cz, ox, oz, pickFillerType(dist));
    }
  }
}

for (const plan of landmarkPlan) {
  const site = landmarkSite(plan.i, plan.j, plan.side);
  if (plan.type === "bank") buildBank(site.x, site.z);
  else if (plan.type === "gas") buildGasStation(site.x, site.z);
  else if (plan.type === "precinct") buildPrecinct(site.x, site.z);
  else if (plan.type === "nightclub") buildNightclub(site.x, site.z);
  else if (plan.type === "hospital") buildHospital(site.x, site.z);
}

// City meshes receive light but do not cast — keeps soft car shadows cheap
world.traverse((obj) => {
  if (obj.isMesh) {
    obj.castShadow = false;
    obj.frustumCulled = true;
    if (obj.material && obj.material.map) obj.receiveShadow = true;
  }
});
// Static city — skip per-frame matrix walks (big win with dense traffic)
world.matrixAutoUpdate = false;
world.updateMatrixWorld(true);

function nearestLandmark(type, x, z) {
  let best = null, bestD = Infinity;
  for (const lm of landmarks) {
    if (lm.type !== type) continue;
    const d = Math.hypot(lm.x - x, lm.z - z);
    if (d < bestD) { bestD = d; best = lm; }
  }
  return best ? { lm: best, dist: bestD } : null;
}

let zoneToastTimer = 0;
function showZoneToast(type, msg) {
  if (!zoneToast) return;
  zoneToast.textContent = msg;
  zoneToast.className = type;
  zoneToast.classList.remove("hidden");
  zoneToastTimer = 2.2;
}

// Street lamps (unlit daytime fixtures) — sparse for performance
const poleMat = new THREE.MeshStandardMaterial({ color: 0x7a8490, metalness: 0.65, roughness: 0.4 });
for (const e of edges) {
  if (e.type === "bridge" || e.type === "alley") continue;
  if (Math.random() > 0.22) continue;
  const mx = (e.a.x + e.b.x) / 2;
  const mz = (e.a.z + e.b.z) / 2;
  const horiz = Math.abs(e.b.x - e.a.x) > Math.abs(e.b.z - e.a.z);
  const side = Math.random() > 0.5 ? 1 : -1;
  const lx = mx + (horiz ? 0 : side * (e.w / 2 + 2));
  const lz = mz + (horiz ? side * (e.w / 2 + 2) : 0);
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.15, 6.2, 8), poleMat);
  pole.position.set(lx, 3.1, lz);
  pole.castShadow = false;
  world.add(pole);
  const arm = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.12, 0.12), poleMat);
  arm.position.set(lx - (horiz ? 0 : side * 1.0), 6.05, lz - (horiz ? side * 1.0 : 0));
  world.add(arm);
  const bulb = new THREE.Mesh(
    new THREE.SphereGeometry(0.28, 10, 10),
    new THREE.MeshStandardMaterial({ color: 0xf0f4f8, emissive: 0xdde6f0, emissiveIntensity: 0.15, roughness: 0.25, metalness: 0.1 })
  );
  const bx = lx - (horiz ? 0 : side * 1.9);
  const bz = lz - (horiz ? side * 1.9 : 0);
  bulb.position.set(bx, 5.85, bz);
  world.add(bulb);
  // No sidewalk lamp colliders — cars can cross footpaths freely
}

setLoad(0.7, "Staging jobs…");

// ——— Markers / missions ———
const robbers = [];
const safehouses = [];
const cops = [];
const roadblocks = [];
const traffic = [];

function makeJobLabel(text, colorHex) {
  const c = document.createElement("canvas");
  c.width = 320; c.height = 80;
  const g = c.getContext("2d");
  g.fillStyle = "rgba(0,0,0,0.72)";
  if (g.roundRect) {
    g.beginPath();
    g.roundRect(8, 12, 304, 56, 12);
    g.fill();
    g.strokeStyle = colorHex;
    g.lineWidth = 3;
    g.stroke();
  } else {
    g.fillRect(8, 12, 304, 56);
  }
  g.font = "bold 34px Orbitron, sans-serif";
  g.fillStyle = colorHex;
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillText(text, 160, 42);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const spr = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }));
  spr.scale.set(6.5, 1.6, 1);
  return spr;
}

function makePulseRing(color, emissive) {
  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(2.4, 0.14, 10, 40),
    new THREE.MeshStandardMaterial({
      color, emissive, emissiveIntensity: 2.6, roughness: 0.35, metalness: 0.2,
      depthWrite: false,
    })
  );
  ring.rotation.x = Math.PI / 2;
  ring.position.y = 0.14;
  ring.renderOrder = 2;
  return ring;
}

function createRobberFigure() {
  const g = new THREE.Group();
  const skin = new THREE.MeshStandardMaterial({ color: 0xc4a882, roughness: 0.75, metalness: 0.05 });
  const clothes = new THREE.MeshStandardMaterial({ color: 0x1a1f28, roughness: 0.7, metalness: 0.15 });
  const mask = new THREE.MeshStandardMaterial({ color: 0x111418, roughness: 0.55, metalness: 0.1 });
  const bagMat = new THREE.MeshStandardMaterial({ color: 0x2a2118, roughness: 0.85, metalness: 0.05 });

  const legs = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.7, 0.35), clothes);
  legs.position.y = 0.45;
  legs.castShadow = true;
  g.add(legs);
  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.85, 0.4), clothes);
  torso.position.y = 1.15;
  torso.castShadow = true;
  g.add(torso);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.28, 12, 10), skin);
  head.position.y = 1.8;
  head.castShadow = true;
  g.add(head);
  const balaclava = new THREE.Mesh(new THREE.SphereGeometry(0.3, 12, 10, 0, Math.PI * 2, 0, Math.PI * 0.55), mask);
  balaclava.position.y = 1.86;
  g.add(balaclava);
  const bag = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.45, 0.35), bagMat);
  bag.position.set(0.55, 1.05, 0.1);
  bag.rotation.z = -0.25;
  bag.castShadow = true;
  g.add(bag);
  const dollar = new THREE.Mesh(
    new THREE.BoxGeometry(0.35, 0.28, 0.02),
    new THREE.MeshStandardMaterial({ color: 0xffd24a, emissive: 0xaa8800, emissiveIntensity: 0.8 })
  );
  dollar.position.set(0.55, 1.05, 0.3);
  g.add(dollar);
  const arm = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.55, 0.18), clothes);
  arm.position.set(-0.5, 1.25, 0.15);
  arm.rotation.z = 0.6;
  g.add(arm);
  g.userData.arm = arm;
  return g;
}

function createSafehouseBuilding() {
  const g = new THREE.Group();
  const wall = new THREE.MeshStandardMaterial({
    color: 0xd2b48c, roughness: 0.82, metalness: 0.06, transparent: true, opacity: 0.55,
  });
  const roofMat = new THREE.MeshStandardMaterial({
    color: 0x8b5a2b, roughness: 0.88, metalness: 0.05, transparent: true, opacity: 0.6,
  });
  const doorMat = new THREE.MeshStandardMaterial({
    color: 0xffc14a, emissive: 0xcc8800, emissiveIntensity: 0.55, roughness: 0.5, metalness: 0.25,
    transparent: true, opacity: 0.7,
  });
  const trim = new THREE.MeshStandardMaterial({
    color: 0xffd76a, emissive: 0xddaa22, emissiveIntensity: 0.45, transparent: true, opacity: 0.75,
  });

  // Compact drop-off booth — drive-through, no collision
  const body = new THREE.Mesh(new THREE.BoxGeometry(2.4, 2.2, 2.0), wall);
  body.position.set(0, 1.1, 0);
  g.add(body);
  const roof = new THREE.Mesh(new THREE.BoxGeometry(2.8, 0.22, 2.4), roofMat);
  roof.position.set(0, 2.3, 0);
  g.add(roof);
  const door = new THREE.Mesh(new THREE.BoxGeometry(1.2, 1.5, 0.12), doorMat);
  door.position.set(0, 0.85, 1.05);
  g.add(door);
  const frame = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.12, 0.1), trim);
  frame.position.set(0, 1.7, 1.1);
  g.add(frame);
  const pad = new THREE.Mesh(
    new THREE.CircleGeometry(1.6, 24),
    new THREE.MeshStandardMaterial({
      color: 0xffc14a, emissive: 0xaa7700, emissiveIntensity: 0.3, transparent: true, opacity: 0.45,
    })
  );
  pad.rotation.x = -Math.PI / 2;
  pad.position.set(0, 0.04, 0);
  g.add(pad);
  g.userData.door = door;
  g.userData.pad = pad;
  return g;
}

function makeRobberMarker() {
  const marker = new THREE.Group();
  const ring = makePulseRing(0x3dff8a, 0x22aa55);
  marker.add(ring);
  // Bright ground disc so the pickup spot is obvious under the robber
  const pad = new THREE.Mesh(
    new THREE.CircleGeometry(2.8, 28),
    new THREE.MeshBasicMaterial({
      color: 0x3dff8a, transparent: true, opacity: 0.28, depthWrite: false,
    })
  );
  pad.rotation.x = -Math.PI / 2;
  pad.position.y = 0.05;
  pad.renderOrder = 1;
  marker.add(pad);
  const beam = new THREE.Mesh(
    new THREE.CylinderGeometry(0.14, 0.45, 7, 10),
    new THREE.MeshBasicMaterial({ color: 0x3dff8a, transparent: true, opacity: 0.3, depthWrite: false })
  );
  beam.position.y = 3.6;
  beam.renderOrder = 2;
  marker.add(beam);
  const figure = createRobberFigure();
  marker.add(figure);
  const label = makeJobLabel("ROBBER", "#3dff8a");
  label.position.y = 3.6;
  marker.add(label);
  marker.userData.ring = ring;
  marker.userData.figure = figure;
  marker.userData.beam = beam;
  marker.userData.pad = pad;
  return marker;
}

function clearAllRobbers() {
  while (robbers.length) {
    const r = robbers.pop();
    if (r.mesh) world.remove(r.mesh);
  }
}

function clearAllSafehouses() {
  while (safehouses.length) {
    const s = safehouses.pop();
    if (s.mesh) world.remove(s.mesh);
  }
}

function randomJobPoint(awayFrom = null, minDist = 70) {
  let best = randomRoadPoint();
  for (let i = 0; i < 14; i++) {
    const p = randomRoadPoint();
    if (!awayFrom) return p;
    if (Math.hypot(p.x - awayFrom.x, p.z - awayFrom.z) >= minDist) return p;
    best = p;
  }
  return best;
}

function spawnRobber(at = null) {
  clearAllRobbers();
  const p = at || randomRoadPoint();
  const marker = makeRobberMarker();
  marker.position.set(p.x, 0, p.z);
  marker.visible = true;
  world.add(marker);
  robbers.push({ x: p.x, z: p.z, mesh: marker, taken: false });
}

function createSafehouseMarker(x, z) {
  const marker = new THREE.Group();
  const ring = makePulseRing(0xffc14a, 0xaa7700);
  ring.scale.setScalar(0.55);
  marker.add(ring);
  const building = createSafehouseBuilding();
  marker.add(building);
  const label = makeJobLabel("SAFEHOUSE", "#ffc14a");
  label.position.set(0, 3.4, 0);
  marker.add(label);
  const beam = new THREE.Mesh(
    new THREE.CylinderGeometry(0.1, 0.28, 4.5, 10),
    new THREE.MeshBasicMaterial({ color: 0xffc14a, transparent: true, opacity: 0.22 })
  );
  beam.position.y = 2.4;
  marker.add(beam);
  marker.position.set(x, 0, z);
  marker.userData.ring = ring;
  marker.userData.building = building;
  marker.userData.beam = beam;
  return marker;
}

/** Place a fresh safehouse at a new location (always relocates). */
function spawnSafehouse(awayFrom = null) {
  clearAllSafehouses();
  const p = randomJobPoint(awayFrom, 80);
  const marker = createSafehouseMarker(p.x, p.z);
  world.add(marker);
  safehouses.push({ x: p.x, z: p.z, mesh: marker });
}

/** After pickup: robber gone, only a NEW safehouse is visible. */
function showSafehouseOnly(fromPlayer) {
  clearAllRobbers();
  spawnSafehouse(fromPlayer ? { x: fromPlayer.x, z: fromPlayer.z } : null);
}

/** After delivery / start: safehouse gone, only a NEW robber is visible. */
function showRobberOnly(awayFrom = null) {
  clearAllSafehouses();
  clearAllRobbers();
  const p = awayFrom ? randomJobPoint(awayFrom, 60) : randomRoadPoint();
  spawnRobber(p);
}

function syncJobMarkers() {
  const carrying = players.some((p) => p.carrying);
  if (carrying) {
    // Only safehouse should exist while delivering
    clearAllRobbers();
    if (safehouses.length === 0) {
      const carrier = players.find((p) => p.carrying);
      spawnSafehouse(carrier ? { x: carrier.x, z: carrier.z } : null);
    }
  } else {
    // Only robber should exist while hunting
    clearAllSafehouses();
    if (robbers.filter((r) => !r.taken).length === 0) showRobberOnly();
  }
}

// Start with robber only — safehouse appears after pickup, at a new spot each time
showRobberOnly();

// ——— Cars ———
function createWheel(scale = 1) {
  // pivot = steering (Y), roller = spin (X)
  const pivot = new THREE.Group();
  const roller = new THREE.Group();
  pivot.add(roller);

  const tireMat = new THREE.MeshStandardMaterial({
    color: 0x0d0d0f, roughness: 0.92, metalness: 0.05,
  });
  const treadMat = new THREE.MeshStandardMaterial({
    color: 0x1a1a1e, roughness: 0.95, metalness: 0.02,
  });
  const rimMat = new THREE.MeshStandardMaterial({
    color: 0xd0d6de, metalness: 0.92, roughness: 0.18, envMapIntensity: 1.35,
  });
  const hubMat = new THREE.MeshStandardMaterial({
    color: 0x2a2e36, metalness: 0.8, roughness: 0.3,
  });

  const tire = new THREE.Mesh(
    new THREE.CylinderGeometry(0.44 * scale, 0.44 * scale, 0.36 * scale, 24),
    tireMat
  );
  tire.rotation.z = Math.PI / 2;
  tire.castShadow = true;
  roller.add(tire);

  // sidewall lip
  for (const side of [-1, 1]) {
    const lip = new THREE.Mesh(
      new THREE.TorusGeometry(0.38 * scale, 0.04 * scale, 8, 20),
      treadMat
    );
    lip.rotation.y = Math.PI / 2;
    lip.position.x = side * 0.16 * scale;
    roller.add(lip);
  }

  const rim = new THREE.Mesh(
    new THREE.CylinderGeometry(0.28 * scale, 0.28 * scale, 0.3 * scale, 18),
    rimMat
  );
  rim.rotation.z = Math.PI / 2;
  roller.add(rim);

  // multi-spoke look
  for (let i = 0; i < 5; i++) {
    const spoke = new THREE.Mesh(
      new THREE.BoxGeometry(0.06 * scale, 0.32 * scale, 0.08 * scale),
      rimMat
    );
    spoke.rotation.z = Math.PI / 2;
    spoke.rotation.x = (i / 5) * Math.PI * 2;
    spoke.position.x = 0;
    roller.add(spoke);
  }

  const hub = new THREE.Mesh(
    new THREE.CylinderGeometry(0.09 * scale, 0.09 * scale, 0.38 * scale, 12),
    hubMat
  );
  hub.rotation.z = Math.PI / 2;
  roller.add(hub);

  const brake = new THREE.Mesh(
    new THREE.CylinderGeometry(0.2 * scale, 0.2 * scale, 0.08 * scale, 14),
    new THREE.MeshStandardMaterial({ color: 0x8a1010, metalness: 0.55, roughness: 0.4 })
  );
  brake.rotation.z = Math.PI / 2;
  roller.add(brake);

  roller.userData.rollAxis = "x";
  pivot.userData.roller = roller;
  return pivot;
}

function createCarMesh(color, dark, opts = false) {
  // opts: boolean tank (legacy) OR { tank, sporty, body, withGuide }
  const o = typeof opts === "object" && opts ? opts : { tank: !!opts };
  const tank = !!o.tank;
  const bodyStyle = o.body || (tank ? "tank" : o.sporty === false ? "sedan" : "sports");
  const sporty = o.sporty !== undefined
    ? !!o.sporty
    : bodyStyle === "sports" || bodyStyle === "gt" || bodyStyle === "coupe" || bodyStyle === "muscle";
  const withGuide = o.withGuide !== false;

  // Silhouette kits — rounded volumes scaled per catalog body
  const kits = {
    beater:  { s: 0.88, wide: 0.92, len: 0.9,  ride: 0.02, cabinScale: 1.12, hoodDrop: 0.02, wing: "none", vents: false, canards: false, quadEx: false, barTail: false, radius: 0.18 },
    sedan:   { s: 1.0,  wide: 1.0,  len: 1.0,  ride: 0,    cabinScale: 1.0,  hoodDrop: 0.04, wing: "lip",  vents: false, canards: false, quadEx: false, barTail: false, radius: 0.22 },
    coupe:   { s: 0.98, wide: 1.06, len: 1.02, ride: 0.04, cabinScale: 0.86, hoodDrop: 0.08, wing: "lip",  vents: true,  canards: false, quadEx: false, barTail: true,  radius: 0.24 },
    muscle:  { s: 1.08, wide: 1.18, len: 1.1,  ride: 0.02, cabinScale: 0.9,  hoodDrop: 0.06, wing: "duck", vents: true,  canards: false, quadEx: true,  barTail: false, radius: 0.2 },
    sports:  { s: 0.96, wide: 1.12, len: 0.98, ride: 0.1,  cabinScale: 0.72, hoodDrop: 0.12, wing: "high", vents: true,  canards: true,  quadEx: true,  barTail: true,  radius: 0.26 },
    gt:      { s: 1.02, wide: 1.16, len: 1.06, ride: 0.12, cabinScale: 0.68, hoodDrop: 0.14, wing: "gt",   vents: true,  canards: true,  quadEx: true,  barTail: true,  radius: 0.28 },
    tank:    { s: 1.26, wide: 1.08, len: 1.05, ride: 0,    cabinScale: 1.2,  hoodDrop: 0.02, wing: "armor",vents: false, canards: false, quadEx: false, barTail: false, radius: 0.14 },
  };
  const kit = kits[bodyStyle] || kits.sedan;
  const s = kit.s;
  const wide = kit.wide;
  const len = kit.len;
  const ride = kit.ride;
  const r = kit.radius;

  const g = new THREE.Group();

  // Soft automotive paint — polished, not mirror-shiny
  const bodyMat = new THREE.MeshStandardMaterial({
    color,
    metalness: tank ? 0.28 : sporty ? 0.42 : 0.34,
    roughness: tank ? 0.55 : sporty ? 0.42 : 0.48,
    envMapIntensity: 0.65,
  });
  const darkMat = new THREE.MeshStandardMaterial({
    color: dark,
    metalness: sporty ? 0.35 : 0.28,
    roughness: sporty ? 0.45 : 0.52,
    envMapIntensity: 0.55,
  });
  const glassMat = new THREE.MeshStandardMaterial({
    color: 0x1a4068,
    metalness: 0.25,
    roughness: 0.1,
    transparent: true,
    opacity: tank ? 0.55 : 0.42,
    depthWrite: false,
    envMapIntensity: 1.0,
  });
  const windGlassMat = new THREE.MeshStandardMaterial({
    color: 0x4a88b8,
    metalness: 0.2,
    roughness: 0.08,
    transparent: true,
    opacity: tank ? 0.5 : 0.36,
    depthWrite: false,
    envMapIntensity: 1.1,
  });
  const rearGlassMat = new THREE.MeshStandardMaterial({
    color: 0x2a2858,
    metalness: 0.22,
    roughness: 0.12,
    transparent: true,
    opacity: 0.48,
    depthWrite: false,
    envMapIntensity: 0.95,
  });
  const chrome = new THREE.MeshStandardMaterial({
    color: 0xd8dde4, metalness: 0.7, roughness: 0.28, envMapIntensity: 0.85,
  });
  const blackMat = new THREE.MeshStandardMaterial({ color: 0x1a1c20, roughness: 0.72, metalness: 0.2 });
  const trimMat = new THREE.MeshStandardMaterial({ color: 0x22262c, roughness: 0.6, metalness: 0.25 });

  const add = (mesh, x, y, z, rx = null, ry = null, rz = null) => {
    mesh.position.set(x, y - ride, z);
    if (rx !== null) mesh.rotation.x = rx;
    if (ry !== null) mesh.rotation.y = ry;
    if (rz !== null) mesh.rotation.z = rz;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    g.add(mesh);
    return mesh;
  };

  const rbox = (w, h, d, rad, seg = 4) =>
    new RoundedBoxGeometry(w, h, d, seg, Math.min(rad, Math.min(w, h, d) * 0.45));

  // —— Soft underbody capsule (along car length / Z) ——
  {
    const chassis = new THREE.Mesh(
      new THREE.CapsuleGeometry(0.55 * s, 2.6 * s * len, 6, 14),
      blackMat
    );
    chassis.rotation.x = Math.PI / 2;
    chassis.scale.set(wide * 1.05, 1, 0.32);
    add(chassis, 0, 0.28, 0);
  }

  // —— Main body: rounded shell ——
  {
    const shell = new THREE.Mesh(
      new THREE.CapsuleGeometry(0.95 * s, 2.2 * s * len, 10, 24),
      bodyMat
    );
    shell.rotation.x = Math.PI / 2;
    shell.scale.set(wide, 1, sporty ? 0.4 : tank ? 0.58 : 0.48);
    add(shell, 0, sporty ? 0.5 : tank ? 0.64 : 0.56, 0);
  }

  // Side shoulders — soft rounded flanks
  for (const sx of [-1, 1]) {
    const flank = new THREE.Mesh(
      new THREE.CapsuleGeometry(0.3 * s, 2.3 * s * len, 8, 16),
      bodyMat
    );
    flank.rotation.x = Math.PI / 2;
    flank.scale.set(0.55, 1, sporty ? 0.5 : 0.65);
    add(flank, sx * 0.82 * s * wide, sporty ? 0.52 : 0.6, -0.05 * s * len);
  }

  // —— Hood: rounded sloping volume ——
  {
    const hood = new THREE.Mesh(
      rbox(1.7 * s * wide, 0.28 * s, 1.55 * s * len * (sporty ? 1.1 : 0.95), r * 0.85),
      bodyMat
    );
    add(hood, 0, 0.62 - kit.hoodDrop, 1.15 * s * len, sporty ? 0.14 : 0.08, 0, 0);

    // Nose taper (sphere blend)
    const nose = new THREE.Mesh(new THREE.SphereGeometry(0.55 * s * wide, 16, 12), bodyMat);
    nose.scale.set(1.55, sporty ? 0.35 : 0.42, 0.85);
    add(nose, 0, 0.48, 2.05 * s * len);
  }

  if (kit.vents) {
    const bulge = new THREE.Mesh(rbox(0.72 * s, 0.1, 0.9 * s, 0.04), darkMat);
    add(bulge, 0, 0.78 - kit.hoodDrop, 1.15 * s * len, 0.1, 0, 0);
  }

  // —— Cabin / greenhouse: rounded capsule bubble ——
  {
    const cabinW = (tank ? 1.5 : 1.35) * s * wide;
    const cabinH = (tank ? 0.72 : sporty ? 0.42 : 0.52) * kit.cabinScale;
    const cabinL = (tank ? 1.9 : sporty ? 1.35 : 1.65) * s * len;
    const cabinY = (tank ? 1.15 : sporty ? 0.88 : 0.98);
    const cabinZ = tank ? -0.1 * s : sporty ? -0.4 * s : -0.28 * s;

    const cabin = new THREE.Mesh(
      new THREE.CapsuleGeometry(cabinW * 0.38, cabinL * 0.5, 10, 20),
      darkMat
    );
    cabin.rotation.x = Math.PI / 2;
    cabin.scale.set(1, 1, Math.max(0.45, cabinH / (cabinW * 0.38)));
    add(cabin, 0, cabinY, cabinZ * len);

    // Soft roof cap
    const roof = new THREE.Mesh(new THREE.SphereGeometry(cabinW * 0.48, 18, 12), bodyMat);
    roof.scale.set(1, 0.32, cabinL * 0.42 / (cabinW * 0.48));
    add(roof, 0, cabinY + cabinH * 0.55, cabinZ * len);

    if (bodyStyle !== "muscle" && bodyStyle !== "gt") {
      // Curved glass bubble
      const glass = new THREE.Mesh(
        new THREE.SphereGeometry(cabinW * 0.5, 18, 14, 0, Math.PI * 2, 0, Math.PI * 0.55),
        glassMat
      );
      glass.scale.set(0.98, cabinH / (cabinW * 0.35), cabinL * 0.38 / (cabinW * 0.5));
      add(glass, 0, cabinY + 0.02, cabinZ * len);

      // Windshield curve — lighter aqua tint
      const wind = new THREE.Mesh(
        new THREE.SphereGeometry(0.85 * s * wide, 16, 12, 0, Math.PI * 2, 0, Math.PI * 0.45),
        windGlassMat
      );
      wind.scale.set(1.05, 0.55, 0.7);
      add(wind, 0, cabinY + 0.05, cabinZ * len + cabinL * 0.38, -0.55, 0, 0);

      // Rear glass — deeper violet tint
      const rear = new THREE.Mesh(
        new THREE.SphereGeometry(0.75 * s * wide, 14, 10, 0, Math.PI * 2, 0, Math.PI * 0.4),
        rearGlassMat
      );
      rear.scale.set(1, 0.5, 0.55);
      add(rear, 0, cabinY + 0.02, cabinZ * len - cabinL * 0.35, 0.45, 0, 0);
    }
  }

  // —— Trunk / fastback ——
  {
    const trunk = new THREE.Mesh(
      rbox(1.65 * s * wide, 0.26 * s, sporty ? 0.85 * s : 1.0 * s * len, r * 0.75),
      bodyMat
    );
    add(trunk, 0, sporty ? 0.55 : 0.6, -1.55 * s * len, sporty ? -0.12 : -0.04, 0, 0);

    const butt = new THREE.Mesh(new THREE.SphereGeometry(0.5 * s * wide, 14, 12), bodyMat);
    butt.scale.set(1.5, sporty ? 0.32 : 0.4, 0.7);
    add(butt, 0, 0.5, -2.05 * s * len);
  }

  // —— Bumpers (soft) ——
  {
    const bumpF = new THREE.Mesh(rbox(1.9 * s * wide, 0.22, 0.38, 0.1), trimMat);
    add(bumpF, 0, 0.32, 2.28 * s * len);
    const bumpR = new THREE.Mesh(rbox(1.85 * s * wide, 0.2, 0.34, 0.1), trimMat);
    add(bumpR, 0, 0.3, -2.28 * s * len);
  }

  // Grille oval
  {
    const grille = new THREE.Mesh(
      new THREE.CapsuleGeometry(0.16, 0.9 * s * wide, 4, 10),
      blackMat
    );
    grille.rotation.z = Math.PI / 2;
    grille.scale.set(1, 0.7, 0.35);
    add(grille, 0, 0.48, 2.42 * s * len);
  }

  if (kit.canards) {
    for (const sx of [-1, 1]) {
      const canard = new THREE.Mesh(rbox(0.28, 0.04, 0.32, 0.02), trimMat);
      add(canard, sx * 1.0 * s * wide, 0.24, 2.1 * s * len, 0, 0, sx * 0.2);
    }
  }

  // Exhausts
  const exXs = kit.quadEx ? [-0.5, -0.26, 0.26, 0.5] : [-0.32, 0.32];
  for (const sx of exXs) {
    const ex = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.065, 0.2, 12), chrome);
    add(ex, sx * s * wide, 0.22, -2.42 * s * len, Math.PI / 2, 0, 0);
  }

  // Mirrors — small rounded capsules
  for (const sx of [-1, 1]) {
    const mir = new THREE.Mesh(new THREE.SphereGeometry(0.12, 10, 8), trimMat);
    mir.scale.set(1.4, 0.7, 1.1);
    add(mir, sx * 1.02 * s * wide, sporty ? 0.82 : 0.92, 0.2 * s * len);
  }

  // Soft wheel arches (half-torus)
  for (const [x, z] of [[1.0, 1.35], [-1.0, 1.35], [1.0, -1.35], [-1.0, -1.35]]) {
    const arch = new THREE.Mesh(
      new THREE.TorusGeometry(0.48 * s, 0.11 * s, 10, 18, Math.PI),
      bodyMat
    );
    arch.rotation.z = x > 0 ? -Math.PI / 2 : Math.PI / 2;
    arch.rotation.y = Math.PI / 2;
    add(arch, x * 0.92 * s * wide, 0.38, z * s * len);
  }

  // Wheels
  const frontWheels = [];
  const rearWheels = [];
  const wheelY = 0.36 - ride * 0.3;
  const wheelScale = tank ? 1.12 : sporty ? 1.12 : 1.05;
  for (const p of [
    { x: 1.02, z: 1.38, front: true },
    { x: -1.02, z: 1.38, front: true },
    { x: 1.02, z: -1.38, front: false },
    { x: -1.02, z: -1.38, front: false },
  ]) {
    const w = createWheel(wheelScale * (0.95 + (wide - 1) * 0.4));
    w.position.set(p.x * s * wide * 0.95, wheelY, p.z * s * len);
    g.add(w);
    if (p.front) frontWheels.push(w);
    else rearWheels.push(w);
  }

  // Headlights — cool white main beams + warm amber indicators
  const headMat = new THREE.MeshStandardMaterial({
    color: 0xe8f4ff, emissive: 0xb8dcff, emissiveIntensity: 1.35, metalness: 0.35, roughness: 0.15,
  });
  const amberMat = new THREE.MeshStandardMaterial({
    color: 0xffb020, emissive: 0xff8800, emissiveIntensity: 1.15, metalness: 0.25, roughness: 0.22,
  });
  for (const sx of [-1, 1]) {
    const lamp = new THREE.Mesh(new THREE.SphereGeometry(sporty ? 0.14 : 0.16, 12, 10), headMat);
    lamp.scale.set(sporty ? 1.55 : 1.2, sporty ? 0.55 : 0.75, 0.7);
    add(lamp, sx * 0.62 * s * wide, 0.5, 2.35 * s * len);
    const signal = new THREE.Mesh(rbox(0.14 * s, 0.08, 0.06, 0.02), amberMat);
    add(signal, sx * 0.95 * s * wide, 0.48, 2.28 * s * len);
  }

  // Taillights — red main + pink reverse / inner
  const tailMat = new THREE.MeshStandardMaterial({
    color: 0xff2020, emissive: 0xcc0000, emissiveIntensity: 1.15, metalness: 0.25, roughness: 0.25,
  });
  const reverseMat = new THREE.MeshStandardMaterial({
    color: 0xffe8f0, emissive: 0xffaac0, emissiveIntensity: 0.7, metalness: 0.2, roughness: 0.3,
  });
  if (kit.barTail) {
    const bar = new THREE.Mesh(new THREE.CapsuleGeometry(0.06, 1.35 * s * wide, 4, 10), tailMat);
    bar.rotation.z = Math.PI / 2;
    add(bar, 0, 0.52, -2.32 * s * len);
  } else {
    for (const sx of [-0.55, 0.55]) {
      const t = new THREE.Mesh(new THREE.SphereGeometry(0.14, 10, 8), tailMat);
      t.scale.set(1.3, 0.7, 0.55);
      add(t, sx * s * wide, 0.54, -2.3 * s * len);
      const rev = new THREE.Mesh(rbox(0.1, 0.06, 0.04, 0.015), reverseMat);
      add(rev, sx * 0.32 * s * wide, 0.5, -2.34 * s * len);
    }
  }

  // Body panel lines + door seams (not on Street Muscle / Phantom GT)
  if (bodyStyle !== "muscle" && bodyStyle !== "gt") {
    const lineMat = new THREE.MeshStandardMaterial({ color: 0x12141a, roughness: 0.85, metalness: 0.15 });
    for (const sx of [-1, 1]) {
      const belt = new THREE.Mesh(rbox(0.03, 0.035, 2.6 * s * len, 0.01), lineMat);
      add(belt, sx * 1.02 * s * wide, sporty ? 0.72 : 0.78, -0.15 * s * len);
      const doorSeam = new THREE.Mesh(rbox(0.025, 0.42 * s, 0.03, 0.01), lineMat);
      add(doorSeam, sx * 1.03 * s * wide, sporty ? 0.7 : 0.78, -0.05 * s * len);
      const rockerLine = new THREE.Mesh(rbox(0.03, 0.03, 2.4 * s * len, 0.01), lineMat);
      add(rockerLine, sx * 1.0 * s * wide, 0.38, -0.1 * s * len);
    }
    const hoodCrease = new THREE.Mesh(rbox(0.04, 0.02, 1.2 * s * len, 0.01), lineMat);
    add(hoodCrease, 0, 0.78 - kit.hoodDrop, 1.1 * s * len, sporty ? 0.12 : 0.06, 0, 0);
  }

  // Door handles — chrome
  for (const sx of [-1, 1]) {
    const handle = new THREE.Mesh(rbox(0.06, 0.045, 0.18, 0.02), chrome);
    add(handle, sx * 1.05 * s * wide, sporty ? 0.78 : 0.88, 0.15 * s * len);
    const grip = new THREE.Mesh(rbox(0.03, 0.03, 0.12, 0.01), blackMat);
    add(grip, sx * 1.07 * s * wide, sporty ? 0.78 : 0.88, 0.15 * s * len);
  }

  // Side glass panes — cooler blue tint vs cabin bubble (not on Street Muscle / Phantom GT)
  if (bodyStyle !== "muscle" && bodyStyle !== "gt") {
    const sideGlassMat = new THREE.MeshStandardMaterial({
      color: 0x3a6a9a, metalness: 0.25, roughness: 0.1,
      transparent: true, opacity: 0.45, depthWrite: false, envMapIntensity: 1.0,
    });
    for (const sx of [-1, 1]) {
      const pane = new THREE.Mesh(rbox(0.04, sporty ? 0.28 : 0.36, sporty ? 1.0 : 1.25 * s * len, 0.04), sideGlassMat);
      add(pane, sx * 0.95 * s * wide, sporty ? 0.95 : 1.05, sporty ? -0.35 * s : -0.2 * s * len);
    }
  }

  // Aero / wings
  if (kit.wing === "gt" || kit.wing === "high") {
    const high = kit.wing === "gt";
    const wing = new THREE.Mesh(rbox((high ? 1.9 : 1.7) * s * wide, 0.05, high ? 0.42 : 0.34, 0.02), trimMat);
    add(wing, 0, high ? 1.28 : 1.12, -1.85 * s * len, -0.1, 0, 0);
    for (const sx of [-1, 1]) {
      const plate = new THREE.Mesh(rbox(0.05, high ? 0.26 : 0.2, high ? 0.44 : 0.36, 0.02), trimMat);
      add(plate, sx * (high ? 0.9 : 0.8) * s * wide, high ? 1.2 : 1.06, -1.85 * s * len);
      const strut = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, high ? 0.42 : 0.32, 8), trimMat);
      add(strut, sx * 0.45 * s, high ? 1.0 : 0.92, -1.8 * s * len);
    }
  } else if (kit.wing === "duck" || kit.wing === "lip") {
    const wing = new THREE.Mesh(rbox(1.6 * s * wide, 0.05, kit.wing === "duck" ? 0.28 : 0.2, 0.02), darkMat);
    add(wing, 0, 0.72, -2.0 * s * len, kit.wing === "duck" ? -0.18 : -0.06, 0, 0);
  } else if (kit.wing === "armor") {
    const armor = new THREE.Mesh(rbox(2.05 * s, 0.35, 3.4 * s, 0.08), darkMat);
    add(armor, 0, 0.95, 0);
  }

  if (bodyStyle === "beater") {
    const dent = new THREE.Mesh(new THREE.SphereGeometry(0.28, 10, 8), darkMat);
    dent.scale.set(1.2, 0.55, 1);
    add(dent, 0.55 * s * wide, 0.55, 0.6 * s);
    const rust = new THREE.Mesh(
      new THREE.SphereGeometry(0.2, 8, 6),
      new THREE.MeshStandardMaterial({ color: 0x8a4a28, roughness: 0.85, metalness: 0.1 })
    );
    rust.scale.set(1.4, 0.35, 1.8);
    add(rust, -0.65 * s * wide, 0.4, -0.7 * s);
  }

  // License plate
  const plate = new THREE.Mesh(rbox(0.5, 0.14, 0.03, 0.02), new THREE.MeshStandardMaterial({
    color: 0xf0f0e8, roughness: 0.6, metalness: 0.08,
  }));
  add(plate, 0, 0.34, -2.42 * s * len);

  attachCarGuide(g, withGuide);

  g.userData.wheels = [...frontWheels, ...rearWheels];
  g.userData.frontWheels = frontWheels;
  g.userData.rearWheels = rearWheels;
  g.userData.body = bodyStyle;
  g.traverse((obj) => {
    if (obj.isMesh) {
      const isGuide = !!obj.userData?.isGuide;
      obj.castShadow = !isGuide;
      obj.receiveShadow = true;
    }
  });
  return g;
}

const smokeGeo = new THREE.SphereGeometry(0.45, 5, 4);
const smokePool = [];

function spawnDriftSmoke(x, z, intensity = 1) {
  if (!quality.smoke) return;
  if (driftSmoke.length > 12) return;
  let mesh = smokePool.pop();
  if (!mesh) {
    mesh = new THREE.Mesh(
      smokeGeo,
      new THREE.MeshBasicMaterial({
        color: 0xc8c8c8,
        transparent: true,
        opacity: 0.3,
        depthWrite: false,
      })
    );
  }
  mesh.visible = true;
  mesh.material.opacity = 0.32 * intensity;
  mesh.scale.setScalar(1);
  mesh.position.set(x + (Math.random() - 0.5) * 0.6, 0.25, z + (Math.random() - 0.5) * 0.6);
  if (!mesh.parent) scene.add(mesh);
  driftSmoke.push({
    mesh,
    life: 0.35 + Math.random() * 0.25,
    max: 0.6,
    vx: (Math.random() - 0.5) * 2,
    vz: (Math.random() - 0.5) * 2,
    grow: 1.6 + Math.random() * 0.6,
  });
}

function updateDriftSmoke(dt) {
  for (let i = driftSmoke.length - 1; i >= 0; i--) {
    const s = driftSmoke[i];
    s.life -= dt;
    s.mesh.position.x += s.vx * dt;
    s.mesh.position.z += s.vz * dt;
    s.mesh.position.y += 0.8 * dt;
    const t = 1 - s.life / s.max;
    const sc = 1 + t * s.grow;
    s.mesh.scale.setScalar(sc);
    s.mesh.material.opacity = Math.max(0, 0.3 * (1 - t));
    if (s.life <= 0) {
      s.mesh.visible = false;
      smokePool.push(s.mesh);
      driftSmoke.splice(i, 1);
    }
  }
}

/** Police kit: lightbar, push bumper, stripes, antenna — sized to the GLB body. */
function attachPoliceGear(g, tier) {
  g.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(g);
  const size = new THREE.Vector3();
  const center = new THREE.Vector3();
  box.getSize(size);
  box.getCenter(center);

  const w = Math.max(1.4, size.x);
  const h = Math.max(0.9, size.y);
  const L = Math.max(3.2, size.z);
  const roofY = box.max.y + 0.02;
  const cabinZ = center.z * 0.15;
  const frontZ = box.max.z;
  const rearZ = box.min.z;
  const sideX = w * 0.52;
  const beltY = box.min.y + h * 0.42;

  const kit = new THREE.Group();
  kit.name = "police-kit";

  const blackMat = new THREE.MeshStandardMaterial({
    color: 0x12151a, metalness: 0.55, roughness: 0.38, envMapIntensity: 0.7,
  });
  const chrome = new THREE.MeshStandardMaterial({
    color: 0xc8ced8, metalness: 0.85, roughness: 0.22, envMapIntensity: 1.0,
  });
  const stripeMat = new THREE.MeshStandardMaterial({
    color: tier.stripe, metalness: 0.35, roughness: 0.4, envMapIntensity: 0.8,
  });
  const whitePanel = new THREE.MeshStandardMaterial({
    color: 0xf4f6fa, metalness: 0.2, roughness: 0.55,
  });
  const darkPanel = new THREE.MeshStandardMaterial({
    color: tier.dark, metalness: 0.35, roughness: 0.45,
  });

  const add = (mesh, x, y, z, rx = 0, ry = 0, rz = 0) => {
    mesh.position.set(x, y, z);
    mesh.rotation.set(rx, ry, rz);
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    kit.add(mesh);
    return mesh;
  };

  // —— Roof lightbar ——
  const barW = tier.sirenHigh ? w * 0.52 : w * 0.62;
  const barD = tier.sirenHigh ? 0.42 : 0.34;
  const barH = 0.14;
  const barY = roofY + barH * 0.55;
  add(new THREE.Mesh(new THREE.BoxGeometry(barW, barH * 0.55, barD * 0.9), blackMat), 0, barY - 0.04, cabinZ);

  const lensGeo = new THREE.BoxGeometry(barW * 0.42, barH, barD);
  const red = new THREE.Mesh(
    lensGeo,
    new THREE.MeshStandardMaterial({
      color: 0xff1010, emissive: 0xff0000, emissiveIntensity: 2.6, metalness: 0.1, roughness: 0.25,
    })
  );
  add(red, -barW * 0.26, barY, cabinZ);
  const blueCol = tier.sirenHigh ? 0xffaa00 : 0x0066ff;
  const blue = new THREE.Mesh(
    lensGeo.clone(),
    new THREE.MeshStandardMaterial({
      color: blueCol, emissive: blueCol, emissiveIntensity: 2.6, metalness: 0.1, roughness: 0.25,
    })
  );
  add(blue, barW * 0.26, barY, cabinZ);

  // Center clear / white strobe
  add(
    new THREE.Mesh(
      new THREE.BoxGeometry(barW * 0.16, barH * 0.85, barD * 0.85),
      new THREE.MeshStandardMaterial({
        color: 0xffffff, emissive: 0xe8f0ff, emissiveIntensity: 0.9, metalness: 0.05, roughness: 0.2,
      })
    ),
    0, barY, cabinZ
  );

  // —— Side door stripes + POLICE plate ——
  for (const sx of [-1, 1]) {
    add(
      new THREE.Mesh(new THREE.BoxGeometry(0.04, h * 0.12, L * 0.55), stripeMat),
      sx * sideX, beltY, center.z * 0.05
    );
    add(
      new THREE.Mesh(new THREE.BoxGeometry(0.035, h * 0.06, L * 0.22), whitePanel),
      sx * (sideX + 0.01), beltY + h * 0.1, center.z * 0.05
    );
    add(
      new THREE.Mesh(new THREE.BoxGeometry(0.03, h * 0.045, L * 0.16), darkPanel),
      sx * (sideX + 0.02), beltY + h * 0.1, center.z * 0.05
    );
  }

  // Hood / trunk accent stripe
  add(
    new THREE.Mesh(new THREE.BoxGeometry(w * 0.18, 0.03, L * 0.28), stripeMat),
    0, box.min.y + h * 0.55, frontZ - L * 0.22
  );
  add(
    new THREE.Mesh(new THREE.BoxGeometry(w * 0.22, 0.03, L * 0.16), stripeMat),
    0, box.min.y + h * 0.52, rearZ + L * 0.18
  );

  // —— Front push bumper / bull bar ——
  const bumperY = box.min.y + h * 0.18;
  const bumperZ = frontZ + 0.08;
  add(new THREE.Mesh(new THREE.BoxGeometry(w * 0.92, 0.1, 0.16), blackMat), 0, bumperY, bumperZ);
  add(new THREE.Mesh(new THREE.BoxGeometry(w * 0.78, 0.22, 0.08), chrome), 0, bumperY + 0.12, bumperZ + 0.02);
  for (const sx of [-1, 1]) {
    add(new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.32, 0.07), chrome), sx * w * 0.32, bumperY + 0.18, bumperZ);
  }
  if (tier.tank || tier.id === "swat") {
    // Heavier SWAT cage bumper
    for (const sx of [-1, 0, 1]) {
      add(new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.45, 0.06), blackMat), sx * w * 0.28, bumperY + 0.22, bumperZ + 0.04);
    }
    add(new THREE.Mesh(new THREE.BoxGeometry(w * 0.7, 0.06, 0.06), blackMat), 0, bumperY + 0.42, bumperZ + 0.04);
  }

  // Fog / alley lights on bumper
  for (const sx of [-1, 1]) {
    add(
      new THREE.Mesh(
        new THREE.BoxGeometry(0.16, 0.08, 0.06),
        new THREE.MeshStandardMaterial({
          color: 0xeaf4ff, emissive: 0xa8d0ff, emissiveIntensity: 1.3, roughness: 0.2,
        })
      ),
      sx * w * 0.28, bumperY + 0.02, bumperZ + 0.06
    );
  }

  // —— Spotlights on A-pillar ——
  for (const sx of [-1, 1]) {
    const spot = new THREE.Mesh(
      new THREE.CylinderGeometry(0.06, 0.07, 0.14, 10),
      new THREE.MeshStandardMaterial({
        color: 0xddeeff, emissive: 0x88b0ff, emissiveIntensity: 1.1, metalness: 0.4, roughness: 0.25,
      })
    );
    add(spot, sx * w * 0.38, roofY - h * 0.12, cabinZ + L * 0.12, 0, 0, sx * 0.9);
  }

  // —— Antenna ——
  add(new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.02, h * 0.55, 6), blackMat), w * 0.22, roofY + h * 0.22, cabinZ - L * 0.08);

  // —— Rear deck lights ——
  for (const sx of [-1, 1]) {
    add(
      new THREE.Mesh(
        new THREE.BoxGeometry(0.22, 0.08, 0.06),
        new THREE.MeshStandardMaterial({
          color: sx < 0 ? 0xff2020 : blueCol,
          emissive: sx < 0 ? 0xff0000 : blueCol,
          emissiveIntensity: 1.8,
          roughness: 0.25,
        })
      ),
      sx * w * 0.22, box.min.y + h * 0.62, rearZ + 0.04
    );
  }

  // Tier flair
  if (tier.id === "interceptor" || tier.id === "elite" || tier.id === "pursuit") {
    add(
      new THREE.Mesh(new THREE.BoxGeometry(w * 0.85, 0.08, 0.28), stripeMat),
      0, roofY - h * 0.08, rearZ + L * 0.12
    );
  }
  if (tier.id === "pursuit") {
    add(
      new THREE.Mesh(new THREE.BoxGeometry(w * 0.35, 0.06, L * 0.2), stripeMat),
      0, box.min.y + h * 0.58, frontZ - L * 0.28
    );
  }
  if (tier.id === "swat") {
    add(
      new THREE.Mesh(new THREE.BoxGeometry(w * 0.7, h * 0.22, L * 0.35), blackMat),
      0, roofY - h * 0.05, cabinZ - L * 0.05
    );
  }
  if (tier.id === "elite") {
    add(
      new THREE.Mesh(new THREE.BoxGeometry(w * 0.9, 0.05, 0.35), stripeMat),
      0, box.min.y + h * 0.12, frontZ + 0.02
    );
  }

  g.add(kit);
  g.userData.siren = { red, blue, t: 0 };
  g.userData.policeKit = kit;
  return kit;
}

function createPoliceMesh(tier = getPoliceTier()) {
  // Procedural body (not heavy realistic GLBs) — keeps chase spawns from hitching
  const body = tier.body === "gt" ? "sports" : (tier.body || "sedan");
  const g = createTrafficMesh({
    id: tier.id,
    body,
    color: tier.color,
    dark: tier.dark,
  });
  if (g.userData.guide) g.userData.guide.visible = false;

  // Slightly reshape by tier so each fleet reads as a different unit
  const ls = tier.lengthScale || 1;
  g.scale.set(ls > 1 ? 1.04 : ls < 1 ? 0.96 : 1, tier.tank ? 1.06 : 1, ls);

  attachPoliceGear(g, tier);
  g.userData.tierId = tier.id;
  g.userData.police = true;
  return g;
}

function getEquippedStats() {
  return CAR_CATALOG.find((c) => c.id === equippedId) || CAR_CATALOG[0];
}

function createPlayer(id, defaultColor, defaultDark, controls) {
  const stats = getEquippedStats();
  const color = id === "P1" ? (stats.color ?? defaultColor) : (stats.color ? new THREE.Color(stats.color).offsetHSL(0.08, 0, 0).getHex() : defaultDark);
  // Keep P1 / P2 readable; starter uses default team colors
  let col = defaultColor, dark = defaultDark;
  const paint = {
    cruiser: { p1: [0xff5a3c, 0xb8321a], p2: [0x3dd0ff, 0x1570a0] },
    night: { p1: [0x3a5cff, 0x1a2a8a], p2: [0x5ad0ff, 0x2060a0] },
    muscle: { p1: [0xff9a1a, 0xc45a00], p2: [0x2ec4ff, 0x0a5a8a] },
    turbo: { p1: [0x3dff8a, 0x1a8a45], p2: [0x2db0ff, 0x0e5a9a] },
    phantom: { p1: [0xff2d8a, 0xb0105a], p2: [0x2d9cff, 0x10508a] },
  };
  if (paint[stats.id]) {
    const pair = id === "P1" ? paint[stats.id].p1 : paint[stats.id].p2;
    col = pair[0];
    dark = pair[1];
  }

  const spawn = randomRoadPoint();
  const mesh = createCatalogCarMesh(col, dark, stats.body || "sedan", { withGuide: true, castShadow: true });
  const n = nearestNode(spawn.x, spawn.z);
  // face toward a neighbor for sensible spawn heading
  let angle = 0;
  const neighbors = [];
  for (const e of edges) {
    if (e.a === n) neighbors.push(e.b);
    if (e.b === n) neighbors.push(e.a);
  }
  if (neighbors.length) {
    const dest = neighbors[0];
    angle = Math.atan2(dest.x - n.x, dest.z - n.z);
  }
  mesh.position.set(spawn.x, 0, spawn.z);
  mesh.rotation.y = angle;
  scene.add(mesh);

  return {
    id,
    controls,
    mesh,
    x: spawn.x,
    z: spawn.z,
    angle,
    speed: 0,
    slideX: 0,
    slideZ: 0,
    spin: 0,
    steerAngle: 0,
    drift: 0,
    damage: 0,
    hitCd: 0,
    cash: 0,
    heat: 0,
    carrying: false,
    job: "FIND ROBBER",
    lookBack: false,
    camPos: new THREE.Vector3(
      spawn.x - Math.sin(angle) * 6.2,
      3.1,
      spawn.z - Math.cos(angle) * 6.2
    ),
    camLook: new THREE.Vector3(
      spawn.x + Math.sin(angle) * 5.5,
      1.05,
      spawn.z + Math.cos(angle) * 5.5
    ),
    invuln: 0,
    bustFlash: 0,
    boostT: 0,
    zone: null,
    payoutMul: 1,
    gasCd: 0,
    susY: 0.16,
    susVel: 0,
    susPitch: 0,
    prevFwd: 0,
  };
}

let players = [];
let state = "loading";
let lastTs = 0;
let sirenTimer = 0;

const camera1 = new THREE.PerspectiveCamera(60, 1, 0.5, 900);
const camera2 = new THREE.PerspectiveCamera(60, 1, 0.5, 900);

function getObjective(player) {
  if (player.carrying) {
    let best = null, bestD = Infinity;
    for (const s of safehouses) {
      const d = Math.hypot(s.x - player.x, s.z - player.z);
      if (d < bestD) { bestD = d; best = s; }
    }
    return best ? { x: best.x, z: best.z, kind: "safe", dist: bestD } : null;
  }
  let best = null, bestD = Infinity;
  for (const r of robbers) {
    if (r.taken) continue;
    const d = Math.hypot(r.x - player.x, r.z - player.z);
    if (d < bestD) { bestD = d; best = r; }
  }
  return best ? { x: best.x, z: best.z, kind: "robber", dist: bestD } : null;
}

function shortestAngleDelta(from, to) {
  let d = to - from;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}

function updateGuideArrow(player, dt = 1 / 60) {
  const guide = player.mesh.userData.guide;
  if (!guide) return;
  const obj = getObjective(player);
  if (!obj || state === "menu") {
    guide.visible = false;
    return;
  }
  guide.visible = true;

  // Keep above the car in world space (not twisted by body roll)
  if (guide.parent !== scene) scene.attach(guide);

  const wx = obj.x - player.x;
  const wz = obj.z - player.z;
  let desired = guide.userData.smoothYaw || 0;
  if (wx * wx + wz * wz >= 0.0001) {
    // Bearing vs car heading — sprite "up" = drive forward (chase cam matches)
    const fx = Math.sin(player.angle);
    const fz = Math.cos(player.angle);
    const olen = Math.hypot(wx, wz);
    const ox = wx / olen;
    const oz = wz / olen;
    desired = Math.atan2(ox * fz - oz * fx, ox * fx + oz * fz);
  }
  if (guide.userData.smoothYaw == null) guide.userData.smoothYaw = desired;
  const delta = shortestAngleDelta(guide.userData.smoothYaw, desired);
  guide.userData.smoothYaw += delta * (1 - Math.exp(-12 * dt));
  // SpriteMaterial.rotation is CCW on screen; matches our signed bearing
  if (guide.material) guide.material.rotation = guide.userData.smoothYaw;

  const isSafe = obj.kind === "safe";
  const col = isSafe ? 0xffc14a : 0x3dff8a;
  for (const m of player.mesh.userData.guideMats || []) {
    if (m.color) m.color.setHex(col);
  }

  const baseY = 3.35;
  const bob = Math.sin(performance.now() * 0.003) * 0.07;
  if (guide.userData.smoothY == null) guide.userData.smoothY = baseY;
  guide.userData.smoothY += (baseY + bob - guide.userData.smoothY) * (1 - Math.exp(-5 * dt));
  guide.position.set(player.x, guide.userData.smoothY, player.z);
}


function updateGuideArrows(dt = 1 / 60) {
  if (!players.length || (state !== "playing" && state !== "paused")) {
    for (const p of players) {
      const guide = p.mesh?.userData?.guide;
      if (guide) guide.visible = false;
    }
    return;
  }
  for (const p of players) updateGuideArrow(p, dt);
}

function resetPlayers() {
  players.forEach((p) => { disposePlayerGuide(p); scene.remove(p.mesh); });
  players = [
    createPlayer("P1", 0xff2d4a, 0xa01228, {
      up: "KeyW", down: "KeyS", left: "KeyA", right: "KeyD",
      brake: "KeyS", look: "KeyC", reset: "ShiftLeft",
    }),
  ];
  if (playerMode === 2) {
    players.push(createPlayer("P2", 0x2db0ff, 0x0e5a9a, {
      up: "ArrowUp", down: "ArrowDown", left: "ArrowLeft", right: "ArrowRight",
      brake: "ArrowDown", look: "Slash", reset: "Period",
    }));
  }
}

/** Pick a road spawn away from players — different city spots, not on top of the getaway. */
function pickCopSpawnAwayFrom(nearPlayer) {
  const minDist = 55;
  const maxDist = 160;
  let best = null;
  let bestScore = -Infinity;

  for (let attempt = 0; attempt < 24; attempt++) {
    const p = randomRoadPoint();
    let nearestPlayerDist = Infinity;
    for (const pl of players) {
      const d = Math.hypot(pl.x - p.x, pl.z - p.z);
      if (d < nearestPlayerDist) nearestPlayerDist = d;
    }
    // Prefer mid-range: far enough to feel like a new unit, close enough to join the chase
    if (nearestPlayerDist < minDist) continue;
    const mid = (minDist + maxDist) * 0.5;
    const score = -Math.abs(nearestPlayerDist - mid) + Math.random() * 12;
    if (score > bestScore) {
      bestScore = score;
      best = p;
    }
  }

  if (best) return best;

  // Fallback: ring around a random direction from the chase target
  const ang = Math.random() * Math.PI * 2;
  const dist = minDist + Math.random() * (maxDist - minDist) * 0.5;
  const origin = nearPlayer || players[0];
  if (origin) {
    return {
      x: origin.x + Math.sin(ang) * dist,
      z: origin.z + Math.cos(ang) * dist,
    };
  }
  return randomRoadPoint();
}

function spawnCop(nearPlayer) {
  let { x, z } = pickCopSpawnAwayFrom(nearPlayer);

  // snap toward road
  for (let i = 0; i < 8; i++) {
    if (onRoad(x, z, 4)) break;
    const n = nearestNode(x, z);
    x = (x + n.x) / 2;
    z = (z + n.z) / 2;
  }

  const tier = getPoliceTier();
  const mesh = createPoliceMesh(tier);
  mesh.position.set(x, 0, z);

  // Face toward the chase target when possible
  let angle = 0;
  if (nearPlayer) {
    angle = Math.atan2(nearPlayer.x - x, nearPlayer.z - z);
    mesh.rotation.y = angle;
  }
  scene.add(mesh);
  cops.push({
    mesh, x, z,
    angle,
    tierId: tier.id,
    maxSpeed: tier.maxSpeed * COP_SPEED_MULT,
    accel: tier.accel,
    turn: tier.turn,
    speed: tier.maxSpeed * COP_SPEED_MULT * 0.55,
    slideX: 0,
    slideZ: 0,
    spin: 0,
    hitCd: 0,
    target: nearPlayer || null,
    pathNode: nearestNode(x, z),
    nextNode: null,
    stuck: 0,
  });
}

/** Queue of cops waiting for a visual tier swap (one every ~0.55s — slow model roll). */
const pendingCopUpgrades = [];
let copUpgradeCooldown = 0;

/** Swap existing police meshes/stats up to the current tier after more deliveries. */
function upgradeActiveCops() {
  const tier = getPoliceTier();
  for (const c of cops) {
    if (c.tierId === tier.id) continue;
    // Stats update immediately; mesh swap rolls out slowly one car at a time
    c.tierId = tier.id;
    c.maxSpeed = tier.maxSpeed * COP_SPEED_MULT;
    c.accel = tier.accel;
    c.turn = tier.turn;
    c.speed = Math.min(c.speed, tier.maxSpeed * COP_SPEED_MULT);
    c.pendingTierMesh = tier;
    if (!pendingCopUpgrades.includes(c)) pendingCopUpgrades.push(c);
  }
}

function processCopUpgradeQueue(dt = 0.016) {
  if (!pendingCopUpgrades.length) return;
  copUpgradeCooldown -= dt;
  if (copUpgradeCooldown > 0) return;
  copUpgradeCooldown = 0.55;
  const c = pendingCopUpgrades.shift();
  if (!c || !cops.includes(c) || !c.pendingTierMesh) return;
  const tier = c.pendingTierMesh;
  c.pendingTierMesh = null;
  const old = c.mesh;
  const mesh = createPoliceMesh(tier);
  mesh.position.copy(old.position);
  mesh.rotation.copy(old.rotation);
  scene.remove(old);
  // Dispose old geometries carefully — shared geos on wheels are reused; skip deep dispose
  scene.add(mesh);
  c.mesh = mesh;
}

function trimCopsTo(maxKeep) {
  while (cops.length > maxKeep) {
    const c = cops.pop();
    scene.remove(c.mesh);
  }
}

function clearCops() {
  cops.forEach((c) => scene.remove(c.mesh));
  cops.length = 0;
}

function clearRoadblocks() {
  roadblocks.forEach((r) => world.remove(r.mesh));
  roadblocks.length = 0;
}

// ——— Civilian traffic ———
function trafficLaneOffset(edge) {
  return Math.max(2.4, Math.min(7.5, edge.w * 0.24));
}

function trafficRightOffset(from, to, lane) {
  const fx = to.x - from.x;
  const fz = to.z - from.z;
  const len = Math.hypot(fx, fz) || 1;
  // Right-hand traffic relative to travel direction on the XZ plane
  return { x: (fz / len) * lane, z: (-fx / len) * lane };
}

function pickTrafficNext(from, current) {
  const list = edgesByNode.get(current.id) || [];
  const options = [];
  for (const e of list) {
    const other = e.a.id === current.id ? e.b : e.a;
    if (from && other.id === from.id && list.length > 1) continue;
    options.push({ node: other, edge: e });
  }
  if (!options.length) {
    for (const e of list) {
      const other = e.a.id === current.id ? e.b : e.a;
      options.push({ node: other, edge: e });
    }
  }
  if (!options.length) return null;
  if (from && options.length > 1 && Math.random() < 0.58) {
    const inDx = current.x - from.x;
    const inDz = current.z - from.z;
    let best = options[0];
    let bestDot = -Infinity;
    for (const o of options) {
      const dx = o.node.x - current.x;
      const dz = o.node.z - current.z;
      const dot = inDx * dx + inDz * dz;
      if (dot > bestDot) {
        bestDot = dot;
        best = o;
      }
    }
    return best;
  }
  return options[(Math.random() * options.length) | 0];
}

// Civilian traffic meshes — lean prototypes in js/traffic-mesh.js
// (imported createTrafficMesh / warmTrafficPrototypes)

async function loadCarModels() {
  const realisticScenes = new Map();
  const realisticEntries = Object.entries(CAR_REALISTIC_FILES);
  for (let i = 0; i < realisticEntries.length; i++) {
    const [key, url] = realisticEntries[i];
    setLoad(0.7 + (i / Math.max(1, realisticEntries.length)) * 0.08, `Loading realistic cars… ${key}`);
    try {
      const gltf = await gltfLoader.loadAsync(url);
      normalizeGltfCarRoot(gltf.scene, ROAD_CAR_LENGTH);
      faceGltfCarForward(gltf.scene);
      const yaw = CAR_REALISTIC_YAW[key] || 0;
      if (yaw) gltf.scene.rotation.y += yaw;
      realisticScenes.set(key, gltf.scene);
      console.info(`[cars] realistic base ready: ${key}`);
    } catch (err) {
      console.warn(`[cars] realistic ${key} failed:`, err?.message || err);
    }
  }

  const entries = Object.entries(CAR_MODEL_FILES);
  for (let i = 0; i < entries.length; i++) {
    const [body, fallbackUrl] = entries[i];
    setLoad(0.78 + (i / Math.max(1, entries.length)) * 0.14, `Loading cars… ${body}`);

    // 1) Distinct realistic free models (one GLB per body)
    const realisticKey = CAR_BODY_REALISTIC[body];
    if (realisticKey && realisticScenes.has(realisticKey)) {
      carModelCache.set(body, realisticScenes.get(realisticKey));
      carModelMeta.set(body, {
        realistic: true,
        kenney: false,
        base: realisticKey,
        worn: false,
      });
      console.info(`[cars] ${body} ← realistic:${realisticKey}`);
      continue;
    }

    // 2) Kenney / default fallbacks
    try {
      const gltf = await gltfLoader.loadAsync(fallbackUrl);
      const kenney = gltfUsesKenneyColormap(gltf.scene);
      if (!kenney) {
        normalizeGltfCarRoot(gltf.scene, ROAD_CAR_LENGTH);
        faceGltfCarForward(gltf.scene);
      }
      carModelCache.set(body, gltf.scene);
      carModelMeta.set(body, { kenney, realistic: false, worn: false });
      console.info(`[cars] loaded fallback ${body} ← ${fallbackUrl} kenney=${kenney}`);
    } catch (err) {
      console.warn(`Failed to load car model ${body}:`, err);
    }
  }
}

/** three.js Ferrari faces -Z; Kenney / CarConcept usually +Z. */
function faceGltfCarForward(root) {
  const fl =
    root.getObjectByName("wheel_fl") ||
    root.getObjectByName("WheelFrontL") ||
    root.getObjectByName("wheel-front-left");
  const rl =
    root.getObjectByName("wheel_rl") ||
    root.getObjectByName("WheelRearL") ||
    root.getObjectByName("wheel-back-left");
  if (!fl || !rl) return;
  root.updateMatrixWorld(true);
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  fl.getWorldPosition(a);
  rl.getWorldPosition(b);
  if (a.z < b.z) root.rotation.y += Math.PI;
}

function gltfUsesKenneyColormap(root) {
  let hasColormap = false;
  let hasKenneyWheels = false;
  root.traverse((obj) => {
    const n = (obj.name || "").toLowerCase();
    if (
      n === "wheel-front-left" ||
      n === "wheel-front-right" ||
      n === "wheel-back-left" ||
      n === "wheel-back-right"
    ) {
      hasKenneyWheels = true;
    }
    if (!obj.isMesh || !obj.material) return;
    for (const m of [].concat(obj.material)) {
      const label = `${m.name || ""} ${m.map?.name || ""}`.toLowerCase();
      if (label.includes("colormap")) hasColormap = true;
    }
  });
  return hasColormap || hasKenneyWheels;
}

/** Fit any imported car to a consistent road length and plant it on y=0. */
function normalizeGltfCarRoot(root, targetLength = ROAD_CAR_LENGTH) {
  root.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(root);
  const size = new THREE.Vector3();
  box.getSize(size);
  const len = Math.max(size.x, size.z, 0.001);
  const s = targetLength / len;
  root.scale.multiplyScalar(s);
  root.updateMatrixWorld(true);
  box.setFromObject(root);
  const center = new THREE.Vector3();
  box.getCenter(center);
  root.position.x -= center.x;
  root.position.z -= center.z;
  root.position.y -= box.min.y;
  root.updateMatrixWorld(true);
}

/** Reduce height only; keep width/length. Re-seat on the ground. */
function squashCarHeight(root, heightScale = CAR_HEIGHT_SCALE) {
  root.scale.y *= heightScale;
  root.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(root);
  root.position.y -= box.min.y;
  root.updateMatrixWorld(true);
}

/** Spin a rigged wheel roller (axis varies by GLB export). */
function spinWheelRoller(roller, delta) {
  if (!roller) return;
  const axis = roller.userData.rollAxis || "x";
  roller.rotation[axis] += delta;
}

/** Smallest bbox axis ≈ axle direction for tire meshes. */
function detectWheelRollAxis(obj) {
  obj.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(obj);
  const size = new THREE.Vector3();
  box.getSize(size);
  // Road cars face +Z after normalize — axle is almost always lateral X when
  // the part looks like a single upright wheel (thin in X, round in YZ).
  const minDim = Math.min(size.x, size.y, size.z);
  if (size.x <= minDim * 1.2 && size.y > size.x * 1.15 && size.z > size.x * 1.15) {
    return "x";
  }
  if (size.x <= size.y && size.x <= size.z) return "x";
  if (size.y <= size.x && size.y <= size.z) return "y";
  return "z";
}

/** True when a mesh is all four tires fused into one blob. */
function isMergedTireBlob(size) {
  // Single tire ≈ 0.25–0.4 wide × ~0.6 dia. A 4-tire bake spans the car (~1.7×3+).
  return (size.x > 1.15 && size.z > 1.7) || (size.x > 1.7 && size.z > 1.15);
}

function gltfWheelLabel(obj) {
  const mat = obj.isMesh ? [].concat(obj.material)[0] : null;
  const matName = (mat?.name || "").toLowerCase();
  return `${obj.name} ${obj.parent?.name || ""} ${matName}`.toLowerCase();
}

/** Wheel / tire part — exclude brakes/hubs that only mention "tire" in a mat name. */
function isGltfWheelPartLabel(label) {
  if (/(steering.?wheel|badge|license|hubcap)/.test(label)) return false;
  // BMW GTR etc. name brake/hub mats MAT_Tire_Brake — those are not tires.
  if (
    /(brake|caliper|calip|rotor|\bdisk\b|\bdisc\b|\bhub\b)/.test(label) &&
    !/(lod_a_tyre|lod_a_wheel|m_tire|mm_tyre|mm_wheel|3dwheel|combined3dwheel)/.test(label)
  ) {
    return false;
  }
  return /(tire|tyre|mm_tyre|mm_wheel|m_tire|lod_a_tyre|lod_a_wheel|3dwheel|combined3dwheel|wheel_front|wheel_rear|\bwheel\b)/.test(
    label
  );
}

function measureObjectXZ(obj) {
  obj.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(obj);
  const size = new THREE.Vector3();
  const center = new THREE.Vector3();
  box.getSize(size);
  box.getCenter(center);
  return { box, size, center, vol: size.x * size.y * size.z };
}

/** Bundle every mesh in a corner so rim + rubber roll together. */
function bundleWheelCorner(list, name) {
  if (!list.length) return null;
  if (list.length === 1) return list[0].obj;

  const best = list.reduce((a, b) => (a.vol >= b.vol ? a : b));
  // Prefer a dedicated LOD / tyre parent of the largest piece
  let p = best.obj.parent;
  while (p) {
    const label = (p.name || "").toLowerCase();
    if (/(lod_a_tyre|lod_a_wheel|mm_tyre|mm_wheel)/.test(label)) return p;
    p = p.parent;
  }

  const parent = best.obj.parent;
  if (!parent) return best.obj;
  const bundle = new THREE.Group();
  bundle.name = name;
  parent.add(bundle);
  for (const c of list) {
    if (c.obj.parent) bundle.attach(c.obj);
  }
  return bundle;
}

function wrapWheelForSteer(wheel, name, kind, frontWheels, rearWheels) {
  if (!wheel || !wheel.parent) return;
  const parent = wheel.parent;

  wheel.updateMatrixWorld(true);
  parent.updateMatrixWorld(true);
  const hub = new THREE.Vector3();
  new THREE.Box3().setFromObject(wheel).getCenter(hub);
  parent.worldToLocal(hub);

  const pivot = new THREE.Group();
  pivot.name = `${name}-pivot`;
  parent.add(pivot);
  pivot.position.copy(hub);

  const steer = new THREE.Group();
  steer.name = `${name}-steer`;
  pivot.add(steer);

  const roller = new THREE.Group();
  roller.name = `${name}-roller`;
  roller.userData.rollAxis = detectWheelRollAxis(wheel);
  steer.add(roller);
  roller.attach(wheel);

  steer.userData.roller = roller;
  if (kind === "front") frontWheels.push(steer);
  else rearWheels.push(steer);
}

/**
 * Pick four steerable wheel assemblies (full tyre+rim groups when possible).
 * Rejects fused 4-tire blobs and brake/hub false positives.
 */
function pickFourGltfWheelMeshes(root) {
  // Pass A — named LOD tyre/wheel groups (Volvo / Corvette style)
  const lodGroups = [];
  root.traverse((obj) => {
    if (obj.isMesh || !obj.parent) return;
    const label = (obj.name || "").toLowerCase();
    if (/(steering)/.test(label)) return;
    if (!/(lod_a_tyre|lod_a_wheel)/.test(label)) return;
    const { size, center, vol } = measureObjectXZ(obj);
    if (vol < 1e-5 || isMergedTireBlob(size)) return;
    // Single wheel: roughly round in YZ and not car-wide
    if (size.x > 0.85 || size.y > 1.2 || size.z > 1.2) return;
    lodGroups.push({ obj, x: center.x, z: center.z, vol });
  });
  if (lodGroups.length >= 4) {
    return pickCornerAssemblies(lodGroups, false);
  }

  // Pass B — tire/wheel meshes (Camaro multi-piece, etc.)
  const candidates = [];
  root.traverse((obj) => {
    if (!obj.isMesh || !obj.visible) return;
    const label = gltfWheelLabel(obj);
    if (!isGltfWheelPartLabel(label)) return;

    const { size, center, vol } = measureObjectXZ(obj);
    if (vol < 1e-6 || isMergedTireBlob(size)) return;
    // Keep small rim bits so they roll with the tire (avoids static leftovers overlapping)
    if (vol < 0.00015) return;

    candidates.push({ obj, x: center.x, z: center.z, vol });
  });

  if (candidates.length === 0) return [];
  return pickCornerAssemblies(candidates, true);
}

/** One assembly per corner; optionally bundle every mesh in that corner. */
function pickCornerAssemblies(candidates, bundleParts) {
  let cx = 0;
  let cz = 0;
  for (const c of candidates) {
    cx += c.x;
    cz += c.z;
  }
  cx /= candidates.length;
  cz /= candidates.length;

  const quads = { fl: [], fr: [], rl: [], rr: [] };
  for (const c of candidates) {
    const front = c.z >= cz;
    const left = c.x <= cx;
    if (front && left) quads.fl.push(c);
    else if (front && !left) quads.fr.push(c);
    else if (!front && left) quads.rl.push(c);
    else quads.rr.push(c);
  }

  const corners = [
    ["fl", quads.fl],
    ["fr", quads.fr],
    ["rl", quads.rl],
    ["rr", quads.rr],
  ];

  const out = [];
  for (const [key, list] of corners) {
    if (!list.length) continue;
    if (bundleParts) {
      const bundled = bundleWheelCorner(list, `wheel-bundle-${key}`);
      if (bundled) out.push(bundled);
    } else {
      out.push(list.reduce((a, b) => (a.vol >= b.vol ? a : b)).obj);
    }
  }
  return out;
}

/** True if mesh is a baked tire / rim / brake that must hide when swapping wheels. */
function isBakedWheelGraphicsLabel(label) {
  if (/(steering.?wheel)/.test(label)) return false;
  return /(tire|tyre|mm_tyre|mm_wheel|m_tire|lod_a_tyre|lod_a_wheel|3dwheel|combined3dwheel|\brim\b|brake|caliper|disk_0|\bdisc\b|\bhub\b|wheel_front|wheel_rear)/.test(
    label
  );
}

/** Hide baked tire/rim meshes when we swap in steerable procedural wheels. */
function hideImportedWheelMeshes(root) {
  root.traverse((obj) => {
    if (!obj.isMesh) return;
    const label = gltfWheelLabel(obj);
    if (isBakedWheelGraphicsLabel(label)) {
      obj.visible = false;
      return;
    }
    // Unnamed Object_* children under Tire/Rim parents still Z-fight if left visible
    let p = obj.parent;
    while (p) {
      const n = (p.name || "").toLowerCase();
      if (/(steering.?wheel)/.test(n)) break;
      if (
        /(m_tire|m_rim|mm_tyre|mm_wheel|lod_a_tyre|lod_a_wheel|3dwheel|tire_high|rim_high|combined3dwheel)/.test(
          n
        )
      ) {
        obj.visible = false;
        break;
      }
      p = p.parent;
    }
  });
}

/**
 * Read the original tire "covers" (baked tire meshes / wheel wells) and return
 * exact hub positions + diameter so procedural wheels fill the same openings.
 */
function measureOriginalTireLayout(model) {
  model.updateMatrixWorld(true);
  const carBox = new THREE.Box3().setFromObject(model);
  const carSize = new THREE.Vector3();
  carBox.getSize(carSize);

  const tireMeshes = [];
  model.traverse((obj) => {
    if (!obj.isMesh || !obj.visible) return;
    const label = gltfWheelLabel(obj);
    if (!/(tire|tyre|mm_tyre|m_tire|lod_a_tyre|3dwheel|combined3dwheel)/.test(label)) return;
    if (/(steering|brake|caliper|hub|disk|disc)/.test(label) && !/(m_tire|mm_tyre|lod_a_tyre|3dwheel)/.test(label)) {
      return;
    }
    const { size, center, vol } = measureObjectXZ(obj);
    if (vol < 1e-5) return;
    tireMeshes.push({ obj, size, center, vol, merged: isMergedTireBlob(size) });
  });

  tireMeshes.sort((a, b) => b.vol - a.vol);
  const primary = tireMeshes[0] || null;

  let diameter = 0.58;
  const hubs = []; // { x, y, z, front }

  if (primary?.merged) {
    // One fused cover for all 4 tires — diameter is the cover height;
    // hubs sit inset from the cover's outer edges by half a tire.
    diameter = THREE.MathUtils.clamp(primary.size.y, 0.42, 0.72);
    const tireW = THREE.MathUtils.clamp(diameter * 0.38, 0.2, 0.3);
    const halfX = Math.max(0.45, primary.size.x * 0.5 - tireW * 0.5);
    const halfZ = Math.max(0.85, primary.size.z * 0.5 - diameter * 0.5);
    const y = primary.center.y;
    const cx = primary.center.x;
    const cz = primary.center.z;
    hubs.push(
      { x: cx - halfX, y, z: cz + halfZ, front: true },
      { x: cx + halfX, y, z: cz + halfZ, front: true },
      { x: cx - halfX, y, z: cz - halfZ, front: false },
      { x: cx + halfX, y, z: cz - halfZ, front: false }
    );
  } else {
    const singles = tireMeshes.filter((t) => !t.merged);
    if (singles.length >= 2) {
      let diaSum = 0;
      let zSum = 0;
      for (const t of singles) {
        diaSum += Math.max(t.size.y, t.size.z);
        zSum += t.center.z;
      }
      diameter = diaSum / singles.length;
      const midZ = zSum / singles.length;
      for (const t of singles) {
        hubs.push({
          x: t.center.x,
          y: t.center.y,
          z: t.center.z,
          front: t.center.z >= midZ,
        });
      }
    } else if (primary) {
      diameter = Math.max(primary.size.y, primary.size.z);
      hubs.push({
        x: primary.center.x,
        y: primary.center.y,
        z: primary.center.z,
        front: true,
      });
    }
  }

  // Fallback when the GLB has no readable tire covers
  if (hubs.length < 2) {
    diameter = 0.58;
    const track = THREE.MathUtils.clamp(carSize.x * 0.78, 1.35, 2.0);
    const wheelbase = THREE.MathUtils.clamp(carSize.z * 0.55, 2.0, 2.95);
    const y = carBox.min.y + diameter * 0.5;
    hubs.length = 0;
    hubs.push(
      { x: -track * 0.5, y, z: wheelbase * 0.5, front: true },
      { x: track * 0.5, y, z: wheelbase * 0.5, front: true },
      { x: -track * 0.5, y, z: -wheelbase * 0.5, front: false },
      { x: track * 0.5, y, z: -wheelbase * 0.5, front: false }
    );
  }

  // Match cover radius exactly (createWheel base radius = 0.44)
  const radius = diameter * 0.5;
  const scale = THREE.MathUtils.clamp(radius / 0.44, 0.48, 0.95);
  // Keep bottom of tire on the ground plane the cover sat on
  const groundY = carBox.min.y;
  for (const h of hubs) {
    h.y = groundY + radius;
  }

  return { scale, diameter, hubs };
}

/** Steerable + rolling wheels for GLBs that bake all tires into one mesh. */
function attachProceduralRoadWheels(host, model) {
  // Size / place from the original tire covers, then hide them so nothing double-draws
  const layout = measureOriginalTireLayout(model);
  hideImportedWheelMeshes(model);

  const frontWheels = [];
  const rearWheels = [];
  const midZ =
    layout.hubs.reduce((s, h) => s + h.z, 0) / Math.max(1, layout.hubs.length);
  for (const hub of layout.hubs) {
    const w = createWheel(layout.scale);
    w.position.set(hub.x, hub.y, hub.z);
    host.add(w);
    if (hub.front || hub.z >= midZ) frontWheels.push(w);
    else rearWheels.push(w);
  }
  host.userData.frontWheels = frontWheels;
  host.userData.rearWheels = rearWheels;
  host.userData.wheels = [...frontWheels, ...rearWheels];
  host.userData.proceduralWheels = true;
}

/** Wrap GLB wheel nodes: steer on Y, roll on roller (axis from mesh). */
function rigGltfCarWheels(root, userDataHost = root) {
  const frontWheels = [];
  const rearWheels = [];
  const map = [
    ["wheel-front-left", "front"],
    ["wheel-front-right", "front"],
    ["wheel-back-left", "rear"],
    ["wheel-back-right", "rear"],
    ["WheelFrontL", "front"],
    ["WheelFrontR", "front"],
    ["WheelRearL", "rear"],
    ["WheelRearR", "rear"],
    ["wheel_fl", "front"],
    ["wheel_fr", "front"],
    ["wheel_rl", "rear"],
    ["wheel_rr", "rear"],
  ];

  for (const [name, kind] of map) {
    const wheel = root.getObjectByName(name);
    wrapWheelForSteer(wheel, name, kind, frontWheels, rearWheels);
  }

  // Sketchfab / realistic GLBs — tire meshes only (avoid LOD wheel groups at car origin)
  if (!frontWheels.length && !rearWheels.length) {
    const meshes = pickFourGltfWheelMeshes(root);
    if (meshes.length >= 2) {
      root.updateMatrixWorld(true);
      let cx = 0;
      let cz = 0;
      const centers = meshes.map((obj) => {
        const box = new THREE.Box3().setFromObject(obj);
        const c = new THREE.Vector3();
        box.getCenter(c);
        cx += c.x;
        cz += c.z;
        return c;
      });
      cx /= meshes.length;
      cz /= meshes.length;

      meshes.forEach((obj, i) => {
        const c = centers[i];
        const kind = c.z >= cz ? "front" : "rear";
        wrapWheelForSteer(obj, `auto-wheel-${i}`, kind, frontWheels, rearWheels);
      });

      // Hide any tire/rim leftovers that weren't pulled into a roller (stops double-draw)
      const rigged = new Set();
      for (const steer of [...frontWheels, ...rearWheels]) {
        steer.userData.roller?.traverse((o) => rigged.add(o));
      }
      root.traverse((obj) => {
        if (!obj.isMesh || !obj.visible || rigged.has(obj)) return;
        if (isGltfWheelPartLabel(gltfWheelLabel(obj)) || isBakedWheelGraphicsLabel(gltfWheelLabel(obj))) {
          obj.visible = false;
        }
      });
    }
  }

  // Many realistic free cars bake all 4 tires into one mesh — swap in steerable wheels
  if (frontWheels.length < 2) {
    attachProceduralRoadWheels(userDataHost, root);
    return root;
  }

  userDataHost.userData.frontWheels = frontWheels;
  userDataHost.userData.rearWheels = rearWheels;
  userDataHost.userData.wheels = [...frontWheels, ...rearWheels];
  return root;
}

/**
 * Tint Kenney colormap paint while keeping headlights, glass, trim, and taillights.
 * Colormap lives at assets/cars/Textures/colormap.png (relative to each GLB).
 */
function tintGltfCarPaint(root, color, dark) {
  const paint = new THREE.Color(color);
  const accent = new THREE.Color(dark);
  root.traverse((obj) => {
    if (!obj.isMesh || !obj.material) return;
    const label = `${obj.name} ${obj.parent?.name || ""}`.toLowerCase();
    if (label.includes("wheel")) return;

    const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
    const cloned = mats.map((mat) => {
      const m = mat.clone();
      // Keep atlas map — paint is applied in-shader only on body pixels
      m.color.set(0xffffff);
      m.metalness = 0.28;
      m.roughness = 0.46;
      m.envMapIntensity = 0.85;
      m.onBeforeCompile = (shader) => {
        shader.uniforms.uPaint = { value: paint };
        shader.uniforms.uAccent = { value: accent };
        shader.fragmentShader = `
          uniform vec3 uPaint;
          uniform vec3 uAccent;
        ` + shader.fragmentShader.replace(
          "#include <map_fragment>",
          `#include <map_fragment>
          {
            vec3 tex = diffuseColor.rgb;
            float lum = dot(tex, vec3(0.299, 0.587, 0.114));
            float blueBias = tex.b - max(tex.r, tex.g);
            float redBias = tex.r - max(tex.g, tex.b);
            float warmBias = max(tex.r, tex.g) - tex.b;
            // Preserve glass (blue), headlights (warm/bright), tails (red), dark trim
            float glassK = smoothstep(0.04, 0.16, blueBias);
            float lightK = smoothstep(0.55, 0.88, lum) * smoothstep(0.02, 0.14, warmBias);
            float tailK = smoothstep(0.12, 0.32, redBias);
            float trimK = 1.0 - smoothstep(0.05, 0.28, lum);
            float keep = clamp(max(max(glassK, lightK), max(tailK, trimK)), 0.0, 1.0);
            // Near-white / light-gray atlas pixels = body paint
            float bodyMask = smoothstep(0.45, 0.92, lum) * (1.0 - keep);
            vec3 painted = mix(tex * uAccent, uPaint * max(lum, 0.35), 0.92);
            diffuseColor.rgb = mix(tex, painted, bodyMask);
          }`
        );
      };
      m.customProgramCacheKey = () => `kenneyPaintTint_${paint.getHexString()}`;
      m.needsUpdate = true;
      return m;
    });
    obj.material = Array.isArray(obj.material) ? cloned : cloned[0];
  });
}

/** Recolor / upgrade paint on realistic GLBs with clearcoat. */
function paintRealisticCar(root, color, dark, { worn = false } = {}) {
  const paint = new THREE.Color(color);
  const accent = new THREE.Color(dark);

  root.traverse((obj) => {
    if (!obj.isMesh || !obj.material) return;
    const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
    const next = mats.map((mat) => {
      const matName = (mat.name || "").toLowerCase();
      const meshName = (obj.name || "").toLowerCase();
      const label = `${meshName} ${matName}`;

      const isGlass =
        matName.includes("glass") ||
        matName.includes("window") ||
        /window|windshield|projector|mm_windows/.test(label);
      const isLight =
        /headlight|brakelight|signallight|taillight|lights_red|turn_signal|leds|interior_light|head_light|tail_light|reverse_light|lihgt_r|light_r|\blights\b|mm_lights|redlight|red_glass|orange_glass/.test(
          label
        );
      const isPaint =
        matName.includes("paint") ||
        matName.includes("carpaint") ||
        matName === "body_color" ||
        matName.includes("ferrari_yellow") ||
        /^body(\.|$)/.test(matName) ||
        /mm_ext|meshesbody|global_texture_coloured/.test(matName) ||
        /bodypanels|bodydoor|bodyhood|bodyroof|bodyrear|panelscolor|door[lr]color|hood(?!interior)|base_geo/.test(
          meshName
        );
      const isAccent =
        /paint 2|yellow_trim|\bblue\b/.test(label) ||
        meshName.includes("yellow_trim");
      const isSkip =
        /tire|tyre|tread|brake|disc|disk|rim|calip|interior|leather|carpet|floor|dash|steering|mechanical|hardware|license|mirror|carbon|chrome|metal_gray|plastic|grill|grille|wiper|engine|seat|pedal|nut|centre|center|badge|chassis|chasssis|undercarriage|rotor|internal|cloth|rubber|gauge/.test(
          label
        ) && !isPaint;

      if (isGlass) {
        const m = mat.clone();
        m.transparent = true;
        m.opacity = Math.min(m.opacity ?? 0.5, 0.5);
        m.roughness = 0.04;
        m.metalness = 0.05;
        m.envMapIntensity = 1.6;
        if ("transmission" in m) m.transmission = 0.65;
        m.needsUpdate = true;
        return m;
      }

      if (isLight) {
        const m = mat.clone();
        if (!m.emissive) m.emissive = new THREE.Color(0x000000);
        if (/brake|tail|lights_red/.test(label)) {
          m.emissive.setHex(0xff1a1a);
          m.emissiveIntensity = 1.4;
        } else if (/signal|turn|amber|yellow/.test(label)) {
          m.emissive.setHex(0xff8800);
          m.emissiveIntensity = 1.1;
        } else {
          m.emissive.setHex(0xddeeff);
          m.emissiveIntensity = 1.25;
        }
        m.needsUpdate = true;
        return m;
      }

      if (isPaint || isAccent) {
        const col = isAccent ? accent : paint;
        const m = new THREE.MeshPhysicalMaterial({
          color: col.clone(),
          metalness: worn ? 0.35 : 0.78,
          roughness: worn ? 0.48 : 0.18,
          clearcoat: worn ? 0.2 : 1.0,
          clearcoatRoughness: worn ? 0.4 : 0.06,
          envMapIntensity: worn ? 0.7 : 1.45,
          reflectivity: 0.9,
        });
        if (mat.normalMap) m.normalMap = mat.normalMap;
        if (mat.roughnessMap) m.roughnessMap = mat.roughnessMap;
        if (mat.metalnessMap) m.metalnessMap = mat.metalnessMap;
        m.needsUpdate = true;
        return m;
      }

      if (isSkip) {
        const m = mat.clone();
        m.envMapIntensity = Math.max(m.envMapIntensity || 0.6, 0.85);
        return m;
      }

      // Default: slight polish
      const m = mat.clone();
      m.envMapIntensity = Math.max(m.envMapIntensity || 0.5, 1.0);
      if (m.roughness != null) m.roughness = Math.min(m.roughness, 0.55);
      return m;
    });

    obj.material = Array.isArray(obj.material) ? next : next[0];
  });
}

/** Extra 3D details on Kenney bodies: lights, glass panes, handles, panel lines. */
function attachKenneyCarDetails(model, body = "sedan") {
  const sporty = body === "sports" || body === "gt" || body === "coupe" || body === "muscle";
  const details = new THREE.Group();
  details.name = "car-details";

  const chrome = new THREE.MeshStandardMaterial({
    color: 0xd8dde4, metalness: 0.85, roughness: 0.22, envMapIntensity: 1.0,
  });
  const lineMat = new THREE.MeshStandardMaterial({ color: 0x101218, roughness: 0.9, metalness: 0.1 });
  const headMat = new THREE.MeshStandardMaterial({
    color: 0xeaf4ff, emissive: 0x9ec8ff, emissiveIntensity: 1.6, metalness: 0.3, roughness: 0.15,
  });
  const amberMat = new THREE.MeshStandardMaterial({
    color: 0xffb018, emissive: 0xff7a00, emissiveIntensity: 1.35, metalness: 0.2, roughness: 0.25,
  });
  const tailMat = new THREE.MeshStandardMaterial({
    color: 0xff1a1a, emissive: 0xff0000, emissiveIntensity: 1.4, metalness: 0.25, roughness: 0.22,
  });
  const windMat = new THREE.MeshStandardMaterial({
    color: 0x5aa0d0, metalness: 0.2, roughness: 0.08,
    transparent: true, opacity: 0.42, depthWrite: false, envMapIntensity: 1.1,
  });
  const sideMat = new THREE.MeshStandardMaterial({
    color: 0x2a5a88, metalness: 0.22, roughness: 0.1,
    transparent: true, opacity: 0.48, depthWrite: false, envMapIntensity: 1.0,
  });
  const rearMat = new THREE.MeshStandardMaterial({
    color: 0x3a2a68, metalness: 0.2, roughness: 0.12,
    transparent: true, opacity: 0.5, depthWrite: false,
  });

  const add = (mesh, x, y, z, rx = 0, ry = 0, rz = 0) => {
    mesh.position.set(x, y, z);
    mesh.rotation.set(rx, ry, rz);
    mesh.castShadow = true;
    details.add(mesh);
    return mesh;
  };

  // Front headlights + amber indicators
  for (const sx of [-1, 1]) {
    const lamp = new THREE.Mesh(
      new THREE.BoxGeometry(sporty ? 0.28 : 0.22, sporty ? 0.08 : 0.11, 0.06),
      headMat
    );
    add(lamp, sx * 0.32, 0.38, 1.05);
    const signal = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.06, 0.05), amberMat);
    add(signal, sx * 0.48, 0.36, 1.0);
  }

  // Taillights
  for (const sx of [-1, 1]) {
    const tl = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.09, 0.05), tailMat);
    add(tl, sx * 0.3, 0.4, -1.05);
  }

  // Glass panes with distinct tints (skipped on Street Muscle / Phantom GT)
  if (body !== "muscle" && body !== "gt") {
    const wind = new THREE.Mesh(new THREE.BoxGeometry(0.72, 0.28, 0.04), windMat);
    add(wind, 0, 0.72, sporty ? 0.28 : 0.35, -0.55, 0, 0);
    const rear = new THREE.Mesh(new THREE.BoxGeometry(0.68, 0.24, 0.04), rearMat);
    add(rear, 0, 0.7, sporty ? -0.55 : -0.45, 0.4, 0, 0);
    for (const sx of [-1, 1]) {
      const pane = new THREE.Mesh(
        new THREE.BoxGeometry(0.03, sporty ? 0.2 : 0.26, sporty ? 0.55 : 0.7),
        sideMat
      );
      add(pane, sx * 0.52, 0.68, sporty ? -0.12 : -0.05);
    }
  }

  // Door handles
  for (const sx of [-1, 1]) {
    const handle = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.035, 0.12), chrome);
    add(handle, sx * 0.55, 0.55, 0.08);
  }

  // Body / door panel lines (skipped on Street Muscle / Phantom GT)
  if (body !== "muscle" && body !== "gt") {
    for (const sx of [-1, 1]) {
      const belt = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.025, 1.35), lineMat);
      add(belt, sx * 0.54, 0.5, -0.05);
      const seam = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.32, 0.02), lineMat);
      add(seam, sx * 0.545, 0.52, -0.02);
      const rocker = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.02, 1.2), lineMat);
      add(rocker, sx * 0.53, 0.28, -0.05);
    }
    const hoodLine = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.015, 0.7), lineMat);
    add(hoodLine, 0, 0.48, 0.55, sporty ? 0.12 : 0.06, 0, 0);
  }

  model.add(details);
  return details;
}

function drawGuideArrowTexture() {
  const c = document.createElement("canvas");
  c.width = 256;
  c.height = 256;
  const g = c.getContext("2d");
  g.clearRect(0, 0, 256, 256);
  // Soft glow
  g.fillStyle = "rgba(61, 255, 138, 0.22)";
  g.beginPath();
  g.arc(128, 128, 110, 0, Math.PI * 2);
  g.fill();
  // Arrow pointing UP (screen-forward once sprite faces camera)
  g.beginPath();
  g.moveTo(128, 28);
  g.lineTo(198, 118);
  g.lineTo(158, 118);
  g.lineTo(158, 220);
  g.lineTo(98, 220);
  g.lineTo(98, 118);
  g.lineTo(58, 118);
  g.closePath();
  g.fillStyle = "#3dff8a";
  g.fill();
  g.lineWidth = 8;
  g.strokeStyle = "#b8ffd4";
  g.stroke();
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

let _guideArrowTex = null;
function getGuideArrowTexture() {
  if (!_guideArrowTex) _guideArrowTex = drawGuideArrowTexture();
  return _guideArrowTex;
}

function attachCarGuide(g, withGuide = true) {
  if (!withGuide) {
    g.userData.guide = null;
    g.userData.guideMats = [];
    return;
  }
  // Camera-facing sprite — always readable from the chase cam
  const mat = new THREE.SpriteMaterial({
    map: getGuideArrowTexture(),
    transparent: true,
    depthTest: false,
    depthWrite: false,
    sizeAttenuation: true,
  });
  const guide = new THREE.Sprite(mat);
  guide.scale.set(1.35, 1.35, 1);
  guide.position.set(0, 3.2, 0);
  guide.center.set(0.5, 0.4);
  guide.renderOrder = 12;
  guide.userData.isGuide = true;
  g.add(guide);
  g.userData.guide = guide;
  g.userData.guideMats = [mat];
}

function disposePlayerGuide(player) {
  const guide = player?.mesh?.userData?.guide;
  if (!guide) return;
  if (guide.parent) guide.parent.remove(guide);
  const mats = player.mesh.userData.guideMats || [];
  for (const m of mats) {
    // Shared texture lives on getGuideArrowTexture() — only dispose the material
    m.dispose?.();
  }
  player.mesh.userData.guide = null;
  player.mesh.userData.guideMats = [];
}

/** Player / garage cars — realistic GLBs preferred, then Kenney. */
function createCatalogCarMesh(color, dark, body = "sedan", { withGuide = true, castShadow = true } = {}) {
  const template = carModelCache.get(body) || carModelCache.get("sedan");
  if (!template) {
    const sporty = body === "sports" || body === "gt" || body === "coupe" || body === "muscle";
    return createCarMesh(color, dark, { body, sporty, tank: false, withGuide });
  }

  const meta = carModelMeta.get(body) || carModelMeta.get("sedan") || {
    kenney: true,
    realistic: false,
    worn: false,
  };
  const g = new THREE.Group();
  const model = template.clone(true);

  if (meta.realistic || !meta.kenney) {
    g.add(model);
    paintRealisticCar(model, color, dark, { worn: !!meta.worn });
  } else {
    model.scale.setScalar(1.9);
    g.add(model);
    tintGltfCarPaint(model, color, dark);
    attachKenneyCarDetails(model, body);
  }

  // Lower profile without changing width/length (before wheel rig so hubs stay aligned)
  squashCarHeight(model, CAR_HEIGHT_SCALE);
  rigGltfCarWheels(model, g);

  attachCarGuide(g, withGuide);
  g.userData.body = body;
  g.userData.realistic = !!meta.realistic;

  g.traverse((obj) => {
    if (!obj.isMesh) return;
    const isGuide = !!obj.userData?.isGuide;
    obj.castShadow = castShadow && !isGuide;
    obj.receiveShadow = true;
  });
  return g;
}

function spawnTrafficCar(avoidPlayers = true) {
  const type = TRAFFIC_TYPES[(Math.random() * TRAFFIC_TYPES.length) | 0];
  const isTruck = type.body === "boxtruck" || type.body === "dump" || type.body === "flatbed";
  const spawnGap2 = (isTruck ? 16 : 10) ** 2;
  const playerGap2 = 28 * 28;
  let edge = edges[(Math.random() * edges.length) | 0];
  let t = 0.18 + Math.random() * 0.64;
  let from = edge.a;
  let to = edge.b;
  if (Math.random() < 0.5) {
    from = edge.b;
    to = edge.a;
  }

  // Prefer a clear stretch away from players / other traffic
  // Trucks stick to wider streets (no alleys). Cap attempts so dense spawn stays cheap.
  for (let attempt = 0; attempt < 6; attempt++) {
    edge = edges[(Math.random() * edges.length) | 0];
    if (isTruck && edge.type === "alley") continue;
    t = 0.18 + Math.random() * 0.64;
    from = Math.random() < 0.5 ? edge.a : edge.b;
    to = from === edge.a ? edge.b : edge.a;
    const x = from.x + (to.x - from.x) * t;
    const z = from.z + (to.z - from.z) * t;
    let clear = true;
    if (avoidPlayers) {
      for (const p of players) {
        const dx = p.x - x;
        const dz = p.z - z;
        if (dx * dx + dz * dz < playerGap2) {
          clear = false;
          break;
        }
      }
    }
    if (!clear) continue;
    // Only sample recent cars — full O(n) over 250+ traffic hitch-spawns
    const start = Math.max(0, traffic.length - 48);
    for (let oi = start; oi < traffic.length; oi++) {
      const other = traffic[oi];
      const dx = other.x - x;
      const dz = other.z - z;
      if (dx * dx + dz * dz < spawnGap2) {
        clear = false;
        break;
      }
    }
    if (clear) break;
  }

  const lane = trafficLaneOffset(edge);
  const off = trafficRightOffset(from, to, lane);
  const x = from.x + (to.x - from.x) * t + off.x;
  const z = from.z + (to.z - from.z) * t + off.z;
  const angle = Math.atan2(to.x - from.x, to.z - from.z);
  const mesh = createTrafficMesh(type);
  mesh.position.set(x, 0, z);
  mesh.rotation.y = angle;
  scene.add(mesh);

  const roadSlow = edge.type === "alley" ? 0.72 : edge.type === "bridge" ? 0.9 : 1;
  traffic.push({
    mesh,
    typeId: type.id,
    hitR: type.hitR || 2.65,
    x,
    z,
    angle,
    speed: type.maxSpeed * roadSlow * (0.55 + Math.random() * 0.35),
    maxSpeed: type.maxSpeed * roadSlow,
    accel: type.accel,
    turn: type.turn,
    slideX: 0,
    slideZ: 0,
    spin: 0,
    hitCd: 0,
    recover: 0,
    from,
    to,
    edge,
    lane,
  });
}

function clearTraffic() {
  traffic.forEach((t) => scene.remove(t.mesh));
  traffic.length = 0;
}

/** Cars left to spawn across frames — avoids freezing when starting a run. */
let trafficSpawnRemaining = 0;

function initTraffic() {
  clearTraffic();
  trafficSpawnRemaining = TRAFFIC_COUNT;
}

function processTrafficSpawnQueue() {
  if (trafficSpawnRemaining <= 0) return;
  const batch = Math.min(TRAFFIC_SPAWN_BATCH, trafficSpawnRemaining);
  for (let i = 0; i < batch; i++) spawnTrafficCar(false);
  trafficSpawnRemaining -= batch;
}

function setTrafficRoute(car, from, choice) {
  car.from = from;
  car.to = choice.node;
  car.edge = choice.edge;
  car.lane = trafficLaneOffset(choice.edge);
  const roadSlow = choice.edge.type === "alley" ? 0.72 : choice.edge.type === "bridge" ? 0.9 : 1;
  const base = TRAFFIC_TYPES.find((t) => t.id === car.typeId) || TRAFFIC_TYPES[0];
  car.maxSpeed = base.maxSpeed * roadSlow;
  car.accel = base.accel;
  car.turn = base.turn;
}

function nearestPlayerDist2(x, z) {
  let best = Infinity;
  for (const p of players) {
    const dx = p.x - x;
    const dz = p.z - z;
    const d2 = dx * dx + dz * dz;
    if (d2 < best) best = d2;
  }
  return best;
}

function updateTrafficCar(car, dt, nearPlayers) {
  if (car.hitCd > 0) car.hitCd -= dt;
  if (car.recover > 0) car.recover -= dt;

  car.angle += (car.spin || 0) * dt;
  car.spin *= Math.pow(0.08, dt);
  car.slideX = (car.slideX || 0) * Math.pow(0.12, dt);
  car.slideZ = (car.slideZ || 0) * Math.pow(0.12, dt);

  const off = trafficRightOffset(car.from, car.to, car.lane);
  const aimX = car.to.x + off.x;
  const aimZ = car.to.z + off.z;
  const distToNode = Math.hypot(aimX - car.x, aimZ - car.z);

  // Approach intersection → pick next street (trucks prefer wider roads)
  if (distToNode < 7.5) {
    let choice = pickTrafficNext(car.from, car.to);
    if (choice && (car.hitR || 2.65) > 3 && choice.edge.type === "alley") {
      const retry = pickTrafficNext(car.from, car.to);
      if (retry && retry.edge.type !== "alley") choice = retry;
    }
    if (choice) setTrafficRoute(car, car.to, choice);
  }

  const desired = Math.atan2(aimX - car.x, aimZ - car.z);
  let diff = desired - car.angle;
  while (diff > Math.PI) diff -= Math.PI * 2;
  while (diff < -Math.PI) diff += Math.PI * 2;
  const control = car.recover > 0 ? 0.35 : 1 / (1 + Math.abs(car.spin) * 0.4);
  car.angle += Math.max(-car.turn, Math.min(car.turn, diff * 2.8)) * dt * control;

  // Cruise speed — ease off into sharp turns / intersections
  const align = 1 - Math.min(1, Math.abs(diff) / Math.PI);
  let targetSpeed = car.maxSpeed * (0.55 + align * 0.45);
  if (distToNode < 16) targetSpeed *= 0.55 + distToNode / 35;

  // Yield only when near players (far cars skip O(n²) follow checks)
  if (nearPlayers) {
    const followDist = (car.hitR || 2.65) + 8.5;
    const followDist2 = (followDist + 2) * (followDist + 2);
    // Sparse sample of traffic — full 3× fleet scan would hitch
    const step = traffic.length > 120 ? 3 : 1;
    const start = (trafficFrame + (car._idx || 0)) % step;
    for (let oi = start; oi < traffic.length; oi += step) {
      const other = traffic[oi];
      if (other === car) continue;
      if (other.mesh && !other.mesh.visible) continue;
      const dx = other.x - car.x;
      const dz = other.z - car.z;
      const d2 = dx * dx + dz * dz;
      if (d2 > followDist2 || d2 < 0.0025) continue;
      const ahead = Math.sin(car.angle) * dx + Math.cos(car.angle) * dz;
      if (ahead > 0.5 && ahead < followDist) {
        targetSpeed = Math.min(targetSpeed, Math.max(6, other.speed * 0.82));
      }
    }

    for (const p of players) {
      const dx = p.x - car.x;
      const dz = p.z - car.z;
      const d2 = dx * dx + dz * dz;
      if (d2 > 324 || d2 < 0.0025) continue;
      const d = Math.sqrt(d2);
      const ahead = Math.sin(car.angle) * dx + Math.cos(car.angle) * dz;
      if (ahead > 0 && ahead < 14) targetSpeed = Math.min(targetSpeed, 8 + d * 0.4);
    }
  }

  if (car.recover > 0) {
    car.speed *= Math.pow(0.55, dt);
  } else if (car.speed < targetSpeed) {
    car.speed = Math.min(targetSpeed, car.speed + car.accel * dt);
  } else {
    car.speed = Math.max(targetSpeed, car.speed - car.accel * 1.4 * dt);
  }

  car.x += (Math.sin(car.angle) * car.speed + (car.slideX || 0)) * dt;
  car.z += (Math.cos(car.angle) * car.speed + (car.slideZ || 0)) * dt;

  // Nudge back toward the lane center if drift pulls them off
  const laneOff = trafficRightOffset(car.from, car.to, car.lane);
  const fx = car.to.x - car.from.x;
  const fz = car.to.z - car.from.z;
  const len2 = fx * fx + fz * fz || 1;
  let tt = ((car.x - laneOff.x - car.from.x) * fx + (car.z - laneOff.z - car.from.z) * fz) / len2;
  tt = tt < 0 ? 0 : tt > 1 ? 1 : tt;
  const lx = car.from.x + fx * tt + laneOff.x;
  const lz = car.from.z + fz * tt + laneOff.z;
  if (car.recover <= 0) {
    car.x += (lx - car.x) * Math.min(1, 2.2 * dt);
    car.z += (lz - car.z) * Math.min(1, 2.2 * dt);
  }

  if (nearPlayers) resolveWorldCollisions(car, dt);

  car.mesh.position.set(car.x, 0, car.z);
  car.mesh.rotation.y = car.angle;
  car.mesh.rotation.z = THREE.MathUtils.clamp((car.spin || 0) * 0.05, -0.25, 0.25);

  if (nearPlayers) {
    const front = car.mesh.userData.frontWheels || [];
    const rear = car.mesh.userData.rearWheels || [];
    const steerVis = THREE.MathUtils.clamp(diff, -MAX_STEER, MAX_STEER);
    for (const w of front) {
      w.rotation.y = steerVis * 0.85;
      spinWheelRoller(w.userData.roller, car.speed * dt * 1.9);
    }
    for (const w of rear) {
      spinWheelRoller(w.userData.roller, car.speed * dt * 1.9);
    }

    // Collide with players — bump + damage, traffic spins out briefly
    const hitR = car.hitR || 2.65;
    for (const p of players) {
      if (p.invuln > 0) continue;
      const d = Math.hypot(p.x - car.x, p.z - car.z);
      if (d < hitR && d > 0.01) {
        const nx = (p.x - car.x) / d;
        const nz = (p.z - car.z) / d;
        const pen = hitR - d;
        const truckHit = hitR > 3;
        applyCarImpact(p, nx, nz, pen * (truckHit ? 0.65 : 0.5), truckHit ? 0.55 : 0.42, truckHit ? 0.32 : 0.22, car);
        car.speed *= truckHit ? 0.55 : 0.35;
        car.recover = Math.max(car.recover, truckHit ? 0.55 : 0.85);
        car.spin = (car.spin || 0) + (Math.random() - 0.5) * (truckHit ? 2.2 : 4);
      }
    }

    // Light bump vs nearby cops only
    const copHitR = Math.max(2.6, hitR * 0.92);
    const copHitR2 = (copHitR + 8) * (copHitR + 8);
    for (const c of cops) {
      const dx = c.x - car.x;
      const dz = c.z - car.z;
      const d2 = dx * dx + dz * dz;
      if (d2 > copHitR2 || d2 < 0.0001) continue;
      const d = Math.sqrt(d2);
      if (d >= copHitR) continue;
      const nx = dx / d;
      const nz = dz / d;
      const pen = copHitR - d;
      car.x += nx * pen * 0.6;
      car.z += nz * pen * 0.6;
      c.x -= nx * pen * 0.4;
      c.z -= nz * pen * 0.4;
      car.speed *= 0.7;
      c.speed *= 0.85;
    }
  }
}

let trafficFrame = 0;
let trafficCursor = 0;
function updateTraffic(dt) {
  trafficFrame++;
  trafficBudget.begin(TRAFFIC_FRAME_BUDGET_MS);
  const n = traffic.length;
  if (!n) return;

  // Round-robin so budget cuts never starve the same cars every frame
  let processed = 0;
  let i = trafficCursor % n;
  while (processed < n) {
    const car = traffic[i];
    car._idx = i;
    const d2 = nearestPlayerDist2(car.x, car.z);
    const near = d2 <= TRAFFIC_ACTIVE_DIST2;
    if (car.mesh) car.mesh.visible = d2 <= TRAFFIC_HIDE_DIST2;
    // Far cars: cheap cruise on a stride so dense traffic doesn't stall the loop
    if (near || ((i + trafficFrame) % TRAFFIC_FAR_STRIDE) === 0) {
      updateTrafficCar(car, near ? dt : dt * TRAFFIC_FAR_STRIDE, near);
    }
    processed++;
    i = (i + 1) % n;
    if (trafficBudget.exceeded()) {
      trafficCursor = i;
      return;
    }
  }
  trafficCursor = 0;
}

function spawnRoadblock(near) {
  const n = nearestNode(near.x, near.z);
  // pick a neighboring edge
  const neighbors = [];
  for (const e of edges) {
    if (e.a === n) neighbors.push(e.b);
    if (e.b === n) neighbors.push(e.a);
  }
  if (!neighbors.length) return;
  const dest = neighbors[(Math.random() * neighbors.length) | 0];
  const t = 0.45 + Math.random() * 0.1;
  const x = n.x + (dest.x - n.x) * t;
  const z = n.z + (dest.z - n.z) * t;
  const ang = Math.atan2(dest.x - n.x, dest.z - n.z) + Math.PI / 2;
  const group = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color: 0xcc2200 });
  const white = new THREE.MeshStandardMaterial({ color: 0xf0f0f0 });
  for (let i = -2; i <= 2; i++) {
    const barrier = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.9, 0.45), i % 2 ? mat : white);
    barrier.position.set(i * 2.0, 0.45, 0);
    barrier.castShadow = true;
    group.add(barrier);
  }
  group.position.set(x, 0, z);
  group.rotation.y = ang;
  world.add(group);
  roadblocks.push({ x, z, mesh: group, life: 45 });
}

// ——— Audio (procedural Web Audio — engine, siren, crashes) ———
let audioCtx = null;
let masterGain = null;
let engineNodes = null; // idle + drive loops
let sirenNodes = null;
let audioReady = false;

function ensureAudio() {
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    masterGain = audioCtx.createGain();
    masterGain.gain.value = 0.85;
    masterGain.connect(audioCtx.destination);
  }
  if (audioCtx.state === "suspended") audioCtx.resume();
  if (!audioReady) {
    initEngineLoop();
    initSirenLoop();
    audioReady = true;
  }
}

function beep(freq, dur, type = "square", gain = 0.04) {
  if (!audioCtx || !masterGain) return;
  const o = audioCtx.createOscillator();
  const g = audioCtx.createGain();
  o.type = type;
  o.frequency.value = freq;
  g.gain.value = gain;
  o.connect(g);
  g.connect(masterGain);
  o.start();
  g.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + dur);
  o.stop(audioCtx.currentTime + dur);
}

/** White-noise buffer reused for exhaust / crashes / siren texture. */
let noiseBuffer = null;
function getNoiseBuffer() {
  if (noiseBuffer) return noiseBuffer;
  const len = audioCtx.sampleRate * 1.5;
  noiseBuffer = audioCtx.createBuffer(1, len, audioCtx.sampleRate);
  const data = noiseBuffer.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
  return noiseBuffer;
}

function createNoiseSource(loop = true) {
  const src = audioCtx.createBufferSource();
  src.buffer = getNoiseBuffer();
  src.loop = loop;
  return src;
}

function initEngineLoop() {
  if (engineNodes || !audioCtx) return;
  const out = audioCtx.createGain();
  out.gain.value = 0;
  out.connect(masterGain);

  // Low rumble (idle / cylinders)
  const rumble = audioCtx.createOscillator();
  rumble.type = "sawtooth";
  rumble.frequency.value = 55;
  const rumbleGain = audioCtx.createGain();
  rumbleGain.gain.value = 0.22;
  const rumbleFilter = audioCtx.createBiquadFilter();
  rumbleFilter.type = "lowpass";
  rumbleFilter.frequency.value = 280;
  rumble.connect(rumbleFilter);
  rumbleFilter.connect(rumbleGain);
  rumbleGain.connect(out);

  // Higher harmonic for motor bite
  const bite = audioCtx.createOscillator();
  bite.type = "triangle";
  bite.frequency.value = 110;
  const biteGain = audioCtx.createGain();
  biteGain.gain.value = 0.1;
  bite.connect(biteGain);
  biteGain.connect(out);

  // Exhaust hiss (filtered noise)
  const exhaust = createNoiseSource(true);
  const exhaustFilter = audioCtx.createBiquadFilter();
  exhaustFilter.type = "bandpass";
  exhaustFilter.frequency.value = 420;
  exhaustFilter.Q.value = 0.7;
  const exhaustGain = audioCtx.createGain();
  exhaustGain.gain.value = 0.035;
  exhaust.connect(exhaustFilter);
  exhaustFilter.connect(exhaustGain);
  exhaustGain.connect(out);

  rumble.start();
  bite.start();
  exhaust.start();

  engineNodes = { out, rumble, bite, rumbleGain, biteGain, exhaustGain, exhaustFilter };
}

function initSirenLoop() {
  if (sirenNodes || !audioCtx) return;
  const out = audioCtx.createGain();
  out.gain.value = 0;
  out.connect(masterGain);

  const osc = audioCtx.createOscillator();
  osc.type = "sawtooth";
  osc.frequency.value = 700;
  const filter = audioCtx.createBiquadFilter();
  filter.type = "bandpass";
  filter.frequency.value = 900;
  filter.Q.value = 4;
  const toneGain = audioCtx.createGain();
  toneGain.gain.value = 0.16;
  osc.connect(filter);
  filter.connect(toneGain);
  toneGain.connect(out);

  // Soft noise edge so it doesn't sound too pure
  const hiss = createNoiseSource(true);
  const hissFilter = audioCtx.createBiquadFilter();
  hissFilter.type = "highpass";
  hissFilter.frequency.value = 1200;
  const hissGain = audioCtx.createGain();
  hissGain.gain.value = 0.012;
  hiss.connect(hissFilter);
  hissFilter.connect(hissGain);
  hissGain.connect(out);

  osc.start();
  hiss.start();

  sirenNodes = { out, osc, filter, t: 0 };
}

/** Pitch + volume follow the fastest player car. */
function updateEngineSound(dt) {
  if (!engineNodes || !audioCtx) return;
  const playing = state === "playing";
  let speed = 0;
  let boosting = false;
  if (playing && players.length) {
    for (const p of players) {
      const s = Math.abs(p.speed || 0) + Math.hypot(p.slideX || 0, p.slideZ || 0) * 0.35;
      if (s > speed) speed = s;
      if (p.boostT > 0) boosting = true;
    }
  }
  const n = Math.min(1, speed / 70);
  const idle = playing ? 0.045 : 0;
  const targetVol = playing ? idle + n * 0.2 + (boosting ? 0.04 : 0) : 0;
  const now = audioCtx.currentTime;
  engineNodes.out.gain.setTargetAtTime(targetVol, now, 0.08);

  const rpm = 48 + n * 160 + (boosting ? 35 : 0);
  engineNodes.rumble.frequency.setTargetAtTime(rpm, now, 0.06);
  engineNodes.bite.frequency.setTargetAtTime(rpm * 2.05, now, 0.06);
  engineNodes.exhaustFilter.frequency.setTargetAtTime(380 + n * 520, now, 0.1);
  engineNodes.exhaustGain.gain.setTargetAtTime(0.02 + n * 0.06, now, 0.1);
  engineNodes.biteGain.gain.setTargetAtTime(0.05 + n * 0.12, now, 0.1);
}

/** Wailing siren when cops are near a wanted getaway; louder when closer. */
function updateSirenSound(dt) {
  if (!sirenNodes || !audioCtx) return;
  const now = audioCtx.currentTime;
  let vol = 0;
  if (state === "playing" && cops.length && players.length) {
    let nearest = Infinity;
    let chasing = false;
    for (const p of players) {
      if (!p.carrying && p.heat <= 0) continue;
      chasing = true;
      for (const c of cops) {
        const d = Math.hypot(c.x - p.x, c.z - p.z);
        if (d < nearest) nearest = d;
      }
    }
    if (chasing && nearest < 160) {
      // Full volume under ~35m, fades out by 160m
      vol = THREE.MathUtils.clamp(1.15 - nearest / 140, 0, 0.28);
    }
  }
  sirenNodes.out.gain.setTargetAtTime(vol, now, 0.12);

  if (vol > 0.002) {
    sirenNodes.t += dt;
    // Classic police wail: slow sine sweep between two tones
    const wail = 0.5 + 0.5 * Math.sin(sirenNodes.t * 2.4);
    const freq = 620 + wail * 480;
    sirenNodes.osc.frequency.setTargetAtTime(freq, now, 0.04);
    sirenNodes.filter.frequency.setTargetAtTime(freq * 1.15, now, 0.05);
  }
}

/** Metallic thud + noise burst when slamming into something. */
function playCrashSound(impact) {
  if (!audioCtx || !masterGain) return;
  ensureAudio();
  const now = audioCtx.currentTime;
  const power = THREE.MathUtils.clamp(impact / 40, 0.15, 1);

  // Low body thud
  const thud = audioCtx.createOscillator();
  const thudGain = audioCtx.createGain();
  thud.type = "sine";
  thud.frequency.setValueAtTime(90 + power * 40, now);
  thud.frequency.exponentialRampToValueAtTime(40, now + 0.18);
  thudGain.gain.setValueAtTime(0.22 * power, now);
  thudGain.gain.exponentialRampToValueAtTime(0.001, now + 0.22);
  thud.connect(thudGain);
  thudGain.connect(masterGain);
  thud.start(now);
  thud.stop(now + 0.25);

  // Mid metallic crunch
  const metal = audioCtx.createOscillator();
  const metalGain = audioCtx.createGain();
  metal.type = "sawtooth";
  metal.frequency.setValueAtTime(180 + power * 220, now);
  metal.frequency.exponentialRampToValueAtTime(70, now + 0.12);
  metalGain.gain.setValueAtTime(0.1 * power, now);
  metalGain.gain.exponentialRampToValueAtTime(0.001, now + 0.14);
  metal.connect(metalGain);
  metalGain.connect(masterGain);
  metal.start(now);
  metal.stop(now + 0.16);

  // Short noise burst (glass / scrape)
  const noise = createNoiseSource(false);
  const nFilter = audioCtx.createBiquadFilter();
  nFilter.type = "bandpass";
  nFilter.frequency.value = 900 + power * 1400;
  nFilter.Q.value = 0.8;
  const nGain = audioCtx.createGain();
  nGain.gain.setValueAtTime(0.18 * power, now);
  nGain.gain.exponentialRampToValueAtTime(0.001, now + 0.16);
  noise.connect(nFilter);
  nFilter.connect(nGain);
  nGain.connect(masterGain);
  noise.start(now);
  noise.stop(now + 0.18);
}

function updateGameAudio(dt) {
  if (!audioReady || !audioCtx) return;
  if (audioCtx.state === "suspended") return;
  updateEngineSound(dt);
  updateSirenSound(dt);
}

// ——— Garage showroom ———
let garageIndex = 0;
let garagePreview = null; // { renderer, scene, camera, turntable, carRoot, lightsPulse, raf, lastTs }
let garageReturnState = "menu";

function garageCarPaint(car) {
  const paint = {
    scrap: [0xff2d4a, 0xa01228],
    cruiser: [0xff5a3c, 0xb8321a],
    night: [0x3a5cff, 0x1a2a8a],
    muscle: [0xff9a1a, 0xc45a00],
    turbo: [0x3dff8a, 0x1a8a45],
    phantom: [0xff2d8a, 0xb0105a],
  };
  return paint[car.id] || [0xff2d4a, 0xa01228];
}

function ensureGaragePreview() {
  if (garagePreview || !garageCanvas) return garagePreview;

  const renderer = new THREE.WebGLRenderer({
    canvas: garageCanvas,
    antialias: true,
    alpha: true,
    powerPreference: "high-performance",
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.55;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const gScene = new THREE.Scene();
  gScene.background = new THREE.Color(0xd8eaf8);
  gScene.fog = new THREE.Fog(0xd8eaf8, 22, 55);

  const camera = new THREE.PerspectiveCamera(36, 1, 0.1, 80);
  camera.position.set(6.6, 3.1, 7.8);
  camera.lookAt(0, 0.75, 0);

  // Bright showroom — light walls, colorful floor
  const wallMat = new THREE.MeshStandardMaterial({ color: 0xe8f2fa, roughness: 0.88, metalness: 0.05 });
  const floorMat = new THREE.MeshStandardMaterial({ color: 0xc8d8e8, roughness: 0.7, metalness: 0.12 });
  const accentMat = new THREE.MeshStandardMaterial({ color: 0xff8a4a, roughness: 0.55, metalness: 0.2 });

  const floor = new THREE.Mesh(new THREE.CircleGeometry(14, 48), floorMat);
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  gScene.add(floor);

  const back = new THREE.Mesh(new THREE.PlaneGeometry(28, 12), wallMat);
  back.position.set(0, 5.5, -10);
  gScene.add(back);

  const leftWall = new THREE.Mesh(new THREE.PlaneGeometry(22, 12), wallMat);
  leftWall.position.set(-12, 5.5, -1);
  leftWall.rotation.y = Math.PI / 2;
  gScene.add(leftWall);

  const rightWall = new THREE.Mesh(new THREE.PlaneGeometry(22, 12), wallMat);
  rightWall.position.set(12, 5.5, -1);
  rightWall.rotation.y = -Math.PI / 2;
  gScene.add(rightWall);

  // Tool cabinet / shelf silhouettes for garage feel
  const bench = new THREE.Mesh(new THREE.BoxGeometry(4.5, 1.1, 1.2), accentMat);
  bench.position.set(-6.5, 0.55, -7.5);
  bench.castShadow = true;
  gScene.add(bench);
  const shelf = new THREE.Mesh(new THREE.BoxGeometry(3.2, 2.4, 0.5), wallMat);
  shelf.position.set(7.2, 2.2, -8.8);
  gScene.add(shelf);

  // Overhead shop lights
  const lampMat = new THREE.MeshStandardMaterial({
    color: 0xffe6b0, emissive: 0xffc14a, emissiveIntensity: 1.4, roughness: 0.4,
  });
  for (const x of [-4.5, 0, 4.5]) {
    const lamp = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.12, 0.55), lampMat);
    lamp.position.set(x, 7.6, -1.5);
    gScene.add(lamp);
  }

  const hemi = new THREE.HemisphereLight(0xfffaf5, 0xb0d0e8, 1.35);
  gScene.add(hemi);
  const key = new THREE.DirectionalLight(0xfff6ea, 1.85);
  key.position.set(3.5, 11, 5.5);
  key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024);
  key.shadow.camera.near = 1;
  key.shadow.camera.far = 30;
  key.shadow.camera.left = -10;
  key.shadow.camera.right = 10;
  key.shadow.camera.top = 10;
  key.shadow.camera.bottom = -10;
  gScene.add(key);
  const fill = new THREE.PointLight(0x6ab8ff, 1.1, 30, 2);
  fill.position.set(-5, 4.5, 4);
  gScene.add(fill);
  const rim = new THREE.PointLight(0xff8a4a, 0.7, 24, 2);
  rim.position.set(5, 3, -2);
  gScene.add(rim);

  // Rotating platform
  const turntable = new THREE.Group();
  gScene.add(turntable);

  const platter = new THREE.Mesh(
    new THREE.CylinderGeometry(4.2, 4.4, 0.22, 48),
    new THREE.MeshStandardMaterial({ color: 0xb8c8d8, metalness: 0.45, roughness: 0.35 })
  );
  platter.position.y = 0.11;
  platter.receiveShadow = true;
  platter.castShadow = true;
  turntable.add(platter);

  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(4.15, 0.06, 10, 56),
    new THREE.MeshStandardMaterial({ color: 0xffc14a, metalness: 0.7, roughness: 0.35, emissive: 0x664410, emissiveIntensity: 0.35 })
  );
  ring.rotation.x = Math.PI / 2;
  ring.position.y = 0.24;
  turntable.add(ring);

  const hub = new THREE.Mesh(
    new THREE.CylinderGeometry(0.45, 0.55, 0.08, 24),
    new THREE.MeshStandardMaterial({ color: 0x555c68, metalness: 0.7, roughness: 0.3 })
  );
  hub.position.y = 0.24;
  turntable.add(hub);

  // Floor guide marks under the platter
  for (let i = 0; i < 8; i++) {
    const mark = new THREE.Mesh(
      new THREE.BoxGeometry(0.12, 0.02, 0.7),
      new THREE.MeshStandardMaterial({ color: 0x4a5560, roughness: 0.8 })
    );
    const a = (i / 8) * Math.PI * 2;
    mark.position.set(Math.cos(a) * 4.2, 0.02, Math.sin(a) * 4.2);
    mark.rotation.y = -a;
    gScene.add(mark);
  }

  const carRoot = new THREE.Group();
  carRoot.position.y = 0.22;
  turntable.add(carRoot);

  garagePreview = {
    renderer,
    scene: gScene,
    camera,
    turntable,
    carRoot,
    key,
    raf: 0,
    lastTs: 0,
  };

  resizeGaragePreview();
  return garagePreview;
}

function resizeGaragePreview() {
  if (!garagePreview || !garageCanvas) return;
  const parent = garageCanvas.parentElement;
  const w = Math.max(1, parent.clientWidth);
  const h = Math.max(1, parent.clientHeight);
  garagePreview.renderer.setSize(w, h, false);
  garagePreview.camera.aspect = w / h;
  garagePreview.camera.updateProjectionMatrix();
}

function disposeGarageCar() {
  if (!garagePreview) return;
  garagePreview.carMesh = null;
  const root = garagePreview.carRoot;
  while (root.children.length) {
    const child = root.children[0];
    root.remove(child);
    child.traverse((obj) => {
      if (obj.geometry) obj.geometry.dispose();
      if (obj.material) {
        if (Array.isArray(obj.material)) obj.material.forEach((m) => m.dispose());
        else obj.material.dispose();
      }
    });
  }
}

function setGaragePreviewCar(car) {
  ensureGaragePreview();
  disposeGarageCar();
  const [col, dark] = garageCarPaint(car);
  const mesh = createCatalogCarMesh(col, dark, car.body || "sedan", { withGuide: false, castShadow: true });
  mesh.position.set(0, 0, 0);
  mesh.rotation.y = Math.PI * 0.15;
  // Showroom: realistic cars already road-sized; slight fill of the stage
  mesh.scale.setScalar(mesh.userData.realistic ? 1.08 : 0.78);
  garagePreview.carRoot.add(mesh);
  garagePreview.carMesh = mesh;
}

function updateGarageStatsUI() {
  const car = CAR_CATALOG[garageIndex];
  const owned = unlocked.has(car.id);
  const equipped = equippedId === car.id;
  const speedPct = Math.round((car.maxSpeed / GARAGE_MAX_SPEED) * 100);
  const armorPct = Math.round(car.armor);

  cashDisplay.textContent = `$${poolCash}`;
  garageCarName.textContent = car.name;
  garageCarTitle.textContent = car.name;
  garageCarIndex.textContent = `${garageIndex + 1} / ${CAR_CATALOG.length}`;
  garageSpeedFill.style.width = `${speedPct}%`;
  garageArmorFill.style.width = `${armorPct}%`;
  garageSpeedVal.textContent = `${Math.round(car.maxSpeed * 3.6)} km/h`;
  garageArmorVal.textContent = `${armorPct}%`;

  garageCarStatus.classList.remove("owned", "equipped", "locked");
  if (equipped) {
    garageCarStatus.textContent = "EQUIPPED";
    garageCarStatus.classList.add("equipped");
  } else if (owned) {
    garageCarStatus.textContent = "OWNED";
    garageCarStatus.classList.add("owned");
  } else {
    garageCarStatus.textContent = `LOCKED · $${car.price}`;
    garageCarStatus.classList.add("locked");
  }

  garageActionBtn.className = "btn " + (owned ? (equipped ? "ghost" : "primary") : "primary");
  if (!owned) {
    garageActionBtn.textContent = poolCash >= car.price ? `BUY · $${car.price}` : "NEED CASH";
    garageActionBtn.disabled = poolCash < car.price;
  } else {
    garageActionBtn.textContent = equipped ? "EQUIPPED" : "EQUIP";
    garageActionBtn.disabled = equipped;
  }
}

function renderGarage() {
  garageIndex = Math.max(0, CAR_CATALOG.findIndex((c) => c.id === equippedId));
  if (garageIndex < 0) garageIndex = 0;
  ensureGaragePreview();
  setGaragePreviewCar(CAR_CATALOG[garageIndex]);
  updateGarageStatsUI();
  resizeGaragePreview();
}

function shiftGarageCar(dir) {
  garageIndex = (garageIndex + dir + CAR_CATALOG.length) % CAR_CATALOG.length;
  setGaragePreviewCar(CAR_CATALOG[garageIndex]);
  updateGarageStatsUI();
  beep(380, 0.05, "triangle", 0.03);
}

function onGarageAction() {
  const car = CAR_CATALOG[garageIndex];
  const owned = unlocked.has(car.id);
  if (!owned) {
    if (poolCash < car.price) return;
    poolCash -= car.price;
    unlocked.add(car.id);
    equippedId = car.id;
    beep(660, 0.1, "sine", 0.05);
    refreshPlayerCars();
    saveCurrentProfile(true);
  } else if (equippedId !== car.id) {
    equippedId = car.id;
    beep(520, 0.08, "triangle", 0.04);
    refreshPlayerCars();
    saveCurrentProfile(true);
  }
  updateGarageStatsUI();
  updateProfileUI();
}

function tickGaragePreview(ts) {
  if (!garagePreview || garageScreen.classList.contains("hidden")) {
    garagePreview.raf = 0;
    return;
  }
  const last = garagePreview.lastTs || ts;
  const dt = Math.min(0.05, (ts - last) / 1000);
  garagePreview.lastTs = ts;
  const turnDelta = dt * 0.55;
  garagePreview.turntable.rotation.y += turnDelta;
  // Roll showroom tires with the turntable so wrong roll axes are obvious / fixed
  const carMesh = garagePreview.carMesh;
  if (carMesh) {
    const roll = turnDelta * 3.4;
    for (const w of carMesh.userData.frontWheels || []) {
      spinWheelRoller(w.userData.roller, roll);
    }
    for (const w of carMesh.userData.rearWheels || []) {
      spinWheelRoller(w.userData.roller, roll);
    }
  }
  if (garagePreview.key) garagePreview.key.intensity = 1.25 + Math.sin(ts * 0.002) * 0.08;
  garagePreview.renderer.render(garagePreview.scene, garagePreview.camera);
  garagePreview.raf = requestAnimationFrame(tickGaragePreview);
}

function startGaragePreviewLoop() {
  if (!garagePreview) ensureGaragePreview();
  if (garagePreview.raf) cancelAnimationFrame(garagePreview.raf);
  garagePreview.lastTs = performance.now();
  garagePreview.raf = requestAnimationFrame(tickGaragePreview);
}

function stopGaragePreviewLoop() {
  if (garagePreview?.raf) {
    cancelAnimationFrame(garagePreview.raf);
    garagePreview.raf = 0;
  }
}

function refreshPlayerCars() {
  if (!players.length) return;
  const saved = players.map((p) => ({
    id: p.id, x: p.x, z: p.z, angle: p.angle, cash: p.cash, heat: p.heat,
    carrying: p.carrying, job: p.job, controls: p.controls, damage: p.damage,
  }));
  players.forEach((p) => { disposePlayerGuide(p); scene.remove(p.mesh); });
  players = saved.map((s) => {
    const p = createPlayer(
      s.id,
      s.id === "P1" ? 0xff2d4a : 0x2db0ff,
      s.id === "P1" ? 0xa01228 : 0x0e5a9a,
      s.controls
    );
    p.x = s.x; p.z = s.z; p.angle = s.angle;
    p.cash = s.cash; p.heat = s.heat; p.carrying = s.carrying; p.job = s.job;
    p.damage = s.damage || 0;
    p.mesh.position.set(p.x, 0, p.z);
    p.mesh.rotation.y = p.angle;
    return p;
  });
}

function openGarage() {
  ensureAudio();
  garageReturnState = state;
  if (state === "playing") {
    state = "paused";
    pauseScreen.classList.add("hidden");
  }
  renderGarage();
  garageScreen.classList.remove("hidden");
  requestAnimationFrame(() => {
    resizeGaragePreview();
    startGaragePreviewLoop();
  });
}

function closeGarage() {
  stopGaragePreviewLoop();
  garageScreen.classList.add("hidden");
  if (garageReturnState === "menu" || state === "menu") {
    state = "menu";
    return;
  }
  state = "playing";
  lastTs = performance.now();
}

window.addEventListener("resize", () => {
  if (garageScreen && !garageScreen.classList.contains("hidden")) resizeGaragePreview();
});

function startGame() {
  if (!currentEmail) {
    authScreen?.classList.remove("hidden");
    startScreen.classList.add("hidden");
    showAuthError("Sign in to continue your getaway.");
    return;
  }
  ensureAudio();
  // Keep cash / unlocks / dropCount — Restart Run only resets the current chase
  poolCash = Math.max(poolCash, 0);
  saveCurrentProfile(true);
  state = "playing";
  startScreen.classList.add("hidden");
  pauseScreen.classList.add("hidden");
  bustScreen.classList.add("hidden");
  garageScreen.classList.add("hidden");
  hud.classList.remove("hidden");
  if (playControls) playControls.classList.remove("hidden");
  if (damageHud) damageHud.classList.remove("hidden");
  applyModeUI();
  viewDirty = true;
  lastTs = performance.now();
  clearCops();
  clearRoadblocks();
  resetPlayers();
  initTraffic();
  // No police until a robber is picked up
  syncJobMarkers();
  updateGuideArrows(0.016);
  updateHUD();
  updateProfileUI();
  beep(440, 0.12, "triangle", 0.05);
}

function togglePause() {
  if (state === "playing") {
    state = "paused";
    pauseScreen.classList.remove("hidden");
  } else if (state === "paused") {
    state = "playing";
    pauseScreen.classList.add("hidden");
    garageScreen.classList.add("hidden");
    lastTs = performance.now();
  }
}

function updateHUD() {
  const anyWanted = players.some((p) => p.carrying || p.heat > 0);
  wantedBanner.classList.toggle("hidden", !anyWanted);

  players.forEach((p) => {
    const speed = Math.abs(Math.round(p.speed * 3.6));
    const job = p.boostT > 0 && !p.carrying ? "NITRO BOOST" : p.job;
    const dmgPct = Math.max(0, Math.min(100, (p.damage / MAX_DAMAGE) * 100));
    if (p.id === "P1") {
      p1Cash.textContent = `$${p.cash}`;
      p1Speed.textContent = String(speed);
      p1Heat.textContent = String(Math.round(p.heat));
      p1Job.textContent = job;
      if (p1DmgFill) {
        p1DmgFill.style.width = `${dmgPct}%`;
        p1DmgFill.classList.toggle("critical", dmgPct >= 70);
      }
    } else {
      p2Cash.textContent = `$${p.cash}`;
      p2Speed.textContent = String(speed);
      p2Heat.textContent = String(Math.round(p.heat));
      p2Job.textContent = job;
      if (p2DmgFill) {
        p2DmgFill.style.width = `${dmgPct}%`;
        p2DmgFill.classList.toggle("critical", dmgPct >= 70);
      }
    }
  });
  sharedCashEl.textContent = `POOL $${poolCash}`;
  const raceTimer = document.getElementById("race-timer");
  const boosting = players.some((p) => p.boostT > 0);
  const inPrecinct = players.some((p) => p.zone === "precinct");
  if (raceTimer) {
    if (boosting) raceTimer.textContent = "NITRO";
    else if (inPrecinct) raceTimer.textContent = "PRECINCT";
    else if (anyWanted) raceTimer.textContent = "WANTED";
    else raceTimer.textContent = "CITY STREETS";
  }
}

function applyDamage(p, amount) {
  if (!p || p.damage === undefined || p.invuln > 0 || amount <= 0) return;
  const tankMul = getEquippedStats().tank ? 0.55 : 1;
  p.damage = Math.min(MAX_DAMAGE, p.damage + amount * tankMul * DAMAGE_RATE);
  if (p.damage >= MAX_DAMAGE) wreckPlayer(p);
}

function wreckPlayer(p) {
  playCrashSound(55);
  beep(120, 0.3, "sawtooth", 0.05);
  p.carrying = false;
  p.heat = 0;
  p.job = "FIND ROBBER";
  p.speed = 0;
  p.slideX = 0;
  p.slideZ = 0;
  p.spin = 0;
  p.susY = 0.16;
  p.susVel = 0;
  p.susPitch = 0;
  p.prevFwd = 0;
  p.damage = 0;
  p.invuln = 4;
  p.bustFlash = 2.5;
  const loss = Math.min(p.cash, 200);
  p.cash -= loss;
  const spawn = randomRoadPoint();
  p.x = spawn.x;
  p.z = spawn.z;
  p.mesh.position.set(p.x, p.susY, p.z);
  p.mesh.rotation.z = 0;
  p.mesh.rotation.x = 0;
  // After wreck, back to robber-only (safehouse relocates next pickup)
  syncJobMarkers();
  trimCopsTo(getPatrolCops());
  bustTitle.textContent = playerMode === 1
    ? "WRECKED"
    : `${p.id === "P1" ? "PLAYER 1" : "PLAYER 2"} WRECKED`;
  bustScreen.classList.remove("hidden");
  setTimeout(() => {
    bustScreen.classList.add("hidden");
  }, 1800);
}

/** Reflect velocity + spin when a car hits a solid / another vehicle. */
function applyCarImpact(car, nx, nz, pen, bounce, damageScale, other = null) {
  car.x += nx * pen;
  car.z += nz * pen;

  const vx = Math.sin(car.angle) * car.speed + (car.slideX || 0);
  const vz = Math.cos(car.angle) * car.speed + (car.slideZ || 0);
  const vn = vx * nx + vz * nz;
  const spinKick = tangentSpin(car, nx, nz);

  if (vn < 0) {
    const reflect = 1 + bounce;
    const rx = vx - reflect * vn * nx;
    const rz = vz - reflect * vn * nz;
    // Keep some forward drive, dump the rest into slide for a skid
    const keep = 0.35;
    car.speed *= keep;
    car.slideX = rx - Math.sin(car.angle) * car.speed;
    car.slideZ = rz - Math.cos(car.angle) * car.speed;
    car.spin = (car.spin || 0) + spinKick * Math.abs(vn) * 0.22;

    const impact = Math.abs(vn);
    if (impact > 8 && car.hitCd <= 0) {
      car.hitCd = 0.38;
      applyDamage(car, (impact - 7) * damageScale * 0.65);
      playCrashSound(impact);
    }
  } else if (pen > 0.01) {
    car.slideX = (car.slideX || 0) + nx * pen * 8;
    car.slideZ = (car.slideZ || 0) + nz * pen * 8;
  }

  if (other) {
    other.x -= nx * pen * 0.55;
    other.z -= nz * pen * 0.55;
    if (vn < 0) {
      other.speed *= 0.55;
      other.slideX = (other.slideX || 0) - nx * Math.abs(vn) * 0.35;
      other.slideZ = (other.slideZ || 0) - nz * Math.abs(vn) * 0.35;
      other.spin = (other.spin || 0) - tangentSpin(other, nx, nz) * Math.abs(vn) * 0.18;
    }
  }
}

function tangentSpin(car, nx, nz) {
  return -nx * Math.cos(car.angle) + nz * Math.sin(car.angle);
}

function resolveWorldCollisions(car, dt) {
  if (car.hitCd > 0) car.hitCd -= dt;
  const r = CAR_RADIUS;
  const reach = r + 6;
  const nearby = queryColliders(car.x, car.z, reach + 12);
  for (const box of nearby) {
    // Sidewalks / footpaths are never solid — only buildings, canal, bridge rails, etc.
    if (box.kind === "sidewalk") continue;
    if (Math.abs(box.x - car.x) > box.hw + reach) continue;
    if (Math.abs(box.z - car.z) > box.hd + reach) continue;
    const hit = circleVsAABB(car.x, car.z, r, box);
    if (!hit) continue;
    const soft = box.kind === "curb" || box.kind === "lamp";
    const dmgScale = box.kind === "building" ? 0.45 : box.kind === "lamp" ? 0.2 : 0.08;
    applyCarImpact(car, hit.nx, hit.nz, hit.pen, box.bounce, dmgScale);
    if (soft && Math.abs(car.speed) > 8) car.speed *= 0.92;
  }
}

function bustPlayer(p) {
  wreckPlayer(p);
}

function deliverPassenger(p) {
  const mul = p.payoutMul || 1;
  const payout = Math.round((400 + Math.round(p.heat * 80) + Math.round(Math.random() * 200)) * mul);
  p.cash += payout;
  poolCash += payout;
  p.carrying = false;
  p.heat = Math.max(0, p.heat - 2);
  p.job = "FIND ROBBER";
  p.payoutMul = 1;
  const prevTier = getPoliceTierIndex();
  dropCount += 1;
  const nextTier = getPoliceTierIndex();
  upgradeActiveCops();
  beep(784, 0.15, "sine", 0.06);
  setTimeout(() => beep(988, 0.18, "sine", 0.06), 120);
  if (mul > 1) showZoneToast("bank", `BANK PAYOUT $${payout}`);
  else if (nextTier > prevTier) {
    const fleet = getPoliceTier();
    showZoneToast("precinct", `DROP #${dropCount} — ${fleet.name.toUpperCase()} ON THE STREETS`);
  } else {
    showZoneToast("precinct", `DROP #${dropCount} — FASTER UNITS INBOUND`);
  }
  // Keep a fixed-size patrol — difficulty comes from faster models, not more cars
  trimCopsTo(Math.max(getPatrolCops(), Math.min(cops.length, getMaxCops())));
  // Safehouse disappears; next robber appears (safehouse moves next pickup)
  showRobberOnly({ x: p.x, z: p.z });
  saveCurrentProfile(true);
  updateProfileUI();
}

function applyLandmarkEffects(p, dt) {
  if (p.boostT > 0) p.boostT -= dt;
  if (p.gasCd > 0) p.gasCd -= dt;

  let active = null;
  for (const lm of landmarks) {
    if (Math.hypot(lm.x - p.x, lm.z - p.z) < lm.radius) {
      active = lm;
      break;
    }
  }

  if (!active) {
    p.zone = null;
    return;
  }

  const entered = p.zone !== active.type;
  p.zone = active.type;

  if (active.type === "gas") {
    if (entered) showZoneToast("gas", "GAS STATION — NITRO");
    if (p.gasCd <= 0) {
      p.boostT = Math.max(p.boostT, 3.8);
      p.gasCd = 6;
      beep(700, 0.08, "square", 0.03);
    }
  } else if (active.type === "hospital") {
    if (entered) showZoneToast("hospital", "HOSPITAL — REPAIR & COOL");
    if (p.heat > 0) p.heat = Math.max(0, p.heat - dt * 0.9);
    if (p.damage > 0) p.damage = Math.max(0, p.damage - dt * 18);
  } else if (active.type === "nightclub") {
    if (entered) showZoneToast("nightclub", "CLUB — LOSE THE HEAT");
    if (p.carrying && p.heat > 0.4) p.heat = Math.max(0.4, p.heat - dt * 0.65);
  } else if (active.type === "precinct") {
    if (entered) showZoneToast("precinct", "PRECINCT — HIGH ALERT");
    if (p.carrying) {
      p.heat = Math.min(5, p.heat + dt * 0.45);
      if (cops.length < getMaxCops() && Math.random() < dt * 0.28 * COP_COUNT_MULT) spawnCop(p);
    }
  } else if (active.type === "bank") {
    if (entered) showZoneToast("bank", "BANK DISTRICT — BIG PAYOUT");
    if (!p.carrying) p.payoutMul = Math.max(p.payoutMul, 1.65);
  }
}

function updatePlayer(p, dt) {
  const stats = getEquippedStats();
  const ctrl = p.controls;
  p.lookBack = !!keys[ctrl.look];

  if (keys[ctrl.reset] && p.invuln <= 0) {
    const spawn = randomRoadPoint();
    p.x = spawn.x; p.z = spawn.z; p.speed *= 0.2;
    p.slideX = 0; p.slideZ = 0; p.spin = 0; p.drift = 0;
    p.mesh.position.set(p.x, 0, p.z);
    p.mesh.rotation.z = 0; p.mesh.rotation.x = 0;
    keys[ctrl.reset] = false;
  }

  if (p.invuln > 0) p.invuln -= dt;

  const accel = keys[ctrl.up];
  // S / ↓ = reverse + brake/drift (same button) — Blacktop-style
  const back = keys[ctrl.down] || keys[ctrl.brake];
  const left = keys[ctrl.left];
  const right = keys[ctrl.right];
  const steerDir = (left ? 1 : 0) - (right ? 1 : 0);

  applyLandmarkEffects(p, dt);

  const boostMul = p.boostT > 0 ? 1.35 : 1;
  // Damage does not affect performance — car keeps its own speed/handling until wrecked
  const max = stats.maxSpeed * (p.carrying ? 0.94 : 1) * boostMul;

  // World velocity (heading can diverge — this is the Blacktop drift look)
  let vx = Math.sin(p.angle) * p.speed + (p.slideX || 0);
  let vz = Math.cos(p.angle) * p.speed + (p.slideZ || 0);
  let speed = Math.hypot(vx, vz);

  // Impact spin
  p.angle += (p.spin || 0) * dt;
  p.spin *= Math.pow(0.08, dt);
  if (Math.abs(p.spin) < 0.02) p.spin = 0;

  const fwd0 = vx * Math.sin(p.angle) + vz * Math.cos(p.angle);
  const handbrake = back && speed > 9 && fwd0 > 5;
  const wantReverse = back && !handbrake;

  // Front-wheel visual + yaw. Brake unlocks a hard swing (Blacktop drift)
  const targetSteer = steerDir * MAX_STEER;
  p.steerAngle = THREE.MathUtils.lerp(p.steerAngle || 0, targetSteer, 1 - Math.pow(0.00002, dt));

  const steerFeel = Math.min(1.25, 0.28 + speed / 14);
  let turnRate = stats.turn * steerFeel * (1 - Math.min(0.2, speed / 160));
  if (handbrake) turnRate *= 2.35; // nose snaps into the corner
  else if (speed > 28 && Math.abs(steerDir)) turnRate *= 1.15;

  if (steerDir) {
    const dirSign = Math.abs(fwd0) > 0.8 ? Math.sign(fwd0) : wantReverse ? -1 : 1;
    p.angle += steerDir * turnRate * dirSign * dt;
  }

  // Decompose velocity in the NEW facing frame (yaw kept world momentum → natural slide)
  const fx = Math.sin(p.angle);
  const fz = Math.cos(p.angle);
  const rx = Math.cos(p.angle);
  const rz = -Math.sin(p.angle);
  let fwd = vx * fx + vz * fz;
  let lat = vx * rx + vz * rz;

  // Drive forces along facing
  if (accel) {
    fwd += stats.accel * (handbrake ? 0.72 : 1) * dt;
    if (p.boostT > 0) fwd += stats.accel * 0.4 * dt;
  }
  if (handbrake) {
    // Bleed a little speed; keep momentum for the slide
    fwd = Math.max(0, fwd - 12 * dt);
  } else if (wantReverse) {
    if (fwd > 1.5) fwd = Math.max(0, fwd - 42 * dt);
    else fwd -= 18 * dt;
  } else if (!accel) {
    if (fwd > 0) fwd = Math.max(0, fwd - 9 * dt);
    if (fwd < 0) fwd = Math.min(0, fwd + 9 * dt);
  }

  // Grip: low under handbrake so lateral velocity persists (real Blacktop drift)
  const drifting = handbrake || (speed > 34 && Math.abs(steerDir) > 0 && Math.abs(lat) > 4);
  const grip = drifting ? (handbrake ? 1.35 : 3.2) : 11;
  lat *= Math.exp(-grip * dt);

  // Soft cap
  let sp = Math.hypot(fwd, lat);
  const cap = Math.max(18, max);
  if (sp > cap) {
    const s = cap / sp;
    fwd *= s;
    lat *= s;
    sp = cap;
  }
  fwd = Math.max(-18, Math.min(max, fwd));

  vx = fx * fwd + rx * lat;
  vz = fz * fwd + rz * lat;
  speed = Math.hypot(vx, vz);

  // Grass / sidewalks / parks are fully drivable (tiny traction loss only far from streets)
  const onStreet = onRoad(p.x, p.z, 5.5);
  if (!onStreet) {
    vx *= 0.998;
    vz *= 0.998;
    fwd = vx * fx + vz * fz;
    lat = vx * rx + vz * rz;
  }

  p.x += vx * dt;
  p.z += vz * dt;

  // Store for collisions / HUD (speed = forward, slide = lateral world)
  p.speed = fwd;
  p.slideX = vx - fx * fwd;
  p.slideZ = vz - fz * fwd;

  // Drift intensity from slip angle (Blacktop visual cue)
  const driftAngle = Math.atan2(lat, Math.abs(fwd) + 0.35);
  p.drift = drifting
    ? Math.min(1, Math.abs(driftAngle) / 0.5 + 0.15)
    : Math.max(0, (p.drift || 0) - dt * 2.4);

  // Solid collisions with buildings / lamps (sidewalk curbs are passable)
  resolveWorldCollisions(p, dt);

  // Roadblock collision — bounce + damage
  for (const rb of roadblocks) {
    const d = Math.hypot(rb.x - p.x, rb.z - p.z);
    if (d < 4.5 && d > 0.01) {
      const nx = (p.x - rb.x) / d;
      const nz = (p.z - rb.z) / d;
      applyCarImpact(p, nx, nz, 4.5 - d, 0.4, 0.5);
      if (stats.tank) rb.life -= 10 * dt;
    }
  }

  // Suspension: soft spring over sidewalk lips, grass, and load transfer
  const speedN = Math.min(1, speed / 40);
  const surfaceH = onStreet ? 0.14 : 0.2;
  const terrain =
    Math.sin(p.x * 0.55 + p.z * 0.4) * (onStreet ? 0.02 : 0.07) * speedN
    + Math.sin(p.x * 1.7 - p.z * 1.3) * (onStreet ? 0.01 : 0.045) * speedN;
  const loadKick = (fwd - (p.prevFwd || 0)) * -0.035;
  p.prevFwd = fwd;
  if (handbrake) p.susVel -= 2.2 * dt;
  if (accel) p.susVel += 1.4 * dt;
  // Mounting a sidewalk / leaving asphalt bumps the suspension
  const nearCurb = onRoad(p.x, p.z, 2.2) !== onRoad(p.x, p.z, 4.8);
  if (nearCurb && speed > 6) p.susVel += (Math.random() - 0.2) * 6 * speedN;

  const targetSus = surfaceH + terrain + loadKick;
  const spring = 38;
  const damp = 6.5;
  p.susVel += (targetSus - (p.susY || 0)) * spring * dt;
  p.susVel *= Math.exp(-damp * dt);
  p.susY = THREE.MathUtils.clamp((p.susY || 0) + p.susVel * dt, 0.02, 0.55);
  const pitchTarget = THREE.MathUtils.clamp(
    -loadKick * 2.2 - (accel ? 0.04 : 0) + (handbrake || wantReverse ? 0.06 : 0),
    -0.16,
    0.18
  );
  p.susPitch = THREE.MathUtils.lerp(p.susPitch || 0, pitchTarget, 1 - Math.pow(0.02, dt));

  // Visual: car faces heading while sliding sideways — classic Blacktop drift pose
  const slideMag = Math.hypot(p.slideX, p.slideZ);
  const bodyRoll = THREE.MathUtils.clamp(-driftAngle * 0.55 - steerDir * (p.drift || 0) * 0.1, -0.32, 0.32);
  const crashRoll = THREE.MathUtils.clamp(p.spin * 0.08, -0.35, 0.35);
  p.mesh.position.set(p.x, p.susY + Math.min(0.12, slideMag * 0.012), p.z);
  p.mesh.rotation.y = p.angle;
  p.mesh.rotation.z = THREE.MathUtils.lerp(p.mesh.rotation.z, bodyRoll + crashRoll, 0.35);
  p.mesh.rotation.x = THREE.MathUtils.lerp(
    p.mesh.rotation.x,
    THREE.MathUtils.clamp(
      (p.susPitch || 0) - Math.abs(driftAngle) * 0.08 * Math.sign(fwd || 1),
      -0.18,
      0.14
    ),
    0.22
  );

  // Front wheels steer; all wheels roll
  const rollSpeed = speed * Math.sign(fwd || 1);
  const front = p.mesh.userData.frontWheels || [];
  const rear = p.mesh.userData.rearWheels || [];
  const wheelSteer = (p.steerAngle || 0) * 1.35;
  for (const w of front) {
    w.rotation.y = wheelSteer;
    spinWheelRoller(w.userData.roller, rollSpeed * dt * 2.35);
  }
  for (const w of rear) {
    w.rotation.y = 0;
    spinWheelRoller(w.userData.roller, rollSpeed * dt * 2.35);
  }
  if (!front.length && !rear.length) {
    for (const w of p.mesh.userData.wheels || []) {
      if (w.userData?.roller) spinWheelRoller(w.userData.roller, rollSpeed * dt * 2.0);
      else w.rotation.x += rollSpeed * dt * 2.0;
    }
  }

  // Tire smoke while drifting (throttled)
  if ((p.drift || 0) > 0.28 && slideMag > 3 && Math.random() < dt * 10) {
    const backX = p.x - Math.sin(p.angle) * 1.4;
    const backZ = p.z - Math.cos(p.angle) * 1.4;
    const side = Math.random() > 0.5 ? 1 : -1;
    spawnDriftSmoke(backX + Math.cos(p.angle) * 0.9 * side, backZ - Math.sin(p.angle) * 0.9 * side, p.drift);
  }

  // missions
  if (!p.carrying) {
    p.job = "FIND ROBBER";
    for (const r of robbers) {
      if (r.taken) continue;
      if (Math.hypot(r.x - p.x, r.z - p.z) < 3.5) {
        // Robber disappears; only a relocated safehouse remains visible
        p.carrying = true;
        showSafehouseOnly(p);
        const nearBank = nearestLandmark("bank", p.x, p.z);
        if (nearBank && nearBank.dist < 22) {
          p.payoutMul = Math.max(p.payoutMul, 1.75);
          p.heat = Math.max(p.heat, 2);
          showZoneToast("bank", "BANK HEIST — EXTRA HEAT");
        } else {
          p.heat = Math.max(p.heat, 1);
        }
        p.job = p.payoutMul > 1 ? "BANK RUN → SAFEHOUSE" : "LOSE COPS → SAFEHOUSE";
        beep(520, 0.1, "sine", 0.05);
        const maxCops = getMaxCops();
        // Responders on pickup — fill toward fixed cap (models get faster over drops)
        const respond = Math.min(
          maxCops,
          Math.round((3 + Math.min(2, Math.floor(p.heat))) * COP_AMOUNT_MULT)
        );
        for (let i = cops.length; i < respond; i++) spawnCop(p);
        if (p.heat >= 2 || dropCount >= 2) spawnRoadblock(p);
        break;
      }
    }
  } else {
    p.job = p.payoutMul > 1 ? "BANK RUN → SAFEHOUSE" : "DELIVER TO SAFEHOUSE";
    p.heat = Math.min(5, p.heat + dt * 0.05);
    // Fill toward the fixed cap — quantity stays steady; tiers get faster over drops
    const maxCops = getMaxCops();
    if (cops.length < maxCops && Math.random() < dt * 0.45 * COP_COUNT_MULT) spawnCop(p);
    if ((p.heat >= 3 || dropCount >= 3) && roadblocks.length < 2 && Math.random() < dt * 0.08) spawnRoadblock(p);

    for (const s of safehouses) {
      if (Math.hypot(s.x - p.x, s.z - p.z) < 4) {
        deliverPassenger(p);
        break;
      }
    }
  }

  // cool heat when not carrying — leave an escalating patrol after more drops
  if (!p.carrying && p.heat > 0) {
    p.heat = Math.max(0, p.heat - dt * 0.25);
    if (p.heat <= 0 && cops.length > getPatrolCops()) {
      trimCopsTo(getPatrolCops());
    }
  }
}

function updateCop(c, dt) {
  // Only chase wanted getaways (carrying a robber or still hot) — never before pickup
  let target = null;
  let best = Infinity;
  for (const p of players) {
    if (p.invuln > 0) continue;
    if (!p.carrying && p.heat <= 0) continue;
    const d = Math.hypot(p.x - c.x, p.z - c.z);
    const score = d - (p.carrying ? 120 : 0) - (p.heat > 0 ? 20 : 0);
    if (score < best) { best = score; target = p; }
  }
  c.target = target;

  if (c.hitCd > 0) c.hitCd -= dt;
  c.angle += (c.spin || 0) * dt;
  c.spin *= Math.pow(0.1, dt);
  c.slideX = (c.slideX || 0) * Math.pow(0.15, dt);
  c.slideZ = (c.slideZ || 0) * Math.pow(0.15, dt);

  const turn = c.turn ?? 1.75;
  const accel = c.accel ?? 18;
  const baseMax = c.maxSpeed ?? 34 * COP_SPEED_MULT;

  if (target) {
    // Lead the target slightly so chase cuts the corner
    const lead = Math.min(14, Math.abs(target.speed) * 0.35);
    const aimX = target.x + Math.sin(target.angle) * lead;
    const aimZ = target.z + Math.cos(target.angle) * lead;
    const desired = Math.atan2(aimX - c.x, aimZ - c.z);
    let diff = desired - c.angle;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    const control = 1 / (1 + Math.abs(c.spin) * 0.35);
    c.angle += Math.max(-turn, Math.min(turn, diff * 3.2)) * dt * control;

    // Each unit uses its own fleet stats — never match the player's car
    const maxSpeed = baseMax + (target.carrying ? 3 : 0);
    const align = 1 - Math.min(1, Math.abs(diff) / Math.PI);
    c.speed = Math.min(maxSpeed, c.speed + accel * (0.65 + align * 0.55) * dt);
    // Cut across grass — only a tiny drag so they keep pursuing
    if (!onRoad(c.x, c.z, 6)) c.speed = Math.min(c.speed, maxSpeed * 0.92);
  } else {
    c.speed *= 0.98;
  }

  c.x += (Math.sin(c.angle) * c.speed + (c.slideX || 0)) * dt;
  c.z += (Math.cos(c.angle) * c.speed + (c.slideZ || 0)) * dt;

  resolveWorldCollisions(c, dt);

  c.mesh.position.set(c.x, 0, c.z);
  c.mesh.rotation.y = c.angle;
  c.mesh.rotation.z = THREE.MathUtils.clamp((c.spin || 0) * 0.06, -0.3, 0.3);

  // Animate police wheels (steer toward chase direction a bit)
  const front = c.mesh.userData.frontWheels || [];
  const rear = c.mesh.userData.rearWheels || [];
  let steerVis = 0;
  if (target) {
    const desired = Math.atan2(target.x - c.x, target.z - c.z);
    let diff = desired - c.angle;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    steerVis = THREE.MathUtils.clamp(diff, -MAX_STEER, MAX_STEER);
  }
  for (const w of front) {
    w.rotation.y = steerVis;
    spinWheelRoller(w.userData.roller, c.speed * dt * 1.9);
  }
  for (const w of rear) {
    spinWheelRoller(w.userData.roller, c.speed * dt * 1.9);
  }

  // siren blink
  const siren = c.mesh.userData.siren;
  if (siren) {
    siren.t += dt * 8;
    const on = Math.sin(siren.t) > 0;
    siren.red.material.emissiveIntensity = on ? 3 : 0.2;
    siren.blue.material.emissiveIntensity = on ? 0.2 : 3;
  }

  // Police ramming — impact + damage, NOT instant catch
  for (const p of players) {
    if (p.invuln > 0) continue;
    const d = Math.hypot(p.x - c.x, p.z - c.z);
    if (d < 2.7 && d > 0.01) {
      const nx = (p.x - c.x) / d;
      const nz = (p.z - c.z) / d;
      const pen = 2.7 - d;
      applyCarImpact(p, nx, nz, pen * 0.45, 0.4, 0.28, c);
      // Recover chase speed quickly — still slower than a boosted getaway
      c.speed = Math.max(c.speed * 0.72, baseMax * 0.4);
      if (getEquippedStats().tank) {
        c.speed *= 0.55;
        c.slideX = (c.slideX || 0) - nx * 8;
        c.slideZ = (c.slideZ || 0) - nz * 8;
      }
    }
  }
}

const _camTargetPos = new THREE.Vector3();
const _camLookTarget = new THREE.Vector3();

function updateCamera(cam, p, dt) {
  const lookBack = p.lookBack;
  // Tighter chase cam — closer to the car for a clearer driving view
  const dist = 6.2;
  const height = 3.05;
  // Smooth look-back flip so the screen doesn't whip around
  if (p.camLookBlend == null) p.camLookBlend = lookBack ? 1 : 0;
  p.camLookBlend += ((lookBack ? 1 : 0) - p.camLookBlend) * (1 - Math.exp(-5.5 * dt));
  const lb = p.camLookBlend;
  const ahead = THREE.MathUtils.lerp(5.5, -7, lb);
  const backDir = THREE.MathUtils.lerp(1, -1, lb);
  // Ease yaw used for camera orbit so hard turns don't jerk the view
  if (p.camYaw == null) p.camYaw = p.angle;
  let yawDelta = p.angle - p.camYaw;
  while (yawDelta > Math.PI) yawDelta -= Math.PI * 2;
  while (yawDelta < -Math.PI) yawDelta += Math.PI * 2;
  p.camYaw += yawDelta * (1 - Math.exp(-4.2 * dt));

  const bx = p.x - Math.sin(p.camYaw) * dist * backDir;
  const bz = p.z - Math.cos(p.camYaw) * dist * backDir;
  // Keep height fixed — no speed-based pull-away
  _camTargetPos.set(bx, height, bz);
  _camLookTarget.set(
    p.x + Math.sin(p.camYaw) * ahead,
    1.05,
    p.z + Math.cos(p.camYaw) * ahead
  );
  // Stick tight to the car so acceleration never leaves the cam behind
  const kPos = 1 - Math.exp(-14 * dt);
  const kLook = 1 - Math.exp(-16 * dt);
  p.camPos.lerp(_camTargetPos, kPos);
  p.camLook.lerp(_camLookTarget, kLook);
  cam.position.copy(p.camPos);
  cam.lookAt(p.camLook);
  // Mild FOV only — avoid the zoom-out that feels like the cam pulling away
  const targetFov = 54 + Math.min(4, Math.abs(p.speed) * 0.06);
  cam.fov += (targetFov - cam.fov) * (1 - Math.exp(-3.5 * dt));
  cam.updateProjectionMatrix();
}

function updateMarkers(dt) {
  const t = performance.now() * 0.003;
  for (const r of robbers) {
    if (r.taken || !r.mesh) continue;
    const ring = r.mesh.userData.ring;
    const fig = r.mesh.userData.figure;
    const beam = r.mesh.userData.beam;
    if (ring) {
      const pulse = 1 + Math.sin(t * 3 + r.x) * 0.12;
      ring.scale.set(pulse, pulse, pulse);
      ring.material.emissiveIntensity = 1.6 + Math.sin(t * 4 + r.z) * 0.8;
    }
    if (fig) {
      fig.position.y = Math.sin(t * 2 + r.x) * 0.05;
      fig.rotation.y = Math.sin(t * 0.8 + r.z) * 0.35;
      if (fig.userData.arm) fig.userData.arm.rotation.z = 0.45 + Math.sin(t * 5) * 0.35;
    }
    if (beam) beam.material.opacity = 0.14 + Math.sin(t * 2.5 + r.x) * 0.08;
  }
  for (const s of safehouses) {
    const ring = s.mesh.userData.ring;
    const building = s.mesh.userData.building;
    const beam = s.mesh.userData.beam;
    if (ring) {
      const pulse = 0.55 + Math.sin(t * 2.2 + s.z) * 0.08;
      ring.scale.set(pulse, pulse, pulse);
      ring.material.emissiveIntensity = 1.4 + Math.sin(t * 3 + s.x) * 0.7;
    }
    if (building && building.userData.door) {
      building.userData.door.material.emissiveIntensity = 1.1 + Math.sin(t * 3.5 + s.x) * 0.7;
    }
    if (building && building.userData.pad) {
      building.userData.pad.material.opacity = 0.28 + Math.sin(t * 2 + s.z) * 0.12;
    }
    if (beam) beam.material.opacity = 0.12 + Math.sin(t * 2 + s.z) * 0.08;
  }
  for (const n of landmarkNeons) {
    const pulse = n.base + Math.sin(t * n.speed) * 0.25;
    if (n.mesh.material) n.mesh.material.emissiveIntensity = pulse;
  }
  if (zoneToastTimer > 0) {
    zoneToastTimer -= dt;
    if (zoneToastTimer <= 0 && zoneToast) zoneToast.classList.add("hidden");
  }
  for (let i = roadblocks.length - 1; i >= 0; i--) {
    roadblocks[i].life -= dt;
    if (roadblocks[i].life <= 0) {
      world.remove(roadblocks[i].mesh);
      roadblocks.splice(i, 1);
    }
  }
}

let viewDirty = true;
function syncSplitCameras() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  if (playerMode === 1) {
    camera1.aspect = w / h;
    camera1.updateProjectionMatrix();
  } else {
    const half = Math.floor(w / 2);
    camera1.aspect = half / h;
    camera1.updateProjectionMatrix();
    camera2.aspect = half / h;
    camera2.updateProjectionMatrix();
  }
  viewDirty = false;
}

function render() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  if (viewDirty) syncSplitCameras();

  renderer.setScissorTest(false);
  renderer.setViewport(0, 0, w, h);
  renderer.clear();

  if (playerMode === 1) {
    renderer.render(scene, camera1);
    return;
  }

  const half = Math.floor(w / 2);
  renderer.setScissorTest(true);
  renderer.setViewport(0, 0, half, h);
  renderer.setScissor(0, 0, half, h);
  renderer.render(scene, camera1);
  renderer.setViewport(half, 0, w - half, h);
  renderer.setScissor(half, 0, w - half, h);
  renderer.render(scene, camera2);
  renderer.setScissorTest(false);
}

window.addEventListener("resize", () => {
  renderer.setSize(window.innerWidth, window.innerHeight);
  viewDirty = true;
});

document.addEventListener("visibilitychange", () => {
  if (document.hidden) {
    lastTs = performance.now();
  } else {
    // Reset clock so returning to the tab does not simulate a huge catch-up freeze
    lastTs = performance.now();
  }
});

let hudAcc = 0;
let markerAcc = 0;
let menuFrameSkip = 0;
let qualityCooldown = 0;

function applyQualitySettings() {
  renderer.setPixelRatio(quality.pixelRatio);
  const wantShadows = quality.shadows && playerMode === 1;
  if (renderer.shadowMap.enabled !== wantShadows) {
    renderer.shadowMap.enabled = wantShadows;
    sunLight.castShadow = wantShadows;
    // Avoid full-scene traverse (that hitch was worse than stale flags)
  }
}

function updateAdaptiveQuality(dt) {
  quality.avgDt = quality.avgDt * 0.9 + dt * 0.1;
  qualityCooldown = Math.max(0, qualityCooldown - dt);
  if (qualityCooldown > 0) return;

  // Drop detail quickly when frames lag; never auto-reenable shadows (toggle hitch).
  if (quality.avgDt > 0.033 || dt > 0.045) {
    if (quality.smoke) {
      quality.smoke = false;
      qualityCooldown = 1.2;
    } else if (quality.shadows) {
      quality.shadows = false;
      qualityCooldown = 1.6;
      applyQualitySettings();
    } else if (quality.pixelRatio > 1) {
      quality.pixelRatio = 1;
      qualityCooldown = 1.8;
      applyQualitySettings();
    }
  } else if (quality.avgDt < 0.015 && dt < 0.018) {
    if (!quality.smoke) {
      quality.smoke = true;
      qualityCooldown = 2;
    } else if (quality.pixelRatio < MAX_PIXEL_RATIO - 0.01) {
      quality.pixelRatio = Math.min(MAX_PIXEL_RATIO, quality.pixelRatio + 0.15);
      qualityCooldown = 2.5;
      applyQualitySettings();
    }
  }
}

function updateSunShadowFocus() {
  if (!renderer.shadowMap.enabled || !players.length) return;
  const p = players[0];
  sunLight.target.position.set(p.x, 0, p.z);
  sunLight.target.updateMatrixWorld();
  sunLight.position.set(
    p.x + sun.x * 120,
    sun.y * 120,
    p.z + sun.z * 120
  );
}

function frame(ts) {
  const rawDt = (ts - lastTs) / 1000 || 0.016;
  // Hard clamp — never simulate a huge catch-up step (that was freezing the game)
  const dt = Math.min(0.033, Math.max(0, rawDt));
  lastTs = ts;
  updateAdaptiveQuality(rawDt);

  if (state === "playing") {
    processTrafficSpawnQueue();
    // Cap pursuit cars only when over the limit (avoid per-frame trim work)
    if (cops.length > getMaxCops()) trimCopsTo(getMaxCops());
    players.forEach((p) => updatePlayer(p, dt));
    if (players.length === 2) {
      const a = players[0], b = players[1];
      const dx = b.x - a.x, dz = b.z - a.z;
      const dist = Math.hypot(dx, dz);
      if (dist < 2.7 && dist > 0.01) {
        const nx = dx / dist, nz = dz / dist;
        const o = 2.7 - dist;
        applyCarImpact(a, -nx, -nz, o * 0.5, 0.45, 0.25, b);
        applyDamage(b, Math.abs(a.speed - b.speed) * 0.025);
      }
    }
    cops.forEach((c) => updateCop(c, dt));
    updateTraffic(dt);
    processCopUpgradeQueue(dt);
    if (driftSmoke.length) updateDriftSmoke(dt);
    markerAcc += dt;
    if (markerAcc >= 0.05) {
      updateMarkers(markerAcc);
      markerAcc = 0;
    }
    updateGuideArrows(dt);
    hudAcc += dt;
    if (hudAcc >= 0.12) {
      hudAcc = 0;
      updateHUD();
    }
    players.forEach((p) => updateCamera(p.id === "P1" ? camera1 : camera2, p, dt));
    updateSunShadowFocus();
    render();
  } else if (state === "paused") {
    // Static pause — no need to thrash the GPU every frame
    menuFrameSkip++;
    if (menuFrameSkip % 3 === 0) {
      updateGuideArrows(0.05);
      render();
    }
  } else if (state === "menu") {
    menuFrameSkip++;
    if (menuFrameSkip % 2 === 0) {
      if (players.length) {
        players.forEach((p) => updateCamera(p.id === "P1" ? camera1 : camera2, p, dt * 2));
      } else {
        const t = ts * 0.00015;
        camera1.position.set(Math.cos(t) * 140, 70, Math.sin(t) * 140);
        camera1.lookAt(0, 0, 0);
        if (playerMode === 2) {
          camera2.position.set(Math.cos(t + 1) * 160, 80, Math.sin(t + 1) * 160);
          camera2.lookAt(0, 0, 0);
        }
      }
      render();
    }
  } else {
    render();
  }
  updateGameAudio(dt);
  requestAnimationFrame(frame);
}

// Boot — warm GPU / traffic pool, then load player car models
(async function boot() {
  setLoad(0.55, "Warming traffic pool…");
  await yieldToMain();
  warmTrafficPrototypes(TRAFFIC_TYPES);
  await yieldToMain();

  setLoad(0.7, "Loading car models…");
  await loadCarModels();
  await yieldToMain();

  setLoad(0.9, "Compiling shaders…");
  warmRenderer(renderer, scene, camera1);
  await yieldToMain();

  setLoad(0.95, "Ready");
  const restored = tryRestoreSession();
  if (!restored) setPlayerMode(1, { persist: false });
  applyQualitySettings();
  resetPlayers();
  state = "menu";
  applyModeUI();
  loadingEl.classList.add("hidden");
  if (restored && currentEmail) {
    authScreen?.classList.add("hidden");
    startScreen.classList.remove("hidden");
    updateProfileUI();
  } else {
    startScreen.classList.add("hidden");
    authScreen?.classList.remove("hidden");
    if (authEmailInput) authEmailInput.focus();
  }
  lastTs = performance.now();
  requestAnimationFrame(frame);
  setLoad(1, "Ready");
})();
