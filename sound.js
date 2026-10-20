// Sound effects, played with the Web Audio API.
// Browsers only allow sound after the player interacts with the page,
// so audio starts on the first click or key press.
(() => {
  "use strict";

  const MUTE_KEY = "last-one-standing-muted";
  let ac = null;
  let master = null; // shots: compressed, then halved
  let direct = null; // other effects: played at their own volume
  const buffers = {}; // decoded sounds by name
  let muted = false;
  try { muted = localStorage.getItem(MUTE_KEY) === "1"; } catch {}

  function decodeBase64(b64) {
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes.buffer;
  }

  function load(name, b64) {
    if (!b64) return;
    ac.decodeAudioData(decodeBase64(b64))
      .then((buf) => { buffers[name] = buf; })
      .catch(() => {}); // the game still works without sound
  }

  function unlock() {
    if (!ac) {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return;
      ac = new Ctx();
      // A compressor keeps rapid shots from clipping when they overlap
      const comp = ac.createDynamicsCompressor();
      comp.threshold.value = -12;
      comp.ratio.value = 4;
      master = ac.createGain();
      master.gain.value = 0.55;
      // Overall volume, applied after the compressor so it scales the final sound exactly
      const volume = ac.createGain();
      volume.gain.value = 0.5;
      master.connect(comp).connect(volume).connect(ac.destination);
      direct = ac.destination;
      load("shot", window.SHOT_SOUND_WAV);
      load("destroyed", window.DESTROYED_SOUND_WAV);
    }
    if (ac.state === "suspended") ac.resume();
  }

  function play(name, out, gain = 1) {
    const buf = buffers[name];
    if (muted || !buf || ac.state !== "running") return;
    const src = ac.createBufferSource();
    src.buffer = buf;
    if (gain === 1) {
      src.connect(out);
    } else {
      const g = ac.createGain();
      g.gain.value = gain;
      src.connect(g).connect(out);
    }
    src.start();
  }

  window.addEventListener("pointerdown", unlock);
  window.addEventListener("keydown", unlock);

  window.Sound = {
    get muted() { return muted; },
    get ready() { return !!(buffers.shot && buffers.destroyed); },
    toggleMute() {
      muted = !muted;
      try { localStorage.setItem(MUTE_KEY, muted ? "1" : "0"); } catch {}
      return muted;
    },
    shot() { play("shot", master); },
    // Your tank was destroyed: the sound file at 70% of its own volume
    destroyed() { play("destroyed", direct, 0.7); },
  };
})();
