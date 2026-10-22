/* =========================================================
   ALONTE DJ PRO v1.0
   Dual Deck DJ Engine
   Audio, BPM, Sync, EQ, Mixer, FX, Waveforms, Scratching
   ========================================================= */

"use strict";

/* ===================== GLOBAL VARIABLES ===================== */

let audioCtx = null;
let masterAnimationStarted = false;
let partialWaveformAnimationStarted = false;

const deckSources = {};
const deckAnalysers = {};
const deckGainNodes = {};
const deckCrossGains = {};
const deckFilters = {};
const deckEqualizerFilters = {};
const deckEffects = {};

const deckGainKnobValues = { A: 50, B: 50 };
const deckBaseLevels = { A: 80, B: 80 };

const overviewBuffers = { A: null, B: null };
const overviewColors = { A: "#2fd381", B: "#2196f3" };

const partialWaveforms = {
    A: { buffer: null, audioEl: null, canvas: null, ctx: null, color: "#00a3a3" },
    B: { buffer: null, audioEl: null, canvas: null, ctx: null, color: "#a30040" }
};

const eqFrequencies = [
    32, 64, 125, 250, 500,
    1000, 2000, 4000, 8000, 16000
];

const $ = id => document.getElementById(id);

const clamp = (value, min, max) =>
    Math.min(max, Math.max(min, value));

function setStatus(message) {
    const status = $("status");
    if (status) status.textContent = message;
}

/* ===================== AUDIO CONTEXT ===================== */

function ensureAudioContext() {
    if (audioCtx) return audioCtx;

    const AudioContextClass =
        window.AudioContext || window.webkitAudioContext;

    if (!AudioContextClass) {
        alert("Your browser does not support the Web Audio API.");
        return null;
    }

    audioCtx = new AudioContextClass();
    return audioCtx;
}

function applyChannelGain(deck) {
    if (!audioCtx || !deckGainNodes[deck]) return;

    const level = clamp(deckBaseLevels[deck] / 100, 0, 1);
    const knobGain = clamp(deckGainKnobValues[deck] / 50, 0, 2);

    deckGainNodes[deck].gain.setTargetAtTime(
        level * knobGain,
        audioCtx.currentTime,
        0.02
    );
}

function initAudioContext(deck) {
    const audio = $(`audio${deck}`);
    const context = ensureAudioContext();

    if (!audio || !context || deckSources[deck]) return;

    try {
        const source = context.createMediaElementSource(audio);

        const analyser = context.createAnalyser();
        analyser.fftSize = 2048;
        analyser.smoothingTimeConstant = 0.75;

        const low = context.createBiquadFilter();
        low.type = "lowshelf";
        low.frequency.value = 320;

        const mid = context.createBiquadFilter();
        mid.type = "peaking";
        mid.frequency.value = 1000;
        mid.Q.value = 1;

        const high = context.createBiquadFilter();
        high.type = "highshelf";
        high.frequency.value = 3200;

        const eqFilters = eqFrequencies.map((frequency, index) => {
            const filter = context.createBiquadFilter();

            if (index === 0) {
                filter.type = "lowshelf";
            } else if (index === eqFrequencies.length - 1) {
                filter.type = "highshelf";
            } else {
                filter.type = "peaking";
                filter.Q.value = 1;
            }

            filter.frequency.value = Math.min(
                frequency,
                context.sampleRate / 2 - 1
            );

            filter.gain.value = 0;
            return filter;
        });

        const channelGain = context.createGain();
        const eqMasterGain = context.createGain();
        const crossGain = context.createGain();

        const delay = context.createDelay(2);
        delay.delayTime.value = 0.30;

        const feedback = context.createGain();
        feedback.gain.value = 0;

        const wet = context.createGain();
        wet.gain.value = 0;

        deckSources[deck] = source;
        deckAnalysers[deck] = analyser;
        deckGainNodes[deck] = channelGain;
        deckCrossGains[deck] = crossGain;
        deckFilters[deck] = { low, mid, high };
        deckEqualizerFilters[deck] = eqFilters;

        deckEffects[deck] = {
            delay,
            feedback,
            wet,
            eqMasterGain
        };

        // Main audio path
        source.connect(analyser);
        analyser.connect(low);
        low.connect(mid);
        mid.connect(high);

        let previousNode = high;

        eqFilters.forEach(filter => {
            previousNode.connect(filter);
            previousNode = filter;
        });

        previousNode.connect(channelGain);
        channelGain.connect(eqMasterGain);
        eqMasterGain.connect(crossGain);
        crossGain.connect(context.destination);

        // Delay FX path
        previousNode.connect(delay);
        delay.connect(feedback);
        feedback.connect(delay);
        delay.connect(wet);
        wet.connect(channelGain);

        const levelSlider = $(`level${deck}`);

        if (levelSlider) {
            deckBaseLevels[deck] = clamp(
                Number(levelSlider.value),
                0,
                100
            );
        }

        applyChannelGain(deck);
        updateCrossfader();
        updateEqualizer();
        initializePartialWaveforms();

        setStatus(`Deck ${deck} audio engine ready.`);
    } catch (error) {
        console.error(`Deck ${deck} audio setup error:`, error);
        setStatus(`Deck ${deck} audio setup failed.`);
    }
}

/* ===================== CROSS FADER ===================== */

function updateCrossfader() {
    if (!audioCtx) return;

    const slider = $("crossfader");
    const position = slider
        ? clamp(Number(slider.value), 0, 100) / 100
        : 0.5;

    const gainA = Math.cos(position * Math.PI / 2);
    const gainB = Math.sin(position * Math.PI / 2);

    if (deckCrossGains.A) {
        deckCrossGains.A.gain.setTargetAtTime(
            gainA,
            audioCtx.currentTime,
            0.02
        );
    }

    if (deckCrossGains.B) {
        deckCrossGains.B.gain.setTargetAtTime(
            gainB,
            audioCtx.currentTime,
            0.02
        );
    }
}

$("crossfader")?.addEventListener("input", updateCrossfader);

document.addEventListener("DOMContentLoaded", () => {
    const crossfader = $("crossfader");
    const leftButton = $("cfLeftBtn");
    const rightButton = $("cfRightBtn");

    const TRANSITION_DURATION = 5000;
    let transitionFrame = null;

    function smoothCrossfade(targetValue) {
        if (!crossfader) return;

        if (transitionFrame !== null) {
            cancelAnimationFrame(transitionFrame);
        }

        const startValue = Number(crossfader.value);
        const startTime = performance.now();

        function animate(now) {
            const progress = Math.min(
                (now - startTime) / TRANSITION_DURATION,
                1
            );

            const eased = progress * progress * (3 - 2 * progress);

            crossfader.value =
                startValue + (targetValue - startValue) * eased;

            crossfader.dispatchEvent(new Event("input", {
                bubbles: true
            }));

            if (progress < 1) {
                transitionFrame = requestAnimationFrame(animate);
            } else {
                crossfader.value = targetValue;
                crossfader.dispatchEvent(new Event("input", {
                    bubbles: true
                }));
                crossfader.dispatchEvent(new Event("change", {
                    bubbles: true
                }));
                transitionFrame = null;
            }
        }

        transitionFrame = requestAnimationFrame(animate);
    }

    leftButton?.addEventListener("click", () => smoothCrossfade(0));
    rightButton?.addEventListener("click", () => smoothCrossfade(100));
});

/* ===================== PLAY / PAUSE / CUE ===================== */

async function playTrack(deck) {
    const audio = $(`audio${deck}`);

    if (!audio || !audio.src) {
        alert(`Load a music file into Deck ${deck} first.`);
        return;
    }

    initAudioContext(deck);

    if (!audioCtx) return;

    try {
        if (audioCtx.state === "suspended") {
            await audioCtx.resume();
        }

        await audio.play();
        setStatus(`Deck ${deck} playing.`);
    } catch (error) {
        console.error(error);
        setStatus(`Unable to play Deck ${deck}.`);
    }
}

function pauseTrack(deck) {
    const audio = $(`audio${deck}`);
    if (!audio) return;

    audio.pause();
    setStatus(`Deck ${deck} paused.`);
}

function cueTrack(deck) {
    const audio = $(`audio${deck}`);
    if (!audio) return;

    audio.pause();

    try {
        audio.currentTime = 0;
    } catch (_) {}

    setStatus(`Deck ${deck} returned to the beginning.`);
}

/* ===================== LOAD TRACKS ===================== */

const trackLoadRequests = { A: 0, B: 0 };

["A", "B"].forEach(deck => {
    const fileInput = $(`file${deck}`);
    const audio = $(`audio${deck}`);
    const name = $(`name${deck}`);
    const bpmDisplay = $(`bpmDisplay${deck}`);
    const pitchSlider = $(`pitch${deck}`);

    if (!fileInput || !audio) {
        console.error(`Missing file input or audio element for Deck ${deck}.`);
        return;
    }

    fileInput.addEventListener("change", async event => {
        const file = event.target.files?.[0];
        if (!file) return;

        const requestId = ++trackLoadRequests[deck];

        audio.pause();

        if (audio.dataset.objectUrl) {
            URL.revokeObjectURL(audio.dataset.objectUrl);
            delete audio.dataset.objectUrl;
        }

        const objectUrl = URL.createObjectURL(file);

        audio.dataset.objectUrl = objectUrl;
        audio.src = objectUrl;
        audio.playbackRate = 1;

        delete audio.dataset.originalBpm;

        if (name) {
            name.textContent = file.name;
            name.title = file.name;
            name.style.display = "";
            name.style.visibility = "visible";
            name.style.opacity = "1";
        }

        if (bpmDisplay) {
            bpmDisplay.textContent = "SCANNING...";
            bpmDisplay.style.display = "";
            bpmDisplay.style.visibility = "visible";
            bpmDisplay.style.opacity = "1";
        }

        if (pitchSlider) pitchSlider.value = 0;
        updatePitch(deck);

        overviewBuffers[deck] = null;
        partialWaveforms[deck].buffer = null;

        initializePartialWaveforms();
        drawMasterOverview();

        initAudioContext(deck);
        loadOverviewWaveform(deck, file);
        loadTrackWaveform(deck, file, audio);

        audio.load();

        setStatus(`Deck ${deck}: music loaded, detecting BPM...`);

        const formData = new FormData();
        formData.append("audio", file, file.name);

        try {
            const response = await fetch(
                "http://127.0.0.1:5000/detect-bpm",
                {
                    method: "POST",
                    body: formData
                }
            );

            const data = await response.json();

            if (requestId !== trackLoadRequests[deck]) return;

            if (!response.ok) {
                throw new Error(
                    data.error ||
                    `Python server returned HTTP ${response.status}`
                );
            }

            const bpm = Number(data.bpm);

            if (!Number.isFinite(bpm) || bpm <= 0) {
                throw new Error(data.error || "Invalid BPM returned by Python.");
            }

            audio.dataset.originalBpm = String(bpm);

            if (bpmDisplay) {
                bpmDisplay.textContent = bpm.toFixed(1);
                bpmDisplay.style.display = "";
                bpmDisplay.style.visibility = "visible";
                bpmDisplay.style.opacity = "1";
            }

            setStatus(`Deck ${deck}: ${file.name} | BPM ${bpm.toFixed(1)}`);
            console.log(`[Deck ${deck}] Detected BPM: ${bpm}`);
        } catch (error) {
            if (requestId !== trackLoadRequests[deck]) return;

            console.error(`[Deck ${deck}] BPM detection error:`, error);

            delete audio.dataset.originalBpm;

            if (bpmDisplay) {
                bpmDisplay.textContent = "BPM ERROR";
                bpmDisplay.style.display = "";
                bpmDisplay.style.visibility = "visible";
                bpmDisplay.style.opacity = "1";
            }

            setStatus(
                `Deck ${deck}: music loaded, but BPM detection failed: ${error.message}`
            );
        }

        drawMasterOverview();
    });
});

/* ===================== BPM ANALYSIS ===================== */

async function analyzeBPM(buffer) {
    const sampleRate = buffer.sampleRate;
    const channelCount = buffer.numberOfChannels;
    const hop = Math.max(1, Math.floor(sampleRate * 0.02));
    const envelope = [];
    const channels = [];

    for (let channel = 0; channel < channelCount; channel++) {
        channels.push(buffer.getChannelData(channel));
    }

    for (let start = 0; start < buffer.length; start += hop) {
        const end = Math.min(start + hop, buffer.length);

        let sum = 0;
        let count = 0;

        for (let i = start; i < end; i += 2) {
            let sample = 0;

            for (let channel = 0; channel < channelCount; channel++) {
                sample += channels[channel][i] || 0;
            }

            sample /= channelCount;
            sum += sample * sample;
            count++;
        }

        envelope.push(Math.sqrt(sum / Math.max(count, 1)));
    }

    if (envelope.length < 100) {
        throw new Error("Track is too short for BPM analysis.");
    }

    const onset = new Float32Array(envelope.length);
    let mean = 0;

    for (let i = 0; i < envelope.length; i++) {
        mean += envelope[i];
    }

    mean /= envelope.length;

    for (let i = 1; i < envelope.length; i++) {
        const current = envelope[i] - mean;
        const previous = envelope[i - 1] - mean;
        onset[i] = Math.max(0, current - previous);
    }

    const onsetRate = sampleRate / hop;
    const scores = [];

    for (let bpm = 60; bpm <= 200; bpm += 0.25) {
        const lag = Math.round(onsetRate * 60 / bpm);

        if (lag < 1 || lag >= onset.length) continue;

        let score = 0;
        let count = 0;
        const stride = Math.max(1, Math.floor(onset.length / 6000));

        for (let i = lag; i < onset.length; i += stride) {
            score += onset[i] * onset[i - lag];
            count++;
        }

        scores.push({
            bpm,
            score: score / Math.max(count, 1)
        });
    }

    scores.sort((a, b) => b.score - a.score);

    if (!scores.length || scores[0].score <= 0) {
        throw new Error("No reliable beat pattern found.");
    }

    return Math.round(scores[0].bpm * 10) / 10;
}

/* ===================== BPM SYNC ===================== */

function syncTrack(deck) {
    const otherDeck = deck === "A" ? "B" : "A";
    const target = $(`audio${deck}`);
    const source = $(`audio${otherDeck}`);

    if (!target?.src || !source?.src) {
        alert("Load a track into both decks before using SYNC.");
        return;
    }

    const targetBpm = Number(target.dataset.originalBpm);
    const sourceBpm = Number(source.dataset.originalBpm);

    if (
        !Number.isFinite(targetBpm) || targetBpm <= 0 ||
        !Number.isFinite(sourceBpm) || sourceBpm <= 0
    ) {
        alert("Wait until BPM analysis finishes for both tracks.");
        return;
    }

    const desiredRate =
        (sourceBpm * source.playbackRate) / targetBpm;

    const slider = $(`pitch${deck}`);

    const minRate = slider
        ? Math.max(0.1, 1 + Number(slider.min || -50) / 100)
        : 0.5;

    const maxRate = slider
        ? 1 + Number(slider.max || 50) / 100
        : 1.5;

    const newRate = clamp(desiredRate, minRate, maxRate);

    target.playbackRate = newRate;

    if (slider) {
        slider.value = (newRate - 1) * 100;
    }

    updatePitch(deck);

    if (
        !source.paused &&
        Number.isFinite(source.duration) && source.duration > 0 &&
        Number.isFinite(target.duration) && target.duration > 0
    ) {
        const progress = source.currentTime / source.duration;

        target.currentTime = clamp(progress, 0, 1) * target.duration;

        if (target.paused) playTrack(deck);
    }

    setStatus(
        `Deck ${deck} synced to Deck ${otherDeck}. ` +
        `Estimated tempo: ${(targetBpm * newRate).toFixed(1)} BPM.`
    );
}

/* ===================== PITCH CONTROL ===================== */

function updatePitch(deck) {
    const slider = $(`pitch${deck}`);
    const audio = $(`audio${deck}`);
    const display = $(`pitchValue${deck}`);

    if (!slider || !audio) return;

    const percent = Number(slider.value);
    const rate = Math.max(0.1, 1 + percent / 100);

    audio.playbackRate = rate;

    if (display) {
        display.textContent =
            `${percent > 0 ? "+" : ""}${percent.toFixed(1)}%`;
    }
}

function resetPitch(deck) {
    const slider = $(`pitch${deck}`);
    if (!slider) return;

    slider.value = 0;
    updatePitch(deck);
}

["A", "B"].forEach(deck => {
    $(`pitch${deck}`)?.addEventListener("input", () => updatePitch(deck));

    $(`play${deck}`)?.addEventListener("click", () => playTrack(deck));
    $(`pause${deck}`)?.addEventListener("click", () => pauseTrack(deck));
    $(`cue${deck}`)?.addEventListener("click", () => cueTrack(deck));
    $(`sync${deck}`)?.addEventListener("click", () => syncTrack(deck));

    $(`pitchReset${deck}`)?.addEventListener(
        "click",
        () => resetPitch(deck)
    );
});

/* ===================== TIME DISPLAY ===================== */

function formatTime(seconds) {
    if (!Number.isFinite(seconds) || seconds < 0) return "0:00";

    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = Math.floor(seconds % 60);

    return `${minutes}:${String(remainingSeconds).padStart(2, "0")}`;
}

["A", "B"].forEach(deck => {
    const audio = $(`audio${deck}`);
    if (!audio) return;

    function updateTime() {
        const display = $(`timeDisplay${deck}`);

        if (display) {
            display.textContent = formatTime(audio.currentTime);
        }

        drawMasterOverview();
    }

    ["timeupdate", "loadedmetadata", "seeked"].forEach(eventName => {
        audio.addEventListener(eventName, updateTime);
    });
});


/* ===================== JOG WHEEL / SCRATCH ===================== */

["A", "B"].forEach(deck => {
    const audio = $(`audio${deck}`);
    const jog = $(`jog${deck}`);

    if (!audio || !jog || jog.dataset.jogInitialized === "true") return;

    jog.dataset.jogInitialized = "true";

    let dragging = false;
    let lastAngle = 0;
    let totalRotation = 0;
    let wasPlaying = false;
    let basePlaybackRate = 1;
    let lastScratchTime = 0;

    const SCRATCH_SEEK_SPEED = 0.035;
    const SCRATCH_RATE_SPEED = 0.12;

    function getPointerAngle(event) {
        const rect = jog.getBoundingClientRect();

        return Math.atan2(
            event.clientY - (rect.top + rect.height / 2),
            event.clientX - (rect.left + rect.width / 2)
        ) * (180 / Math.PI);
    }

    function updateRotation() {
        jog.style.setProperty("--jog-rotation", `${totalRotation}deg`);
    }

    function updateJogState() {
        if (dragging) return;

        jog.classList.toggle("playing", !audio.paused && !audio.ended);
    }

    audio.addEventListener("play", updateJogState);
    audio.addEventListener("pause", updateJogState);
    audio.addEventListener("ended", updateJogState);

    jog.addEventListener("pointerdown", event => {
        if (event.button !== 0 || dragging) return;

        dragging = true;
        wasPlaying = !audio.paused;
        basePlaybackRate = audio.playbackRate || 1;
        lastAngle = getPointerAngle(event);
        lastScratchTime = performance.now();

        jog.classList.add("scratching");
        jog.classList.remove("playing");
        jog.style.cursor = "grabbing";

        try {
            jog.setPointerCapture(event.pointerId);
        } catch (_) {}

        event.preventDefault();
    });

    jog.addEventListener("pointermove", event => {
        if (!dragging) return;

        const angle = getPointerAngle(event);
        let delta = angle - lastAngle;

        if (delta > 180) delta -= 360;
        if (delta < -180) delta += 360;

        lastAngle = angle;
        totalRotation += delta;
        updateRotation();

        if (!Number.isFinite(audio.duration) || audio.duration <= 0) {
            return;
        }

        // Move the track position with the jog wheel.
        const nextTime =
            audio.currentTime + delta * SCRATCH_SEEK_SPEED;

        audio.currentTime = clamp(nextTime, 0, audio.duration);

        // Add an audible speed change while scratching.
        // HTML audio cannot use a negative playbackRate for true reverse audio.
        if (wasPlaying && !audio.paused) {
            const rateChange = delta * SCRATCH_RATE_SPEED;

            audio.playbackRate = clamp(
                basePlaybackRate + rateChange,
                0.1,
                3
            );
        }

        drawMasterOverview();
    });

    function finishScratch() {
        if (!dragging) return;

        dragging = false;

        jog.classList.remove("scratching");
        jog.style.cursor = "grab";

        // Restore the pitch setting that was active before scratching.
        audio.playbackRate = basePlaybackRate;

        if (wasPlaying) {
            if (audio.paused) {
                audio.play().catch(error => {
                    console.warn("Could not resume Deck " + deck, error);
                });
            }
            jog.classList.add("playing");
        } else {
            jog.classList.remove("playing");
        }

        updateRotation();
        drawMasterOverview();
    }

    jog.addEventListener("pointerup", finishScratch);
    jog.addEventListener("pointercancel", finishScratch);
    jog.addEventListener("lostpointercapture", finishScratch);

    jog.style.cursor = "grab";
    jog.style.touchAction = "none";

    updateRotation();
});



/* ===================== CHANNEL LEVEL ===================== */

document.querySelectorAll(".vertical-slider").forEach(slider => {
    slider.addEventListener("input", () => {
        const deck =
            slider.id === "levelA" ? "A" :
            slider.id === "levelB" ? "B" : null;

        if (!deck) return;

        deckBaseLevels[deck] = clamp(Number(slider.value), 0, 100);
        applyChannelGain(deck);
    });
});

/* ===================== 10-BAND EQUALIZER ===================== */

function updateEqualizer() {
    if (!audioCtx) return;

    const enabled = $("eqOnCheck")
        ? $("eqOnCheck").checked
        : true;

    const masterSlider = $("eqMasterGain");
    const masterDb = masterSlider ? Number(masterSlider.value) : 0;
    const masterLinear = Math.pow(10, masterDb / 20);

    if ($("eqMasterValue")) {
        $("eqMasterValue").textContent =
            `${masterDb > 0 ? "+" : ""}${masterDb} dB`;
    }

    ["A", "B"].forEach(deck => {
        const filters = deckEqualizerFilters[deck];
        const masterNode = deckEffects[deck]?.eqMasterGain;

        if (filters) {
            filters.forEach((filter, index) => {
                const frequency = eqFrequencies[index];

                const slider = document.querySelector(
                    `#equalizerPanel [data-frequency="${frequency}"]`
                );

                const db = slider ? Number(slider.value) : 0;

                filter.gain.setTargetAtTime(
                    enabled ? db : 0,
                    audioCtx.currentTime,
                    0.02
                );

                const output = $(`eqValue${frequency}`);

                if (output) {
                    output.textContent =
                        `${db > 0 ? "+" : ""}${db} dB`;
                }
            });
        }

        if (masterNode) {
            masterNode.gain.setTargetAtTime(
                masterLinear,
                audioCtx.currentTime,
                0.02
            );
        }
    });
}

function applyEqualizerPreset(presetName) {
    const presets = {
        "Flat":        [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
        "Club Master": [5, 4, 3, 0, -1, 1, 3, 4, 4, 3],
        "Deep Bass":   [8, 7, 5, 3, 1, 0, 0, 0, 1, 1],
        "Vocal Boost": [-2, -1, 0, 2, 4, 5, 4, 2, 0, -1],
        "Electronic":  [5, 4, 2, 0, -2, 1, 3, 4, 3, 2]
    };

    const values = presets[presetName];
    if (!values) return;

    values.forEach((value, index) => {
        const frequency = eqFrequencies[index];

        const slider = document.querySelector(
            `#equalizerPanel [data-frequency="${frequency}"]`
        );

        if (slider) slider.value = value;
    });

    updateEqualizer();
}

function initializeEqualizerControls() {
    const panel = $("equalizerPanel");

    if (!panel || panel.dataset.eqInitialized === "true") return;

    panel.dataset.eqInitialized = "true";

    panel.querySelectorAll('input[type="range"]').forEach(slider => {
        slider.addEventListener("input", updateEqualizer);
    });

    $("eqOnCheck")?.addEventListener("change", updateEqualizer);

    $("eqMasterGain")?.addEventListener("input", updateEqualizer);

    $("eqPreset")?.addEventListener("change", event => {
        applyEqualizerPreset(event.target.value);
    });

    updateEqualizer();
}

function toggleEqualizer() {
    $("equalizerPanel")?.classList.toggle("eq-open");
}

/* ===================== MIXER KNOBS ===================== */

document.querySelectorAll(".mixer-strip").forEach((strip, stripIndex) => {
    const deck = stripIndex === 0 ? "A" : "B";
    const knobs = strip.querySelectorAll(".knob-small");
    const labels = strip.querySelectorAll(".eq-label");

    knobs.forEach((knob, knobIndex) => {
        let value = 50;
        let startY = 0;
        let dragging = false;

        function applyKnobValue() {
            const label = labels[knobIndex]?.textContent
                .trim()
                .toUpperCase();

            knob.style.transform =
                `rotate(${(value - 50) * 2.5}deg)`;

            if (!audioCtx) return;

            const filters = deckFilters[deck];
            const fx = deckEffects[deck];
            const normalized = (value - 50) / 5;

            if (label === "GAIN") {
                deckGainKnobValues[deck] = value;
                applyChannelGain(deck);
            } else if (label === "HIGH" && filters) {
                filters.high.gain.setTargetAtTime(
                    normalized,
                    audioCtx.currentTime,
                    0.02
                );
            } else if (label === "MID" && filters) {
                filters.mid.gain.setTargetAtTime(
                    normalized,
                    audioCtx.currentTime,
                    0.02
                );
            } else if (label === "LOW" && filters) {
                filters.low.gain.setTargetAtTime(
                    normalized,
                    audioCtx.currentTime,
                    0.02
                );
            } else if (label === "FX" && fx) {
                const amount = value / 100;

                fx.wet.gain.setTargetAtTime(
                    amount * 0.8,
                    audioCtx.currentTime,
                    0.02
                );

                fx.feedback.gain.setTargetAtTime(
                    amount * 0.45,
                    audioCtx.currentTime,
                    0.02
                );
            }
        }

        knob.addEventListener("pointerdown", event => {
            dragging = true;
            startY = event.clientY;

            try {
                knob.setPointerCapture(event.pointerId);
            } catch (_) {}

            event.preventDefault();
        });

        knob.addEventListener("pointermove", event => {
            if (!dragging) return;

            value = clamp(value + startY - event.clientY, 0, 100);
            startY = event.clientY;

            applyKnobValue();
        });

        function stopDragging() {
            dragging = false;
        }

        knob.addEventListener("pointerup", stopDragging);
        knob.addEventListener("pointercancel", stopDragging);
        knob.addEventListener("lostpointercapture", stopDragging);

        applyKnobValue();
    });
});

/* ===================== LED METERS ===================== */

function updateLedMeter(deck) {
    const analyser = deckAnalysers[deck];
    const container = $(`meter${deck}`);

    if (!analyser || !container) return;

    const data = new Uint8Array(analyser.frequencyBinCount);
    analyser.getByteFrequencyData(data);

    let sum = 0;

    for (let i = 0; i < data.length; i++) {
        sum += data[i];
    }

    const average = sum / Math.max(1, data.length);
    const active = Math.round((average / 300) * 20);
    const segments = container.querySelectorAll(".led-segment");

    segments.forEach((segment, index) => {
        const level = segments.length - 1 - index;

        if (level < active) {
            if (level >= 6) {
                segment.style.background = "#ff3030";
            } else if (level >= 4) {
                segment.style.background = "#ffe44d";
            } else {
                segment.style.background = overviewColors[deck];
            }
        } else {
            segment.style.background = "#111";
        }
    });
}

/* ===================== PARTIAL WAVEFORM ENGINE ===================== */

function initializePartialWaveforms() {
    ["A", "B"].forEach(deck => {
        const wf = partialWaveforms[deck];

        wf.canvas = $(`deck${deck}Waveform`);
        wf.ctx = wf.canvas ? wf.canvas.getContext("2d") : null;
        wf.audioEl = $(`audio${deck}`);
    });

    if (!partialWaveformAnimationStarted) {
        partialWaveformAnimationStarted = true;
        requestAnimationFrame(renderPartialWaveforms);
    }
}

async function loadTrackWaveform(deck, file, audioElement) {
    const wf = partialWaveforms[deck];

    if (!wf || !file || !audioElement) return;

    wf.audioEl = audioElement;
    wf.buffer = null;

    try {
        const context = ensureAudioContext();
        if (!context) return;

        const bytes = await file.arrayBuffer();
        const buffer = await context.decodeAudioData(bytes.slice(0));

        if (wf.audioEl !== audioElement) return;

        wf.buffer = buffer;
        console.log(`Deck ${deck}: moving waveform loaded.`);
    } catch (error) {
        console.error(`Deck ${deck} waveform decode error:`, error);
    }
}

function renderPartialWaveforms() {
    requestAnimationFrame(renderPartialWaveforms);

    ["A", "B"].forEach(deck => {
        const wf = partialWaveforms[deck];

        if (!wf.canvas || !wf.ctx) return;

        const canvas = wf.canvas;
        const ctx = wf.ctx;
        const width = canvas.clientWidth;
        const height = canvas.clientHeight;

        if (!width || !height) return;

        const dpr = window.devicePixelRatio || 1;
        const pixelWidth = Math.round(width * dpr);
        const pixelHeight = Math.round(height * dpr);

        if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
            canvas.width = pixelWidth;
            canvas.height = pixelHeight;
        }

        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, width, height);

        ctx.fillStyle = "#060911";
        ctx.fillRect(0, 0, width, height);

        ctx.strokeStyle = "#172330";
        ctx.lineWidth = 1;

        for (let x = 0; x <= width; x += 32) {
            ctx.beginPath();
            ctx.moveTo(x, 0);
            ctx.lineTo(x, height);
            ctx.stroke();
        }

        const centerY = height / 2;

        ctx.strokeStyle = "#314155";
        ctx.beginPath();
        ctx.moveTo(0, centerY);
        ctx.lineTo(width, centerY);
        ctx.stroke();

        const audio = wf.audioEl;
        const buffer = wf.buffer;

        if (!audio || !buffer) {
            ctx.fillStyle = "#718096";
            ctx.font = "11px sans-serif";
            ctx.fillText(`LOAD TRACK ${deck}`, 10, centerY - 8);
            return;
        }

        const channelData = buffer.getChannelData(0);
        const sampleRate = buffer.sampleRate;
        const windowSeconds = 8;

        const samplesPerPixel = windowSeconds * sampleRate / width;
        const currentSample = Math.floor(audio.currentTime * sampleRate);

        for (let x = 0; x < width; x++) {
            const offset = x - width / 2;

            const start = Math.floor(
                currentSample + offset * samplesPerPixel
            );

            if (start < 0 || start >= channelData.length) continue;

            const end = Math.min(
                channelData.length,
                start + Math.max(1, Math.ceil(samplesPerPixel))
            );

            let min = 5;
            let max = -5;

            for (let i = start; i < end; i++) {
                const sample = channelData[i];

                if (sample < min) min = sample;
                if (sample > max) max = sample;
            }

            const amplitude = Math.max(Math.abs(min), Math.abs(max));
            const barHeight = Math.max(2, amplitude * height * 0.82);

            if (amplitude > 0.58) {
                ctx.fillStyle = "#facc15";
            } else if (amplitude > 0.35) {
                ctx.fillStyle = deck === "A" ? "#00d458" : "#2196f3";
            } else {
                ctx.fillStyle = wf.color;
            }

            ctx.fillRect(x, centerY - barHeight / 2, 1.5, barHeight);
        }

        // Fixed playhead
        ctx.strokeStyle = "#ffffff";
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(width / 2, 0);
        ctx.lineTo(width / 2, height);
        ctx.stroke();

        ctx.fillStyle = "#ffffff";
        ctx.beginPath();
        ctx.moveTo(width / 2 - 5, 0);
        ctx.lineTo(width / 2 + 5, 0);
        ctx.lineTo(width / 2, 6);
        ctx.closePath();
        ctx.fill();
    });
}


function enableDraggableWaveforms() {
    const WINDOW_SECONDS = 8;

    ["A", "B"].forEach(deck => {
        const canvas = document.getElementById(`deck${deck}Waveform`);
        const audio = document.getElementById(`audio${deck}`);

        if (!canvas || !audio || canvas.dataset.dragEnabled === "true") {
            return;
        }

        canvas.dataset.dragEnabled = "true";

        const wrapper = canvas.parentElement;
        let dragging = false;
        let startX = 0;
        let startTime = 0;
        let moved = false;

        wrapper.style.cursor = "grab";
        wrapper.style.touchAction = "none";

        function seekTo(time) {
            if (!audio.src || !Number.isFinite(audio.duration)) return;
            if (audio.duration <= 0) return;

            audio.currentTime = Math.max(
                0,
                Math.min(time, audio.duration)
            );

            if (typeof drawMasterOverview === "function") {
                drawMasterOverview();
            }
        }

        function secondsPerPixel() {
            const rect = canvas.getBoundingClientRect();
            return rect.width > 0 ? WINDOW_SECONDS / rect.width : 0;
        }

        wrapper.addEventListener("pointerdown", event => {
            if (event.button !== 0) return;
            if (!audio.src || !Number.isFinite(audio.duration)) return;

            dragging = true;
            moved = false;
            startX = event.clientX;
            startTime = audio.currentTime;

            wrapper.style.cursor = "grabbing";

            try {
                wrapper.setPointerCapture(event.pointerId);
            } catch (error) {}

            event.preventDefault();
        });

        wrapper.addEventListener("pointermove", event => {
            if (!dragging) return;

            const deltaX = event.clientX - startX;

            if (Math.abs(deltaX) > 2) {
                moved = true;
            }

            if (!moved) return;

            // Drag right = rewind; drag left = move forward
            const newTime = startTime - deltaX * secondsPerPixel();

            seekTo(newTime);
        });

        function stopDragging() {
            if (!dragging) return;

            dragging = false;
            wrapper.style.cursor = "grab";

            // Keep the waveform's new position; don't pause the deck.
            setTimeout(() => {
                moved = false;
            }, 100);
        }

        wrapper.addEventListener("pointerup", stopDragging);
        wrapper.addEventListener("pointercancel", stopDragging);
        wrapper.addEventListener("lostpointercapture", stopDragging);

        wrapper.addEventListener("click", event => {
            if (moved) {
                event.preventDefault();
                event.stopPropagation();
            }
        }, true);
    });
}

enableDraggableWaveforms();
/* ===================== MASTER WAVEFORM LOADING ===================== */

async function loadOverviewWaveform(deck, file) {
    if (!file || !$("masterWaveform")) return;

    try {
        const context = ensureAudioContext();
        if (!context) return;

        const bytes = await file.arrayBuffer();
        const buffer = await context.decodeAudioData(bytes.slice(0));

        const sampleCount = 5000;
        const samples = new Float32Array(sampleCount);
        const channels = [];

        for (let c = 0; c < buffer.numberOfChannels; c++) {
            channels.push(buffer.getChannelData(c));
        }

        for (let i = 0; i < sampleCount; i++) {
            const start = Math.floor(i * buffer.length / sampleCount);

            const end = Math.max(
                start + 1,
                Math.floor((i + 1) * buffer.length / sampleCount)
            );

            let peak = 0;

            for (const channelData of channels) {
                for (let j = start; j < Math.min(end, buffer.length); j++) {
                    peak = Math.max(peak, Math.abs(channelData[j]));
                }
            }

            samples[i] = peak;
        }

        overviewBuffers[deck] = samples;
        drawMasterOverview();
    } catch (error) {
        console.error(`Waveform decode failed for Deck ${deck}:`, error);
    }
}

/* ===================== MASTER WAVEFORM DRAWING ===================== */

function drawMasterOverview() {
    const canvas = $("masterWaveform");
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const width = canvas.clientWidth;
    const height = canvas.clientHeight;

    if (!width || !height) return;

    const dpr = window.devicePixelRatio || 1;

    if (
        canvas.width !== Math.round(width * dpr) ||
        canvas.height !== Math.round(height * dpr)
    ) {
        canvas.width = Math.round(width * dpr);
        canvas.height = Math.round(height * dpr);
    }

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);

    ctx.fillStyle = "#05080c";
    ctx.fillRect(0, 0, width, height);

    // Background grid
    for (let x = 0; x <= width; x += 50) {
        ctx.strokeStyle = x % 160 === 0 ? "#2a3a47" : "#111c25";
        ctx.lineWidth = 1;

        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, height);
        ctx.stroke();
    }

    ctx.strokeStyle = "#31414e";
    ctx.beginPath();
    ctx.moveTo(0, height / 2);
    ctx.lineTo(width, height / 2);
    ctx.stroke();

    ["A", "B"].forEach(deck => {
        const samples = overviewBuffers[deck];
        const audio = $(`audio${deck}`);

        const centerY = deck === "A" ? height * 0.27 : height * 0.73;
        const amplitudeLimit = height * 0.20;

        if (samples) {
            const barWidth = width / samples.length;

            ctx.fillStyle = overviewColors[deck];
            ctx.globalAlpha = 0.9;

            for (let i = 0; i < samples.length; i++) {
                const barHeight = Math.max(
                    1,
                    samples[i] * amplitudeLimit
                );

                ctx.fillRect(
                    i * barWidth,
                    centerY - barHeight,
                    Math.max(1, barWidth * 0.75),
                    barHeight * 2
                );
            }

            ctx.globalAlpha = 1;
        } else {
            ctx.fillStyle = "#758392";
            ctx.font = "11px sans-serif";
            ctx.fillText(`LOAD TRACK ${deck}`, 10, centerY + 4);
        }

        if (
            audio &&
            Number.isFinite(audio.duration) &&
            audio.duration > 0
        ) {
            const progress = clamp(
                audio.currentTime / audio.duration,
                0,
                1
            );

            const x = progress * width;

            ctx.strokeStyle = overviewColors[deck];
            ctx.lineWidth = 2;
            ctx.shadowColor = overviewColors[deck];
            ctx.shadowBlur = 6;

            ctx.beginPath();
            ctx.moveTo(x, 0);
            ctx.lineTo(x, height);
            ctx.stroke();

            ctx.shadowBlur = 0;
            ctx.fillStyle = overviewColors[deck];

            ctx.beginPath();
            ctx.moveTo(x - 5, 0);
            ctx.lineTo(x + 5, 0);
            ctx.lineTo(x, 7);
            ctx.closePath();
            ctx.fill();
        }
    });
}

/* ===================== MASTER WAVEFORM SEEKING ===================== */

/*
   Upper half = Deck A
   Lower half = Deck B
*/

(function setupMasterWaveformSeeking() {
    const canvas = $("masterWaveform");
    if (!canvas) return;

    if (canvas.dataset.masterSeekInitialized === "true") return;
    canvas.dataset.masterSeekInitialized = "true";

    let selectedDeck = null;
    let dragging = false;

    canvas.style.cursor = "crosshair";
    canvas.style.touchAction = "none";

    function selectDeck(event) {
        const rect = canvas.getBoundingClientRect();
        const y = event.clientY - rect.top;

        return y < rect.height / 2 ? "A" : "B";
    }

    function seek(event) {
        if (!selectedDeck) return;

        const audio = $(`audio${selectedDeck}`);
        const rect = canvas.getBoundingClientRect();

        if (
            !audio ||
            !audio.src ||
            !Number.isFinite(audio.duration) ||
            audio.duration <= 0 ||
            rect.width <= 0
        ) {
            return;
        }

        const progress = clamp(
            (event.clientX - rect.left) / rect.width,
            0,
            1
        );

        audio.currentTime = progress * audio.duration;
        drawMasterOverview();

        setStatus(
            `Seeking Deck ${selectedDeck}: ${formatTime(audio.currentTime)}`
        );
    }

    canvas.addEventListener("pointerdown", event => {
        selectedDeck = selectDeck(event);

        const audio = $(`audio${selectedDeck}`);

        if (
            !audio ||
            !audio.src ||
            !Number.isFinite(audio.duration) ||
            audio.duration <= 0
        ) {
            selectedDeck = null;
            return;
        }

        dragging = true;

        try {
            canvas.setPointerCapture(event.pointerId);
        } catch (_) {}

        seek(event);
        event.preventDefault();
    });

    canvas.addEventListener("pointermove", event => {
        if (!dragging) return;

        seek(event);
        event.preventDefault();
    });

    function stopSeeking() {
        dragging = false;
        selectedDeck = null;
    }

    canvas.addEventListener("pointerup", stopSeeking);
    canvas.addEventListener("pointercancel", stopSeeking);
    canvas.addEventListener("lostpointercapture", stopSeeking);
})();

/* ===================== MASTER WAVEFORM REFRESH ===================== */

["A", "B"].forEach(deck => {
    const audio = $(`audio${deck}`);
    if (!audio) return;

    [
        "timeupdate",
        "loadedmetadata",
        "play",
        "pause",
        "seeked",
        "ended"
    ].forEach(eventName => {
        audio.addEventListener(eventName, drawMasterOverview);
    });
});

function animateMasterOverview() {
    drawMasterOverview();

    ["A", "B"].forEach(deck => {
        updateLedMeter(deck);
    });

    requestAnimationFrame(animateMasterOverview);
}

/* ===================== INITIALIZE ===================== */

function initializeDJStudio() {
    initializeEqualizerControls();
    initializePartialWaveforms();

    updateCrossfader();
    drawMasterOverview();

    if (!masterAnimationStarted) {
        masterAnimationStarted = true;
        animateMasterOverview();
    }

    setStatus("ALONTE DJ PRO v1.0 — Audio Console Ready");
}

if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initializeDJStudio);
} else {
    initializeDJStudio();
}

window.addEventListener("resize", drawMasterOverview);

initializePartialWaveforms();
enableDraggableWaveforms();