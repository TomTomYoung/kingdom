# AIMusic PCM engine

Source: TomTomYoung/AIMusic, commit 399fe1351368755f116512a459c95ecf555c5cba.

`core.mjs` and `audio.mjs` are unchanged copies of that commit. Git blob hashes are pinned in `tools/assets/tool-lock.json` and checked by `tools/assets/build-audio-fallback.mjs`. These are the same score validation and deterministic synthesizer that produced the original Kingdom audio deliveries.

This dependency is bundled locally so recovery from WAV/Ogg fetch or decode failures does not require a second audio download or an external service. Editable scores remain under assets/audio. Rebuild the generated score bank when adopting a new score; do not hand edit scores.js or vendor files.
