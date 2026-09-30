import { readFileSync, writeFileSync } from "node:fs";
import process from "node:process";

type Label = "excitement_appreciation" | "confusion" | "humor" | "instructional_reference" | "quality_complaint" | "navigation_indexing" | "other";
type Item = { videoId: string; commentId: string | null; text: string; predictedFunction: Label; humanFunction: string };
const labels: Label[] = ["excitement_appreciation", "confusion", "humor", "instructional_reference", "quality_complaint", "navigation_indexing", "other"];
const input = process.argv[2];
if (!input) throw new Error("Usage: npm run validate:labels -- <completed-annotation-template.json>");
const data = JSON.parse(readFileSync(input, "utf8")) as { items: Item[] };
const rows = data.items.filter(x => labels.includes(x.humanFunction as Label));
if (!rows.length) throw new Error("No valid humanFunction labels found.");
const matrix = Object.fromEntries(labels.map(a => [a, Object.fromEntries(labels.map(b => [b, 0]))])) as Record<Label, Record<Label, number>>;
for (const x of rows) matrix[x.humanFunction as Label][x.predictedFunction]++;
const perClass = labels.map(label => {
  const tp = matrix[label][label];
  const fp = labels.reduce((n, actual) => n + (actual === label ? 0 : matrix[actual][label]), 0);
  const fn = labels.reduce((n, predicted) => n + (predicted === label ? 0 : matrix[label][predicted]), 0);
  const precision = tp + fp ? tp / (tp + fp) : 0, recall = tp + fn ? tp / (tp + fn) : 0;
  return { label, support: labels.reduce((n, predicted) => n + matrix[label][predicted], 0), precision, recall, f1: precision + recall ? 2 * precision * recall / (precision + recall) : 0 };
});
const report = { annotatedCount: rows.length, excludedUnlabeledCount: data.items.length - rows.length, accuracy: rows.filter(x => x.humanFunction === x.predictedFunction).length / rows.length, macroF1: perClass.reduce((n, x) => n + x.f1, 0) / labels.length, perClass, confusionMatrix: matrix };
const output = JSON.stringify(report, null, 2) + "\n";
writeFileSync(input.replace(/\.json$/i, "-metrics.json"), output, "utf8");
console.log(output);
