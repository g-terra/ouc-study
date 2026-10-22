#!/usr/bin/env node
// Stands in for ffmpeg: writes the last argument (the output) at a size set by FAKE_FFMPEG_BYTES,
// fails with FAKE_FFMPEG_FAIL=1 (or for the codec named in it), and logs each run to FAKE_FFMPEG_LOG.
import { appendFileSync, writeFileSync } from "node:fs";
const args = process.argv.slice(2);
if (process.env.FAKE_FFMPEG_LOG) appendFileSync(process.env.FAKE_FFMPEG_LOG, `${args.join(" ")}\n`);
const fail = process.env.FAKE_FFMPEG_FAIL;
if (fail === "1" || (fail && args.includes(fail))) { console.error("Unknown encoder"); process.exit(1); }
writeFileSync(args[args.length - 1], Buffer.alloc(Number(process.env.FAKE_FFMPEG_BYTES ?? 10), 1));
