import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { getMostReplayed } from "@reckerp/yt-most-replayed";

type Category =
    | "Sports"
    | "Gaming"
    | "Education"
    | "Entertainment"
    | "Podcasts and Interviews"
    | "Instructional Content";

interface CandidateVideo {
    videoId: string;
    category: Category;
}

interface ReplayMarker {
    startMillis: number;
    intensityScoreNormalized: number;
}

interface TimestampReference {
    timestampText: string;
    seconds: number;
    relativePosition: number;
}

interface ProcessedComment {
    commentId: string;
    text: string;
    likeCount: number;
    publishedAt: string;
    authorChannelId: string | null;
    sentimentScore: number;
    emotion: "positive" | "negative" | "neutral";
    timestamps: TimestampReference[];
}

interface AnalysisBin {
    binIndex: number;
    relativeStart: number;
    relativeEnd: number;
    midpointSeconds: number;
    replayIntensity: number;
    timestampCommentCount: number;
    timestampReferenceCount: number;
    positiveCommentCount: number;
    negativeCommentCount: number;
    neutralCommentCount: number;
    meanSentimentScore: number;
    localReplayProminence: number;
    videoViewCount: number | null;
    videoLikeCount: number | null;
    videoCommentCount: number | null;
    durationSeconds: number;
}

const candidates: CandidateVideo[] = [
    { videoId: "q89vpZ1kwpM", category: "Sports" },
    { videoId: "rzj4FFi7wt8", category: "Sports" },
    { videoId: "aE4BdIP6bvc", category: "Sports" },
    { videoId: "ecKnyyuMsmw", category: "Sports" },
    { videoId: "5qjnDd1rsII", category: "Gaming" },
    { videoId: "iOztnsBPrAA", category: "Gaming" },
    { videoId: "hDkuUZ3F1GU", category: "Gaming" },
    { videoId: "tylNqtyj0gs", category: "Gaming" },
    { videoId: "BF2TZq-ntRQ", category: "Education" },
    { videoId: "w2itwFJCgFQ", category: "Education" },
    { videoId: "094y1Z2wpJg", category: "Education" },
    { videoId: "arj7oStGLkU", category: "Education" },
    { videoId: "doNKdpo1vF8", category: "Entertainment" },
    { videoId: "H-0RHqDWcJE", category: "Entertainment" },
    { videoId: "ZD1QrIe--_Y", category: "Entertainment" },
    { videoId: "UBA3OQSJU58", category: "Entertainment" },
    { videoId: "L_Guz73e6fw", category: "Podcasts and Interviews" },
    { videoId: "jvqFAi7vkBc", category: "Podcasts and Interviews" },
    { videoId: "QmOF0crdyRU", category: "Podcasts and Interviews" },
    { videoId: "GrhLT9P61Z8", category: "Podcasts and Interviews" },
    { videoId: "9BMhFmNzw-o", category: "Instructional Content" },
    { videoId: "joBmbh0AGSQ", category: "Instructional Content" },
    { videoId: "rfscVS0vtbw", category: "Instructional Content" },
    { videoId: "fKxG8KjH1Qg", category: "Instructional Content" }
];

const BIN_COUNT = 100;
const MAX_COMMENT_PAGES = Number(process.env.MAX_COMMENT_PAGES ?? "20");
const OUTPUT_ROOT = "data/raw/phase2";
const API_KEY = process.env.YOUTUBE_API_KEY ?? "";

const positiveWords = new Set([
    "amazing", "awesome", "best", "brilliant", "excellent", "favorite",
    "funny", "good", "great", "impressive", "incredible", "love",
    "perfect", "powerful", "beautiful", "helpful", "wow"
]);

const negativeWords = new Set([
    "awful", "bad", "boring", "confusing", "disappointing", "hate",
    "horrible", "poor", "terrible", "unclear", "worst", "annoying",
    "broken", "wrong", "useless"
]);

function writeJson(path: string, value: unknown): void {
    writeFileSync(path, JSON.stringify(value, null, 4), "utf8");
}

function parseIsoDuration(value: string): number {
    const match = value.match(
        /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?)?$/
    );

    if (!match) {
        throw new Error(`Unsupported ISO-8601 duration: ${value}`);
    }

    return (
        Number(match[1] ?? 0) * 86400 +
        Number(match[2] ?? 0) * 3600 +
        Number(match[3] ?? 0) * 60 +
        Number(match[4] ?? 0)
    );
}

function parseTimestampToSeconds(value: string): number | null {
    const parts = value.split(":").map(Number);

    if (parts.some((part) => !Number.isFinite(part))) {
        return null;
    }

    if (parts.length === 2) {
        const [minutes, seconds] = parts;
        if (seconds >= 60) {
            return null;
        }
        return minutes * 60 + seconds;
    }

    if (parts.length === 3) {
        const [hours, minutes, seconds] = parts;
        if (minutes >= 60 || seconds >= 60) {
            return null;
        }
        return hours * 3600 + minutes * 60 + seconds;
    }

    return null;
}

function extractTimestamps(text: string, durationSeconds: number): TimestampReference[] {
    const regex = /(?<![\d:])(?:\d{1,2}:)?\d{1,3}:\d{2}(?![\d:])/g;
    const unique = new Map<number, TimestampReference>();

    for (const match of text.matchAll(regex)) {
        const seconds = parseTimestampToSeconds(match[0]);

        if (seconds === null || seconds < 0 || seconds > durationSeconds) {
            continue;
        }

        unique.set(seconds, {
            timestampText: match[0],
            seconds,
            relativePosition: Math.min(seconds / durationSeconds, 0.999999)
        });
    }

    return [...unique.values()].sort((a, b) => a.seconds - b.seconds);
}

function analyzeSentiment(text: string): {
    score: number;
    emotion: "positive" | "negative" | "neutral";
} {
    const words = text.toLowerCase().match(/[a-z']+/g) ?? [];
    let score = 0;

    for (const word of words) {
        if (positiveWords.has(word)) {
            score += 1;
        }
        if (negativeWords.has(word)) {
            score -= 1;
        }
    }

    return {
        score,
        emotion: score > 0 ? "positive" : score < 0 ? "negative" : "neutral"
    };
}

async function youtubeRequest(
    resource: string,
    parameters: Record<string, string>
): Promise<any> {
    if (!API_KEY) {
        throw new Error("YOUTUBE_API_KEY is required for Phase 2.");
    }

    const url = new URL(`https://www.googleapis.com/youtube/v3/${resource}`);
    url.search = new URLSearchParams({ ...parameters, key: API_KEY }).toString();
    const response = await fetch(url);

    if (!response.ok) {
        const body = await response.text();
        throw new Error(`YouTube API ${response.status}: ${body}`);
    }

    return response.json();
}

async function getMetadata(videoId: string): Promise<any> {
    const response = await youtubeRequest("videos", {
        part: "snippet,contentDetails,statistics",
        id: videoId
    });

    if (!response.items?.length) {
        throw new Error("Video metadata was not returned.");
    }

    return response;
}

async function getCommentPages(videoId: string): Promise<any[]> {
    const pages: any[] = [];
    let pageToken = "";

    for (let page = 0; page < MAX_COMMENT_PAGES; page += 1) {
        const parameters: Record<string, string> = {
            part: "snippet",
            videoId,
            maxResults: "100",
            order: "relevance",
            textFormat: "plainText"
        };

        if (pageToken) {
            parameters.pageToken = pageToken;
        }

        const response = await youtubeRequest("commentThreads", parameters);
        pages.push(response);
        pageToken = response.nextPageToken ?? "";

        if (!pageToken) {
            break;
        }
    }

    return pages;
}

function interpolateReplay(
    markers: ReplayMarker[],
    relativePosition: number,
    durationSeconds: number
): number {
    if (markers.length === 1) {
        return markers[0].intensityScoreNormalized;
    }

    const targetMillis = relativePosition * durationSeconds * 1000;
    let rightIndex = markers.findIndex((marker) => marker.startMillis >= targetMillis);

    if (rightIndex <= 0) {
        return markers[0].intensityScoreNormalized;
    }

    if (rightIndex === -1) {
        return markers.at(-1)?.intensityScoreNormalized ?? 0;
    }

    const left = markers[rightIndex - 1];
    const right = markers[rightIndex];
    const interval = Math.max(right.startMillis - left.startMillis, 1);
    const weight = (targetMillis - left.startMillis) / interval;

    return (
        left.intensityScoreNormalized * (1 - weight) +
        right.intensityScoreNormalized * weight
    );
}

function buildBins(
    markers: ReplayMarker[],
    comments: ProcessedComment[],
    durationSeconds: number,
    controls: {
        viewCount: number | null;
        likeCount: number | null;
        commentCount: number | null;
    }
): AnalysisBin[] {
    const bins: AnalysisBin[] = Array.from({ length: BIN_COUNT }, (_, index) => {
        const relativeStart = index / BIN_COUNT;
        const relativeEnd = (index + 1) / BIN_COUNT;
        const midpoint = (relativeStart + relativeEnd) / 2;

        return {
            binIndex: index,
            relativeStart,
            relativeEnd,
            midpointSeconds: midpoint * durationSeconds,
            replayIntensity: interpolateReplay(markers, midpoint, durationSeconds),
            timestampCommentCount: 0,
            timestampReferenceCount: 0,
            positiveCommentCount: 0,
            negativeCommentCount: 0,
            neutralCommentCount: 0,
            meanSentimentScore: 0,
            localReplayProminence: 0,
            videoViewCount: controls.viewCount,
            videoLikeCount: controls.likeCount,
            videoCommentCount: controls.commentCount,
            durationSeconds
        };
    });

    const sentimentTotals = Array(BIN_COUNT).fill(0) as number[];
    const sentimentObservations = Array(BIN_COUNT).fill(0) as number[];

    for (const comment of comments) {
        const touchedBins = new Set<number>();

        for (const timestamp of comment.timestamps) {
            const index = Math.min(
                Math.floor(timestamp.relativePosition * BIN_COUNT),
                BIN_COUNT - 1
            );
            const bin = bins[index];
            bin.timestampReferenceCount += 1;
            touchedBins.add(index);

            if (comment.emotion === "positive") {
                bin.positiveCommentCount += 1;
            } else if (comment.emotion === "negative") {
                bin.negativeCommentCount += 1;
            } else {
                bin.neutralCommentCount += 1;
            }

            sentimentTotals[index] += comment.sentimentScore;
            sentimentObservations[index] += 1;
        }

        for (const index of touchedBins) {
            bins[index].timestampCommentCount += 1;
        }
    }

    for (let index = 0; index < bins.length; index += 1) {
        if (sentimentObservations[index] > 0) {
            bins[index].meanSentimentScore =
                sentimentTotals[index] / sentimentObservations[index];
        }

        const neighborStart = Math.max(0, index - 2);
        const neighborEnd = Math.min(BIN_COUNT - 1, index + 2);
        const neighbors = bins
            .slice(neighborStart, neighborEnd + 1)
            .filter((_, offset) => neighborStart + offset !== index);
        const localMean = neighbors.length > 0
            ? neighbors.reduce((sum, bin) => sum + bin.replayIntensity, 0) /
                neighbors.length
            : bins[index].replayIntensity;

        bins[index].localReplayProminence = bins[index].replayIntensity - localMean;
    }

    return bins;
}

function csvEscape(value: unknown): string {
    const text = value === null || value === undefined ? "" : String(value);
    return `"${text.replaceAll('"', '""')}"`;
}

function binsToCsv(videoId: string, category: Category, bins: AnalysisBin[]): string {
    const columns: Array<keyof AnalysisBin> = [
        "binIndex", "relativeStart", "relativeEnd", "midpointSeconds",
        "replayIntensity", "timestampCommentCount", "timestampReferenceCount",
        "positiveCommentCount", "negativeCommentCount", "neutralCommentCount",
        "meanSentimentScore", "localReplayProminence", "videoViewCount",
        "videoLikeCount", "videoCommentCount", "durationSeconds"
    ];
    const header = ["videoId", "category", ...columns].join(",");
    const rows = bins.map((bin) => [
        csvEscape(videoId),
        csvEscape(category),
        ...columns.map((column) => csvEscape(bin[column]))
    ].join(","));

    return [header, ...rows].join("\n");
}

async function processVideo(candidate: CandidateVideo): Promise<any> {
    const { videoId, category } = candidate;
    const collectedAt = new Date().toISOString();
    const videoDirectory = join(OUTPUT_ROOT, "videos", videoId);
    const rawDirectory = join(videoDirectory, "raw");
    mkdirSync(rawDirectory, { recursive: true });

    console.log(`\nProcessing ${category}: ${videoId}`);

    let replayData: any;
    try {
        replayData = await getMostReplayed(videoId);
    } catch (error) {
        replayData = null;
        writeJson(join(rawDirectory, "replay-error.json"), {
            message: error instanceof Error ? error.message : String(error)
        });
    }

    writeJson(join(rawDirectory, "replay.json"), replayData);

    if (!replayData?.markers?.length) {
        const unavailable = {
            videoId,
            category,
            status: "replay_unavailable",
            collectedAt
        };
        writeJson(join(videoDirectory, "record.json"), unavailable);
        return unavailable;
    }

    const metadataResponse = await getMetadata(videoId);
    writeJson(join(rawDirectory, "metadata.json"), metadataResponse);
    const item = metadataResponse.items[0];
    const durationSeconds = parseIsoDuration(item.contentDetails.duration);

    let commentPages: any[] = [];
    let commentStatus = "available";
    try {
        commentPages = await getCommentPages(videoId);
    } catch (error) {
        commentStatus = "unavailable";
        writeJson(join(rawDirectory, "comments-error.json"), {
            message: error instanceof Error ? error.message : String(error)
        });
    }

    writeJson(join(rawDirectory, "comment-pages.json"), commentPages);

    const comments: ProcessedComment[] = commentPages.flatMap((page) =>
        (page.items ?? []).map((thread: any) => {
            const comment = thread.snippet.topLevelComment;
            const snippet = comment.snippet;
            const sentiment = analyzeSentiment(snippet.textDisplay ?? "");

            return {
                commentId: comment.id,
                text: snippet.textDisplay ?? "",
                likeCount: Number(snippet.likeCount ?? 0),
                publishedAt: snippet.publishedAt,
                authorChannelId: snippet.authorChannelId?.value ?? null,
                sentimentScore: sentiment.score,
                emotion: sentiment.emotion,
                timestamps: extractTimestamps(snippet.textDisplay ?? "", durationSeconds)
            };
        })
    );

    const statistics = item.statistics ?? {};
    const controls = {
        viewCount: statistics.viewCount ? Number(statistics.viewCount) : null,
        likeCount: statistics.likeCount ? Number(statistics.likeCount) : null,
        commentCount: statistics.commentCount ? Number(statistics.commentCount) : null
    };
    const markers = [...replayData.markers]
        .map((marker: any) => ({
            startMillis: Number(marker.startMillis),
            intensityScoreNormalized: Number(marker.intensityScoreNormalized)
        }))
        .sort((a, b) => a.startMillis - b.startMillis);
    const bins = buildBins(markers, comments, durationSeconds, controls);
    const timestampedComments = comments.filter((comment) => comment.timestamps.length > 0);

    const record = {
        schemaVersion: "2.0.0",
        videoId,
        url: `https://www.youtube.com/watch?v=${videoId}`,
        category,
        status: "included",
        collectedAt,
        replayAvailable: true,
        commentStatus,
        metadata: {
            title: item.snippet.title,
            channelId: item.snippet.channelId,
            channelTitle: item.snippet.channelTitle,
            publishedAt: item.snippet.publishedAt,
            youtubeCategoryId: item.snippet.categoryId,
            durationSeconds,
            ...controls
        },
        collection: {
            replayMarkerCount: markers.length,
            fetchedTopLevelCommentCount: comments.length,
            timestampedCommentCount: timestampedComments.length,
            timestampReferenceCount: timestampedComments.reduce(
                (sum, comment) => sum + comment.timestamps.length,
                0
            ),
            commentPagesFetched: commentPages.length,
            commentPageLimit: MAX_COMMENT_PAGES,
            binCount: BIN_COUNT
        },
        markers,
        timestampedComments,
        bins
    };

    writeJson(join(videoDirectory, "record.json"), record);
    writeJson(join(videoDirectory, "timestamped-comments.json"), timestampedComments);
    writeJson(join(videoDirectory, "bins.json"), bins);
    writeFileSync(
        join(videoDirectory, "bins.csv"),
        binsToCsv(videoId, category, bins),
        "utf8"
    );

    console.log(
        `Included: ${markers.length} markers, ${comments.length} comments, ` +
        `${timestampedComments.length} timestamped comments`
    );
    return record;
}

async function main(): Promise<void> {
    if (!API_KEY) {
        throw new Error(
            "YOUTUBE_API_KEY is not set. Run: " +
            "export YOUTUBE_API_KEY='YOUR_KEY'"
        );
    }

    mkdirSync(join(OUTPUT_ROOT, "videos"), { recursive: true });
    const manifest: any[] = [];

    for (const candidate of candidates) {
        try {
            const record = await processVideo(candidate);
            manifest.push({
                videoId: candidate.videoId,
                category: candidate.category,
                status: record.status,
                title: record.metadata?.title ?? null,
                timestampedCommentCount:
                    record.collection?.timestampedCommentCount ?? null
            });
        } catch (error) {
            const failed = {
                videoId: candidate.videoId,
                category: candidate.category,
                status: "collection_error",
                message: error instanceof Error ? error.message : String(error)
            };
            manifest.push(failed);
            console.error(`Failed ${candidate.videoId}:`, failed.message);
        }
    }

    const summary = {
        schemaVersion: "2.0.0",
        generatedAt: new Date().toISOString(),
        requested: candidates.length,
        included: manifest.filter((entry) => entry.status === "included").length,
        replayUnavailable: manifest.filter(
            (entry) => entry.status === "replay_unavailable"
        ).length,
        collectionErrors: manifest.filter(
            (entry) => entry.status === "collection_error"
        ).length,
        binCount: BIN_COUNT,
        videos: manifest
    };

    writeJson(join(OUTPUT_ROOT, "manifest.json"), summary);
    console.log("\nCollection complete.");
    console.log(`Requested: ${summary.requested}`);
    console.log(`Included: ${summary.included}`);
    console.log(`Replay unavailable: ${summary.replayUnavailable}`);
    console.log(`Collection errors: ${summary.collectionErrors}`);
    console.log(`Output: ${OUTPUT_ROOT}`);
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
