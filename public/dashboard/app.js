// public/dashboard/app.js — v10 (feed fixed, ops colors, charts render)

(() => {
  // ===================== SETTINGS =====================
  const FOUNDER_EMAIL = "founder@nightshifthotels.com";
  const CANONICAL_ORIGIN = "https://www.nightshifthotels.com";
  const CANONICAL_PATH = "/dashboard/";
  const CANONICAL_URL = `${CANONICAL_ORIGIN}${CANONICAL_PATH}`;

  const ALWAYS_REQUIRE_LOGIN = false;
  const PERSIST_SESSION = true;

  // ===================== HELPERS =====================
  const $ = (id) => document.getElementById(id);
  const safeStr = (v) => (v === null || v === undefined) ? "" : String(v);

  const fmtInt = (n) => Number.isFinite(n) ? n.toLocaleString() : "—";
  const fmtMoney = (n) => Number.isFinite(n)
    ? n.toLocaleString(undefined, { style: "currency", currency: "USD" })
    : "—";
  const fmtPct = (n) => Number.isFinite(n) ? `${(n * 100).toFixed(1)}%` : "—";

  const parseISOish = (v) => {
    if (!v) return null;
    const s = String(v).trim();
    const d = new Date(s);
    return isNaN(d.getTime()) ? null : d;
  };

  const toYMD = (d) => {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  };

  const startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0,0,0,0);
  const endOfDay   = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate(),23,59,59,999);

  function escHtml(str) {
    return safeStr(str)
      .replace(/&/g,"&amp;")
      .replace(/</g,"&lt;")
      .replace(/>/g,"&gt;")
      .replace(/"/g,"&quot;")
      .replace(/'/g,"&#039;");
  }

  function safeJsonParse(v){
    if(!v) return null;
    if(typeof v === "object") return v;
    try{ return JSON.parse(v); }catch{ return null; }
  }

  function toNum(v){
    if(v===null||v===undefined) return NaN;
    if(typeof v==="number") return v;
    const s=String(v).replace(/[^0-9.\-]/g,"");
    const n=Number(s);
    return Number.isFinite(n)?n:NaN;
  }

  function toast(msg){
    const el=$("toast"); if(!el) return;
    el.textContent=msg;
    el.classList.add("show");
    clearTimeout(toast._t);
    toast._t=setTimeout(()=>el.classList.remove("show"),2200);
  }

  // ===================== CANONICAL =====================
  function enforceCanonicalUrl(){
    try{
      if(location.origin!==CANONICAL_ORIGIN){
        location.replace(CANONICAL_ORIGIN+location.pathname+location.search+location.hash);
        return true;
      }
      if(location.pathname==="/dashboard"||location.pathname==="/dashboard/index.html"){
        location.replace(CANONICAL_URL);
        return true;
      }
    }catch{}
    return false;
  }

  // ===================== SUPABASE =====================
  let supabaseClient=null;

  function clearSupabaseAuthStorage(){
    try{
      for(const k of Object.keys(localStorage)){
        if(k.startsWith("sb-")&&k.endsWith("-auth-token")) localStorage.removeItem(k);
      }
    }catch{}
  }

  function getSupabaseClient(){
    const cfg=window.NSA_CONFIG||{};
    if(!cfg.SUPABASE_URL||!cfg.SUPABASE_ANON_KEY||!window.supabase){
      throw new Error("Missing Supabase config.");
    }
    return window.supabase.createClient(cfg.SUPABASE_URL,cfg.SUPABASE_ANON_KEY,{
      auth:{persistSession:PERSIST_SESSION,autoRefreshToken:true,detectSessionInUrl:true}
    });
  }

  // ===================== AUTH UI =====================
  function showOverlay(show){
    const o=$("authOverlay"); if(!o) return;
    o.style.display=show?"flex":"none";
  }

  function setSessionUI(session){
    const email=session?.user?.email||"";
    $("authBadge").textContent=email?"Unlocked":"Locked";
    $("btnAuth").textContent=email?"Account":"Login";
    $("btnLogout").style.display=email?"inline-flex":"none";
    $("authStatus").textContent=email?`Signed in as ${email}`:"Not signed in";
  }

  async function hardSignOut(){
    try{ await supabaseClient.auth.signOut(); }catch{}
    clearSupabaseAuthStorage();
  }

  async function ensureAuthGate(){
    const {data:{session}}=await supabaseClient.auth.getSession();
    setSessionUI(session);

    if(!session){
      showOverlay(true);
      clearDataUI("Please sign in to load dashboard data.");
      returns false;
    }

    if(session.user.email!==FOUNDER_EMAIL){
      showOverlay(true);
      clearDataUI("Unauthorized email.");
      await hardSignOut();
      return false;
    }

    showOverlay(false);
    return true;
  }

  function initAuthHandlers(){
    $("btnAuth").onclick=()=>showOverlay(true);
    $("btnCloseAuth").onclick=()=>showOverlay(false);
    $("btnSendLink").onclick=sendMagicLink;
    $("btnResendLink").onclick=sendMagicLink;

    $("btnLogout").onclick=async()=>{
      toast("Signing out…");
      await hardSignOut();
      location.reload();
    };

    supabaseClient.auth.onAuthStateChange(async(_,session)=>{
      setSessionUI(session);
      if(session) loadAndRender();
    });
  }

  async function sendMagicLink(){
    const email=$("authEmail").value.trim();
    if(!email.includes("@")) return;

    const {error}=await supabaseClient.auth.signInWithOtp({
      email, options:{emailRedirectTo:CANONICAL_URL}
    });

    if(error){ alert(error.message); return; }
    toast("Magic link sent.");
  }

  // ===================== CONTROLS =====================
  function initControls(){
    $("rangeSelect").onchange=()=>loadAndRender();
    $("startDate").onchange=()=>loadAndRender();
    $("endDate").onchange=()=>loadAndRender();
    $("btnRefresh").onclick=()=>loadAndRender();
    $("btnExport").onclick=()=>exportCSV(filteredRows);
    $("searchInput").oninput=()=>{ applyFilters(); renderAll(); };
  }

  function getSelectedRange(){
    const mode=$("rangeSelect").value;
    const now=new Date();

    if(mode==="today") return {label:"Today",start:startOfDay(now),end:endOfDay(now)};
    if(mode==="7"||mode==="30"){
      const days=Number(mode);
      const s=new Date(now); s.setDate(now.getDate()-(days-1));
      return {label:`Last ${days} days`,start:startOfDay(s),end:endOfDay(now)};
    }

    const sVal=$("startDate").value;
    const eVal=$("endDate").value;
    if(sVal&&eVal){
      return {
        label:`${sVal} → ${eVal}`,
        start:startOfDay(new Date(sVal)),
        end:endOfDay(new Date(eVal))
      };
    }

    const s=new Date(now); s.setDate(now.getDate()-6);
    return {label:"Last 7 days",start:startOfDay(s),end:endOfDay(now)};
  }

  // ===================== FETCH =====================
  async function fetchTable(table){
    const {data,error}=await supabaseClient.from(table).select("*").order("created_at",{ascending:false}).limit(3000);
    if(error) throw error;
    return data||[];
  }

  function normalizeReservation(r){
    return {
      kind:"booking",
      when:parseISOish(r.created_at),
      guest:safeStr(r.guest_name),
      arrival:safeStr(r.arrival_date),
      nights:toNum(r.nights),
      totalDue:toNum(r.total_due),
      sentiment:"",
      summary:`Reservation for ${r.guest_name} • Arrive ${r.arrival_date}`,
      raw:r
    };
  }

  function normalizeCall(r){
    const booking=safeJsonParse(r.booking);
    return {
      kind:"call",
      when:parseISOish(r.created_at),
      guest:booking?.guest_name||"",
      arrival:booking?.arrival_date||"",
      nights:null,
      totalDue:null,
      sentiment:safeStr(r.sentiment),
      duration:toNum(r.duration_seconds),
      summary:safeStr(r.summary),
      raw:r
    };
  }

  // ===================== STATE =====================
  let allRows=[];
  let filteredRows=[];
  let lastRange=null;

  // ===================== FILTERS =====================
  function applyFilters(){
    const range=lastRange;
    const q=$("searchInput").value.toLowerCase().trim();

    filteredRows=allRows.filter(r=>{
      if(r.when){
        if(r.when<range.start||r.when>range.end) return false;
      }
      if(!q) return true;
      return JSON.stringify(r).toLowerCase().includes(q);
    });
  }

  // ===================== KPIs + OPS =====================
  function computeKPIs(rows){
    const calls=rows.filter(r=>r.kind==="call");
    const bookings=rows.filter(r=>r.kind==="booking");

    const totalCalls=calls.length;
    const totalBookings=bookings.length;
    const conv=totalCalls?totalBookings/totalCalls:NaN;

    const durations=calls.map(c=>c.duration).filter(Number.isFinite);
    const avgDur=durations.length?durations.reduce((a,b)=>a+b,0)/durations.length:NaN;

    const revenue=bookings.map(b=>b.totalDue).filter(Number.isFinite).reduce((a,b)=>a+b,0);

    const negative=calls.filter(c=>c.sentiment.toLowerCase().includes("neg")).length;
    const longCalls=calls.filter(c=>c.duration>=240).length;

    return {totalCalls,totalBookings,conv,avgDur,revenue,negative,longCalls};
  }

  function renderKPIs(k){
    const el=$("kpiGrid"); el.innerHTML="";
    const tiles=[
      ["Total calls",fmtInt(k.totalCalls)],
      ["Bookings",fmtInt(k.totalBookings)],
      ["Conversion",fmtPct(k.conv)],
      ["Revenue",fmtMoney(k.revenue)],
      ["Avg call",Number.isFinite(k.avgDur)?`${Math.round(k.avgDur)}s`:"—"]
    ];
    for(const[t,v]of tiles){
      const d=document.createElement("div");
      d.className="kpi";
      d.innerHTML=`<p class="name">${t}</p><p class="value">${v}</p>`;
      el.appendChild(d);
    }
  }

  function dot(color){
    return `<span style="display:inline-block;width:8px;height:8px;border-radius:999px;background:${color};margin-right:8px;"></span>`;
  }

  function renderOps(k){
    const negColor=k.negative>0?"#ff6b6b":"#42d392";
    const longColor=k.longCalls>0?"#ffcc66":"#42d392";

    $("opsInsights").innerHTML=`
      <div>${dot(negColor)} Negative sentiment: <b>${fmtInt(k.negative)}</b></div>
      <div>${dot(longColor)} Long calls (4m+): <b>${fmtInt(k.longCalls)}</b></div>
      <div>${dot("#6ea8ff")} Conversion: <b>${fmtPct(k.conv)}</b></div>
      <div>${dot("#6ea8ff")} Revenue: <b>${fmtMoney(k.revenue)}</b></div>
    `;
  }

  // ===================== CHARTS =====================
  function groupByDay(rows,kind){
    const map={};
    for(const r of rows){
      if(r.kind!==kind||!r.when) continue;
      const d=toYMD(r.when);
      map[d]=(map[d]||0)+1;
    }
    return map;
  }

  function renderChart(canvasId,data){
    const c=$(canvasId); if(!c) return;

    c.width=c.parentElement.clientWidth-20;
    c.height=140;

    const ctx=c.getContext("2d");
    ctx.clearRect(0,0,c.width,c.height);

    const keys=Object.keys(data).sort();
    if(!keys.length) return;

    const vals=keys.map(k=>data[k]);
    const max=Math.max(...vals);

    const w=c.width,h=c.height;
    const pad=20;
    const step=(w-pad*2)/(keys.length-1||1);

    ctx.strokeStyle="#6ea8ff";
    ctx.beginPath();

    keys.forEach((k,i)=>{
      const x=pad+i*step;
      const y=h-pad-(vals[i]/max)*(h-pad*2);
      if(i===0) ctx.moveTo(x,y); else ctx.lineTo(x,y);
    });

    ctx.stroke();
  }

  // ===================== FEED + EXPORT =====================
  function renderFeed(rows){
    $("badgeCount").textContent=fmtInt(rows.length);
    $("feedMeta").textContent=`${rows.length} items`;

    const state=$("stateBox");
    const wrap=$("tableWrap");
    const tbody=$("feedTbody");

    state.style.display="none";
    wrap.style.display="block";

    tbody.innerHTML="";

    for(const r of rows.slice(0,500)){
      const tr=document.createElement("tr");
      tr.innerHTML=`
        <td>${r.when?r.when.toLocaleString():"—"}</td>
        <td>${r.kind}</td>
        <td>${escHtml(r.guest||"—")}</td>
        <td>${escHtml(r.arrival||"—")}</td>
        <td>${Number.isFinite(r.nights)?r.nights:"—"}</td>
        <td>${Number.isFinite(r.totalDue)?fmtMoney(r.totalDue):"—"}</td>
        <td>${escHtml(r.sentiment||"—")}</td>
        <td>${escHtml(r.summary||"—")}</td>
      `;
      tbody.appendChild(tr);
    }
  }

  function exportCSV(rows){
    if(!rows.length){ toast("Nothing to export."); return; }

    const cols=["kind","time","guest","arrival","nights","total","sentiment","summary"];
    const lines=[cols.join(",")];

    for(const r of rows){
      const vals=[
        r.kind,
        r.when?r.when.toISOString():"",
        r.guest,r.arrival,
        r.nights,r.totalDue,
        r.sentiment,r.summary
      ].map(v=>`"${String(v??"").replace(/"/g,'""')}"`);
      lines.push(vals.join(","));
    }

    const blob=new Blob([lines.join("\n")],{type:"text/csv"});
    const url=URL.createObjectURL(blob);
    const a=document.createElement("a");
    a.href=url; a.download=`nightshift_${Date.now()}.csv`; a.click();
    URL.revokeObjectURL(url);
    toast("CSV exported.");
  }

  // ===================== RENDER ALL =====================
  function renderAll(){
    applyFilters();
    const k=computeKPIs(filteredRows);
    renderKPIs(k);
    renderOps(k);
    renderChart("chartCalls",groupByDay(filteredRows,"call"));
    renderChart("chartBookings",groupByDay(filteredRows,"booking"));
    renderFeed(filteredRows);
    $("lastUpdated").textContent=`Updated ${new Date().toLocaleString()}`;
  }

  function clearDataUI(msg){
    $("stateBox").textContent=msg||"—";
  }

  // ===================== LOAD =====================
  async function loadAndRender(){
    if(!(await ensureAuthGate())) return;

    try{
      lastRange=getSelectedRange();
      $("badgeWindow").textContent=lastRange.label;

      const [resv,calls]=await Promise.all([
        fetchTable("reservations"),
        fetchTable("call_logs")
      ]);

      allRows=[
        ...resv.map(normalizeReservation),
        ...calls.map(normalizeCall)
      ];

      renderAll();
      toast("Dashboard refreshed.");
    }catch(e){
      console.error(e);
      clearDataUI("Load error.");
    }
  }

  // ===================== INIT =====================
  async function init(){
    if(enforceCanonicalUrl()) return;

    try{ supabaseClient=getSupabaseClient(); }
    catch(e){ clearDataUI(e.message); return; }

    initAuthHandlers();
    initControls();

    if(ALWAYS_REQUIRE_LOGIN){
      clearSupabaseAuthStorage();
      showOverlay(true);
      return;
    }

    if(await ensureAuthGate()) loadAndRender();

    document.addEventListener("visibilitychange",()=>{
      if(document.visibilityState==="visible") loadAndRender();
    });

    window.addEventListener("pageshow",(e)=>{
      if(e.persisted) loadAndRender();
    });
  }

  document.addEventListener("DOMContentLoaded",init);
})();
