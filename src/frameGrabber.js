export async function extractLastFrame(videoBlob, targetWidth, targetHeight) {
  return new Promise((resolve, reject) => {
    const video = document.createElement('video');
    const objectUrl = URL.createObjectURL(videoBlob);

    video.preload = 'metadata';
    video.muted = true;
    video.playsInline = true;

    video.onloadedmetadata = () => {
      video.currentTime = video.duration - 0.001;
    };

    video.onseeked = () => {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = targetWidth;
        canvas.height = targetHeight;

        const ctx = canvas.getContext('2d');
        ctx.drawImage(video, 0, 0, targetWidth, targetHeight);

        canvas.toBlob((blob) => {
          URL.revokeObjectURL(objectUrl);
          video.remove();

          if (blob) {
            resolve(blob);
          } else {
            reject(new Error('Failed to extract frame as blob'));
          }
        }, 'image/jpeg', 0.95);
      } catch (error) {
        URL.revokeObjectURL(objectUrl);
        video.remove();
        reject(error);
      }
    };

    video.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      video.remove();
      reject(new Error('Failed to load video for frame extraction'));
    };

    video.src = objectUrl;
  });
}

export function parseSizeString(sizeStr) {
  const [width, height] = sizeStr.split('x').map(Number);
  return { width, height };
}
