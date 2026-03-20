import { test, expect, Page } from '@playwright/test';

const UNSPLASH_ROUTE = '**/images.unsplash.com/**';
const ONE_BY_ONE_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO9WQxsAAAAASUVORK5CYII=';

function bufferFromBase64(data: string) {
  return Buffer.from(data, 'base64');
}

async function createImagePayload(
  page: Page,
  {
    width,
    height,
    type,
    name,
  }: { width: number; height: number; type: 'image/png' | 'image/jpeg' | 'image/webp'; name: string }
) {
  const dataUrl = await page.evaluate(
    ({ width, height, type }) => {
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, width, height);
      }
      return canvas.toDataURL(type);
    },
    { width, height, type }
  );

  const base64 = dataUrl.split(',')[1];
  return {
    name,
    mimeType: type,
    buffer: Buffer.from(base64, 'base64'),
  };
}

async function uploadRoomImage(page: Page, filePayload: { name: string; mimeType: string; buffer: Buffer }) {
  const uploadLabel = page.locator('label', { hasText: 'Upload Your Room' });
  await uploadLabel.locator('input[type="file"]').setInputFiles(filePayload);
}

async function setRangeValue(page: Page, label: string, value: number) {
  const addPanel = page.locator('div', { hasText: 'Furniture Image' }).first();
  const slider = addPanel
    .locator('label', { hasText: label })
    .locator('..')
    .locator('..')
    .locator('input[type="range"]')
    .first();

  await slider.evaluate((element, nextValue) => {
    const input = element as HTMLInputElement;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    if (setter) {
      setter.call(input, nextValue);
    } else {
      input.value = nextValue;
    }
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }, String(value));

  await expect(slider).toHaveValue(String(value));
}

async function generateResults(page: Page, count: number) {
  await page.getByRole('button', { name: 'Add' }).click();
  await setRangeValue(page, 'Number of Images', count);

  await expect(page.getByRole('button', { name: 'Generate Room' })).toBeEnabled();
  await page.getByRole('button', { name: 'Generate Room' }).click();
  await expect(page.getByRole('button', { name: 'Try Again' })).toBeVisible();
}

test.beforeEach(async ({ page }) => {
  await page.route(UNSPLASH_ROUTE, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'image/png',
      body: bufferFromBase64(ONE_BY_ONE_PNG_BASE64),
    });
  });

  await page.goto('/');
});


test('file type validation blocks unsupported uploads', async ({ page }) => {
  const invalidSvg = {
    name: 'bad.svg',
    mimeType: 'image/svg+xml',
    buffer: Buffer.from('<svg></svg>'),
  };

  await uploadRoomImage(page, invalidSvg);
  await expect(page.getByText('Unsupported file type. Use PNG, JPG, or WEBP.')).toBeVisible();
});

test('file size validation rejects oversized uploads', async ({ page }) => {
  const oversized = {
    name: 'huge.png',
    mimeType: 'image/png',
    buffer: Buffer.alloc(11 * 1024 * 1024, 1),
  };

  await uploadRoomImage(page, oversized);
  await expect(page.getByText('File too large. Max size is 10MB.')).toBeVisible();
});

test('dimension validation rejects too-small images', async ({ page }) => {
  const tiny = await createImagePayload(page, {
    width: 50,
    height: 100,
    type: 'image/png',
    name: 'tiny.png',
  });

  await uploadRoomImage(page, tiny);
  await expect(page.getByText('Image too small. Minimum 64px on the shortest side.')).toBeVisible();
});

test('dimension validation rejects too-large images', async ({ page }) => {
  const giant = await createImagePayload(page, {
    width: 5000,
    height: 100,
    type: 'image/png',
    name: 'giant.png',
  });

  await uploadRoomImage(page, giant);
  await expect(page.getByText('Image too large. Max 4096px on the longest side.')).toBeVisible();
});

test('aspect ratio validation rejects extreme ratios', async ({ page }) => {
  const wide = await createImagePayload(page, {
    width: 600,
    height: 100,
    type: 'image/png',
    name: 'wide.png',
  });

  await uploadRoomImage(page, wide);
  await expect(page.getByText('Image aspect ratio too extreme. Max 5:1.')).toBeVisible();
});

test('edit image and try again navigation works', async ({ page }) => {
  const roomImage = await createImagePayload(page, {
    width: 800,
    height: 600,
    type: 'image/png',
    name: 'room.png',
  });

  await uploadRoomImage(page, roomImage);
  await expect(page.locator('img[alt="Room"]')).toBeVisible();
  await generateResults(page, 3);

  await page.locator('button[aria-label="Go to image 2"]').click();
  const selectedSrc = await page.locator('.ring-carousel-ring img').getAttribute('src');

  await page.getByRole('button', { name: 'Edit This Image' }).click();
  await expect(page.locator('img[alt="Room"]')).toBeVisible();
  await expect(page.locator('img[alt="Room"]')).toHaveAttribute('src', selectedSrc ?? '');

  await generateResults(page, 3);
  await page.getByRole('button', { name: 'Try Again' }).click();
  await expect(page.locator('img[alt="Room"]')).toBeVisible();
});

test('download works from results and fullscreen', async ({ page }) => {
  const roomImage = await createImagePayload(page, {
    width: 800,
    height: 600,
    type: 'image/png',
    name: 'room.png',
  });

  await uploadRoomImage(page, roomImage);
  await expect(page.locator('img[alt="Room"]')).toBeVisible();
  await generateResults(page, 3);

  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download' }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/interiorai-result-\d+-\d+\.png/);

  await page.locator('.ring-carousel-ring img').click();
  await expect(page.getByRole('button', { name: 'Download image' })).toBeVisible();

  const modalDownloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download image' }).click();
  const modalDownload = await modalDownloadPromise;
  expect(modalDownload.suggestedFilename()).toMatch(/interiorai-result-\d+-\d+\.png/);
});

