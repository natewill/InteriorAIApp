import { BoundingBox } from '@/types/furnitureFinder';

async function imageToBuffer(imageUrl: string): Promise<Buffer> {
  if (imageUrl.startsWith('data:')) {
    const match = imageUrl.match(/^data:[^;]+;base64,(.+)$/);
    if (!match) {
      throw new Error('Invalid image data URL');
    }
    return Buffer.from(match[1], 'base64');
  }

  const response = await fetch(imageUrl);
  if (!response.ok) {
    throw new Error(`Failed to fetch image: ${response.status}`);
  }

  return Buffer.from(await response.arrayBuffer());
}

export async function cropImage(imageUrl: string, box: BoundingBox, padding: number): Promise<string> {
  const sharp = (await import('sharp')).default;
  const imageBuffer = await imageToBuffer(imageUrl);
  const metadata = await sharp(imageBuffer).metadata();

  const width = metadata.width;
  const height = metadata.height;

  if (!width || !height) {
    throw new Error('Image dimensions are missing');
  }

  const boxWidth = box.x2 - box.x1;
  const boxHeight = box.y2 - box.y1;
  const padX = boxWidth * padding;
  const padY = boxHeight * padding;

  const left = Math.max(0, Math.floor(box.x1 - padX));
  const top = Math.max(0, Math.floor(box.y1 - padY));
  const cropWidth = Math.min(width - left, Math.ceil(boxWidth + padX * 2));
  const cropHeight = Math.min(height - top, Math.ceil(boxHeight + padY * 2));

  const croppedBuffer = await sharp(imageBuffer)
    .extract({ left, top, width: cropWidth, height: cropHeight })
    .jpeg({ quality: 85 })
    .toBuffer();

  return `data:image/jpeg;base64,${croppedBuffer.toString('base64')}`;
}
