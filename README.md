# YouTube QoE Research Dashboard

A small research project for collecting public YouTube engagement data, processing it into video segments, and exploring the results in a browser dashboard. The collection and analysis pipeline runs from the command line. The dashboard is a static frontend that reads the generated JSON files.

## Project layout

```text
backend/src/          TypeScript collection and analysis scripts
backend/tsconfig.json TypeScript configuration
frontend/public/      Static dashboard (HTML, CSS, JavaScript)
data/raw/             Raw Phase 2 API collection (ignored by Git)
data/processed/       Phase 3 dataset consumed by the dashboard
data/experiments/     Phase 4 feature and measurement files
```

The checked-in Phase 3 sample dataset and Phase 4 files let you open the dashboard without running collection first. Raw API responses and comment data are kept out of Git.

## Requirements

- Node.js 22 or newer
- npm
- Python 3 (for the local static web server)
- A YouTube Data API v3 key to collect new data

## Install

From the repository root:

```bash
npm install
```

Create a local `.env` file or set `YOUTUBE_API_KEY` in your shell. Keep the key private and do not commit it. The collector reads the environment variable directly; it does not load `.env` files automatically.

```bash
export YOUTUBE_API_KEY="your-api-key"
```

On Windows PowerShell, use `$env:YOUTUBE_API_KEY="your-api-key"`.

## Run the data pipeline

Run commands from the repository root so data paths resolve correctly:

```bash
npm run collect
npm run preprocess
npm run phase4:prepare
```

Collection reads the API key and writes raw records to `data/raw/phase2/`. It uses YouTube Data API quota. To limit comment pages per video while collecting, set `MAX_COMMENT_PAGES` (default: 20; each page can contain up to 100 comments):

```bash
MAX_COMMENT_PAGES=2 npm run collect
```

Phase 3 preprocessing does not make network requests. It reads Phase 2 data and writes the dashboard dataset to `data/processed/phase3/`. You can pass alternate input and output paths:

```bash
npm run preprocess -- <phase2-directory> <phase3-directory>
```

Phase 4 preparation creates feature vectors, candidate moments, and a controlled measurement template under `data/experiments/phase4/`. After adding measured values to `measurements.csv`, train the experimental ridge model with:

```bash
npm run phase4:train
```

The model's computational QoE score is a proxy, not subjective ground truth. Define the score recipe before training and document it with any research results.

To evaluate a completed human annotation template:

```bash
npm run validate:labels -- path/to/completed-annotation-template.json
```

This writes a `-metrics.json` report beside the input file.

## View the dashboard

Start the local server in the repository root:

```bash
npm run serve
```

Open <http://localhost:8000/frontend/public/>. The browser needs HTTP access because it fetches JSON data. YouTube thumbnails and embedded players need an internet connection.

## Host the dashboard

The dashboard is static; it does not require a running Node backend. The repository includes `netlify.toml` for a Netlify deploy:

1. Push this repository to GitHub.
2. In Netlify, choose **Add new site → Import an existing project** and connect the repository.
3. Leave the build command empty and set the publish directory to `.` (the repository root). The included config also sets this value and routes the site root to the dashboard.
4. Deploy. Netlify will provide a public URL.

The deployed dashboard uses the checked-in files under `data/processed/phase3/` and `data/experiments/phase4/`. If you regenerate those datasets, commit the updated public data and redeploy. Do not publish `data/raw/phase2/`: it contains raw API responses and comment records. Review the processed dataset for research consent, privacy, and redistribution requirements before making it public; static files can be downloaded by anyone with the site URL.

For another static host, publish the repository root and configure `/` to serve `frontend/public/index.html`. Keep the `/data/...` paths available from that same site origin.

## Notes and limitations

- The emotion and comment-function labels are transparent keyword baselines, not validated models.
- Missing replay data is represented as unavailable rather than zero.
- Phase 4 needs source clips and measured impairment outcomes; the scripts do not create synthetic QoE labels.
- Collection results can change over time as YouTube data changes.
