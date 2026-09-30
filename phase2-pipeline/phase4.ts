import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import process from "node:process";

type Bin = { binIndex: number; relativeStart: number; relativeEnd: number; midpointSeconds: number; replayIntensity: number | null; localReplayProminence: number | null; commentRateSmoothedLogNormalized: number; meanAbsoluteSentiment: number; functionCounts: Record<string, number>; videoViewCount: number | null; videoCommentCount: number | null; reliabilityWeight: number };
type Video = { videoId: string; category: string | null; durationSeconds: number; reliabilityWeight: number; bins: Bin[] };
type Feature = { videoId: string; category: string | null; binIndex: number; startSeconds: number; endSeconds: number; midpointSeconds: number; salienceIndex: number; salienceTier?: "high" | "low"; features: Record<string, number> };
const ROOT = "youtube-qoe-phase4";
const OUTCOMES = ["vmafDelta", "ssimDelta", "psnrDelta", "rebufferDurationSeconds"] as const;
const CONDITIONS = [
  { impairment: "rebuffering", severity: "2s", severityValue: 2 }, { impairment: "rebuffering", severity: "5s", severityValue: 5 },
  { impairment: "bitrate_reduction", severity: "50_percent", severityValue: 0.5 }, { impairment: "bitrate_reduction", severity: "25_percent", severityValue: 0.75 },
  { impairment: "resolution_reduction", severity: "50_percent", severityValue: 0.5 }, { impairment: "resolution_reduction", severity: "25_percent", severityValue: 0.75 }
];
const FEATURES = ["replayZ", "prominenceZ", "commentActivityZ", "emotionZ", "qualityComplaintZ", "confusionZ", "excitementZ", "logViews", "logComments", "isRebuffering", "isBitrateReduction", "isResolutionReduction", "severityValue"];
function read<T>(p: string): T { return JSON.parse(readFileSync(p, "utf8")) as T; }
function write(p: string, value: unknown) { writeFileSync(p, JSON.stringify(value, null, 2) + "\n", "utf8"); }
function mean(xs: number[]) { return xs.reduce((a,b)=>a+b,0)/(xs.length||1); }
function sd(xs: number[]) { const m=mean(xs); return Math.sqrt(mean(xs.map(x=>(x-m)**2))); }
function zScores(xs: number[]) { const m=mean(xs), s=sd(xs); return xs.map(x=>s? (x-m)/s : 0); }
function csvCell(v: unknown) { return `"${String(v ?? "").replaceAll('"','""')}"`; }
function csv(rows: unknown[][]) { return rows.map(row=>row.map(csvCell).join(",")).join("\n")+"\n"; }
function parseCsv(text: string): string[][] {
  const rows: string[][]=[]; let row:string[]=[], cell="", quoted=false;
  for(let i=0;i<text.length;i++){const c=text[i]; if(quoted){if(c==='"'&&text[i+1]==='"'){cell+='"';i++;}else if(c==='"')quoted=false;else cell+=c;}else if(c==='"')quoted=true;else if(c===','){row.push(cell);cell="";}else if(c==='\n'){row.push(cell);rows.push(row);row=[];cell="";}else if(c!=='\r')cell+=c;}
  if(cell||row.length){row.push(cell);rows.push(row);} return rows;
}
function featureRows(): Feature[] {
  const manifest=read<{videos:Array<{videoId:string;status:string}>}>("youtube-qoe-phase3/manifest.json"); const out:Feature[]=[];
  for(const entry of manifest.videos.filter(v=>v.status==="processed")){
    const v=read<Video>(join("youtube-qoe-phase3","videos",`${entry.videoId}.json`));
    const n=v.bins.length;
    const raw:Record<string,number[]>={replay:v.bins.map(b=>b.replayIntensity??0),prominence:v.bins.map(b=>b.localReplayProminence??0),comments:v.bins.map(b=>b.commentRateSmoothedLogNormalized),emotion:v.bins.map(b=>b.meanAbsoluteSentiment),quality:v.bins.map(b=>b.functionCounts.quality_complaint??0),confusion:v.bins.map(b=>b.functionCounts.confusion??0),excitement:v.bins.map(b=>b.functionCounts.excitement_appreciation??0)};
    const zs=Object.fromEntries(Object.entries(raw).map(([k,x])=>[k,zScores(x)])) as Record<string,number[]>;
    const salience=v.bins.map((_,i)=>(zs.replay[i]+zs.prominence[i]+zs.comments[i]+zs.emotion[i])/4);
    for(let i=0;i<n;i++)out.push({videoId:v.videoId,category:v.category,binIndex:i,startSeconds:v.bins[i].relativeStart*v.durationSeconds,endSeconds:v.bins[i].relativeEnd*v.durationSeconds,midpointSeconds:v.bins[i].midpointSeconds,salienceIndex:salience[i],features:{replayZ:zs.replay[i],prominenceZ:zs.prominence[i],commentActivityZ:zs.comments[i],emotionZ:zs.emotion[i],qualityComplaintZ:zs.quality[i],confusionZ:zs.confusion[i],excitementZ:zs.excitement[i],logViews:Math.log1p(Math.max(0,v.bins[i].videoViewCount??0)),logComments:Math.log1p(Math.max(0,v.bins[i].videoCommentCount??0))}});
  }
  return out;
}
function chooseCandidates(rows:Feature[]) {
  const byVideo=new Map<string,Feature[]>();for(const r of rows){const a=byVideo.get(r.videoId)??[];a.push(r);byVideo.set(r.videoId,a);}
  const selected:Feature[]=[];
  for(const a of byVideo.values()){
    const sorted=[...a].sort((x,y)=>y.salienceIndex-x.salienceIndex); const high:Feature[]=[];
    for(const r of sorted){if(high.every(x=>Math.abs(x.binIndex-r.binIndex)>=5)){high.push(r);if(high.length===2)break;}}
    const low:Feature[]=[];
    for(const r of [...sorted].reverse()){if([...high,...low].every(x=>Math.abs(x.binIndex-r.binIndex)>=5)){low.push(r);if(low.length===2)break;}}
    selected.push(...high.map(r=>({...r,salienceTier:"high" as const})),...low.map(r=>({...r,salienceTier:"low" as const})));
  }
  return selected;
}
function matrixRow(f:Feature, impairment:string, severity:number):number[]{return [f.features.replayZ,f.features.prominenceZ,f.features.commentActivityZ,f.features.emotionZ,f.features.qualityComplaintZ,f.features.confusionZ,f.features.excitementZ,f.features.logViews,f.features.logComments,+(impairment==="rebuffering"),+(impairment==="bitrate_reduction"),+(impairment==="resolution_reduction"),severity];}
function solve(a:number[][],b:number[]):number[]{const n=b.length,m=a.map((r,i)=>[...r,b[i]]);for(let i=0;i<n;i++){let p=i;for(let j=i+1;j<n;j++)if(Math.abs(m[j][i])>Math.abs(m[p][i]))p=j;[m[i],m[p]]=[m[p],m[i]];const d=m[i][i];if(Math.abs(d)<1e-10)continue;for(let k=i;k<=n;k++)m[i][k]/=d;for(let j=0;j<n;j++)if(j!==i){const f=m[j][i];for(let k=i;k<=n;k++)m[j][k]-=f*m[i][k];}}return m.map(r=>r[n]);}
function fit() {
  const p=join(ROOT,"measurements.csv");if(!existsSync(p))throw Error(`Missing ${p}; run npm run phase4:prepare first.`);
  const parsed=parseCsv(readFileSync(p,"utf8"));const header=parsed.shift()??[];const idx=Object.fromEntries(header.map((h,i)=>[h,i]));
  const examples=parsed.filter(r=>r.length>1&&Number.isFinite(Number(r[idx.computationalQoeScore]))&&r[idx.computationalQoeScore]!=="");
  if(examples.length<FEATURES.length+2)throw Error(`Need at least ${FEATURES.length+2} labeled measurement rows; found ${examples.length}. Add measured computationalQoeScore values to ${p}.`);
  const features=featureRows();const map=new Map(features.map(f=>[`${f.videoId}:${f.binIndex}`,f]));
  const X:number[][]=[], y:number[]=[];for(const row of examples){const f=map.get(`${row[idx.videoId]}:${row[idx.binIndex]}`);if(!f)continue;const severity=Number(row[idx.severityValue]);X.push([1,...matrixRow(f,row[idx.impairment],Number.isFinite(severity)?severity:0)]);y.push(Number(row[idx.computationalQoeScore]));}
  const d=X[0].length, ridge=1;const xtx=Array.from({length:d},(_,i)=>Array.from({length:d},(_,j)=>X.reduce((s,r)=>s+r[i]*r[j],0)+(i===j&&i>0?ridge:0)));const xty=Array.from({length:d},(_,i)=>X.reduce((s,r,k)=>s+r[i]*y[k],0));const coefficients=solve(xtx,xty);
  const predictions=features.flatMap(f=>CONDITIONS.map(c=>({videoId:f.videoId,binIndex:f.binIndex,impairment:c.impairment,severity:c.severity,severityValue:c.severityValue,predictedComputationalQoeScore:coefficients[0]+matrixRow(f,c.impairment,c.severityValue).reduce((s,x,i)=>s+x*coefficients[i+1],0)})));
  mkdirSync(ROOT,{recursive:true});write(join(ROOT,"model.json"),{schemaVersion:"4.0.0",trainedAt:new Date().toISOString(),model:"ridge_linear_regression",ridge,trainingRows:X.length,target:"computationalQoeScore (higher is better; user-defined computational objective composite)",featureNames:["intercept",...FEATURES],coefficients,trainingRmse:Math.sqrt(mean(X.map((r,i)=>(r.reduce((s,x,j)=>s+x*coefficients[j],0)-y[i])**2))),warning:"Computational target is a training proxy, not subjective QoE ground truth."});
  write(join(ROOT,"predictions.json"),{schemaVersion:"4.0.0",target:"computationalQoeScore",predictions});
  write(join(ROOT,"status.json"),{status:"model_ready",trainingRows:X.length,trainedAt:new Date().toISOString(),target:"computationalQoeScore",warning:"Computational target is a training proxy, not subjective QoE ground truth."});
  console.log(`Trained ridge model on ${X.length} measured rows. RMSE=${Math.sqrt(mean(X.map((r,i)=>(r.reduce((s,x,j)=>s+x*coefficients[j],0)-y[i])**2))).toFixed(4)}`);
}
function prepare(){
  const rows=featureRows(), candidates=chooseCandidates(rows);mkdirSync(ROOT,{recursive:true});
  write(join(ROOT,"features.json"),{schemaVersion:"4.0.0",generatedAt:new Date().toISOString(),standardization:"segment features z-scored within each video; engagement control variables log1p-transformed and retained",featureNames:FEATURES,rows});
  const csvRows=[ ["videoId","binIndex","segmentStartSeconds","segmentEndSeconds","impairment","severity","severityValue","referenceClipPath","impairedClipPath",...OUTCOMES,"computationalQoeScore"] ];
  for(const f of candidates)for(const c of CONDITIONS)csvRows.push([f.videoId,f.binIndex,f.startSeconds.toFixed(3),f.endSeconds.toFixed(3),c.impairment,c.severity,c.severityValue,`media/${f.videoId}/bin-${String(f.binIndex).padStart(3,"0")}-reference.mp4`,`media/${f.videoId}/bin-${String(f.binIndex).padStart(3,"0")}-${c.impairment}-${c.severity}.mp4`,...OUTCOMES.map(()=>""),""]);
  writeFileSync(join(ROOT,"measurements.csv"),csv(csvRows),"utf8");
  write(join(ROOT,"candidate-segments.json"),{selection:"Two high and two low standardized behavioral salience segments per video, at least five bins apart.",segments:candidates.map(({features,...f})=>f),conditions:CONDITIONS,plannedMeasurementRows:csvRows.length-1});
  write(join(ROOT,"status.json"),{status:"awaiting_measurements",featureRows:rows.length,candidateSegments:candidates.length,plannedMeasurementRows:csvRows.length-1,availableOutcomes:OUTCOMES,measurementTemplate:"measurements.csv",notes:["No source media files or FFmpeg executable were found in the workspace.","Populate the outcome columns from controlled impairment runs; no synthetic measurements or QoE targets are generated.","Define and document the computationalQoeScore recipe before training. It is a proxy and must not be described as subjective ground truth."]});
  console.log(`Prepared ${rows.length} behavior feature rows, ${candidates.length} candidate segments, and ${csvRows.length-1} measurement rows.`);
}
const mode=process.argv[2]??"prepare";if(mode==="prepare")prepare();else if(mode==="train")fit();else throw Error("Usage: node --experimental-strip-types phase4.ts [prepare|train]");
