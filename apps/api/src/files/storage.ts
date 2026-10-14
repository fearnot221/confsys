import { mkdir, open, unlink } from "node:fs/promises";
import { constants } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";
import { createHash } from "node:crypto";
import { createConnection } from "node:net";
import sharp from "sharp";
import { validatePdf } from "./pdf-validation.js";
import { AuthError } from "../auth/errors.js";

export const maximumFileBytes = 8 * 1024 * 1024;
export type FileStorageConfig = {
  root: string;
  scannerHost: string;
  scannerPort: number;
};
export function privatePath(root: string, key: string) {
  if (
    !isAbsolute(root) ||
    !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(key)
  )
    throw new Error("Invalid private storage configuration/key");
  return join(resolve(root), key);
}
export async function writePrivate(root: string, key: string, bytes: Buffer) {
  await mkdir(root, { recursive: true, mode: 0o700 });
  const file = await open(
    privatePath(root, key),
    constants.O_WRONLY |
      constants.O_CREAT |
      constants.O_EXCL |
      constants.O_NOFOLLOW,
    0o600,
  );
  try {
    await file.writeFile(bytes);
    await file.sync();
  } finally {
    await file.close();
  }
}
export async function readPrivate(
  root: string,
  key: string,
  expectedSize: number,
  checksum: string,
) {
  const file = await open(
    privatePath(root, key),
    constants.O_RDONLY | constants.O_NOFOLLOW,
  );
  try {
    const stat = await file.stat();
    if (
      !stat.isFile() ||
      stat.size !== expectedSize ||
      stat.size > maximumFileBytes
    )
      throw new Error("Private storage integrity failure");
    const bytes = await file.readFile();
    if (digest(bytes) !== checksum)
      throw new Error("Private storage checksum failure");
    return bytes;
  } finally {
    await file.close();
  }
}
export async function removeIncomplete(root: string, key: string) {
  try {
    await unlink(privatePath(root, key));
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "ENOENT"))
      throw error;
  }
}
export const digest = (bytes: Buffer) =>
  createHash("sha256").update(bytes).digest("hex");
export async function prepareContent(content: string, purpose: string) {
  const bytes = Buffer.from(content, "base64");
  if (
    !bytes.length ||
    bytes.length > maximumFileBytes ||
    bytes.toString("base64") !== content
  )
    throw new AuthError("INVALID_REQUEST");
  const pdf = /^%PDF-1\.[0-9]/.test(bytes.subarray(0, 8).toString("ascii"));
  if (pdf) {
    if (
      purpose === "site_media" ||
      !/%%EOF\s*$/.test(bytes.subarray(-1024).toString("latin1"))
    )
      throw new AuthError("UNSUPPORTED_MEDIA_TYPE");
    await validatePdf(bytes);
    return { bytes, mediaType: "application/pdf" as const };
  }
  const png = bytes
    .subarray(0, 8)
    .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  const jpeg = bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
  if (!png && !jpeg) throw new AuthError("UNSUPPORTED_MEDIA_TYPE");
  try {
    // Decode and encode a single raster frame; strip EXIF/profiles/trailing polyglot bytes.
    const image = sharp(bytes, {
      limitInputPixels: 16_777_216,
      failOn: "warning",
      animated: false,
    });
    const info = await image.metadata();
    if (
      !info.width ||
      !info.height ||
      info.width > 4096 ||
      info.height > 4096 ||
      (info.pages ?? 1) > 1
    )
      throw new Error("Image bounds");
    const normalized = await image.rotate().png().toBuffer();
    if (normalized.length > maximumFileBytes) throw new Error("Image size");
    return { bytes: normalized, mediaType: "image/png" as const };
  } catch {
    throw new AuthError("UNSUPPORTED_MEDIA_TYPE");
  }
}
// ClamAV INSTREAM sends bytes locally; an unavailable scanner never means clean.
export function scanContent(
  bytes: Buffer,
  config: FileStorageConfig,
): Promise<"clean" | "infected" | "unavailable"> {
  return new Promise((done) => {
    let settled = false,
      response = "";
    const socket = createConnection({
      host: config.scannerHost,
      port: config.scannerPort,
    });
    const finish = (result: "clean" | "infected" | "unavailable") => {
      if (!settled) {
        settled = true;
        socket.destroy();
        done(result);
      }
    };
    socket.setTimeout(15000, () => finish("unavailable"));
    socket.on("error", () => finish("unavailable"));
    socket.on("end", () => finish("unavailable"));
    socket.on("data", (chunk: Buffer) => {
      response += chunk.toString("utf8");
      if (response.length > 2048) return finish("unavailable");
      if (!response.includes("\0")) return;
      if (response === "stream: OK\0") finish("clean");
      else if (/^stream: .+ FOUND\0$/.test(response)) finish("infected");
      else finish("unavailable");
    });
    socket.on("connect", () => {
      socket.write("zINSTREAM\0");
      for (let start = 0; start < bytes.length; start += 65536) {
        const chunk = bytes.subarray(start, start + 65536),
          size = Buffer.alloc(4);
        size.writeUInt32BE(chunk.length);
        socket.write(size);
        socket.write(chunk);
      }
      socket.write(Buffer.alloc(4));
    });
  });
}
