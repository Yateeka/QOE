import {
    mkdirSync,
    writeFileSync
} from "fs";

import {
    getMostReplayed
} from "@reckerp/yt-most-replayed";

type ResearchCategory =
    | "Sports"
    | "Gaming"
    | "Education"
    | "Entertainment"
    | "Podcasts and Interviews"
    | "Instructional Content";

interface CandidateVideo {
    videoId: string;
    category: ResearchCategory;
}

interface ReplayMarker {
    startMillis: number;
    intensityScoreNormalized: number;
}

interface TimestampReference {
    commentId: string;
    timestamp: string;
    seconds: number;
    commentText: string;
    author: string;
    likeCount: number;
}

interface PublicComment {
    commentId: string;
    author: string;
    text: string;
    likeCount: number;
    publishedAt: string;
    timestamps: Array<{
        text: string;
        seconds: number;
    }>;
}

interface PublicChapter {
    title: string;
    timestamp: string;
    startSeconds: number;
}

interface VideoRecord {
    videoId: string;
    url: string;
    title: string | null;
    channel: string | null;
    durationSeconds: number | null;
    publicationDate: string | null;
    researchCategory: ResearchCategory;
    youtubeCategoryId: string | null;
    publicViewCount: number | null;
    publicLikeCount: number | null;
    publicCommentCount: number | null;
    replayAvailable: boolean;
    replayMarkerCount: number;
    replayMarkers: ReplayMarker[];
    peakStartMillis: number | null;
    peakSeconds: number | null;
    commentsAvailable: boolean;
    collectedCommentCount: number;
    publicComments: PublicComment[];
    timestampReferenceCount: number;
    timestampReferences: TimestampReference[];
    publicChapters: PublicChapter[];
    heatmapFilename: string | null;
    included: boolean;
    exclusionReason: string | null;
    collectionDate: string;
}

const outputDirectory = "youtube-qoe-dataset";
const heatmapDirectory = `${outputDirectory}/heatmaps`;
const recordDirectory = `${outputDirectory}/video-records`;

const youtubeApiKey = process.env.YOUTUBE_API_KEY;

/*
 * Organize candidate videos by research category.
 *
 * You may move a video to another category after its title and
 * content have been manually reviewed.
 */
const candidateVideos: CandidateVideo[] = [
    // =====================================================
    // Sports
    // =====================================================
    {
        videoId: "q89vpZ1kwpM",
        category: "Sports"
        // Bicycle-kick goals
    },
    {
        videoId: "rzj4FFi7wt8",
        category: "Sports"
        // Olympic archery final
    },
    {
        videoId: "aE4BdIP6bvc",
        category: "Sports"
        // Brazil vs Germany, 2014 FIFA World Cup
    },
    {
        videoId: "ecKnyyuMsmw",
        category: "Sports"
        // Olympic figure skating
    },

    // =====================================================
    // Gaming
    // =====================================================
    {
        videoId: "5qjnDd1rsII",
        category: "Gaming"
        // Technoblade: The Great Potato War
    },
    {
        videoId: "iOztnsBPrAA",
        category: "Gaming"
        // Five Nights at Freddy's
    },
    {
        videoId: "hDkuUZ3F1GU",
        category: "Gaming"
        // Minecraft Speedrunner vs 4 Hunters
    },
    {
        videoId: "tylNqtyj0gs",
        category: "Gaming"
        // Minecraft Speedrunner vs 3 Hunters finale
    },

    // =====================================================
    // Education
    // =====================================================
    {
        videoId: "BF2TZq-ntRQ",
        category: "Education"
        // Wildlife documentary
    },
    {
        videoId: "w2itwFJCgFQ",
        category: "Education"
        // TED talk about quadcopters
    },
    {
        videoId: "094y1Z2wpJg",
        category: "Education"
        // Veritasium: Collatz conjecture
    },
    {
        videoId: "arj7oStGLkU",
        category: "Education"
        // TED talk about procrastination
    },

    // =====================================================
    // Entertainment
    // =====================================================
    {
        videoId: "doNKdpo1vF8",
        category: "Entertainment"
        // Måneskin concert performance
    },
    {
        videoId: "H-0RHqDWcJE",
        category: "Entertainment"
        // The Matrix film scene
    },
    {
        videoId: "ZD1QrIe--_Y",
        category: "Entertainment"
        // Super Bowl halftime performance
    },
    {
        videoId: "UBA3OQSJU58",
        category: "Entertainment"
        // Mayyas dance performance
    },

    // =====================================================
    // Podcasts and Interviews
    // =====================================================
    {
        videoId: "L_Guz73e6fw",
        category: "Podcasts and Interviews"
        // Sam Altman interview, Lex Fridman #367
    },
    {
        videoId: "jvqFAi7vkBc",
        category: "Podcasts and Interviews"
        // Sam Altman interview, Lex Fridman #419
    },
    {
        videoId: "QmOF0crdyRU",
        category: "Podcasts and Interviews"
        // Andrew Huberman discussion
    },
    {
        videoId: "GrhLT9P61Z8",
        category: "Podcasts and Interviews"
        // Andrew Huberman interview
    },

    // =====================================================
    // Instructional Content
    // =====================================================
    {
        videoId: "9BMhFmNzw-o",
        category: "Instructional Content"
        // How to tie a tie
    },
    {
        videoId: "joBmbh0AGSQ",
        category: "Instructional Content"
        // How to change a tire
    },
    {
        videoId: "rfscVS0vtbw",
        category: "Instructional Content"
        // Python programming tutorial
    },
    {
        videoId: "fKxG8KjH1Qg",
        category: "Instructional Content"
        // How to play chess
    }
];

function escapeXml(value: string): string {
    return value
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&apos;");
}

function escapeCsv(value: unknown): string {
    if (value === null || value === undefined) {
        return "";
    }

    const text = String(value);

    return `"${text.replace(/"/g, "\"\"")}"`;
}

function safeFilename(value: string): string {
    return value
        .replace(/[<>:"/\\|?*]/g, "_")
        .replace(/\s+/g, "-")
        .slice(0, 100);
}

function parseIsoDuration(duration: string): number {
    const match = duration.match(
        /^P(?:(\d+)D)?T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/
    );

    if (!match) {
        return 0;
    }

    const days = Number(match[1] ?? 0);
    const hours = Number(match[2] ?? 0);
    const minutes = Number(match[3] ?? 0);
    const seconds = Number(match[4] ?? 0);

    return (
        days * 86400 +
        hours * 3600 +
        minutes * 60 +
        seconds
    );
}

function formatTime(seconds: number): string {
    const roundedSeconds = Math.max(
        0,
        Math.round(seconds)
    );

    const hours = Math.floor(
        roundedSeconds / 3600
    );

    const minutes = Math.floor(
        (roundedSeconds % 3600) / 60
    );

    const remainingSeconds =
        roundedSeconds % 60;

    if (hours > 0) {
        return (
            `${hours}:` +
            `${minutes.toString().padStart(2, "0")}:` +
            `${remainingSeconds.toString().padStart(2, "0")}`
        );
    }

    return (
        `${minutes}:` +
        `${remainingSeconds.toString().padStart(2, "0")}`
    );
}

function timestampToSeconds(
    timestamp: string
): number | null {
    const parts = timestamp
        .split(":")
        .map(Number);

    if (
        parts.length < 2 ||
        parts.length > 3 ||
        parts.some((part) => !Number.isFinite(part))
    ) {
        return null;
    }

    if (parts.length === 2) {
        const [minutes, seconds] = parts;

        if (seconds >= 60) {
            return null;
        }

        return minutes * 60 + seconds;
    }

    const [hours, minutes, seconds] = parts;

    if (minutes >= 60 || seconds >= 60) {
        return null;
    }

    return (
        hours * 3600 +
        minutes * 60 +
        seconds
    );
}

function extractTimestamps(
    text: string,
    durationSeconds: number | null
): Array<{
    text: string;
    seconds: number;
}> {
    const timestampPattern =
        /\b(?:(\d{1,2}):)?(\d{1,3}):([0-5]\d)\b/g;

    const timestamps: Array<{
        text: string;
        seconds: number;
    }> = [];

    const seen = new Set<string>();

    for (
        const match of text.matchAll(timestampPattern)
    ) {
        const timestamp = match[0];

        if (seen.has(timestamp)) {
            continue;
        }

        const seconds =
            timestampToSeconds(timestamp);

        if (seconds === null) {
            continue;
        }

        if (
            durationSeconds !== null &&
            seconds > durationSeconds
        ) {
            continue;
        }

        seen.add(timestamp);

        timestamps.push({
            text: timestamp,
            seconds
        });
    }

    return timestamps;
}

function extractChapters(
    description: string,
    durationSeconds: number | null
): PublicChapter[] {
    const chapters: PublicChapter[] = [];

    for (
        const line of description.split(/\r?\n/)
    ) {
        const match = line
            .trim()
            .match(
                /^((?:\d{1,2}:)?\d{1,3}:[0-5]\d)\s+(.+)$/
            );

        if (!match) {
            continue;
        }

        const timestamp = match[1];
        const title = match[2].trim();
        const startSeconds =
            timestampToSeconds(timestamp);

        if (startSeconds === null) {
            continue;
        }

        if (
            durationSeconds !== null &&
            startSeconds > durationSeconds
        ) {
            continue;
        }

        chapters.push({
            title,
            timestamp,
            startSeconds
        });
    }

    return chapters.sort((first, second) => {
        return (
            first.startSeconds -
            second.startSeconds
        );
    });
}

async function fetchJson(
    url: string
): Promise<any> {
    const response = await fetch(url);

    if (!response.ok) {
        const responseText =
            await response.text();

        throw new Error(
            `YouTube API request failed ` +
            `(${response.status}): ${responseText}`
        );
    }

    return response.json();
}

async function getVideoMetadata(
    videoId: string
): Promise<{
    title: string;
    channel: string;
    durationSeconds: number;
    publicationDate: string;
    youtubeCategoryId: string;
    viewCount: number | null;
    likeCount: number | null;
    commentCount: number | null;
    description: string;
} | null> {
    if (!youtubeApiKey) {
        return null;
    }

    const parameters = new URLSearchParams({
        part: "snippet,contentDetails,statistics",
        id: videoId,
        key: youtubeApiKey
    });

    const data = await fetchJson(
        "https://www.googleapis.com/youtube/v3/videos?" +
        parameters.toString()
    );

    const video = data.items?.[0];

    if (!video) {
        return null;
    }

    return {
        title:
            video.snippet?.title ?? "",
        channel:
            video.snippet?.channelTitle ?? "",
        durationSeconds:
            parseIsoDuration(
                video.contentDetails?.duration ?? "PT0S"
            ),
        publicationDate:
            video.snippet?.publishedAt ?? "",
        youtubeCategoryId:
            video.snippet?.categoryId ?? "",
        viewCount:
            video.statistics?.viewCount !== undefined
                ? Number(video.statistics.viewCount)
                : null,
        likeCount:
            video.statistics?.likeCount !== undefined
                ? Number(video.statistics.likeCount)
                : null,
        commentCount:
            video.statistics?.commentCount !== undefined
                ? Number(video.statistics.commentCount)
                : null,
        description:
            video.snippet?.description ?? ""
    };
}

async function getPublicComments(
    videoId: string,
    durationSeconds: number | null
): Promise<PublicComment[]> {
    if (!youtubeApiKey) {
        return [];
    }

    const comments: PublicComment[] = [];
    let pageToken: string | undefined;

    /*
     * Limits the collection to 500 top-level comments per video.
     * Increase this value if you need a larger comment sample.
     */
    const maximumComments = 500;

    try {
        do {
            const parameters = new URLSearchParams({
                part: "snippet",
                videoId,
                maxResults: "100",
                order: "relevance",
                textFormat: "plainText",
                key: youtubeApiKey
            });

            if (pageToken) {
                parameters.set(
                    "pageToken",
                    pageToken
                );
            }

            const data = await fetchJson(
                "https://www.googleapis.com/youtube/v3/commentThreads?" +
                parameters.toString()
            );

            for (const item of data.items ?? []) {
                const comment =
                    item.snippet
                        ?.topLevelComment
                        ?.snippet;

                if (!comment) {
                    continue;
                }

                const text =
                    comment.textDisplay ?? "";

                comments.push({
                    commentId:
                        item.snippet
                            .topLevelComment.id,
                    author:
                        comment.authorDisplayName ?? "",
                    text,
                    likeCount:
                        Number(comment.likeCount ?? 0),
                    publishedAt:
                        comment.publishedAt ?? "",
                    timestamps:
                        extractTimestamps(
                            text,
                            durationSeconds
                        )
                });

                if (
                    comments.length >=
                    maximumComments
                ) {
                    break;
                }
            }

            pageToken = data.nextPageToken;
        } while (
            pageToken &&
            comments.length < maximumComments
        );
    } catch (error) {
        console.warn(
            `Comments unavailable for ${videoId}:`,
            error
        );
    }

    return comments;
}

function createHeatmapSvg(
    videoId: string,
    title: string,
    category: ResearchCategory,
    durationSeconds: number | null,
    markers: ReplayMarker[],
    peakStartMillis: number | null
): string {
    const width = 1200;
    const height = 230;
    const chartTop = 75;
    const chartHeight = 110;
    const chartBottom = chartTop + chartHeight;
    const horizontalPadding = 30;
    const chartWidth =
        width - horizontalPadding * 2;

    const denominator = Math.max(
        markers.length - 1,
        1
    );

    const points = markers.map(
        (marker, index) => {
            const x =
                horizontalPadding +
                (index / denominator) *
                    chartWidth;

            const y =
                chartBottom -
                marker
                    .intensityScoreNormalized *
                    chartHeight;

            return {
                x,
                y
            };
        }
    );

    let filledPath =
        `M ${horizontalPadding},${chartBottom} `;

    filledPath += points
        .map((point) => {
            return (
                `L ${point.x.toFixed(1)},` +
                `${point.y.toFixed(1)}`
            );
        })
        .join(" ");

    filledPath +=
        ` L ${horizontalPadding + chartWidth},` +
        `${chartBottom} Z`;

    const linePath = points
        .map((point, index) => {
            const command =
                index === 0 ? "M" : "L";

            return (
                `${command} ` +
                `${point.x.toFixed(1)},` +
                `${point.y.toFixed(1)}`
            );
        })
        .join(" ");

    const peakIndex = markers.findIndex(
        (marker) => {
            return (
                marker.startMillis ===
                peakStartMillis
            );
        }
    );

    const peakX =
        peakIndex >= 0
            ? horizontalPadding +
                (peakIndex / denominator) *
                    chartWidth
            : null;

    const peakSeconds =
        peakStartMillis !== null
            ? peakStartMillis / 1000
            : null;

    const startLabel = "0:00";

    const middleLabel =
        durationSeconds !== null
            ? formatTime(durationSeconds / 2)
            : "50%";

    const endLabel =
        durationSeconds !== null
            ? formatTime(durationSeconds)
            : "100%";

    const peakLine =
        peakX !== null
            ? `
    <line
        x1="${peakX}"
        y1="${chartTop}"
        x2="${peakX}"
        y2="${chartBottom}"
        stroke="#ffffff"
        stroke-width="2"
        stroke-opacity="0.8"
    />
    <text
        x="${peakX}"
        y="${chartTop - 8}"
        text-anchor="middle"
        fill="#ffffff"
        font-family="Arial, sans-serif"
        font-size="12"
    >Peak ${
        peakSeconds !== null
            ? formatTime(peakSeconds)
            : ""
    }</text>`
            : "";

    return `<?xml version="1.0" encoding="UTF-8"?>
<svg
    xmlns="http://www.w3.org/2000/svg"
    width="${width}"
    height="${height}"
    viewBox="0 0 ${width} ${height}"
>
    <rect
        width="100%"
        height="100%"
        fill="#0f0f0f"
    />

    <text
        x="${width / 2}"
        y="28"
        text-anchor="middle"
        fill="#ffffff"
        font-family="Arial, sans-serif"
        font-size="19"
        font-weight="bold"
    >${escapeXml(title)}</text>

    <text
        x="${width / 2}"
        y="51"
        text-anchor="middle"
        fill="#bbbbbb"
        font-family="Arial, sans-serif"
        font-size="13"
    >Category: ${escapeXml(category)} | Video ID: ${escapeXml(videoId)}</text>

    <line
        x1="${horizontalPadding}"
        y1="${chartBottom}"
        x2="${horizontalPadding + chartWidth}"
        y2="${chartBottom}"
        stroke="#777777"
        stroke-width="1"
    />

    <path
        d="${filledPath}"
        fill="#ff0000"
        fill-opacity="0.72"
    />

    <path
        d="${linePath}"
        fill="none"
        stroke="#ff6259"
        stroke-width="2"
        stroke-linejoin="round"
        stroke-linecap="round"
    />

    ${peakLine}

    <text
        x="${horizontalPadding}"
        y="${chartBottom + 22}"
        text-anchor="start"
        fill="#bbbbbb"
        font-family="Arial, sans-serif"
        font-size="12"
    >${startLabel}</text>

    <text
        x="${width / 2}"
        y="${chartBottom + 22}"
        text-anchor="middle"
        fill="#bbbbbb"
        font-family="Arial, sans-serif"
        font-size="12"
    >${middleLabel}</text>

    <text
        x="${horizontalPadding + chartWidth}"
        y="${chartBottom + 22}"
        text-anchor="end"
        fill="#bbbbbb"
        font-family="Arial, sans-serif"
        font-size="12"
    >${endLabel}</text>

    <text
        x="${width / 2}"
        y="${height - 12}"
        text-anchor="middle"
        fill="#999999"
        font-family="Arial, sans-serif"
        font-size="12"
    >Normalized YouTube Most Replayed Intensity</text>
</svg>`;
}

async function processVideo(
    candidate: CandidateVideo
): Promise<VideoRecord> {
    const {
        videoId,
        category
    } = candidate;

    const collectionDate =
        new Date().toISOString();

    console.log(
        `\nChecking ${category}: ${videoId}`
    );

    const metadata =
        await getVideoMetadata(videoId);

    const title =
        metadata?.title ?? videoId;

    const durationSeconds =
        metadata?.durationSeconds ?? null;

    const description =
        metadata?.description ?? "";

    let replayMarkers: ReplayMarker[] = [];
    let peakStartMillis: number | null = null;
    let replayError: string | null = null;

    try {
        const replayData =
            await getMostReplayed(videoId);

        if (
            replayData?.markers &&
            replayData.markers.length > 0
        ) {
            replayMarkers =
                replayData.markers.map(
                    (marker) => {
                        return {
                            startMillis:
                                marker.startMillis,
                            intensityScoreNormalized:
                                marker
                                    .intensityScoreNormalized
                        };
                    }
                );

            peakStartMillis =
                replayData.peakSegment
                    ?.startMillis ?? null;
        } else {
            replayError =
                "Most Replayed data unavailable";
        }
    } catch (error) {
        replayError =
            error instanceof Error
                ? error.message
                : "Replay request failed";
    }

    const comments =
        await getPublicComments(
            videoId,
            durationSeconds
        );

    const timestampReferences:
        TimestampReference[] = [];

    for (const comment of comments) {
        for (
            const timestamp of comment.timestamps
        ) {
            timestampReferences.push({
                commentId:
                    comment.commentId,
                timestamp:
                    timestamp.text,
                seconds:
                    timestamp.seconds,
                commentText:
                    comment.text,
                author:
                    comment.author,
                likeCount:
                    comment.likeCount
            });
        }
    }

    const chapters =
        extractChapters(
            description,
            durationSeconds
        );

    let heatmapFilename: string | null = null;

    if (replayMarkers.length > 0) {
        const safeTitle =
            safeFilename(title);

        heatmapFilename =
            `${heatmapDirectory}/` +
            `${category.replace(/\s+/g, "-")}-` +
            `${safeTitle}-${videoId}.svg`;

        const svg = createHeatmapSvg(
            videoId,
            title,
            category,
            durationSeconds,
            replayMarkers,
            peakStartMillis
        );

        writeFileSync(
            heatmapFilename,
            svg,
            "utf8"
        );

        console.log(
            `Saved heatmap → ${heatmapFilename}`
        );
    }

    const included =
        replayMarkers.length > 0;

    const record: VideoRecord = {
        videoId,
        url:
            `https://www.youtube.com/watch?v=${videoId}`,
        title:
            metadata?.title ?? null,
        channel:
            metadata?.channel ?? null,
        durationSeconds,
        publicationDate:
            metadata?.publicationDate ?? null,
        researchCategory:
            category,
        youtubeCategoryId:
            metadata?.youtubeCategoryId ?? null,
        publicViewCount:
            metadata?.viewCount ?? null,
        publicLikeCount:
            metadata?.likeCount ?? null,
        publicCommentCount:
            metadata?.commentCount ?? null,
        replayAvailable:
            replayMarkers.length > 0,
        replayMarkerCount:
            replayMarkers.length,
        replayMarkers,
        peakStartMillis,
        peakSeconds:
            peakStartMillis !== null
                ? peakStartMillis / 1000
                : null,
        commentsAvailable:
            comments.length > 0,
        collectedCommentCount:
            comments.length,
        publicComments:
            comments,
        timestampReferenceCount:
            timestampReferences.length,
        timestampReferences,
        publicChapters:
            chapters,
        heatmapFilename,
        included,
        exclusionReason:
            included
                ? null
                : replayError,
        collectionDate
    };

    const recordFilename =
        `${recordDirectory}/${videoId}.json`;

    /*
     * Save every video immediately so the replay markers
     * are preserved if YouTube later changes them.
     */
    writeFileSync(
        recordFilename,
        JSON.stringify(record, null, 4),
        "utf8"
    );

    console.log(
        `Saved record → ${recordFilename}`
    );

    return record;
}

function writeDatasetCsv(
    records: VideoRecord[]
): void {
    const headers = [
        "video_id",
        "url",
        "title",
        "channel",
        "research_category",
        "youtube_category_id",
        "duration_seconds",
        "publication_date",
        "view_count",
        "like_count",
        "public_comment_count",
        "replay_available",
        "replay_marker_count",
        "peak_seconds",
        "collected_comment_count",
        "timestamp_reference_count",
        "chapter_count",
        "included",
        "exclusion_reason",
        "heatmap_filename",
        "collection_date"
    ];

    const rows = records.map((record) => {
        return [
            record.videoId,
            record.url,
            record.title,
            record.channel,
            record.researchCategory,
            record.youtubeCategoryId,
            record.durationSeconds,
            record.publicationDate,
            record.publicViewCount,
            record.publicLikeCount,
            record.publicCommentCount,
            record.replayAvailable,
            record.replayMarkerCount,
            record.peakSeconds,
            record.collectedCommentCount,
            record.timestampReferenceCount,
            record.publicChapters.length,
            record.included,
            record.exclusionReason,
            record.heatmapFilename,
            record.collectionDate
        ]
            .map(escapeCsv)
            .join(",");
    });

    const csv = [
        headers.join(","),
        ...rows
    ].join("\n");

    writeFileSync(
        `${outputDirectory}/video-dataset.csv`,
        csv,
        "utf8"
    );
}

async function main(): Promise<void> {
    mkdirSync(outputDirectory, {
        recursive: true
    });

    mkdirSync(heatmapDirectory, {
        recursive: true
    });

    mkdirSync(recordDirectory, {
        recursive: true
    });

    if (!youtubeApiKey) {
        console.warn(
            "YOUTUBE_API_KEY is not set. " +
            "Replay heatmaps will still be generated, " +
            "but metadata and comments will be unavailable."
        );
    }

    const records: VideoRecord[] = [];

    for (
        const candidate of candidateVideos
    ) {
        try {
            const record =
                await processVideo(candidate);

            records.push(record);
        } catch (error) {
            console.error(
                `Failed to process ` +
                `${candidate.videoId}:`,
                error
            );
        }
    }

    records.sort((first, second) => {
        const categoryComparison =
            first.researchCategory.localeCompare(
                second.researchCategory
            );

        if (categoryComparison !== 0) {
            return categoryComparison;
        }

        return (
            first.title ?? first.videoId
        ).localeCompare(
            second.title ?? second.videoId
        );
    });

    writeFileSync(
        `${outputDirectory}/video-dataset.json`,
        JSON.stringify(records, null, 4),
        "utf8"
    );

    writeDatasetCsv(records);

    const includedRecords =
        records.filter((record) => {
            return record.included;
        });

    const rejectedRecords =
        records.filter((record) => {
            return !record.included;
        });

    console.log("\nCollection complete.");
    console.log(
        `Processed: ${records.length}`
    );
    console.log(
        `Included: ${includedRecords.length}`
    );
    console.log(
        `Rejected: ${rejectedRecords.length}`
    );

    for (
        const category of [
            "Sports",
            "Gaming",
            "Education",
            "Entertainment",
            "Podcasts and Interviews",
            "Instructional Content"
        ] as ResearchCategory[]
    ) {
        const categoryCount =
            includedRecords.filter((record) => {
                return (
                    record.researchCategory ===
                    category
                );
            }).length;

        console.log(
            `${category}: ${categoryCount}`
        );
    }

    console.log(
        `\nMaster JSON → ` +
        `${outputDirectory}/video-dataset.json`
    );

    console.log(
        `Summary CSV → ` +
        `${outputDirectory}/video-dataset.csv`
    );

    console.log(
        `Heatmaps → ${heatmapDirectory}`
    );

    console.log(
        `Individual records → ${recordDirectory}`
    );
}

main().catch(console.error);