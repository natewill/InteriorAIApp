const IMGBB_UPLOAD_URL = 'https://api.imgbb.com/1/upload';

interface ImgbbResponse {
  data: {
    display_url: string;
  };
  success: boolean;
}

export async function uploadToImgbb(base64Image: string, expirationSeconds: number): Promise<string> {
  const apiKey = (process.env.IMGBB_API_KEY || '').trim();
  if (!apiKey) {
    throw new Error('IMGBB_API_KEY is not set');
  }

  const formData = new FormData();
  formData.append('key', apiKey);
  formData.append('image', base64Image.replace(/^data:image\/\w+;base64,/, ''));
  formData.append('expiration', String(expirationSeconds));

  const response = await fetch(IMGBB_UPLOAD_URL, {
    method: 'POST',
    body: formData,
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`imgbb upload failed: ${response.status} - ${text}`);
  }

  const body = await response.json() as ImgbbResponse;
  if (!body.success) {
    throw new Error('imgbb upload failed');
  }

  return body.data.display_url;
}
