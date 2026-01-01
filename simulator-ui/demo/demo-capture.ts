import * as path from "@std/path";

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await Deno.stat(filePath);
    return true;
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) return false;
    throw error;
  }
}

export async function exportVideo(
  framesDir: string,
  latestDir: string,
  frameRate?: number | null,
  interpolate?: "mc" | "blend" | null,
): Promise<void> {
  let hasFrames = false;
  try {
    for await (const entry of Deno.readDir(framesDir)) {
      if (entry.isFile) {
        hasFrames = true;
        break;
      }
    }
  } catch (error) {
    console.warn("[gambit-demo] failed to read frames directory:", error);
  }
  if (!hasFrames) return;
  try {
    const fps = frameRate && frameRate > 0 ? Math.round(frameRate) : 30;
    const filters: Array<string> = [];
    if (interpolate === "mc") {
      filters.push(
        `minterpolate=fps=${fps}:mi_mode=mci:mc_mode=aobmc:me_mode=bidir`,
      );
    } else if (interpolate === "blend") {
      filters.push("tblend=all_mode=average");
    }
    filters.push("scale=trunc(iw/2)*2:trunc(ih/2)*2,format=yuv420p");
    const command = new Deno.Command("ffmpeg", {
      args: [
        "-y",
        "-loglevel",
        "error",
        "-framerate",
        String(fps),
        "-i",
        "frame-%06d.png",
        "-r",
        String(fps),
        "-vf",
        filters.join(","),
        "../video.mp4",
      ],
      cwd: framesDir,
      stdout: "null",
      stderr: "piped",
    });
    const { code, stderr } = await command.output();
    if (code !== 0) {
      const message = new TextDecoder().decode(stderr).trim();
      console.warn("[gambit-demo] ffmpeg failed:", message || code);
    }
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) {
      console.warn("[gambit-demo] ffmpeg not found; keeping frame PNGs");
    } else {
      console.warn("[gambit-demo] ffmpeg failed:", error);
    }
  }
}

export async function trimMediaForAudioDelay(opts: {
  latestDir: string;
  trimMs: number;
  audioPath?: string | null;
}): Promise<void> {
  const { latestDir, trimMs, audioPath } = opts;
  const trimSeconds = (trimMs / 1000).toFixed(3);
  const videoPath = path.join(latestDir, "video.mp4");
  const trimmedVideoPath = path.join(latestDir, "video-trimmed.mp4");
  const hasVideo = await fileExists(videoPath);
  if (!hasVideo) return;

  try {
    const args = [
      "-y",
      "-ss",
      trimSeconds,
      "-i",
      videoPath,
      "-c:v",
      "copy",
      "-an",
      trimmedVideoPath,
    ];
    const { code, stderr } = await new Deno.Command("ffmpeg", {
      args,
      stdout: "null",
      stderr: "piped",
    }).output();
    if (code !== 0) {
      const message = new TextDecoder().decode(stderr).trim();
      console.warn("[gambit-demo] video trim failed:", message || code);
      return;
    }
  } catch (error) {
    console.warn("[gambit-demo] video trim failed:", error);
    return;
  }

  let trimmedAudioPath: string | null = null;
  if (audioPath && await fileExists(audioPath)) {
    const ext = path.extname(audioPath) || ".webm";
    trimmedAudioPath = path.join(latestDir, `audio-trimmed${ext}`);
    try {
      const args = [
        "-y",
        "-ss",
        trimSeconds,
        "-i",
        audioPath,
        "-c:a",
        "copy",
        trimmedAudioPath,
      ];
      const { code, stderr } = await new Deno.Command("ffmpeg", {
        args,
        stdout: "null",
        stderr: "piped",
      }).output();
      if (code !== 0) {
        const message = new TextDecoder().decode(stderr).trim();
        console.warn("[gambit-demo] audio trim failed:", message || code);
        trimmedAudioPath = null;
      }
    } catch (error) {
      console.warn("[gambit-demo] audio trim failed:", error);
      trimmedAudioPath = null;
    }
  }

  if (trimmedAudioPath) {
    const muxedPath = path.join(latestDir, "video-with-audio-trimmed.mp4");
    try {
      const args = [
        "-y",
        "-i",
        trimmedVideoPath,
        "-i",
        trimmedAudioPath,
        "-c:v",
        "copy",
        "-c:a",
        "aac",
        "-shortest",
        muxedPath,
      ];
      const { code, stderr } = await new Deno.Command("ffmpeg", {
        args,
        stdout: "null",
        stderr: "piped",
      }).output();
      if (code !== 0) {
        const message = new TextDecoder().decode(stderr).trim();
        console.warn("[gambit-demo] trimmed mux failed:", message || code);
      }
    } catch (error) {
      console.warn("[gambit-demo] trimmed mux failed:", error);
    }
  }
}
