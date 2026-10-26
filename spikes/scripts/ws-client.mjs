// Minimal RFC6455 client used only for the local workerd inspector. Node's
// built-in WebSocket fails its handshake against this inspector in this
// environment, so the spike carries a ~100-line client instead of adding a
// dependency.
import net from "node:net";
import crypto from "node:crypto";
import { EventEmitter } from "node:events";

export function connectInspector(url) {
  const target = new URL(url);
  const socket = net.connect(Number(target.port || 80), target.hostname);
  const emitter = new EventEmitter();
  const key = crypto.randomBytes(16).toString("base64");
  let buffer = Buffer.alloc(0);
  let handshakeDone = false;
  let fragments = [];
  let fragmentOpcode = 0;

  socket.on("connect", () => {
    socket.write(
      `GET ${target.pathname} HTTP/1.1\r\n` +
        `Host: ${target.host}\r\n` +
        "Upgrade: websocket\r\n" +
        "Connection: Upgrade\r\n" +
        `Sec-WebSocket-Key: ${key}\r\n` +
        "Sec-WebSocket-Version: 13\r\n\r\n",
    );
  });

  socket.on("data", (chunk) => {
    buffer = Buffer.concat([buffer, chunk]);
    if (!handshakeDone) {
      const end = buffer.indexOf("\r\n\r\n");
      if (end === -1) return;
      const header = buffer.subarray(0, end).toString("latin1");
      if (!header.startsWith("HTTP/1.1 101")) {
        emitter.emit("error", new Error(`handshake failed: ${header.split("\r\n")[0]}`));
        socket.destroy();
        return;
      }
      buffer = buffer.subarray(end + 4);
      handshakeDone = true;
      emitter.emit("open");
    }
    while (buffer.length >= 2) {
      const first = buffer[0];
      const second = buffer[1];
      const fin = (first & 0x80) !== 0;
      const opcode = first & 0x0f;
      const masked = (second & 0x80) !== 0;
      let length = second & 0x7f;
      let offset = 2;
      if (length === 126) {
        if (buffer.length < offset + 2) return;
        length = buffer.readUInt16BE(offset);
        offset += 2;
      } else if (length === 127) {
        if (buffer.length < offset + 8) return;
        length = Number(buffer.readBigUInt64BE(offset));
        offset += 8;
      }
      let mask;
      if (masked) {
        if (buffer.length < offset + 4) return;
        mask = buffer.subarray(offset, offset + 4);
        offset += 4;
      }
      if (buffer.length < offset + length) return;
      let payload = buffer.subarray(offset, offset + length);
      buffer = buffer.subarray(offset + length);
      if (masked) {
        const copy = Buffer.from(payload);
        for (let i = 0; i < copy.length; i++) copy[i] ^= mask[i % 4];
        payload = copy;
      }
      if (opcode === 0x9) {
        socket.write(encodeFrame(payload, 0xa));
        continue;
      }
      if (opcode === 0x8) {
        socket.end();
        emitter.emit("close");
        continue;
      }
      if (opcode === 0x0) {
        fragments.push(payload);
        if (fin) {
          const full = Buffer.concat(fragments);
          fragments = [];
          emitter.emit("message", full.toString("utf8"), fragmentOpcode);
        }
        continue;
      }
      if (!fin) {
        fragmentOpcode = opcode;
        fragments = [payload];
        continue;
      }
      emitter.emit("message", payload.toString("utf8"), opcode);
    }
  });

  socket.on("close", () => emitter.emit("close"));
  socket.on("error", (error) => emitter.emit("error", error));

  function encodeFrame(payload, opcode = 0x1) {
    const data = Buffer.isBuffer(payload) ? payload : Buffer.from(payload, "utf8");
    const mask = crypto.randomBytes(4);
    let header;
    if (data.length < 126) {
      header = Buffer.from([0x80 | opcode, 0x80 | data.length]);
    } else if (data.length < 65536) {
      header = Buffer.alloc(4);
      header[0] = 0x80 | opcode;
      header[1] = 0x80 | 126;
      header.writeUInt16BE(data.length, 2);
    } else {
      header = Buffer.alloc(10);
      header[0] = 0x80 | opcode;
      header[1] = 0x80 | 127;
      header.writeBigUInt64BE(BigInt(data.length), 2);
    }
    const masked = Buffer.from(data);
    for (let i = 0; i < masked.length; i++) masked[i] ^= mask[i % 4];
    return Buffer.concat([header, mask, masked]);
  }

  return {
    on: emitter.on.bind(emitter),
    send(text) {
      socket.write(encodeFrame(text, 0x1));
    },
    close() {
      try {
        socket.write(encodeFrame(Buffer.alloc(0), 0x8));
      } catch {
        // ignore
      }
      socket.end();
    },
  };
}
