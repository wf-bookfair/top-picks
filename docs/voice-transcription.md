# On-device book-title dictation (archived)

This document records how the press-and-hold voice entry for book titles worked, so it can be
restored or reused later. The feature was removed from the live page to keep the interface simple
for young children. Typing a title is still supported.

- Last commit that contains the feature: `586c787` ("Move Sheet endpoint to standalone Apps Script project").
- Files involved at that commit: `index.html`, `app.js`, `styles.css`, `voice-worker.js`.
- Restore everything with `git checkout 586c787 -- index.html app.js styles.css voice-worker.js`,
  then re-apply any later changes made to those files (for example the 15-character first-name limit).

## Goals and constraints

1. **Private:** recorded audio must never leave the device. It is not sent to the Apps Script
   endpoint, Google Sheets, or any speech service.
2. **No server:** the site is static (GitHub Pages), so recognition runs in the browser.
3. **Cross-browser:** Safari and Chrome on iPhone, iPad and Mac, plus desktop Chrome.
4. **Child-friendly:** one large press-and-hold button, visible feedback while processing, and an
   editable result before anything is added to the list.
5. **Not saved:** the recording is held only in memory and wiped as soon as it is transcribed.

### Why not the Web Speech API

`SpeechRecognition` / `webkitSpeechRecognition` is easier, but Safari and Chrome may send the audio
to Apple or Google servers for recognition, and support differs across browsers. That breaks the
privacy rule, so an open-source model running locally was used instead.

## Architecture

```
[Hold button] -> getUserMedia (mic) -> MediaRecorder (compressed chunks in memory)
      |
[Release] -> stop mic tracks -> Blob -> AudioContext.decodeAudioData -> mono Float32Array
      |                                -> OfflineAudioContext resample to 16 kHz
      v
worker.postMessage({ type: "transcribe", audio }, [audio.buffer])   (transferred, not copied)
      |
voice-worker.js (module Web Worker)
  Transformers.js pipeline("automatic-speech-recognition", "onnx-community/whisper-base.en", q8)
      |
  { type: "result", text }  -> title box (editable)      finally: audio.fill(0)
```

### Libraries and model

| Item | Value |
|---|---|
| Runtime | `@huggingface/transformers@3.8.1`, imported as an ES module from jsDelivr inside the worker |
| Model | `onnx-community/whisper-base.en` (English-only Whisper Base, ONNX) |
| Weights | `dtype: "q8"` (8-bit quantized), about 77 MB download |
| Backend | Transformers.js picks WASM (or WebGPU where available) automatically |
| Caching | `env.useBrowserCache = true`: model files go into browser Cache Storage after the first download; `env.allowLocalModels = false` |

English-only models reject `language` and `task` options
("Cannot specify task or language for an English-only model"), so the worker passes only
`chunk_length_s: 15` and `stride_length_s: 2`.

### Model choice

Compared on 8 book titles spoken by a computer voice, both clean and mixed with background
chatter (a rough stand-in for a busy book fair, not real children):

| Model | Download | Noisy titles right | Time per title (desktop) |
|---|---|---|---|
| Whisper Tiny English | 41 MB | 3 of 8 | about 1.2 s |
| Whisper Base English (chosen) | 77 MB | 5 of 8 | about 2.7 s |
| Whisper Small English | 249 MB | 6 of 8 | about 9 s |

Base was the compromise between accuracy and download size and speed on school iPads. It was
never benchmarked on a physical iPhone or iPad or with real child voices; expect slower times on
tablets. The biggest accuracy improvement not built yet: fuzzy-match the transcript against the
fair's book list, still on the device.

## Step-by-step flow

1. **Background preload.** After the `load` event, `preloadVoiceModel()` creates the worker and
   posts `{ type: "preload" }`. The page renders immediately; the model downloads (first visit)
   or loads from cache (later visits) in the background. Trade-off: every visit loads the model
   into memory even if voice is never used.
2. **Press.** `pointerdown` on the button (or Space/Enter keydown) calls `startVoiceCapture`.
   It requests the microphone with `echoCancellation`, `noiseSuppression` and `autoGainControl`
   enabled. If the child lets go before permission is granted, the stream is stopped right away.
3. **Record.** `MediaRecorder` uses the first supported type of `audio/webm;codecs=opus`,
   `audio/mp4` (Safari) or `audio/webm`. Chunks are kept in an in-memory array. The button turns
   red and reads "Listening… release when done".
4. **Release.** `pointerup`/`pointercancel` are listened for on `window`, so sliding a finger off
   the button still stops recording. The recorder stops, every mic track is stopped (the
   microphone indicator turns off), and three animated dots appear inside the title box.
5. **Decode.** The chunks become a `Blob`, the chunk array is emptied, and `decodeVoiceAudio`
   decodes it with `AudioContext.decodeAudioData`, mixes all channels to mono, and resamples to
   16 kHz with an `OfflineAudioContext` (Whisper expects 16 kHz mono `Float32Array`). Each
   intermediate buffer is overwritten with zeros right after use.
6. **Transcribe.** The final `Float32Array` is posted to the worker as a transferable, so the main
   thread no longer holds it. The worker runs the pipeline and posts `{ type: "result", text }`.
   In `finally` it runs `data.audio.fill(0)` and drops the reference, whether recognition
   succeeded or failed.
7. **Show result.** Surrounding quotes, spaces and a trailing period are trimmed. The dots are
   replaced by the title, which stays editable; nothing is added until the child taps Add book.
   If nothing was heard, the box goes back to its previous text and a short error is shown.

## Privacy details (verified on a desktop browser)

- A network log taken while recording and transcribing (fake microphone) showed only GET downloads
  of the model and the Transformers.js runtime. No request carried audio, and none went to the
  Sheet endpoint or a speech service.
- Afterwards, browser storage held only the model files in Cache Storage: no recording, nothing in
  localStorage, IndexedDB or cookies.
- Limits: the compressed `Blob` cannot be overwritten from JavaScript. Its references are released
  so the browser frees it, but when that memory is reused is up to the browser. Nothing is written
  to disk. The model CDN sees the device IP address when downloading, never audio.

## UI pieces

- Divider text "or type or say the title"; placeholder "Type or say the book title".
- Full-width title box with an × clear button outside it on the right.
- Row below: mic button ("Hold to say the book title", mic SVG icon), with Add book on its right.
- Status line under the row: blank by default; shows loading progress, "Processing on this
  device…" or errors.
- The button uses `touch-action: none` and `user-select: none` so press-and-hold works on iOS
  without scrolling or selecting text.

## Known issues and testing gaps

- Not tested on a physical iPhone or iPad, or with real child speech in a noisy room.
- Safari needs a user gesture for the microphone, so the first press may only show the permission
  prompt and the child has to press again.
- First use on a slow network waits for the 77 MB download; progress shows in the status line.

## Source at commit 586c787

### `voice-worker.js`

```js
import { env, pipeline } from "https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.8.1";

env.allowLocalModels = false;
env.useBrowserCache = true;

let transcriberPromise;

function getTranscriber() {
  if (!transcriberPromise) {
    self.postMessage({ type: "progress", message: "Loading the private speech model…" });
    transcriberPromise = pipeline(
      "automatic-speech-recognition",
      "onnx-community/whisper-base.en",
      {
        dtype: "q8",
        progress_callback(progress) {
          if (progress.status === "progress" && Number.isFinite(progress.progress)) {
            self.postMessage({
              type: "progress",
              message: `Loading speech model… ${Math.round(progress.progress)}%`,
            });
          }
        },
      }
    );
  }
  return transcriberPromise;
}

self.addEventListener("message", async ({ data }) => {
  if (data.type === "preload") {
    getTranscriber().catch((error) => {
      console.error(error);
      transcriberPromise = null;
    });
    return;
  }
  if (data.type !== "transcribe") return;
  try {
    const transcriber = await getTranscriber();
    self.postMessage({ type: "progress", message: "Recognizing the title on this device…" });
    const result = await transcriber(data.audio, {
      chunk_length_s: 15,
      stride_length_s: 2,
    });
    self.postMessage({ type: "result", text: result.text || "" });
  } catch (error) {
    console.error(error);
    transcriberPromise = null;
    self.postMessage({ type: "error" });
  } finally {
    data.audio?.fill(0);
    data.audio = null;
  }
});
```

### `app.js` event wiring

```js
elements.voiceButton.addEventListener("pointerdown", startVoiceCapture);
window.addEventListener("pointerup", stopVoiceCapture);
window.addEventListener("pointercancel", stopVoiceCapture);
elements.voiceButton.addEventListener("keydown", handleVoiceKeyDown);
elements.voiceButton.addEventListener("keyup", handleVoiceKeyUp);
window.addEventListener("load", () => setTimeout(preloadVoiceModel, 0), { once: true });
```

### `app.js` capture, decoding and worker handling

The `state` object also had `voiceWorker`, `voiceStream`, `voiceRecorder`, `voiceChunks`,
`voicePressed`, `recordingVoice` and `transcribingVoice`; `elements` had `titleField`,
`voiceButton`, `voiceLabel` and `voiceStatus`; and `resetForNextStudent` called `setVoiceStatus("")`.

```js
function handleVoiceKeyDown(event) {
  if ((event.key === " " || event.key === "Enter") && !event.repeat) {
    event.preventDefault();
    startVoiceCapture(event);
  }
}

function handleVoiceKeyUp(event) {
  if (event.key === " " || event.key === "Enter") {
    event.preventDefault();
    stopVoiceCapture();
  }
}

async function startVoiceCapture(event) {
  event.preventDefault();
  if (state.recordingVoice || state.transcribingVoice) return;
  if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
    setVoiceStatus("Voice entry is not supported by this browser.", true);
    return;
  }

  state.voicePressed = true;
  ensureVoiceWorker();
  setVoiceStatus("Allow microphone access, then hold the button again.");

  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
      video: false,
    });
    if (!state.voicePressed) {
      stream.getTracks().forEach((track) => track.stop());
      setVoiceStatus("Hold the button while saying the book title.");
      return;
    }

    const mimeType = ["audio/webm;codecs=opus", "audio/mp4", "audio/webm"].find((type) =>
      MediaRecorder.isTypeSupported(type)
    );
    state.voiceStream = stream;
    state.voiceChunks = [];
    state.voiceRecorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
    state.voiceRecorder.addEventListener("dataavailable", (voiceEvent) => {
      if (voiceEvent.data.size) state.voiceChunks.push(voiceEvent.data);
    });
    state.voiceRecorder.addEventListener("stop", transcribeVoiceCapture, { once: true });
    state.voiceRecorder.start();
    state.recordingVoice = true;
    elements.voiceButton.classList.add("recording");
    elements.voiceLabel.textContent = "Listening… release when done";
    setVoiceStatus("Say only the book title.");
  } catch (error) {
    console.error(error);
    state.voicePressed = false;
    setVoiceStatus("Microphone access was not available.", true);
  }
}

function stopVoiceCapture() {
  state.voicePressed = false;
  if (!state.recordingVoice || state.voiceRecorder?.state !== "recording") return;
  state.recordingVoice = false;
  state.voiceRecorder.stop();
  state.voiceStream?.getTracks().forEach((track) => track.stop());
  state.voiceStream = null;
  elements.voiceButton.classList.remove("recording");
  elements.voiceLabel.textContent = "Hold to say the book title";
  setVoiceStatus("Processing on this device…");
  showTypingDots(true);
}

async function transcribeVoiceCapture() {
  const chunks = state.voiceChunks;
  const mimeType = state.voiceRecorder?.mimeType;
  state.voiceChunks = [];
  state.voiceRecorder = null;
  if (!chunks.length) {
    showTypingDots(false);
    setVoiceStatus("No audio was recorded. Hold the button and try again.", true);
    return;
  }

  state.transcribingVoice = true;
  elements.voiceButton.disabled = true;
  try {
    let blob = new Blob(chunks, { type: mimeType });
    chunks.length = 0;
    const audio = await decodeVoiceAudio(blob);
    blob = null;
    ensureVoiceWorker().postMessage({ type: "transcribe", audio }, [audio.buffer]);
  } catch (error) {
    console.error(error);
    finishVoiceTranscription("The recording could not be processed.", true);
  }
}

async function decodeVoiceAudio(blob) {
  const context = new AudioContext();
  const decoded = await context.decodeAudioData(await blob.arrayBuffer());
  const mono = new Float32Array(decoded.length);
  for (let channel = 0; channel < decoded.numberOfChannels; channel += 1) {
    const data = decoded.getChannelData(channel);
    for (let index = 0; index < data.length; index += 1) {
      mono[index] += data[index] / decoded.numberOfChannels;
    }
    data.fill(0);
  }
  await context.close();
  if (decoded.sampleRate === 16000) return mono;

  const frames = Math.ceil(decoded.duration * 16000);
  const offline = new OfflineAudioContext(1, frames, 16000);
  const buffer = offline.createBuffer(1, mono.length, decoded.sampleRate);
  buffer.copyToChannel(mono, 0);
  mono.fill(0);
  const source = offline.createBufferSource();
  source.buffer = buffer;
  source.connect(offline.destination);
  source.start();
  const rendered = await offline.startRendering();
  buffer.getChannelData(0).fill(0);
  const resampled = new Float32Array(rendered.getChannelData(0));
  rendered.getChannelData(0).fill(0);
  return resampled;
}

function ensureVoiceWorker() {
  if (state.voiceWorker) return state.voiceWorker;
  state.voiceWorker = new Worker("voice-worker.js?v=5", { type: "module" });
  state.voiceWorker.addEventListener("message", ({ data }) => {
    if (data.type === "progress") {
      if (state.transcribingVoice) setVoiceStatus(data.message);
    } else if (data.type === "result") {
      const title = data.text.trim().replace(/^[“"' ]+|[”"' .]+$/g, "");
      if (title) {
        showTypingDots(false);
        elements.manualTitle.value = title;
        finishVoiceTranscription("");
      } else {
        finishVoiceTranscription("No title was heard. Try again closer to the microphone.", true);
      }
    } else if (data.type === "error") {
      finishVoiceTranscription("Voice entry could not load on this device.", true);
    }
  });
  state.voiceWorker.addEventListener("error", (error) => {
    console.error(error);
    state.voiceWorker.terminate();
    state.voiceWorker = null;
    if (state.transcribingVoice) {
      finishVoiceTranscription("Voice entry could not load on this device.", true);
    }
  });
  return state.voiceWorker;
}

function preloadVoiceModel() {
  if (!window.Worker || !navigator.mediaDevices?.getUserMedia) return;
  ensureVoiceWorker().postMessage({ type: "preload" });
}

function showTypingDots(visible) {
  if (visible) {
    state.titleBeforeVoice = elements.manualTitle.value;
    elements.manualTitle.value = "";
  } else if (elements.titleField.classList.contains("transcribing") && !elements.manualTitle.value) {
    elements.manualTitle.value = state.titleBeforeVoice || "";
  }
  elements.titleField.classList.toggle("transcribing", visible);
}

function finishVoiceTranscription(message, isError = false) {
  showTypingDots(false);
  state.transcribingVoice = false;
  elements.voiceButton.disabled = false;
  setVoiceStatus(message, isError);
}

function setVoiceStatus(message, isError = false) {
  elements.voiceStatus.textContent = message;
  elements.voiceStatus.classList.toggle("error", isError);
}
```

### `index.html` markup

```html
<p class="or-divider"><span>or type or say the title</span></p>
        <form id="manual-form" class="manual-form">
          <div class="manual-row">
            <div id="title-field" class="title-field">
              <input
                id="manual-title"
                aria-label="Book title"
                name="title"
                type="text"
                autocomplete="off"
                minlength="2"
                pattern=".{2,}"
                title="Enter at least 2 characters."
                placeholder="Type or say the book title"
                required
              />
              <span class="typing-dots" aria-hidden="true"><i></i><i></i><i></i></span>
            </div>
            <button id="clear-title" class="clear-title" type="button" aria-label="Clear title">×</button>
          </div>
          <div class="voice-row">
            <button id="voice-button" class="voice-button" type="button">
              <svg class="mic-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                <path d="M12 14a3 3 0 0 0 3-3V5a3 3 0 0 0-6 0v6a3 3 0 0 0 3 3Z" />
                <path d="M19 11a7 7 0 0 1-14 0M12 18v3M8 21h8" />
              </svg>
              <span id="voice-label">Hold to say the book title</span>
            </button>
            <button class="button button-secondary" type="submit">Add book</button>
          </div>
          <p id="voice-status" class="voice-status" role="status" aria-live="polite"></p>
        </form>
```

### `styles.css`

```css
.typing-dots {
  position: absolute;
  top: 50%;
  left: 0.85rem;
  display: none;
  gap: 0.3rem;
  transform: translateY(-50%);
  pointer-events: none;
}

.title-field.transcribing .typing-dots {
  display: flex;
}

.title-field.transcribing input::placeholder {
  color: transparent;
}

.typing-dots i {
  width: 0.45rem;
  height: 0.45rem;
  border-radius: 50%;
  background: #557064;
  opacity: 0.25;
  animation: typing-dot 1.2s infinite;
}

.typing-dots i:nth-child(2) {
  animation-delay: 0.2s;
}

.typing-dots i:nth-child(3) {
  animation-delay: 0.4s;
}

@keyframes typing-dot {
  0%,
  60%,
  100% {
    opacity: 0.25;
    transform: translateY(0);
  }
  30% {
    opacity: 1;
    transform: translateY(-0.2rem);
  }
}

.voice-row {
  display: flex;
  gap: 0.5rem;
  margin-top: 0.75rem;
}

.voice-row .button {
  flex: none;
  white-space: nowrap;
}

.voice-button {
  flex: 1;
  min-width: 0;
  padding: 0.85rem;
  border: 1px solid #557064;
  border-radius: 0.8rem;
  color: #294438;
  font: inherit;
  font-weight: 700;
  background: #edf4ef;
  cursor: pointer;
  touch-action: none;
  user-select: none;
}

.voice-button {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;
}

.mic-icon {
  width: 1.25rem;
  height: 1.25rem;
  flex: none;
  fill: none;
  stroke: currentColor;
  stroke-width: 2;
  stroke-linecap: round;
  stroke-linejoin: round;
}

.voice-button.recording {
  color: #fff;
  background: #9b3838;
  border-color: #9b3838;
}

.voice-button:disabled {
  cursor: wait;
  opacity: 0.7;
}

.voice-status {
  min-height: 1.3em;
  margin: 0.55rem 0 0;
  color: #53625a;
  font-size: 0.8rem;
}

.voice-status:empty {
  display: none;
}

.voice-status.error {
  color: #9b3838;
}
```
