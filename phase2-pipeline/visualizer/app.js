const DATA_ROOT = "../youtube-qoe-phase3";
const labels = ["excitement_appreciation", "confusion", "humor", "instructional_reference", "quality_complaint", "navigation_indexing", "other"];
const pretty = { excitement_appreciation: "Excitement", confusion: "Confusion", humor: "Humor", instructional_reference: "Instructional", quality_complaint: "Quality issue", navigation_indexing: "Navigation", other: "Other" };
const $ = (id) => document.getElementById(id);
let manifest, selected, selectedBin = null, phase4Data = null, phase4Candidates = null, phase4Model = null;
const select = $("videoSelect"), category = $("categorySelect");

async function init() {
  try {
    const response = await fetch(`${DATA_ROOT}/manifest.json`);
    if (!response.ok) throw new Error(`Could not load Phase 3 manifest (${response.status}).`);
    manifest = await response.json();
    const rows = manifest.videos.filter(v => v.status === "processed");
    const categories = [...new Set(rows.map(v => v.category).filter(Boolean))].sort();
    category.innerHTML = `<option value="all">All categories</option>${categories.map(c => `<option>${esc(c)}</option>`).join("")}`;
    fillVideos(rows);
    select.addEventListener("change", () => loadVideo(select.value));
    category.addEventListener("change", () => { fillVideos(rows); loadVideo(select.value); });
    document.querySelectorAll(".view-tab").forEach(button=>button.addEventListener("click",()=>switchView(button.dataset.view)));
    if (rows.length) await loadVideo(rows[0].videoId);
    $("status").textContent = `${rows.length} videos loaded · ${manifest.binCount} bins each`;
    loadPhase4();
  } catch (error) {
    $("status").textContent = error.message;
    $("videoTitle").textContent = "Dataset not found";
    $("metadata").textContent = "Run Phase 3 preprocessing first. Serve the phase2-pipeline folder over HTTP (see README).";
  }
}
function fillVideos(rows) {
  const filtered = rows.filter(v => category.value === "all" || v.category === category.value);
  select.innerHTML = filtered.map(v => `<option value="${esc(v.videoId)}">${esc(v.videoId)} · ${esc(v.category || "Uncategorized")}</option>`).join("");
}
async function loadVideo(id) {
  if (!id) return;
  try {
    const response = await fetch(`${DATA_ROOT}/videos/${encodeURIComponent(id)}.json`);
    if (!response.ok) throw new Error(`Could not load ${id}.`);
    selected = await response.json(); selectedBin = null;
    render(selected);
  } catch (error) { $("status").textContent = error.message; }
}
function render(data) {
  const title = data.title || data.videoId;
  $("videoTitle").textContent = title;
  $("youtubeLink").href = `https://www.youtube.com/watch?v=${data.videoId}`;
  $("playerWrap").innerHTML = `<iframe id="youtubePlayer" src="https://www.youtube-nocookie.com/embed/${encodeURIComponent(data.videoId)}?rel=0&playsinline=1" title="${esc(title)}" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" allowfullscreen></iframe>`;
  $("metadata").innerHTML = `<span>${esc(data.category || "")}</span><span>${duration(data.durationSeconds)}</span><span>${fmt(data.viewCount)} views</span><span>Weight ${fmt(data.reliabilityWeight, 1)}</span>`;
  const comments = data.comments.length, refs = data.bins.reduce((a,b)=>a+b.timestampReferenceCount,0), quality = data.bins.reduce((a,b)=>a+b.functionCounts.quality_complaint,0);
  $("summary").innerHTML = metric("Replay markers", data.bins.filter(b=>b.replayIntensity!==null).length, "Most Replayed signal across bins") + metric("Timestamp comments", comments, `${refs} timestamp references`) + metric("Quality flags", quality, "Keyword baseline") + metric("Cleaned", data.cleaning.exactDuplicatesRemoved + data.cleaning.likelySpamRemoved, "duplicates + likely spam removed");
  drawChart(data); drawHeatmap(data); showBin(Math.floor((selectedBin ?? 0))); renderPhase4();
}
async function loadPhase4(){
  const get=async name=>{try{const r=await fetch(`../youtube-qoe-phase4/${name}`);return r.ok?await r.json():null;}catch{return null;}};
  const [status,features,candidates,model,predictions]=await Promise.all([get("status.json"),get("features.json"),get("candidate-segments.json"),get("model.json"),get("predictions.json")]);
  phase4Data={status,features,predictions};phase4Candidates=candidates;phase4Model=model;renderPhase4();
}
function switchView(view){
  const isPhase4=view==="phase4";
  document.querySelectorAll(".view-tab").forEach(b=>b.classList.toggle("active",b.dataset.view===view));
  for(const id of ["videoSelect","categorySelect"]){$(id).closest("label").style.display=isPhase4?"none":"grid";}
  for(const selector of [".overview",".chart-panel",".lower-grid"])document.querySelector(selector).hidden=isPhase4;
  $("phase4View").hidden=!isPhase4;
  if(isPhase4)renderPhase4();
}
function renderPhase4(){
  if(!phase4Data)return;
  const st=phase4Data.status||{};
  const ready=st.status==="model_ready";
  $("phase4Status").innerHTML=`<span class="status-pip ${ready?"ready":"pending"}"></span><span>${ready?"MODEL FITTED":"MEASUREMENTS NEEDED"}</span>`;
  const featCount=phase4Data.features?.rows?.length??st.featureRows??0;
  const candidateCount=phase4Candidates?.segments?.length??st.candidateSegments??0;
  const planned=phase4Candidates?.plannedMeasurementRows??st.plannedMeasurementRows??0;
  $("phase4Metrics").innerHTML=metric("Behavior rows",fmt(featCount),"100 segments per video")+metric("Candidate segments",fmt(candidateCount),"high and low salience")+metric("Planned conditions",fmt(planned),"six per candidate")+metric("Labeled outcomes",fmt(phase4Model?.trainingRows??0),ready?"model training rows":"awaiting measured labels");
  $("phase4VideoBadge").textContent=selected?.videoId||"SELECT VIDEO";
  $("conditionCount").textContent="3 IMPAIRMENT TYPES · 2 LEVELS";
  const row=phase4Data.features?.rows?.find(r=>r.videoId===selected?.videoId&&r.binIndex===selectedBin)??phase4Data.features?.rows?.find(r=>r.videoId===selected?.videoId&&r.binIndex===0);
  const featureNames={replayZ:"Replay intensity",prominenceZ:"Replay prominence",commentActivityZ:"Comment activity",emotionZ:"Emotion magnitude",qualityComplaintZ:"Quality complaints",confusionZ:"Confusion",excitementZ:"Excitement",logViews:"Log views",logComments:"Log comments"};
  const values=row?.features??{};const max=Math.max(1,...Object.values(values).map(Math.abs));
  $("featureBars").innerHTML=row?Object.entries(featureNames).map(([k,label])=>{const v=values[k]??0;const width=Math.abs(v)/max*43;return `<div class="feature-row"><span>${label}</span><div class="feature-track"><i class="feature-mid"></i><i class="feature-fill ${v<0?"negative":""}" style="width:${width}%" data-side="${v<0?"left":"right"}"></i></div><b>${v.toFixed(2)}</b></div>`}).join(""):"<div class='empty'>Phase 4 feature table is not generated yet. Run <code>npm run phase4:prepare</code>.</div>";
  const candidates=(phase4Candidates?.segments??[]).filter(r=>r.videoId===selected?.videoId).sort((a,b)=>a.binIndex-b.binIndex);
  $("candidateList").innerHTML=candidates.length?candidates.map((c,i)=>`<button class="candidate-row" data-bin="${c.binIndex}"><span class="candidate-index">${String(i+1).padStart(2,"0")}</span><span><b>Segment ${String(c.binIndex+1).padStart(2,"0")}</b><small>${duration(c.startSeconds)}–${duration(c.endSeconds)} · ${((c.startSeconds/selected.durationSeconds)*100).toFixed(0)}% through video</small></span><span class="candidate-type ${c.salienceTier}">${esc((c.salienceTier||"candidate").toUpperCase())}<small>salience</small></span></button>`).join(""):"<div class='empty'>No candidates yet. Run Phase 4 preparation to create the study plan.</div>";
  document.querySelectorAll(".candidate-row").forEach(button=>button.addEventListener("click",()=>{selectedBin=Number(button.dataset.bin);drawChart(selected);showBin(selectedBin);renderPhase4();seek(selected.bins[selectedBin].midpointSeconds)}));
  $("modelBadge").textContent=ready?"RIDGE MODEL FITTED":"NOT TRAINED";
  const predictions=phase4Data.predictions?.predictions?.filter(p=>p.videoId===selected?.videoId&&(selectedBin===null||p.binIndex===selectedBin))??[];
  $("modelOutput").innerHTML=ready&&predictions.length?`<p class="model-caption">Predicted ${esc(phase4Model.target)} for selected segment · computational proxy only</p><div class="prediction-grid">${predictions.map(p=>`<div><span>${esc(p.impairment.replaceAll("_"," "))} · ${esc(p.severity)}</span><b>${fmt(p.predictedComputationalQoeScore,3)}</b></div>`).join("")}</div><p class="small-note">Training rows: ${phase4Model.trainingRows} · training RMSE: ${fmt(phase4Model.trainingRmse,3)} · ${esc(phase4Model.warning)}</p>`:`<div class="empty">${ready?"Choose a candidate segment to inspect model estimates.":"No fitted model yet. Add measured objective outcomes to the Phase 4 measurement sheet, document the computational target, then train the initial model."}</div>`;
}
function metric(label, value, sub) { return `<div class="metric panel"><span class="label">${esc(label)}</span><div><div class="value">${esc(String(value))}</div><div class="sub">${esc(sub)}</div></div></div>`; }
function drawChart(data) {
  const svg = $("signalChart"), W = 1000, H = 330, left = 42, right = 15, top = 18, bottom = 30, cw = W-left-right, ch = H-top-bottom;
  const bins = data.bins, maxComments = Math.max(1, ...bins.map(b => b.timestampReferenceCount)), pvals = bins.map(b=>b.localReplayProminence).filter(Number.isFinite), pmin=Math.min(0,...pvals), pmax=Math.max(.001,...pvals);
  const x = i => left + (i + .5) * cw / 100, y = v => top + (1-v)*ch;
  const path = (values, fn) => values.map((v,i)=>`${i?"L":"M"}${x(i).toFixed(1)},${fn(v).toFixed(1)}`).join(" ");
  let html = "";
  for(let t=0;t<=4;t++){const yy=top+ch*t/4;html+=`<line x1="${left}" y1="${yy}" x2="${W-right}" y2="${yy}" stroke="#29312e"/><text x="${left-9}" y="${yy+3}" fill="#829087" font-size="9" text-anchor="end" font-family="DM Mono">${(1-t/4).toFixed(1)}</text>`}
  bins.forEach((b,i)=>{const bw=cw/100*.62,bh=(b.timestampReferenceCount/maxComments)*ch*.43;html+=`<rect x="${(x(i)-bw/2).toFixed(2)}" y="${(top+ch-bh).toFixed(2)}" width="${bw.toFixed(2)}" height="${bh.toFixed(2)}" rx="1.5" fill="#76a9ff" opacity=".55"/>`});
  const prom = bins.map(b=>(b.localReplayProminence-pmin)/(pmax-pmin));
  html+=`<path d="${path(prom,y)}" fill="none" stroke="#f4bb68" stroke-width="1.5" opacity=".9"/>`;
  html+=`<path d="${path(bins.map(b=>b.replayIntensity ?? 0),y)}" fill="none" stroke="#a7f3d0" stroke-width="2.5" stroke-linejoin="round"/>`;
  const quality=bins.map(b=>b.functionCounts.quality_complaint), maxQ=Math.max(1,...quality);
  quality.forEach((v,i)=>{if(v)html+=`<circle cx="${x(i)}" cy="${top+ch-(v/maxQ)*ch*.25}" r="${Math.min(5,2+v)}" fill="#f07d71" stroke="#171b1a" stroke-width="1"/>`});
  bins.forEach((b,i)=>{html+=`<rect data-bin="${i}" x="${left+i*cw/100}" y="${top}" width="${cw/100+0.3}" height="${ch}" fill="transparent" class="hit"/>`});
  if(selectedBin!==null)html+=`<line x1="${x(selectedBin)}" x2="${x(selectedBin)}" y1="${top}" y2="${top+ch}" stroke="#fff" stroke-dasharray="3 4" opacity=".8"/>`;
  svg.innerHTML=html;svg.querySelectorAll(".hit").forEach(el=>el.addEventListener("click",()=>{selectedBin=Number(el.dataset.bin);drawChart(data);showBin(selectedBin);seek(data.bins[selectedBin].midpointSeconds)}));
}
function drawHeatmap(data) {
  const root=$("heatmap"), max=Math.max(1,...data.bins.map(b=>Math.max(...labels.map(l=>b.functionCounts[l]))));
  root.innerHTML=labels.map(label=>`<div class="heat-label">${pretty[label]}</div>`+Array.from({length:20},(_,segment)=>{const count=data.bins.slice(segment*5,segment*5+5).reduce((n,b)=>n+b.functionCounts[label],0);const intensity=count?Math.min(.95,.15+.8*count/max):.045;return `<div class="heat-cell" title="${pretty[label]} · ${segment*5}–${segment*5+4}: ${count} references" style="background:rgba(${label==="quality_complaint"?"240,125,113":"81,214,160"},${intensity})" data-bin="${segment*5}"></div>`}).join("")).join("");
  root.querySelectorAll(".heat-cell").forEach(el=>el.addEventListener("click",()=>{selectedBin=Number(el.dataset.bin);drawChart(data);showBin(selectedBin);seek(data.bins[selectedBin].midpointSeconds)}));
}
function showBin(i) {
  if(!selected)return;const b=selected.bins[i],a=b.relativeStart*100,z=b.relativeEnd*100;
  $("binHeading").textContent=`Segment ${String(i+1).padStart(2,"0")} · ${duration(b.startSeconds)}–${duration(b.endSeconds)}`;
  $("binDetails").innerHTML=`Replay <b>${b.replayIntensity===null?"unavailable":fmt(b.replayIntensity,3)}</b> &nbsp; Prominence <b>${fmt(b.localReplayProminence,3)}</b><br>Timestamp refs <b>${b.timestampReferenceCount}</b> &nbsp; Smoothed rate <b>${fmt(b.commentRateSmoothed,2)}</b><br>Sentiment magnitude <b>${fmt(b.meanAbsoluteSentiment,2)}</b> &nbsp; Progress <b>${a.toFixed(0)}–${z.toFixed(0)}%</b><br>${labels.map(k=>`${pretty[k]} ${b.functionCounts[k]}`).join(" · ")}`;
  const comments=selected.comments.filter(c=>c.timestamps.some(t=>Math.min(99,Math.floor(t.relativePosition*100))===i));
  $("commentsList").innerHTML=comments.length?comments.map(c=>`<article class="comment"><div class="comment-head"><span>${esc(pretty[c.functionLabel]||c.functionLabel)}</span><span>${c.timestamps.filter(t=>Math.floor(t.relativePosition*100)===i).map(t=>esc(t.timestampText)).join(", ")}</span></div><p>${esc(c.cleanedText)}</p></article>`).join(""):`<div class="empty">No retained timestamped comments in this segment.</div>`;
}
function seek(seconds){const p=$("youtubePlayer");if(!p)return;const id=selected.videoId;p.src=`https://www.youtube-nocookie.com/embed/${encodeURIComponent(id)}?start=${Math.floor(seconds)}&autoplay=1&rel=0&playsinline=1`;}
function duration(s){s=Math.max(0,Math.floor(Number(s)||0));const h=Math.floor(s/3600),m=Math.floor(s%3600/60),sec=s%60;return h?`${h}:${String(m).padStart(2,"0")}:${String(sec).padStart(2,"0")}`:`${m}:${String(sec).padStart(2,"0")}`}
function fmt(n,d=0){return n===null||n===undefined||!Number.isFinite(Number(n))?"—":Number(n).toLocaleString(undefined,{maximumFractionDigits:d})}
function esc(v){return String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[c]))}
init();
