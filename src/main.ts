import * as planck from 'planck-js';
import { SoundSystem } from './audio/SoundSystem';
import { LevelBuilder } from './physics/LevelBuilder';
import { FoddyPlayer } from './physics/FoddyPlayer';
import { CoopNetwork } from './net/CoopNetwork';
import { GameRenderer } from './render/GameRenderer';

// ============================================================================
// 1. INITIALIZE PHYSICS WORLD (Decompiled GravityControl.Start: (0, -30))
// ============================================================================
const world = new planck.World({
  gravity: planck.Vec2(0, -30.0),
});

const sounds = new SoundSystem();
const level = new LevelBuilder(world);
const player = new FoddyPlayer(world, level.spawnPoint.x, level.spawnPoint.y, sounds);

const canvas = document.getElementById('game-canvas') as HTMLCanvasElement;
const renderer = new GameRenderer(canvas);

// ============================================================================
// 2. UI & TELEMETRY BINDINGS
// ============================================================================
const statHeight = document.getElementById('stat-height')!;
const statBest = document.getElementById('stat-best')!;
const statTime = document.getElementById('stat-time')!;

const txtFrictionMode = document.getElementById('txt-friction-mode')!;
const barFriction = document.getElementById('bar-friction')!;
const txtStrain = document.getElementById('txt-strain')!;
const barStrain = document.getElementById('bar-strain')!;
const txtExtension = document.getElementById('txt-extension')!;
const barExtension = document.getElementById('bar-extension')!;

const sensSlider = document.getElementById('sens-slider') as HTMLInputElement;
const sensVal = document.getElementById('sens-val')!;
const pointerOverlay = document.getElementById('pointer-lock-overlay')!;

const netDot = document.getElementById('net-dot')!;
const netStatusText = document.getElementById('net-status-text')!;
const playerNameInput = document.getElementById('player-name-input') as HTMLInputElement;
const playerColorInput = document.getElementById('player-color-input') as HTMLInputElement;

const lobbyControls = document.getElementById('coop-lobby-controls')!;
const activeRoomBox = document.getElementById('coop-active-room')!;
const activeRoomCode = document.getElementById('active-room-code')!;
const btnCreateRoom = document.getElementById('btn-create-room') as HTMLButtonElement;
const btnJoinRoom = document.getElementById('btn-join-room') as HTMLButtonElement;
const roomCodeInput = document.getElementById('room-code-input') as HTMLInputElement;
const btnCopyLink = document.getElementById('btn-copy-link') as HTMLButtonElement;
const chkTether = document.getElementById('chk-tether') as HTMLInputElement;
const btnTpFriend = document.getElementById('btn-tp-friend') as HTMLButtonElement;
const playerCountEl = document.getElementById('player-count')!;
const playersListEl = document.getElementById('players-list')!;
const toastContainer = document.getElementById('toast-container')!;

function showToast(msg: string) {
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = msg;
  toastContainer.appendChild(el);
  setTimeout(() => {
    el.remove();
  }, 4000);
}

// ============================================================================
// 3. CO-OP NETWORK SETUP & URL INVITE AUTO-JOIN
// ============================================================================
const network = new CoopNetwork(world, {
  onStatusChange: (status, online, code) => {
    netStatusText.textContent = status;
    netDot.className = 'status-dot ' + (online ? 'online' : 'connecting');
    if (online && code) {
      lobbyControls.classList.add('hidden');
      activeRoomBox.classList.remove('hidden');
      activeRoomCode.textContent = code;
      const url = new URL(window.location.href);
      url.searchParams.set('room', code);
      window.history.replaceState({}, '', url.toString());
    }
  },
  onToast: (msg) => showToast(msg),
});

// Load saved name/color
const savedName = localStorage.getItem('goi_player_name');
const savedColor = localStorage.getItem('goi_player_color');
if (savedName) {
  playerNameInput.value = savedName;
  network.myName = savedName;
}
if (savedColor) {
  playerColorInput.value = savedColor;
  network.myColor = savedColor;
}

playerNameInput.addEventListener('input', () => {
  network.myName = playerNameInput.value.trim() || 'Escalador';
  localStorage.setItem('goi_player_name', network.myName);
});

playerColorInput.addEventListener('input', () => {
  network.myColor = playerColorInput.value;
  localStorage.setItem('goi_player_color', network.myColor);
});

btnCreateRoom.addEventListener('click', () => {
  network.hostRoom().catch(() => {});
});

btnJoinRoom.addEventListener('click', () => {
  if (!roomCodeInput.value.trim()) {
    showToast('Digite o código da sala (ex: GOI-ABCD)');
    return;
  }
  network.joinRoom(roomCodeInput.value).catch(() => {});
});

btnCopyLink.addEventListener('click', () => {
  const url = new URL(window.location.href);
  url.searchParams.set('room', network.roomCode);
  navigator.clipboard.writeText(url.toString());
  showToast('🔗 Link da sala copiado! Envie para seus amigos.');
});

btnTpFriend.addEventListener('click', () => {
  const firstFriend = Array.from(network.remotePlayers.values())[0];
  if (!firstFriend) {
    showToast('Nenhum amigo na sala ainda!');
    return;
  }
  player.teleportTo(firstFriend.potX, firstFriend.potY + 1.8);
  showToast(`Teleportado para perto de ${firstFriend.name}!`);
});

// Auto-join if ?room=GOI-XXXX is in the URL
const urlParams = new URLSearchParams(window.location.search);
const roomFromUrl = urlParams.get('room');
if (roomFromUrl) {
  roomCodeInput.value = roomFromUrl;
  setTimeout(() => {
    network.joinRoom(roomFromUrl).catch(() => {});
  }, 400);
}

// ============================================================================
// 4. POINTER LOCK & INPUT CONTROLS
// ============================================================================
let isPointerLocked = false;

canvas.addEventListener('click', () => {
  if (!isPointerLocked && canvas.requestPointerLock) {
    canvas.requestPointerLock();
  }
});

document.addEventListener('pointerlockchange', () => {
  isPointerLocked = document.pointerLockElement === canvas;
  if (isPointerLocked) {
    pointerOverlay.classList.add('locked');
  } else {
    pointerOverlay.classList.remove('locked');
  }
});

window.addEventListener('mousemove', (e) => {
  if (isPointerLocked) {
    player.addMouseDelta(e.movementX, e.movementY);
  } else if (e.target === canvas) {
    // Follow mouse immediately on canvas even before Pointer Lock is engaged
    const worldMouse = renderer.screenToWorld(e.clientX, e.clientY);
    player.setWorldMouseFallback(worldMouse.x, worldMouse.y);
  }
});

sensSlider.addEventListener('input', () => {
  const v = parseFloat(sensSlider.value);
  player.mouseSensitivity = v;
  sensVal.textContent = `${v.toFixed(1)}x`;
});

window.addEventListener('keydown', (e) => {
  if (document.activeElement === playerNameInput || document.activeElement === roomCodeInput) {
    return;
  }
  if (e.key.toLowerCase() === 'r') {
    player.teleportTo(level.spawnPoint.x, level.spawnPoint.y);
    localStorage.removeItem('goi_jungle_saved_pos_v2');
    showToast('Reiniciado na base da floresta!');
  }
});

// ============================================================================
// 5. SAVIOUR.CS AUTO-SAVE & FIXED-TIMESTEP GAME LOOP (60Hz)
// ============================================================================
let bestHeight = parseFloat(localStorage.getItem('goi_best_height') || '0') || 0;
const savedPosJson = localStorage.getItem('goi_jungle_saved_pos_v2');
if (savedPosJson) {
  try {
    const sp = JSON.parse(savedPosJson);
    if (typeof sp.x === 'number' && typeof sp.y === 'number' && sp.y > 0.5) {
      player.teleportTo(sp.x, sp.y);
      renderer.camPos.x = sp.x;
      renderer.camPos.y = sp.y + 1;
    }
  } catch {
    // ignore malformed save
  }
}

const FIXED_DT = 1 / 60;
let accumulator = 0;
let lastFrameTime = performance.now();
let startTime = performance.now();
let frameCounter = 0;

function gameLoop(now: number) {
  const frameDt = Math.min((now - lastFrameTime) / 1000, 0.1);
  lastFrameTime = now;
  accumulator += frameDt;

  while (accumulator >= FIXED_DT) {
    player.fixedUpdate(FIXED_DT);
    network.updateRemotePlayers(FIXED_DT, player.potBody, chkTether.checked);
    world.step(FIXED_DT, 10, 8);
    renderer.updateCamera(FIXED_DT, player);

    frameCounter++;

    // Broadcast Co-op state at 30Hz
    if (frameCounter % 2 === 0 && network.isConnected) {
      const potPos = player.potBody.getPosition();
      const potVel = player.potBody.getLinearVelocity();
      const tipPos = player.tipBody.getPosition();
      network.broadcastState(
        potPos.x,
        potPos.y,
        player.visualPotTilt,
        potVel.x,
        potVel.y,
        tipPos.x,
        tipPos.y,
        player.hubBody.getAngle()
      );
    }

    // Auto-save position every 60 frames (1s), matching Saviour.Update (IL_0070)
    if (frameCounter % 60 === 0) {
      const potPos = player.potBody.getPosition();
      localStorage.setItem('goi_jungle_saved_pos_v2', JSON.stringify({ x: potPos.x, y: potPos.y }));
    }

    accumulator -= FIXED_DT;
  }

  // Render scene
  renderer.render(
    level,
    player,
    network.myName,
    network.myColor,
    network.remotePlayers,
    chkTether.checked
  );

  // Update HUD every 4 frames
  if (frameCounter % 4 === 0) {
    updateHUD(now);
  }

  requestAnimationFrame(gameLoop);
}

function updateHUD(now: number) {
  const potPos = player.potBody.getPosition();
  const currentHeight = Math.max(0, potPos.y);
  if (currentHeight > bestHeight) {
    bestHeight = currentHeight;
    localStorage.setItem('goi_best_height', bestHeight.toFixed(1));
  }

  statHeight.textContent = `${currentHeight.toFixed(1)} m`;
  statBest.textContent = `${bestHeight.toFixed(1)} m`;

  const elapsedSec = Math.floor((now - startTime) / 1000);
  const mins = String(Math.floor(elapsedSec / 60)).padStart(2, '0');
  const secs = String(elapsedSec % 60).padStart(2, '0');
  statTime.textContent = `${mins}:${secs}`;

  // REA Telemetry Bars
  const tel = player.telemetry;
  txtFrictionMode.textContent = tel.isStaticFriction
    ? `STATIC (${tel.frictionValue.toFixed(1)})`
    : `SLIDING (${tel.frictionValue.toFixed(2)})`;
  barFriction.style.width = tel.isStaticFriction ? '100%' : '25%';
  barFriction.className = 'bar-fill ' + (tel.isStaticFriction ? 'fill-green' : 'fill-orange');

  txtStrain.textContent = `${tel.strainPercent}%`;
  barStrain.style.width = `${tel.strainPercent}%`;

  txtExtension.textContent = `${tel.extensionMeters.toFixed(2)}m`;
  const extPct =
    ((tel.extensionMeters - player.MIN_ARM_REACH) /
      (player.MAX_ARM_REACH - player.MIN_ARM_REACH)) *
    100;
  barExtension.style.width = `${Math.min(Math.max(extPct, 5), 100)}%`;

  // Update Co-op player list
  if (network.isConnected) {
    playerCountEl.textContent = String(1 + network.remotePlayers.size);
    let html = `<li>
      <span class="player-badge"><span class="color-swatch" style="background:${network.myColor}"></span>${network.myName} (Você)</span>
      <strong>${currentHeight.toFixed(1)}m</strong>
    </li>`;
    for (const r of network.remotePlayers.values()) {
      const rH = Math.max(0, r.potY).toFixed(1);
      html += `<li>
        <span class="player-badge"><span class="color-swatch" style="background:${r.color}"></span>${r.name}</span>
        <strong>${rH}m</strong>
      </li>`;
    }
    playersListEl.innerHTML = html;
  }
}

requestAnimationFrame(gameLoop);
