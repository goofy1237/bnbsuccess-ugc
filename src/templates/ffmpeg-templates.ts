/**
 * ffmpeg assembly templates for different ad structures.
 * Each template defines B-roll timing, caption styling, and audio mixing.
 */

export interface FFmpegTemplate {
  name: string;
  structure: string;
  brollTimings: Array<{
    label: string;
    startSec: number;
    endSec: number;
  }>;
  captionStyle: string;
  musicVolume: string; // dB relative to voice
  targetDuration: number;
}

export const CAPTION_STYLE =
  "FontSize=22,FontName=Arial,PrimaryColour=&Hffffff,OutlineColour=&H000000,BorderStyle=3,Outline=2,Shadow=0,MarginV=80";

export const TEMPLATES: Record<string, FFmpegTemplate> = {
  testimonial_30s: {
    name: "testimonial_30s",
    structure: "Hook > Problem > Pivot > Proof > CTA",
    brollTimings: [
      { label: "proof", startSec: 12, endSec: 22 },
    ],
    captionStyle: CAPTION_STYLE,
    musicVolume: "-24dB",
    targetDuration: 30,
  },

  result_first_15s: {
    name: "result_first_15s",
    structure: "Result > How > CTA",
    brollTimings: [
      { label: "result", startSec: 0, endSec: 5 },
    ],
    captionStyle: CAPTION_STYLE,
    musicVolume: "-24dB",
    targetDuration: 15,
  },

  storytime_45s: {
    name: "storytime_45s",
    structure: "Hook > Story > Lesson > Offer > CTA",
    brollTimings: [
      { label: "story_midpoint", startSec: 15, endSec: 20 },
      { label: "offer", startSec: 30, endSec: 38 },
    ],
    captionStyle: CAPTION_STYLE,
    musicVolume: "-24dB",
    targetDuration: 45,
  },

  listicle_30s: {
    name: "listicle_30s",
    structure: "Hook > Point 1 > Point 2 > Point 3 > CTA",
    brollTimings: [
      { label: "point1", startSec: 5, endSec: 10 },
      { label: "point2", startSec: 12, endSec: 17 },
      { label: "point3", startSec: 19, endSec: 24 },
    ],
    captionStyle: CAPTION_STYLE,
    musicVolume: "-24dB",
    targetDuration: 30,
  },
};

export type AspectRatio = "9:16" | "1:1" | "16:9";

export const ASPECT_CONFIGS: Record<
  AspectRatio,
  { width: number; height: number; platform: string }
> = {
  "9:16": { width: 1080, height: 1920, platform: "TikTok/Reels" },
  "1:1": { width: 1080, height: 1080, platform: "Feed" },
  "16:9": { width: 1920, height: 1080, platform: "YouTube" },
};

/**
 * Build the ffmpeg command for assembling a finished ad.
 */
export function buildAssemblyCommand(params: {
  talkingHeadPath: string;
  brollPaths: string[];
  musicPath: string;
  captionSrtPath: string;
  outputPath: string;
  template: FFmpegTemplate;
  aspectRatio: AspectRatio;
}): string {
  const { talkingHeadPath, brollPaths, musicPath, captionSrtPath, outputPath, template, aspectRatio } = params;
  const aspect = ASPECT_CONFIGS[aspectRatio];

  // Build input list
  const inputs = [
    `-i "${talkingHeadPath}"`,
    ...brollPaths.map((p) => `-i "${p}"`),
    `-i "${musicPath}"`,
  ];

  // Scale the main video
  let filterComplex = `[0:v]scale=${aspect.width}:${aspect.height}:force_original_aspect_ratio=decrease,pad=${aspect.width}:${aspect.height}:(ow-iw)/2:(oh-ih)/2[main]`;

  // Scale and overlay each B-roll at its timed position
  let currentVideo = "main";
  template.brollTimings.forEach((timing, i) => {
    if (i < brollPaths.length) {
      const brollIdx = i + 1; // input index (0 is talking head)
      const outLabel = `v${i}`;
      filterComplex += `;[${brollIdx}:v]scale=${aspect.width}:${aspect.height}:force_original_aspect_ratio=decrease,pad=${aspect.width}:${aspect.height}:(ow-iw)/2:(oh-ih)/2[broll${i}]`;
      filterComplex += `;[${currentVideo}][broll${i}]overlay=enable='between(t,${timing.startSec},${timing.endSec})'[${outLabel}]`;
      currentVideo = outLabel;
    }
  });

  // Add subtitles into the filter_complex chain (cannot use separate -vf)
  const subtitled = `${currentVideo}sub`;
  filterComplex += `;[${currentVideo}]subtitles=${captionSrtPath}:force_style='${template.captionStyle}'[${subtitled}]`;
  currentVideo = subtitled;

  // Mix audio: voice from talking head + background music at specified volume
  const musicIdx = brollPaths.length + 1;
  const musicVol = template.musicVolume === "-24dB" ? "0.06" : "0.15";
  filterComplex += `;[0:a]volume=1.0[voice];[${musicIdx}:a]volume=${musicVol}[bgm];[voice][bgm]amix=inputs=2:duration=first:dropout_transition=3[audio]`;

  // Build full command
  const cmd = [
    "ffmpeg -y",
    ...inputs,
    `-filter_complex "${filterComplex}"`,
    `-map "[${currentVideo}]"`,
    `-map "[audio]"`,
    `-c:v libx264 -preset fast -crf 23`,
    `-c:a aac -b:a 128k`,
    `-t ${template.targetDuration}`,
    `"${outputPath}"`,
  ].join(" \\\n  ");

  return cmd;
}

/**
 * Build QA check commands for a finished video.
 */
export function buildQACommands(videoPath: string): {
  loudness: string;
  duration: string;
  resolution: string;
} {
  return {
    loudness: `ffmpeg -i "${videoPath}" -af loudnorm=print_format=json -f null - 2>&1 | grep -A 20 "input_"`,
    duration: `ffprobe -v quiet -show_entries format=duration -of csv=p=0 "${videoPath}"`,
    resolution: `ffprobe -v quiet -select_streams v:0 -show_entries stream=width,height -of csv=p=0 "${videoPath}"`,
  };
}
