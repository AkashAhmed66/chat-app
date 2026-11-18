import crypto from "crypto";
import { Router } from "express";
import fs from "fs";
import path from "path";
import { Readable } from "stream";
import { requireAuth } from "../auth";
import { pool } from "../db";
import { ah, HttpError } from "../utils";

const router = Router();
router.use(requireAuth);

export const UPLOADS_ROOT = path.resolve(process.env.UPLOADS_DIR || path.join(process.cwd(), "uploads"));
export const AVATARS_DIR = path.join(UPLOADS_ROOT, "avatars");
export const MEDIA_DIR = path.join(UPLOADS_ROOT, "media");

// Ensure upload directories exist
for (const dir of [UPLOADS_ROOT, AVATARS_DIR, MEDIA_DIR]) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function getMediaType(mime: string, filename: string): "image" | "video" | "file" {
  const m = mime.toLowerCase();
  const ext = path.extname(filename).toLowerCase();
  if (
    m.startsWith("image/") ||
    [".jpg", ".jpeg", ".png", ".webp", ".gif", ".svg", ".bmp"].includes(ext)
  ) {
    return "image";
  }
  if (
    m.startsWith("video/") ||
    [".mp4", ".webm", ".ogg", ".mov", ".mkv", ".avi"].includes(ext)
  ) {
    return "video";
  }
  return "file";
}

/** Handle multipart upload natively via Node.js Web Streams without external dependencies */
async function parseMultipartFile(
  req: import("express").Request,
  targetDir: string,
  maxSizeBytes: number
): Promise<{
  filename: string;
  originalName: string;
  size: number;
  mime: string;
  urlPath: string;
}> {
  const contentType = req.headers["content-type"];
  if (!contentType || !contentType.includes("multipart/form-data")) {
    throw new HttpError(400, "Expected multipart/form-data");
  }

  try {
    const webStream = Readable.toWeb(req) as unknown as ReadableStream;
    const response = new Response(webStream, {
      headers: { "content-type": contentType },
    });
    const formData = await response.formData();
    const file = formData.get("file");

    if (!file || typeof file === "string") {
      throw new HttpError(400, "No file uploaded under form field 'file'");
    }

    const fileObj = file as File;
    const originalName = fileObj.name || "upload.bin";
    const mime = fileObj.type || "application/octet-stream";
    const ext = path.extname(originalName) || ".bin";

    const arrayBuffer = await fileObj.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    if (buffer.length > maxSizeBytes) {
      throw new HttpError(
        413,
        `File too large. Maximum size is ${Math.round(maxSizeBytes / (1024 * 1024))}MB`
      );
    }

    const randomSuffix = crypto.randomBytes(12).toString("hex");
    const safeBaseName = path.basename(originalName, ext).replace(/[^a-zA-Z0-9_-]/g, "_");
    const uniqueFileName = `${Date.now()}-${randomSuffix}-${safeBaseName.slice(0, 30)}${ext}`;
    const destinationPath = path.join(targetDir, uniqueFileName);

    await fs.promises.writeFile(destinationPath, buffer);

    const relativeSub = targetDir === AVATARS_DIR ? "avatars" : "media";
    return {
      filename: uniqueFileName,
      originalName,
      size: buffer.length,
      mime,
      urlPath: `/uploads/${relativeSub}/${uniqueFileName}`,
    };
  } catch (err: unknown) {
    if (err instanceof HttpError) throw err;
    console.error("Multipart parse error:", err);
    throw new HttpError(400, "Failed to process uploaded file");
  }
}

/** Upload chat media: images, videos, audio, documents */
router.post(
  "/media",
  ah(async (req, res) => {
    // 50 MB limit for chat media
    const maxSizeBytes = 50 * 1024 * 1024;
    const fileInfo = await parseMultipartFile(req, MEDIA_DIR, maxSizeBytes);
    const mediaType = getMediaType(fileInfo.mime, fileInfo.originalName);

    res.json({
      url: fileInfo.urlPath,
      name: fileInfo.originalName,
      size: fileInfo.size,
      mime: fileInfo.mime,
      type: mediaType,
    });
  })
);

/** Upload user avatar */
router.post(
  "/avatar",
  ah(async (req, res) => {
    const me = req.user!.id;
    // 6 MB limit for profile pictures
    const maxSizeBytes = 6 * 1024 * 1024;
    const fileInfo = await parseMultipartFile(req, AVATARS_DIR, maxSizeBytes);

    const mediaType = getMediaType(fileInfo.mime, fileInfo.originalName);
    if (mediaType !== "image") {
      // Clean up invalid file
      await fs.promises.unlink(path.join(AVATARS_DIR, fileInfo.filename)).catch(() => undefined);
      throw new HttpError(400, "Avatar must be an image (JPEG, PNG, WebP, GIF)");
    }

    // Automatically update the user's avatar_url in the database
    await pool.query("UPDATE users SET avatar_url = $1 WHERE id = $2", [fileInfo.urlPath, me]);

    res.json({
      avatarUrl: fileInfo.urlPath,
    });
  })
);

/** Delete an uploaded file safely from the filesystem */
export async function deleteUploadedFile(urlPath: string | null | undefined): Promise<void> {
  if (!urlPath || typeof urlPath !== "string") return;
  try {
    const match = urlPath.match(/\/uploads\/(avatars|media)\/([^?#]+)/);
    if (!match) return;
    const [, subDir, fileName] = match;
    const targetDir = subDir === "avatars" ? AVATARS_DIR : MEDIA_DIR;
    const filePath = path.join(targetDir, path.basename(fileName));
    if (fs.existsSync(filePath)) {
      await fs.promises.unlink(filePath);
    }
  } catch (err) {
    console.warn("Failed to delete uploaded file:", urlPath, err);
  }
}

export default router;
