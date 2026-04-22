import { readFile, writeFile } from "fs/promises";
import { join, dirname, basename } from "path";
import { execFile } from "child_process";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

interface TranscriptionSegment {
  start: number;
  end: number;
  text: string;
}

interface TranscriptionResult {
  segments: TranscriptionSegment[];
  srtContent: string;
  srtPath: string;
  fullText: string;
  duration: number;
}

/**
 * Transcribe audio file using OpenAI Whisper API and generate SRT captions.
 */
export async function transcribeAudio(
  audioPath: string
): Promise<TranscriptionResult> {
  const { default: OpenAI } = await import("openai");
  const openai = new OpenAI();

  const audioBuffer = await readFile(audioPath);
  const audioFile = new File(
    [audioBuffer],
    basename(audioPath),
    { type: "audio/mp3" }
  );

  const response = await openai.audio.transcriptions.create({
    file: audioFile,
    model: "whisper-1",
    response_format: "verbose_json",
    timestamp_granularities: ["segment"],
  });

  const segments: TranscriptionSegment[] = (
    response as unknown as {
      segments: Array<{ start: number; end: number; text: string }>;
    }
  ).segments.map((s) => ({
    start: s.start,
    end: s.end,
    text: s.text.trim(),
  }));

  const srtContent = segmentsToSRT(segments);
  const srtPath = join(
    dirname(audioPath),
    basename(audioPath, ".mp3") + ".srt"
  );
  await writeFile(srtPath, srtContent);

  const fullText = segments.map((s) => s.text).join(" ");
  const duration =
    segments.length > 0 ? segments[segments.length - 1].end : 0;

  return { segments, srtContent, srtPath, fullText, duration };
}

/**
 * Convert transcription segments to SRT format.
 */
function segmentsToSRT(segments: TranscriptionSegment[]): string {
  return segments
    .map((seg, i) => {
      const startTime = formatSRTTime(seg.start);
      const endTime = formatSRTTime(seg.end);
      return `${i + 1}\n${startTime} --> ${endTime}\n${seg.text}\n`;
    })
    .join("\n");
}

/**
 * Format seconds to SRT timestamp: HH:MM:SS,mmm
 */
function formatSRTTime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  const ms = Math.round((seconds % 1) * 1000);
  return `${pad(h)}:${pad(m)}:${pad(s)},${pad(ms, 3)}`;
}

function pad(n: number, width = 2): string {
  return String(n).padStart(width, "0");
}

/**
 * Get audio duration using ffprobe.
 */
export async function getAudioDuration(filePath: string): Promise<number> {
  const { stdout } = await execFileAsync("ffprobe", [
    "-v",
    "quiet",
    "-show_entries",
    "format=duration",
    "-of",
    "csv=p=0",
    filePath,
  ]);
  return parseFloat(stdout.trim());
}

/**
 * Get video duration using ffprobe.
 */
export async function getVideoDuration(filePath: string): Promise<number> {
  const { stdout } = await execFileAsync("ffprobe", [
    "-v",
    "quiet",
    "-show_entries",
    "format=duration",
    "-of",
    "csv=p=0",
    filePath,
  ]);
  return parseFloat(stdout.trim());
}

/**
 * Get video resolution using ffprobe.
 */
export async function getVideoResolution(
  filePath: string
): Promise<{ width: number; height: number }> {
  const { stdout } = await execFileAsync("ffprobe", [
    "-v",
    "quiet",
    "-select_streams",
    "v:0",
    "-show_entries",
    "stream=width,height",
    "-of",
    "csv=p=0",
    filePath,
  ]);
  const [width, height] = stdout.trim().split(",").map(Number);
  return { width, height };
}
