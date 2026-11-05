export class SoundSystem {
  private ctx: AudioContext | null = null;
  private lastHitTime = 0;
  private lastWhooshTime = 0;
  private lastPotClunkTime = 0;

  private ensureContext(): AudioContext | null {
    if (!this.ctx) {
      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (AudioCtx) {
        this.ctx = new AudioCtx();
      }
    }
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {});
    }
    return this.ctx;
  }

  /**
   * Hammer impact sound (mirrors HammerCollisions.PlayHit / PlayHardHit)
   * Material: 0 = rock, 1 = wood, 2 = metal, 3 = ice
   */
  public playHammerHit(intensity: number, material: 'rock' | 'wood' | 'metal' | 'ice' = 'rock') {
    const now = performance.now() / 1000;
    if (now - this.lastHitTime < 0.09) return;
    this.lastHitTime = now;

    const ctx = this.ensureContext();
    if (!ctx) return;

    const vol = Math.min(Math.max(intensity, 0.08), 1.0) * 0.45;
    const t = ctx.currentTime;

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    if (material === 'metal') {
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(620 + Math.random() * 140, t);
      osc.frequency.exponentialRampToValueAtTime(180, t + 0.18);
      gain.gain.setValueAtTime(vol, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.19);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(t);
      osc.stop(t + 0.2);
    } else if (material === 'wood') {
      osc.type = 'sine';
      osc.frequency.setValueAtTime(210 + Math.random() * 40, t);
      osc.frequency.exponentialRampToValueAtTime(75, t + 0.11);
      gain.gain.setValueAtTime(vol, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.12);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(t);
      osc.stop(t + 0.13);
    } else if (material === 'ice') {
      osc.type = 'sine';
      osc.frequency.setValueAtTime(980 + Math.random() * 200, t);
      osc.frequency.exponentialRampToValueAtTime(360, t + 0.12);
      gain.gain.setValueAtTime(vol * 0.8, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.13);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(t);
      osc.stop(t + 0.14);
    } else {
      // Rock thud + click
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(165 + Math.random() * 45, t);
      osc.frequency.exponentialRampToValueAtTime(48, t + 0.13);
      gain.gain.setValueAtTime(vol, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.14);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(t);
      osc.stop(t + 0.15);
    }
  }

  /**
   * Cauldron metallic clunk (mirrors PotSounds.PlayClunk / PlayHardClunk)
   */
  public playPotClunk(intensity: number) {
    const now = performance.now() / 1000;
    if (now - this.lastPotClunkTime < 0.11) return;
    this.lastPotClunkTime = now;

    const ctx = this.ensureContext();
    if (!ctx) return;

    const vol = Math.min(Math.max(intensity, 0.08), 1.0) * 0.4;
    const t = ctx.currentTime;

    // Hollow cauldron resonance (two detuned oscillators)
    const freqs = [138, 207, 312];
    for (const f of freqs) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(f + (Math.random() - 0.5) * 8, t);
      osc.frequency.exponentialRampToValueAtTime(f * 0.72, t + 0.22);
      gain.gain.setValueAtTime(vol * 0.4, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.23);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(t);
      osc.stop(t + 0.24);
    }
  }

  /**
   * Hammer air whoosh when swung rapidly (mirrors HammerCollisions.PlayWhoosh)
   */
  public playWhoosh(intensity: number) {
    const now = performance.now() / 1000;
    if (now - this.lastWhooshTime < 0.45) return;
    this.lastWhooshTime = now;

    const ctx = this.ensureContext();
    if (!ctx) return;

    const t = ctx.currentTime;
    const bufferSize = ctx.sampleRate * 0.14;
    const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      data[i] = (Math.random() * 2 - 1) * Math.sin((i / bufferSize) * Math.PI);
    }

    const noise = ctx.createBufferSource();
    noise.buffer = buffer;

    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(320, t);
    filter.frequency.exponentialRampToValueAtTime(750, t + 0.14);
    filter.Q.value = 2.2;

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(Math.min(intensity * 0.22, 0.3), t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.14);

    noise.connect(filter);
    filter.connect(gain);
    gain.connect(ctx.destination);
    noise.start(t);
  }
}
