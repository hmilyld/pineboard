import { BASE, assert, json, saveResults } from "./lib.mjs";

const results = [];
const evidence = {};

async function post(path, body) {
  const response = await fetch(BASE + path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: response.status, body: await json(response) };
}

async function sign(payload) {
  return post("/spike/r2/sign", payload);
}

async function put(key, mime, bytes) {
  const response = await fetch(`${BASE}/spike/r2/local-put?key=${encodeURIComponent(key)}&mime=${encodeURIComponent(mime)}`, {
    method: "POST",
    body: new Uint8Array(bytes),
  });
  return { status: response.status, body: await json(response) };
}

async function head(key) {
  const response = await fetch(`${BASE}/spike/r2/head?key=${encodeURIComponent(key)}`);
  return { status: response.status, body: await json(response) };
}

// --- Presign ---------------------------------------------------------------------
const allowed = await sign({ key: "spike/photo.png", mime: "image/png", size: 1024 });
const allowedUrl = allowed.body.data ? new URL(allowed.body.data.url) : null;
const svg = await sign({ key: "spike/evil.svg", mime: "image/svg+xml", size: 1024 });
const html = await sign({ key: "spike/evil.html", mime: "text/html", size: 1024 });
const badKey = await sign({ key: "spike/../escape.png", mime: "image/png", size: 1024 });
const tooBig = await sign({ key: "spike/big.png", mime: "image/png", size: 20 * 1024 * 1024 });
evidence.presign = {
  allowed: allowed.body.data
    ? {
        method: allowed.body.data.method,
        signedHeaders: allowed.body.data.signedHeaders,
        expires: allowedUrl.searchParams.get("X-Amz-Expires"),
        hasSignature: allowedUrl.searchParams.has("X-Amz-Signature"),
        algorithm: allowedUrl.searchParams.get("X-Amz-Algorithm"),
        contentLengthSigned: allowed.body.data.contentLengthSigned,
      }
    : null,
  svg: svg.body.error?.code,
  html: html.body.error?.code,
  badKey: badKey.body.error?.code,
  tooBig: tooBig.body.error?.code,
};
assert(results, "presign: allowed image returns a PUT URL", allowed.status === 200 && allowed.body.data.method === "PUT", evidence.presign.allowed);
assert(results, "presign: Content-Type is bound into the signature", allowed.body.data.signedHeaders.includes("content-type"), evidence.presign.allowed);
assert(results, "presign: expiry is 600s", allowedUrl.searchParams.get("X-Amz-Expires") === "600", evidence.presign.allowed);
assert(results, "presign: SVG rejected", svg.status === 400 && svg.body.error.code === "mime_not_allowed", evidence.presign);
assert(results, "presign: HTML rejected", html.status === 400 && html.body.error.code === "mime_not_allowed", evidence.presign);
assert(results, "presign: path traversal rejected", badKey.status === 400 && badKey.body.error.code === "invalid_key", evidence.presign);
assert(results, "presign: declared size over limit rejected", tooBig.status === 400 && tooBig.body.error.code === "size_out_of_range", evidence.presign);
assert(results, "presign: Content-Length cannot be signed (browser restriction)", allowed.body.data.contentLengthSigned === false, evidence.presign.allowed);

// --- HEAD verification on complete ----------------------------------------------
await put("spike/ok.png", "image/png", 1000);
const okHead = await head("spike/ok.png");
const okComplete = await post("/spike/r2/complete", { key: "spike/ok.png", declaredSize: 1000, declaredMime: "image/png", maxSize: 5 * 1024 * 1024 });
const okAfter = await head("spike/ok.png");
evidence.headVerify = { head: okHead.body.data, complete: okComplete.body.data, after: okAfter.status };
assert(results, "complete: HEAD matches size and MIME", okHead.status === 200 && okHead.body.data.size === 1000 && okHead.body.data.mime === "image/png", evidence.headVerify);
assert(results, "complete: matching upload accepted", okComplete.status === 200 && okComplete.body.data.size === 1000, evidence.headVerify);

await put("spike/oversize.png", "image/png", 2048);
const oversize = await post("/spike/r2/complete", { key: "spike/oversize.png", declaredSize: 100, declaredMime: "image/png" });
const oversizeAfter = await head("spike/oversize.png");
evidence.oversize = { response: oversize.body.error, afterHeadStatus: oversizeAfter.status };
assert(results, "complete: object larger than declared is rejected", oversize.status === 400 && oversize.body.error.fields.reasons.includes("exceeds_declared"), evidence.oversize);
assert(results, "complete: rejected object is deleted", oversizeAfter.status === 404, evidence.oversize);

await put("spike/mismatch.png", "image/png", 100);
const mismatch = await post("/spike/r2/complete", { key: "spike/mismatch.png", declaredSize: 100, declaredMime: "image/jpeg" });
const mismatchAfter = await head("spike/mismatch.png");
evidence.mismatch = { response: mismatch.body.error, afterHeadStatus: mismatchAfter.status };
assert(results, "complete: MIME mismatch is rejected", mismatch.status === 400 && mismatch.body.error.fields.reasons.includes("mime_mismatch"), evidence.mismatch);
assert(results, "complete: MIME-mismatched object is deleted", mismatchAfter.status === 404, evidence.mismatch);

await put("spike/doc.pdf", "application/pdf", 500);
const pdfHead = await head("spike/doc.pdf");
const pdfComplete = await post("/spike/r2/complete", { key: "spike/doc.pdf", declaredSize: 500, declaredMime: "application/pdf" });
evidence.nonImage = { disposition: pdfHead.body.data?.mime, completeDisposition: pdfComplete.body.data?.contentDisposition };
assert(results, "non-image: stored with attachment disposition", pdfComplete.body.data?.contentDisposition === "attachment", evidence.nonImage);

// --- Remote-only items are explicitly recorded as unverified ---------------------
evidence.remoteBlocked = {
  directR2Put: "not executed: no Cloudflare account credentials in this environment",
  r2CorsPolicy: "bucket CORS must allow PUT from the site origin with Content-Type",
  presignedPost: "R2 docs: POST (multipart form uploads) is not currently supported, so content-length-range is unavailable",
};
console.log(JSON.stringify(evidence.remoteBlocked, null, 2));

const failed = results.filter((row) => !row.pass);
console.log(JSON.stringify({ passed: results.length - failed.length, failed: failed.length, results, evidence }, null, 2));
saveResults("spike4.json", { passed: results.length - failed.length, failed: failed.length, results, evidence });
if (failed.length > 0) process.exitCode = 1;
