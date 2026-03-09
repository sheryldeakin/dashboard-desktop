import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { useAnimations, useGLTF } from "@react-three/drei";
import * as THREE from "three";
import { clone } from "three/examples/jsm/utils/SkeletonUtils.js";

const MODEL_PATH = "/models/mindstorm_character.glb";
const BASE_SPEED = 0.12;
const CONFETTI_COUNT = 12;
const CONFETTI_COLORS = [0xffcc00, 0xff6b6b, 0x4ecdc4, 0xa78bfa, 0xf97316, 0x22d3ee];
const COMPLETION_MESSAGES = ["Nice work!", "Keep it up!", "One down!", "Crushed it!", "Let's go!"];
const STORAGE_KEY = "walker_pos";

function getGreeting() {
  const h = new Date().getHours();
  if (h >= 22) return "Late night grind!";
  if (h >= 17) return "Good evening!";
  if (h >= 12) return "Good afternoon!";
  return "Good morning!";
}

/* ── Confetti (lightweight points-based particle system) ── */
function Confetti({ waveToken }) {
  const pointsRef = useRef(null);
  const particlesRef = useRef([]);
  const lastToken = useRef(0);
  const posAttr = useRef(null);
  const colorAttr = useRef(null);
  const spawnPosX = useRef(0);

  const { positions, colors } = useMemo(() => {
    const positions = new Float32Array(CONFETTI_COUNT * 3);
    const colors = new Float32Array(CONFETTI_COUNT * 3);
    return { positions, colors };
  }, []);

  useFrame((_, dt) => {
    if (!posAttr.current || !colorAttr.current) {
      if (pointsRef.current) {
        posAttr.current = pointsRef.current.geometry.getAttribute("position");
        colorAttr.current = pointsRef.current.geometry.getAttribute("color");
      }
      return;
    }

    // Spawn on new wave token
    if (waveToken > 0 && waveToken !== lastToken.current) {
      lastToken.current = waveToken;
      particlesRef.current = [];
      for (let i = 0; i < CONFETTI_COUNT; i++) {
        const angle = (Math.PI * 2 * i) / CONFETTI_COUNT + (Math.random() - 0.5) * 0.5;
        const spd = 0.8 + Math.random() * 1.2;
        const c = new THREE.Color(CONFETTI_COLORS[i % CONFETTI_COLORS.length]);
        particlesRef.current.push({
          x: spawnPosX.current,
          y: 0.15,
          z: 0,
          vx: Math.sin(angle) * spd * 0.4,
          vy: spd * 0.6 + Math.random() * 0.3,
          vz: (Math.random() - 0.5) * 0.3,
          life: 1.0,
          r: c.r, g: c.g, b: c.b,
        });
      }
    }

    const ps = particlesRef.current;
    for (let i = 0; i < CONFETTI_COUNT; i++) {
      const p = ps[i];
      if (p && p.life > 0) {
        p.vy -= 2.5 * dt; // gravity
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.z += p.vz * dt;
        p.life -= dt * 1.2;
        positions[i * 3] = p.x;
        positions[i * 3 + 1] = Math.max(0, p.y);
        positions[i * 3 + 2] = p.z;
        colors[i * 3] = p.r * p.life;
        colors[i * 3 + 1] = p.g * p.life;
        colors[i * 3 + 2] = p.b * p.life;
      } else {
        positions[i * 3] = 0;
        positions[i * 3 + 1] = -10; // hide offscreen
        positions[i * 3 + 2] = 0;
        colors[i * 3] = 0;
        colors[i * 3 + 1] = 0;
        colors[i * 3 + 2] = 0;
      }
    }
    posAttr.current.needsUpdate = true;
    colorAttr.current.needsUpdate = true;
  });

  return (
    <points ref={pointsRef}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" array={positions} count={CONFETTI_COUNT} itemSize={3} />
        <bufferAttribute attach="attributes-color" array={colors} count={CONFETTI_COUNT} itemSize={3} />
      </bufferGeometry>
      <pointsMaterial size={0.06} vertexColors transparent opacity={0.9} depthWrite={false} sizeAttenuation />
    </points>
  );
}

/* ── Walker (3D character with animations) ── */
const Walker = forwardRef(function Walker(
  {
    isWalking = true,
    boundsX = 2.5,
    speed = 0.8,
    turn = 3,
    fade = 0.25,
    lookStrengthIdle = 0.35,
    lookStrengthWalk = 0.12,
    waveToken = 0,
    onPositionUpdate,
  },
  ref,
) {
  const walkerRef = useRef(null);
  const modelRef = useRef(null);
  const shadowRef = useRef(null);
  const isWaving = useRef(false);
  const lastWaveToken = useRef(0);
  const { scene: baseScene, animations: baseAnimations } = useGLTF(MODEL_PATH);

  const { scene, animations } = useMemo(() => {
    const clonedScene = clone(baseScene);
    const clonedAnimations = baseAnimations.map((clip) => clip.clone());
    return { scene: clonedScene, animations: clonedAnimations };
  }, [baseAnimations, baseScene]);

  // Find root bone for stripping root motion
  const rootMotionNodeName = useMemo(() => {
    if (!animations?.length) return null;
    for (const clip of animations) {
      const positionTrack = clip.tracks.find((track) => track.name.endsWith(".position"));
      if (positionTrack) return positionTrack.name.replace(/\.position$/, "");
    }
    let candidate = null;
    scene.traverse((child) => {
      if (!child.isBone) return;
      if (!candidate) candidate = child;
      const parentIsBone = child.parent?.type === "Bone";
      if (!parentIsBone) candidate = child;
    });
    return candidate?.name ?? null;
  }, [animations, scene]);

  // Strip root motion tracks
  const strippedAnimations = useMemo(() => {
    if (!animations?.length || !rootMotionNodeName) return animations;
    return animations.map((clip) => {
      const prefix = `${rootMotionNodeName}.`;
      const tracks = clip.tracks.filter((track) => {
        const name = track.name;
        if (!name.startsWith(prefix)) return true;
        return !name.endsWith(".position") && !name.endsWith(".quaternion") && !name.endsWith(".rotation");
      });
      if (tracks.length === clip.tracks.length) return clip;
      return new THREE.AnimationClip(clip.name, clip.duration, tracks);
    });
  }, [animations, rootMotionNodeName]);

  const { actions } = useAnimations(strippedAnimations, modelRef);

  // Shadow texture (soft radial gradient)
  const shadowTexture = useMemo(() => {
    const size = 64;
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext("2d");
    const gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    gradient.addColorStop(0, "rgba(0,0,0,0.22)");
    gradient.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, size, size);
    return new THREE.CanvasTexture(canvas);
  }, []);

  // Bone refs for head tracking
  const neckRef = useRef(null);
  const upperRef = useRef(null);
  const chestRef = useRef(null);
  const spineRef = useRef(null);
  const lookYaw = useRef(0);
  const lookPitch = useRef(0);
  const raycasterRef = useRef(new THREE.Raycaster());
  const planeRef = useRef(new THREE.Plane());
  const hitRef = useRef(new THREE.Vector3());
  const headRef = useRef(new THREE.Vector3());
  const dirRef = useRef(new THREE.Vector3());
  const camDirRef = useRef(new THREE.Vector3());
  const HEAD_HEIGHT = 1.1;

  // [Feature 8] Restore position from sessionStorage
  const savedPos = useMemo(() => {
    try {
      const raw = sessionStorage.getItem(STORAGE_KEY);
      if (raw) return JSON.parse(raw);
    } catch {}
    return null;
  }, []);

  const posX = useRef(savedPos ? savedPos.posX : (Math.random() * 2 - 1) * boundsX);
  const direction = useRef(savedPos ? savedPos.direction : (Math.random() > 0.5 ? 1 : -1));
  const current = useRef("IDLE");

  // [Feature 3] Velocity-based movement for smooth direction changes
  const velocityRef = useRef(direction.current * speed);

  // [Feature 7] Squash & stretch celebrate scale
  const celebrateScaleRef = useRef(1.0);

  // [Feature 4] Idle fidget timer
  const idleTimerRef = useRef(0);
  const idleThresholdRef = useRef(8 + Math.random() * 7); // 8-15s

  // [Feature 8] Throttled position persistence
  const lastPersistRef = useRef(0);

  useImperativeHandle(ref, () => modelRef.current);

  const play = (name) => {
    if (isWaving.current) return;
    const nextAction = actions?.[name];
    if (!nextAction || current.current === name) return;
    actions?.[current.current]?.fadeOut(fade);
    nextAction.reset().fadeIn(fade).play();
    current.current = name;
  };

  function triggerWave() {
    if (isWaving.current || !actions?.WAVE) return;
    isWaving.current = true;

    // [Feature 7] Trigger squash & stretch
    celebrateScaleRef.current = 1.15;

    actions[current.current]?.fadeOut(0.2);

    const waveAction = actions.WAVE;
    waveAction.reset();
    waveAction.setLoop(THREE.LoopOnce, 1);
    waveAction.clampWhenFinished = true;
    waveAction.fadeIn(0.2).play();
    current.current = "WAVE";

    const mixer = waveAction.getMixer();
    const handler = () => {
      mixer.removeEventListener("finished", handler);
      waveAction.fadeOut(0.2);
      isWaving.current = false;
    };
    mixer.addEventListener("finished", handler);
  }

  // Init animations
  useEffect(() => {
    if (!actions) return;
    actions.IDLE?.reset().setLoop(THREE.LoopRepeat, Infinity).play();
    actions.WALK?.setLoop(THREE.LoopRepeat, Infinity);
  }, [actions]);

  // Wave from prop token
  useEffect(() => {
    if (waveToken > 0 && waveToken !== lastWaveToken.current) {
      lastWaveToken.current = waveToken;
      triggerWave();
    }
  }, [waveToken, actions]);

  // Find skeleton bones
  useEffect(() => {
    if (!scene) return;
    let neck = null;
    let upper = null;
    let chest = null;
    let spine = null;
    scene.traverse((child) => {
      if (!child.isBone) return;
      const name = child.name.toLowerCase();
      if (!neck && name.includes("neck")) neck = child;
      if (!upper && name.includes("upper") && name.includes("chest")) upper = child;
      if (!chest && name.includes("chest")) chest = child;
      if (!spine && name.includes("spine")) spine = child;
    });
    if (!neck || !upper || !chest || !spine) {
      const bones = [];
      scene.updateWorldMatrix(true, true);
      scene.traverse((child) => {
        if (child.isBone) bones.push(child);
      });
      if (bones.length) {
        const withY = bones.map((bone) => {
          const pos = new THREE.Vector3();
          bone.getWorldPosition(pos);
          return { bone, y: pos.y };
        });
        const minY = Math.min(...withY.map((e) => e.y));
        const maxY = Math.max(...withY.map((e) => e.y));
        const pickClosest = (t) => {
          let best = withY[0];
          let bestDist = Math.abs(best.y - t);
          for (const entry of withY) {
            const dist = Math.abs(entry.y - t);
            if (dist < bestDist) { best = entry; bestDist = dist; }
          }
          return best.bone;
        };
        const height = Math.max(0.0001, maxY - minY);
        spine = spine ?? pickClosest(minY + height * 0.45);
        chest = chest ?? pickClosest(minY + height * 0.62);
        upper = upper ?? pickClosest(minY + height * 0.72);
        neck = neck ?? pickClosest(minY + height * 0.84);
      }
    }
    neckRef.current = neck;
    upperRef.current = upper;
    chestRef.current = chest;
    spineRef.current = spine;
  }, [scene]);

  const lerpAngle = (from, to, t) => {
    const delta = THREE.MathUtils.euclideanModulo(to - from + Math.PI, Math.PI * 2) - Math.PI;
    return from + delta * t;
  };

  useFrame((state, dt) => {
    const walker = walkerRef.current;
    if (!walker) return;

    // Sync shadow position (shadow is outside walker group to avoid rotation)
    if (shadowRef.current) {
      shadowRef.current.position.x = walker.position.x;
    }

    let desiredYaw = walker.rotation.y;

    if (isWaving.current) {
      // Turn to face camera during wave
      walker.rotation.y = THREE.MathUtils.lerp(walker.rotation.y, 0, 1 - Math.exp(-8 * dt));
      // [Feature 4] Reset idle timer during wave
      idleTimerRef.current = 0;
    } else if (isWalking) {
      play("WALK");

      // [Feature 1] Sync walk animation timeScale to movement speed
      if (actions?.WALK) {
        actions.WALK.timeScale = speed / BASE_SPEED;
      }

      // [Feature 3] Smooth velocity-based movement
      const targetVelocity = direction.current * speed;
      const accel = 1 - Math.exp(-4 * dt);
      velocityRef.current = THREE.MathUtils.lerp(velocityRef.current, targetVelocity, accel);
      posX.current += velocityRef.current * dt;

      if (posX.current >= boundsX) {
        posX.current = boundsX;
        direction.current = -1;
      } else if (posX.current <= -boundsX) {
        posX.current = -boundsX;
        direction.current = 1;
      }

      walker.position.x = posX.current;
      walker.position.z = 0;
      desiredYaw = direction.current > 0 ? Math.PI / 2 : -Math.PI / 2;
      walker.rotation.y = lerpAngle(walker.rotation.y, desiredYaw, 1 - Math.exp(-turn * dt));

      // [Feature 4] Reset idle timer when walking
      idleTimerRef.current = 0;
      idleThresholdRef.current = 8 + Math.random() * 7;
    } else {
      play("IDLE");
      walker.position.lerp(new THREE.Vector3(0, 0, 0), 0.06);
      walker.rotation.y = THREE.MathUtils.lerp(walker.rotation.y, 0, 0.06);

      // [Feature 4] Idle fidget — trigger wave after random 8-15s
      idleTimerRef.current += dt;
      if (idleTimerRef.current >= idleThresholdRef.current && !isWaving.current) {
        idleTimerRef.current = 0;
        idleThresholdRef.current = 8 + Math.random() * 7;
        triggerWave();
      }
    }

    // [Feature 7] Squash & stretch — lerp celebrate scale back to 1.0
    // Skip during wave so arm pose isn't distorted
    if (isWaving.current) {
      walker.scale.set(1, 1, 1);
    } else if (celebrateScaleRef.current !== 1.0) {
      celebrateScaleRef.current = THREE.MathUtils.lerp(celebrateScaleRef.current, 1.0, 1 - Math.exp(-5 * dt));
      if (Math.abs(celebrateScaleRef.current - 1.0) < 0.001) celebrateScaleRef.current = 1.0;
      const s = celebrateScaleRef.current;
      walker.scale.set(1 / s, s, 1);
    } else {
      walker.scale.set(1, 1, 1);
    }

    // Prevent root-motion drift
    if (modelRef.current) {
      modelRef.current.position.set(0, 0, 0);
      modelRef.current.rotation.set(0, 0, 0);
    }

    // [Feature 8] Persist position throttled (~500ms)
    const now = state.clock.elapsedTime;
    if (now - lastPersistRef.current > 0.5) {
      lastPersistRef.current = now;
      try {
        sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ posX: posX.current, direction: direction.current }));
      } catch {}
      if (onPositionUpdate) onPositionUpdate(posX.current);
    }

    // Head tracking toward cursor
    const raycaster = raycasterRef.current;
    const plane = planeRef.current;
    const hit = hitRef.current;
    const head = headRef.current;
    const dirVec = dirRef.current;
    const camDir = camDirRef.current;
    raycaster.setFromCamera(state.pointer, state.camera);
    state.camera.getWorldDirection(camDir);
    const worldPos = new THREE.Vector3();
    walker.getWorldPosition(worldPos);
    head.copy(worldPos).add(new THREE.Vector3(0, HEAD_HEIGHT, 0));
    plane.setFromNormalAndCoplanarPoint(camDir, head);
    const hasHit = raycaster.ray.intersectPlane(plane, hit);
    if (hasHit) {
      dirVec.copy(hit).sub(head);
      const targetYaw = Math.atan2(dirVec.x, dirVec.z);
      const deltaYaw = THREE.MathUtils.euclideanModulo(targetYaw - walker.rotation.y + Math.PI, Math.PI * 2) - Math.PI;
      const targetPitch = -Math.atan2(dirVec.y, Math.sqrt(dirVec.x * dirVec.x + dirVec.z * dirVec.z));
      const strength = isWalking ? lookStrengthWalk : lookStrengthIdle;
      const nextYaw = deltaYaw * strength + (isWalking ? (desiredYaw - walker.rotation.y) * 0.15 : 0);
      const nextPitch = targetPitch * strength * 0.6;
      lookYaw.current = THREE.MathUtils.lerp(lookYaw.current, nextYaw, 1 - Math.exp(-6 * dt));
      lookPitch.current = THREE.MathUtils.lerp(lookPitch.current, nextPitch, 1 - Math.exp(-6 * dt));
    }

    // Skip bone overrides entirely during wave so they don't fight the animation
    if (!isWaving.current) {
      const applyBone = (bone, yaw, pitch, yawWeight, pitchWeight) => {
        if (!bone) return;
        const base = bone.rotation;
        bone.rotation.set(base.x + pitch * pitchWeight, base.y + yaw * yawWeight, base.z);
      };

      const yaw = lookYaw.current;
      const pitch = lookPitch.current;
      applyBone(upperRef.current, yaw, pitch, 0.35, 0.25);
      applyBone(chestRef.current, yaw, pitch, 0.45, 0.35);
      applyBone(spineRef.current, yaw, pitch, 0.25, 0.15);
      applyBone(neckRef.current, yaw, pitch, 0.8, 0.65);
    } else {
      lookYaw.current = 0;
      lookPitch.current = 0;
    }
  });

  function handleClick(e) {
    e.stopPropagation();
    triggerWave();
  }

  return (
    <group>
      <group ref={walkerRef} onClick={handleClick}>
        <group ref={modelRef} position={[0, 0, 0]}>
          <primitive object={scene} />
        </group>
      </group>
      {/* Drop shadow — flat plane on the ground */}
      <mesh ref={shadowRef} position={[0, 0.005, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <circleGeometry args={[0.14, 32]} />
        <meshBasicMaterial map={shadowTexture} transparent depthWrite={false} />
      </mesh>
      {/* [Feature 2] Confetti particles */}
      <Confetti waveToken={waveToken} />
    </group>
  );
});

/* ── WalkingFigure (outer wrapper — computes reactive state) ── */
export default function WalkingFigure({
  tasksDone = 0,
  tasksTotal = 0,
  overdueCount = 0,
  pomodoroMode = null,
  pomodoroStatus = "idle",
  lastCompletedTaskAt = 0,
}) {
  const [waveToken, setWaveToken] = useState(0);
  const [transientMessage, setTransientMessage] = useState("");
  const lastCompletedRef = useRef(lastCompletedTaskAt);
  const bubbleTimeoutRef = useRef(null);

  // [Feature 5] Time-of-day greeting on mount
  const [greetingShown, setGreetingShown] = useState(false);
  useEffect(() => {
    if (greetingShown) return;
    setGreetingShown(true);
    setTransientMessage(getGreeting());
    bubbleTimeoutRef.current = setTimeout(() => setTransientMessage(""), 3000);
  }, []);

  // Wave + transient bubble on task completion
  useEffect(() => {
    if (lastCompletedTaskAt && lastCompletedTaskAt !== lastCompletedRef.current) {
      lastCompletedRef.current = lastCompletedTaskAt;
      setWaveToken((t) => t + 1);
      // [Feature 5] Random completion message
      const msg = COMPLETION_MESSAGES[Math.floor(Math.random() * COMPLETION_MESSAGES.length)];
      setTransientMessage(msg);
      clearTimeout(bubbleTimeoutRef.current);
      bubbleTimeoutRef.current = setTimeout(() => setTransientMessage(""), 3000);
    }
  }, [lastCompletedTaskAt]);

  useEffect(() => () => clearTimeout(bubbleTimeoutRef.current), []);

  // Persistent contextual message (lower priority than transient)
  const persistentMessage = useMemo(() => {
    if (tasksTotal > 0 && tasksDone === tasksTotal) return "All done for today!";
    if (pomodoroMode === "focus" && pomodoroStatus === "running") return "Focusing...";
    if ((pomodoroMode === "shortBreak" || pomodoroMode === "longBreak") && pomodoroStatus === "running")
      return "Take a breather";
    if (overdueCount > 0) return "Don't forget the overdue tasks!";
    return "";
  }, [tasksDone, tasksTotal, overdueCount, pomodoroMode, pomodoroStatus]);

  const bubbleMessage = transientMessage || persistentMessage;

  // Compute effective walking state from app state
  const allDone = tasksTotal > 0 && tasksDone === tasksTotal;
  const noTasks = tasksTotal === 0;
  const onBreak =
    (pomodoroMode === "shortBreak" || pomodoroMode === "longBreak") && pomodoroStatus === "running";

  const effectiveIsWalking = !allDone && !noTasks && !onBreak;

  let effectiveSpeed = 0.12;
  if (pomodoroMode === "focus" && pomodoroStatus === "running") effectiveSpeed = 0.15;
  if (overdueCount > 0) effectiveSpeed = 0.16; // overdue urgency takes priority

  let effectiveBoundsX = 0.5;
  if (overdueCount > 0) effectiveBoundsX = 0.35; // tighter pacing when overdue

  // [Feature 6] Progress fraction
  const progressFraction = tasksTotal > 0 ? tasksDone / tasksTotal : 0;

  return (
    <div className="walking-figure-container">
      {(bubbleMessage || tasksTotal > 0) && (
        <div className="walker-hud">
          {bubbleMessage && (
            <div className="walker-speech-bubble" key={bubbleMessage}>{bubbleMessage}</div>
          )}
          {tasksTotal > 0 && (
            <div className="walker-progress">
              <span className="walker-progress-text">{tasksDone}/{tasksTotal}</span>
              <div className="walker-progress-bar">
                <div className="walker-progress-fill" style={{ width: `${progressFraction * 100}%` }} />
              </div>
            </div>
          )}
        </div>
      )}
      <Canvas
        orthographic
        camera={{ zoom: 120, position: [0, 1.25, 4.2], near: 0.1, far: 100 }}
        style={{ background: "transparent" }}
        gl={{ alpha: true, antialias: true }}
        onCreated={({ camera }) => {
          camera.lookAt(0, 1.25, 0);
        }}
      >
        <ambientLight intensity={0.6} />
        <directionalLight position={[5, 5, 5]} intensity={0.8} />
        <group scale={5.5}>
          <Walker
            isWalking={effectiveIsWalking}
            boundsX={effectiveBoundsX}
            speed={effectiveSpeed}
            turn={12}
            waveToken={waveToken}
          />
        </group>
      </Canvas>
    </div>
  );
}

useGLTF.preload(MODEL_PATH);
