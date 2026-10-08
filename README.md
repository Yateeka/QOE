# Behavior-Aware QoE Sensitivity Estimation

This project investigates whether public YouTube viewer-behavior signals can help identify video segments where streaming impairments have a larger effect on human-perceived quality of experience (QoE). It includes a data collection and preprocessing pipeline, a segment-level feature workflow, and a static research dashboard.

## Research overview

### Research question

> Do public behavioral signals provide additional information for predicting human-perceived QoE sensitivity beyond conventional network-side QoE measurements?

The project treats these as distinct types of evidence:

- **Behavioral salience:** public Most Replayed activity, timestamped-comment activity and function, and local replay prominence. This estimates which moments appear behaviorally important; it is not a QoE label.
- **Computational QoE:** measurements of controlled technical impairments, such as rebuffering duration and objective visual-quality changes. These describe technical severity and are not subjective ground truth.
- **Subjective QoE:** participant ratings collected while viewing clean and impaired clips. These are the human observations used for final evaluation.

The primary comparison is a conventional model based on network-side or computational QoE against a behavior-aware model that adds public behavioral features. The behavior-aware model is supported only if it improves prediction on subjective observations held out from calibration, augmentation, training, and model selection.

### Target population and intended scope

The method applies to public YouTube videos for which a Most Replayed graph and sufficient public behavioral information are available. This can favor popular, highly engaged videos, so findings should not be generalized to all online video. The planned larger public dataset is approximately 100–500 videos across sports, gaming, education, entertainment, podcasts/interviews, and instructional content. A smaller subset of approximately 24–40 videos is intended for controlled experiments and subjective evaluation.

The primary method does not depend on creator-only audience-retention data, individual playback or seeking histories, public dislike counts, or platform-internal analytics. Creator-provided retention exports may be considered separately as exploratory data.

### Analysis representation

Each video is divided into 100 equal relative-position bins. Candidate segment features include normalized replay intensity, local replay prominence, timestamp-comment activity, comment function or emotion, and relevant video-level controls. An initial behavioral salience score can combine these features with equal weights; learned weights should only be introduced after independent QoE outcomes are collected.

The planned experimental set samples segments across behavioral salience, content category, impairment type, and computational QoE. Clean and impaired clips should use the same source window. The subjective study should randomize and blind conditions, collect ratings such as impairment annoyance and overall perceived quality, and reserve a separate set of human observations for final evaluation.

### Execution plan and current status

| Phase | Work | Current status |
| --- | --- | --- |
| 1. Dataset construction | Select eligible public videos across categories; expand from the pilot toward the larger public dataset. | A balanced 24-video pilot is present. The larger 100–500 video collection remains planned. |
| 2. Automated collection | Collect public replay markers, metadata, and comments; preserve missing replay data as unavailable. | Collection pipeline is implemented. It writes raw outputs to the ignored `data/raw/phase2/` directory. |
| 3. Preprocessing | Clean and validate comments, parse timestamps, and align signals into 100 bins. | Preprocessing is implemented and a Phase 3 dataset is checked in. Manual sample verification and annotation-based classifier validation remain outstanding. |
| 4. Behavioral salience | Produce segment features, rankings, and candidate moments. | Feature and candidate-generation scripts are implemented. Their scores are behavioral proxies, not QoE measurements. |
| 5. Network-side QoE | Apply controlled impairments and measure rebuffering and objective quality. | A measurement template exists. Source clips and measured outcomes have not been supplied. |
| 6. Subjective study | Collect human QoE ratings using randomized, blinded clip conditions. | Planned; no participant ratings are included. |
| 7. Calibration and augmentation | Learn computational-to-subjective calibration from a calibration subset; augment only when justified. | Planned; requires subjective observations. |
| 8. Held-out evaluation | Compare the conventional and behavior-aware models using held-out human observations and statistical/ablation analyses. | Planned; final claims require held-out subjective data. |
| 9. Adaptive streaming demo | Demonstrate a policy informed by sensitivity estimates. | Optional and conditional on positive held-out validation. |

The current Phase 4 ridge-regression workflow is a software prototype that expects measured rows and a documented `computationalQoeScore` recipe. Its score is a computational training proxy, not subjective ground truth. Do not interpret its predictions as validated human QoE until the planned calibration and evaluation are completed.

### Risks and interpretation

- Most Replayed data can be unavailable or change over time. Record collection dates and represent missingness explicitly; do not replace unavailable replay values with zero.
- Timestamped comments can contain spam, duplicates, invalid timestamps, or category-specific bias. Use filtering, validation, manual review, and category-aware analyses.
- Replay activity may reflect engagement rather than impairment sensitivity. Treat behavioral salience as a predictor to test, not as a direct measure of QoE.
- Computational-to-subjective calibration may be unstable. If so, report the limitation and do not use augmented subjective labels.
- Keep calibration data separate from held-out human evaluation data. Report negative or inconclusive results and omit the adaptive demonstration if behavioral features do not add predictive value.

### Success criteria

The minimum research outcome is a reproducible empirical analysis of how conventional network-side QoE, public behavioral salience, and human-perceived QoE sensitivity relate. The primary claim is supported only if adding behavioral information improves prediction of held-out subjective QoE beyond the conventional baseline, with appropriate validation and analyses of category, endpoint, popularity, and impairment effects. Otherwise, report the result as evidence about the limits of public behavioral signals.

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
