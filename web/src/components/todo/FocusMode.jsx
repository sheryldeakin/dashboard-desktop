import { useEffect, useState, useRef, useMemo, useCallback } from "react";
import { formatDuration, formatClock, getLiveDurations } from "../../utils/taskUtils.js";

/* ── Theme / Character / Environment presets ── */

const COLOR_SCHEMES = [
  { id: "sunset", label: "Sunset",
    sky: ["#0e0e2a","#1a1a3e","#2d2b5e","#3f3570","#5a4888","#7b5e99","#a0776e","#c08b6e","#d8a474","#e6b87a","#f0d4a0"],
    restSky: ["#080f1a","#0d1b2a","#152535","#1b2838","#1f3448","#234058","#2a5070","#326070","#3a6a80","#5a8a8a","#7aaa9a"],
    ground: { fill: "#3d2f52", edge: "#4d3d68", grass: "#5a4870", restFill: "#243840", restEdge: "#2e4e56", restGrass: "#2a4a50" },
    desertGround: { fill: "#c8a070", edge: "#d8b080", grass: "#b89060", restFill: "#5a6870", restEdge: "#687880", restGrass: "#506068" },
    mtns: ["#5a4a78","#3a2a50","#4a3560","#352848"], restMtns: ["#2a3a50","#1a3040","#223848","#162838"],
    trees: ["60,45,80","50,38,65","45,32,60"], restTrees: ["30,50,60","28,48,55","25,45,50"],
    flowerWarm: "232,128,96", flowerCool: "160,128,208", restFlowerWarm: "128,160,192", restFlowerCool: "96,144,168" },
  { id: "aurora", label: "Aurora",
    sky: ["#050818","#0a1228","#10203a","#163050","#1a4a5a","#1e6060","#4a8060","#90886a","#c8a070","#e0be80","#f0d8a0"],
    restSky: ["#04060e","#080e1a","#0e1828","#142238","#1a2c48","#1e3650","#224058","#284a60","#305468","#3a6070","#4a7080"],
    ground: { fill: "#1a3828", edge: "#285038", grass: "#2a5a38", restFill: "#182830", restEdge: "#203840", restGrass: "#1e3838" },
    desertGround: { fill: "#b8a878", edge: "#c8b888", grass: "#a89868", restFill: "#485860", restEdge: "#586868", restGrass: "#405058" },
    mtns: ["#2a5848","#1a4030","#205038","#183828"], restMtns: ["#1a3040","#142838","#182e38","#122430"],
    trees: ["20,60,40","25,55,45","30,50,40"], restTrees: ["20,40,50","22,42,48","18,38,44"],
    flowerWarm: "160,220,120", flowerCool: "100,200,180", restFlowerWarm: "100,150,140", restFlowerCool: "80,130,120" },
  { id: "dawn", label: "Dawn",
    sky: ["#1a0a2e","#2a1040","#3a1850","#501e58","#6a2858","#883858","#a85860","#c07868","#d8a070","#e6bc7a","#f0d4a0"],
    restSky: ["#0a0810","#10101e","#181828","#1e1e34","#262840","#2e3050","#343a58","#3c4460","#444e68","#505a70","#606878"],
    ground: { fill: "#4a2838", edge: "#5c3848", grass: "#6a3850", restFill: "#282030", restEdge: "#342840", restGrass: "#302838" },
    desertGround: { fill: "#c89880", edge: "#d8a890", grass: "#b88870", restFill: "#584858", restEdge: "#685868", restGrass: "#504050" },
    mtns: ["#6a3858","#4a2040","#5a2850","#3a1838"], restMtns: ["#302040","#281838","#2c1c3c","#201430"],
    trees: ["80,40,60","70,35,55","60,30,50"], restTrees: ["40,30,50","36,28,48","32,26,44"],
    flowerWarm: "240,160,140", flowerCool: "200,140,180", restFlowerWarm: "140,120,160", restFlowerCool: "120,100,140" },
  { id: "ocean", label: "Ocean",
    sky: ["#020a18","#041428","#082038","#0e3050","#184060","#225068","#48706e","#88806c","#c09870","#e0b87a","#f0d4a0"],
    restSky: ["#020608","#040c14","#081420","#0e1c2c","#142438","#1a2c44","#203450","#283c58","#304460","#384c68","#405470"],
    ground: { fill: "#1a3048", edge: "#244058", grass: "#2a4860", restFill: "#141e2c", restEdge: "#1c2838", restGrass: "#182430" },
    desertGround: { fill: "#b0a080", edge: "#c0b090", grass: "#a09070", restFill: "#404858", restEdge: "#505868", restGrass: "#384050" },
    mtns: ["#284868","#183858","#204060","#143050"], restMtns: ["#142030","#101828","#121c2c","#0e1620"],
    trees: ["25,50,70","22,45,65","20,40,60"], restTrees: ["18,30,45","16,28,42","14,24,38"],
    flowerWarm: "120,180,200", flowerCool: "100,160,210", restFlowerWarm: "80,120,150", restFlowerCool: "70,100,140" },
  { id: "sand", label: "Sand",
    sky: ["#2a1c10","#3e2c1c","#4b2f1c","#6a4a2c","#7f5a3a","#9a7451","#b66e35","#d9a165","#e8c9a0","#f0e5d3","#f8f3ea"],
    restSky: ["#1a1410","#28201a","#362a22","#44362c","#524236","#604e40","#705c4a","#806a56","#907a64","#a08a74","#b09a84"],
    ground: { fill: "#4b2f1c", edge: "#6a4a2c", grass: "#7f5a3a", restFill: "#362a1c", restEdge: "#443824", restGrass: "#40341e" },
    desertGround: { fill: "#d9a165", edge: "#e0b87a", grass: "#c89050", restFill: "#6a5a44", restEdge: "#7a6a54", restGrass: "#5a4a38" },
    mtns: ["#9a7451","#7f5a3a","#8a6444","#6a4a2c"], restMtns: ["#4a3c2c","#403424","#44382a","#382e20"],
    trees: ["120,90,60","107,78,50","90,66,42"], restTrees: ["64,52,42","56,46,36","48,38,30"],
    flowerWarm: "217,161,101", flowerCool: "182,110,53", restFlowerWarm: "160,130,100", restFlowerCool: "140,110,80" },
];

const CHARACTERS = [
  { id: "hiker", label: "Hiker" },
  { id: "cat", label: "Cat" },
  { id: "dog", label: "Dog" },
  { id: "fox", label: "Fox" },
];

const ENVIRONMENTS = [
  { id: "mountains", label: "Mountains" },
  { id: "desert", label: "Desert" },
];

const FOCUS_SETTINGS_KEY = "focus_mode_settings";

function loadSettings() {
  try {
    const raw = localStorage.getItem(FOCUS_SETTINGS_KEY);
    if (raw) return JSON.parse(raw);
  } catch {}
  return { colorScheme: "sunset", character: "hiker", environment: "mountains" };
}

function saveSettings(s) {
  localStorage.setItem(FOCUS_SETTINGS_KEY, JSON.stringify(s));
}

/* ── Settings panel ── */
function FocusSettings({ settings, onChange, onClose }) {
  function set(key, val) {
    const next = { ...settings, [key]: val };
    onChange(next);
    saveSettings(next);
  }

  return (
    <div className="focus-settings-overlay" onClick={onClose}>
      <div className="focus-settings-panel" onClick={(e) => e.stopPropagation()}>
        <div className="focus-settings-header">
          <h3 className="focus-settings-title">Settings</h3>
          <button type="button" className="focus-settings-close" onClick={onClose}>
            <svg viewBox="0 0 24 24" width="18" height="18"><path d="M18 6L6 18M6 6l12 12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>
          </button>
        </div>

        <div className="focus-settings-section">
          <h4 className="focus-settings-label">Color Scheme</h4>
          <div className="focus-settings-options">
            {COLOR_SCHEMES.map((s) => (
              <button key={s.id} type="button"
                className={`focus-settings-swatch ${settings.colorScheme === s.id ? "is-active" : ""}`}
                onClick={() => set("colorScheme", s.id)}>
                <span className="focus-swatch-preview" style={{
                  background: `linear-gradient(180deg, ${s.sky[0]}, ${s.sky[5]}, ${s.sky[10]})`
                }} />
                <span className="focus-swatch-label">{s.label}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="focus-settings-section">
          <h4 className="focus-settings-label">Character</h4>
          <div className="focus-settings-options">
            {CHARACTERS.map((c) => (
              <button key={c.id} type="button"
                className={`focus-settings-option ${settings.character === c.id ? "is-active" : ""}`}
                onClick={() => set("character", c.id)}>
                {c.label}
              </button>
            ))}
          </div>
        </div>

        <div className="focus-settings-section">
          <h4 className="focus-settings-label">Environment</h4>
          <div className="focus-settings-options">
            {ENVIRONMENTS.map((e) => (
              <button key={e.id} type="button"
                className={`focus-settings-option ${settings.environment === e.id ? "is-active" : ""}`}
                onClick={() => set("environment", e.id)}>
                {e.label}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ── Scrolling SVG landscape layers (parallax) ── */

/* Distant tall peaks — asymmetric, one wide + one narrow per half */
function MountainFar() {
  return (
    <div className="focus-parallax focus-parallax-far">
      <svg className="focus-parallax-svg" viewBox="0 0 2880 320" preserveAspectRatio="none">
        <path d="M0,320 L0,160 Q200,30 520,110 Q640,170 840,50 Q1060,130 1440,160 Q1640,30 1960,110 Q2080,170 2280,50 Q2500,130 2880,160 L2880,320 Z" />
      </svg>
    </div>
  );
}

/* Back mountains — mixed wide plateau + sharp peak + gentle slope */
function MountainBack() {
  return (
    <div className="focus-parallax focus-parallax-back">
      <svg className="focus-parallax-svg" viewBox="0 0 2880 320" preserveAspectRatio="none">
        <path d="M0,320 L0,180 Q150,70 400,120 Q520,160 700,90 Q800,140 1100,170 Q1300,60 1440,180 Q1590,70 1840,120 Q1960,160 2140,90 Q2240,140 2540,170 Q2740,60 2880,180 L2880,320 Z" />
      </svg>
    </div>
  );
}

/* Mid mountains — one broad + one tall narrow + gentle valley */
function MountainMid() {
  return (
    <div className="focus-parallax focus-parallax-mid">
      <svg className="focus-parallax-svg" viewBox="0 0 2880 320" preserveAspectRatio="none">
        <path d="M0,320 L0,200 Q280,100 600,180 Q740,190 900,110 Q1000,160 1200,200 Q1350,140 1440,200 Q1720,100 2040,180 Q2180,190 2340,110 Q2440,160 2640,200 Q2790,140 2880,200 L2880,320 Z" />
      </svg>
    </div>
  );
}

/* Front mountains — rolling foothills, varied widths */
function MountainFront() {
  return (
    <div className="focus-parallax focus-parallax-front">
      <svg className="focus-parallax-svg" viewBox="0 0 2880 320" preserveAspectRatio="none">
        <path d="M0,320 L0,255 Q180,210 500,245 Q600,250 740,200 Q850,240 1100,255 Q1280,220 1440,255 Q1620,210 1940,245 Q2040,250 2180,200 Q2290,240 2540,255 Q2720,220 2880,255 L2880,320 Z" />
      </svg>
    </div>
  );
}

function Ground({ isWalking }) {
  // Compute exact y on the hill bezier slope at any x (0–400)
  const grassBlades = useMemo(() => {
    function slopeY(x) {
      const segs = [
        [0, 60, 55, 100, 48],
        [100, 48, 42, 200, 35],
        [200, 35, 30, 300, 24],
        [300, 24, 20, 400, 16],
      ];
      const s = segs.find(s => x >= s[0] && x <= s[3]) || segs[segs.length - 1];
      const t = (x - s[0]) / (s[3] - s[0]);
      return (1 - t) * (1 - t) * s[1] + 2 * (1 - t) * t * s[2] + t * t * s[4];
    }
    // Seeded PRNG for deterministic placement
    let seed = 42;
    function rand() { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; }

    const blades = [];
    let id = 0;
    const lift = -1; // nestle bases into the slope surface
    function blade(x, y, h, sw, layer) {
      const lean = (rand() - 0.5) * (layer === 0 ? 2 : 3);
      const curve = (rand() - 0.5) * h * 0.6; // arc control offset
      blades.push({ id: id++, x, y, h, lean, curve, sw, layer });
    }
    // Background: thin, faint
    for (let x = 6; x < 398; x += 16 + rand() * 10) {
      blade(x, slopeY(x) - lift, 4 + rand() * 3, 0.7, 0);
    }
    // Midground: taller, varied
    for (let x = 3; x < 398; x += 10 + rand() * 8) {
      blade(x, slopeY(x) - lift, 6 + rand() * 4, 0.9 + rand() * 0.2, 1);
    }
    // Foreground: tall tufts in clusters of 2–3
    for (let x = 8; x < 396; x += 20 + rand() * 18) {
      const y = slopeY(x) - lift;
      const count = 2 + Math.floor(rand() * 2);
      for (let j = 0; j < count; j++) {
        const dx = (j - (count - 1) / 2) * 2;
        blade(x + dx, slopeY(x + dx) - lift, 9 + rand() * 5, 1 + rand() * 0.4, 2);
      }
    }
    return blades;
  }, []);

  const layerOpacity = [0.3, 0.45, 0.6];

  return (
    <div className="focus-layer focus-layer-ground">
      <div className={`focus-hill ${isWalking ? "is-scrolling" : ""}`}>
        <svg className="focus-hill-svg" viewBox="0 0 400 100" preserveAspectRatio="none">
          <path d="M0,100 L0,60 Q50,55 100,48 Q150,42 200,35 Q250,30 300,24 Q350,20 400,16 L400,100 Z" />
          <path d="M0,60 Q50,55 100,48 Q150,42 200,35 Q250,30 300,24 Q350,20 400,16 L400,19 Q350,23 300,27 Q250,33 200,38 Q150,45 100,51 Q50,58 0,63 Z" className="hill-edge" />
        </svg>
      </div>
      <div className={`focus-hill-texture ${isWalking ? "is-scrolling" : ""}`}>
        <svg className="focus-hill-texture-svg" viewBox="0 0 400 100" preserveAspectRatio="none">
          {[0, 1, 2].map((layer) => (
            <g key={layer} opacity={layerOpacity[layer]} stroke="currentColor" strokeLinecap="round">
              {grassBlades.filter((b) => b.layer === layer).map((b) => (
                <path key={b.id} fill="none" strokeWidth={b.sw}
                  d={`M${b.x},${b.y} Q${b.x + b.curve},${b.y - b.h * 0.55} ${b.x + b.lean},${b.y - b.h}`} />
              ))}
            </g>
          ))}
        </svg>
      </div>
    </div>
  );
}

function Stars() {
  const stars = useMemo(() => {
    const s = [];
    for (let i = 0; i < 45; i++) {
      s.push({
        id: i,
        left: `${Math.random() * 100}%`,
        top: `${2 + Math.random() * 38}%`,
        size: 1 + Math.random() * 1.5,
        delay: Math.random() * 5,
        duration: 2 + Math.random() * 3,
      });
    }
    for (let i = 0; i < 6; i++) {
      s.push({
        id: 50 + i,
        left: `${8 + Math.random() * 84}%`,
        top: `${3 + Math.random() * 25}%`,
        size: 2.5 + Math.random() * 1.5,
        delay: Math.random() * 3,
        duration: 4 + Math.random() * 2,
        bright: true,
      });
    }
    return s;
  }, []);

  return (
    <div className="focus-stars">
      {stars.map((s) => (
        <span
          key={s.id}
          className={`focus-star${s.bright ? " focus-star-bright" : ""}`}
          style={{
            left: s.left,
            top: s.top,
            width: s.size,
            height: s.size,
            animationDelay: `${s.delay}s`,
            animationDuration: `${s.duration}s`,
          }}
        />
      ))}
    </div>
  );
}

function Clouds() {
  const clouds = useMemo(() => [
    { id: 0, top: "12%", w: 240, h: 80, dur: 90, delay: 0, op: 0.25 },
    { id: 1, top: "8%", w: 160, h: 60, dur: 110, delay: -85, op: 0.15 },
    { id: 2, top: "22%", w: 290, h: 95, dur: 80, delay: -30, op: 0.2 },
    { id: 3, top: "16%", w: 130, h: 48, dur: 100, delay: -60, op: 0.12 },
    { id: 4, top: "26%", w: 210, h: 72, dur: 95, delay: -48, op: 0.18 },
    { id: 5, top: "30%", w: 180, h: 65, dur: 85, delay: -70, op: 0.15 },
    { id: 6, top: "10%", w: 200, h: 68, dur: 105, delay: -15, op: 0.14 },
    { id: 7, top: "20%", w: 170, h: 58, dur: 75, delay: -55, op: 0.16 },
    { id: 8, top: "28%", w: 150, h: 52, dur: 120, delay: -95, op: 0.13 },
  ], []);

  return (
    <div className="focus-clouds">
      {clouds.map((c) => (
        <div
          key={c.id}
          className="focus-cloud"
          style={{
            top: c.top,
            width: c.w,
            height: c.h,
            animationDuration: `${c.dur}s`,
            animationDelay: `${c.delay}s`,
            opacity: c.op,
          }}
        >
          <svg viewBox="0 0 200 80" className="focus-cloud-svg">
            <ellipse cx="60" cy="52" rx="45" ry="22" />
            <ellipse cx="100" cy="46" rx="38" ry="20" />
            <ellipse cx="140" cy="52" rx="42" ry="22" />
            <ellipse cx="80" cy="38" rx="32" ry="18" />
            <ellipse cx="120" cy="40" rx="28" ry="16" />
          </svg>
        </div>
      ))}
    </div>
  );
}

/* ── Atmospheric haze between mountain layers ── */
function Haze() {
  return (
    <>
      <div className="focus-haze focus-haze-1" />
      <div className="focus-haze focus-haze-2" />
      <div className="focus-haze focus-haze-3" />
    </>
  );
}

/* ── Ambient floating particles (fireflies / motes) ── */
function Particles() {
  const motes = useMemo(() =>
    Array.from({ length: 25 }, (_, i) => ({
      id: i,
      left: `${Math.random() * 100}%`,
      top: `${15 + Math.random() * 55}%`,
      size: 2 + Math.random() * 3,
      duration: 6 + Math.random() * 10,
      delay: Math.random() * 8,
      driftX: -30 + Math.random() * 60,
      driftY: -(15 + Math.random() * 25),
    })), []);

  return (
    <div className="focus-particles">
      {motes.map((p) => (
        <span
          key={p.id}
          className="focus-particle"
          style={{
            left: p.left,
            top: p.top,
            width: p.size,
            height: p.size,
            animationDuration: `${p.duration}s`,
            animationDelay: `${p.delay}s`,
            "--drift-x": `${p.driftX}px`,
            "--drift-y": `${p.driftY}px`,
          }}
        />
      ))}
    </div>
  );
}

/* ── 8-frame sprite hiker (stationary, centered) ──
   Color palette:
     Skin  #e8c9a0   Hat   #3b6b4a (forest green)
     Jacket #4a6d8c  Pants #3a3545   Boots #2a2028
     Backpack #8b6940 / #a07848   Stick #c4a672
     Scarf  #c45c4a
*/

const COL = {
  skin: "#e8c9a0", hair: "#6b4a30",
  hat: "#3b6b4a", hatBand: "#c45c4a",
  jacket: "#4a6d8c", jacketDark: "#3d5a72", jacketLight: "#5a80a0",
  pants: "#3a3545", pantsDark: "#2e2938",
  boots: "#2a2028",
  pack: "#8b6940", packLight: "#a07848", packStrap: "#6b5030",
  stick: "#c4a672", stickDark: "#9a8050",
  scarf: "#c45c4a",
};

function Hiker({ isWalking, isResting }) {
  const F = 80;
  const W = 60;
  const BX = 28; // body center x
  const HIP_Y = 47;
  const SH_Y = 27; // shoulder y

  // Side-view walk cycle. Character faces RIGHT, viewed from their left side.
  // Arms swing opposite to legs (natural gait).
  const frames = [
    // 1 Contact: near leg fwd, near arm back
    { dy: 1,
      nearKnee: [34, 59], nearFoot: [38, 74],
      farKnee: [22, 59], farFoot: [18, 74],
      nearHand: [20, 44], farHand: [36, 44] },
    // 2 Down
    { dy: 2,
      nearKnee: [32, 61], nearFoot: [35, 74],
      farKnee: [24, 59], farFoot: [22, 72],
      nearHand: [23, 43], farHand: [34, 43] },
    // 3 Passing (standing pose)
    { dy: -1,
      nearKnee: [29, 60], nearFoot: [29, 74],
      farKnee: [28, 60], farFoot: [28, 72],
      nearHand: [27, 41], farHand: [30, 41] },
    // 4 Up
    { dy: -2,
      nearKnee: [24, 61], nearFoot: [20, 74],
      farKnee: [33, 59], farFoot: [37, 72],
      nearHand: [35, 42], farHand: [22, 44] },
    // 5 Contact: far leg fwd, near arm fwd
    { dy: 1,
      nearKnee: [22, 59], nearFoot: [18, 74],
      farKnee: [34, 59], farFoot: [38, 74],
      nearHand: [36, 44], farHand: [20, 44] },
    // 6 Down
    { dy: 2,
      nearKnee: [24, 59], nearFoot: [22, 72],
      farKnee: [32, 61], farFoot: [35, 74],
      nearHand: [34, 43], farHand: [23, 43] },
    // 7 Passing
    { dy: -1,
      nearKnee: [28, 60], nearFoot: [28, 72],
      farKnee: [29, 60], farFoot: [29, 74],
      nearHand: [30, 41], farHand: [27, 41] },
    // 8 Up
    { dy: -2,
      nearKnee: [33, 59], nearFoot: [37, 72],
      farKnee: [24, 61], farFoot: [20, 74],
      nearHand: [22, 44], farHand: [35, 42] },
  ];

  const FRAME_COUNT = frames.length;
  const totalH = F * FRAME_COUNT;

  return (
    <div className={`focus-hiker ${isWalking ? "is-walking" : ""} ${isResting ? "is-resting" : ""}`}>
      <div className="hiker-sprite">
        <svg viewBox={`0 0 ${W} ${totalH}`} className="hiker-sprite-sheet"
          aria-hidden="true" style={{ "--hiker-frames": FRAME_COUNT }}>
          {frames.map((f, i) => {
            const yo = i * F;
            const by = yo + f.dy;
            const stickInFront = f.nearHand[0] >= BX;

            const stickEl = (
              <g key="stick">
                <line x1={f.nearHand[0]} y1={f.nearHand[1] + by}
                  x2={f.nearHand[0] + 5} y2={74 + yo}
                  stroke={COL.stick} strokeWidth="2" strokeLinecap="round" />
                <line x1={f.nearHand[0]} y1={f.nearHand[1] + by}
                  x2={f.nearHand[0] + 5} y2={74 + yo}
                  stroke={COL.stickDark} strokeWidth="1" strokeLinecap="round"
                  strokeDasharray="0 4 2 4" />
              </g>
            );

            return (
              <g key={i}>
                {/* Stick behind body when hand swings back */}
                {!stickInFront && stickEl}

                {/* Far arm (behind body) */}
                <line x1={BX} y1={SH_Y + by} x2={f.farHand[0]} y2={f.farHand[1] + by}
                  stroke={COL.jacketDark} strokeWidth="3" strokeLinecap="round" />
                <circle cx={f.farHand[0]} cy={f.farHand[1] + by} r="1.8" fill={COL.skin} />

                {/* Far leg (darker, behind body) */}
                <line x1={BX} y1={HIP_Y + yo} x2={f.farKnee[0]} y2={f.farKnee[1] + yo}
                  stroke={COL.pantsDark} strokeWidth="5" strokeLinecap="round" />
                <line x1={f.farKnee[0]} y1={f.farKnee[1] + yo} x2={f.farFoot[0]} y2={f.farFoot[1] + yo}
                  stroke={COL.pantsDark} strokeWidth="4" strokeLinecap="round" />
                <ellipse cx={f.farFoot[0]} cy={f.farFoot[1] + yo + 0.5} rx="3.5" ry="2" fill={COL.boots} />

                {/* Backpack (on the back = LEFT side) */}
                <rect x={BX - 10} y={23 + by} width="8" height="15" rx="2.5" fill={COL.pack} />
                <rect x={BX - 9} y={21 + by} width="6" height="4" rx="1.5" fill={COL.packLight} />
                <line x1={BX - 3} y1={25 + by} x2={BX - 1} y2={28 + by}
                  stroke={COL.packStrap} strokeWidth="1" strokeLinecap="round" />

                {/* Torso (narrow side view) */}
                <path d={`M${BX - 3},${24 + by} L${BX - 3},${HIP_Y + yo} L${BX + 3},${HIP_Y + yo} L${BX + 3},${24 + by} Z`}
                  fill={COL.jacket} />
                <line x1={BX + 2} y1={25 + by} x2={BX + 2} y2={46 + yo}
                  stroke={COL.jacketDark} strokeWidth="0.6" />

                {/* Near leg (in front) */}
                <line x1={BX} y1={HIP_Y + yo} x2={f.nearKnee[0]} y2={f.nearKnee[1] + yo}
                  stroke={COL.pants} strokeWidth="5.5" strokeLinecap="round" />
                <line x1={f.nearKnee[0]} y1={f.nearKnee[1] + yo} x2={f.nearFoot[0]} y2={f.nearFoot[1] + yo}
                  stroke={COL.pants} strokeWidth="4.5" strokeLinecap="round" />
                <ellipse cx={f.nearFoot[0]} cy={f.nearFoot[1] + yo + 0.5} rx="3.5" ry="2" fill={COL.boots} />

                {/* Near arm (in front) */}
                <line x1={BX} y1={SH_Y + by} x2={f.nearHand[0]} y2={f.nearHand[1] + by}
                  stroke={COL.jacket} strokeWidth="3.5" strokeLinecap="round" />
                <circle cx={f.nearHand[0]} cy={f.nearHand[1] + by} r="2" fill={COL.skin} />

                {/* Neck (shifted right for side profile) */}
                <rect x={BX} y={18 + by} width="4" height="7" rx="1.5" fill={COL.skin} />

                {/* Scarf — tail trails behind (left) */}
                <path d={`M${BX - 2},${22 + by} Q${BX + 2},${20 + by} ${BX + 5},${22 + by}`}
                  fill="none" stroke={COL.scarf} strokeWidth="2.5" strokeLinecap="round" />
                <path d={`M${BX - 2},${22 + by} Q${BX - 6},${26 + by} ${BX - 4},${30 + by}`}
                  fill="none" stroke={COL.scarf} strokeWidth="2" strokeLinecap="round" />

                {/* Head (side profile — shifted forward/right, no face) */}
                <circle cx={BX + 3} cy={12 + by} r="6.5" fill={COL.skin} />

                {/* Hair on back of head */}
                <path d={`M${BX - 3},${14 + by} Q${BX - 4},${9 + by} ${BX},${7 + by} Q${BX + 3},${6 + by} ${BX + 6},${8 + by}`}
                  fill={COL.hair} />

                {/* Hat (side view — dome + forward-extending brim) */}
                <path d={`M${BX - 3},${8 + by} Q${BX - 3},${2 + by} ${BX + 3},${1 + by} Q${BX + 9},${2 + by} ${BX + 9},${8 + by}`}
                  fill={COL.hat} />
                <path d={`M${BX - 4},${8.5 + by} L${BX + 13},${8.5 + by}`}
                  stroke={COL.hat} strokeWidth="2.5" strokeLinecap="round" />
                <line x1={BX - 3} y1={7 + by} x2={BX + 9} y2={7 + by}
                  stroke={COL.hatBand} strokeWidth="1.2" />

                {/* Stick in front of body when hand swings forward */}
                {stickInFront && stickEl}
              </g>
            );
          })}
        </svg>
      </div>
    </div>
  );
}

/* ── Quadruped walk frames ──
   Hand-tuned 8-frame diagonal gait. Feet stay on ground (footY constant),
   only x shifts for stride. Minimal body bounce (0-1px).
   frontX/backX are offsets from the base leg position.
*/
/* Each leg: [footDx, footLift, kneeDx, kneeLift]
   footDx = horizontal offset from base, footLift = how high foot lifts (0=ground),
   kneeDx/kneeLift = knee position relative to hip.
   Diagonal gait: nearFront+farBack swing together, farFront+nearBack together. */
const QUAD_FRAMES = [
  // 1: NF reaching, FF planted back, NB reaching, FB planted back
  { nf: [7, -4, 5, -3], ff: [-5, 0, -3, -2], nb: [-5, 0, -3, -2], fb: [7, -4, 5, -3], dy: 0, tail: 0.3 },
  // 2: NF landing, FF pushing, NB pushing, FB landing
  { nf: [6, -1, 4, -3], ff: [-3, 0, -2, -2], nb: [-3, 0, -2, -2], fb: [6, -1, 4, -3], dy: 1, tail: 0.15 },
  // 3: NF planted, FF mid-swing up, NB mid-swing up, FB planted
  { nf: [3, 0, 2, -2], ff: [0, -3, 0, -3], nb: [0, -3, 0, -3], fb: [3, 0, 2, -2], dy: 0, tail: 0 },
  // 4: NF pushing back, FF reaching, NB reaching, FB pushing back
  { nf: [-3, 0, -2, -2], ff: [6, -4, 4, -3], nb: [6, -4, 4, -3], fb: [-3, 0, -2, -2], dy: -1, tail: -0.15 },
  // 5: mirror of 1
  { nf: [-5, 0, -3, -2], ff: [7, -4, 5, -3], nb: [7, -4, 5, -3], fb: [-5, 0, -3, -2], dy: 0, tail: -0.3 },
  // 6: mirror of 2
  { nf: [-3, 0, -2, -2], ff: [6, -1, 4, -3], nb: [6, -1, 4, -3], fb: [-3, 0, -2, -2], dy: 1, tail: -0.15 },
  // 7: mirror of 3
  { nf: [0, -3, 0, -3], ff: [3, 0, 2, -2], nb: [3, 0, 2, -2], fb: [0, -3, 0, -3], dy: 0, tail: 0 },
  // 8: mirror of 4
  { nf: [6, -4, 4, -3], ff: [-3, 0, -2, -2], nb: [-3, 0, -2, -2], fb: [6, -4, 4, -3], dy: -1, tail: 0.15 },
];

/* Renders a two-segment quadruped leg with knee bend */
function quadLeg(baseX, hipY, footY, leg, yo, stroke, sw) {
  const [fdx, flift, kdx, klift] = leg;
  const fx = baseX + fdx;
  const fy = footY + flift + yo;
  const kx = baseX + kdx;
  const ky = hipY + (footY - hipY) * 0.5 + klift + yo;
  return (
    <>
      <line x1={baseX} y1={hipY + yo} x2={kx} y2={ky} stroke={stroke} strokeWidth={sw} strokeLinecap="round" />
      <line x1={kx} y1={ky} x2={fx} y2={fy} stroke={stroke} strokeWidth={sw} strokeLinecap="round" />
    </>
  );
}

/* ── Cat character ── */
function Cat({ isWalking, isResting }) {
  const F = 50; const W = 60;
  const FX = 42; const BKX = 18; const FY = 38;
  const FRAME_COUNT = QUAD_FRAMES.length;

  return (
    <div className={`focus-hiker focus-hiker-animal ${isWalking ? "is-walking" : ""} ${isResting ? "is-resting" : ""}`}>
      <div className="hiker-sprite">
        <svg viewBox={`0 0 ${W} ${F * FRAME_COUNT}`} className="hiker-sprite-sheet"
          preserveAspectRatio="none" aria-hidden="true" style={{ "--hiker-frames": FRAME_COUNT }}>
          {QUAD_FRAMES.map((f, i) => {
            const yo = i * F;
            const bodyY = 24 + f.dy;
            const hipY = bodyY + 5;
            const tw = f.tail * 8;
            return (
              <g key={i}>
                {/* Tail */}
                <path d={`M${14},${bodyY + 2 + yo} Q${6},${bodyY - 4 + tw + yo} ${4},${bodyY - 10 + tw + yo}`}
                  fill="none" stroke="#4a4048" strokeWidth="2.5" strokeLinecap="round" />
                {/* Far legs */}
                {quadLeg(BKX, hipY, FY, f.fb, yo, "#3a3538", 2.5)}
                {quadLeg(FX, hipY, FY, f.ff, yo, "#3a3538", 2.5)}
                {/* Body */}
                <ellipse cx={30} cy={bodyY + yo} rx="16" ry="8" fill="#4a4048" />
                {/* Near legs */}
                {quadLeg(BKX, hipY, FY, f.nb, yo, "#4a4048", 3)}
                {quadLeg(FX, hipY, FY, f.nf, yo, "#4a4048", 3)}
                {/* Head */}
                <circle cx={46} cy={bodyY - 5 + yo} r="6" fill="#4a4048" />
                {/* Ears */}
                <path d={`M${42},${bodyY - 10 + yo} L${40},${bodyY - 17 + yo} L${44},${bodyY - 12 + yo}`} fill="#4a4048" />
                <path d={`M${46},${bodyY - 10 + yo} L${48},${bodyY - 17 + yo} L${50},${bodyY - 12 + yo}`} fill="#4a4048" />
                <path d={`M${42},${bodyY - 11 + yo} L${41},${bodyY - 15 + yo} L${44},${bodyY - 12 + yo}`} fill="#6a5a60" />
                <path d={`M${47},${bodyY - 11 + yo} L${48},${bodyY - 15 + yo} L${50},${bodyY - 12 + yo}`} fill="#6a5a60" />
                {/* Eye */}
                <circle cx={49} cy={bodyY - 6 + yo} r="1" fill="#a0e8a0" />
                {/* Nose */}
                <circle cx={51} cy={bodyY - 4 + yo} r="0.8" fill="#e8a0a0" />
                {/* Whiskers */}
                <line x1={51} y1={bodyY - 3.5 + yo} x2={56} y2={bodyY - 5 + yo} stroke="#6a6068" strokeWidth="0.4" />
                <line x1={51} y1={bodyY - 3 + yo} x2={56} y2={bodyY - 3 + yo} stroke="#6a6068" strokeWidth="0.4" />
              </g>
            );
          })}
        </svg>
      </div>
    </div>
  );
}

/* ── Dog character ── */
function Dog({ isWalking, isResting }) {
  const F = 55; const W = 65;
  const FX = 46; const BKX = 18; const FY = 42;
  const FRAME_COUNT = QUAD_FRAMES.length;

  return (
    <div className={`focus-hiker focus-hiker-animal ${isWalking ? "is-walking" : ""} ${isResting ? "is-resting" : ""}`}>
      <div className="hiker-sprite">
        <svg viewBox={`0 0 ${W} ${F * FRAME_COUNT}`} className="hiker-sprite-sheet"
          preserveAspectRatio="none" aria-hidden="true" style={{ "--hiker-frames": FRAME_COUNT }}>
          {QUAD_FRAMES.map((f, i) => {
            const yo = i * F;
            const bodyY = 26 + f.dy;
            const hipY = bodyY + 7;
            const tw = f.tail * 10;
            return (
              <g key={i}>
                {/* Tail - curved up */}
                <path d={`M${12},${bodyY + yo} Q${6},${bodyY - 8 + tw + yo} ${8},${bodyY - 16 + tw + yo}`}
                  fill="none" stroke="#b08040" strokeWidth="3" strokeLinecap="round" />
                {/* Far legs */}
                {quadLeg(BKX, hipY, FY, f.fb, yo, "#8a6830", 3)}
                {quadLeg(FX, hipY, FY, f.ff, yo, "#8a6830", 3)}
                {/* Body */}
                <ellipse cx={32} cy={bodyY + yo} rx="18" ry="9" fill="#b08040" />
                {/* Chest lighter patch */}
                <ellipse cx={44} cy={bodyY + 2 + yo} rx="6" ry="5" fill="#c8a050" />
                {/* Near legs */}
                {quadLeg(BKX, hipY, FY, f.nb, yo, "#b08040", 3.5)}
                {quadLeg(FX, hipY, FY, f.nf, yo, "#b08040", 3.5)}
                {/* Paws */}
                <ellipse cx={BKX + f.nb[0]} cy={FY + f.nb[1] + 1 + yo} rx="2.5" ry="1.5" fill="#8a6830" />
                <ellipse cx={FX + f.nf[0]} cy={FY + f.nf[1] + 1 + yo} rx="2.5" ry="1.5" fill="#8a6830" />
                {/* Head */}
                <ellipse cx={50} cy={bodyY - 4 + yo} rx="7" ry="6.5" fill="#b08040" />
                {/* Snout */}
                <ellipse cx={55} cy={bodyY - 2 + yo} rx="4.5" ry="3.5" fill="#c8a050" />
                {/* Ear - floppy */}
                <path d={`M${46},${bodyY - 8 + yo} Q${42},${bodyY - 6 + yo} ${44},${bodyY - 1 + yo}`}
                  fill="#8a6830" stroke="#8a6830" strokeWidth="1" />
                {/* Eye */}
                <circle cx={51} cy={bodyY - 6 + yo} r="1.2" fill="#2a1a10" />
                {/* Nose */}
                <ellipse cx={57} cy={bodyY - 2.5 + yo} rx="1.5" ry="1.2" fill="#2a1a10" />
                {/* Tongue (some frames) */}
                {i % 3 === 0 && <path d={`M${56},${bodyY + yo} Q${57},${bodyY + 3 + yo} ${55},${bodyY + 4 + yo}`}
                  fill="#e07070" stroke="none" />}
                {/* Collar */}
                <path d={`M${44},${bodyY - 1 + yo} Q${48},${bodyY + 1 + yo} ${52},${bodyY - 1 + yo}`}
                  fill="none" stroke="#c04040" strokeWidth="1.5" />
              </g>
            );
          })}
        </svg>
      </div>
    </div>
  );
}

/* ── Fox character ── */
function Fox({ isWalking, isResting }) {
  const F = 50; const W = 65;
  const FX = 44; const BKX = 16; const FY = 38;
  const FRAME_COUNT = QUAD_FRAMES.length;

  return (
    <div className={`focus-hiker focus-hiker-animal ${isWalking ? "is-walking" : ""} ${isResting ? "is-resting" : ""}`}>
      <div className="hiker-sprite">
        <svg viewBox={`0 0 ${W} ${F * FRAME_COUNT}`} className="hiker-sprite-sheet"
          preserveAspectRatio="none" aria-hidden="true" style={{ "--hiker-frames": FRAME_COUNT }}>
          {QUAD_FRAMES.map((f, i) => {
            const yo = i * F;
            const bodyY = 24 + f.dy;
            const hipY = bodyY + 6;
            const tw = f.tail * 6;
            return (
              <g key={i}>
                {/* Bushy tail */}
                <path d={`M${12},${bodyY + 2 + yo} Q${2},${bodyY - 6 + tw + yo} ${4},${bodyY - 14 + tw + yo} Q${8},${bodyY - 16 + tw + yo} ${10},${bodyY - 12 + tw + yo}`}
                  fill="#d87030" stroke="none" />
                {/* White tail tip */}
                <path d={`M${4},${bodyY - 14 + tw + yo} Q${7},${bodyY - 16 + tw + yo} ${10},${bodyY - 12 + tw + yo}`}
                  fill="#f0e0d0" stroke="none" />
                {/* Far legs — dark socks */}
                {quadLeg(BKX, hipY, FY, f.fb, yo, "#1a1210", 2.5)}
                {quadLeg(FX, hipY, FY, f.ff, yo, "#1a1210", 2.5)}
                {/* Body */}
                <ellipse cx={30} cy={bodyY + yo} rx="17" ry="8" fill="#d87030" />
                {/* Belly */}
                <ellipse cx={32} cy={bodyY + 3 + yo} rx="10" ry="4" fill="#f0d0a0" />
                {/* Near legs — dark socks */}
                {quadLeg(BKX, hipY, FY, f.nb, yo, "#1a1210", 3)}
                {quadLeg(FX, hipY, FY, f.nf, yo, "#1a1210", 3)}
                {/* Head */}
                <ellipse cx={48} cy={bodyY - 4 + yo} rx="7" ry="6" fill="#d87030" />
                {/* Face/cheek white */}
                <ellipse cx={50} cy={bodyY - 2 + yo} rx="4" ry="3.5" fill="#f0d0a0" />
                {/* Snout */}
                <path d={`M${52},${bodyY - 3 + yo} L${58},${bodyY - 2 + yo} L${52},${bodyY + yo} Z`} fill="#f0d0a0" />
                {/* Ears */}
                <path d={`M${43},${bodyY - 8 + yo} L${41},${bodyY - 18 + yo} L${46},${bodyY - 10 + yo}`} fill="#d87030" />
                <path d={`M${48},${bodyY - 9 + yo} L${50},${bodyY - 18 + yo} L${52},${bodyY - 10 + yo}`} fill="#d87030" />
                <path d={`M${43},${bodyY - 9 + yo} L${42},${bodyY - 16 + yo} L${45},${bodyY - 10 + yo}`} fill="#1a1210" />
                <path d={`M${49},${bodyY - 10 + yo} L${50},${bodyY - 16 + yo} L${51},${bodyY - 10 + yo}`} fill="#1a1210" />
                {/* Eye */}
                <ellipse cx={50} cy={bodyY - 5 + yo} rx="1.2" ry="1.5" fill="#e8a830" />
                <circle cx={50} cy={bodyY - 5 + yo} r="0.6" fill="#1a1210" />
                {/* Nose */}
                <circle cx={57} cy={bodyY - 2 + yo} r="1.2" fill="#1a1210" />
              </g>
            );
          })}
        </svg>
      </div>
    </div>
  );
}

/* ── Character switcher ── */
function Character({ type, isWalking, isResting }) {
  switch (type) {
    case "cat": return <Cat isWalking={isWalking} isResting={isResting} />;
    case "dog": return <Dog isWalking={isWalking} isResting={isResting} />;
    case "fox": return <Fox isWalking={isWalking} isResting={isResting} />;
    default: return <Hiker isWalking={isWalking} isResting={isResting} />;
  }
}

/* ── Scenery layers — trees, rocks, flowers at multiple depths ── */
function SceneryLayer({ isWalking, layer }) {
  // layer 0 = distant (small, faint, slow), 1 = mid, 2 = near (large, vivid, fast)
  const items = useMemo(() => {
    let seed = 100 + layer * 77;
    function rand() { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; }

    const trees = [];
    let id = 0;
    const count = layer === 0 ? 6 : layer === 1 ? 8 : 5;
    const spacing = 500 / count;

    for (let i = 0; i < count; i++) {
      const x = spacing * i + rand() * spacing * 0.6;
      // type: 0 = round canopy, 1 = pointed conifer, 2 = bushy/wide
      const type = Math.floor(rand() * 3);
      const scale = layer === 0 ? 0.5 + rand() * 0.3
        : layer === 1 ? 0.7 + rand() * 0.4
        : 0.9 + rand() * 0.5;
      // vertical offset — scatter trees at different ground levels
      const groundY = 100 - rand() * (layer === 0 ? 8 : layer === 1 ? 5 : 3);
      trees.push({ id: id++, x, type, scale, groundY, kind: "tree" });
    }

    // Rocks (mid and near layers only)
    if (layer >= 1) {
      const rockCount = 3 + Math.floor(rand() * 2);
      for (let i = 0; i < rockCount; i++) {
        const x = rand() * 490;
        const w = 8 + rand() * 10;
        const h = 6 + rand() * 8;
        trees.push({ id: id++, x, w, h, kind: "rock" });
      }
    }

    // Wildflowers (near layer only)
    if (layer === 2) {
      for (let i = 0; i < 8; i++) {
        const x = rand() * 490;
        trees.push({ id: id++, x, warm: rand() > 0.5, r: 0.7 + rand() * 0.6, kind: "flower" });
      }
    }

    return trees;
  }, [layer]);

  const cls = `focus-scenery focus-scenery-${layer}`;

  return (
    <div className={`${cls} ${isWalking ? "is-scrolling" : ""}`}>
      <svg viewBox="0 0 500 100" preserveAspectRatio="xMidYMax slice" className="focus-scenery-svg">
        {items.map((item) => {
          if (item.kind === "rock") {
            return (
              <path key={item.id} className="gd-rock" fill="currentColor"
                d={`M${item.x},100 Q${item.x - item.w * 0.4},${100 - item.h} ${item.x + item.w * 0.2},${100 - item.h * 1.1} Q${item.x + item.w * 0.6},${100 - item.h * 0.8} ${item.x + item.w},100 Z`} />
            );
          }
          if (item.kind === "flower") {
            return (
              <g key={item.id}>
                <line x1={item.x} y1={100} x2={item.x} y2={95} stroke="currentColor" strokeWidth="0.4" />
                <circle cx={item.x} cy={94.5} r={item.r} className={item.warm ? "flower-warm" : "flower-cool"} />
              </g>
            );
          }
          const { x, type, scale, groundY } = item;
          const trunkH = 30 * scale;
          const trunkW = 3 * scale;
          const topY = groundY - trunkH;
          if (type === 1) {
            // Pointed conifer / pine
            const w = 12 * scale;
            const canopyBottom = groundY - 5 * scale;
            return (
              <g key={item.id}>
                <line x1={x} y1={groundY} x2={x} y2={canopyBottom} stroke="currentColor" strokeWidth={trunkW} strokeLinecap="round" />
                <path d={`M${x},${topY} L${x - w},${canopyBottom} L${x + w},${canopyBottom} Z`} fill="currentColor" />
              </g>
            );
          }
          if (type === 2) {
            // Bushy / wide canopy
            const rx = 16 * scale;
            const ry = 14 * scale;
            const cy = topY + ry * 0.5;
            const canopyBottom = cy + ry;
            return (
              <g key={item.id}>
                <line x1={x} y1={groundY} x2={x} y2={canopyBottom} stroke="currentColor" strokeWidth={trunkW} strokeLinecap="round" />
                <ellipse cx={x} cy={cy} rx={rx} ry={ry} fill="currentColor" />
              </g>
            );
          }
          // Round canopy (default)
          const r = 11 * scale;
          const cy = topY + r * 0.7;
          const canopyBottom = cy + r * 1.3;
          return (
            <g key={item.id}>
              <line x1={x} y1={groundY} x2={x} y2={canopyBottom} stroke="currentColor" strokeWidth={trunkW} strokeLinecap="round" />
              <ellipse cx={x} cy={cy} rx={r} ry={r * 1.3} fill="currentColor" />
            </g>
          );
        })}
      </svg>
    </div>
  );
}

/* ── Desert environment ── */

/* Smooth rolling sand dunes — 4 layers like mountains but with softer curves */
function DuneFar() {
  return (
    <div className="focus-parallax focus-parallax-far">
      <svg className="focus-parallax-svg" viewBox="0 0 2880 320" preserveAspectRatio="none">
        <path d="M0,320 L0,200 Q360,140 720,180 Q1080,220 1440,170 Q1800,140 2160,180 Q2520,220 2880,200 L2880,320 Z" />
      </svg>
    </div>
  );
}

function DuneBack() {
  return (
    <div className="focus-parallax focus-parallax-back">
      <svg className="focus-parallax-svg" viewBox="0 0 2880 320" preserveAspectRatio="none">
        <path d="M0,320 L0,220 Q300,170 660,200 Q900,230 1200,190 Q1440,210 1800,175 Q2100,200 2400,220 Q2700,240 2880,220 L2880,320 Z" />
      </svg>
    </div>
  );
}

function DuneMid() {
  return (
    <div className="focus-parallax focus-parallax-mid">
      <svg className="focus-parallax-svg" viewBox="0 0 2880 320" preserveAspectRatio="none">
        <path d="M0,320 L0,240 Q400,200 800,230 Q1100,250 1440,220 Q1700,200 2040,230 Q2400,250 2880,240 L2880,320 Z" />
      </svg>
    </div>
  );
}

function DuneFront() {
  return (
    <div className="focus-parallax focus-parallax-front">
      <svg className="focus-parallax-svg" viewBox="0 0 2880 320" preserveAspectRatio="none">
        <path d="M0,320 L0,260 Q360,240 720,255 Q1080,270 1440,250 Q1800,240 2160,255 Q2520,270 2880,260 L2880,320 Z" />
      </svg>
    </div>
  );
}

/* Desert ground — flat sandy terrain with pebble texture */
function DesertGround({ isWalking }) {
  const pebbles = useMemo(() => {
    let seed = 99;
    function rand() { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; }
    const p = [];
    for (let i = 0; i < 40; i++) {
      p.push({ id: i, x: rand() * 400, y: 60 + rand() * 38, rx: 1 + rand() * 2.5, ry: 0.6 + rand() * 1.2, op: 0.15 + rand() * 0.2 });
    }
    return p;
  }, []);

  return (
    <div className="focus-layer focus-layer-ground">
      <div className={`focus-hill ${isWalking ? "is-scrolling" : ""}`}>
        <svg className="focus-hill-svg" viewBox="0 0 400 100" preserveAspectRatio="none">
          <path d="M0,100 L0,55 Q100,50 200,48 Q300,46 400,44 L400,100 Z" />
          <path d="M0,55 Q100,50 200,48 Q300,46 400,44 L400,47 Q300,49 200,51 Q100,53 0,58 Z" className="hill-edge" />
        </svg>
      </div>
      <div className={`focus-hill-texture ${isWalking ? "is-scrolling" : ""}`}>
        <svg className="focus-hill-texture-svg" viewBox="0 0 400 100" preserveAspectRatio="none">
          {pebbles.map((p) => (
            <ellipse key={p.id} cx={p.x} cy={p.y} rx={p.rx} ry={p.ry} fill="currentColor" opacity={p.op} />
          ))}
        </svg>
      </div>
    </div>
  );
}

/* Desert scenery — cacti, rocks, tumbleweeds */
function DesertSceneryLayer({ isWalking, layer }) {
  const items = useMemo(() => {
    let seed = 200 + layer * 77;
    function rand() { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; }

    const arr = [];
    let id = 0;

    // Cacti
    const cactusCount = layer === 0 ? 3 : layer === 1 ? 4 : 3;
    const spacing = 500 / cactusCount;
    for (let i = 0; i < cactusCount; i++) {
      const x = spacing * i + rand() * spacing * 0.6;
      const type = Math.floor(rand() * 3); // 0=saguaro, 1=barrel, 2=prickly pear
      const scale = layer === 0 ? 0.4 + rand() * 0.2
        : layer === 1 ? 0.6 + rand() * 0.3
        : 0.8 + rand() * 0.4;
      const groundY = 100 - rand() * (layer === 0 ? 6 : layer === 1 ? 4 : 2);
      arr.push({ id: id++, x, type, scale, groundY, kind: "cactus" });
    }

    // Desert rocks
    const rockCount = layer === 0 ? 2 : 4;
    for (let i = 0; i < rockCount; i++) {
      const x = rand() * 490;
      const w = 6 + rand() * 12;
      const h = 4 + rand() * 6;
      arr.push({ id: id++, x, w, h, kind: "rock" });
    }

    // Tumbleweeds (near layer only)
    if (layer === 2) {
      for (let i = 0; i < 3; i++) {
        const x = rand() * 490;
        const r = 2 + rand() * 2;
        arr.push({ id: id++, x, r, kind: "tumbleweed" });
      }
    }

    return arr;
  }, [layer]);

  const cls = `focus-scenery focus-scenery-${layer}`;

  return (
    <div className={`${cls} ${isWalking ? "is-scrolling" : ""}`}>
      <svg viewBox="0 0 500 100" preserveAspectRatio="xMidYMax slice" className="focus-scenery-svg">
        {items.map((item) => {
          if (item.kind === "rock") {
            return (
              <path key={item.id} className="gd-rock" fill="currentColor"
                d={`M${item.x},100 Q${item.x - item.w * 0.3},${100 - item.h} ${item.x + item.w * 0.3},${100 - item.h * 0.9} Q${item.x + item.w * 0.7},${100 - item.h * 0.6} ${item.x + item.w},100 Z`} />
            );
          }
          if (item.kind === "tumbleweed") {
            return (
              <circle key={item.id} cx={item.x} cy={98 - item.r} r={item.r}
                fill="none" stroke="currentColor" strokeWidth="0.5" opacity="0.4" />
            );
          }
          const { x, type, scale, groundY } = item;
          if (type === 0) {
            // Saguaro cactus — tall trunk with curved arms
            const h = 35 * scale;
            const w = 3 * scale;
            const armY1 = groundY - h * 0.6;
            const armY2 = groundY - h * 0.45;
            return (
              <g key={item.id}>
                <line x1={x} y1={groundY} x2={x} y2={groundY - h} stroke="currentColor" strokeWidth={w} strokeLinecap="round" />
                {/* Left arm — curves up */}
                <path d={`M${x},${armY1} Q${x - 7 * scale},${armY1} ${x - 7 * scale},${armY1 - 8 * scale}`}
                  fill="none" stroke="currentColor" strokeWidth={w * 0.65} strokeLinecap="round" />
                {/* Right arm — curves up, slightly lower */}
                <path d={`M${x},${armY2} Q${x + 6 * scale},${armY2} ${x + 6 * scale},${armY2 - 6 * scale}`}
                  fill="none" stroke="currentColor" strokeWidth={w * 0.65} strokeLinecap="round" />
              </g>
            );
          }
          if (type === 1) {
            // Barrel/columnar cactus — short, slightly tapered
            const h = 14 * scale;
            const w = 2.5 * scale;
            return (
              <g key={item.id}>
                <path d={`M${x - w},${groundY} L${x - w * 0.8},${groundY - h} Q${x},${groundY - h - 2 * scale} ${x + w * 0.8},${groundY - h} L${x + w},${groundY} Z`}
                  fill="currentColor" />
                {/* Vertical rib lines */}
                <line x1={x} y1={groundY - h} x2={x} y2={groundY} stroke="currentColor" strokeWidth="0.3" opacity="0.25" />
              </g>
            );
          }
          // Thin columnar cactus — simple tall and slim, no arms
          const h = 28 * scale;
          const w = 2 * scale;
          return (
            <g key={item.id}>
              <line x1={x} y1={groundY} x2={x} y2={groundY - h} stroke="currentColor" strokeWidth={w} strokeLinecap="round" />
              {/* Small branch nub */}
              <line x1={x} y1={groundY - h * 0.65} x2={x + 3 * scale} y2={groundY - h * 0.72}
                stroke="currentColor" strokeWidth={w * 0.6} strokeLinecap="round" />
            </g>
          );
        })}
      </svg>
    </div>
  );
}

/* ── Path progress indicator ── */
function PathProgress({ progress }) {
  return (
    <div className="focus-path">
      <div className="focus-path-track">
        <div className="focus-path-fill" style={{ width: `${Math.min(100, progress * 100)}%` }} />
        <div className="focus-path-marker" style={{ left: `${Math.min(100, progress * 100)}%` }} />
      </div>
    </div>
  );
}

/* ── Main FocusMode component ── */
export default function FocusMode({
  open,
  onExit,
  task,
  pomodoroRun,
  onAction,
  onTaskDone,
  onPausePomodoro,
  onStartPomodoro,
}) {
  const [controlsVisible, setControlsVisible] = useState(true);
  const hideTimeout = useRef(null);
  const [elapsed, setElapsed] = useState(0);
  const [settings, setSettings] = useState(loadSettings);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const toggleSettings = useCallback(() => setSettingsOpen((p) => !p), []);

  useEffect(() => {
    if (!open) return;
    function handleKey(e) {
      if (e.key === "Escape") onExit();
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [open, onExit]);

  useEffect(() => {
    if (!open) return;
    const id = setInterval(() => setElapsed((e) => e + 1), 1000);
    return () => clearInterval(id);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function showControls() {
      setControlsVisible(true);
      clearTimeout(hideTimeout.current);
      hideTimeout.current = setTimeout(() => setControlsVisible(false), 5000);
    }
    showControls();
    window.addEventListener("mousemove", showControls);
    window.addEventListener("touchstart", showControls);
    return () => {
      clearTimeout(hideTimeout.current);
      window.removeEventListener("mousemove", showControls);
      window.removeEventListener("touchstart", showControls);
    };
  }, [open]);

  if (!open || !task) return null;

  const runtime = getLiveDurations(task, Date.now());
  const isRunning = task.timer.status === "running";
  const isPaused = task.timer.status === "paused";
  const timerMs = isRunning ? runtime.workMs : isPaused ? runtime.restMs : runtime.workMs + runtime.restMs;
  const isPomodoroActive = pomodoroRun.status === "running" || pomodoroRun.status === "paused";

  const estPomos = task.estimatedPomodoros || 0;
  const donePomos = task.completedPomodoros || 0;
  const pomoDotsCount = Math.max(estPomos, donePomos, 1);

  let sessionProgress = 0;
  if (isPomodoroActive && pomodoroRun.segmentSeconds > 0) {
    sessionProgress = 1 - pomodoroRun.remainingSeconds / pomodoroRun.segmentSeconds;
  } else if (isRunning && timerMs > 0) {
    sessionProgress = Math.min(1, timerMs / (60 * 60 * 1000));
  }

  const stateLabel = isRunning ? "Focusing" : isPaused ? "Resting" : "Ready";
  const isResting = isPaused || pomodoroRun.mode === "shortBreak" || pomodoroRun.mode === "longBreak";
  const hikerWalking = isRunning;

  const scheme = COLOR_SCHEMES.find((s) => s.id === settings.colorScheme) || COLOR_SCHEMES[0];
  const skyColors = isResting ? scheme.restSky : scheme.sky;
  const g = settings.environment === "desert" && scheme.desertGround ? scheme.desertGround : scheme.ground;
  const trees = isResting ? scheme.restTrees : scheme.trees;
  const mtns = isResting ? scheme.restMtns : scheme.mtns;
  const skyStyle = {
    background: `linear-gradient(180deg, ${skyColors.map((c, i) => `${c} ${Math.round((i / (skyColors.length - 1)) * 100)}%`).join(", ")})`,
    "--ground-fill": isResting ? g.restFill : g.fill,
    "--ground-edge": isResting ? g.restEdge : g.edge,
    "--ground-grass": isResting ? g.restGrass : g.grass,
    "--mtn-far": mtns[0],
    "--mtn-back": mtns[1],
    "--mtn-mid": mtns[2],
    "--mtn-front": mtns[3],
    "--tree-0": trees[0],
    "--tree-1": trees[1],
    "--tree-2": trees[2],
    "--flower-warm": isResting ? scheme.restFlowerWarm : scheme.flowerWarm,
    "--flower-cool": isResting ? scheme.restFlowerCool : scheme.flowerCool,
  };

  return (
    <div className={`focus-immersive ${isResting ? "focus-rest" : "focus-work"} ${hikerWalking ? "is-moving" : ""}`} style={skyStyle}>
      <Stars />
      <Clouds />
      {settings.environment === "desert" ? (
        <>
          <DuneFar />
          <DuneBack />
          <DuneMid />
          <DuneFront />
          <Particles />
          <DesertGround isWalking={hikerWalking} />
          <DesertSceneryLayer isWalking={hikerWalking} layer={0} />
          <DesertSceneryLayer isWalking={hikerWalking} layer={1} />
          <DesertSceneryLayer isWalking={hikerWalking} layer={2} />
        </>
      ) : (
        <>
          <MountainFar />
          <MountainBack />
          <MountainMid />
          <MountainFront />
          <Particles />
          <Ground isWalking={hikerWalking} />
          <SceneryLayer isWalking={hikerWalking} layer={0} />
          <SceneryLayer isWalking={hikerWalking} layer={1} />
          <SceneryLayer isWalking={hikerWalking} layer={2} />
        </>
      )}

      {/* Character stays centered, world moves around them */}
      <Character type={settings.character} isWalking={hikerWalking} isResting={isResting} />

      {/* Top bar */}
      <div className="focus-top-bar">
        <div className="focus-state-badge">{stateLabel}</div>
        <p className="focus-task-name">{task.text}</p>
        <button type="button" className="focus-settings-btn" onClick={toggleSettings}>
          <svg viewBox="0 0 24 24" width="20" height="20">
            <path d="M12 15.5A3.5 3.5 0 1 0 12 8.5a3.5 3.5 0 0 0 0 7z" fill="none" stroke="currentColor" strokeWidth="1.5" />
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"
              fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </div>

      {settingsOpen && (
        <FocusSettings settings={settings} onChange={setSettings} onClose={toggleSettings} />
      )}

      {/* Center timer */}
      <div className="focus-center-timer">
        <div className="focus-time-display">{formatDuration(timerMs)}</div>
        {isPomodoroActive && (
          <div className="focus-pomo-countdown">{formatClock(pomodoroRun.remainingSeconds)}</div>
        )}
      </div>

      {/* Bottom HUD */}
      <div className={`focus-bottom-hud ${controlsVisible ? "is-visible" : "is-hidden"}`}>
        {estPomos > 0 && (
          <div className="focus-pomo-dots">
            {Array.from({ length: pomoDotsCount }, (_, i) => (
              <span
                key={i}
                className={`focus-pomo-dot${i < donePomos ? " is-done" : ""}`}
              />
            ))}
          </div>
        )}

        {isPomodoroActive && <PathProgress progress={sessionProgress} />}

        <div className="focus-controls">
          {isRunning ? (
            <button type="button" className="focus-btn focus-btn-primary" onClick={() => onAction(task.id, "rest")}>
              <svg viewBox="0 0 24 24" className="focus-btn-icon"><rect x="6" y="4" width="4" height="16" rx="1.5" /><rect x="14" y="4" width="4" height="16" rx="1.5" /></svg>
              Pause
            </button>
          ) : isPaused ? (
            <button type="button" className="focus-btn focus-btn-primary" onClick={() => onAction(task.id, "resume")}>
              <svg viewBox="0 0 24 24" className="focus-btn-icon"><path d="M8 5v14l11-7z" /></svg>
              Resume
            </button>
          ) : (
            <button type="button" className="focus-btn focus-btn-primary" onClick={() => onAction(task.id, "start")}>
              <svg viewBox="0 0 24 24" className="focus-btn-icon"><path d="M8 5v14l11-7z" /></svg>
              Start
            </button>
          )}

          {(isRunning || isPaused) && (
            <button type="button" className="focus-btn" onClick={() => onAction(task.id, "stop")}>
              <svg viewBox="0 0 24 24" className="focus-btn-icon"><rect x="6" y="6" width="12" height="12" rx="1.8" /></svg>
              Stop
            </button>
          )}

          <button type="button" className="focus-btn" onClick={() => { onTaskDone(task.id, true); onExit(); }}>
            <svg viewBox="0 0 24 24" className="focus-btn-icon"><path d="M20 6L9 17l-5-5" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
            Done
          </button>

          <button type="button" className="focus-btn focus-btn-exit" onClick={onExit}>
            Esc
          </button>
        </div>
      </div>
    </div>
  );
}
