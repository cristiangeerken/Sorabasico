const API_BASE = 'https://api.openai.com/v1';

function guessMimeType(filename) {
  const ext = filename.toLowerCase().split('.').pop();
  const types = {
    'jpg': 'image/jpeg',
    'jpeg': 'image/jpeg',
    'png': 'image/png',
    'webp': 'image/webp'
  };
  return types[ext] || 'application/octet-stream';
}

export async function createVideo(apiKey, { prompt, size, seconds, model, inputReference }) {
  const formData = new FormData();
  formData.append('model', model);
  formData.append('prompt', prompt);
  formData.append('seconds', seconds.toString());

  if (size) {
    formData.append('size', size);
  }

  if (inputReference) {
    const mimeType = guessMimeType(inputReference.name);
    formData.append('input_reference', inputReference, inputReference.name);
  }

  try {
    const response = await fetch(`${API_BASE}/videos`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`
      },
      body: formData
    });

    if (!response.ok) {
      let errorMessage = `Failed to create video: ${response.status}`;
      try {
        const errorData = await response.json();
        errorMessage = errorData.error?.message || errorMessage;
      } catch (e) {
        const text = await response.text();
        errorMessage = text || errorMessage;
      }
      throw new Error(errorMessage);
    }

    return await response.json();
  } catch (error) {
    if (error.message.includes('Failed to fetch')) {
      throw new Error('Network error: Cannot connect to OpenAI API. Check your internet connection and API key.');
    }
    throw error;
  }
}

export async function retrieveVideo(apiKey, videoId) {
  try {
    const response = await fetch(`${API_BASE}/videos/${videoId}`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${apiKey}`
      }
    });

    if (!response.ok) {
      let errorMessage = `Failed to retrieve video: ${response.status}`;
      try {
        const errorData = await response.json();
        errorMessage = errorData.error?.message || errorMessage;
      } catch (e) {
        errorMessage = await response.text() || errorMessage;
      }
      throw new Error(errorMessage);
    }

    return await response.json();
  } catch (error) {
    if (error.message.includes('Failed to fetch')) {
      throw new Error('Network error: Cannot connect to OpenAI API.');
    }
    throw error;
  }
}

export async function pollUntilComplete(apiKey, job, onProgress, pollInterval = 2000) {
  let video = job;
  const videoId = video.id;

  while (video.status === 'queued' || video.status === 'in_progress') {
    const progress = parseFloat(video.progress || 0);
    const status = video.status === 'queued' ? 'Queued' : 'Processing';

    if (onProgress) {
      onProgress({ status, progress });
    }

    await new Promise(resolve => setTimeout(resolve, pollInterval));
    video = await retrieveVideo(apiKey, videoId);
  }

  if (video.status !== 'completed') {
    const errorMessage = video.error?.message || `Job ${videoId} failed with status: ${video.status}`;
    throw new Error(errorMessage);
  }

  return video;
}

export async function downloadVideoContent(apiKey, videoId, variant = 'video') {
  try {
    const response = await fetch(`${API_BASE}/videos/${videoId}/content?variant=${variant}`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${apiKey}`
      }
    });

    if (!response.ok) {
      throw new Error(`Failed to download video: ${response.status}`);
    }

    return await response.blob();
  } catch (error) {
    if (error.message.includes('Failed to fetch')) {
      throw new Error('Network error: Cannot download video content.');
    }
    throw error;
  }
}

export async function generateSegment(apiKey, config, inputReferenceBlob = null) {
  const { prompt, size, seconds, model } = config;

  let inputReference = null;
  if (inputReferenceBlob) {
    inputReference = new File([inputReferenceBlob], 'reference.jpg', { type: 'image/jpeg' });
  }

  const job = await createVideo(apiKey, {
    prompt,
    size,
    seconds,
    model,
    inputReference
  });

  const completedJob = await pollUntilComplete(
    apiKey,
    job,
    ({ status, progress }) => {
      console.log(`${status}: ${progress.toFixed(1)}%`);
    }
  );

  const videoBlob = await downloadVideoContent(apiKey, completedJob.id);

  return {
    videoBlob,
    videoId: completedJob.id,
    job: completedJob
  };
}
