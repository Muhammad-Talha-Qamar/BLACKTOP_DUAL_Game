# Blacktop Dual — Police Chase

Split-screen getaway game inspired by [Blacktop Police Chase](https://poki.com/en/g/blacktop-police-chase).

Pick up bank robbers, outrun the cops, deliver them to safehouses for cash, and unlock faster cars.

## Run

```bash
cd "First Game"
python3 -m http.server 8765
```

Open http://localhost:8765

> Desktop / laptop only. Mobile widths show an unsupported-device screen.

## Project layout

```
index.html          UI shells (auth, start, garage, HUD)
styles.css          Layout + responsive desktop scaling
game.js             Core gameplay loop, city, players, cops
js/
  config.js         Traffic / quality tuning knobs
  performance.js    Frame budget, yield helpers, shader warm-up
  traffic-mesh.js   Lean pooled traffic meshes (shared materials)
assets/cars/        Player GLB models (Kenney + realistic)
```

Graphics stay on **Three.js / WebGL** in the browser. Other languages (Rust/WASM, etc.) would mostly help CPU AI, not the GPU render path this game is bound by — so performance work focuses on fewer draw calls, shared materials, and frame budgets instead of a full engine rewrite.

## How to play

1. Drive to a **green** robber marker and pick them up  
2. **Cops** spawn and chase you (wanted banner)  
3. Reach a **gold** safehouse to cash out  
4. Open the **garage (G)** to buy / equip faster rides  

### Controls

| | P1 | P2 |
|--|----|----|
| Drive | WASD | Arrow keys |
| Reverse / Drift | S | ↓ |
| Look back | C | `/` |
| Reset | Shift | `.` |
| Pause | Esc / P | Esc / P |
| Garage | G | G |

## Features

- Open city grid with buildings and street lamps  
- Split-screen third-person cameras  
- Dense civilian traffic (lean meshes, pooled prototypes, frame-budgeted AI)  
- Police chase AI, sirens, roadblocks  
- Shared cash pool + car unlocks  
- Heat system and bust / reset flow  
- Adaptive quality (pixel ratio / smoke) when frames drop  

## Car models

Garage / player cars each use a distinct high-detail free GLB in `assets/cars/realistic/`
(sedan starter, luxury sedan, hot hatch, muscle, Corvette, GT), with Kenney Car Kit files as fallback.
See `assets/cars/realistic/ATTRIBUTION.txt` for credits.
