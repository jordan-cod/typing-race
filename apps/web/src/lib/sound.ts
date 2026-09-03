/**
 * Keystroke sound.
 *
 * Web Audio and not an <audio> element: a race is up to eight keystrokes a second, and an
 * element per keystroke would allocate a decoder, miss the moment by tens of milliseconds and
 * cut itself off on the next press. Two oscillators with a fast envelope cost nothing and land
 * on the frame the key was pressed.
 *
 * The sound is on by default because the feel of the thing is half the point, but muting is
 * one click and the choice is remembered. A site that makes noise you cannot stop is worse
 * than a silent one.
 */

const STORAGE_KEY = "typing-race:sound";

export type SoundKind = "hit" | "miss";

/**
 * What the race screen is handed. Muting wraps this rather than being checked at every call
 * site, so there is one place where sound can be silenced and no way to forget it.
 */
export type Voice = {
  unlock: () => void;
  play: (kind: SoundKind) => void;
};

export function loadMuted(): boolean {
  if (typeof window === "undefined") return false;
  return window.localStorage.getItem(STORAGE_KEY) === "off";
}

export function saveMuted(muted: boolean): void {
  window.localStorage.setItem(STORAGE_KEY, muted ? "off" : "on");
}

type AudioContextConstructor = typeof AudioContext;

function audioContextClass(): AudioContextConstructor | null {
  if (typeof window === "undefined") return null;
  const legacy = (window as { webkitAudioContext?: AudioContextConstructor }).webkitAudioContext;
  return window.AudioContext ?? legacy ?? null;
}

export class Keyboard {
  private context: AudioContext | null = null;
  private bus: GainNode | null = null;

  /**
   * Browsers refuse to start audio without a gesture, so this is called from the first
   * keystroke and from the button that starts a race, whichever happens first.
   */
  unlock(): void {
    if (this.context) {
      if (this.context.state === "suspended") void this.context.resume();
      return;
    }
    const Constructor = audioContextClass();
    if (!Constructor) return;
    this.context = new Constructor();
    this.bus = this.context.createGain();
    this.bus.gain.value = 0.5;
    this.bus.connect(this.context.destination);
  }

  play(kind: SoundKind): void {
    const context = this.context;
    const bus = this.bus;
    if (!context || !bus || context.state !== "running") return;
    // Sound is a nicety and this runs inside the keystroke handler. An audio stack that
    // misbehaves — a suspended context, a device unplugged mid-race — must not be able to
    // throw its way up into React and cost someone the race.
    try {
      this.schedule(context, bus, kind);
    } catch {
      this.close();
    }
  }

  private schedule(context: AudioContext, bus: GainNode, kind: SoundKind): void {
    const now = context.currentTime;
    const oscillator = context.createOscillator();
    const envelope = context.createGain();
    oscillator.connect(envelope);
    envelope.connect(bus);
    // Wired and started before anything is scheduled: stop() on a source that has not been
    // started throws, and it throws inside a keystroke handler, which takes the page with it.
    oscillator.start(now);

    if (kind === "hit") {
      // A short woodblock-ish tick. The pitch wanders a few percent per press so a fast run
      // does not turn into one flat machine-gun tone.
      oscillator.type = "triangle";
      oscillator.frequency.setValueAtTime(880 + Math.random() * 90, now);
      oscillator.frequency.exponentialRampToValueAtTime(430, now + 0.035);
      envelope.gain.setValueAtTime(0.16, now);
      envelope.gain.exponentialRampToValueAtTime(0.0001, now + 0.055);
      oscillator.stop(now + 0.06);
    } else {
      // Duller and lower: a wrong key should read as a thud, not as a different note.
      oscillator.type = "sine";
      oscillator.frequency.setValueAtTime(150, now);
      oscillator.frequency.exponentialRampToValueAtTime(70, now + 0.09);
      envelope.gain.setValueAtTime(0.28, now);
      envelope.gain.exponentialRampToValueAtTime(0.0001, now + 0.13);
      oscillator.stop(now + 0.14);
    }
  }

  close(): void {
    void this.context?.close();
    this.context = null;
    this.bus = null;
  }
}
