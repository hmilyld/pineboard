import { writeFileSync, mkdirSync } from "node:fs";

export const BASE = process.env.SPIKE_BASE ?? "http://127.0.0.1:8787";

const encoder = new TextEncoder();

export async function derivePassword(email, password) {
  const salt = encoder.encode(`forum:v1:${email.trim().toLowerCase()}`);
  const key = await crypto.subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt, iterations: 310_000 },
    key,
    256,
  );
  return "v1$" + btoa(String.fromCharCode(...new Uint8Array(bits)));
}

export function cookieJar() {
  const jar = new Map();
  return {
    update(response) {
      const cookies = response.headers.getSetCookie?.() ?? [];
      for (const cookie of cookies) {
        const [pair] = cookie.split(";");
        const index = pair.indexOf("=");
        const name = pair.slice(0, index).trim();
        const value = pair.slice(index + 1).trim();
        if (!value || /max-age=0/i.test(cookie)) jar.delete(name);
        else jar.set(name, value);
      }
    },
    header() {
      return [...jar.entries()].map(([name, value]) => `${name}=${value}`).join("; ");
    },
    has(name) {
      return jar.has(name);
    },
    clear() {
      jar.clear();
    },
  };
}

export function makeClient() {
  const jar = cookieJar();
  async function request(path, options = {}) {
    const headers = new Headers(options.headers ?? {});
    headers.set("origin", BASE);
    if (jar.header()) headers.set("cookie", jar.header());
    if (options.json !== undefined) {
      headers.set("content-type", "application/json");
    }
    const response = await fetch(BASE + path, {
      method: options.method ?? (options.json !== undefined ? "POST" : "GET"),
      headers,
      body: options.json !== undefined ? JSON.stringify(options.json) : options.body,
      redirect: options.redirect ?? "manual",
    });
    jar.update(response);
    return response;
  }
  return { request, jar };
}

export async function json(response) {
  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}

export async function reset() {
  const response = await fetch(BASE + "/spike/reset", { method: "POST" });
  return response.status;
}

export async function inspect() {
  const response = await fetch(BASE + "/spike/inspect");
  return (await response.json()).data;
}

export async function trace() {
  const response = await fetch(BASE + "/spike/trace");
  return (await response.json()).data;
}

export async function waitForOutbox(kind, timeoutMs = 2000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const data = await inspect();
    const hit = data.outbox.find((row) => row.kind === kind);
    if (hit) return hit;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  return null;
}

export function parseToken(entry) {
  return JSON.parse(entry.payload).token;
}

export function assert(results, name, condition, detail) {
  results.push({ name, pass: Boolean(condition), detail });
  return Boolean(condition);
}

export function saveResults(file, payload) {
  mkdirSync("results", { recursive: true });
  writeFileSync(`results/${file}`, JSON.stringify(payload, null, 2) + "\n");
}
