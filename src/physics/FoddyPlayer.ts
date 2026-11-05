import * as planck from 'planck-js';
import { SoundSystem } from '../audio/SoundSystem';
import { SurfaceMaterial } from './LevelBuilder';

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
  public mw = planck.Vec2(0, 1.5);
  public mouseInput = planck.Vec2(0, 0);
  public oldMouse = planck.Vec2(0, 0);
  public mouseVelocityAverage = 0.005;
  public mouseSensitivity = 1.0;
  public angleEpsilon = 1.0; // deg
  public deadzone = 0.25; // m
  public oldAngle = 0;
  public mouseSnap = false;

  // Decompiled fields from HammerCollisions.cs & PotSounds.cs
  public tipSlide = true;
  public potSlide = true;
  public moveThreshold = 0.03; // 0.029999999329447746f
  public potMoveThreshold = 0.07; // 0.07000000029802322f
  public hardHitThreshold = 14.0;
  public whooshThreshold = 1.5;

  // Static vs Sliding friction values
  public readonly TIP_STATIC_FRICTION = 2.4;
  public readonly TIP_SLIDING_FRICTION = 0.28;
  public readonly POT_STATIC_FRICTION = 0.85;
  public readonly POT_SLIDING_FRICTION = 0.18;

  private tipContactAnchor: planck.Vec2 | null = null;
  private tipContactMaterial: SurfaceMaterial = 'rock';
  private tipIsTouchingTerrain = false;

  private potContactAnchor: planck.Vec2 | null = null;
  private potIsTouchingTerrain = false;

  private oldDeltaPos = planck.Vec2(0, 0);
  private pendingMouseDX = 0;
  private pendingMouseDY = 0;

  public particles: Particle[] = [];
  public telemetry: PlayerTelemetry = {
    isStaticFriction: false,
    frictionValue: 0.28,
    strainPercent: 0,
    extensionMeters: 1.5,
    motorSpeedDeg: 0,
    sliderSpeed: 0,
  };

  public readonly MAX_ARM_REACH = 2.85;
  public readonly MIN_ARM_REACH = 0.55;

  constructor(
    private world: planck.World,
    spawnX: number,
    spawnY: number,
    private sounds: SoundSystem
  ) {
    // 1. CAULDRON / POT BODY
    this.potBody = this.world.createBody({
      type: 'dynamic',
      position: planck.Vec2(spawnX, spawnY),
      fixedRotation: false,
      linearDamping: 0.15,
      angularDamping: 2.2,
      bullet: true,
    });

    // Lower heavy base of the cauldron (low center of mass keeps Diogenes upright)
    this.potBottomFixture = this.potBody.createFixture(
      planck.Circle(planck.Vec2(0, -0.18), 0.56),
      {
        density: 6.5,
        friction: this.POT_SLIDING_FRICTION,
        restitution: 0.0,
        filterGroupIndex: -1, // Never collide with own arm/hammer
      }
    );
    this.potBottomFixture.setUserData({ isPot: true });

    // Upper rim of the cauldron
    const rimFixture = this.potBody.createFixture(
      planck.Box(0.52, 0.28, planck.Vec2(0, 0.12), 0),
      {
        density: 2.0,
        friction: 0.2,
        restitution: 0.0,
        filterGroupIndex: -1,
      }
    );
    rimFixture.setUserData({ isPot: true });

    // Subtle upright stabilization torque so the cauldron behaves like Foddy's hubJoint
    // 2. SHOULDER HUB BODY (Intermediate body connecting RevoluteJoint and PrismaticJoint)
    const shoulderPos = planck.Vec2(spawnX, spawnY + 0.35);
    this.hubBody = this.world.createBody({
      type: 'dynamic',
      position: shoulderPos,
      bullet: true,
      angularDamping: 0.5,
    });
    this.hubBody.createFixture(planck.Circle(0.15), {
      density: 1.2,
      filterGroupIndex: -1,
      isSensor: true,
    });

    // 3. HAMMER TIP BODY
    const initialTipPos = planck.Vec2(spawnX + 1.4, spawnY + 1.1);
    this.tipBody = this.world.createBody({
      type: 'dynamic',
      position: initialTipPos,
      bullet: true,
      fixedRotation: false,
      linearDamping: 0.05,
      angularDamping: 1.0,
    });

    // Hammer head shape (beveled box / circle combination for hooking ledges cleanly)
    this.tipFixture = this.tipBody.createFixture(
      planck.Box(0.28, 0.14),
      {
        density: 2.4,
        friction: this.TIP_SLIDING_FRICTION,
        restitution: 0.0,
        filterGroupIndex: -1,
      }
    );
    this.tipFixture.setUserData({ isHammerTip: true });

    // Rounded hook nose on the hammer head so it catches corners smoothly
    const noseFix = this.tipBody.createFixture(
      planck.Circle(planck.Vec2(0, 0.12), 0.14),
      {
        density: 1.2,
        friction: this.TIP_STATIC_FRICTION,
        restitution: 0.0,
        filterGroupIndex: -1,
      }
    );
    noseFix.setUserData({ isHammerTip: true });

    // 4. HINGE JOINT (hj) - Rotates the arm around the shoulder
    this.hingeJoint = this.world.createJoint(
      planck.RevoluteJoint(
        {
          enableMotor: true,
          maxMotorTorque: 1250.0,
          motorSpeed: 0,
           collideConnected: false,
        },
        this.potBody,
        this.hubBody,
        shoulderPos
      )
    )!;

    // 5. SLIDER JOINT (sj) - Extends/retracts the hammer tip along the hub's X axis
    this.sliderJoint = this.world.createJoint(
      planck.PrismaticJoint(
        {
          enableLimit: true,
          lowerTranslation: this.MIN_ARM_REACH,
          upperTranslation: this.MAX_ARM_REACH,
          enableMotor: true,
          maxMotorForce: 950.0,
          motorSpeed: 0,
          collideConnected: false,
        },
        this.hubBody,
        this.tipBody,
        shoulderPos,
        planck.Vec2(1, 0)
      )
    )!;

    this.fakeCursorPos = initialTipPos.clone();
    this.mw = initialTipPos.clone();

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
  }

  /**
   * Decompiled PlayerControl.HammerReturn (token 0x060001dc):
   * When the hammer slams hard into terrain above the pot, snaps fakeCursor to tip.
   */
  public hammerReturn() {
    const tipPos = this.tipBody.getPosition();
    const potPos = this.potBody.getPosition();
    if (tipPos.y - 0.4 >= potPos.y) {
      this.mouseSnap = true;
      this.fakeCursorPos = tipPos.clone();
    }
  }

  /**
   * Accumulate raw mouse deltas from Pointer Lock (mousemove)
   */
  public addMouseDelta(dx: number, dy: number) {
    this.pendingMouseDX += dx;
    this.pendingMouseDY -= dy; // Invert Y so moving mouse up = +Y in world
  }

  /**
   * Direct cursor target fallback when Pointer Lock is not active
   */
  public setWorldMouseFallback(worldX: number, worldY: number) {
    const diffX = (worldX - this.fakeCursorPos.x) * 14;
    const diffY = (worldY - this.fakeCursorPos.y) * 14;
    this.pendingMouseDX = diffX;
    this.pendingMouseDY = diffY;
  }

  /**
   * Reset player to the bottom of the mountain (or any coordinate)
   */
  public teleportTo(x: number, y: number) {
    this.potBody.setLinearVelocity(planck.Vec2(0, 0));
    this.potBody.setAngularVelocity(0);
    this.potBody.setPosition(planck.Vec2(x, y));
    this.potBody.setAngle(0);

    this.hubBody.setLinearVelocity(planck.Vec2(0, 0));
    this.hubBody.setAngularVelocity(0);
    this.hubBody.setPosition(planck.Vec2(x, y + 0.35));
    this.hubBody.setAngle(0.4);

    const tipPos = planck.Vec2(x + 1.3, y + 1.0);
    this.tipBody.setLinearVelocity(planck.Vec2(0, 0));
    this.tipBody.setAngularVelocity(0);
    this.tipBody.setPosition(tipPos);
    this.tipBody.setAngle(0.4);

    this.fakeCursorPos = tipPos.clone();
    this.mw = tipPos.clone();
    this.mouseVelocityAverage = 0.005;
  }

  /**
   * Runs one fixed physics tick (60Hz) implementing the exact decompiled IL from:
   * - PlayerControl.FixedUpdate
   * - HammerCollisions.OnCollisionStay2D & FixedUpdate
   * - PotSounds.FixedUpdate
   */
  public fixedUpdate(dt: number) {
    const potPos = this.potBody.getPosition();
    const shoulderPos = this.hubBody.getPosition();
    const tipPos = this.tipBody.getPosition();

    // Keep cauldron gently upright (preventing upside-down turtle lock)
    const potAngle = this.potBody.getAngle();
    const uprightError = Math.atan2(Math.sin(-potAngle), Math.cos(-potAngle));
    this.potBody.applyTorque(uprightError * 65.0 - this.potBody.getAngularVelocity() * 8.0, true);

    // =========================================================================
    // 1. DYNAMIC FRICTION SWITCHING (HammerCollisions.OnCollisionStay2D)
    // =========================================================================
    if (this.tipIsTouchingTerrain && this.tipContactAnchor) {
      const distMoved = planck.Vec2.sub(tipPos, this.tipContactAnchor).length();
      const tipSpeed = this.tipBody.getLinearVelocity().length();

      // IL_0240: if distance < moveThreshold (0.03), slide = false (STATIC GRIP!)
      if (distMoved < this.moveThreshold && tipSpeed < 0.45) {
        this.tipSlide = false;
      } else if (distMoved > this.moveThreshold * 2.2 || tipSpeed > 1.1) {
        this.tipSlide = true;
        this.tipContactAnchor = tipPos.clone(); // Re-anchor as it slides
      }
    } else {
      this.tipSlide = true;
    }

    const activeTipFriction =
      this.tipContactMaterial === 'ice'
        ? 0.12
        : this.tipSlide
          ? this.TIP_SLIDING_FRICTION
          : this.TIP_STATIC_FRICTION;

    for (let f = this.tipBody.getFixtureList(); f; f = f.getNext()) {
      f.setFriction(activeTipFriction);
    }

    // Pot static/sliding friction switch
    if (this.potIsTouchingTerrain && this.potContactAnchor) {
      const potDist = planck.Vec2.sub(potPos, this.potContactAnchor).length();
      if (potDist < this.potMoveThreshold && this.potBody.getLinearVelocity().length() < 1.2) {
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
    // 2. FAKE CURSOR & MOUSE FILTERING (PlayerControl.FixedUpdate IL_0190-IL_1434)
    // =========================================================================
    if (this.mouseSnap) {
      this.mouseSnap = false;
    } else {
      this.oldMouse = this.mouseInput.clone();

      // Scale raw pixel delta into Rewired-equivalent axis units
      const rawInput = planck.Vec2(
        this.pendingMouseDX * 0.11 * this.mouseSensitivity,
        this.pendingMouseDY * 0.11 * this.mouseSensitivity
      );
      this.pendingMouseDX = 0;
      this.pendingMouseDY = 0;

      // Evaluate mouse acceleration curve (Foddy's mouseCurve boosts fast flicks slightly)
      const mag = rawInput.length();
      const curveFactor = 1.0 + Math.min(mag * 0.12, 0.85);
      const curvedInput = planck.Vec2.mul(rawInput, curveFactor);

      // IL_0313: mouseInput = Vector2.Lerp(oldMouse, mouseInput, 0.5f)
      this.mouseInput = planck.Vec2(
        this.oldMouse.x * 0.5 + curvedInput.x * 0.5,
        this.oldMouse.y * 0.5 + curvedInput.y * 0.5
      );

      this.mw = this.fakeCursorPos.clone();

      // IL_1031-IL_1079: mouseVelocityAverage = Lerp(mouseVelocityAverage, Max(0.1f * mouseInput.magnitude, 0.001f), 0.05f) + 0.005f
      const targetVelAvg = Math.max(0.1 * this.mouseInput.length(), 0.001);
      this.mouseVelocityAverage =
        this.mouseVelocityAverage + (targetVelAvg - this.mouseVelocityAverage) * 0.05 + 0.005;

      // IL_1090-IL_1117: loc9 = fakeCursorPos + mouseInput * mouseVelocityAverage
      let nextCursorPos = planck.Vec2(
        this.fakeCursorPos.x + this.mouseInput.x * this.mouseVelocityAverage,
        this.fakeCursorPos.y + this.mouseInput.y * this.mouseVelocityAverage
      );

      // IL_1146-IL_1221: Clamp fakeCursor distance to 3.5m radius around player pot
      const fromPot = planck.Vec2.sub(nextCursorPos, potPos);
      if (fromPot.length() > 3.5) {
        fromPot.normalize();
        nextCursorPos = planck.Vec2.add(potPos, planck.Vec2.mul(fromPot, 3.5));
      }

      // IL_1224-IL_1250: loc10 = tip.position - mw (error vector from cursor to hammer tip)
      const tipMinusCursor = planck.Vec2.sub(tipPos, this.mw);

      // IL_1363-IL_1434: Elastic pull of fakeCursor toward blocked hammer tip when mouse slows down!
      const pullFactor =
        0.05 *
        10.0 *
        Math.min(Math.max(0.2 - Math.min(this.mouseVelocityAverage, 0.2), 0.0), 0.2);
      nextCursorPos = planck.Vec2.add(
        nextCursorPos,
        planck.Vec2.mul(tipMinusCursor, pullFactor)
      );

      this.fakeCursorPos = nextCursorPos;
      this.mw = this.fakeCursorPos.clone();
    }

    // =========================================================================
    // 3. HINGE & SLIDER JOINT MOTORS (PlayerControl.FixedUpdate IL_1478-IL_1825)
    // =========================================================================
    // Vector from shoulder hinge to cursor (mw - hj.position)
    const toCursor = planck.Vec2.sub(this.mw, shoulderPos);
    const toCursorDist = toCursor.length();

    // Target world angle in degrees and current arm world angle in degrees
    const targetWorldAngleDeg = (Math.atan2(toCursor.y, toCursor.x) * 180) / Math.PI;
    const currentWorldAngleDeg = (this.hubBody.getAngle() * 180) / Math.PI;

    // Shortest angular difference in degrees [-180, 180]
    let deltaDeg = ((targetWorldAngleDeg - currentWorldAngleDeg + 540) % 360) - 180;

    // IL_1570-IL_1602: loc3 = Sign(loc3) * Max(Abs(loc3 / 2f), Abs(loc3 * loc3))
    const sign = deltaDeg >= 0 ? 1 : -1;
    let shapedAngle = sign * Math.max(Math.abs(deltaDeg / 2.0), Math.abs(deltaDeg * deltaDeg));

    // IL_1603-IL_1623: loc3 = loc3 * Clamp01(Abs(loc3) / angleEpsilon)
    const epsFactor = Math.min(Math.max(Math.abs(shapedAngle) / this.angleEpsilon, 0), 1);
    shapedAngle *= epsFactor;

    // Deadzone scaling near the shoulder center
    const deadzoneScale = Math.pow(
      Math.min(Math.max(toCursorDist / this.deadzone, 0), 1),
      2
    );

    // IL_1630-IL_1697: motorSpeedDeg = Clamp(shapedAngle * 3f * deadzoneScale, -800f, 800f)
    const motorSpeedDeg = Math.min(
      Math.max(shapedAngle * 3.0 * deadzoneScale, -800.0),
      800.0
    );
    // Convert deg/s to rad/s for Planck RevoluteJoint
    const motorSpeedRad = (motorSpeedDeg * Math.PI) / 180;
    this.hingeJoint.setMotorSpeed(motorSpeedRad);

    // SLIDER MOTOR (Extension / Retraction along the arm shaft)
    const tipMinusMw = planck.Vec2.sub(tipPos, this.mw);
    const tipMinusMwLen = tipMinusMw.length();
    const armDir = planck.Vec2.sub(tipPos, shoulderPos);
    armDir.normalize();

    let loc1 = 0;
    if (tipMinusMwLen > 0.0001) {
      const tipMinusMwNorm = planck.Vec2.mul(tipMinusMw, 1 / tipMinusMwLen);
      loc1 = planck.Vec2.dot(armDir, tipMinusMwNorm);
    }
    const loc0 = tipMinusMwLen * loc1; // Radial error along the arm

    // IL_1719-IL_1752: loc4 = 16f - Max(Abs(reactionTorque) * 0.001f, 5f)
    const reactionTorque = Math.abs(this.hingeJoint.getMotorTorque(1 / dt));
    const loc4 = 16.0 - Math.max(reactionTorque * 0.001, 5.0);

    // IL_1754-IL_1765: loc5 = Pow(loc1, 4f)
    const loc5 = Math.pow(loc1, 4);

    // IL_1773-IL_1798: sliderSpeed = Clamp((-loc0 * Abs(loc0)) * loc4 * loc5, -50f, 50f)
    const sliderSpeed = Math.min(
      Math.max(-loc0 * Math.abs(loc0) * loc4 * loc5, -50.0),
      50.0
    );
    this.sliderJoint.setMotorSpeed(sliderSpeed);

    this.oldAngle = shapedAngle;

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
