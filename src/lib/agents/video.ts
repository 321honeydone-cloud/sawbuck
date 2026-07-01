// Video frame extraction for the Vision employee.
//
// Ollama vision models read still images, not video. So for a clip we pull a
// handful of evenly spaced frames with ffmpeg and hand those to the model like
// photos. If ffmpeg is not installed on the machine, every function here just
// returns an empty list, the caller treats the clip as "no readable frames" and
// the rest of the app keeps working. Server-only (uses child_process + fs).

import { spawn } from "node:child_process";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const MAX_FRAMES = 6;
const FRAME_SCALE = "scale='min(1024,iw)':-2"; // shrink wide clips, keep aspect

/** Run a command, resolve with {code, stdout, stderr}. Never throws. */
function run(cmd: string, args: string[], timeoutMs = 60000): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    let done = false;
    const finish = (code: number) => {
      if (done) return;
      done = true;
      resolve({ code, stdout, stderr });
    };
    try {
      const p = spawn(cmd, args, { windowsHide: true });
      const timer = setTimeout(() => {
        try {
          p.kill("SIGKILL");
        } catch {
          /* already gone */
        }
        finish(124);
      }, timeoutMs);
      p.stdout.on("data", (d) => (stdout += d.toString()));
      p.stderr.on("data", (d) => (stderr += d.toString()));
      p.on("error", () => {
        clearTimeout(timer);
        finish(127);
      });
      p.on("close", (code) => {
        clearTimeout(timer);
        finish(code ?? 0);
      });
    } catch {
      finish(127);
    }
  });
}

/** Is ffmpeg on PATH? Cached after the first check. */
let ffmpegOk: boolean | null = null;
export async function hasFfmpeg(): Promise<boolean> {
  if (ffmpegOk !== null) return ffmpegOk;
  const r = await run("ffmpeg", ["-version"], 5000);
  ffmpegOk = r.code === 0;
  return ffmpegOk;
}

/** Try ffprobe for the clip duration in seconds. Returns 0 if unknown. */
async function duration(path: string): Promise<number> {
  const r = await run(
    "ffprobe",
    ["-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", path],
    10000
  );
  const n = parseFloat(r.stdout.trim());
  return isFinite(n) && n > 0 ? n : 0;
}

/** Pull up to `count` evenly spaced JPEG frames from a video file. Base64, no prefix. */
export async function extractFramesFromFile(path: string, count = MAX_FRAMES): Promise<string[]> {
  if (!(await hasFfmpeg())) return [];
  const want = Math.max(1, Math.min(count, MAX_FRAMES));
  const dir = await mkdtemp(join(tmpdir(), "hd-frames-"));
  try {
    const dur = await duration(path);
    if (dur > 0) {
      // One frame per evenly spaced timestamp, sharpest grab via -ss before -i.
      const grabs: Promise<unknown>[] = [];
      for (let i = 0; i < want; i++) {
        const ts = (dur * (i + 0.5)) / want;
        const out = join(dir, `f${String(i).padStart(2, "0")}.jpg`);
        grabs.push(
          run("ffmpeg", ["-ss", ts.toFixed(2), "-i", path, "-frames:v", "1", "-vf", FRAME_SCALE, "-q:v", "4", "-y", out], 30000)
        );
      }
      await Promise.all(grabs);
    } else {
      // Unknown duration, grab ~1 fps and cap the count.
      await run("ffmpeg", ["-i", path, "-vf", `fps=1,${FRAME_SCALE}`, "-frames:v", String(want), "-q:v", "4", "-y", join(dir, "f%02d.jpg")], 45000);
    }
    const files = (await readdir(dir)).filter((f) => f.endsWith(".jpg")).sort();
    const frames: string[] = [];
    for (const f of files.slice(0, want)) {
      try {
        frames.push((await readFile(join(dir, f))).toString("base64"));
      } catch {
        /* skip unreadable frame */
      }
    }
    return frames;
  } catch {
    return [];
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

/** Same, but from a base64 clip (e.g. an attachment). Writes a temp file first. */
export async function extractFramesFromBase64(data: string, ext = "mp4", count = MAX_FRAMES): Promise<string[]> {
  if (!data || !(await hasFfmpeg())) return [];
  const dir = await mkdtemp(join(tmpdir(), "hd-clip-"));
  const path = join(dir, `clip.${ext.replace(/[^a-z0-9]/gi, "") || "mp4"}`);
  try {
    await writeFile(path, Buffer.from(data, "base64"));
    return await extractFramesFromFile(path, count);
  } catch {
    return [];
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}
