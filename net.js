// Peer-to-peer networking on top of PeerJS.
// The host's browser runs the match; other players connect to it directly.
// PeerJS's free public server is only used to introduce players to each other.
(() => {
  "use strict";

  const ID_PREFIX = "last-one-standing-v1-";
  const CODE_CHARS = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"; // no 0/O or 1/I/L
  const CODE_LENGTH = 5;
  const JOIN_TIMEOUT_MS = 12000;

  const available = () => typeof window.Peer === "function";

  function makeCode() {
    let code = "";
    for (let i = 0; i < CODE_LENGTH; i++) {
      code += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
    }
    return code;
  }

  const normalizeCode = (code) => String(code || "").toUpperCase().replace(/[^A-Z0-9]/g, "");

  function describeError(err) {
    switch (err && err.type) {
      case "peer-unavailable": return "No match found with that code. Check the code and try again.";
      case "network":
      case "server-error":
      case "socket-error":
      case "socket-closed": return "Couldn't reach the matchmaking server. Check your internet connection and try again.";
      case "browser-incompatible": return "This browser doesn't support online play. Try a recent Chrome, Edge or Firefox.";
      default: return "Something went wrong with the connection. Try again.";
    }
  }

  // Host a match. Resolves with { code, send, broadcast, kick, close }.
  // handlers: onMessage(pid, msg), onLeave(pid)
  function host(handlers) {
    return new Promise((resolve, reject) => {
      let attempts = 0;

      const tryOpen = () => {
        const code = makeCode();
        const peer = new window.Peer(ID_PREFIX + code, { debug: 0 });
        const conns = new Map();
        let opened = false;

        peer.on("open", () => {
          opened = true;
          resolve({
            code,
            send(pid, msg) {
              const c = conns.get(pid);
              if (c && c.open) c.send(msg);
            },
            broadcast(msg) {
              for (const c of conns.values()) if (c.open) c.send(msg);
            },
            kick(pid) {
              const c = conns.get(pid);
              conns.delete(pid);
              if (c) setTimeout(() => c.close(), 300); // let a final message go out first
            },
            close() {
              conns.clear();
              peer.destroy();
            },
          });
        });

        peer.on("connection", (conn) => {
          conn.on("open", () => conns.set(conn.peer, conn));
          conn.on("data", (msg) => {
            if (conns.has(conn.peer)) handlers.onMessage(conn.peer, msg);
          });
          conn.on("close", () => {
            if (conns.delete(conn.peer)) handlers.onLeave(conn.peer);
          });
          conn.on("error", () => {});
        });

        // Losing the matchmaking server doesn't drop existing players,
        // but reconnecting lets new players keep joining.
        peer.on("disconnected", () => {
          if (!peer.destroyed) peer.reconnect();
        });

        peer.on("error", (err) => {
          if (opened) return;
          peer.destroy();
          if (err.type === "unavailable-id" && ++attempts < 5) tryOpen();
          else reject(new Error(describeError(err)));
        });
      };

      tryOpen();
    });
  }

  // Join a match by code. Resolves with { pid, send, close } once connected.
  // handlers: onMessage(msg), onClose()
  function join(rawCode, handlers) {
    const code = normalizeCode(rawCode);
    return new Promise((resolve, reject) => {
      const peer = new window.Peer({ debug: 0 });
      let settled = false;
      let closed = false;

      const fail = (message) => {
        if (settled) return;
        settled = true;
        peer.destroy();
        reject(new Error(message));
      };
      const timer = setTimeout(
        () => fail("Couldn't reach that match. Check the code, or ask the host to make sure the game is still open."),
        JOIN_TIMEOUT_MS
      );

      peer.on("open", () => {
        const conn = peer.connect(ID_PREFIX + code, { reliable: true, serialization: "json" });
        conn.on("open", () => {
          clearTimeout(timer);
          settled = true;
          resolve({
            pid: peer.id,
            send(msg) {
              if (conn.open) conn.send(msg);
            },
            close() {
              closed = true;
              peer.destroy();
            },
          });
        });
        conn.on("data", (msg) => handlers.onMessage(msg));
        conn.on("close", () => {
          if (settled && !closed) {
            closed = true;
            handlers.onClose();
          }
        });
        conn.on("error", () => {});
      });

      // After connecting, errors from the matchmaking server don't affect the match.
      // A lost host is detected by the game's heartbeat instead.
      peer.on("error", (err) => {
        if (settled) return;
        clearTimeout(timer);
        fail(describeError(err));
      });
    });
  }

  window.Net = { available, host, join, normalizeCode, CODE_LENGTH };
})();
