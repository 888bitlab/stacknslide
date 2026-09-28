"use client";

import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import type { GameComponentProps } from "@rarefriends/friendsdk/runtime";
import { createFriendReader, spriteFrame, type GenerationSprites } from "@rarefriends/friendsdk/sprites";
import "./style.css";

const W = 960, H = 640, ISLAND_X = 480, ISLAND_TOP = 450, ISLAND_HALF = 245;
const R = 23, ROUND_SECONDS = 30, DROP_COOLDOWN = 180, MAX_FRIENDS_ON_SCREEN = 110, RIDER_JUMP_UP_MS = 100, RIDER_JUMP_MS = 280;
const SPRITE_POOL_TARGET = 16, SPRITE_POOL_READY = 8;
type Buddy = { id: number; sprite: GenerationSprites; x: number; y: number; vx: number; vy: number; rotation: number; spin: number; landed: boolean; squash: number; bounceY: number; bounceVY: number; animPhase: number };
type ScoreEntry = { score: number; playedAt: number; friendId: string };
type PendingDrop = { sprite: GenerationSprites | null; x: number; startedAt: number; spin: number; animPhase: number };
type Game = { friends: Buddy[]; usedSprites: Set<string>; aim: number; startedAt: number | null; endedAt: number | null; lastDrop: number; pendingDrop: PendingDrop | null; nextId: number };
const createGame = (): Game => ({ friends: [], usedSprites: new Set(), aim: ISLAND_X, startedAt: null, endedAt: null, lastDrop: 0, pendingDrop: null, nextId: 1 });
const clamp = (n: number, low: number, high: number) => Math.max(low, Math.min(high, n));
const groundAt = (_x: number) => ISLAND_TOP;
const isOverIsland = (friend: Buddy) => friend.x > ISLAND_X - ISLAND_HALF - R && friend.x < ISLAND_X + ISLAND_HALF + R && friend.y < ISLAND_TOP + 100;
const countSurvivors = (game: Game) => game.friends.filter(isOverIsland).length;
function cameraZoom(game: Game) {
  const highestLanded = game.friends.reduce((top, friend) => isOverIsland(friend) && friend.landed ? Math.min(top, friend.y - R) : top, ISLAND_TOP);
  const stackHeight = ISLAND_TOP - highestLanded;
  return clamp(320 / Math.max(320, stackHeight), .14, 1);
}
function nextDropY(game: Game) {
  const highestFriend = game.friends.reduce((top, friend) => isOverIsland(friend) ? Math.min(top, friend.y - R) : top, ISLAND_TOP);
  return { y: Math.min(93, highestFriend - 80 / cameraZoom(game)), highestFriend };
}
const spriteSignature = (sprite: GenerationSprites) => sprite.frames.map(frame => frame.toString(16)).join(":");
const spriteCanvasCache = new WeakMap<GenerationSprites, Map<string, HTMLCanvasElement>>();
const TITLE_GLYPHS: Record<string, string[]> = {
  A:["01110","10001","10001","11111","10001","10001","10001"], C:["01111","10000","10000","10000","10000","10000","01111"],
  D:["11110","10001","10001","10001","10001","10001","11110"], E:["11111","10000","10000","11110","10000","10000","11111"],
  F:["11111","10000","10000","11110","10000","10000","10000"], I:["11111","00100","00100","00100","00100","00100","11111"],
  K:["10001","10010","10100","11000","10100","10010","10001"], L:["10000","10000","10000","10000","10000","10000","11111"], N:["10001","11001","11001","10101","10011","10011","10001"],
  R:["11110","10001","10001","11110","10100","10010","10001"], S:["01111","10000","10000","01110","00001","00001","11110"],
  T:["11111","00100","00100","00100","00100","00100","00100"],
};
function PixelText({ text }: { text: string }) {
  let x = 0; const paths: string[] = [];
  for (const letter of text.toUpperCase()) {
    if (letter === " ") { x += 3; continue; }
    (TITLE_GLYPHS[letter] ?? []).forEach((row, y) => [...row].forEach((pixel, col) => { if (pixel === "1") paths.push(`M${x + col} ${y}h1v1h-1z`); }));
    x += 6;
  }
  return <svg className="pixel-title-word" viewBox={`0 0 ${Math.max(1, x - 1)} 7`} role="img" aria-label={text}><path d={paths.join("")} fill="currentColor" /></svg>;
}

async function generateUniqueFriend(reader: ReturnType<typeof createFriendReader>, used: ReadonlySet<string>) {
  for (let attempt = 0; attempt < 64; attempt++) {
    const random = crypto.getRandomValues(new Uint32Array(2));
    const randomBits = random.reduce((value, word) => (value << 32n) | BigInt(word), 0n);
    // A synthetic ID is only a random input to the official family/seed renderer.
    // It is intentionally outside the minted-token range and is never an NFT claim.
    const syntheticId = (1n << 200n) | randomBits;
    const sprite = await reader.read(syntheticId);
    const signature = spriteSignature(sprite);
    if (!used.has(signature)) return { sprite, signature };
  }
  throw new Error("Could not produce a new Friend appearance. Try another drop.");
}

function drawFriend(ctx: CanvasRenderingContext2D, sprites: GenerationSprites, x: number, y: number, rotation: number, walking: boolean, frame: number, bob: number, squash: number) {
  const key = `${walking ? "walk" : "idle"}:${frame}`;
  let frames = spriteCanvasCache.get(sprites);
  if (!frames) { frames = new Map(); spriteCanvasCache.set(sprites, frames); }
  let bitmap = frames.get(key);
  if (!bitmap) {
    const rows = spriteFrame(sprites, "down", walking, frame).frame.rows;
    bitmap = document.createElement("canvas"); bitmap.width = 57; bitmap.height = 57;
    const spriteCtx = bitmap.getContext("2d");
    if (spriteCtx) {
      spriteCtx.fillStyle = "#fff";
      rows.forEach((row, py) => [...row].forEach((value, px) => { if (value === "#") spriteCtx.fillRect(px * 3, py * 3, 9, 9); }));
      spriteCtx.fillStyle = "#000";
      rows.forEach((row, py) => [...row].forEach((value, px) => { if (value === "#") spriteCtx.fillRect(px * 3 + 3, py * 3 + 3, 3, 3); }));
    }
    frames.set(key, bitmap);
  }
  ctx.save(); ctx.translate(x, y - bob); ctx.rotate(rotation); ctx.scale(1 + squash * .18, 1 - squash * .14); ctx.imageSmoothingEnabled = false;
  // Cache the SDK bitmap plus its heavy white halo, then draw it as one image.
  ctx.drawImage(bitmap, -27, -27);
  ctx.restore();
}

function drawCrate(ctx: CanvasRenderingContext2D, x: number, anchorY: number) {
  ctx.save(); ctx.translate(x, anchorY + 46); ctx.imageSmoothingEnabled = false;
  ctx.fillStyle = "#080808"; ctx.strokeStyle = "#fff"; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(-31, -10); ctx.lineTo(-19, -22); ctx.lineTo(19, -22); ctx.lineTo(31, -10); ctx.lineTo(31, 12); ctx.lineTo(-31, 12); ctx.closePath(); ctx.fill(); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(-31, -10); ctx.lineTo(-19, -22); ctx.lineTo(-19, 1); ctx.lineTo(-31, 12); ctx.closePath(); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(31, -10); ctx.lineTo(19, -22); ctx.lineTo(19, 1); ctx.lineTo(31, 12); ctx.closePath(); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(-31, -10); ctx.lineTo(31, -10); ctx.moveTo(0, -10); ctx.lineTo(0, 12); ctx.stroke();
  ctx.fillStyle = "#fff"; ctx.fillRect(-3, -4, 6, 6); ctx.fillStyle = "#080808"; ctx.fillRect(-1, -2, 2, 2);
  ctx.restore();
}

function drawScene(ctx: CanvasRenderingContext2D, game: Game, riderSprite: GenerationSprites | null, width: number, height: number, reducedMotion: boolean, now: number) {
  ctx.save(); ctx.scale(width / W, height / H);
  ctx.fillStyle = "#050505"; ctx.fillRect(0, 0, W, H);
  // Fine grid and pixel dust echo the collection viewer's dark display.
  ctx.strokeStyle = "rgba(255,255,255,.055)"; ctx.lineWidth = 1;
  for (let x = 0; x <= W; x += 48) { ctx.beginPath(); ctx.moveTo(x + .5, 0); ctx.lineTo(x + .5, H); ctx.stroke(); }
  for (let y = 0; y <= H; y += 48) { ctx.beginPath(); ctx.moveTo(0, y + .5); ctx.lineTo(W, y + .5); ctx.stroke(); }
  ctx.fillStyle = "#ddd";
  for (let x = 4; x < W; x += 9) { ctx.fillRect(x, 4, 3, 3); ctx.fillRect(x + 4, 8, 2, 2); }
  for (let i = 0; i < 36; i++) { const x = (i * 137 + 31) % W, y = 170 + ((i * 71) % 205); ctx.fillRect(x, y, i % 3 === 0 ? 2 : 1, 1); }

  const zoom = cameraZoom(game);
  ctx.save(); ctx.translate(ISLAND_X, ISLAND_TOP); ctx.scale(zoom, zoom); ctx.translate(-ISLAND_X, -ISLAND_TOP);
  // A level white deck sits above a chunky, floating pixel-rock underside.
  ctx.save(); ctx.translate(0, 100);
  ctx.save(); ctx.shadowColor = "rgba(255,255,255,.12)"; ctx.shadowBlur = 26;
  ctx.fillStyle = "#000"; ctx.strokeStyle = "#fff"; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(190, 400); ctx.lineTo(770, 400); ctx.lineTo(770, 432); ctx.lineTo(690, 452); ctx.lineTo(620, 468); ctx.lineTo(550, 452); ctx.lineTo(480, 470); ctx.lineTo(410, 452); ctx.lineTo(340, 468); ctx.lineTo(270, 452); ctx.lineTo(190, 432); ctx.closePath(); ctx.fill(); ctx.stroke(); ctx.restore();
  // White pixel lines break the underside into blocky rock facets.
  ctx.strokeStyle = "#fff"; ctx.lineWidth = 2;
  for (const [x1,y1,x2,y2] of [[270,400,270,452],[340,400,340,468],[410,400,410,452],[480,400,480,470],[550,400,550,452],[620,400,620,468],[690,400,690,452]] as const) { ctx.beginPath(); ctx.moveTo(x1,y1); ctx.lineTo(x2,y2); ctx.stroke(); }
  ctx.fillStyle = "#fff"; ctx.fillRect(190, 350, 580, 50);
  ctx.strokeStyle = "#fff"; ctx.lineWidth = 2; ctx.strokeRect(190, 350, 580, 50);
  ctx.strokeStyle = "#000"; ctx.lineWidth = 1;
  for (let i = 0; i < 32; i++) { const x = 215 + ((i * 67) % 525), y = 300 + ((i * 43) % 94); ctx.fillStyle = i % 4 === 0 ? "#000" : "#888"; ctx.fillRect(x, y, i % 3 === 0 ? 3 : 1, 1); }
  // Isometric path across the island, rendered as tiny monochrome pixels.
  ctx.fillStyle = "#777";
  for (let i = 0; i < 42; i++) { const t = i / 41, x = 300 + t * 325, y = 351 + Math.sin(t * Math.PI * 3) * 17 - t * 8; if (i % 2 === 0) ctx.fillRect(x, y, 3, 3); }
  ctx.restore();

  // The crate follows the aim point. Its lower hatch lines up with the stack,
  // while the selected Friend jumps up and lands before releasing the cargo.
  if (game.endedAt === null) {
    const { y: anchorY, highestFriend } = nextDropY(game);
    const guideFrom = anchorY + 62, guideTo = Math.min(ISLAND_TOP - 48, highestFriend - R - 4);
    ctx.setLineDash([4, 8]); ctx.strokeStyle = "rgba(255,255,255,.48)"; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(game.aim, guideFrom); ctx.lineTo(game.aim, guideTo); ctx.stroke(); ctx.setLineDash([]);
    drawCrate(ctx, game.aim, anchorY);
    if (riderSprite) {
      const sinceDrop = game.pendingDrop ? now - game.pendingDrop.startedAt : game.lastDrop ? now - game.lastDrop : Infinity;
      const jump = sinceDrop < RIDER_JUMP_UP_MS ? 42 * (1 - Math.pow(1 - sinceDrop / RIDER_JUMP_UP_MS, 2))
        : sinceDrop < RIDER_JUMP_MS ? 42 * (1 - (sinceDrop - RIDER_JUMP_UP_MS) / (RIDER_JUMP_MS - RIDER_JUMP_UP_MS)) : 0;
      const frame = reducedMotion ? 0 : Math.floor(now / 430) % 8;
      drawFriend(ctx, riderSprite, game.pendingDrop?.x ?? game.aim, anchorY - jump, reducedMotion ? 0 : Math.sin(now / 550) * .025, false, frame, 0, 0);
    }
  }

  for (const buddy of game.friends) {
    if (buddy.x > -50 && buddy.x < W + 50) {
      const bob = (!reducedMotion && buddy.landed ? Math.sin((now + buddy.animPhase) / 360) * 1.5 : 0) + (reducedMotion ? 0 : buddy.bounceY);
      const frame = reducedMotion ? 0 : Math.floor((now + buddy.animPhase) / (buddy.landed ? 430 : 120)) % 8;
      ctx.fillStyle = "rgba(0,0,0,.22)"; ctx.beginPath(); ctx.ellipse(buddy.x + 2, buddy.y + R + 2, 19 - Math.max(0, bob) * 1.2, 5, 0, 0, Math.PI * 2); ctx.fill();
      drawFriend(ctx, buddy.sprite, buddy.x, buddy.y, reducedMotion ? 0 : buddy.rotation, !buddy.landed, frame, bob, buddy.squash);
    }
  }
  ctx.restore();
  // Little falling sparkles near the island edge.
  if (!reducedMotion && game.startedAt !== null && game.endedAt === null) {
    const t = now / 900;
    ctx.fillStyle = "rgba(255,255,255,.7)";
    for (let i = 0; i < 8; i++) { const x = 252 + ((i * 79 + Math.floor(t * 15)) % 460); const y = 290 + ((i * 37 + Math.floor(t * 22)) % 115); ctx.fillRect(x, y, 3, 3); }
  }
  ctx.restore();
}

function simulate(game: Game, dt: number) {
  const steps = Math.max(1, Math.ceil(dt / (1 / 120))), step = dt / steps;
  for (let k = 0; k < steps; k++) {
    for (const b of game.friends) {
      b.squash = Math.max(0, b.squash - step * 3.5);
      if (b.bounceY > 0 || b.bounceVY > 0) {
        b.bounceVY -= 680 * step;
        b.bounceY = Math.max(0, b.bounceY + b.bounceVY * step);
        if (b.bounceY === 0) b.bounceVY = 0;
      }
      if (b.landed) continue;
      b.rotation += b.spin * step;
      b.vy = Math.min(b.vy + 1550 * step, 980);
      b.x += b.vx * step; b.y += b.vy * step;
      b.vx *= Math.pow(.999, step * 60);
      if (b.x > 35 && b.x < W - 35 && b.y + R > groundAt(b.x) && b.x > ISLAND_X - ISLAND_HALF + 8 && b.x < ISLAND_X + ISLAND_HALF - 8) {
        b.y = groundAt(b.x) - R;
        b.spin *= .9;
        if (b.vy > 55) { b.squash = clamp(b.vy / 700, .12, .5); b.vy *= -.14; } else b.vy = 0;
        const slope = (30 * (b.x - ISLAND_X)) / (ISLAND_HALF * ISLAND_HALF);
        b.vx += 1550 * slope * .55 * step;
        b.vx *= Math.pow(.997, step * 60);
        if (Math.abs(b.vy) < 24 && Math.abs(b.vx) < 13 && Math.abs(b.x - ISLAND_X) < 85) b.landed = true;
      }
    }
    for (let i = 0; i < game.friends.length; i++) for (let j = i + 1; j < game.friends.length; j++) {
      const a = game.friends[i], b = game.friends[j];
      if (a.landed && b.landed) continue;
      let dx = b.x - a.x, dy = b.y - a.y, distance = Math.hypot(dx, dy);
      const min = R * 2;
      if (distance >= min) continue;
      if (!distance) { dx = .01; distance = .01; }
      const nx = dx / distance, ny = dy / distance, overlap = min - distance;
      if (!a.landed && !b.landed) { a.x -= nx * overlap * .5; a.y -= ny * overlap * .5; b.x += nx * overlap * .5; b.y += ny * overlap * .5; }
      else if (!a.landed) { a.x -= nx * overlap; a.y -= ny * overlap; }
      else if (!b.landed) { b.x += nx * overlap; b.y += ny * overlap; }
      const relative = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
      if (relative < 0) {
        const impulse = -(1.12 * relative) / ((a.landed ? 0 : 1) + (b.landed ? 0 : 1) || 1);
        if (Math.abs(relative) > 38) {
          const hop = clamp(Math.abs(relative) * .12, 24, 72);
          a.bounceVY = Math.max(a.bounceVY, hop); b.bounceVY = Math.max(b.bounceVY, hop);
        }
        const squash = Math.min(.32, Math.abs(impulse) / 900);
        if (!a.landed) a.squash = Math.max(a.squash, squash);
        if (!b.landed) b.squash = Math.max(b.squash, squash);
        if (!a.landed) { a.vx -= impulse * nx; a.vy -= impulse * ny; }
        if (!b.landed) { b.vx += impulse * nx; b.vy += impulse * ny; }
        if (a.landed && !b.landed && Math.abs(impulse * nx) > 36) { a.landed = false; a.vx -= impulse * nx * .18; }
        if (b.landed && !a.landed && Math.abs(impulse * nx) > 36) { b.landed = false; b.vx += impulse * nx * .18; }
        if (Math.abs(a.vy) < 31 && a.y < groundAt(a.x) - R + 1) a.landed = true;
        if (Math.abs(b.vy) < 31 && b.y < groundAt(b.x) - R + 1) b.landed = true;
      }
    }
  }
  // Remove Friends that have fallen well past the playfield. They cannot affect
  // the stack or score, and keeping them would eventually block further drops.
  game.friends = game.friends.filter(friend => friend.x >= -R * 2 && friend.x <= W + R * 2 && friend.y <= H + R * 2);
}

/** A gravity stacking game with generated Rare Friends sprite variants. */
export default function IslandStack({ friendId, client, paused }: GameComponentProps) {
  const canvas = useRef<HTMLCanvasElement>(null), world = useRef<Game>(createGame()), readerRef = useRef<ReturnType<typeof createFriendReader> | null>(null);
  const riderSpriteRef = useRef<GenerationSprites | null>(null);
  const spritePoolRef = useRef<Array<{ sprite: GenerationSprites; signature: string }>>([]), preloadingRef = useRef(false);
  const audioRef = useRef<AudioContext | null>(null), soundEnabledRef = useRef(true);
  const leaderboardRef = useRef<ScoreEntry[]>([]);
  const live = useRef({ paused, reduced: false }), lastFrame = useRef(0), clockFrame = useRef(0), dropping = useRef(false), [, redraw] = useState(0);
  const [generationReady, setGenerationReady] = useState(false), [generationError, setGenerationError] = useState(""), [reducedMotion, setReducedMotion] = useState(false);
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [leaderboardOpen, setLeaderboardOpen] = useState(false);
  const [elapsed, setElapsed] = useState(0), [count, setCount] = useState(0), [best, setBest] = useState(0), [runStarted, setRunStarted] = useState(false);
  const [leaderboard, setLeaderboard] = useState<ScoreEntry[]>([]);
  live.current = { paused, reduced: reducedMotion };

  const wakeAudio = useCallback(() => {
    if (!soundEnabledRef.current || typeof window === "undefined" || !window.AudioContext) return;
    try {
      audioRef.current ??= new AudioContext();
      if (audioRef.current.state === "suspended") void audioRef.current.resume().catch(() => undefined);
    } catch { /* Audio is optional; gameplay remains available if the browser blocks it. */ }
  }, []);
  const playDropSound = useCallback(() => {
    if (!soundEnabledRef.current) return;
    wakeAudio();
    const context = audioRef.current;
    if (!context) return;
    const play = () => {
      if (!soundEnabledRef.current || context.state !== "running") return;
      const now = context.currentTime, oscillator = context.createOscillator(), volume = context.createGain();
      oscillator.type = "square";
      oscillator.frequency.setValueAtTime(620, now);
      oscillator.frequency.exponentialRampToValueAtTime(245, now + .13);
      volume.gain.setValueAtTime(.0001, now);
      volume.gain.exponentialRampToValueAtTime(.12, now + .012);
      volume.gain.exponentialRampToValueAtTime(.0001, now + .16);
      oscillator.connect(volume); volume.connect(context.destination);
      oscillator.start(now); oscillator.stop(now + .17);
    };
    if (context.state === "running") play();
    else void context.resume().then(play).catch(() => undefined);
  }, [wakeAudio]);
  const toggleSound = useCallback(() => {
    const enabled = !soundEnabledRef.current;
    soundEnabledRef.current = enabled; setSoundEnabled(enabled);
    if (enabled) wakeAudio();
  }, [wakeAudio]);

  const fillSpritePool = useCallback(async () => {
    const reader = readerRef.current;
    if (!reader || preloadingRef.current) return;
    preloadingRef.current = true;
    try {
      while (spritePoolRef.current.length < SPRITE_POOL_TARGET && readerRef.current === reader) {
        const unavailable = new Set(world.current.usedSprites);
        spritePoolRef.current.forEach(item => unavailable.add(item.signature));
        const item = await generateUniqueFriend(reader, unavailable);
        if (readerRef.current !== reader) return;
        spritePoolRef.current.push(item);
        if (spritePoolRef.current.length >= SPRITE_POOL_READY) setGenerationReady(true);
      }
    } catch { setGenerationReady(true); /* The drop handler retries lazily if the preloaded pool is empty. */ }
    finally { preloadingRef.current = false; }
  }, []);

  useEffect(() => {
    const reader = createFriendReader();
    readerRef.current = reader; riderSpriteRef.current = null; spritePoolRef.current = []; preloadingRef.current = false; setGenerationReady(false); setGenerationError(""); world.current = createGame();
    void reader.read(friendId).then(sprite => { if (readerRef.current === reader) riderSpriteRef.current = sprite; })
      .catch(() => { if (readerRef.current === reader) setGenerationError("Could not load your Friend's artwork. Check your connection and try again."); });
    void fillSpritePool();
    const preference = window.matchMedia("(prefers-reduced-motion: reduce)"), update = () => setReducedMotion(preference.matches);
    update(); preference.addEventListener("change", update);
    return () => { preference.removeEventListener("change", update); };
  }, [fillSpritePool, friendId]);

  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem("friend-island-top10") || "[]");
      const valid: ScoreEntry[] = Array.isArray(saved) ? saved.filter(entry => Number.isInteger(entry?.score) && entry.score >= 0 && Number.isFinite(entry?.playedAt))
        .slice(0, 10).map(entry => ({ score: entry.score, playedAt: entry.playedAt,
          friendId: typeof entry.friendId === "string" && /^\d+$/.test(entry.friendId) ? entry.friendId : friendId.toString() })) : [];
      leaderboardRef.current = valid; setLeaderboard(valid);
    } catch { leaderboardRef.current = []; setLeaderboard([]); }
  }, []);

  // The SDK host waits for the first snapshot before removing its loading screen.
  // Reading once initializes that bridge without performing any economy action.
  useEffect(() => { void client.read().catch(() => undefined); }, [client, friendId]);
  useEffect(() => () => { void audioRef.current?.close().catch(() => undefined); }, []);

  const drop = useCallback(async () => {
    const game = world.current, now = performance.now(), reader = readerRef.current;
    if (dropping.current || game.pendingDrop || live.current.paused || !generationReady || !reader || game.startedAt === null || game.endedAt !== null || now - game.lastDrop < DROP_COOLDOWN || game.friends.length >= MAX_FRIENDS_ON_SCREEN) return;
    dropping.current = true; setGenerationError("");
    const pending: PendingDrop = { sprite: null, x: game.aim, startedAt: now, spin: (Math.random() < .5 ? -1 : 1) * (.65 + Math.random() * .25), animPhase: Math.random() * 1200 };
    game.pendingDrop = pending; game.lastDrop = now;
    try {
      const buffered = spritePoolRef.current.shift();
      const { sprite, signature } = buffered ?? await generateUniqueFriend(reader, new Set([...game.usedSprites, ...spritePoolRef.current.map(item => item.signature)]));
      if (world.current !== game || game.pendingDrop !== pending || game.endedAt !== null || game.friends.length >= MAX_FRIENDS_ON_SCREEN) return;
      game.usedSprites.add(signature);
      pending.sprite = sprite;
      void fillSpritePool();
    } catch (error) {
      if (world.current === game && game.pendingDrop === pending) game.pendingDrop = null;
      setGenerationError(error instanceof Error ? `${error.message} Check your connection and try again.` : "Could not generate a Friend appearance. Check your connection and try again.");
    } finally {
      dropping.current = false;
    }
  }, [fillSpritePool, generationReady, playDropSound]);

  const startRun = useCallback(() => {
    if (live.current.paused || !generationReady || world.current.startedAt !== null) return;
    wakeAudio();
    world.current.startedAt = performance.now();
    lastFrame.current = 0;
    setElapsed(0); setRunStarted(true);
  }, [generationReady, wakeAudio]);
  const reset = useCallback(() => { if (live.current.paused) return; world.current = createGame(); setElapsed(0); setCount(0); setRunStarted(false); setGenerationError(""); lastFrame.current = 0; redraw(v => v + 1); }, []);
  const playAgain = useCallback(() => {
    if (live.current.paused) return;
    wakeAudio();
    world.current = createGame();
    world.current.startedAt = performance.now();
    setElapsed(0); setCount(0); setGenerationError(""); setRunStarted(true); lastFrame.current = 0;
  }, [wakeAudio]);

  useEffect(() => {
    const node = canvas.current, ctx = node?.getContext("2d");
    if (!node || !ctx) { setGenerationReady(false); setGenerationError("This browser cannot render the game."); return; }
    let raf = 0;
    const loop = (now: number) => {
      const g = world.current, delta = lastFrame.current ? Math.max(0, now - lastFrame.current) : 0, dt = clamp(delta / 1000, 0, .04); lastFrame.current = now;
      if (live.current.paused || document.hidden) {
        if (g.startedAt !== null && g.endedAt === null) g.startedAt += delta;
        if (g.lastDrop) g.lastDrop += delta;
        if (g.pendingDrop) g.pendingDrop.startedAt += delta;
      }
      if (!live.current.paused && g.startedAt !== null && g.endedAt === null) {
        if (g.pendingDrop?.sprite && now - g.pendingDrop.startedAt >= RIDER_JUMP_MS) {
          const pending = g.pendingDrop; g.pendingDrop = null;
          const { y: anchorY } = nextDropY(g);
          g.friends.push({ id: g.nextId++, sprite: pending.sprite, x: pending.x, y: anchorY + 82, vx: 0, vy: 20,
            rotation: 0, spin: pending.spin, landed: false, squash: 0, bounceY: 0, bounceVY: 0, animPhase: pending.animPhase });
          playDropSound();
          setCount(g.friends.filter(friend => friend.y + R >= ISLAND_TOP - 54 && friend.y < H).length);
        }
        simulate(g, dt);
        const seconds = Math.max(0, Math.ceil(ROUND_SECONDS - (now - g.startedAt) / 1000));
        if (seconds === 0 && !g.pendingDrop) {
          g.endedAt = now;
          const survivors = countSurvivors(g);
          setBest(value => Math.max(value, survivors)); setCount(survivors); setElapsed(ROUND_SECONDS);
          const updated = [...leaderboardRef.current, { score: survivors, playedAt: Date.now(), friendId: friendId.toString() }].sort((a, b) => b.score - a.score || a.playedAt - b.playedAt).slice(0, 10);
          leaderboardRef.current = updated; setLeaderboard(updated);
          try { localStorage.setItem("friend-island-top10", JSON.stringify(updated)); } catch { /* The in-session list still works when storage is unavailable. */ }
        } else if (now - clockFrame.current > 120) { clockFrame.current = now; setElapsed(Math.floor((now - g.startedAt) / 1000)); }
        if (now % 140 < 19) setCount(countSurvivors(g));
      }
      drawScene(ctx, g, riderSpriteRef.current, W, H, live.current.reduced, now);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop); return () => cancelAnimationFrame(raf);
  }, [friendId, playDropSound]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === " ") event.preventDefault();
      if (event.key === " " && !event.repeat) { if (!runStarted) startRun(); else void drop(); }
      if (event.key.toLowerCase() === "r" && world.current.endedAt !== null) reset();
    };
    window.addEventListener("keydown", onKey); return () => window.removeEventListener("keydown", onKey);
  }, [drop, reset, runStarted, startRun]);

  const moveAim = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (world.current.pendingDrop) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const screenX = (event.clientX - rect.left) / rect.width * W;
    const worldX = ISLAND_X + (screenX - ISLAND_X) / cameraZoom(world.current);
    world.current.aim = clamp(worldX, ISLAND_X - ISLAND_HALF + R, ISLAND_X + ISLAND_HALF - R);
  };
  const tapField = (event: ReactPointerEvent<HTMLCanvasElement>) => { moveAim(event); if (runStarted) void drop(); };
  const remaining = Math.max(0, ROUND_SECONDS - elapsed);
  const survivors = countSurvivors(world.current);

  return <main className="island-game" aria-label="Stack n Slide">
    <canvas ref={canvas} className="island-canvas" width={W} height={H} aria-label="Move the pointer to aim; after starting, click anywhere to drop a Friend. Press Space to drop." onPointerMove={moveAim} onPointerDown={tapField} />
    <header className="island-topbar">
      <div className="brand"><span><small>RARE FRIENDS · ARCADE</small><b className="pixel-title"><PixelText text="STACK N" /><PixelText text="SLIDE" /></b></span></div>
      <div className="island-stat"><small>STILL STANDING</small><b>{world.current.endedAt !== null ? count : survivors}</b></div>
      <div className={`island-timer${remaining <= 10 && runStarted ? " urgent" : ""}`}><small>{runStarted ? "TIME LEFT" : "YOUR RUN"}</small><b>{remaining}<em> SEC</em></b></div>
    </header>
    <button type="button" className="sound-toggle" aria-label={soundEnabled ? "Mute sound" : "Turn sound on"} aria-pressed={soundEnabled} onClick={toggleSound} title={soundEnabled ? "Sound on" : "Sound off"}>
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 9v6h4l5 4V5L7 9H3Z" fill="currentColor" />{soundEnabled ? <path d="M15 9a4 4 0 0 1 0 6m3-9a8 8 0 0 1 0 12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="square" /> : <path d="m15 9 6 6m0-6-6 6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="square" />}</svg>
    </button>
    <button type="button" className="leaderboard-toggle" aria-expanded={leaderboardOpen} aria-controls="stack-leaderboard" onClick={() => setLeaderboardOpen(open => !open)}>
      TOP 10 <span aria-hidden="true">{leaderboardOpen ? "×" : "+"}</span>
    </button>
    <aside id="stack-leaderboard" className={`leaderboard${leaderboardOpen ? " mobile-open" : ""}`} aria-label="Top 10 players">
      <div className="leaderboard-heading"><b>TOP PLAYERS</b><button type="button" className="leaderboard-close" aria-label="Close leaderboard" onClick={() => setLeaderboardOpen(false)}>×</button></div>
      <ol>{Array.from({ length: 10 }, (_, index) => {
        const entry = leaderboard[index];
        const prize = [25, 10, 5][index];
        return <li key={entry ? `${entry.playedAt}-${index}` : `empty-${index}`} className={prize ? "prize-place" : undefined}>
          <span className="rank">{String(index + 1).padStart(2, "0")}</span><span className="score-player">{entry ? `Friend #${entry.friendId} (You)` : "—"}</span>
          <b>{entry ? entry.score : "—"}</b><span className="leaderboard-prize">{prize ? `${prize} RF` : ""}</span>
        </li>;
      })}</ol>
    </aside>
    {generationError && <div className="game-alert" role="alert">{generationError}</div>}
    {world.current.endedAt === null && !runStarted && <div className="start-overlay"><button type="button" className="drop-button start-button" disabled={!generationReady || paused} onClick={startRun}>{generationReady ? "START GAME" : "PREPARING…"}<b>→</b></button></div>}
    {world.current.endedAt !== null && <div className="game-over-overlay" role="dialog" aria-modal="true" aria-labelledby="game-over-title">
      <section className="game-over-card"><small>STACK N SLIDE</small><h1 id="game-over-title">GAME OVER</h1><p className="score-label">TOTAL SCORE</p><strong className="final-score">{count}</strong><p className="score-caption">FRIEND{count === 1 ? "" : "S"} HELD ON THE ISLAND</p><button type="button" className="drop-button play-again-button" onClick={playAgain}>PLAY AGAIN <b>→</b></button></section>
    </div>}
  </main>;
}
