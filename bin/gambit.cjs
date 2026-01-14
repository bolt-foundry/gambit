#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const os = require("os");
const https = require("https");
const http = require("http");
const crypto = require("crypto");
const zlib = require("zlib");
const { pipeline } = require("stream/promises");
const { spawnSync } = require("child_process");

const MAX_REDIRECTS = 5;

const fileExists = async (filePath) => {
  try {
    await fs.promises.access(filePath, fs.constants.F_OK);
    return true;
  } catch {
    return false;
  }
};

const readJson = (filePath) => {
  const raw = fs.readFileSync(filePath, "utf8");
  return JSON.parse(raw);
};

const getPackageVersion = () => {
  const pkgPath = path.join(__dirname, "..", "package.json");
  const pkg = readJson(pkgPath);
  if (!pkg.version) {
    throw new Error(`Missing version in ${pkgPath}`);
  }
  return pkg.version;
};

const getPlatformAsset = () => {
  const { platform, arch } = process;
  if (platform === "darwin" && arch === "arm64") {
    return "gambit-darwin-arm64";
  }
  if (platform === "darwin" && arch === "x64") {
    return "gambit-darwin-x64";
  }
  if (platform === "linux" && arch === "x64") {
    return "gambit-linux-x64";
  }
  if (platform === "linux" && arch === "arm64") {
    return "gambit-linux-arm64";
  }
  return "";
};

const getCacheDir = (version) => {
  const cacheRoot = process.env.XDG_CACHE_HOME ||
    (process.env.HOME ? path.join(process.env.HOME, ".cache") : os.tmpdir());
  return path.join(cacheRoot, "bolt-foundry", "gambit", version);
};

const request = (url, redirectCount = 0) =>
  new Promise((resolve, reject) => {
    const client = url.startsWith("https:") ? https : http;
    const req = client.get(url, (res) => {
      const status = res.statusCode || 0;
      if (
        status >= 300 && status < 400 && res.headers.location &&
        redirectCount < MAX_REDIRECTS
      ) {
        const nextUrl = new URL(res.headers.location, url).toString();
        res.resume();
        resolve(request(nextUrl, redirectCount + 1));
        return;
      }
      if (status !== 200) {
        res.resume();
        reject(new Error(`HTTP ${status} for ${url}`));
        return;
      }
      resolve(res);
    });
    req.on("error", reject);
  });

const downloadFile = async (url, dest) => {
  const tmpDest = `${dest}.tmp-${process.pid}`;
  await fs.promises.mkdir(path.dirname(dest), { recursive: true });
  const res = await request(url);
  await new Promise((resolve, reject) => {
    const file = fs.createWriteStream(tmpDest, { mode: 0o755 });
    res.pipe(file);
    res.on("error", (err) => {
      file.close(() => reject(err));
    });
    file.on("finish", () => file.close(resolve));
    file.on("error", reject);
  });
  await fs.promises.rename(tmpDest, dest);
};

const gunzipFile = async (source, dest) => {
  const tmpDest = `${dest}.tmp-${process.pid}`;
  await fs.promises.mkdir(path.dirname(dest), { recursive: true });
  await pipeline(
    fs.createReadStream(source),
    zlib.createGunzip(),
    fs.createWriteStream(tmpDest, { mode: 0o755 }),
  );
  await fs.promises.rename(tmpDest, dest);
};

const fetchText = async (url) => {
  const res = await request(url);
  const chunks = [];
  for await (const chunk of res) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
};

const sha256File = (filePath) =>
  new Promise((resolve, reject) => {
    const hash = crypto.createHash("sha256");
    const stream = fs.createReadStream(filePath);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", reject);
    stream.on("end", () => resolve(hash.digest("hex")));
  });

const allowUnverified = process.env.GAMBIT_ALLOW_UNVERIFIED === "1";

const verifyChecksum = async (checksumUrl, assetName, filePath) => {
  let text;
  try {
    text = await fetchText(checksumUrl);
  } catch (err) {
    if (allowUnverified) {
      console.warn(`Warning: unable to fetch checksums: ${err.message}`);
      return;
    }
    throw new Error(`Unable to fetch checksums: ${err.message}`);
  }
  const lines = text.split("\n").map((line) => line.trim()).filter(Boolean);
  const match = lines
    .map((line) => line.match(/^([a-f0-9]{64})\s+(.+)$/i))
    .find((result) => result && path.posix.basename(result[2]) === assetName);
  if (!match) {
    if (allowUnverified) {
      console.warn(`Warning: checksum for ${assetName} not found.`);
      return;
    }
    throw new Error(`Checksum for ${assetName} not found.`);
  }
  const expected = match[1].toLowerCase();
  const actual = (await sha256File(filePath)).toLowerCase();
  if (expected !== actual) {
    throw new Error(`Checksum mismatch for ${assetName}`);
  }
};

const main = async () => {
  const version = getPackageVersion();
  const assetName = process.env.GAMBIT_BINARY_NAME || getPlatformAsset();
  if (!assetName) {
    console.error(
      `Unsupported platform ${process.platform}/${process.arch}.`,
    );
    process.exit(1);
  }

  const baseUrl = process.env.GAMBIT_BINARY_BASE_URL ||
    `https://github.com/bolt-foundry/gambit/releases/download/v${version}`;
  const binaryUrl = process.env.GAMBIT_BINARY_URL ||
    `${baseUrl}/${assetName}.gz`;
  const checksumUrl = process.env.GAMBIT_BINARY_CHECKSUM_URL ||
    `${baseUrl}/SHA256SUMS`;
  const downloadName = (() => {
    try {
      return path.posix.basename(new URL(binaryUrl).pathname);
    } catch {
      return path.posix.basename(binaryUrl);
    }
  })();
  const expectsGzip = downloadName.endsWith(".gz");

  const cacheDir = getCacheDir(version);
  const binPath = path.join(cacheDir, assetName);
  const archivePath = expectsGzip ? `${binPath}.gz` : binPath;
  const ensureBinary = async () => {
    const hasBin = await fileExists(binPath);
    const hasArchive = await fileExists(archivePath);
    if (!hasBin && expectsGzip && hasArchive) {
      try {
        await verifyChecksum(checksumUrl, downloadName, archivePath);
        await gunzipFile(archivePath, binPath);
        return;
      } catch (err) {
        try {
          await fs.promises.unlink(archivePath);
        } catch {
          // ignore
        }
      }
    }
    if (hasBin) {
      if (expectsGzip && !hasArchive) {
        console.warn(`Cached binary missing archive; re-downloading.`);
      } else {
        try {
          await verifyChecksum(checksumUrl, downloadName, archivePath);
          if (expectsGzip) {
            await gunzipFile(archivePath, binPath);
          }
          return;
        } catch (err) {
          console.warn(
            `Cached binary failed checksum; deleting and re-downloading.`,
          );
          try {
            await fs.promises.unlink(binPath);
          } catch {
            // ignore
          }
          if (expectsGzip) {
            try {
              await fs.promises.unlink(archivePath);
            } catch {
              // ignore
            }
          }
        }
      }
    }
    console.log(`Downloading ${binaryUrl}...`);
    await downloadFile(binaryUrl, archivePath);
    try {
      await verifyChecksum(checksumUrl, downloadName, archivePath);
      if (expectsGzip) {
        await gunzipFile(archivePath, binPath);
      }
    } catch (err) {
      try {
        await fs.promises.unlink(archivePath);
      } catch {
        // ignore
      }
      if (expectsGzip) {
        try {
          await fs.promises.unlink(binPath);
        } catch {
          // ignore
        }
      }
      throw err;
    }
  };

  try {
    await ensureBinary();
  } catch (err) {
    console.error(`Checksum verification failed: ${err.message}`);
    process.exit(1);
  }

  try {
    await fs.promises.chmod(binPath, 0o755);
  } catch {
    // ignore
  }

  const result = spawnSync(binPath, process.argv.slice(2), {
    stdio: "inherit",
  });
  if (result.error) {
    console.error(`Failed to launch gambit: ${result.error.message}`);
    process.exit(1);
  }
  process.exit(result.status ?? 1);
};

main().catch((err) => {
  console.error(err.stack || err.message || String(err));
  process.exit(1);
});
