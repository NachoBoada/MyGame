// Sound effects, played with the Web Audio API.
// Browsers only allow sound after the player interacts with the page,
// so audio starts on the first click or key press.
(() => {
  "use strict";

  const MUTE_KEY = "last-one-standing-muted";
  let ac = null;
  let master = null;
  let shotBuffer = null; // the decoded shot sound from shot-sound.js
  let muted = false;
  try { muted = localStorage.getItem(MUTE_KEY) === "1"; } catch {}

  function decodeBase64(b64) {
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes.buffer;
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
      if (window.SHOT_SOUND_WAV) {
        ac.decodeAudioData(decodeBase64(window.SHOT_SOUND_WAV))
          .then((buf) => { shotBuffer = buf; })
          .catch(() => {}); // the game still works without sound
      }
    }
    if (ac.state === "suspended") ac.resume();
  }

  window.addEventListener("pointerdown", unlock);
  window.addEventListener("keydown", unlock);

  window.Sound = {
    get muted() { return muted; },
    get ready() { return !!shotBuffer; },
    toggleMute() {
      muted = !muted;
      try { localStorage.setItem(MUTE_KEY, muted ? "1" : "0"); } catch {}
      return muted;
    },
    shot() {
      if (muted || !shotBuffer || ac.state !== "running") return;
      const src = ac.createBufferSource();
      src.buffer = shotBuffer;
      src.connect(master);
      src.start();
    },
  };
})();
