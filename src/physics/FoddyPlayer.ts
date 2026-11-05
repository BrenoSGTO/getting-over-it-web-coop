import * as planck from 'planck-js';
import { SoundSystem } from '../audio/SoundSystem';
import { SurfaceMaterial, LevelBuilder } from './LevelBuilder';

export interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  color: string;
  size: number;
  life: number;
  maxLife: number;
}

export interface PlayerTelemetry {
  isStaticFriction: boolean;
  frictionValue: number;
  strainPercent: number;
  extensionMeters: number;
  motorSpeedDeg: number;
  sliderSpeed: number;
}

/**
 * Exact decompiled physics controller from Getting Over It with Bennett Foddy
 * Extracted via REA (`morluto/rea`) from Assembly-CSharp.dll:
 * - PlayerControl.FixedUpdate (token 0x060001e0)
 * - HammerCollisions.OnCollisionEnter2D / Stay2D / FixedUpdate (tokens 0x06000185-0x06000188)
 * - PotSounds.FixedUpdate (token 0x060001fc)
 */
export class FoddyPlayer {
  public potBody: planck.Body;
  public hubBody: planck.Body;
  public tipBody: planck.Body;

  public hingeJoint: planck.RevoluteJoint;
  public sliderJoint: planck.PrismaticJoint;

  private potBottomFixture: planck.Fixture;
  private tipFixture: planck.Fixture;

  // Decompiled fields from PlayerControl.cs
  public fakeCursorPos = planck.Vec2(0, 1.5);
  public cursorOffset = planck.Vec2(1.4, 0.65);
  public mw = planck.Vec2(0, 1.5);
  public mouseInput = planck.Vec2(0, 0);
  public oldMouse = planck.Vec2(0, 0);
  public mouseVelocityAverage = 0.05;
  public mouseSensitivity = 1.0;
  public angleEpsilon = 1.0; // deg
  public deadzone = 0.15; // m
  public oldAngle = 0;
  public mouseSnap = false;
  public visualPotTilt = 0;
  public isInputActive = false;

  // Decompiled fields from HammerCollisions.cs & PotSounds.cs
  public tipSlide = true;
  public potSlide = true;
  public moveThreshold = 0.045;
  public potMoveThreshold = 0.07;
  public hardHitThreshold = 14.0;
  public whooshThreshold = 1.5;

  // Static vs Sliding friction values
  public readonly TIP_STATIC_FRICTION = 3.6;
  public readonly TIP_SLIDING_FRICTION = 0.55;
  public readonly POT_STATIC_FRICTION = 0.95;
  public readonly POT_SLIDING_FRICTION = 0.22;

  private tipContactAnchor: planck.Vec2 | null = null;
  private tipContactMaterial: SurfaceMaterial = 'wood';
  private tipIsTouchingTerrain = false;

  private potContactAnchor: planck.Vec2 | null = null;
  private potIsTouchingTerrain = false;

  private oldDeltaPos = planck.Vec2(0, 0);
  private pendingMouseDX = 0;
  private pendingMouseDY = 0;
  private directWorldTarget: planck.Vec2 | null = null;

  public particles: Particle[] = [];
  public telemetry: PlayerTelemetry = {
    isStaticFriction: false,
    frictionValue: 0.55,
    strainPercent: 0,
    extensionMeters: 1.4,
    motorSpeedDeg: 0,
    sliderSpeed: 0,
  };

  public readonly MAX_ARM_REACH = 2.85;
  public readonly MIN_ARM_REACH = 0.42;
  public readonly SHOULDER_OFFSET_Y = 0.35;

  constructor(
    private world: planck.World,
    spawnX: number,
    spawnY: number,
    private sounds: SoundSystem,
    private level: LevelBuilder
  ) {
    // 1. SKIBIDI TOILET / POT BODY
    this.potBody = this.world.createBody({
      type: 'dynamic',
      position: planck.Vec2(spawnX, spawnY),
      fixedRotation: true,
      linearDamping: 0.14,
      angularDamping: 2.0,
      bullet: true,
    });

    // Lower rounded base of the porcelain toilet bowl
    this.potBottomFixture = this.potBody.createFixture(
      planck.Circle(planck.Vec2(0, -0.18), 0.45),
      {
        density: 3.0,
        friction: this.POT_SLIDING_FRICTION,
        restitution: 0.0,
        filterGroupIndex: -1, // Never collide with own arm/hammer
      }
    );
    this.potBottomFixture.setUserData({ isPot: true });

    // Smooth rounded upper bowl (capsule top so it never snags on corners!)
    const rimFixture = this.potBody.createFixture(
      planck.Circle(planck.Vec2(0, 0.06), 0.41),
      {
        density: 1.0,
        friction: 0.15,
        restitution: 0.0,
        filterGroupIndex: -1,
      }
    );
    rimFixture.setUserData({ isPot: true });

    // 2. SHOULDER HUB BODY (Intermediate body connecting RevoluteJoint and PrismaticJoint)
    const shoulderPos = planck.Vec2(spawnX, spawnY + this.SHOULDER_OFFSET_Y);
    this.hubBody = this.world.createBody({
      type: 'dynamic',
      position: shoulderPos,
      angle: 0,
      bullet: true,
      angularDamping: 1.5,
    });
    this.hubBody.createFixture(planck.Circle(0.18), {
      density: 2.0,
      filterGroupIndex: -1,
      isSensor: true,
    });
    // High rotational inertia on hubBody ensures the PrismaticJoint never bends under load
    this.hubBody.setMassData({
      mass: 1.5,
      center: planck.Vec2(0, 0),
      I: 7.5,
    });

    // 3. BANANA PICKAXE TIP BODY
    this.tipBody = this.world.createBody({
      type: 'dynamic',
      position: shoulderPos,
      angle: 0,
      bullet: true,
      fixedRotation: false,
      linearDamping: 0.05,
      angularDamping: 1.5,
    });

    // Banana Pickaxe head shape (0.26m along shaft X, 0.54m across curved banana blades Y)
    this.tipFixture = this.tipBody.createFixture(
      planck.Box(0.13, 0.26),
      {
        density: 2.5,
        friction: this.TIP_STATIC_FRICTION,
        restitution: 0.0,
        filterGroupIndex: -1,
      }
    );
    this.tipFixture.setUserData({ isHammerTip: true });

    // Top banana tip hook for catching branches and vine knots cleanly
    const topHookFix = this.tipBody.createFixture(
      planck.Circle(planck.Vec2(-0.04, 0.26), 0.14),
      {
        density: 1.1,
        friction: this.TIP_STATIC_FRICTION,
        restitution: 0.0,
        filterGroupIndex: -1,
      }
    );
    topHookFix.setUserData({ isHammerTip: true });

    // Bottom banana tip hook for under-hooking vines and branches
    const botHookFix = this.tipBody.createFixture(
      planck.Circle(planck.Vec2(-0.04, -0.26), 0.14),
      {
        density: 1.1,
        friction: this.TIP_STATIC_FRICTION,
        restitution: 0.0,
        filterGroupIndex: -1,
      }
    );
    botHookFix.setUserData({ isHammerTip: true });

    // 4. HINGE JOINT (hj) - Rotates the arm around the monkey's shoulder
    this.hingeJoint = this.world.createJoint(
      planck.RevoluteJoint(
        {
          enableMotor: true,
          maxMotorTorque: 4800.0,
          motorSpeed: 0,
          collideConnected: false,
        },
        this.potBody,
        this.hubBody,
        shoulderPos
      )
    )!;

    // 5. SLIDER JOINT (sj) - Extends/retracts the banana pickaxe along the shaft
    this.sliderJoint = this.world.createJoint(
      planck.PrismaticJoint(
        {
          enableLimit: true,
          lowerTranslation: this.MIN_ARM_REACH,
          upperTranslation: this.MAX_ARM_REACH,
          enableMotor: true,
          maxMotorForce: 3800.0,
          motorSpeed: 0,
          collideConnected: false,
        },
        this.hubBody,
        this.tipBody,
        shoulderPos,
        planck.Vec2(1, 0)
      )
    )!;

    // Place hammer at initial rest pose (angle 0.4 rad, reach 1.45m)
    this.teleportTo(spawnX, spawnY);

    this.setupCollisionListeners();
  }

  private setupCollisionListeners() {
    this.world.on('begin-contact', (contact) => {
      if (!contact.isTouching()) return;
      const fA = contact.getFixtureA();
      const fB = contact.getFixtureB();
      const uA = (fA.getUserData() || {}) as Record<string, unknown>;
      const uB = (fB.getUserData() || {}) as Record<string, unknown>;

      const isTip = uA.isHammerTip || uB.isHammerTip;
      const isPot = uA.isPot || uB.isPot;
      const terrainData = (uA.isTerrain ? uA : uB.isTerrain ? uB : null) as {
        material?: SurfaceMaterial;
      } | null;

      if (!terrainData) return;

      const worldManifold = contact.getWorldManifold(null);
      const pt = worldManifold?.points?.[0]
        ? planck.Vec2(worldManifold.points[0].x, worldManifold.points[0].y)
        : this.tipBody.getPosition().clone();

      if (isTip) {
        const relVel = planck.Vec2.sub(
          this.tipBody.getLinearVelocity(),
          this.potBody.getLinearVelocity()
        );
        const speed = relVel.length();

        // Decompiled HammerCollisions.OnCollisionEnter2D (IL_0067: speed > 14 -> HammerReturn)
        if (speed > 14.0) {
          this.hammerReturn();
        }

        if (!this.tipIsTouchingTerrain) {
          this.tipIsTouchingTerrain = true;
          this.tipContactAnchor = pt.clone();
          this.tipContactMaterial = terrainData.material || 'rock';
          this.tipSlide = false; // Lock static friction on new grip!
        }

        if (speed > 1.8) {
          const normVel = Math.min(speed / this.hardHitThreshold, 1.5);
          this.sounds.playHammerHit(normVel, terrainData.material || 'rock');
          this.spawnImpactParticles(
            pt.x,
            pt.y,
            speed > 8 ? '#fbbf24' : '#cbd5e1',
            Math.min(Math.floor(speed * 1.5), 14)
          );
        }
      } else if (isPot) {
        const speed = this.potBody.getLinearVelocity().length();
        if (!this.potIsTouchingTerrain) {
          this.potIsTouchingTerrain = true;
          this.potContactAnchor = pt.clone();
          this.potSlide = false;
        }
        if (speed > 2.2) {
          this.sounds.playPotClunk(Math.min(speed / 12, 1.0));
          this.spawnImpactParticles(pt.x, pt.y, '#94a3b8', Math.min(Math.floor(speed), 8));
        }
      }
    });

    this.world.on('end-contact', (contact) => {
      const fA = contact.getFixtureA();
      const fB = contact.getFixtureB();
      const uA = (fA.getUserData() || {}) as Record<string, unknown>;
      const uB = (fB.getUserData() || {}) as Record<string, unknown>;

      if (uA.isHammerTip || uB.isHammerTip) {
        // Check if any other contact on tipBody is still touching
        let stillTouching = false;
        for (let ce = this.tipBody.getContactList(); ce; ce = ce.next || null) {
          if (ce.contact !== contact && ce.contact.isTouching()) {
            stillTouching = true;
            break;
          }
        }
        if (!stillTouching) {
          this.tipIsTouchingTerrain = false;
          this.tipContactAnchor = null;
          this.tipSlide = true;
        }
      }

      if (uA.isPot || uB.isPot) {
        let stillTouching = false;
        for (let ce = this.potBody.getContactList(); ce; ce = ce.next || null) {
          if (ce.contact !== contact && ce.contact.isTouching()) {
            stillTouching = true;
            break;
          }
        }
        if (!stillTouching) {
          this.potIsTouchingTerrain = false;
          this.potContactAnchor = null;
          this.potSlide = true;
        }
      }
    });

    // CRITICAL: When the hammer tip penetrates or is inside any terrain block,
    // immediately disable the contact in pre-solve so the interior/reverse edges
    // of the terrain polygon NEVER trap the hammer or block it from pulling out!
    this.world.on('pre-solve', (contact) => {
      const fA = contact.getFixtureA();
      const fB = contact.getFixtureB();
      const uA = (fA.getUserData() || {}) as Record<string, unknown>;
      const uB = (fB.getUserData() || {}) as Record<string, unknown>;

      const isTip = uA.isHammerTip || uB.isHammerTip;
      if (!isTip) return;

      const terrainData = (uA.isTerrain ? uA : uB.isTerrain ? uB : null) as {
        id?: string;
      } | null;
      if (!terrainData || !terrainData.id) return;

      const tipPos = this.tipBody.getPosition();
      // If the tip is inside this terrain block (or any block), disable contact so it can freely exit
      const block = this.level.getBlockById(terrainData.id);
      if (block && this.level.isPointInsideBlock(tipPos.x, tipPos.y, block)) {
        contact.setEnabled(false);
      } else {
        const containingBlock = this.level.getContainingBlock(tipPos.x, tipPos.y);
        if (containingBlock) {
          contact.setEnabled(false);
        }
      }
    });
  }

  /**
   * Decompiled PlayerControl.HammerReturn (token 0x060001dc):
   * When the hammer slams hard into terrain above the pot, snaps fakeCursor to tip.
   */
  public hammerReturn() {
    const tipPos = this.tipBody.getPosition();
    const potPos = this.potBody.getPosition();
    const shoulderPos = this.hubBody.getPosition();
    if (tipPos.y - 0.4 >= potPos.y) {
      this.mouseSnap = true;
      this.fakeCursorPos = tipPos.clone();
      this.cursorOffset = planck.Vec2.sub(tipPos, shoulderPos);
    }
  }

  /**
   * Accumulate raw mouse deltas from Pointer Lock (mousemove)
   */
  public addMouseDelta(dx: number, dy: number) {
    if (!this.isInputActive) return;
    this.pendingMouseDX += dx;
    this.pendingMouseDY -= dy; // Invert Y so moving mouse up = +Y in world
    this.directWorldTarget = null;
  }

  /**
   * Immediately freezes hammer movement and stops tracking the mouse (e.g. when pressing ESC)
   * so the player never loses progress accidentally while the cursor is unlocked.
   */
  public setInputActive(active: boolean) {
    this.isInputActive = active;
    this.pendingMouseDX = 0;
    this.pendingMouseDY = 0;
    this.directWorldTarget = null;
    this.mouseInput = planck.Vec2(0, 0);
    this.oldMouse = planck.Vec2(0, 0);

    // Snap fakeCursorPos & cursorOffset to the current physical hammer tip position
    // so there is zero residual pull or jump when pausing or resuming!
    const shoulderPos = this.hubBody.getPosition();
    const tipPos = this.tipBody.getPosition();
    const currentOffset = planck.Vec2.sub(tipPos, shoulderPos);
    if (currentOffset.length() >= 0.15) {
      this.cursorOffset = currentOffset;
    }
    this.fakeCursorPos = planck.Vec2.add(shoulderPos, this.cursorOffset);
    this.mw = this.fakeCursorPos.clone();

    if (!active) {
      this.hingeJoint.setMotorSpeed(0);
      this.sliderJoint.setMotorSpeed(0);
    }
  }

  /**
   * Reset player to the bottom of the mountain (or any coordinate)
   */
  public teleportTo(x: number, y: number) {
    const shoulderPos = planck.Vec2(x, y + this.SHOULDER_OFFSET_Y);
    const initAngle = 0.4;
    const initReach = 1.45;
    const tipPos = planck.Vec2(
      shoulderPos.x + Math.cos(initAngle) * initReach,
      shoulderPos.y + Math.sin(initAngle) * initReach
    );

    this.potBody.setLinearVelocity(planck.Vec2(0, 0));
    this.potBody.setAngularVelocity(0);
    this.potBody.setPosition(planck.Vec2(x, y));
    this.potBody.setAngle(0);

    this.hubBody.setLinearVelocity(planck.Vec2(0, 0));
    this.hubBody.setAngularVelocity(0);
    this.hubBody.setPosition(shoulderPos);
    this.hubBody.setAngle(initAngle);

    this.tipBody.setLinearVelocity(planck.Vec2(0, 0));
    this.tipBody.setAngularVelocity(0);
    this.tipBody.setPosition(tipPos);
    this.tipBody.setAngle(initAngle);

    this.cursorOffset = planck.Vec2.sub(tipPos, shoulderPos);
    this.fakeCursorPos = tipPos.clone();
    this.mw = tipPos.clone();
    this.mouseVelocityAverage = 0.05;
  }

  /**
   * Runs one fixed physics tick (60Hz) implementing the exact decompiled mechanics from:
   * - PlayerControl.FixedUpdate
   * - HammerCollisions.OnCollisionStay2D & FixedUpdate
   * - PotSounds.FixedUpdate
   */
  public fixedUpdate(dt: number) {
    const potPos = this.potBody.getPosition();
    const shoulderPos = this.hubBody.getPosition();
    const tipPos = this.tipBody.getPosition();

    // Subtle visual wobble of the cauldron based on horizontal velocity (like Foddy's hubJoint)
    const potVel = this.potBody.getLinearVelocity();
    const targetTilt = Math.max(-0.18, Math.min(0.18, -potVel.x * 0.025));
    this.visualPotTilt += (targetTilt - this.visualPotTilt) * 0.2;

    // =========================================================================
    // 0. ANTI-STUCK SYSTEM: EJECT HAMMER IF INSIDE TERRAIN GEOMETRY
    // =========================================================================
    const insideBlock = this.level.getContainingBlock(tipPos.x, tipPos.y);
    if (insideBlock) {
      this.tipSlide = true;
      this.tipIsTouchingTerrain = false;
      this.tipContactAnchor = null;

      // Eject hammer back toward the player's shoulder along the arm shaft
      const toShoulder = planck.Vec2.sub(shoulderPos, tipPos);
      const dist = toShoulder.length();
      if (dist > 0.02) {
        const ejectDir = planck.Vec2.mul(toShoulder, 1 / dist);
        this.tipBody.setLinearVelocity(planck.Vec2.mul(ejectDir, 16.0));
      }

      // Also gently pull fakeCursorPos / cursorOffset out so the mouse doesn't pull deeper in
      const currentOffsetLen = this.cursorOffset.length();
      if (currentOffsetLen > this.MIN_ARM_REACH) {
        this.cursorOffset.mul(0.85);
        this.fakeCursorPos = planck.Vec2.add(shoulderPos, this.cursorOffset);
        this.mw = this.fakeCursorPos.clone();
      }
    }

    // =========================================================================
    // 1. DYNAMIC FRICTION SWITCHING (HammerCollisions.OnCollisionStay2D)
    // =========================================================================
    if (this.tipIsTouchingTerrain && this.tipContactAnchor) {
      const distMoved = planck.Vec2.sub(tipPos, this.tipContactAnchor).length();
      const tipSpeed = this.tipBody.getLinearVelocity().length();

      // Lock static grip when hammer tip is planted against a surface
      if (distMoved < this.moveThreshold && tipSpeed < 0.85) {
        this.tipSlide = false;
      } else if (distMoved > this.moveThreshold * 2.5 || tipSpeed > 1.8) {
        this.tipSlide = true;
        this.tipContactAnchor = tipPos.clone(); // Re-anchor as it slides
      }
    } else {
      this.tipSlide = true;
    }

    const activeTipFriction =
      this.tipContactMaterial === 'ice'
        ? 0.14
        : this.tipSlide
          ? this.TIP_SLIDING_FRICTION
          : this.TIP_STATIC_FRICTION;

    for (let f = this.tipBody.getFixtureList(); f; f = f.getNext()) {
      f.setFriction(activeTipFriction);
    }

    // Pot static/sliding friction switch
    if (this.potIsTouchingTerrain && this.potContactAnchor) {
      const potDist = planck.Vec2.sub(potPos, this.potContactAnchor).length();
      if (potDist < this.potMoveThreshold && potVel.length() < 1.2) {
        this.potSlide = false;
      } else {
        this.potSlide = true;
        this.potContactAnchor = potPos.clone();
      }
    } else {
      this.potSlide = true;
    }
    this.potBottomFixture.setFriction(
      this.potSlide ? this.POT_SLIDING_FRICTION : this.POT_STATIC_FRICTION
    );

    // =========================================================================
    // 2. FAKE CURSOR & MOUSE FILTERING (PlayerControl.FixedUpdate)
    // =========================================================================
    if (!this.isInputActive) {
      // When paused / ESC pressed (Pointer Lock inactive), completely freeze hammer motors
      // and anchor fakeCursorPos to the physical tip so the hammer never moves on its own!
      this.pendingMouseDX = 0;
      this.pendingMouseDY = 0;
      this.mouseInput = planck.Vec2(0, 0);
      this.oldMouse = planck.Vec2(0, 0);
      const currentOffset = planck.Vec2.sub(tipPos, shoulderPos);
      if (currentOffset.length() >= 0.15) {
        this.cursorOffset = currentOffset;
      }
      this.fakeCursorPos = planck.Vec2.add(shoulderPos, this.cursorOffset);
      this.mw = this.fakeCursorPos.clone();
      this.hingeJoint.setMotorSpeed(0);
      this.sliderJoint.setMotorSpeed(0);
      return;
    }

    if (this.mouseSnap) {
      this.mouseSnap = false;
    } else if (this.directWorldTarget) {
      // Unlocked mouse mode: follow mouse cursor directly in world space
      const desiredOffset = planck.Vec2.sub(this.directWorldTarget, shoulderPos);
      this.cursorOffset = planck.Vec2(
        this.cursorOffset.x + (desiredOffset.x - this.cursorOffset.x) * 0.65,
        this.cursorOffset.y + (desiredOffset.y - this.cursorOffset.y) * 0.65
      );
      this.directWorldTarget = null;
    } else {
      this.oldMouse = this.mouseInput.clone();

      // Convert raw pixel movement to meters (44px = 1m at 1.0x sensitivity)
      const dxMeters = (this.pendingMouseDX / 44.0) * this.mouseSensitivity;
      const dyMeters = (this.pendingMouseDY / 44.0) * this.mouseSensitivity;
      this.pendingMouseDX = 0;
      this.pendingMouseDY = 0;

      // Subtle acceleration curve for fast flicks
      const deltaMag = Math.hypot(dxMeters, dyMeters);
      const curveFactor = 1.0 + Math.min(deltaMag * 0.4, 0.6);
      const curvedInput = planck.Vec2(dxMeters * curveFactor, dyMeters * curveFactor);

      // Smooth input across 2 frames (Lerp 0.65)
      this.mouseInput = planck.Vec2(
        this.oldMouse.x * 0.35 + curvedInput.x * 0.65,
        this.oldMouse.y * 0.35 + curvedInput.y * 0.65
      );

      this.cursorOffset.x += this.mouseInput.x;
      this.cursorOffset.y += this.mouseInput.y;

      const targetVelAvg = Math.max(this.mouseInput.length(), 0.005);
      this.mouseVelocityAverage =
        this.mouseVelocityAverage + (targetVelAvg - this.mouseVelocityAverage) * 0.15;
    }

    // Clamp cursor offset within 3.1m radius around the shoulder
    const offsetLen = this.cursorOffset.length();
    if (offsetLen > 3.1) {
      this.cursorOffset.mul(3.1 / offsetLen);
    } else if (offsetLen < 0.15) {
      if (offsetLen > 0.0001) {
        this.cursorOffset.mul(0.15 / offsetLen);
      } else {
        this.cursorOffset = planck.Vec2(0.15, 0);
      }
    }

    this.fakeCursorPos = planck.Vec2.add(shoulderPos, this.cursorOffset);

    // When the hammer tip is physically blocked against terrain and the player stops moving
    // the mouse, gently relax fakeCursor partway toward the blocked hammer tip (Foddy's pullFactor)
    if (this.tipIsTouchingTerrain && this.mouseInput.length() < 0.02) {
      const tipMinusCursor = planck.Vec2.sub(tipPos, this.fakeCursorPos);
      if (tipMinusCursor.length() > 0.45) {
        this.cursorOffset.add(planck.Vec2.mul(tipMinusCursor, 0.04));
        this.fakeCursorPos = planck.Vec2.add(shoulderPos, this.cursorOffset);
      }
    }

    this.mw = this.fakeCursorPos.clone();

    // =========================================================================
    // 3. HINGE & SLIDER JOINT MOTORS (PlayerControl.FixedUpdate)
    // =========================================================================
    const toCursor = planck.Vec2.sub(this.mw, shoulderPos);
    const toCursorDist = toCursor.length();

    const targetWorldAngleRad = Math.atan2(toCursor.y, toCursor.x);
    const currentWorldAngleRad = this.hubBody.getAngle();

    // Shortest angular difference in radians [-PI, PI] and degrees [-180, 180]
    const angleErrRad = Math.atan2(
      Math.sin(targetWorldAngleRad - currentWorldAngleRad),
      Math.cos(targetWorldAngleRad - currentWorldAngleRad)
    );
    const deltaDeg = (angleErrRad * 180) / Math.PI;

    // Deadzone scaling near the shoulder center
    const deadzoneScale = Math.min(Math.max(toCursorDist / this.deadzone, 0.2), 1.0);

    // Proportional + quadratic angular response, bounded by non-overshooting limit (44 * angleErrRad)
    const sign = deltaDeg >= 0 ? 1 : -1;
    const absDeg = Math.abs(deltaDeg);
    const shapedDeg =
      sign * (absDeg * 7.0 + Math.min(absDeg * absDeg * 0.25, 450.0)) * deadzoneScale;
    const desiredMotorRad = (shapedDeg * Math.PI) / 180;
    const maxNonOvershootRad = Math.abs(angleErrRad) * 44.0;
    const motorSpeedRad = Math.max(
      -18.0,
      Math.min(
        18.0,
        Math.sign(desiredMotorRad) * Math.min(Math.abs(desiredMotorRad), maxNonOvershootRad)
      )
    );
    const motorSpeedDeg = (motorSpeedRad * 180) / Math.PI;
    this.hingeJoint.setMotorSpeed(motorSpeedRad);

    // SLIDER MOTOR (Extension / Retraction along the arm shaft)
    const currentReach = this.sliderJoint.getJointTranslation();
    const absAngleErr = Math.abs(angleErrRad);

    // If swinging across the body (cursor on opposite side of pot), tuck hammer in slightly
    // so it passes cleanly over/around obstacles, then extend to exact cursor distance!
    let desiredReach: number;
    if (absAngleErr > 1.55) {
      desiredReach = Math.max(this.MIN_ARM_REACH, Math.min(toCursorDist * 0.55, 0.85));
    } else {
      const alignScale = Math.max(Math.cos(absAngleErr * 0.65), 0.45);
      desiredReach = Math.max(
        this.MIN_ARM_REACH,
        Math.min(this.MAX_ARM_REACH, toCursorDist * alignScale)
      );
    }

    const reachError = desiredReach - currentReach;
    const reactionTorque = Math.abs(this.hingeJoint.getMotorTorque(1 / dt));
    const torqueLoadFactor = Math.max(0.45, 1.0 - reactionTorque / 6000.0);

    const rawSliderSpeed =
      (reachError * 30.0 + Math.sign(reachError) * reachError * reachError * 18.0) *
      torqueLoadFactor;
    const isPushingIntoTerrain = this.tipIsTouchingTerrain && reachError > 0;
    const maxExtensionSpeed = isPushingIntoTerrain ? 8.0 : 35.0;
    const maxRetractionSpeed = 40.0;
    const maxNonOvershootSlider = Math.abs(reachError) * 44.0;

    const sliderSpeed = Math.max(
      -maxRetractionSpeed,
      Math.min(
        maxExtensionSpeed,
        Math.sign(rawSliderSpeed) * Math.min(Math.abs(rawSliderSpeed), maxNonOvershootSlider)
      )
    );
    this.sliderJoint.setMotorSpeed(sliderSpeed);

    this.oldAngle = shapedDeg;

    // =========================================================================
    // 4. WHOOSH SOUND & PARTICLES UPDATE (HammerCollisions.LateUpdate)
    // =========================================================================
    const currentDeltaPos = planck.Vec2.sub(tipPos, potPos);
    const swingDelta = planck.Vec2.sub(currentDeltaPos, this.oldDeltaPos).length();
    if (swingDelta > this.whooshThreshold * dt * 12 && !this.tipIsTouchingTerrain) {
      this.sounds.playWhoosh(Math.min(swingDelta * 2, 1.0));
    }
    this.oldDeltaPos = currentDeltaPos.clone();

    // Update particles
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vy -= 18 * dt; // gravity on sparks/debris
      p.life -= dt;
      if (p.life <= 0) {
        this.particles.splice(i, 1);
      }
    }

    // Update live telemetry for HUD
    const reactionForce = this.sliderJoint.getReactionForce(1 / dt).length();
    const totalStrain = Math.min(((reactionTorque + reactionForce) / 1800) * 100, 100);

    this.telemetry = {
      isStaticFriction: !this.tipSlide,
      frictionValue: activeTipFriction,
      strainPercent: Math.round(totalStrain),
      extensionMeters: this.sliderJoint.getJointTranslation(),
      motorSpeedDeg: Math.round(motorSpeedDeg),
      sliderSpeed: Number(sliderSpeed.toFixed(1)),
    };
  }

  private spawnImpactParticles(x: number, y: number, color: string, count: number) {
    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 1.5 + Math.random() * 5.5;
      this.particles.push({
        x,
        y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed + 1.5,
        color,
        size: 2 + Math.random() * 2.5,
        life: 0.25 + Math.random() * 0.25,
        maxLife: 0.5,
      });
    }
  }
}
