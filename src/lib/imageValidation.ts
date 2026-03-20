export const IMAGE_VALIDATION = {
  allowedTypes: ['image/jpeg', 'image/png', 'image/webp'],
  maxSizeBytes: 10 * 1024 * 1024,
  minDimension: 64,
  maxDimension: 4096,
  maxAspectRatio: 5,
} as const;

export interface ImageValidationResult {
  ok: boolean;
  error?: string;
  width?: number;
  height?: number;
}

function getImageDimensions(file: File): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();

    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve({ width: img.naturalWidth, height: img.naturalHeight });
    };

    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Could not read image.'));
    };

    img.src = url;
  });
}

export async function validateImageFile(file: File): Promise<ImageValidationResult> {
  const { allowedTypes, maxSizeBytes, minDimension, maxDimension, maxAspectRatio } = IMAGE_VALIDATION;

  if (!(allowedTypes as readonly string[]).includes(file.type)) {
    return {
      ok: false,
      error: 'Unsupported file type. Use PNG, JPG, or WEBP.',
    };
  }

  if (file.size > maxSizeBytes) {
    return {
      ok: false,
      error: 'File too large. Max size is 10MB.',
    };
  }

  try {
    const { width, height } = await getImageDimensions(file);
    const longestSide = Math.max(width, height);
    const shortestSide = Math.min(width, height);
    const aspectRatio = longestSide / shortestSide;

    if (shortestSide < minDimension) {
      return {
        ok: false,
        error: `Image too small. Minimum ${minDimension}px on the shortest side.`,
        width,
        height,
      };
    }

    if (longestSide > maxDimension) {
      return {
        ok: false,
        error: `Image too large. Max ${maxDimension}px on the longest side.`,
        width,
        height,
      };
    }

    if (aspectRatio > maxAspectRatio) {
      return {
        ok: false,
        error: `Image aspect ratio too extreme. Max ${maxAspectRatio}:1.`,
        width,
        height,
      };
    }

    return { ok: true, width, height };
  } catch {
    return {
      ok: false,
      error: 'Could not read image. The file may be corrupt.',
    };
  }
}
