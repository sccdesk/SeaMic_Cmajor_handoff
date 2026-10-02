"use strict";

const startAudioButton = document.querySelector("#start-audio");
const stopAudioButton = document.querySelector("#stop-audio");
const chainToggleButton = document.querySelector("#chain-toggle");
const recordAudioButton = document.querySelector("#record-audio");
const finishRecordingButton = document.querySelector("#finish-recording");
const wavFileInput = document.querySelector("#wav-file");
const downloadRecordingButton = document.querySelector("#download-recording");
// The Test audio and Playback route selectors were removed from the UI.
// Test playback always feeds the DSP mic input; the active clip source is tracked here.
let selectedClipSource = "";
const playClipOnceButton = document.querySelector("#play-clip-once");
const loopClipButton = document.querySelector("#loop-clip");
const stopClipButton = document.querySelector("#stop-clip");
const aecMicLevelOutput = document.querySelector("#aec-mic-level");
const aecRefLevelOutput = document.querySelector("#aec-ref-level");
const aecOutLevelOutput = document.querySelector("#aec-out-level");
const aecLevelChangeOutput = document.querySelector("#aec-level-change");
const aecDiagnosticNote = document.querySelector("#aec-diagnostic-note");
const presetSelect = document.querySelector("#preset-select");
const applyPresetButton = document.querySelector("#apply-preset");
const savePresetButton = document.querySelector("#save-preset");
const deletePresetButton = document.querySelector("#delete-preset");
const presetStatus = document.querySelector("#preset-status");
const audioTestStatus = document.querySelector("#audio-test-status");
const audioTestState = document.querySelector("#audio-test-state");
const cmajorStatus = document.querySelector("#cmajor-status");
const engineBadge = document.querySelector("#engine-badge");
const routeLabel = document.querySelector("#monitor-route");
const inputDeviceSelect = document.querySelector("#input-device-select");
const refreshInputDevicesButton = document.querySelector("#refresh-input-devices");
const enableInputDevicesButton = document.querySelector("#enable-input-devices");
const inputDeviceStatus = document.querySelector("#input-device-status");
const microphoneState = document.querySelector("#mic-state");
const outputState = document.querySelector("#output-state");
const sampleRateOutput = document.querySelector("#debug-sample-rate");
const loadedModulesOutput = document.querySelector("#debug-modules-loaded");
const aecReferenceOutput = document.querySelector("#debug-aec-reference");
const runtimeMessages = document.querySelector("#runtime-messages");
const microphoneMeter = document.querySelector(".input-block .level-meter");
const outputMeter = document.querySelector(".output-meter");
const microphoneLevelReadout = document.querySelector("#input-level-readout");
const outputLevelReadout = document.querySelector("#output-level-readout");
const inputWaveform = document.querySelector("#input-waveform");
const outputWaveform = document.querySelector("#output-waveform");
const soloButtons = [...document.querySelectorAll(".solo-button")];
const moduleToggleButtons = [...document.querySelectorAll(".module-toggle")];
const signalNodes = [...document.querySelectorAll(".signal-node[data-solo]")];

const requestedSampleRate = 16000;
const inputDeviceStorageKey = "seamic-input-device-v1";
const dryMonitorGain = 0.1;
const waveformWindowSeconds = 5;
const waveformBucketSeconds = 0.05;
const waveformBucketCount = waveformWindowSeconds / waveformBucketSeconds;
const moduleSpecs = [
  {
    id: "dc",
    name: "DC Offset Removal",
    patchName: "SeaMicDCOffset",
    runtimeFile: "cmaj_SeaMic_DC_Offset_Removal.js",
    workletName: "seamic-dc-offset-worklet",
    bypassEndpoints: ["bypassDc"],
    guiTarget: "#patch-gui-dc",
    fixedSettings: "The 20 Hz high-pass cutoff is fixed."
  },
  {
    id: "aec",
    name: "Acoustic Echo Cancellation",
    patchName: "SeaMicAEC",
    runtimeFile: "cmaj_SeaMic_AEC.js",
    workletName: "seamic-aec-worklet",
    bypassEndpoints: ["bypassAec", "bypassDcFilters"],
    fixedBypasses: { bypassDcFilters: 1 },
    // No guiTarget: the AEC node is a skeleton until the module is rebuilt.
    parameters: [
      { endpoint: "filterLength", label: "Filter length", min: 32, max: 1024, step: 32, value: 512, unit: "taps", precision: 0 },
      { endpoint: "stepSize", label: "Adaptation step size", min: 0.01, max: 2, step: 0.01, value: 0.5, precision: 2 },
      { endpoint: "doubleTalkEnabled", label: "Double-talk detector", type: "toggle", value: 1 }
    ]
  },
  {
    id: "dereverb",
    name: "De-Reverb",
    patchName: "SeaMicDeReverb",
    runtimeFile: "cmaj_SeaMic_DeReverb.js",
    workletName: "seamic-dereverb-worklet",
    bypassEndpoints: ["bypassDeReverb"],
    guiTarget: "#patch-gui-dereverb",
    parameters: [
      { endpoint: "amount", label: "De-reverb amount", min: 0, max: 1, step: 0.05, value: 0.5, precision: 2 }
    ],
    fixedSettings: "Envelope times and the −6 dB maximum attenuation are fixed in the processor."
  },
  {
    id: "vad",
    name: "Noise Gate / VAD",
    patchName: "SeaMicNoiseGateVAD",
    runtimeFile: "cmaj_SeaMic_Noise_Gate_VAD.js",
    workletName: "seamic-vad-gate-worklet",
    bypassEndpoints: ["bypassVad", "bypassGate"],
    soloBypasses: { bypassVad: 0, bypassGate: 1 },
    // No guiTarget: the Noise Gate / VAD node is a skeleton until the module is rebuilt.
    parameters: [
      { endpoint: "gateDepthDb", label: "Gate depth", min: 0, max: 60, step: 1, value: 30, unit: "dB", precision: 0 },
      { endpoint: "gateHoldMs", label: "Gate hold after speech", min: 0, max: 1000, step: 25, value: 150, unit: "ms", precision: 0 },
      { endpoint: "hangoverMs", label: "VAD hangover", min: 0, max: 2000, step: 50, value: 400, unit: "ms", precision: 0 },
      { endpoint: "enterDb", label: "SNR enter threshold", min: 1, max: 20, step: 0.5, value: 9, unit: "dB", precision: 1 },
      { endpoint: "exitDb", label: "SNR exit threshold", min: 0, max: 15, step: 0.5, value: 4, unit: "dB", precision: 1 }
    ],
    fixedSettings: "32 ms RMS window; 30 ms gate close ramp and 150 ms release are fixed in the processor."
  },
  {
    id: "loudness",
    name: "Loudness Normalisation",
    patchName: "SeaMicLoudnessNormalization",
    runtimeFile: "cmaj_SeaMic_Loudness_Normalisation.js",
    workletName: "seamic-loudness-worklet",
    bypassEndpoints: ["bypassKWeight", "bypassAGC"],
    guiTarget: "#patch-gui-loudness",
    parameters: [
      { endpoint: "targetDb", label: "Target level", min: -30, max: -6, step: 0.5, value: -19, unit: "dBFS", precision: 1 },
      { endpoint: "maxGainDb", label: "Maximum gain", min: 0, max: 40, step: 1, value: 30, unit: "dB", precision: 0 },
      { endpoint: "minGainDb", label: "Minimum gain", min: -24, max: 0, step: 1, value: -12, unit: "dB", precision: 0 }
    ]
  },
  {
    id: "tone",
    name: "Tone / Warmth",
    patchName: "SeaMicToneWarmth",
    runtimeFile: "cmaj_SeaMic_Tone_Warmth.js",
    workletName: "seamic-tone-worklet",
    bypassEndpoints: ["bypassTone", "bypassDc"],
    guiTarget: "#patch-gui-tone",
    parameters: [
      { endpoint: "drive", label: "Drive", min: 1, max: 8, step: 0.1, value: 1.5, precision: 1 },
      { endpoint: "asymmetry", label: "Harmonic asymmetry", min: 0, max: 0.5, step: 0.01, value: 0.2, precision: 2 },
      { endpoint: "makeupDb", label: "Output gain", min: -12, max: 6, step: 0.5, value: -3, unit: "dB", precision: 1 }
    ],
    fixedSettings: "The post-shaper DC blocker remains enabled with its fixed 20 Hz cutoff."
  },
  {
    id: "limiter",
    name: "Look-Ahead Limiter",
    patchName: "SeaMicLookAheadLimiter",
    runtimeFile: "cmaj_SeaMic_LookAhead_Limiter.js",
    workletName: "seamic-limiter-worklet",
    bypassEndpoints: ["bypassLimiter"],
    guiTarget: "#patch-gui-limiter",
    fixedSettings: "−1.05 dBFS ceiling, 5 ms look-ahead, and 50 ms release; these are fixed in the processor."
  }

];

const presetStorageKey = "seamic-dsp-presets-v1";
const builtInPresets = [
  {
    id: "laptop-mic",
    name: "Laptop microphone",
    values: {
      aec: { filterLength: 256, stepSize: 0.2, doubleTalkEnabled: 1 },
      dereverb: { amount: 0.35 },
      vad: { gateDepthDb: 30, gateHoldMs: 150, hangoverMs: 400, enterDb: 10, exitDb: 4.5 },
      loudness: { targetDb: -23, maxGainDb: 24, minGainDb: -12 },
      tone: { drive: 1.3, asymmetry: 0.12, makeupDb: -3.5 }
    }
  },
  {
    id: "headphones",
    name: "Headset / headphones",
    values: {
      aec: { filterLength: 512, stepSize: 0.5, doubleTalkEnabled: 1 },
      dereverb: { amount: 0.5 },
      vad: { gateDepthDb: 30, gateHoldMs: 150, hangoverMs: 400, enterDb: 9, exitDb: 4 },
      loudness: { targetDb: -19, maxGainDb: 30, minGainDb: -12 },
      tone: { drive: 1.5, asymmetry: 0.2, makeupDb: -3 }
    }
  },
  {
    id: "studio-mic",
    name: "Studio-quality microphone",
    values: {
      aec: { filterLength: 1024, stepSize: 0.35, doubleTalkEnabled: 1 },
      dereverb: { amount: 0.25 },
      vad: { gateDepthDb: 24, gateHoldMs: 100, hangoverMs: 300, enterDb: 7, exitDb: 3.5 },
      loudness: { targetDb: -18, maxGainDb: 24, minGainDb: -9 },
      tone: { drive: 1.3, asymmetry: 0.1, makeupDb: -2.5 }
    }
  }
];

let customPresets = [];
let selectedPresetId = "headphones";
let presetLoadWarning = "";
const currentParameterValues = Object.fromEntries(
  moduleSpecs.map((spec) => [
    spec.id,
    Object.fromEntries((spec.parameters || []).map(({ endpoint, value }) => [endpoint, value]))
  ])
);

function allPresets() {
  return [...builtInPresets, ...customPresets];
}

function validatePresetValues(values) {
  if (!values || typeof values !== "object" || Array.isArray(values)) {
    throw new TypeError("Preset parameter values must be an object.");
  }
  const validated = {};
  for (const spec of moduleSpecs) {
    const moduleValues = values[spec.id];
    if (!moduleValues || typeof moduleValues !== "object" || Array.isArray(moduleValues)) {
      if (spec.parameters?.length) {
        throw new TypeError(`Preset is missing parameters for ${spec.name}.`);
      }
      continue;
    }
    validated[spec.id] = {};
    for (const parameter of spec.parameters || []) {
      const value = moduleValues[parameter.endpoint];
      const validToggle = parameter.type === "toggle" && (value === 0 || value === 1);
      const validRange = parameter.type !== "toggle"
        && typeof value === "number"
        && Number.isFinite(value)
        && value >= parameter.min
        && value <= parameter.max
        && Math.abs((value - parameter.min) / parameter.step - Math.round((value - parameter.min) / parameter.step)) < 1e-8;
      if (!validToggle && !validRange) {
        throw new TypeError(`Preset has an invalid ${spec.name} · ${parameter.label} value.`);
      }
      validated[spec.id][parameter.endpoint] = value;
    }
  }
  return validated;
}

function renderPresetOptions() {
  presetSelect.replaceChildren();
  for (const preset of allPresets()) {
    const option = document.createElement("option");
    option.value = preset.id;
    option.textContent = preset.name;
    presetSelect.appendChild(option);
  }
  if (!allPresets().some(({ id }) => id === selectedPresetId)) {
    selectedPresetId = builtInPresets[1].id;
  }
  presetSelect.value = selectedPresetId;
  deletePresetButton.disabled = !customPresets.some(({ id }) => id === presetSelect.value);
}

function persistPresets() {
  try {
    localStorage.setItem(presetStorageKey, JSON.stringify({
      activePresetId: selectedPresetId,
      customPresets
    }));
    return true;
  } catch (error) {
    const message = `Could not save presets in this browser: ${error.message}`;
    presetStatus.textContent = message;
    addRuntimeMessage(message);
    return false;
  }
}

function loadPresets() {
  try {
    const saved = localStorage.getItem(presetStorageKey);
    if (!saved) {
      return;
    }
    const parsed = JSON.parse(saved);
    if (!parsed || typeof parsed !== "object" || !Array.isArray(parsed.customPresets)) {
      throw new TypeError("Saved preset data has an invalid format.");
    }
    const seenIds = new Set(builtInPresets.map(({ id }) => id));
    customPresets = parsed.customPresets.map((preset) => {
      if (
        !preset
        || typeof preset.id !== "string"
        || !preset.id.startsWith("custom-")
        || typeof preset.name !== "string"
        || !preset.name.trim()
        || seenIds.has(preset.id)
      ) {
        throw new TypeError("Saved preset data contains an invalid or duplicate preset.");
      }
      seenIds.add(preset.id);
      return {
        id: preset.id,
        name: preset.name.trim(),
        values: validatePresetValues(preset.values)
      };
    });
    if (typeof parsed.activePresetId === "string") {
      selectedPresetId = parsed.activePresetId;
    }
  } catch (error) {
    customPresets = [];
    selectedPresetId = builtInPresets[1].id;
    presetLoadWarning = `Could not load saved presets: ${error.message}`;
    presetStatus.textContent = presetLoadWarning;
    addRuntimeMessage(presetLoadWarning);
  }
}

function applyPreset(presetId, persist = true) {
  const preset = allPresets().find(({ id }) => id === presetId);
  if (!preset) {
    throw new Error("Select a valid DSP preset.");
  }
  const values = validatePresetValues(preset.values);
  for (const spec of moduleSpecs) {
    for (const parameter of spec.parameters || []) {
      const value = values[spec.id][parameter.endpoint];
      const connection = patchSessions.get(spec.id);
      if (connection) {
        connection.sendEventOrValue(parameter.endpoint, value);
      }
    }
  }
  for (const spec of moduleSpecs) {
    currentParameterValues[spec.id] = values[spec.id] || {};
    renderModuleControls(patchSessions.get(spec.id) || null, spec);
  }
  selectedPresetId = preset.id;
  renderPresetOptions();
  presetStatus.textContent = `Applied "${preset.name}". Module bypass and active states are unchanged.`;
  if (persist) {
    persistPresets();
  }
}

function saveCurrentPreset() {
  const name = window.prompt("Name this DSP preset:");
  if (name === null) {
    return;
  }
  const trimmedName = name.trim();
  if (!trimmedName) {
    throw new Error("Preset name cannot be empty.");
  }
  if (trimmedName.length > 60) {
    throw new Error("Preset names must be 60 characters or fewer.");
  }
  let timestamp = Date.now();
  while (customPresets.some(({ id }) => id === `custom-${timestamp}`)) {
    timestamp += 1;
  }
  const preset = {
    id: `custom-${timestamp}`,
    name: trimmedName,
    values: validatePresetValues(currentParameterValues)
  };
  customPresets.push(preset);
  selectedPresetId = preset.id;
  renderPresetOptions();
  if (persistPresets()) {
    presetStatus.textContent = `Saved "${trimmedName}" in this browser.`;
  }
}

function deleteSelectedPreset() {
  const preset = customPresets.find(({ id }) => id === presetSelect.value);
  if (!preset) {
    throw new Error("Only saved custom presets can be deleted.");
  }
  customPresets = customPresets.filter(({ id }) => id !== preset.id);
  if (selectedPresetId === preset.id) {
    selectedPresetId = builtInPresets[1].id;
    applyPreset(selectedPresetId, false);
  } else {
    renderPresetOptions();
  }
  if (persistPresets()) {
    presetStatus.textContent = `Deleted saved preset "${preset.name}".`;
  }
}

let audioContext = null;
let sharedAudioContext = null;
let ownsAudioContext = false;
let microphoneStream = null;
let microphoneSource = null;
let microphoneInputGain = null;
let testInputGain = null;
let testPlaybackSource = null;
let disconnectTestPlaybackReference = null;
let testPlaybackRoute = "mic";
let previousAecTestState = null;
let testAudioBuffer = null;
let testAudioLabel = "";
let aecMicAnalyser = null;
let aecReferenceAnalyser = null;
let aecOutputAnalyser = null;
let aecMicMeterData = null;
let aecReferenceMeterData = null;
let aecOutputMeterData = null;
let recordingProcessor = null;
let recordingMuteGain = null;
let recordingChunks = [];
let recordingSampleCount = 0;
let recordedAudioBuffer = null;
let recordingBlob = null;
let inputMerger = null;
let playbackBus = null;
let playbackReferenceConnected = false;
let dryGain = null;
let wetGain = null;
let inputAnalyser = null;
let outputAnalyser = null;
let meterAnimation = 0;
let isChainActive = false;
let soloModuleId = null;
let isStarting = false;
let inputDeviceName = "";
let inputMeterData = null;
let outputMeterData = null;
let lastWaveformUpdate = 0;
const inputWaveformHistory = [];
const outputWaveformHistory = [];
const patchSessions = new Map();
const playbackSources = new Set();
const moduleActive = Object.fromEntries(moduleSpecs.map(({ id }) => [id, false]));

function hasPlaybackReference() {
  return playbackSources.size > 0;
}

function enableAecTestMode() {
  previousAecTestState = {
    isChainActive,
    soloModuleId,
    moduleActive: { ...moduleActive }
  };
  moduleActive.aec = true;
  isChainActive = true;
  soloModuleId = null;
  applyDspMode();
  updateSoloControls();
  updateAecReferenceStatus();
}

function restoreAecTestMode() {
  if (!previousAecTestState) {
    return;
  }
  isChainActive = previousAecTestState.isChainActive;
  soloModuleId = previousAecTestState.soloModuleId;
  Object.assign(moduleActive, previousAecTestState.moduleActive);
  previousAecTestState = null;
  applyDspMode();
  updateSoloControls();
}

function setInputDeviceStatus(message, isError = false) {
  inputDeviceStatus.textContent = message;
  inputDeviceStatus.dataset.state = isError ? "error" : "ready";
}

function updateInputDeviceControls() {
  const isLocked = isStarting || Boolean(audioContext);
  inputDeviceSelect.disabled = isLocked;
  refreshInputDevicesButton.disabled = isLocked;
  enableInputDevicesButton.disabled = isLocked;
  startAudioButton.disabled = isLocked || !inputDeviceSelect.value;
}

function persistInputDeviceSelection(deviceId) {
  try {
    if (deviceId) {
      localStorage.setItem(inputDeviceStorageKey, deviceId);
    } else {
      localStorage.removeItem(inputDeviceStorageKey);
    }
  } catch (error) {
    setInputDeviceStatus(`Could not remember the input selection: ${error.message}`, true);
    addRuntimeMessage(`Could not remember input device selection: ${error.message}`);
  }
}

function loadInputDeviceSelection() {
  try {
    return localStorage.getItem(inputDeviceStorageKey) || "";
  } catch (error) {
    setInputDeviceStatus(`Could not read the saved input selection: ${error.message}`, true);
    addRuntimeMessage(`Could not read saved input device selection: ${error.message}`);
    return "";
  }
}

async function refreshInputDevices() {
  if (!navigator.mediaDevices?.enumerateDevices) {
    throw new Error("This browser does not support audio input device selection.");
  }
  const previousSelection = inputDeviceSelect.value || loadInputDeviceSelection();
  const devices = await navigator.mediaDevices.enumerateDevices();
  const audioInputs = devices.filter((device) => device.kind === "audioinput" && device.deviceId !== "default");
  inputDeviceSelect.replaceChildren();

  const placeholder = document.createElement("option");
  placeholder.value = "";
  placeholder.textContent = "Choose an input device...";
  inputDeviceSelect.appendChild(placeholder);

  const defaultOption = document.createElement("option");
  defaultOption.value = "system-default";
  defaultOption.textContent = "System default microphone";
  inputDeviceSelect.appendChild(defaultOption);

  audioInputs.forEach((device, index) => {
    const option = document.createElement("option");
    option.value = device.deviceId;
    option.textContent = device.label || `Microphone ${index + 1}`;
    inputDeviceSelect.appendChild(option);
  });

  const selectionExists = [...inputDeviceSelect.options].some(({ value }) => value === previousSelection);
  inputDeviceSelect.value = selectionExists ? previousSelection : "";
  if (previousSelection && !selectionExists) {
    persistInputDeviceSelection("");
    setInputDeviceStatus("The previously selected microphone is no longer available. Choose another input.");
  } else if (audioInputs.length === 0) {
    setInputDeviceStatus("No microphone inputs were found. Connect a microphone, then refresh the device list.");
  } else if (audioInputs.every((device) => !device.label)) {
    setInputDeviceStatus("Microphones found. Allow access to display their names, or choose a numbered input.");
  } else {
    setInputDeviceStatus(`${audioInputs.length} microphone input${audioInputs.length === 1 ? "" : "s"} available.`);
  }
  updateInputDeviceControls();
}

async function requestInputDeviceNames() {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error("This browser does not support microphone access.");
  }
  const temporaryStream = await navigator.mediaDevices.getUserMedia({ audio: true });
  temporaryStream.getTracks().forEach((track) => track.stop());
  await refreshInputDevices();
  setInputDeviceStatus("Microphone permission granted. Choose the input to use, then start the engine.");
}

function getSelectedInputDevice() {
  const selectedValue = inputDeviceSelect.value;
  if (!selectedValue) {
    throw new Error("Choose an input device before starting the engine.");
  }
  const option = inputDeviceSelect.selectedOptions[0];
  return {
    deviceId: selectedValue === "system-default" ? null : selectedValue,
    label: option?.textContent || "Selected microphone"
  };
}

function updateStoppedPlaybackStatus() {
  if (audioContext) {
    return;
  }

  const playbackIsRouted = sharedAudioContext?.state === "running" && hasPlaybackReference();
  outputState.textContent = playbackIsRouted ? "PLAYBACK ROUTED" : "STANDBY";
  outputState.dataset.state = playbackIsRouted ? "active" : "bypassed";
}

function disconnectPlaybackSource(sourceNode) {
  if (!playbackSources.has(sourceNode)) {
    return false;
  }

  sourceNode.disconnect(playbackBus);
  playbackSources.delete(sourceNode);
  if (!hasPlaybackReference()) {
    moduleActive.aec = false;
    if (soloModuleId === "aec") {
      soloModuleId = null;
    }
  }

  applyDspMode();
  updateSoloControls();
  updateOutputRoute();
  updateAecReferenceStatus();
  updateStoppedPlaybackStatus();
  addRuntimeMessage(
    hasPlaybackReference()
      ? "A playback source was disconnected from the AEC reference bus."
      : "Playback reference bus empty; AEC is bypassed until playback resumes."
  );
  return true;
}

function connectPlaybackSource(sourceNode) {
  if (!audioContext || !playbackBus) {
    throw new Error("Start the audio engine before connecting playback.");
  }
  if (!(sourceNode instanceof AudioNode) || sourceNode.context !== audioContext) {
    throw new TypeError("Playback source must be an AudioNode in the SeaMic AudioContext.");
  }
  if (playbackSources.has(sourceNode)) {
    throw new Error("This playback source is already connected.");
  }

  sourceNode.connect(playbackBus);
  playbackSources.add(sourceNode);
  updateSoloControls();
  updateAecReferenceStatus();
  addRuntimeMessage("Live playback connected to speakers and the pre-output AEC reference.");
  return () => disconnectPlaybackSource(sourceNode);
}

window.SeaMicAudio = Object.freeze({
  getAudioContext() {
    if (!audioContext) {
      throw new Error("Start the SeaMic audio engine before requesting its AudioContext.");
    }
    return audioContext;
  },
  connectPlaybackSource,
  start: startAudio
});

function updateStatus(text, state) {
  cmajorStatus.textContent = text;
  cmajorStatus.dataset.state = state || "ready";
}

function reportAudioTestError(action, error) {
  const message = `${action}: ${error.message}`;
  audioTestStatus.textContent = message;
  updateStatus(message, "error");
  addRuntimeMessage(message);
}

function updateAudioTestControls() {
  const engineActive = Boolean(audioContext);
  const isRecording = recordingProcessor !== null;
  const micTestPlaying = testPlaybackSource !== null;
  const isPlaying = micTestPlaying;
  recordAudioButton.disabled = !engineActive || isRecording;
  finishRecordingButton.disabled = !isRecording;
  wavFileInput.disabled = !engineActive || isRecording || isPlaying;
  const clip = getSelectedClip();
  const clipAvailable = Boolean(clip?.buffer);
  playClipOnceButton.disabled = !engineActive || !clipAvailable || isRecording || isPlaying;
  loopClipButton.disabled = !engineActive || !clipAvailable || isRecording || isPlaying;
  stopClipButton.disabled = !isPlaying;
  downloadRecordingButton.disabled = !recordingBlob || isRecording;
}

function restoreMicrophoneTestInput() {
  if (microphoneInputGain && testInputGain && audioContext) {
    microphoneInputGain.gain.setTargetAtTime(1, audioContext.currentTime, 0.01);
    testInputGain.gain.setTargetAtTime(0, audioContext.currentTime, 0.01);
  }
  audioTestState.textContent = "MICROPHONE INPUT";
  updateOutputRoute();
}

function stopTestPlayback() {
  if (!testPlaybackSource) {
    return;
  }

  const source = testPlaybackSource;
  const usedAecReference = testPlaybackRoute === "aec-reference";
  testPlaybackSource = null;
  testPlaybackRoute = "mic";
  source.stop();
  if (usedAecReference) {
    restoreAecTestMode();
    disconnectTestPlaybackReference?.();
    disconnectTestPlaybackReference = null;
  } else {
    source.disconnect();
  }
  restoreMicrophoneTestInput();
  audioTestStatus.textContent = usedAecReference
    ? "AEC reference playback stopped; previous DSP state restored."
    : "Test playback stopped; live microphone input restored.";
  updateAudioTestControls();
}

function playTestBuffer(buffer, label, loop) {
  if (!audioContext || !testInputGain || !inputMerger) {
    throw new Error("Start the audio engine before playing test audio.");
  }
  if (recordingProcessor) {
    throw new Error("Finish the microphone recording before starting test playback.");
  }

  if (testPlaybackSource) {
    stopTestPlayback();
  }
  const source = audioContext.createBufferSource();
  source.buffer = buffer;
  const playsAsAecReference = false; // The playback-route selector was removed; test audio always feeds the DSP mic input.
  if (playsAsAecReference) {
    disconnectTestPlaybackReference = connectPlaybackSource(source);
  } else {
    source.connect(testInputGain);
  }
  if (loop) {
    source.loop = true;
  }
  if (playsAsAecReference) {
    testInputGain.gain.setTargetAtTime(0, audioContext.currentTime, 0.01);
    enableAecTestMode();
  } else {
    microphoneInputGain.gain.setTargetAtTime(0, audioContext.currentTime, 0.01);
    testInputGain.gain.setTargetAtTime(1, audioContext.currentTime, 0.01);
  }
  testPlaybackSource = source;
  testPlaybackRoute = playsAsAecReference ? "aec-reference" : "mic";
  audioTestState.textContent = playsAsAecReference ? "AEC REFERENCE → SPEAKERS" : "TEST AUDIO → DSP";
  audioTestStatus.textContent = playsAsAecReference
    ? `${loop ? "Looping" : "Playing once"} ${label} to speakers and the AEC reference. AEC is active; its echo must reach the microphone.`
    : `${loop ? "Looping" : "Playing once"} ${label} through the DSP mic input.`;
  updateOutputRoute();
  source.addEventListener("ended", () => {
    if (testPlaybackSource === source) {
      testPlaybackSource = null;
      const usedAecReference = testPlaybackRoute === "aec-reference";
      testPlaybackRoute = "mic";
      if (usedAecReference) {
        restoreAecTestMode();
        disconnectTestPlaybackReference?.();
        disconnectTestPlaybackReference = null;
      } else {
        source.disconnect();
      }
      restoreMicrophoneTestInput();
      audioTestStatus.textContent = usedAecReference
        ? `${label} finished; AEC reference disconnected and AEC bypassed.`
        : `${label} finished; live microphone input restored.`;
      updateAudioTestControls();
    }
  }, { once: true });
  updateAudioTestControls();
  try {
    source.start();
  } catch (error) {
    testPlaybackSource = null;
    testPlaybackRoute = "mic";
    if (playsAsAecReference) {
      restoreAecTestMode();
      disconnectTestPlaybackReference?.();
      disconnectTestPlaybackReference = null;
    } else {
      source.disconnect();
    }
    restoreMicrophoneTestInput();
    updateAudioTestControls();
    throw error;
  }
}

function getSelectedClip() {
  if (selectedClipSource === "recording" && recordedAudioBuffer) {
    return { buffer: recordedAudioBuffer, label: "microphone recording", type: "recording" };
  }
  if (selectedClipSource === "wav" && testAudioBuffer) {
    return { buffer: testAudioBuffer, label: testAudioLabel || "test WAV", type: "wav" };
  }
  // No explicit preference (or it expired): fall back to whichever clip exists.
  if (recordedAudioBuffer) {
    return { buffer: recordedAudioBuffer, label: "microphone recording", type: "recording" };
  }
  if (testAudioBuffer) {
    return { buffer: testAudioBuffer, label: testAudioLabel || "test WAV", type: "wav" };
  }
  return null;
}

function refreshClipSelector(preferredSource) {
  if (preferredSource) {
    selectedClipSource = preferredSource;
  }

  if (selectedClipSource === "recording" && !recordedAudioBuffer) {
    selectedClipSource = testAudioBuffer ? "wav" : "";
  } else if (selectedClipSource === "wav" && !testAudioBuffer) {
    selectedClipSource = recordedAudioBuffer ? "recording" : "";
  }

  updateClipPlaybackLabels();
  updateAudioTestControls();
}

function updateClipPlaybackLabels() {
  const clip = getSelectedClip();
  const sourceName = clip
    ? `${clip.type === "recording" ? "recording" : "WAV"} · ${clip.buffer.duration.toFixed(2)} s`
    : "";
  playClipOnceButton.textContent = clip
    ? `▶ Play once to mic input (${sourceName})`
    : "▶ Play once to mic input";
  loopClipButton.textContent = clip
    ? `↻ Loop to mic input (${sourceName})`
    : "↻ Loop to mic input";
}

function createWavBlob(chunks, sampleCount, sampleRate) {
  const bytesPerSample = 2;
  const dataSize = sampleCount * bytesPerSample;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);
  const writeText = (offset, text) => {
    for (let index = 0; index < text.length; index += 1) {
      view.setUint8(offset + index, text.charCodeAt(index));
    }
  };
  writeText(0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  writeText(8, "WAVE");
  writeText(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * bytesPerSample, true);
  view.setUint16(32, bytesPerSample, true);
  view.setUint16(34, 16, true);
  writeText(36, "data");
  view.setUint32(40, dataSize, true);

  let writeOffset = 44;
  for (const chunk of chunks) {
    for (const sample of chunk) {
      const clipped = Math.max(-1, Math.min(1, sample));
      view.setInt16(writeOffset, clipped < 0 ? clipped * 32768 : clipped * 32767, true);
      writeOffset += bytesPerSample;
    }
  }
  return new Blob([buffer], { type: "audio/wav" });
}

async function finishRecording() {
  if (!recordingProcessor || !audioContext) {
    return;
  }

  const processor = recordingProcessor;
  recordingProcessor = null;
  processor.onaudioprocess = null;
  processor.disconnect();
  if (recordingMuteGain) {
    recordingMuteGain.disconnect();
    recordingMuteGain = null;
  }

  if (recordingSampleCount === 0) {
    recordingChunks = [];
    audioTestStatus.textContent = "Recording contained no audio samples.";
    updateAudioTestControls();
    return;
  }

  recordingBlob = createWavBlob(recordingChunks, recordingSampleCount, audioContext.sampleRate);
  recordedAudioBuffer = await audioContext.decodeAudioData(await recordingBlob.arrayBuffer());
  const duration = recordingSampleCount / audioContext.sampleRate;
  recordingChunks = [];
  refreshClipSelector("recording");
  audioTestStatus.textContent = `Recorded ${duration.toFixed(2)} s at ${audioContext.sampleRate} Hz. Ready to play through the chain or save as WAV.`;
  updateAudioTestControls();
}

function startRecording() {
  if (!audioContext || !microphoneSource) {
    throw new Error("Start the audio engine before recording.");
  }
  if (testPlaybackSource) {
    throw new Error("Stop test playback before recording the microphone.");
  }

  recordedAudioBuffer = null;
  recordingBlob = null;
  recordingChunks = [];
  recordingSampleCount = 0;
  const processor = audioContext.createScriptProcessor(4096, 1, 1);
  const maximumRecordingSamples = audioContext.sampleRate * 300;
  recordingMuteGain = audioContext.createGain();
  recordingMuteGain.gain.value = 0;
  processor.onaudioprocess = (event) => {
    const samples = event.inputBuffer.getChannelData(0);
    const sampleCount = Math.min(samples.length, maximumRecordingSamples - recordingSampleCount);
    if (sampleCount > 0) {
      recordingChunks.push(new Float32Array(samples.subarray(0, sampleCount)));
      recordingSampleCount += sampleCount;
    }
    audioTestStatus.textContent =
      `Recording microphone · ${(recordingSampleCount / audioContext.sampleRate).toFixed(1)} s / 300 s maximum`;
    if (recordingSampleCount >= maximumRecordingSamples) {
      finishRecording().catch((error) => reportAudioTestError("Could not finish recording", error));
    }
  };
  microphoneSource.connect(processor);
  processor.connect(recordingMuteGain);
  recordingMuteGain.connect(audioContext.destination);
  recordingProcessor = processor;
  audioTestStatus.textContent = "Recording microphone. Press Finish recording to prepare the WAV.";
  updateAudioTestControls();
}

function addRuntimeMessage(message) {
  const entry = document.createElement("li");
  entry.textContent = `${new Date().toLocaleTimeString()} — ${message}`;
  runtimeMessages.prepend(entry);

  while (runtimeMessages.children.length > 8) {
    runtimeMessages.lastElementChild.remove();
  }
}

async function loadModule(spec) {
  addRuntimeMessage(`Loading ${spec.name}.`);
  const moduleUrl = new URL(
    `./generated/${spec.patchName}/${spec.runtimeFile}`,
    document.baseURI
  ).href;
  const module = await import(moduleUrl);
  if (typeof module.createAudioWorkletNodePatchConnection !== "function") {
    throw new Error(`${spec.name}: the generated Cmajor WebAudio API is missing.`);
  }
  return module;
}

function formatParameterValue(parameter, value) {
  const formatted = value.toFixed(parameter.precision ?? 2);
  return parameter.unit ? `${formatted} ${parameter.unit}` : formatted;
}

function renderModuleControls(connection, spec) {
  const target = spec.guiTarget ? document.querySelector(spec.guiTarget) : null;

  if (!target) {
    return;
  }

  const heading = document.createElement("h3");
  heading.className = "parameter-heading";
  heading.textContent = "Real-time parameters";
  target.replaceChildren(heading);

  if (!spec.parameters?.length) {
    const note = document.createElement("p");
    note.className = "parameter-empty";
    note.textContent = "No user-adjustable DSP parameters are exposed; use the module bypass above.";
    target.appendChild(note);
  } else {
    const controls = document.createElement("div");
    controls.className = "parameter-list";

    for (const parameter of spec.parameters) {
      const label = document.createElement("label");
      label.className = parameter.type === "toggle" ? "parameter-control parameter-toggle" : "parameter-control";
      label.htmlFor = `${spec.id}-${parameter.endpoint}`;

      const name = document.createElement("span");
      name.className = "parameter-name";
      name.textContent = parameter.label;
      label.appendChild(name);

      const input = document.createElement("input");
      input.id = `${spec.id}-${parameter.endpoint}`;
      input.dataset.endpoint = parameter.endpoint;
      input.disabled = connection === null;
      const value = currentParameterValues[spec.id]?.[parameter.endpoint] ?? parameter.value;

      const readout = document.createElement("output");
      readout.className = "parameter-value";

      if (parameter.type === "toggle") {
        input.type = "checkbox";
        input.checked = value > 0.5;
        readout.value = input.checked ? "ON" : "OFF";
        input.addEventListener("change", () => {
          const value = input.checked ? 1 : 0;
          try {
            connection.sendEventOrValue(parameter.endpoint, value);
            currentParameterValues[spec.id][parameter.endpoint] = value;
            readout.value = input.checked ? "ON" : "OFF";
          } catch (error) {
            input.checked = !input.checked;
            updateStatus(`Could not update ${parameter.label}: ${error.message}`, "error");
            addRuntimeMessage(`Failed to update ${spec.name} · ${parameter.label}: ${error.message}`);
          }
        });
      } else {
        input.type = "range";
        input.min = String(parameter.min);
        input.max = String(parameter.max);
        input.step = String(parameter.step);
        input.value = String(value);
        input.setAttribute(
          "aria-label",
          `${parameter.label}, ${parameter.min} to ${parameter.max}${parameter.unit ? ` ${parameter.unit}` : ""}`
        );
        readout.value = formatParameterValue(parameter, value);
        input.addEventListener("input", () => {
          const value = Number(input.value);
          try {
            connection.sendEventOrValue(parameter.endpoint, value);
            currentParameterValues[spec.id][parameter.endpoint] = value;
            readout.value = formatParameterValue(parameter, value);
          } catch (error) {
            updateStatus(`Could not update ${parameter.label}: ${error.message}`, "error");
            addRuntimeMessage(`Failed to update ${spec.name} · ${parameter.label}: ${error.message}`);
          }
        });
      }

      label.append(input, readout);
      controls.appendChild(label);
    }

    target.appendChild(controls);
  }

  if (!connection) {
    const note = document.createElement("p");
    note.className = "parameter-note";
    note.textContent = "Start the audio engine to adjust parameters in real time.";
    target.appendChild(note);
  }
  if (spec.fixedSettings) {
    const note = document.createElement("p");
    note.className = "parameter-note";
    note.textContent = spec.fixedSettings;
    target.appendChild(note);
  }
}

async function createModuleSessions() {
  for (const spec of moduleSpecs) {
    const patchModule = await loadModule(spec);
    const connection = await patchModule.createAudioWorkletNodePatchConnection(
      audioContext,
      spec.workletName
    );

    patchSessions.set(spec.id, connection);
    for (const endpoint of spec.bypassEndpoints) {
      connection.sendEventOrValue(endpoint, 1);
    }
    for (const parameter of spec.parameters || []) {
      connection.sendEventOrValue(
        parameter.endpoint,
        currentParameterValues[spec.id][parameter.endpoint]
      );
    }
    renderModuleControls(connection, spec);
  }

  loadedModulesOutput.textContent = `${patchSessions.size} / ${moduleSpecs.length}`;
  addRuntimeMessage(`Loaded ${patchSessions.size} independent Cmajor DSP modules.`);
}

function getModuleBypasses(spec) {
  const fixedBypasses = spec.fixedBypasses || {};
  const allBypassed = {
    ...Object.fromEntries(spec.bypassEndpoints.map((id) => [id, 1])),
    ...fixedBypasses
  };
  if (spec.id === "aec" || spec.id === "vad") {
    // Both modules are marked "POR REHACER": keep them bypassed until they are rebuilt.
    return allBypassed;
  }

  const isActive = soloModuleId
    ? soloModuleId === spec.id
    : isChainActive && moduleActive[spec.id];
  if (!isActive) {
    return allBypassed;
  }

  if (soloModuleId && spec.soloBypasses) {
    return { ...allBypassed, ...spec.soloBypasses, ...fixedBypasses };
  }

  return {
    ...Object.fromEntries(spec.bypassEndpoints.map((id) => [id, 0])),
    ...fixedBypasses
  };
}

function applyDspMode() {
  for (const spec of moduleSpecs) {
    const connection = patchSessions.get(spec.id);
    if (!connection) {
      continue;
    }

    const bypasses = getModuleBypasses(spec);
    for (const [endpoint, bypassed] of Object.entries(bypasses)) {
      connection.sendEventOrValue(endpoint, bypassed);
    }
  }
}

function updateSoloControls() {
  for (const button of moduleToggleButtons) {
    const moduleId = button.dataset.module;
    const node = signalNodes.find((item) => item.dataset.solo === moduleId);
    const state = node?.querySelector(".module-state");
    const isAec = moduleId === "aec";
    const aecUnavailable = isAec && !hasPlaybackReference();
    const isSoloed = soloModuleId !== null;
    const isActive = aecUnavailable ? false : isSoloed
      ? soloModuleId === moduleId
      : isChainActive && moduleActive[moduleId];

    button.disabled = !audioContext || aecUnavailable || isSoloed;
    button.textContent = aecUnavailable ? "Waiting for reference" : isActive ? "Bypass" : "Activate";
    button.setAttribute("aria-pressed", String(isActive));

    if (state) {
      state.textContent = aecUnavailable
        ? "BYPASSED · AWAITING REFERENCE"
        : isSoloed && isActive
          ? "SOLO · ACTIVE"
          : isSoloed
            ? "BYPASSED · SOLO"
            : !isChainActive
              ? "BYPASSED · MASTER"
              : isActive
                ? "ACTIVE"
                : "BYPASSED";
      state.dataset.state = isActive ? "active" : "bypassed";
    }
    if (node) {
      node.dataset.status = isActive ? "implemented" : "bypassed";
      if (isAec) {
        const stageStatus = node.querySelector(".signal-stage-status");
        if (stageStatus) {
          stageStatus.textContent = aecUnavailable
            ? "Implemented · awaiting playback reference"
            : isActive
              ? "Implemented · active"
              : "Implemented · playback reference connected";
        }
      }
    }
  }

  for (const button of soloButtons) {
    const isAec = button.dataset.solo === "aec";
    const aecUnavailable = isAec && !hasPlaybackReference();
    const isActive = button.dataset.solo === soloModuleId;
    button.disabled = !audioContext || aecUnavailable || (soloModuleId !== null && !isActive);
    button.setAttribute("aria-pressed", String(isActive));
    button.textContent = isActive ? "Exit Solo" : aecUnavailable ? "Waiting for reference" : "Solo";
  }

  for (const node of signalNodes) {
    node.classList.toggle("is-solo", node.dataset.solo === soloModuleId);
    node.classList.toggle(
      "is-muted-by-solo",
      soloModuleId !== null && node.dataset.solo !== soloModuleId
    );
  }

  chainToggleButton.textContent = isChainActive
    ? "Bypass entire DSP chain"
    : "Activate entire DSP chain";
  chainToggleButton.setAttribute("aria-pressed", String(isChainActive && !soloModuleId));
  chainToggleButton.disabled = !audioContext || soloModuleId !== null;
}

function updateAecReferenceStatus() {
  const status = document.querySelector("#aec-reference-state");

  if (status) {
    status.textContent = hasPlaybackReference()
      ? `LIVE PLAYBACK CONNECTED · ${playbackSources.size} SOURCE${playbackSources.size === 1 ? "" : "S"}`
      : "NO PLAYBACK SOURCE · AEC BYPASSED";
    status.dataset.state = hasPlaybackReference() ? "connected" : "disconnected";
  }
  const aecProcessingActive = soloModuleId === "aec" || (isChainActive && moduleActive.aec);
  aecReferenceOutput.textContent = hasPlaybackReference()
    ? `Connected (${playbackSources.size} source${playbackSources.size === 1 ? "" : "s"}) · ${aecProcessingActive ? "AEC active" : "AEC ready"}`
    : "Disconnected";
  if (hasPlaybackReference()) {
    aecDiagnosticNote.textContent = `${aecProcessingActive ? "AEC is active" : "Playback reference connected; activate AEC"}; its echo must reach the microphone.`;
  } else {
    aecDiagnosticNote.textContent = "Connect a far-end playback source; AEC remains bypassed without one. Level change is not a true ERLE measurement.";
  }
}

function updateOutputRoute() {
  if (!audioContext || !outputAnalyser || !dryGain || !wetGain) {
    return;
  }

  const useDryRoute = !isChainActive && !soloModuleId;
  const inputName = testPlaybackSource && testPlaybackRoute === "mic" ? "TEST AUDIO" : "MICROPHONE";
  const level = dryMonitorGain;
  dryGain.gain.setTargetAtTime(useDryRoute ? level : 0, audioContext.currentTime, 0.015);
  wetGain.gain.setTargetAtTime(useDryRoute ? 0 : level, audioContext.currentTime, 0.015);

  if (soloModuleId) {
    const soloNode = signalNodes.find((node) => node.dataset.solo === soloModuleId);
    const soloName = soloNode?.querySelector("strong")?.textContent || soloModuleId;
    routeLabel.dataset.route = "solo";
    routeLabel.innerHTML = `${inputName} → <strong>SOLO: ${soloName}</strong> → OUTPUT`;
    updateStatus(`Solo mode · ${soloName} active · all other modules bypassed`);
    addRuntimeMessage(`${soloName} soloed; all other modules bypassed.`);
  } else if (useDryRoute) {
    routeLabel.dataset.route = "dry";
    routeLabel.innerHTML = `${inputName} → OUTPUT (<strong>DRY</strong>)`;
    updateStatus("Engine active · DSP chain bypassed · dry monitor");
    addRuntimeMessage("Dry route: DSP modules bypassed; microphone monitored directly.");
  } else {
    routeLabel.dataset.route = "wet";
    routeLabel.innerHTML = `${inputName} → 7 DSP MODULES → OUTPUT (<strong>DSP</strong>)`;
    updateStatus("Engine active · individual module states shown below");
    addRuntimeMessage("DSP route active; each module follows its displayed state.");
  }
}

function readPeakDbfs(analyser, data) {
  analyser.getFloatTimeDomainData(data);
  let peak = 0;

  for (const sample of data) {
    peak = Math.max(peak, Math.abs(sample));
  }

  return peak > 0 ? 20 * Math.log10(peak) : Number.NEGATIVE_INFINITY;
}

function updateMeter(analyser, meter, readout, data) {
  const peakDbfs = readPeakDbfs(analyser, data);
  const displayedDbfs = Number.isFinite(peakDbfs)
    ? Math.max(-60, Math.min(0, peakDbfs))
    : -60;
  const fill = meter.querySelector("span");
  const percentage = `${((displayedDbfs + 60) / 60) * 100}%`;

  if (meter.dataset.orientation === "vertical") {
    fill.style.height = percentage;
    fill.style.width = "";
  } else {
    fill.style.width = percentage;
  }
  meter.setAttribute("aria-valuenow", displayedDbfs.toFixed(1));
  meter.classList.toggle("is-clipping", peakDbfs >= 0);
  readout.textContent = Number.isFinite(peakDbfs)
    ? `${peakDbfs.toFixed(1)} dBFS`
    : "-Inf dBFS";
}

function appendWaveformSample(analyser, data, history) {
  analyser.getFloatTimeDomainData(data);
  let minimum = 0;
  let maximum = 0;

  for (const sample of data) {
    minimum = Math.min(minimum, sample);
    maximum = Math.max(maximum, sample);
  }

  history.push({ minimum, maximum });
  if (history.length > waveformBucketCount) {
    history.shift();
  }
}

function drawWaveform(canvas, history, colorToken) {
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  if (width === 0 || height === 0) {
    return;
  }

  const pixelRatio = window.devicePixelRatio || 1;
  const pixelWidth = Math.round(width * pixelRatio);
  const pixelHeight = Math.round(height * pixelRatio);
  if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
    canvas.width = pixelWidth;
    canvas.height = pixelHeight;
  }

  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("The browser could not create a waveform canvas.");
  }

  context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
  context.clearRect(0, 0, width, height);
  const vertical = canvas.dataset.orientation === "vertical";
  context.strokeStyle = getComputedStyle(document.documentElement)
    .getPropertyValue("--ad-border-lo")
    .trim();
  context.lineWidth = 1;
  context.beginPath();

  if (vertical) {
    // Time flows from top (oldest) to bottom (newest); amplitude spans the width.
    const centerX = width / 2;
    context.moveTo(centerX, 0);
    context.lineTo(centerX, height);
    context.moveTo(width * 0.15, 0);
    context.lineTo(width * 0.15, height);
    context.moveTo(width * 0.85, 0);
    context.lineTo(width * 0.85, height);
  } else {
    const centerY = height / 2;
    context.moveTo(0, centerY);
    context.lineTo(width, centerY);
    context.moveTo(0, height * 0.15);
    context.lineTo(width, height * 0.15);
    context.moveTo(0, height * 0.85);
    context.lineTo(width, height * 0.85);
  }

  context.stroke();

  context.strokeStyle = getComputedStyle(document.documentElement)
    .getPropertyValue(colorToken)
    .trim();
  context.lineWidth = 1.5;
  context.beginPath();
  history.forEach(({ minimum, maximum }, index) => {
    if (vertical) {
      const y = ((index + 0.5) / waveformBucketCount) * height;
      const left = width / 2 + Math.max(-1, Math.min(1, minimum)) * (width / 2);
      const right = width / 2 + Math.max(-1, Math.min(1, maximum)) * (width / 2);
      context.moveTo(left, y);
      context.lineTo(right, y);
    } else {
      const centerY = height / 2;
      const x = ((index + 0.5) / waveformBucketCount) * width;
      const top = centerY - Math.max(-1, Math.min(1, maximum)) * centerY;
      const bottom = centerY - Math.max(-1, Math.min(1, minimum)) * centerY;
      context.moveTo(x, top);
      context.lineTo(x, bottom);
    }
  });
  context.stroke();
}

function updateAecDiagnostics() {
  if (!audioContext || !aecMicAnalyser || !aecReferenceAnalyser || !aecOutputAnalyser) {
    return;
  }
  const micDb = readPeakDbfs(aecMicAnalyser, aecMicMeterData);
  const referenceDb = readPeakDbfs(aecReferenceAnalyser, aecReferenceMeterData);
  const outputDb = readPeakDbfs(aecOutputAnalyser, aecOutputMeterData);
  aecMicLevelOutput.value = Number.isFinite(micDb) ? `${micDb.toFixed(1)} dBFS` : "-Inf dBFS";
  aecRefLevelOutput.value = Number.isFinite(referenceDb) ? `${referenceDb.toFixed(1)} dBFS` : "-Inf dBFS";
  aecOutLevelOutput.value = Number.isFinite(outputDb) ? `${outputDb.toFixed(1)} dBFS` : "-Inf dBFS";
  aecLevelChangeOutput.value = Number.isFinite(micDb) && Number.isFinite(outputDb)
    ? `${(outputDb - micDb).toFixed(1)} dB`
    : "— dB";
}

function updateMeters() {
  if (!audioContext || !inputAnalyser || !outputAnalyser) {
    return;
  }

  updateMeter(inputAnalyser, microphoneMeter, microphoneLevelReadout, inputMeterData);
  updateMeter(outputAnalyser, outputMeter, outputLevelReadout, outputMeterData);
  updateAecDiagnostics();
  const now = performance.now();
  if (now - lastWaveformUpdate >= waveformBucketSeconds * 1000) {
    appendWaveformSample(inputAnalyser, inputMeterData, inputWaveformHistory);
    appendWaveformSample(outputAnalyser, outputMeterData, outputWaveformHistory);
    drawWaveform(inputWaveform, inputWaveformHistory, "--dat-cat-1");
    drawWaveform(outputWaveform, outputWaveformHistory, "--dat-cat-3");
    lastWaveformUpdate = now;
  }
  meterAnimation = requestAnimationFrame(updateMeters);
}

function setChainBypassed(isBypassed) {
  isChainActive = !isBypassed;
  if (isChainActive) {
    for (const spec of moduleSpecs) {
      moduleActive[spec.id] = spec.id !== "aec" && spec.id !== "vad";
    }
  }
  soloModuleId = null;
  applyDspMode();
  updateSoloControls();
  updateAecReferenceStatus();
  updateOutputRoute();
}

function toggleSolo(moduleId) {
  if (
    !audioContext
    || (moduleId === "aec" && !hasPlaybackReference())
    || (soloModuleId !== null && soloModuleId !== moduleId)
  ) {
    return;
  }

  soloModuleId = soloModuleId === moduleId ? null : moduleId;
  applyDspMode();
  updateSoloControls();
  updateAecReferenceStatus();
  updateOutputRoute();
}

function setInitialControls() {
  isChainActive = false;
  soloModuleId = null;
  for (const spec of moduleSpecs) {
    moduleActive[spec.id] = false;
  }
  chainToggleButton.textContent = "Activate entire DSP chain";
  chainToggleButton.setAttribute("aria-pressed", "false");
  chainToggleButton.disabled = true;
  updateSoloControls();
}

async function initCmajor() {
  await createModuleSessions();
  sampleRateOutput.textContent = `${audioContext.sampleRate} Hz`;
  if (audioContext.sampleRate !== requestedSampleRate) {
    addRuntimeMessage(
      `WARNING: AudioContext runs at ${audioContext.sampleRate} Hz; the chain target is ${requestedSampleRate} Hz.`
    );
  }

  microphoneStream = await navigator.mediaDevices.getUserMedia({
    audio: {
      ...(inputDeviceSelect.value === "system-default"
        ? {}
        : { deviceId: { exact: inputDeviceSelect.value } }),
      channelCount: 1,
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false
    }
  });

  microphoneSource = audioContext.createMediaStreamSource(microphoneStream);
  inputMerger = audioContext.createChannelMerger(2);
  if (!playbackBus) {
    playbackBus = audioContext.createGain();
    playbackBus.connect(audioContext.destination);
  } else if (playbackBus.context !== audioContext) {
    throw new Error("The playback bus belongs to a different AudioContext.");
  }
  playbackBus.connect(inputMerger, 0, 1);
  playbackReferenceConnected = true;

  const getAudioNode = (id) => {
    const connection = patchSessions.get(id);
    if (!connection) {
      throw new Error(`The ${id} module patch did not initialise.`);
    }
    return connection.audioNode;
  };

  inputMerger.connect(getAudioNode("dc"));
  getAudioNode("dc").connect(getAudioNode("aec"));
  getAudioNode("aec").connect(getAudioNode("dereverb"));
  getAudioNode("dereverb").connect(getAudioNode("vad"));
  getAudioNode("vad").connect(getAudioNode("loudness"));
  getAudioNode("loudness").connect(getAudioNode("tone"));
  getAudioNode("tone").connect(getAudioNode("limiter"));

  dryGain = audioContext.createGain();
  wetGain = audioContext.createGain();
  dryGain.gain.value = dryMonitorGain;
  wetGain.gain.value = 0;
  inputAnalyser = audioContext.createAnalyser();
  outputAnalyser = audioContext.createAnalyser();
  inputAnalyser.fftSize = 1024;
  outputAnalyser.fftSize = 1024;
  aecMicAnalyser = audioContext.createAnalyser();
  aecReferenceAnalyser = audioContext.createAnalyser();
  aecOutputAnalyser = audioContext.createAnalyser();
  aecMicAnalyser.fftSize = 1024;
  aecReferenceAnalyser.fftSize = 1024;
  aecOutputAnalyser.fftSize = 1024;
  inputAnalyser.smoothingTimeConstant = 0.65;
  outputAnalyser.smoothingTimeConstant = 0.65;
  inputMeterData = new Float32Array(inputAnalyser.fftSize);
  outputMeterData = new Float32Array(outputAnalyser.fftSize);
  aecMicMeterData = new Float32Array(aecMicAnalyser.fftSize);
  aecReferenceMeterData = new Float32Array(aecReferenceAnalyser.fftSize);
  aecOutputMeterData = new Float32Array(aecOutputAnalyser.fftSize);
  inputWaveformHistory.length = 0;
  outputWaveformHistory.length = 0;
  lastWaveformUpdate = 0;

  microphoneInputGain = audioContext.createGain();
  testInputGain = audioContext.createGain();
  testInputGain.gain.value = 0;
  for (const inputGain of [microphoneInputGain, testInputGain]) {
    inputGain.connect(inputMerger, 0, 0);
    inputGain.connect(inputAnalyser);
    inputGain.connect(dryGain);
  }
  microphoneInputGain.connect(aecMicAnalyser);
  testInputGain.connect(aecMicAnalyser);
  playbackBus.connect(aecReferenceAnalyser);
  microphoneSource.connect(microphoneInputGain);
  getAudioNode("aec").connect(aecOutputAnalyser);
  dryGain.connect(outputAnalyser);
  getAudioNode("limiter").connect(wetGain);
  wetGain.connect(outputAnalyser);
  outputAnalyser.connect(audioContext.destination);

  applyDspMode();
  updateSoloControls();
  updateOutputRoute();
  microphoneState.textContent = "ACTIVE";
  microphoneState.dataset.state = "active";
  outputState.textContent = "ACTIVE";
  outputState.dataset.state = "active";
  engineBadge.textContent = "ENGINE ACTIVE";
  engineBadge.dataset.state = "active";
  chainToggleButton.disabled = false;
  stopAudioButton.disabled = false;
  audioTestStatus.textContent = `Engine ready using ${inputDeviceName}. Record the microphone or load a WAV to test the DSP input.`;
  setInputDeviceStatus(`Active input: ${inputDeviceName}. Stop the engine to select another device.`);
  updateAudioTestControls();
  addRuntimeMessage("AEC is bypassed until a live playback reference is connected.");
  meterAnimation = requestAnimationFrame(updateMeters);
}

async function startAudio(requestedContext) {
  if (isStarting || audioContext) {
    return;
  }

  let selectedInput;
  try {
    selectedInput = getSelectedInputDevice();
  } catch (error) {
    updateStatus(error.message, "error");
    setInputDeviceStatus(error.message, true);
    return;
  }
  inputDeviceName = selectedInput.label;
  isStarting = true;
  updateInputDeviceControls();
  updateStatus("Loading seven Cmajor DSP modules and preparing the microphone...");

  try {
    if (requestedContext && !(requestedContext instanceof AudioContext)) {
      throw new TypeError("SeaMicAudio.start expects an AudioContext.");
    }
    if (sharedAudioContext && requestedContext && requestedContext !== sharedAudioContext) {
      throw new Error("SeaMic is already configured to use a different shared AudioContext.");
    }
    if (requestedContext) {
      sharedAudioContext = requestedContext;
    }
    audioContext = sharedAudioContext || new AudioContext({ sampleRate: requestedSampleRate });
    if (audioContext.state === "closed") {
      throw new Error("The shared AudioContext is closed and cannot be reused.");
    }
    ownsAudioContext = sharedAudioContext === null;
    await audioContext.resume();
    await initCmajor();
  } catch (error) {
    await stopAudio(false);
    updateStatus(`Error: ${error.message}`, "error");
    setInputDeviceStatus(`Could not start with ${inputDeviceName}: ${error.message}`, true);
    addRuntimeMessage(`Failed to start the console: ${error.message}`);
  } finally {
    isStarting = false;
    updateInputDeviceControls();
  }
}

async function stopAudio(showStatus) {
  if (testPlaybackSource) {
    stopTestPlayback();
  }
  if (recordingProcessor) {
    try {
      await finishRecording();
    } catch (error) {
      reportAudioTestError("Could not finalize microphone recording", error);
    }
  }
  if (meterAnimation) {
    cancelAnimationFrame(meterAnimation);
    meterAnimation = 0;
  }

  for (const connection of patchSessions.values()) {
    connection.audioNode.disconnect();
  }
  patchSessions.clear();

  if (microphoneSource) {
    microphoneSource.disconnect();
    microphoneSource = null;
  }
  if (microphoneInputGain) {
    microphoneInputGain.disconnect();
    microphoneInputGain = null;
  }
  if (testInputGain) {
    testInputGain.disconnect();
    testInputGain = null;
  }
  if (playbackReferenceConnected && playbackBus && inputMerger) {
    playbackBus.disconnect(inputMerger);
    playbackReferenceConnected = false;
  }
  if (inputMerger) {
    inputMerger.disconnect();
    inputMerger = null;
  }
  if (ownsAudioContext) {
    for (const sourceNode of playbackSources) {
      sourceNode.disconnect(playbackBus);
    }
    playbackSources.clear();
  }
  if (playbackBus && ownsAudioContext) {
    playbackBus.disconnect();
    playbackBus = null;
  }
  if (dryGain) {
    dryGain.disconnect();
    dryGain = null;
  }
  if (wetGain) {
    wetGain.disconnect();
    wetGain = null;
  }
  if (inputAnalyser) {
    inputAnalyser.disconnect();
    inputAnalyser = null;
  }
  if (outputAnalyser) {
    outputAnalyser.disconnect();
    outputAnalyser = null;
  }
  for (const analyser of [aecMicAnalyser, aecReferenceAnalyser, aecOutputAnalyser]) {
    analyser?.disconnect();
  }
  aecMicAnalyser = null;
  aecReferenceAnalyser = null;
  aecOutputAnalyser = null;
  aecMicMeterData = null;
  aecReferenceMeterData = null;
  aecOutputMeterData = null;
  if (microphoneStream) {
    microphoneStream.getTracks().forEach((track) => track.stop());
    microphoneStream = null;
  }
  if (ownsAudioContext && audioContext && audioContext.state !== "closed") {
    await audioContext.close();
  }

  audioContext = null;
  ownsAudioContext = false;
  inputMeterData = null;
  outputMeterData = null;
  inputWaveformHistory.length = 0;
  outputWaveformHistory.length = 0;
  lastWaveformUpdate = 0;
  drawWaveform(inputWaveform, inputWaveformHistory, "--dat-cat-1");
  drawWaveform(outputWaveform, outputWaveformHistory, "--dat-cat-3");
  microphoneMeter.querySelector("span").style.width = "0";
  outputMeter.querySelector("span").style.height = "0";
  outputMeter.querySelector("span").style.width = "";
  microphoneMeter.setAttribute("aria-valuenow", "-60");
  outputMeter.setAttribute("aria-valuenow", "-60");
  microphoneLevelReadout.textContent = "— dBFS";
  outputLevelReadout.textContent = "— dBFS";
  microphoneMeter.classList.remove("is-clipping");
  outputMeter.classList.remove("is-clipping");
  sampleRateOutput.textContent = "—";
  loadedModulesOutput.textContent = `0 / ${moduleSpecs.length}`;
  microphoneState.textContent = "STOPPED";
  microphoneState.removeAttribute("data-state");
  outputState.textContent = "STANDBY";
  outputState.removeAttribute("data-state");
  engineBadge.textContent = "STOPPED";
  engineBadge.removeAttribute("data-state");
  audioTestState.textContent = "MICROPHONE INPUT";
  audioTestStatus.textContent = recordedAudioBuffer
    ? "Engine stopped. Your recording is retained and can be played after restarting."
    : testAudioBuffer
      ? `Engine stopped. ${testAudioLabel} is loaded and can be played after restarting.`
      : "Start the engine to record or play test audio.";
  const selectedInput = inputDeviceSelect.selectedOptions[0]?.textContent;
  setInputDeviceStatus(selectedInput
    ? `${selectedInput} is selected for the next engine start.`
    : "Select a microphone before starting the engine.");

  for (const spec of moduleSpecs) {
    renderModuleControls(null, spec);
  }

  updateInputDeviceControls();
  stopAudioButton.disabled = true;
  setInitialControls();
  updateAecReferenceStatus();
  updateStoppedPlaybackStatus();
  updateAudioTestControls();

  if (showStatus) {
    updateStatus("Engine stopped");
    addRuntimeMessage("Engine stopped; microphone released.");
  }
}

inputDeviceSelect.addEventListener("change", () => {
  const selectedInput = inputDeviceSelect.selectedOptions[0];
  persistInputDeviceSelection(inputDeviceSelect.value);
  setInputDeviceStatus(inputDeviceSelect.value
    ? `${selectedInput?.textContent || "Microphone"} selected.`
    : "Select a microphone before starting the engine.");
  updateInputDeviceControls();
});
refreshInputDevicesButton.addEventListener("click", () => {
  refreshInputDevices().catch((error) => {
    setInputDeviceStatus(`Could not refresh microphones: ${error.message}`, true);
    addRuntimeMessage(`Could not refresh microphones: ${error.message}`);
  });
});
enableInputDevicesButton.addEventListener("click", () => {
  requestInputDeviceNames().catch((error) => {
    setInputDeviceStatus(`Could not access microphones: ${error.message}`, true);
    addRuntimeMessage(`Could not access microphones: ${error.message}`);
  });
});
if (navigator.mediaDevices?.addEventListener) {
  navigator.mediaDevices.addEventListener("devicechange", () => {
    if (!audioContext && !isStarting) {
      refreshInputDevices().catch((error) => {
        setInputDeviceStatus(`Could not refresh microphones: ${error.message}`, true);
        addRuntimeMessage(`Could not refresh microphones: ${error.message}`);
      });
    }
  });
}
startAudioButton.addEventListener("click", () => startAudio());
stopAudioButton.addEventListener("click", () => stopAudio(true));
recordAudioButton.addEventListener("click", () => {
  try {
    startRecording();
  } catch (error) {
    reportAudioTestError("Could not start microphone recording", error);
  }
});
finishRecordingButton.addEventListener("click", async () => {
  try {
    await finishRecording();
  } catch (error) {
    reportAudioTestError("Could not finish microphone recording", error);
  }
});
playClipOnceButton.addEventListener("click", () => {
  try {
    const clip = getSelectedClip();
    if (!clip?.buffer) {
      throw new Error("Load or record a clip first.");
    }
    playTestBuffer(clip.buffer, clip.label, false);
  } catch (error) {
    reportAudioTestError("Could not play clip", error);
  }
});
loopClipButton.addEventListener("click", () => {
  try {
    const clip = getSelectedClip();
    if (!clip?.buffer) {
      throw new Error("Load or record a clip first.");
    }
    playTestBuffer(clip.buffer, clip.label, true);
  } catch (error) {
    reportAudioTestError("Could not loop clip", error);
  }
});
stopClipButton.addEventListener("click", stopTestPlayback);
wavFileInput.addEventListener("change", async () => {
  const [file] = wavFileInput.files || [];
  if (!file) {
    return;
  }
  try {
    if (!audioContext) {
      throw new Error("Start the audio engine before loading a WAV file.");
    }
    const decoded = await audioContext.decodeAudioData(await file.arrayBuffer());
    testAudioBuffer = decoded;
    testAudioLabel = file.name;
    refreshClipSelector("wav");
    audioTestStatus.textContent =
      `Loaded ${file.name} · ${decoded.duration.toFixed(2)} s · ${decoded.numberOfChannels} channel(s) · ${decoded.sampleRate} Hz`;
    wavFileInput.value = "";
    updateAudioTestControls();
  } catch (error) {
    testAudioBuffer = null;
    testAudioLabel = "";
    refreshClipSelector();
    updateClipPlaybackLabels();
    wavFileInput.value = "";
    updateAudioTestControls();
    reportAudioTestError(`Could not load ${file.name}`, error);
  }
});
applyPresetButton.addEventListener("click", () => {
  try {
    applyPreset(presetSelect.value);
  } catch (error) {
    const message = `Could not apply preset: ${error.message}`;
    presetStatus.textContent = message;
    addRuntimeMessage(message);
  }
});
savePresetButton.addEventListener("click", () => {
  try {
    saveCurrentPreset();
  } catch (error) {
    const message = `Could not save preset: ${error.message}`;
    presetStatus.textContent = message;
    addRuntimeMessage(message);
  }
});
deletePresetButton.addEventListener("click", () => {
  try {
    deleteSelectedPreset();
  } catch (error) {
    const message = `Could not delete preset: ${error.message}`;
    presetStatus.textContent = message;
    addRuntimeMessage(message);
  }
});
presetSelect.addEventListener("change", () => {
  deletePresetButton.disabled = !customPresets.some(({ id }) => id === presetSelect.value);
});
downloadRecordingButton.addEventListener("click", () => {
  if (!recordingBlob) {
    return;
  }
  const url = URL.createObjectURL(recordingBlob);
  const download = document.createElement("a");
  download.href = url;
  download.download = "seamic-microphone-recording.wav";
  download.click();
  URL.revokeObjectURL(url);
});
chainToggleButton.addEventListener("click", () => {
  if (!soloModuleId) {
    setChainBypassed(isChainActive);
  }
});

for (const button of moduleToggleButtons) {
  button.addEventListener("click", () => {
    const moduleId = button.dataset.module;
    if (!audioContext || soloModuleId || (moduleId === "aec" && !hasPlaybackReference())) {
      return;
    }

    const isCurrentlyActive = isChainActive && moduleActive[moduleId];
    moduleActive[moduleId] = !isCurrentlyActive;
    isChainActive = true;
    applyDspMode();
    updateSoloControls();
    updateAecReferenceStatus();
    updateOutputRoute();
  });
}

for (const button of soloButtons) {
  button.addEventListener("click", () => toggleSolo(button.dataset.solo));
}

loadedModulesOutput.textContent = `0 / ${moduleSpecs.length}`;
for (const spec of moduleSpecs) {
  renderModuleControls(null, spec);
}
loadPresets();
renderPresetOptions();
try {
  applyPreset(selectedPresetId, false);
  if (presetLoadWarning) {
    presetStatus.textContent = presetLoadWarning;
  }
} catch (error) {
  const message = `Could not initialize DSP presets: ${error.message}`;
  presetStatus.textContent = message;
  addRuntimeMessage(message);
}
refreshClipSelector();
setInitialControls();
updateAecReferenceStatus();
updateInputDeviceControls();
refreshInputDevices().catch((error) => {
  setInputDeviceStatus(`Could not list microphones: ${error.message}`, true);
  addRuntimeMessage(`Could not list microphones: ${error.message}`);
});
