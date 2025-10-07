import { planPrompts } from './planner.js';
import { createVideo, pollUntilComplete, downloadVideoContent } from './soraApi.js';
import { extractLastFrame, parseSizeString } from './frameGrabber.js';
import { concatenateSegments } from './concat.js';

const state = {
  apiKey: '',
  basePrompt: '',
  model: 'sora-2',
  size: '1280x720',
  secondsPerSegment: 8,
  numSegments: 3,
  plannedSegments: null,
  generatedSegments: [],
  finalVideo: null,
  isGenerating: false
};

const SIZE_CONSTRAINTS = {
  'sora-2': ['1280x720', '720x1280'],
  'sora-2-pro': ['1280x720', '720x1280', '1024x1792', '1792x1024']
};

function initUI() {
  const apiKeyInput = document.getElementById('apiKey');
  const basePromptInput = document.getElementById('basePrompt');
  const modelSelect = document.getElementById('model');
  const sizeSelect = document.getElementById('size');
  const secondsSelect = document.getElementById('secondsPerSegment');
  const numSegmentsInput = document.getElementById('numSegments');
  const planBtn = document.getElementById('planBtn');
  const generateBtn = document.getElementById('generateBtn');

  apiKeyInput.addEventListener('input', (e) => {
    state.apiKey = e.target.value.trim();
  });

  basePromptInput.addEventListener('input', (e) => {
    state.basePrompt = e.target.value.trim();
  });

  modelSelect.addEventListener('change', (e) => {
    state.model = e.target.value;
    updateSizeOptions();
  });

  sizeSelect.addEventListener('change', (e) => {
    state.size = e.target.value;
  });

  secondsSelect.addEventListener('change', (e) => {
    state.secondsPerSegment = parseInt(e.target.value);
    updateTotalDuration();
  });

  numSegmentsInput.addEventListener('input', (e) => {
    state.numSegments = parseInt(e.target.value) || 2;
    updateTotalDuration();
  });

  planBtn.addEventListener('click', handlePlan);
  generateBtn.addEventListener('click', handleGenerate);

  state.basePrompt = basePromptInput.value.trim();
  state.secondsPerSegment = parseInt(secondsSelect.value);
  state.numSegments = parseInt(numSegmentsInput.value);

  updateTotalDuration();
}

function updateSizeOptions() {
  const sizeSelect = document.getElementById('size');
  const allowedSizes = SIZE_CONSTRAINTS[state.model];

  Array.from(sizeSelect.options).forEach(option => {
    if (option.value === '') return;
    option.disabled = !allowedSizes.includes(option.value);
  });

  if (!allowedSizes.includes(state.size)) {
    state.size = allowedSizes[0];
    sizeSelect.value = state.size;
  }
}

function updateTotalDuration() {
  const total = state.secondsPerSegment * state.numSegments;
  document.getElementById('totalDuration').textContent = `Total: ${total} seconds`;
}

function showError(message) {
  const errorDisplay = document.getElementById('errorDisplay');
  errorDisplay.textContent = message;
  errorDisplay.classList.remove('hidden');

  setTimeout(() => {
    errorDisplay.classList.add('hidden');
  }, 10000);
}

function validateInputs() {
  if (!state.apiKey) {
    throw new Error('Please enter your OpenAI API Key');
  }

  if (!state.basePrompt) {
    throw new Error('Please enter a base prompt');
  }

  if (![4, 8, 12].includes(state.secondsPerSegment)) {
    throw new Error('Seconds per segment must be 4, 8, or 12');
  }

  if (state.numSegments < 2 || state.numSegments > 20) {
    throw new Error('Number of segments must be between 2 and 20');
  }

  const allowedSizes = SIZE_CONSTRAINTS[state.model];
  if (!allowedSizes.includes(state.size)) {
    throw new Error(`Size ${state.size} is not allowed for model ${state.model}`);
  }
}

async function handlePlan() {
  try {
    validateInputs();

    const planBtn = document.getElementById('planBtn');
    planBtn.disabled = true;
    planBtn.innerHTML = '<span class="btn-icon">⏳</span> Planning...';

    state.plannedSegments = await planPrompts(
      state.apiKey,
      state.basePrompt,
      state.secondsPerSegment,
      state.numSegments
    );

    displayPlannedSegments();

    document.getElementById('generateBtn').disabled = false;

    planBtn.disabled = false;
    planBtn.innerHTML = '<span class="btn-icon">🎬</span> Plan Segments';
  } catch (error) {
    console.error('Planning error:', error);
    showError(`Planning failed: ${error.message}`);

    const planBtn = document.getElementById('planBtn');
    planBtn.disabled = false;
    planBtn.innerHTML = '<span class="btn-icon">🎬</span> Plan Segments';
  }
}

function displayPlannedSegments() {
  const planOutput = document.getElementById('planOutput');
  const planSegments = document.getElementById('planSegments');

  planSegments.innerHTML = '';

  state.plannedSegments.forEach((seg, index) => {
    const segmentDiv = document.createElement('div');
    segmentDiv.className = 'plan-segment';

    const title = document.createElement('h4');
    title.textContent = `${index + 1}. ${seg.title || `Segment ${index + 1}`} (${seg.seconds}s)`;

    const prompt = document.createElement('pre');
    prompt.textContent = seg.prompt;

    segmentDiv.appendChild(title);
    segmentDiv.appendChild(prompt);
    planSegments.appendChild(segmentDiv);
  });

  planOutput.classList.remove('hidden');
}

async function handleGenerate() {
  if (!state.plannedSegments || state.plannedSegments.length === 0) {
    showError('Please plan segments first');
    return;
  }

  if (state.isGenerating) {
    return;
  }

  state.isGenerating = true;
  state.generatedSegments = [];

  const generateBtn = document.getElementById('generateBtn');
  generateBtn.disabled = true;

  const progressContainer = document.getElementById('progressContainer');
  const segmentStatus = document.getElementById('segmentStatus');
  progressContainer.classList.remove('hidden');
  segmentStatus.classList.remove('hidden');
  segmentStatus.innerHTML = '';

  try {
    validateInputs();

    const { width, height } = parseSizeString(state.size);
    let inputReferenceBlob = null;

    for (let i = 0; i < state.plannedSegments.length; i++) {
      const segment = state.plannedSegments[i];

      const segmentDiv = document.createElement('div');
      segmentDiv.className = 'segment-status-item';
      segmentDiv.innerHTML = `
        <div class="segment-status-header">
          <strong>Segment ${i + 1} / ${state.plannedSegments.length}</strong>
          <span class="segment-status-label">Initializing...</span>
        </div>
        <div class="segment-progress-bar">
          <div class="segment-progress-fill" style="width: 0%"></div>
        </div>
        <div class="segment-actions hidden">
          <button class="btn-download-segment btn btn-secondary btn-sm" data-index="${i}">
            <span class="btn-icon">⬇</span>
            Download Segment ${i + 1}
          </button>
        </div>
      `;
      segmentStatus.appendChild(segmentDiv);

      const statusLabel = segmentDiv.querySelector('.segment-status-label');
      const progressFill = segmentDiv.querySelector('.segment-progress-fill');
      const segmentActions = segmentDiv.querySelector('.segment-actions');
      const downloadBtn = segmentDiv.querySelector('.btn-download-segment');

      updateOverallProgress((i / state.plannedSegments.length) * 100, `Generating segment ${i + 1}/${state.plannedSegments.length}`);

      let inputReference = null;
      if (inputReferenceBlob) {
        inputReference = new File([inputReferenceBlob], 'reference.jpg', { type: 'image/jpeg' });
      }

      const job = await createVideo(state.apiKey, {
        prompt: segment.prompt,
        size: state.size,
        seconds: segment.seconds,
        model: state.model,
        inputReference
      });

      statusLabel.textContent = 'Created job...';

      const completedJob = await pollUntilComplete(
        state.apiKey,
        job,
        ({ status, progress }) => {
          statusLabel.textContent = `${status} ${progress.toFixed(1)}%`;
          progressFill.style.width = `${progress}%`;
        }
      );

      statusLabel.textContent = 'Downloading...';

      const videoBlob = await downloadVideoContent(state.apiKey, completedJob.id);

      state.generatedSegments.push({
        blob: videoBlob,
        id: completedJob.id,
        index: i
      });

      statusLabel.textContent = 'Complete';
      progressFill.style.width = '100%';
      segmentDiv.classList.add('complete');
      segmentActions.classList.remove('hidden');

      downloadBtn.onclick = () => {
        const url = URL.createObjectURL(videoBlob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `segment_${i + 1}.mp4`;
        a.click();
        URL.revokeObjectURL(url);
      };

      statusLabel.textContent = 'Extracting last frame...';

      if (i < state.plannedSegments.length - 1) {
        inputReferenceBlob = await extractLastFrame(videoBlob, width, height);
      }
    }

    displaySegmentPreview();

    updateOverallProgress(95, 'Concatenating segments...');

    const finalVideoBlob = await concatenateSegments(
      state.generatedSegments.map(s => s.blob),
      ({ status, progress }) => {
        updateOverallProgress(95 + (progress * 0.05), status);
      }
    );

    state.finalVideo = finalVideoBlob;

    displayFinalVideo(finalVideoBlob);

    updateOverallProgress(100, 'Complete!');

    setTimeout(() => {
      progressContainer.classList.add('hidden');
    }, 2000);
  } catch (error) {
    console.error('Generation error:', error);
    showError(`Generation failed: ${error.message}`);
  } finally {
    state.isGenerating = false;
    generateBtn.disabled = false;
  }
}

function updateOverallProgress(percent, text) {
  const progressText = document.getElementById('progressText');
  const progressPercent = document.getElementById('progressPercent');
  const progressFill = document.getElementById('progressFill');

  progressText.textContent = text;
  progressPercent.textContent = `${Math.round(percent)}%`;
  progressFill.style.width = `${percent}%`;
}

function displaySegmentPreview() {
  const segmentPreview = document.getElementById('segmentPreview');
  const segmentGallery = document.getElementById('segmentGallery');

  segmentGallery.innerHTML = '';

  state.generatedSegments.forEach((seg, index) => {
    const item = document.createElement('div');
    item.className = 'segment-item';

    const video = document.createElement('video');
    video.controls = true;
    video.src = URL.createObjectURL(seg.blob);

    const label = document.createElement('div');
    label.className = 'segment-label';
    label.textContent = `Segment ${index + 1}`;

    item.appendChild(video);
    item.appendChild(label);
    segmentGallery.appendChild(item);
  });

  segmentPreview.classList.remove('hidden');
}

function displayFinalVideo(videoBlob) {
  const finalPreview = document.getElementById('finalPreview');
  const finalVideo = document.getElementById('finalVideo');
  const downloadBtn = document.getElementById('downloadBtn');

  finalVideo.src = URL.createObjectURL(videoBlob);

  downloadBtn.onclick = () => {
    const url = URL.createObjectURL(videoBlob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'sora-chained-video.mp4';
    a.click();
    URL.revokeObjectURL(url);
  };

  finalPreview.classList.remove('hidden');
}

document.addEventListener('DOMContentLoaded', initUI);
