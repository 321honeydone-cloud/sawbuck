// Where uploaded inspection media lives on disk. Defaults to public/uploads, but
// set UPLOAD_DIR to a mounted persistent volume when deploying so photos and
// video survive redeploys. All three upload paths (write, serve, video frames)
// go through here so there is one place to point at storage.
import path from "path";

export function uploadsRoot(): string {
  return process.env.UPLOAD_DIR || path.join(process.cwd(), "public", "uploads");
}
