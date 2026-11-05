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
const player = new FoddyPlayer(world, level.spawnPoint.x, level.spawnPoint.y, sounds, level);

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
const hostTeleportBox = document.getElementById('host-teleport-box')!;
const tpFromSelect = document.getElementById('tp-from-select') as HTMLSelectElement;
const tpToSelect = document.getElementById('tp-to-select') as HTMLSelectElement;
const btnHostTp = document.getElementById('btn-host-tp') as HTMLButtonElement;
const playerCountEl = document.getElementById('player-count')!;
const playersListEl = document.getElementById('players-list')!;
const chatMessagesEl = document.getElementById('chat-messages')!;
const chatInput = document.getElementById('chat-input') as HTMLInputElement;
const btnSendChat = document.getElementById('btn-send-chat') as HTMLButtonElement;
const toastContainer = document.getElementById('toast-container')!;

let localChatBubbleText = '';
let localChatBubbleUntil = 0;

function appendChatMessage(author: string, color: string, text: string, isSelf: boolean) {
  const row = document.createElement('div');
  row.className = 'chat-msg';

  const authorSpan = document.createElement('span');
  authorSpan.className = 'chat-author';
  authorSpan.style.color = color || '#fbbf24';
  authorSpan.textContent = isSelf ? `${author} (Você):` : `${author}:`;

  const textSpan = document.createElement('span');
  textSpan.textContent = text;

  row.appendChild(authorSpan);
  row.appendChild(textSpan);
  chatMessagesEl.appendChild(row);
  chatMessagesEl.scrollTop = chatMessagesEl.scrollHeight;
}

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
      hostTeleportBox.classList.remove('hidden');
      activeRoomCode.textContent = code;
      const url = new URL(window.location.href);
      url.searchParams.set('room', code);
      window.history.replaceState({}, '', url.toString());
    }
  },
  onToast: (msg) => showToast(msg),
  onTeleportCommand: (destX, destY, destName) => {
    player.teleportTo(destX, destY);
    renderer.camPos.x = destX;
    renderer.camPos.y = destY + 1;
    showToast(`⚡ Você foi teleportado até ${destName}!`);
  },
  onChatMessage: (senderName, senderColor, text, isSelf) => {
    appendChatMessage(senderName, senderColor, text, isSelf);
    if (isSelf) {
      localChatBubbleText = text;
      localChatBubbleUntil = performance.now() + 6000;
    }
  },
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

btnHostTp.addEventListener('click', () => {
  const fromId = tpFromSelect.value;
  const toId = tpToSelect.value;
  if (!fromId || !toId) {
    showToast('Aguardando mais jogadores na sala!');
    return;
  }
  if (fromId === toId) {
    showToast('Escolha dois jogadores diferentes para o teleporte!');
    return;
  }

  // Resolve destination player coordinates & name
  let destX = 0;
  let destY = 1.2;
  let destName = network.myName;
  if (toId === network.myPeerId) {
    const myPos = player.potBody.getPosition();
    destX = myPos.x;
    destY = myPos.y + 1.6;
    destName = network.myName;
  } else {
    const destPlayer = network.remotePlayers.get(toId);
    if (!destPlayer) {
      showToast('Jogador de destino não encontrado!');
      return;
    }
    destX = destPlayer.potX;
    destY = destPlayer.potY + 1.6;
    destName = destPlayer.name;
  }

  // Execute teleport: if fromId is the host themselves, teleport locally; otherwise send Host Command packet
  if (fromId === network.myPeerId) {
    player.teleportTo(destX, destY);
    renderer.camPos.x = destX;
    renderer.camPos.y = destY + 1;
    showToast(`⚡ Você se teleportou até ${destName}!`);
  } else {
    const targetRemote = network.remotePlayers.get(fromId);
    const targetName = targetRemote ? targetRemote.name : 'Jogador';
    network.sendHostTeleportCommand(fromId, destX, destY, destName);
    if (targetRemote) {
      targetRemote.potX = destX;
      targetRemote.potY = destY;
      targetRemote.netPotX = destX;
      targetRemote.netPotY = destY;
    }
    showToast(`⚡ Teleportou ${targetName} até ${destName}!`);
  }
});

function submitChat() {
  const txt = chatInput.value.trim();
  if (!txt) return;
  network.sendChatMessage(txt);
  chatInput.value = '';
}

btnSendChat.addEventListener('click', () => {
  submitChat();
});

chatInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    submitChat();
  }
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
  player.setInputActive(isPointerLocked);
  if (isPointerLocked) {
    pointerOverlay.classList.add('locked');
  } else {
    pointerOverlay.classList.remove('locked');
  }
});

window.addEventListener('mousemove', (e) => {
  // Only track mouse movement when Pointer Lock is active!
  // Pressing ESC exits Pointer Lock and immediately stops hammer tracking so progress is never lost.
  if (isPointerLocked) {
    player.addMouseDelta(e.movementX, e.movementY);
  }
});

sensSlider.addEventListener('input', () => {
  const v = parseFloat(sensSlider.value);
  player.mouseSensitivity = v;
  sensVal.textContent = `${v.toFixed(1)}x`;
});

const SAVE_KEY = 'goi_original_map_saved_pos_v4';

window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    player.setInputActive(false);
    if (document.activeElement === chatInput) {
      chatInput.blur();
    }
    return;
  }
  if (
    document.activeElement === playerNameInput ||
    document.activeElement === roomCodeInput ||
    document.activeElement === chatInput
  ) {
    return;
  }
  if (e.key === 'Enter' || e.key.toLowerCase() === 't') {
    e.preventDefault();
    if (document.pointerLockElement === canvas && document.exitPointerLock) {
      document.exitPointerLock();
    }
    player.setInputActive(false);
    chatInput.focus();
    return;
  }
  if (e.key.toLowerCase() === 'r') {
    player.teleportTo(level.spawnPoint.x, level.spawnPoint.y);
    localStorage.removeItem(SAVE_KEY);
    showToast('Reiniciado na base da montanha!');
  }
});

// ============================================================================
// 5. SAVIOUR.CS AUTO-SAVE & FIXED-TIMESTEP GAME LOOP (60Hz)
// ============================================================================
let bestHeight = parseFloat(localStorage.getItem('goi_best_height') || '0') || 0;
const savedPosJson = localStorage.getItem(SAVE_KEY);
if (savedPosJson) {
  try {
    const sp = JSON.parse(savedPosJson);
    if (typeof sp.x === 'number' && typeof sp.y === 'number' && sp.y > 0.2) {
      player.teleportTo(sp.x, sp.y);
      renderer.camPos.x = sp.x;
      renderer.camPos.y = sp.y + 1;
    }
  } catch {
    // ignore malformed save
  }
} else {
  renderer.camPos.x = level.spawnPoint.x;
  renderer.camPos.y = level.spawnPoint.y + 1;
}

const FIXED_DT = 1 / 60;
let accumulator = 0;
let lastFrameTime = performance.now();
let startTime = performance.now();
let frameCounter = 0;

function gameLoop(now: number) {
  const frameDt = Math.min((now - lastFrameTime) / 1000, 0.05);
  lastFrameTime = now;
  accumulator += frameDt;

  while (accumulator >= FIXED_DT) {
    player.fixedUpdate(FIXED_DT);
    network.updateRemotePlayers(FIXED_DT, player.potBody, chkTether.checked);
    world.step(FIXED_DT, 8, 4);
    renderer.updateCamera(FIXED_DT, player);
    accumulator -= FIXED_DT;
  }

  frameCounter++;

  // Broadcast Co-op state outside physics loop (internally throttled to 12Hz + delta compression)
  if (network.isConnected) {
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

  // Auto-save position every ~90 frames (~1.5s), matching Saviour.Update
  if (frameCounter % 90 === 0) {
    const potPos = player.potBody.getPosition();
    localStorage.setItem(SAVE_KEY, JSON.stringify({ x: potPos.x, y: potPos.y }));
  }

  // Render scene
  const activeLocalBubble = now < localChatBubbleUntil ? localChatBubbleText : '';
  renderer.render(
    level,
    player,
    network.myName,
    network.myColor,
    network.remotePlayers,
    chkTether.checked,
    activeLocalBubble
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

  // Update Co-op player list & Host Teleport Dropdowns
  if (network.isConnected) {
    playerCountEl.textContent = String(1 + network.remotePlayers.size);
    const hostCrown = network.isHost ? ' 👑' : '';
    let html = `<li>
      <span class="player-badge"><span class="color-swatch" style="background:${network.myColor}"></span>${network.myName} (Você)${hostCrown}</span>
      <strong>${currentHeight.toFixed(1)}m</strong>
    </li>`;
    for (const r of network.remotePlayers.values()) {
      const rH = Math.max(0, r.potY).toFixed(1);
      const rCrown = r.isHost ? ' 👑' : '';
      html += `<li>
        <span class="player-badge"><span class="color-swatch" style="background:${r.color}"></span>${r.name}${rCrown}</span>
        <strong>${rH}m</strong>
      </li>`;
    }
    playersListEl.innerHTML = html;

    // Keep Teleport selects synced with current party members for ALL players in the room
    const partyMembers = [
      { id: network.myPeerId, label: `${network.myName} (Você)` },
      ...Array.from(network.remotePlayers.values()).map((r) => ({
        id: r.peerId,
        label: r.name,
      })),
    ];
    const sig = partyMembers.map((m) => `${m.id}:${m.label}`).join('|');
    if (tpFromSelect.dataset.sig !== sig) {
      const prevFrom = tpFromSelect.value;
      const prevTo = tpToSelect.value;
      const optionsHtml = partyMembers
        .map((m) => `<option value="${m.id}">${m.label}</option>`)
        .join('');
      tpFromSelect.innerHTML = optionsHtml;
      tpToSelect.innerHTML = optionsHtml;
      tpFromSelect.dataset.sig = sig;
      if (prevFrom && partyMembers.some((m) => m.id === prevFrom)) {
        tpFromSelect.value = prevFrom;
      } else {
        tpFromSelect.value = partyMembers[0].id;
      }
      if (prevTo && partyMembers.some((m) => m.id === prevTo)) {
        tpToSelect.value = prevTo;
      } else if (partyMembers.length > 1) {
        tpToSelect.value = partyMembers[1].id;
      } else {
        tpToSelect.value = partyMembers[0].id;
      }
    }
  }
}

requestAnimationFrame(gameLoop);
