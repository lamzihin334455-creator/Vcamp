# Test fixture provenance

These fixtures exercise local parsing, storage, media capture, and UI behavior.
They are not evidence of current external API behavior or paid model quality.

## Synthetic text and JSON

The `vision-*.json` and `review-excess-proposals*.json` fixtures contain
self-authored geometric-card descriptions, synthetic subtitles, and pseudonymous
source identifiers. The historical filenames containing `real`, and the stored
wire-format shapes, remain for regression-test continuity. They do **not** mean
that the current files contain a real video transcript or a live model response.

The release cleanup replaced all narrative text from earlier captured requests
and replies, including a complete external-video subtitle sequence. Structural
fields, enum values, cue indices, timing boundaries, and deliberately invalid
references remain to preserve the parser failure cases. No video frames, image
data URLs, user cookies, API keys, or account credentials are included in these
JSON fixtures. The context includes 266 synthetic cues over a 582-second test
timeline; no external media is needed to run the unit tests.

Other fixtures use local fake identifiers such as `BVlegacy`, `BVt05A`, and
`BVcoverFixture`. `png.ts` generates a local image. `t16-tls.py` generates a new,
short-lived test certificate and key under `.tmp`; generated certificates,
keys, browser profiles, and network logs must stay outside a source release.

## MP4 files

All five checked-in MP4 files were inspected with FFprobe and decoded into
one-frame-per-second contact sheets on 2026-10-23. They contain one H.264 video
stream and no audio, person, screen recording, or third-party video imagery:

| File | Duration | Resolution | Observed content |
| --- | ---: | --- | --- |
| `t02-synthetic.mp4` | 8 s | 160×90 | Solid red |
| `t16-original.mp4` | 8 s | 320×180 | Red, green, blue, yellow stages |
| `t16-other.mp4` | 8 s | 320×180 | Solid gray |
| `two-settings-quality.mp4` | 8 s | 640×360 | Two colored grids with white bars |
| `visual-proposals.mp4` | 4 s | 320×180 | Synthetic color bars and moving test patterns |

Their container encoder tag is `Lavf62.12.102`. The original generation command
was not retained; decoded content establishes that these are synthetic test
patterns, not their exact historical authoring command. The source release
retains the existing bytes, so media-quality and packet-offset tests keep their
original regression inputs.

`rebuild-media.mjs` uses only FFmpeg built-in colors, grids, boxes, and `testsrc2`.
It makes semantically equivalent fixtures in a **new directory**, without
downloading content or overwriting the originals:

```sh
node tests/fixtures/rebuild-media.mjs
# Optional: node tests/fixtures/rebuild-media.mjs /absolute/new/output-directory
```

FFmpeg with `libx264` must be installed; `FFMPEG` may point to its executable.
These commands do not promise identical pixels or bytes. FFmpeg versions and
encoding settings may change quality metrics and file layout. The script writes
matching `t16-packets.json` offsets for its newly generated fragmented MP4;
never use old offsets with replacement media. A replacement requires rerunning
the affected media tests before changing the checked-in files.

SHA-256 of the inspected originals:

```text
1bc77d0472cb9b11c66fab9811a47f939686f71eac49216b5fc8a2fc9bbdd372  t02-synthetic.mp4
d9c5179fb431cf65673377daef124292990f1b18995eaebcdb7465359fcf82c8  t16-original.mp4
901b329ee7c1dc08439d594da98fb8405d8f6b39d05ddd5a72659b548b023091a  t16-other.mp4
28efee5de4525952cf76cd6b837323aa2f4b24338258837cab2b7892faf3d2fc  two-settings-quality.mp4
8ef1e5c760c1760914288d428d305ddda544cc50b44d6c0a525916a625998e77  visual-proposals.mp4
```
