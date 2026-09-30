# YouTube QoE Phase 2 Pipeline

This pipeline processes the balanced 24-video pilot dataset without manual
intervention. It retrieves public Most Replayed markers, public metadata and
top-level public comments, extracts timestamp references, and produces 100
relative-position bins for each retained video.

## Setup

Use Node.js 22 and run these commands from this folder:

```bash
npm install
export YOUTUBE_API_KEY="YOUR_YOUTUBE_DATA_API_KEY"
npm run collect
```

The key is restricted to YouTube Data API v3. Do not place it directly in the
source file or commit it to Git.

To fetch fewer comment pages during a test run:

```bash
export MAX_COMMENT_PAGES="2"
npm run collect
```

The default is 20 pages, or at most 2,000 top-level comments per video. YouTube
Data API quota usage increases with each comment page request.

## Output

```text
youtube-qoe-phase2/
├── manifest.json
└── videos/
    └── VIDEO_ID/
        ├── record.json
        ├── bins.json
        ├── bins.csv
        ├── timestamped-comments.json
        └── raw/
            ├── replay.json
            ├── metadata.json
            └── comment-pages.json
```

Each video receives exactly 100 bins. Replay intensity is linearly interpolated
at each bin midpoint. Timestamp references are converted to seconds and then to
a relative position in the interval `[0, 1)`. A comment containing multiple
timestamps can contribute references to multiple bins, but it is counted only
once per bin in `timestampCommentCount`.

`localReplayProminence` is the bin's replay intensity minus the mean intensity
of its neighboring bins within a radius of two bins. A positive value indicates
a locally prominent replay segment.

## Emotion field

The included emotion calculation is a transparent English word-list baseline.
It assigns positive, negative or neutral labels and is suitable for verifying
the pipeline. It is not a validated multilingual emotion model. Preserve its
output as a baseline and replace it with a documented model during the modeling
phase if emotion is used in research conclusions.

## Missing data

A video without replay markers is stored with status `replay_unavailable`.
Replay intensity is never fabricated or replaced with zero. API failures are
stored separately as `collection_error`, preventing missingness from being
confused with a valid zero-valued observation.

## Reproducibility notes

- Raw replay, metadata and comment responses are saved immediately.
- Every processed record contains an ISO-8601 collection timestamp.
- The manifest distinguishes included, replay-unavailable and failed videos.
- Re-running the pipeline updates the output snapshot. Archive dated copies for
  longitudinal comparisons because YouTube data can change.

## Phase 3 preprocessing

Run `npm run preprocess` after Phase 2 collection. It reads the saved Phase 2
snapshot and writes a reproducible 100-bin dataset to `youtube-qoe-phase3/`;
it does not make network requests. Pass alternate input and output directories
as positional arguments: `npm run preprocess -- <phase2-dir> <phase3-dir>`.

Phase 3 removes exact duplicate timestamped comments and a conservative set of
likely spam, reparses all timestamps, rejects out-of-duration references, and
supports multiple timestamps per comment. It emits endpoint flags, raw and
smoothed timestamp counts, smoothed rates with Laplace smoothing (`lambda=0.5`),
log-normalized counts, absolute sentiment magnitude, function-category counts,
local replay prominence (`w=2`), and video-level engagement reliability
weights. Raw replay values remain missing when unavailable.

The function classifier is a transparent ordered keyword baseline, not a
validated semantic model. `annotation-template.json` contains up to five
comments per processed video for manual labeling. Complete the `humanFunction`
fields independently and run `npm run validate:labels -- <completed-file>` to
produce accuracy, per-class F1 and macro-F1. Report those figures with the
annotated sample size. Until then, Phase 3 preprocessing is implemented, but
classifier validation and manual sample verification remain outstanding.

## Visual explorer

After preprocessing, start a local static web server from this folder:

```bash
python3 -m http.server 8000
```

Open `http://localhost:8000/visualizer/`. The explorer pairs the selected
YouTube video with replay intensity, local prominence, timestamp-comment counts,
quality complaint markers, a comment-function heatmap, and a per-bin comment
inspector. Click a chart segment or heatmap cell to seek to that point in the
video. The browser needs internet access to load YouTube's embedded player.

## Phase 4 feature preparation and model fitting

Run `npm run phase4:prepare` after Phase 3. This creates 2,400 per-bin feature
vectors (24 videos × 100 bins), standardized within each video, selects four
candidate segments per video (two high and two low salience), and writes a
576-row controlled-measurement template under `youtube-qoe-phase4/`.

The measurement template has two severity levels for rebuffering, bitrate
reduction, and resolution reduction. Fill it from measured controlled
impairment runs, including objective outcomes and a pre-defined
`computationalQoeScore` (higher is better). Then run `npm run phase4:train`.
This fits a ridge regression and exports coefficients, training RMSE, and
segment-condition estimates for the explorer's Phase 4 view.

This workspace currently has no source video files or FFmpeg executable, so
the impairment runs and objective measurements cannot be generated here. The
pipeline does not invent labels: until measured scores are entered, Phase 4
remains in `awaiting_measurements`. Document the composite score recipe and
keep it as a computational training proxy, not subjective ground truth. The
current model reports in-sample RMSE and is a prototype, not a validated model.
