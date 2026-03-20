# Vercel Deploy

## Project settings

- Import this repo in Vercel.
- Framework preset: **Next.js**.
- Build command: `npm run build`.
- Install command: `npm ci`.

## Required environment variables

Set these in Vercel for Production and Preview:

- `GEMINI_API_KEY`
- `FAL_KEY`
- `MODAL_DEPTH_URL`
- `SERPAPI_KEY`
- `IMGBB_API_KEY`

### SAM3 segmentation

Choose at least one option:

Option A (recommended):
- `MODAL_SAM3_TRACKER_URL`

Option B:
- `MODAL_SAM3_URL`

Option C:
- `RUNPOD_SAM3_TRACKER_ENDPOINT_ID`
- `RUNPOD_API_KEY`

Option D:
- `RUNPOD_SAM3_ENDPOINT_ID`
- `RUNPOD_API_KEY`

Option E:
- `RUNPOD_SAM3_URL`
- `RUNPOD_API_KEY` if this is a RunPod serverless API URL

### Furniture finder detector

Choose at least one option:

Option A (recommended):
- `MODAL_SAM3_DETECTOR_URL`

Option B:
- `RUNPOD_SAM3_DETECTOR_ENDPOINT_ID`
- `RUNPOD_API_KEY`

Option C:
- `RUNPOD_SAM3_URL`

Optional:
- `RUNPOD_LABEL_BATCH_SIZE` default `32`

## Local preflight

```bash
npm run build
```

## CLI deploy flow

```bash
npm i -g vercel
vercel login
vercel link
vercel --prod
```
