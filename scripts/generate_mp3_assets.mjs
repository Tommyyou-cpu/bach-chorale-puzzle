import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Mp3Encoder } from "@breezystack/lamejs";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const MUSIC_DIR = path.join(ROOT, "public", "music");
const BIT_RATE_KBPS = 96;

function readPcm16Mono(filePath) {
  const input = fs.readFileSync(filePath);
  if (input.toString("ascii", 0, 4) !== "RIFF" || input.toString("ascii", 8, 12) !== "WAVE") {
    throw new Error(`不是有效的 WAV 文件：${filePath}`);
  }

  let offset = 12;
  let format;
  let pcm;
  while (offset + 8 <= input.length) {
    const id = input.toString("ascii", offset, offset + 4);
    const size = input.readUInt32LE(offset + 4);
    const start = offset + 8;
    if (id === "fmt ") {
      format = {
        audioFormat: input.readUInt16LE(start),
        channels: input.readUInt16LE(start + 2),
        sampleRate: input.readUInt32LE(start + 4),
        bitsPerSample: input.readUInt16LE(start + 14),
      };
    } else if (id === "data") {
      pcm = input.subarray(start, start + size);
    }
    offset = start + size + (size % 2);
  }

  if (!format || !pcm || format.audioFormat !== 1 || format.channels !== 1 || format.bitsPerSample !== 16) {
    throw new Error(`只支持单声道 16 位 PCM WAV：${filePath}`);
  }
  return {
    sampleRate: format.sampleRate,
    samples: new Int16Array(pcm.buffer, pcm.byteOffset, Math.floor(pcm.byteLength / 2)),
  };
}

function encodeMp3(wavPath, mp3Path) {
  const { sampleRate, samples } = readPcm16Mono(wavPath);
  const encoder = new Mp3Encoder(1, sampleRate, BIT_RATE_KBPS);
  const chunks = [];
  const blockSize = 1152;
  for (let offset = 0; offset < samples.length; offset += blockSize) {
    const encoded = encoder.encodeBuffer(samples.subarray(offset, offset + blockSize));
    if (encoded.length > 0) chunks.push(Buffer.from(encoded));
  }
  const tail = encoder.flush();
  if (tail.length > 0) chunks.push(Buffer.from(tail));
  const output = Buffer.concat(chunks);
  if (output.length === 0) throw new Error(`MP3 编码结果为空：${wavPath}`);
  fs.writeFileSync(mp3Path, output);
}

const wavFiles = [];
for (const question of fs.readdirSync(MUSIC_DIR, { withFileTypes: true })) {
  if (!question.isDirectory()) continue;
  const directory = path.join(MUSIC_DIR, question.name);
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (entry.isFile() && entry.name.endsWith(".wav")) wavFiles.push(path.join(directory, entry.name));
  }
}

for (const wavPath of wavFiles.sort()) {
  const mp3Path = wavPath.replace(/\.wav$/, ".mp3");
  const sourceStat = fs.statSync(wavPath);
  const currentStat = fs.existsSync(mp3Path) ? fs.statSync(mp3Path) : null;
  if (currentStat && currentStat.size > 0 && currentStat.mtimeMs >= sourceStat.mtimeMs) continue;
  encodeMp3(wavPath, mp3Path);
}

console.log(JSON.stringify({ mp3Files: wavFiles.length, bitRateKbps: BIT_RATE_KBPS }, null, 2));
