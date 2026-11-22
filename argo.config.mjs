import { readFileSync } from 'node:fs';
import { defineConfig, engines } from '@argo-video/cli';

/**
 * Argo tutorial videos for Prompt Studio. Record against the standalone server (`bun run demo:serve`):
 *
 *   bun run demo:serve                                   # terminal 1: built app on 127.0.0.1:5273, empty profile
 *   bun run demo -- getting-started                      # terminal 2: local Kokoro voice (free, for review)
 *   ARGO_TTS=elevenlabs bun run demo -- getting-started  # publish render; needs ELEVENLABS_API_KEY
 *
 * `bun run demo:take -- <demo>` does both steps in one command (fresh server, then the pipeline).
 * Output: .output/argo-videos/<demo>/<local|youtube>/. The demo is `ARGO_DEMO` (set by demo:take) or the
 * demo name on the argo command line; the ElevenLabs directions come from that demo's scenes manifest.
 */
const youtube = process.env.ARGO_TTS === 'elevenlabs';
const ARGO_COMMANDS = new Set(['pipeline', 'record', 'export', 'validate', 'tts', 'clip', 'release-prep', 'preview']);
const demo = process.env.ARGO_DEMO ?? demoFromArgs(process.argv.slice(2)) ?? 'getting-started';

/** The first positional argument after the argo command, skipping options (`argo pipeline <demo>`). */
function demoFromArgs(args) {
  const command = args.findIndex((arg) => ARGO_COMMANDS.has(arg));
  if (command < 0) return undefined;
  return args.slice(command + 1).find((arg) => /^[a-z0-9][a-z0-9-]*$/.test(arg) && arg !== 'generate');
}

/** Per-scene Eleven v3 audio tags from the scenes manifest (`elevenLabsDirection`), default `[calm]`. */
function directedElevenLabs() {
  const engine = engines.elevenlabs({ model: 'eleven_v3' });
  const directions = new Map();
  return {
    generate: (text, options) => {
      if (directions.size === 0) {
        const scenes = JSON.parse(readFileSync(new URL(`./demos/${demo}.scenes.json`, import.meta.url), 'utf8'));
        for (const scene of scenes) if (scene.text) directions.set(scene.text, scene.elevenLabsDirection);
      }
      return engine.generate(`${directions.get(text) ?? '[calm]'} ${text}`, options);
    },
    describe: () => ({ ...engine.describe?.(), instructions: 'per-scene Eleven v3 audio tags' }),
  };
}

export default defineConfig({
  baseURL: process.env.ARGO_BASE_URL ?? 'http://127.0.0.1:5273',
  demosDir: 'demos',
  outputDir: `.output/argo-videos/${demo}/${youtube ? 'youtube' : 'local'}`,
  tts: youtube
    ? { engine: directedElevenLabs(), defaultVoice: '3TStB8f3X3To0Uj5R7RK', defaultSpeed: 1.1, transcribe: true }
    : { engine: engines.kokoro(), defaultVoice: 'af_heart', defaultSpeed: 1.05 },
  video: {
    width: 1920,
    height: 1080,
    fps: 30,
    browser: 'chromium',
    captureMode: 'jpeg-stitch',
    deviceScaleFactor: 2,
  },
  export: {
    preset: 'slow',
    crf: 16,
    encoder: youtube ? 'cpu' : 'gpu',
    sharpen: { strength: 0.35 },
    transition: { type: 'dissolve', durationMs: 350 },
    speedRamp: { gapSpeed: 3, minGapMs: 700 },
    audio: { loudnorm: true },
  },
  overlays: { autoBackground: true },
});
