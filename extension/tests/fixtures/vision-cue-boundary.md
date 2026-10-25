# Nine-reference planning reproduction

`vision-plan-nine-cues.json` is the complete model response supplied by the user on 2026-10-25. Its fifth evidence item's window references nine cue IDs. The original subtitles and frames were not provided. Tests use 200 synthetic subtitle cues and the 407-second black, silent `vision-407-synthetic.mp4`; they do not reconstruct the original transcript or verify the factual claims in the model response.

The MP4 is 64 × 36, 1 fps, generated locally using FFmpeg color input, libx264 ultrafast CRF 45, GOP 10, and faststart. It supplies a real playable timeline for seek/capture tests. No native duration or currentTime getter is overridden.
