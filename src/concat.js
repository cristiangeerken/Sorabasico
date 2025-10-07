import { FFmpeg } from '@ffmpeg/ffmpeg';
import { fetchFile, toBlobURL } from '@ffmpeg/util';

let ffmpegInstance = null;
let ffmpegLoaded = false;

async function loadFFmpeg() {
  if (ffmpegLoaded && ffmpegInstance) {
    return ffmpegInstance;
  }

  try {
    ffmpegInstance = new FFmpeg();

    const baseURL = 'https://unpkg.com/@ffmpeg/core@0.12.6/dist/esm';

    await ffmpegInstance.load({
      coreURL: await toBlobURL(`${baseURL}/ffmpeg-core.js`, 'text/javascript'),
      wasmURL: await toBlobURL(`${baseURL}/ffmpeg-core.wasm`, 'application/wasm')
    });

    ffmpegLoaded = true;
    return ffmpegInstance;
  } catch (error) {
    console.error('Failed to load FFmpeg:', error);
    throw error;
  }
}

export async function concatenateWithFFmpeg(videoBlobs) {
  try {
    const ffmpeg = await loadFFmpeg();

    for (let i = 0; i < videoBlobs.length; i++) {
      const inputName = `input${i}.mp4`;
      await ffmpeg.writeFile(inputName, await fetchFile(videoBlobs[i]));
    }

    const concatList = videoBlobs.map((_, i) => `file 'input${i}.mp4'`).join('\n');
    await ffmpeg.writeFile('concat.txt', concatList);

    await ffmpeg.exec([
      '-f', 'concat',
      '-safe', '0',
      '-i', 'concat.txt',
      '-c', 'copy',
      'output.mp4'
    ]);

    const data = await ffmpeg.readFile('output.mp4');
    const blob = new Blob([data.buffer], { type: 'video/mp4' });

    for (let i = 0; i < videoBlobs.length; i++) {
      await ffmpeg.deleteFile(`input${i}.mp4`);
    }
    await ffmpeg.deleteFile('concat.txt');
    await ffmpeg.deleteFile('output.mp4');

    return blob;
  } catch (error) {
    console.error('FFmpeg concatenation failed:', error);
    throw error;
  }
}

export async function concatenateWithReencode(videoBlobs) {
  try {
    const ffmpeg = await loadFFmpeg();

    for (let i = 0; i < videoBlobs.length; i++) {
      const inputName = `input${i}.mp4`;
      await ffmpeg.writeFile(inputName, await fetchFile(videoBlobs[i]));
    }

    const concatList = videoBlobs.map((_, i) => `file 'input${i}.mp4'`).join('\n');
    await ffmpeg.writeFile('concat.txt', concatList);

    await ffmpeg.exec([
      '-f', 'concat',
      '-safe', '0',
      '-i', 'concat.txt',
      '-c:v', 'libx264',
      '-preset', 'medium',
      '-crf', '23',
      '-c:a', 'aac',
      '-b:a', '128k',
      '-ar', '48000',
      '-ac', '2',
      'output.mp4'
    ]);

    const data = await ffmpeg.readFile('output.mp4');
    const blob = new Blob([data.buffer], { type: 'video/mp4' });

    for (let i = 0; i < videoBlobs.length; i++) {
      await ffmpeg.deleteFile(`input${i}.mp4`);
    }
    await ffmpeg.deleteFile('concat.txt');
    await ffmpeg.deleteFile('output.mp4');

    return blob;
  } catch (error) {
    console.error('FFmpeg re-encode concatenation failed:', error);
    throw error;
  }
}

export async function concatenateSegments(videoBlobs, onProgress) {
  if (!videoBlobs || videoBlobs.length === 0) {
    throw new Error('No video segments to concatenate');
  }

  if (videoBlobs.length === 1) {
    return videoBlobs[0];
  }

  if (onProgress) {
    onProgress({ status: 'Loading FFmpeg...', progress: 0 });
  }

  try {
    if (onProgress) {
      onProgress({ status: 'Concatenating (copy mode)...', progress: 30 });
    }

    const result = await concatenateWithFFmpeg(videoBlobs);

    if (onProgress) {
      onProgress({ status: 'Concatenation complete', progress: 100 });
    }

    return result;
  } catch (error) {
    console.warn('Copy mode failed, attempting re-encode:', error.message);

    try {
      if (onProgress) {
        onProgress({ status: 'Concatenating (re-encode mode)...', progress: 50 });
      }

      const result = await concatenateWithReencode(videoBlobs);

      if (onProgress) {
        onProgress({ status: 'Concatenation complete', progress: 100 });
      }

      return result;
    } catch (reencodeError) {
      console.error('Both concat methods failed:', reencodeError);
      throw new Error('Failed to concatenate videos with both methods');
    }
  }
}
