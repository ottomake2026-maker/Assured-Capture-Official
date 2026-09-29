/**
 * Avatar image processing and optimization utilities.
 * Ensures avatars are center-cropped square JPEG data URLs of small footprint (~15-30KB)
 * for instant rendering across all devices, retina sharpness, and seamless Firestore storage.
 */

export async function optimizeAvatarImage(file: File, maxDim = 320, quality = 0.85): Promise<string> {
  if (!file.type.startsWith('image/')) {
    throw new Error('Please select a valid image file (JPG, PNG, WebP).');
  }

  // Enforce reasonable original file size limit before client processing (15MB max)
  if (file.size > 15 * 1024 * 1024) {
    throw new Error('Image file is too large. Please select a photo under 15MB.');
  }

  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Failed to read selected image file.'));
    reader.onload = (e) => {
      const dataUrl = e.target?.result as string;
      if (!dataUrl) {
        return reject(new Error('Failed to parse image data.'));
      }

      const img = new Image();
      img.onerror = () => reject(new Error('Failed to decode image. Please try another photo.'));
      img.onload = () => {
        try {
          const canvas = document.createElement('canvas');
          canvas.width = maxDim;
          canvas.height = maxDim;
          const ctx = canvas.getContext('2d');
          if (!ctx) {
            return resolve(dataUrl);
          }

          // Center-crop to 1:1 aspect ratio
          const minSide = Math.min(img.width, img.height);
          const sx = (img.width - minSide) / 2;
          const sy = (img.height - minSide) / 2;

          ctx.imageSmoothingEnabled = true;
          ctx.imageSmoothingQuality = 'high';
          ctx.drawImage(img, sx, sy, minSide, minSide, 0, 0, maxDim, maxDim);

          const optimizedDataUrl = canvas.toDataURL('image/jpeg', quality);
          resolve(optimizedDataUrl);
        } catch (err) {
          console.warn('Canvas optimization fallback to original dataUrl:', err);
          resolve(dataUrl);
        }
      };
      img.src = dataUrl;
    };
    reader.readAsDataURL(file);
  });
}

/**
 * Returns an avatar storage URI reference for persistence tracking.
 */
export function getAvatarStorageUri(userId: string): string {
  return `gs://assured-capture-storage/users/${userId}/avatar.jpg`;
}
