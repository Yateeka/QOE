import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import process from "node:process";

type FunctionLabel = "excitement_appreciation" | "confusion" | "humor" | "instructional_reference" | "quality_complaint" | "navigation_indexing" | "other";
type Comment = { commentId?: string; text?: string; likeCount?: number; publishedAt?: string; authorChannelId?: string | null; sentimentScore?: number; emotion?: string; timestamps?: Array<{ timestampText?: string; seconds?: number; relativePosition?: number }> };
type RecordData = { videoId: string; category?: string; status: string; metadata?: { title?: string; durationSeconds?: number; viewCount?: number | null; commentCount?: number | null }; markers?: Array<{ startMillis: number; intensityScoreNormalized: number }>; timestampedComments?: Comment[] };
const BIN_COUNT = 100;
const REPLAY_WINDOW = 2;
const COMMENT_SMOOTH_RADIUS = 2;
const LAMBDA = 0.5;
const INPUT = process.argv[2] ?? "youtube-qoe-phase2";
const OUTPUT = process.argv[3] ?? "youtube-qoe-phase3";
const LABELS: FunctionLabel[] = ["excitement_appreciation", "confusion", "humor", "instructional_reference", "quality_complaint", "navigation_indexing", "other"];

function readJson<T>(path: string): T { return JSON.parse(readFileSync(path, "utf8")) as T; }
function writeJson(path: string, value: unknown): void { writeFileSync(path, JSON.stringify(value, null, 2) + "\n", "utf8"); }
function timestampSeconds(value: string): number | null {
  const p = value.split(":").map(Number);
  if (p.length === 2 && p[0] >= 0 && p[1] >= 0 && p[1] < 60) return p[0] * 60 + p[1];
  if (p.length === 3 && p.every(Number.isFinite) && p[0] >= 0 && p[1] >= 0 && p[1] < 60 && p[2] >= 0 && p[2] < 60) return p[0] * 3600 + p[1] * 60 + p[2];
  return null;
}
function extract(text: string, duration: number) {
  const re = /(?<![\d:])(?:\d{1,3}:)?\d{1,3}:\d{2}(?![\d:])/g;
  const result = new Map<number, { timestampText: string; seconds: number; relativePosition: number }>();
  for (const m of text.matchAll(re)) {
    const seconds = timestampSeconds(m[0]);
    if (seconds === null || seconds >= duration) continue;
    result.set(seconds, { timestampText: m[0], seconds, relativePosition: seconds / duration });
  }
  return [...result.values()].sort((a, b) => a.seconds - b.seconds);
}
function likelySpam(text: string): boolean {
  const s = text.trim();
  if (s.length < 2 || /(https?:\/\/|www\.)/i.test(s) && /(free crypto|giveaway|subscribe to my channel|earn money|whatsapp me)/i.test(s)) return true;
  if (/(subscribe to my channel|check out my channel|crypto giveaway|free bitcoin|telegram me)/i.test(s)) return true;
  const words = s.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
  return words.length >= 8 && new Set(words).size / words.length < 0.2;
}
function classify(text: string): FunctionLabel {
  const s = text.toLowerCase();
  // Ordered rules make the output deterministic; manual labels remain the validation standard.
  if (/\b(audio|sound|video|quality|glitch|buffer|lag|freeze|distort|mic|microphone|volume|cut out|disappear|skip)\b/.test(s) && /\b(bad|poor|wrong|issue|problem|missing|disappear|cut out|broken|terrible|can't hear|cannot hear|quality)\b/.test(s)) return "quality_complaint";
  if (/\b(confus(ed|ing)|unclear|don't understand|do not understand|makes no sense|what does|how is that|why does)\b/.test(s)) return "confusion";
  if (/\b(timestamp|chapter|at \d{1,3}:\d{2}|\d{1,3}:\d{2} (is|was)|skip to|start at|go to|where is|when does)\b/.test(s)) return "navigation_indexing";
  if (/\b(how to|tutorial|step by step|explains?|demonstrat|instruction|guide|learn|chapter on)\b/.test(s)) return "instructional_reference";
  if (/\b(lol|lmao|rofl|haha|hilarious|funniest|joke|😂|🤣)\b/.test(s)) return "humor";
  if (/\b(amazing|awesome|incredible|love this|great|excellent|beautiful|brilliant|thank you|thanks|appreciate|wow|inspiring)\b/.test(s)) return "excitement_appreciation";
  return "other";
}
function replayAt(markers: RecordData["markers"], t: number, duration: number): number | null {
  if (!markers?.length) return null;
  const sorted = [...markers].sort((a, b) => a.startMillis - b.startMillis);
  const target = t * duration * 1000;
  const right = sorted.findIndex(m => m.startMillis >= target);
  if (right <= 0) return sorted[0].intensityScoreNormalized;
  if (right < 0) return sorted.at(-1)!.intensityScoreNormalized;
  const a = sorted[right - 1], b = sorted[right];
  const f = (target - a.startMillis) / Math.max(1, b.startMillis - a.startMillis);
  return a.intensityScoreNormalized * (1 - f) + b.intensityScoreNormalized * f;
}
function processRecord(record: RecordData) {
  const duration = Number(record.metadata?.durationSeconds);
  if (!Number.isFinite(duration) || duration <= 0) throw new Error(`${record.videoId}: invalid/missing duration`);
  const source = record.timestampedComments ?? [];
  const seen = new Set<string>();
  let duplicateCount = 0, spamCount = 0, noTimestampCount = 0, invalidTimestampCount = 0;
  const retained = [] as Array<Comment & { cleanedText: string; timestamps: ReturnType<typeof extract>; functionLabel: FunctionLabel }>;
  for (const c of source) {
    const text = (c.text ?? "").replace(/\s+/g, " ").trim();
    const key = text.toLocaleLowerCase().replace(/\s+/g, " ");
    if (!key || seen.has(key)) { duplicateCount++; continue; }
    seen.add(key);
    if (likelySpam(text)) { spamCount++; continue; }
    const timestamps = extract(text, duration);
    if (!timestamps.length) { noTimestampCount++; invalidTimestampCount++; continue; }
    retained.push({ ...c, cleanedText: text, timestamps, functionLabel: classify(text) });
  }
  const counts = Array(BIN_COUNT).fill(0) as number[];
  const commentBins = Array.from({ length: BIN_COUNT }, () => new Set<string>());
  const functionCounts = Array.from({ length: BIN_COUNT }, () => Object.fromEntries(LABELS.map(k => [k, 0])) as Record<FunctionLabel, number>);
  const emotionTotals = Array(BIN_COUNT).fill(0) as number[];
  const emotionN = Array(BIN_COUNT).fill(0) as number[];
  for (const [i, c] of retained.entries()) for (const t of c.timestamps) {
    const bin = Math.min(BIN_COUNT - 1, Math.floor(t.relativePosition * BIN_COUNT));
    counts[bin]++; commentBins[bin].add(String(c.commentId ?? i)); functionCounts[bin][c.functionLabel]++;
    const score = Number(c.sentimentScore ?? 0); emotionTotals[bin] += Math.abs(Number.isFinite(score) ? score : 0); emotionN[bin]++;
  }
  const smoothed = counts.map((_, i) => {
    let total = 0, weight = 0;
    for (let j = Math.max(0, i - COMMENT_SMOOTH_RADIUS); j <= Math.min(99, i + COMMENT_SMOOTH_RADIUS); j++) {
      const w = 1 / (1 + Math.abs(i - j)); total += counts[j] * w; weight += w;
    }
    return total / weight;
  });
  const maxLog = Math.max(0, ...counts.map(n => Math.log1p(n)));
  const views = Math.max(0, Number(record.metadata?.viewCount ?? 0));
  const comments = Math.max(0, Number(record.metadata?.commentCount ?? 0));
  const reliabilityWeight = Math.log1p(views) * Math.log1p(comments);
  const bins = Array.from({ length: BIN_COUNT }, (_, i) => {
    const start = i / 100, end = (i + 1) / 100, midpoint = (start + end) / 2;
    const neighbors = Array.from({ length: 2 * REPLAY_WINDOW }, (_, x) => i - REPLAY_WINDOW + x).filter(j => j >= 0 && j < 100 && j !== i).map(j => replayAt(record.markers, (j + 0.5) / 100, duration)).filter((x): x is number => x !== null);
    const replay = replayAt(record.markers, midpoint, duration);
    const prominence = replay === null ? null : replay - (neighbors.length ? neighbors.reduce((a, b) => a + b, 0) / neighbors.length : replay);
    const rateDenom = counts.reduce((a, b) => a + b, 0) + BIN_COUNT * LAMBDA;
    return { binIndex: i, relativeStart: start, relativeEnd: end, startSeconds: start * duration, endSeconds: end * duration, midpointSeconds: midpoint * duration,
      isFirstBin: i === 0, isLastBin: i === 99, replayIntensity: replay, localReplayProminence: prominence,
      timestampCommentCount: commentBins[i].size, timestampReferenceCount: counts[i], commentRateSmoothed: smoothed[i], commentRateSmoothedNormalized: smoothed[i] / (counts.reduce((a, b) => a + b, 0) + 100 * LAMBDA),
      commentRateSmoothedLogNormalized: maxLog ? Math.log1p(smoothed[i]) / maxLog : 0, timestampCountRate: (counts[i] + LAMBDA) / rateDenom,
      logNormalizedTimestampCount: maxLog ? Math.log1p(counts[i]) / maxLog : 0,
      meanAbsoluteSentiment: emotionN[i] ? emotionTotals[i] / emotionN[i] : 0,
      functionCounts: functionCounts[i], durationSeconds: duration, videoViewCount: record.metadata?.viewCount ?? null, videoCommentCount: record.metadata?.commentCount ?? null, reliabilityWeight };
  });
  return { videoId: record.videoId, category: record.category ?? null, title: record.metadata?.title ?? record.videoId, durationSeconds: duration, viewCount: record.metadata?.viewCount ?? null, videoCommentCount: record.metadata?.commentCount ?? null, sourceTimestampedCommentCount: source.length, retainedTimestampedCommentCount: retained.length,
    cleaning: { exactDuplicatesRemoved: duplicateCount, likelySpamRemoved: spamCount, withoutValidTimestampRemoved: noTimestampCount, invalidOrOutOfDurationTimestampReferences: invalidTimestampCount },
    reliabilityWeight, comments: retained.map(c => ({ cleanedText: c.cleanedText, likeCount: c.likeCount ?? 0, timestamps: c.timestamps, functionLabel: c.functionLabel, sentimentScore: c.sentimentScore ?? 0 })), bins };
}
function validate(video: ReturnType<typeof processRecord>): string[] {
  const errors: string[] = [];
  if (video.bins.length !== 100) errors.push("bin_count_not_100");
  for (const b of video.bins) {
    if (![b.relativeStart, b.relativeEnd, b.midpointSeconds].every(Number.isFinite) || b.relativeStart < 0 || b.relativeEnd > 1 || b.relativeEnd <= b.relativeStart) errors.push(`invalid_bin_${b.binIndex}_interval`);
    if (b.replayIntensity !== null && (!Number.isFinite(b.replayIntensity) || b.replayIntensity < 0 || b.replayIntensity > 1)) errors.push(`invalid_bin_${b.binIndex}_replay`);
    if (!Number.isFinite(b.timestampCountRate) || b.timestampCountRate < 0 || b.timestampCountRate > 1) errors.push(`invalid_bin_${b.binIndex}_rate`);
  }
  return errors;
}
function main() {
  const manifest = readJson<{ videos: Array<{ videoId: string; status: string; category?: string }> }>(join(INPUT, "manifest.json"));
  const outDir = join(OUTPUT, "videos"); mkdirSync(outDir, { recursive: true });
  const entries = [] as Array<{ videoId: string; category?: string | null; status: string; errors?: string[]; retainedTimestampedCommentCount?: number }>;
  for (const entry of manifest.videos) {
    if (entry.status !== "included") { entries.push({ videoId: entry.videoId, category: entry.category ?? null, status: entry.status }); continue; }
    const path = join(INPUT, "videos", entry.videoId, "record.json");
    if (!existsSync(path)) { entries.push({ videoId: entry.videoId, category: entry.category ?? null, status: "missing_record", errors: ["record_not_found"] }); continue; }
    try {
      const record = readJson<RecordData>(path); const result = processRecord(record); const errors = validate(result);
      writeJson(join(outDir, `${record.videoId}.json`), result);
      entries.push({ videoId: record.videoId, category: result.category ?? entry.category ?? null, status: errors.length ? "validity_error" : "processed", errors, retainedTimestampedCommentCount: result.retainedTimestampedCommentCount });
    } catch (error) { entries.push({ videoId: entry.videoId, category: entry.category ?? null, status: "processing_error", errors: [error instanceof Error ? error.message : String(error)] }); }
  }
  writeJson(join(OUTPUT, "manifest.json"), { schemaVersion: "3.0.0", generatedAt: new Date().toISOString(), binCount: BIN_COUNT, smoothing: { lambda: LAMBDA, commentRadiusBins: COMMENT_SMOOTH_RADIUS, replayProminenceRadiusBins: REPLAY_WINDOW }, videos: entries });
  // A blinded annotation sheet gives a human reviewer an actionable validation sample.
  const sample: unknown[] = [];
  for (const entry of entries.filter(e => e.status === "processed")) {
    const v = readJson<ReturnType<typeof processRecord>>(join(outDir, `${entry.videoId}.json`));
    for (const c of v.comments.slice(0, 5)) sample.push({ videoId: v.videoId, commentId: c.commentId, text: c.cleanedText, predictedFunction: c.functionLabel, humanFunction: "" });
  }
  writeJson(join(OUTPUT, "annotation-template.json"), { instructions: "Independently label each sampled comment with one of the seven function categories; fill humanFunction. Then run npm run validate:labels -- <path-to-completed-template.json>.", labels: LABELS, items: sample });
  console.log(`Phase 3 processed ${entries.filter(e => e.status === "processed").length} videos; ${entries.filter(e => e.status !== "processed").length} need attention.`);
}
main();
