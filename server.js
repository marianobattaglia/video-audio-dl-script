"use strict";

const http = require("node:http");
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const net = require("node:net");
const dns = require("node:dns/promises");
const { spawn, spawnSync } = require("node:child_process");
const { randomUUID } = require("node:crypto");

const PORT = integerEnv("PORT", 3000, 1, 65535);
const HOST = process.env.HOST || "0.0.0.0";
const MAX_CONCURRENT = integerEnv("MAX_CONCURRENT_DOWNLOADS", 2, 1, 20);
const MAX_DURATION_MS = integerEnv("MAX_DOWNLOAD_SECONDS", 3600, 30, 86400) * 1000;
const JOB_TTL_MS = integerEnv("JOB_TTL_SECONDS", 900, 60, 86400) * 1000;
const MAX_OUTPUT_BYTES = integerEnv("MAX_OUTPUT_MB", 1800, 100, 200000) * 1024 * 1024;
const TEMP_ROOT = path.resolve(process.env.DOWNLOAD_TMP_DIR || path.join(os.tmpdir(), "video-audio-dl"));
const YTDLP = process.env.YTDLP_PATH || "yt-dlp";
const FFMPEG = process.env.FFMPEG_PATH || "ffmpeg";
const jobs = new Map();
const activeJobs = new Set();
let server;

function integerEnv(name, fallback, min, max) {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`${name} must be an integer between ${min} and ${max}`);
  }
  return value;
}

function matchesCidr(bytes, network, prefix) {
  const whole = Math.floor(prefix / 8);
  const remainder = prefix % 8;
  for (let i = 0; i < whole; i += 1) if (bytes[i] !== (network[i] || 0)) return false;
  if (!remainder) return true;
  const mask = (0xff << (8 - remainder)) & 0xff;
  return (bytes[whole] & mask) === ((network[whole] || 0) & mask);
}

function ipv4Bytes(address) {
  return address.split(".").map(Number);
}

function parseIPv6(address) {
  if (address.includes("%")) return null;
  let source = address.toLowerCase();
  if (source.includes(".")) {
    const lastColon = source.lastIndexOf(":");
    const v4 = ipv4Bytes(source.slice(lastColon + 1));
    source = `${source.slice(0, lastColon)}:${((v4[0] << 8) | v4[1]).toString(16)}:${((v4[2] << 8) | v4[3]).toString(16)}`;
  }
  const halves = source.split("::");
  if (halves.length > 2) return null;
  const left = halves[0] ? halves[0].split(":") : [];
  const right = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  const missing = 8 - left.length - right.length;
  if ((halves.length === 1 && missing !== 0) || (halves.length === 2 && missing < 1)) return null;
  const groups = [...left, ...Array(missing).fill("0"), ...right];
  if (groups.length !== 8 || groups.some((part) => !/^[0-9a-f]{1,4}$/.test(part))) return null;
  return groups.flatMap((part) => {
    const value = parseInt(part, 16);
    return [value >> 8, value & 0xff];
  });
}

function isPublicIp(address) {
  const version = net.isIP(address);
  if (version === 4) {
    const b = ipv4Bytes(address);
    const blocked = [
      [[0, 0, 0, 0], 8], [[10, 0, 0, 0], 8], [[100, 64, 0, 0], 10],
      [[127, 0, 0, 0], 8], [[169, 254, 0, 0], 16], [[172, 16, 0, 0], 12],
      [[192, 0, 0, 0], 24], [[192, 0, 2, 0], 24], [[192, 88, 99, 0], 24],
      [[192, 168, 0, 0], 16], [[198, 18, 0, 0], 15], [[198, 51, 100, 0], 24],
      [[203, 0, 113, 0], 24], [[224, 0, 0, 0], 4], [[240, 0, 0, 0], 4]
    ];
    return !blocked.some(([network, prefix]) => matchesCidr(b, network, prefix));
  }
  if (version === 6) {
    const b = parseIPv6(address);
    if (!b) return false;
    const mapped = b.slice(0, 10).every((byte) => byte === 0) && b[10] === 255 && b[11] === 255;
    if (mapped) return isPublicIp(b.slice(12).join("."));
    const isGlobalUnicast = (b[0] & 0xe0) === 0x20;
    if (!isGlobalUnicast) return false;
    const blocked = [
      [[0x20, 0x01, 0x00, 0x00], 23], [[0x20, 0x01, 0x0d, 0xb8], 32],
      [[0x20, 0x02, 0x00, 0x00], 16], [[0x3f, 0xff, 0x00, 0x00], 20],
      [[0x00, 0x64, 0xff, 0x9b], 96], [[0x00, 0x64, 0xff, 0x9b, 0x00, 0x01], 48]
    ];
    return !blocked.some(([network, prefix]) => matchesCidr(b, network, prefix));
  }
  return false;
}

async function validateUrl(value) {
  if (typeof value !== "string" || value.length > 4096) throw userError("Pega una URL válida de hasta 4096 caracteres.");
  let url;
  try { url = new URL(value); } catch { throw userError("La URL no tiene un formato válido."); }
  if (!["http:", "https:"].includes(url.protocol) || !url.hostname || url.username || url.password) {
    throw userError("Usa una URL pública HTTP o HTTPS sin credenciales embebidas.");
  }
  const expectedPort = url.protocol === "https:" ? "443" : "80";
  if (url.port && url.port !== expectedPort) throw userError("Por seguridad, solo se permiten los puertos HTTP 80 y HTTPS 443.");
  const hostname = url.hostname.replace(/^\[|\]$/g, "");
  const literalVersion = net.isIP(hostname);
  let addresses;
  try {
    addresses = literalVersion ? [{ address: hostname }] : await dns.lookup(hostname, { all: true, verbatim: true });
  } catch {
    throw userError("No se pudo resolver el dominio de esa URL.");
  }
  if (!addresses.length || addresses.some(({ address }) => !isPublicIp(address))) {
    throw userError("Solo se permiten direcciones públicas de Internet.");
  }
  return url.href;
}

function userError(message, status = 400) {
  const error = new Error(message);
  error.status = status;
  error.userMessage = message;
  return error;
}

async function readJson(req) {
  if (!req.headers["content-type"]?.toLowerCase().startsWith("application/json")) {
    throw userError("La solicitud debe usar formato JSON.", 415);
  }
  let body = "";
  for await (const chunk of req) {
    body += chunk;
    if (Buffer.byteLength(body) > 8192) throw userError("La solicitud es demasiado grande.", 413);
  }
  try { return JSON.parse(body); } catch { throw userError("La solicitud no contiene JSON válido."); }
}

function sendJson(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff"
  });
  res.end(body);
}

function publicJob(job) {
  return {
    id: job.id,
    status: job.status,
    kind: job.kind,
    progress: job.progress,
    etaSeconds: job.etaSeconds,
    message: job.message,
    filename: job.filename,
    downloadUrl: job.status === "complete" && !job.delivered ? `/api/jobs/${job.id}/file` : null,
    createdAt: job.createdAt
  };
}

function addOutputLine(job, line) {
  const progress = line.match(/^DL_PROGRESS:([0-9]+(?:\.[0-9]+)?|NA):([0-9]+|NA)$/);
  if (progress) {
    job.progress = progress[1] === "NA" ? null : Math.min(100, Math.max(0, Number(progress[1])));
    job.etaSeconds = progress[2] === "NA" ? null : Number(progress[2]);
    job.message = job.progress === null ? "Descargando…" : `Descargando… ${Math.floor(job.progress)}%`;
  }
  const output = line.match(/^APP_OUTPUT:(.+)$/);
  if (output) job.outputPath = output[1];
  if (line) {
    job.diagnostics = (job.diagnostics + line.slice(0, 1000) + "\n").slice(-12000);
  }
}

function safeFilename(filename, kind) {
  const base = path.basename(filename || "descarga").replace(/[\u0000-\u001f\u007f"\\/:*?<>|]/g, "_").trim();
  const suffix = kind === "audio" ? ".mp3" : ".mp4";
  const withoutKnownExtension = base.replace(/\.(?:mp3|mp4|mkv|webm|m4a|opus)$/i, "");
  return `${(withoutKnownExtension || "descarga").slice(0, 180)}${suffix}`;
}

async function directoryBytes(directory) {
  let total = 0;
  const entries = await fsp.readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) total += await directoryBytes(target);
    else if (entry.isFile()) total += (await fsp.stat(target)).size;
  }
  return total;
}

async function removeJobFiles(job) {
  if (job.timer) clearTimeout(job.timer);
  if (job.sizeTimer) clearInterval(job.sizeTimer);
  try { await fsp.rm(job.directory, { recursive: true, force: true }); } catch { /* cleanup is retried on expiry/startup */ }
}

function runDownload(job, url) {
  const outputTemplate = path.join(job.directory, "%(title).120B [%(id)s].%(ext)s");
  const args = [
    "--no-color", "--no-warnings", "--newline", "--no-playlist",
    "--extractor-args", "youtube:player_client=android",
    "--progress-template", "download:DL_PROGRESS:%(progress.percent)s:%(progress.eta)s",
    "--print", "after_move:APP_OUTPUT:%(filepath)s",
    "--restrict-filenames", "--remux-video", "mp4", "-o", outputTemplate
  ];
  if (job.kind === "video") {
    args.push("-f", "bv*+ba/b", "--merge-output-format", "mp4");
  } else {
    args.push("-x", "--audio-format", "mp3", "--audio-quality", "0", "--ffmpeg-location", FFMPEG);
  }
  args.push(url);

  const child = spawn(YTDLP, args, { cwd: job.directory, shell: false, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
  job.child = child;
  job.status = "running";
  job.message = "Conectando con el sitio…";
  activeJobs.add(job.id);
  job.timer = setTimeout(() => {
    job.timedOut = true;
    child.kill("SIGTERM");
    setTimeout(() => { if (child.exitCode === null) child.kill("SIGKILL"); }, 2000).unref();
  }, MAX_DURATION_MS);
  job.sizeTimer = setInterval(async () => {
    try {
      if (await directoryBytes(job.directory) > MAX_OUTPUT_BYTES) {
        job.tooLarge = true;
        child.kill("SIGTERM");
      }
    } catch { /* the job may have been removed during cancellation */ }
  }, 2000);
  job.sizeTimer.unref();
  job.timer.unref();

  let stdoutCarry = "";
  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk) => {
    const lines = (stdoutCarry + chunk).split(/\r?\n/);
    stdoutCarry = lines.pop() || "";
    for (const line of lines) addOutputLine(job, line);
  });
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk) => {
    job.diagnostics = (job.diagnostics + chunk).slice(-12000);
  });

  child.on("error", async () => {
    activeJobs.delete(job.id);
    job.status = "failed";
    job.message = `No se pudo iniciar el servicio de descarga. Comprueba que ${path.basename(YTDLP)} esté instalado en el servidor.`;
    await removeJobFiles(job);
  });
  child.on("close", async (code) => {
    activeJobs.delete(job.id);
    job.child = null;
    if (stdoutCarry) addOutputLine(job, stdoutCarry);
    if (job.status === "cancelled") {
      await removeJobFiles(job);
      return;
    }
    if (job.timedOut) {
      job.status = "failed";
      job.message = "La descarga superó el tiempo máximo permitido.";
    } else if (job.tooLarge) {
      job.status = "failed";
      job.message = "El archivo supera el límite de tamaño configurado.";
    } else if (code === 0 && job.outputPath) {
      const resolved = path.resolve(job.outputPath);
      const relative = path.relative(job.directory, resolved);
      if (relative.startsWith("..") || path.isAbsolute(relative)) {
        job.status = "failed";
        job.message = "El servicio no pudo validar el archivo de salida.";
      } else {
        try {
          const stat = await fsp.stat(resolved);
          if (!stat.isFile() || stat.size > MAX_OUTPUT_BYTES) throw new Error("invalid output");
          job.outputPath = resolved;
          job.filename = safeFilename(path.basename(resolved), job.kind);
          job.status = "complete";
          job.progress = 100;
          job.message = "Tu archivo está listo.";
          job.completedAt = Date.now();
        } catch {
          job.status = "failed";
          job.message = "La descarga terminó sin generar un archivo válido.";
        }
      }
    } else {
      job.status = "failed";
      job.message = /sign in to confirm|cookies/i.test(job.diagnostics)
        ? "Este sitio requiere autenticación o cookies del navegador. Ese tipo de enlace no está disponible en esta app."
        : "No se pudo descargar esa URL. Comprueba el enlace o prueba con otro sitio compatible.";
    }
    if (job.status === "failed") await removeJobFiles(job);
  });
}

async function startJob(kind, url) {
  if (kind !== "video" && kind !== "audio") throw userError("Elige video o audio.");
  if (activeJobs.size >= MAX_CONCURRENT) throw userError("La app está ocupada. Espera a que termine una descarga y vuelve a intentar.", 429);
  const safeUrl = await validateUrl(url);
  if (activeJobs.size >= MAX_CONCURRENT) throw userError("La app está ocupada. Espera a que termine una descarga y vuelve a intentar.", 429);
  const id = randomUUID();
  const directory = path.join(TEMP_ROOT, id);
  await fsp.mkdir(directory, { recursive: false, mode: 0o700 });
  const job = {
    id, kind, directory, status: "queued", progress: null, etaSeconds: null,
    message: "Preparando la descarga…", diagnostics: "", createdAt: Date.now(), delivered: false
  };
  jobs.set(id, job);
  runDownload(job, safeUrl);
  return job;
}

function filenameHeader(filename) {
  const ascii = filename.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
  const encoded = encodeURIComponent(filename).replace(/[!'()*]/g, (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`);
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}

async function route(req, res) {
  const requestUrl = new URL(req.url, "http://localhost");
  const pathname = requestUrl.pathname;

  if (req.method === "GET" && pathname === "/healthz") {
    return sendJson(res, 200, { status: "ok", activeDownloads: activeJobs.size });
  }
  if (req.method === "GET" && ["/", "/index.html", "/app.js", "/styles.css"].includes(pathname)) {
    const names = { "/": "index.html", "/index.html": "index.html", "/app.js": "app.js", "/styles.css": "styles.css" };
    const file = path.join(__dirname, "public", names[pathname]);
    const types = { "index.html": "text/html; charset=utf-8", "app.js": "text/javascript; charset=utf-8", "styles.css": "text/css; charset=utf-8" };
    const content = await fsp.readFile(file);
    res.writeHead(200, { "Content-Type": types[names[pathname]], "Content-Length": content.length, "Cache-Control": "no-cache", "X-Content-Type-Options": "nosniff" });
    return res.end(content);
  }
  if (req.method === "POST" && pathname === "/api/jobs") {
    const body = await readJson(req);
    const job = await startJob(body.kind, body.url);
    return sendJson(res, 202, publicJob(job));
  }
  const match = pathname.match(/^\/api\/jobs\/([0-9a-f-]{36})(?:\/(file))?$/i);
  if (match) {
    const [, id, filePart] = match;
    const job = jobs.get(id);
    if (!job) throw userError("Esa descarga ya no está disponible. Envía el enlace otra vez.", 404);
    if (req.method === "GET" && !filePart) return sendJson(res, 200, publicJob(job));
    if (req.method === "DELETE" && !filePart) {
      if (job.child && job.status === "running") {
        job.status = "cancelled";
        job.message = "Descarga cancelada.";
        job.child.kill("SIGTERM");
        setTimeout(() => { if (job.child?.exitCode === null) job.child.kill("SIGKILL"); }, 1500).unref();
      } else {
        job.status = "cancelled";
        job.message = "Descarga cancelada.";
        await removeJobFiles(job);
      }
      return sendJson(res, 200, publicJob(job));
    }
    if (req.method === "GET" && filePart) {
      if (job.status !== "complete" || job.delivered || !job.outputPath) throw userError("El archivo todavía no está listo o ya fue descargado.", 409);
      job.delivered = true;
      const stat = await fsp.stat(job.outputPath).catch(() => null);
      if (!stat?.isFile()) {
        await removeJobFiles(job);
        job.status = "failed";
        job.message = "El archivo temporal ya no está disponible.";
        throw userError(job.message, 410);
      }
      res.writeHead(200, {
        "Content-Type": job.kind === "audio" ? "audio/mpeg" : "video/mp4",
        "Content-Length": stat.size,
        "Content-Disposition": filenameHeader(job.filename),
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff"
      });
      const stream = fs.createReadStream(job.outputPath);
      stream.on("error", () => res.destroy());
      stream.pipe(res);
      res.on("close", async () => {
        await removeJobFiles(job);
        job.outputPath = null;
        job.status = "delivered";
        job.message = "Archivo descargado.";
      });
      return;
    }
  }
  throw userError("No se encontró esa página.", 404);
}

async function cleanStaleFiles() {
  await fsp.mkdir(TEMP_ROOT, { recursive: true, mode: 0o700 });
  const entries = await fsp.readdir(TEMP_ROOT, { withFileTypes: true });
  await Promise.all(entries.map(async (entry) => {
    const target = path.join(TEMP_ROOT, entry.name);
    if (entry.isDirectory()) await fsp.rm(target, { recursive: true, force: true });
    else await fsp.rm(target, { force: true });
  }));
}

function cleanExpiredJobs() {
  const now = Date.now();
  for (const [id, job] of jobs) {
    if (job.status !== "running" && now - (job.completedAt || job.createdAt) > JOB_TTL_MS) {
      void removeJobFiles(job);
      jobs.delete(id);
    }
  }
}

function assertToolsAvailable() {
  for (const [binary, args] of [[YTDLP, ["--version"]], [FFMPEG, ["-version"]]]) {
    const result = spawnSync(binary, args, { encoding: "utf8", timeout: 10000, windowsHide: true });
    if (result.error || result.status !== 0) throw new Error(`Required server tool unavailable: ${path.basename(binary)}`);
  }
}

async function main() {
  assertToolsAvailable();
  await cleanStaleFiles();
  server = http.createServer((req, res) => {
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("Content-Security-Policy", "default-src 'self'; style-src 'self'; script-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
    route(req, res).catch((error) => {
      if (res.headersSent) return res.destroy();
      const status = Number.isInteger(error.status) ? error.status : 500;
      sendJson(res, status, { error: error.userMessage || "Ocurrió un error interno. Inténtalo nuevamente." });
      if (status >= 500) process.stderr.write(`${error.stack || error}\n`);
    });
  });
  server.headersTimeout = 15000;
  server.requestTimeout = 30000;
  server.listen(PORT, HOST, () => process.stdout.write(`Web app listening on http://${HOST}:${PORT}\n`));
  const expiryTimer = setInterval(cleanExpiredJobs, 30000);
  expiryTimer.unref();
}

main().catch((error) => {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    for (const job of jobs.values()) if (job.child) job.child.kill("SIGTERM");
    server?.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 3000).unref();
  });
}
