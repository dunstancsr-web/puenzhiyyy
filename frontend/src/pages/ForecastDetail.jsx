import React, { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  ReferenceLine, ReferenceDot, BarChart, Bar, Legend,
} from "recharts";
import { RefreshCw, ArrowLeft, Info } from "lucide-react";
import ColHint from "../components/ColHint";
import HoverHint from "../components/HoverHint";
import { SliderField } from "../components/FormField";
import LoadingState from "../components/LoadingState";
import ErrorState from "../components/ErrorState";
import { api } from "../api/inventory";

// ─────────────────────────────────────────────────────────────────────────────
// FORECAST DETAIL (MVP2 Day 5) - "why this forecast," one SKU at a time.
//
// A dedicated full page, not a tab on the SKU edit modal (Stan's call): the
// model picker, the reasoning chain, the what-if sandbox and the reorder-cycle
// simulation together are dense enough that folding them into the existing
// modal would fight its own layout, and this is the one place in the app
// meant to be read start to finish rather than skimmed.
//
// Everything here traces to a real source: sales history and the active
// model's own forecast (engines/forecast.js), safety stock and the reorder
// point (safetystock.js via King's formula, unmodified), the risk buffer
// (riskbuffer.js). The what-if sandbox calls POST /forecast/preview for every
// number it shows - it does NOT reimplement King's formula in this file. That
// would be exactly the "derived value computed twice" bug class rules.md
// documents a real 257 MT incident from.
// ─────────────────────────────────────────────────────────────────────────────

const MODEL_ORDER = ["naive_seasonal", "linear_trend", "holt_winters", "holt_damped_seasonal"];
const MODEL_COLOR = {
  naive_seasonal: "var(--blue)", linear_trend: "var(--orange)", holt_winters: "var(--green)",
  holt_damped_seasonal: "var(--purple)",
};
const TIER_SERVICE_LEVEL = { A: 98, B: 95, C: 90 }; // midpoints of proposed ABC-tier default bands
const DAY_MS = 86_400_000;

const round1 = (n) => Math.round(n * 10) / 10;

export default function ForecastDetail() {
  const { skuId } = useParams();
  const navigate = useNavigate();

  const [sku, setSku] = useState(null);
  const [forecastData, setForecastData] = useState(null); // { history, forecast }
  const [invHistory, setInvHistory] = useState(null);
  const [models, setModels] = useState(null);
  const [error, setError] = useState(null);
  const [recomputing, setRecomputing] = useState(false);
  const [mode, setMode] = useState("auto"); // "auto" | "manual", UI-only until a save happens

  const load = useCallback(async () => {
    setError(null);
    try {
      const [skuData, fData, hData, modelsData] = await Promise.all([
        api.getSku(skuId),
        api.getSkuForecast(skuId),
        api.getSkuInventoryHistory(skuId, 12),
        api.getForecastModels(),
      ]);
      setSku(skuData);
      setForecastData(fData);
      setInvHistory(hData);
      setModels(modelsData.models);
      setMode(skuData.forecast_model && skuData.forecast_model !== "auto" ? "manual" : "auto");
    } catch (err) {
      setError(err.message || "Failed to load forecast");
    }
  }, [skuId]);

  useEffect(() => { load(); }, [load]);

  // ── Sandbox inputs, seeded from the saved SKU once it loads ────────────────
  const [inputs, setInputs] = useState(null);
  const savedInputs = useMemo(() => sku && ({
    leadTimeDays: sku.lead_time_days,
    leadTimeStdDays: sku.lead_time_std_days,
    serviceLevelPct: Math.round(sku.target_service_level * 100),
    targetStock: sku.target_stock,
  }), [sku]);
  useEffect(() => { if (savedInputs && !inputs) setInputs(savedInputs); }, [savedInputs, inputs]);

  // ── Live preview: debounced so a slider drag doesn't fire a request per pixel ──
  const [preview, setPreview] = useState(null);
  const [previewError, setPreviewError] = useState(null);
  const debounceRef = useRef(null);

  // Scroll targets for DataStory's "see how" buttons, same
  // scrollIntoView(prefers-reduced-motion) pattern Dashboard.jsx uses for its
  // Needs Attention jump.
  const modelRef = useRef(null);
  const sandboxRef = useRef(null);
  const simRef = useRef(null);
  useEffect(() => {
    if (!inputs) return;
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      try {
        const p = await api.previewForecast(skuId, {
          lead_time_days: inputs.leadTimeDays,
          lead_time_std_days: inputs.leadTimeStdDays,
          target_service_level: inputs.serviceLevelPct / 100,
          target_stock: inputs.targetStock,
        });
        setPreview(p);
        setPreviewError(null);
      } catch (err) {
        setPreview(null);
        setPreviewError(err.message);
      }
    }, 200);
    return () => clearTimeout(debounceRef.current);
    // forecastData?.forecast?.generated_at: Recompute changes the ACTIVE
    // forecast without changing `inputs` at all, so without this the preview
    // stayed on its pre-recompute result (often the "No forecast yet" error
    // from before one existed) until a full page reload. Found live: the new
    // DataStory panel above stuck on "Computing…" right after clicking the
    // page's own primary Recompute button.
  }, [inputs, skuId, forecastData?.forecast?.generated_at]);

  const setInput = (key) => (value) => setInputs((s) => ({ ...s, [key]: Number(value) }));
  const resetInputs = () => setInputs(savedInputs);

  const recompute = async (model) => {
    setRecomputing(true);
    try {
      if (model) await api.setForecastConfig(skuId, { forecast_model: model, use_forecast: sku.use_forecast });
      else if (!sku.forecast_model) await api.setForecastConfig(skuId, { forecast_model: "auto" });
      await api.recomputeForecast(skuId);
      await load();
    } catch (err) {
      setError(err.message || "Failed to recompute");
    } finally {
      setRecomputing(false);
    }
  };

  const setMode_ = async (m) => {
    setMode(m);
    if (m === "auto" && sku.forecast_model !== "auto") {
      try {
        await api.setForecastConfig(skuId, { forecast_model: "auto" });
        await recompute();
      } catch (err) {
        setError(err.message || "Failed to switch to auto mode");
      }
    }
  };

  const toggleUseForecast = async () => {
    try {
      await api.setForecastConfig(skuId, { use_forecast: !sku.use_forecast });
      await load();
    } catch (err) {
      setError(err.message || "Failed to update forecast setting");
    }
  };

  if (error) return <ErrorState message={error} onRetry={load} />;
  if (!sku || !forecastData || !invHistory || !models || !inputs) return <LoadingState label="Loading forecast…" />;

  const { history, forecast } = forecastData;
  const activeModel = forecast?.model || sku.forecast_model || "naive_seasonal";
  const scores = forecast?.candidate_scores || null;
  const bestScore = scores ? Math.min(...Object.values(scores).filter((v) => v != null)) : null;

  return (
    <div>
      <ForecastHeader sku={sku} forecast={forecast} onBack={() => navigate("/inventory")} onRecompute={() => recompute()} recomputing={recomputing} />

      <DataStory sku={sku} preview={preview} hasForecast={!!forecast} modelRef={modelRef} simRef={simRef} sandboxRef={sandboxRef} />

      <div ref={modelRef}>
        <ModelPicker
          mode={mode} setMode={setMode_} activeModel={activeModel} scores={scores} bestScore={bestScore}
          models={models} onPick={(id) => { if (mode === "manual") recompute(id); }} lowConfidence={forecast?.low_confidence}
        />
      </div>

      <SalesChart history={history} forecast={forecast} activeModel={activeModel} />

      <div ref={sandboxRef}>
        <WhatIfSandbox
          sku={sku} inputs={inputs} setInput={setInput} onReset={resetInputs}
          preview={preview} previewError={previewError} hasForecast={!!forecast}
        />
      </div>

      <ReasoningChain sku={sku} preview={preview} hasForecast={!!forecast} onUseForecast={toggleUseForecast} modelRef={modelRef} />

      {forecast && preview && (
        <>
          <div ref={simRef}>
            <ReorderSimulation invHistory={invHistory} preview={preview} inputs={inputs} sku={sku} />
          </div>
          <FlowChart invHistory={invHistory} />
        </>
      )}

      <div style={{ textAlign: "center", fontSize: "var(--text-sm)", color: "var(--text-secondary)", padding: "8px 0 24px" }}>
        A policy-change suggestion for this SKU appears on{" "}
        {/* whiteSpace: nowrap - see ActionItems.jsx's identical link for why. */}
        <Link to="/alerts" style={{ color: "var(--blue-text)", fontWeight: 600, whiteSpace: "nowrap" }}>Actions Needed</Link>{" "}
        once the gap between approved and suggested is large enough. Approve, amend, or reject it there.
      </div>
    </div>
  );
}

// ── Header ───────────────────────────────────────────────────────────────────
// MVP2 Day 6: a recompute-freshness nudge. STALE_DAYS is a judgment call
// (nothing in this app tracks how often demand shifts enough to warrant a
// recompute), not a derived threshold - flagged as such rather than dressed
// up as more principled than it is.
const STALE_DAYS = 14;
function freshnessDays(iso) {
  if (!iso) return null;
  return Math.floor((Date.now() - new Date(iso.replace(" ", "T") + "Z").getTime()) / 86_400_000);
}

function ForecastHeader({ sku, forecast, onBack, onRecompute, recomputing }) {
  const staleDays = forecast ? freshnessDays(forecast.generated_at) : null;
  const isStale = staleDays != null && staleDays >= STALE_DAYS;
  return (
    <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 16, marginBottom: 16, flexWrap: "wrap" }}>
      <div>
        <button onClick={onBack} style={{
          display: "flex", alignItems: "center", gap: 5, background: "none", border: "none", cursor: "pointer",
          color: "var(--text-muted)", fontSize: "var(--text-xs)", fontWeight: 600, padding: 0, marginBottom: 8,
        }}>
          <ArrowLeft size={13} /> Inventory
        </button>
        <h1 style={{ fontSize: "var(--text-xl)", fontWeight: 700, display: "flex", alignItems: "center", gap: 8 }}>
          {sku.product_name}
          <span style={{ fontSize: "var(--text-base)", fontWeight: 500, color: "var(--text-muted)" }}>{sku.sku_id}</span>
        </h1>
        <p style={{ fontSize: "var(--text-sm)", color: "var(--text-secondary)", marginTop: 4 }}>
          {sku.country_of_origin} · {sku.supplier} · {sku.lead_time_days}-day lead time
        </p>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <Stat label="Current reorder pt" tip={{
            what: "The approved reorder point - the value alerts and health status actually key off today.",
            how: "Changed on Actions Needed, by approving a policy-change suggestion, or from Inventory directly. Never changes just from looking at this page.",
          }} value={`${Math.round(sku.reorder_point_policy)} MT`} />
          <span style={{ color: "var(--text-muted)", fontSize: 20 }}>&rarr;</span>
          <Stat
            label="Suggested reorder pt"
            tip={{
              what: "What the safety-stock formula would set the reorder point to, from this SKU's demand rate, lead time and target service level.",
              how: "The badge underneath says which demand rate fed it - the plain 30-day average by default, or a statistical model once you switch one on. See the full breakdown below.",
            }}
            value={`${Math.round(sku.reorder_point_suggested_with_risk)} MT`}
            color="var(--blue)"
            badge={sku.use_forecast
              ? { text: `Model · ${(sku.forecast_active_model || sku.demand_source || "").replace(/_/g, " ")}`, tone: "model" }
              : { text: "Baseline · 30-day average", tone: "baseline" }}
          />
        </div>
        <div style={{ textAlign: "right" }}>
          {forecast && (
            <div style={{ fontSize: "var(--text-xs)", fontWeight: isStale ? 700 : 400, color: isStale ? "var(--yellow)" : "var(--text-muted)", marginBottom: 5 }}>
              {isStale ? `Stale, recomputed ${staleDays} days ago` : `Recomputed ${staleDays === 0 ? "today" : `${staleDays}d ago`}`}
            </div>
          )}
          <button onClick={onRecompute} disabled={recomputing} className="card" style={{
            display: "flex", alignItems: "center", gap: 7, fontWeight: 700, fontSize: "var(--text-sm)",
            padding: "9px 16px", borderRadius: "var(--radius)",
            border: `1px solid ${isStale ? "var(--yellow)" : "var(--border)"}`,
            background: "var(--card-bg)", color: "var(--text-secondary)", cursor: recomputing ? "default" : "pointer",
          }}>
            <RefreshCw size={14} style={recomputing ? { animation: "forecast-spin 0.8s linear infinite" } : undefined} />
            {recomputing ? "Recomputing…" : "Recompute"}
          </button>
        </div>
      </div>
      <style>{`@keyframes forecast-spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}

const STAT_BADGE_STYLE = {
  baseline: { bg: "var(--surface-2)", fg: "var(--text-secondary)" },
  model: { bg: "var(--blue-light)", fg: "var(--blue)" },
};

function Stat({ label, value, color, tip, badge }) {
  const badgeStyle = badge && STAT_BADGE_STYLE[badge.tone];
  return (
    <div style={{ textAlign: "right" }}>
      <div style={{ fontSize: "var(--text-xs)", fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--text-muted)", display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 3 }}>
        {label}
        {tip && <ColHint label={label} what={tip.what} how={tip.how} />}
      </div>
      <div style={{ fontSize: "var(--text-xl)", fontWeight: 700, color: color || "var(--text-primary)", fontVariantNumeric: "tabular-nums" }}>{value}</div>
      {badge && (
        <div style={{
          display: "inline-block", marginTop: 3, fontSize: 10.5, fontWeight: 700, textTransform: "uppercase",
          letterSpacing: "0.03em", padding: "2px 7px", borderRadius: 99,
          background: badgeStyle?.bg, color: badgeStyle?.fg,
        }}>
          {badge.text}
        </div>
      )}
    </div>
  );
}

// ── Data story ───────────────────────────────────────────────────────────────
// The plain-English front door to everything below it (Stan's ask, 17 Sep):
// state what was found, what it suggests, and how that compares to what's
// approved today, in sentences rather than a chain diagram, before handing
// off to the model picker / sandbox / simulation for anyone who wants to look
// closer. Reads `preview`, the SAME object ReasoningChain and
// ReorderSimulation already use, rather than recomputing anything, so this
// can never disagree with the numbers below it (rules.md, "derived values
// computed twice eventually disagree").
function scrollToRef(ref) {
  return () => {
    const still = window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;
    ref.current?.scrollIntoView({ behavior: still ? "auto" : "smooth", block: "start" });
  };
}

function DataStory({ sku, preview, hasForecast, modelRef, simRef, sandboxRef }) {
  // Previously returned null here before a forecast existed - meaning most
  // SKUs (nobody has run Recompute for them yet) landed on this page with NO
  // explanation at all between the header and the model picker. Found from
  // Stan asking, as a new user, why the page didn't feel like it was telling
  // him "you're on a default, here are 4 better options" - because for the
  // majority of SKUs it genuinely wasn't saying that anywhere.
  if (!hasForecast) {
    return (
      <div className="card" style={{
        padding: "20px 22px", marginBottom: 16,
        background: "var(--surface-2)", border: "1px solid var(--border)",
      }}>
        <div style={{
          fontSize: "var(--text-xs)", fontWeight: 700, letterSpacing: "0.06em",
          textTransform: "uppercase", color: "var(--text-muted)", marginBottom: 10,
        }}>
          What your data tells us
        </div>
        <p style={{ fontSize: "var(--text-base)", lineHeight: 1.65, color: "var(--text-primary)", margin: 0 }}>
          No forecast has been run for {sku.product_name} yet, so the <b>{Math.round(sku.reorder_point_suggested_with_risk)} MT</b> suggested
          above is today's <b>default</b>: a plain 30-day average of actual sales ({sku.avg_daily_usage_30d} MT/day), no trend or
          seasonality. That's a reasonable starting point, but four statistical models below can often do
          better, especially if this product sells more in some months than others.
        </p>
        <div style={{ display: "flex", gap: 10, marginTop: 16, flexWrap: "wrap" }}>
          <button type="button" onClick={scrollToRef(modelRef)} style={STORY_LINK_STYLE}>Try the 4 models &darr;</button>
        </div>
      </div>
    );
  }
  if (!preview) {
    return (
      <div className="card" style={{ padding: "18px 20px", marginBottom: 16 }}>
        <div style={{ fontSize: "var(--text-sm)", color: "var(--text-muted)" }}>Computing…</div>
      </div>
    );
  }

  const approved = sku.reorder_point_policy;
  const suggested = preview.reorder_point_suggested_with_risk;
  const gapPct = approved > 0 ? Math.round(((suggested - approved) / approved) * 100) : null;

  return (
    <div className="card" style={{
      padding: "20px 22px", marginBottom: 16,
      background: "var(--blue-light)", border: "1px solid var(--blue)",
    }}>
      <div style={{
        fontSize: "var(--text-xs)", fontWeight: 700, letterSpacing: "0.06em",
        textTransform: "uppercase", color: "var(--blue-text)", marginBottom: 10,
      }}>
        What your data tells us
      </div>

      <p style={{ fontSize: "var(--text-base)", lineHeight: 1.65, color: "var(--text-primary)", margin: 0 }}>
        From {sku.product_name}'s sales history, the <b>{preview.forecast_model?.replace("_", " ")}</b> model
        (a statistical forecast, traditional/predictive AI, not generative) forecasts average demand of
        {" "}<b>{preview.forecast_avg_daily_demand} MT/day</b>. Using this product's
        saved lead time of <b>{preview.inputs.leadTimeDays} days</b> (variability <b>±{preview.inputs.leadTimeStdDays} days</b>)
        and a target service level of <b>{Math.round(preview.inputs.targetServiceLevel * 100)}%</b>, we suggest
        reordering at <b>{Math.round(suggested)} MT</b> and stocking up to <b>{Math.round(preview.target_stock_suggested)} MT</b>.
      </p>

      <p style={{ fontSize: "var(--text-base)", lineHeight: 1.65, color: "var(--text-secondary)", marginTop: 10 }}>
        {gapPct === null ? (
          "This product has no approved reorder point yet, so there's nothing to compare the suggestion against."
        ) : gapPct === 0 ? (
          <>Your approved reorder point, <b style={{ color: "var(--text-primary)" }}>{Math.round(approved)} MT</b>, already matches this.</>
        ) : (
          <>
            You're currently approved to reorder at <b style={{ color: "var(--text-primary)" }}>{Math.round(approved)} MT</b>,
            {" "}{Math.abs(gapPct)}% {gapPct > 0 ? "lower" : "higher"} than what we're suggesting.
          </>
        )}
        {" "}Don't just take these numbers: the lead time and its variability came from what's saved for
        this product, not from the sales data itself, so they're only as good as what you (or your supplier)
        told us. See how the suggestion was built, and how it plays out over time, before approving anything.
      </p>

      {/* Only when the two CAN legitimately disagree: engines/index.js only
          feeds the forecast's demand rate into the live SUGGESTED figure
          above when use_forecast is on (the sandbox here always uses it,
          regardless - see the comment on POST /skus/:id/forecast/preview).
          Found live: a SKU with use_forecast off showed 185 MT up top and
          113 MT here, same lead time, no explanation - this is that
          explanation. */}
      {!sku.use_forecast && (
        <p style={{ fontSize: "var(--text-sm)", lineHeight: 1.6, color: "var(--text-secondary)", marginTop: 10, paddingTop: 10, borderTop: "1px dashed var(--border)" }}>
          This won't match the <b style={{ color: "var(--text-primary)" }}>SUGGESTED</b> figure above: {sku.product_name} isn't
          set to use the forecast yet, so that one is still built on the 30-day sales average
          ({" "}{sku.avg_daily_usage_30d} MT/day), not this model's {preview.forecast_avg_daily_demand} MT/day. Switch it
          over in "See the model behind this" below to bring the two in line.
        </p>
      )}

      <div style={{ display: "flex", gap: 10, marginTop: 16, flexWrap: "wrap" }}>
        <button type="button" onClick={scrollToRef(modelRef)} style={STORY_LINK_STYLE}>See the model behind this ↓</button>
        <button type="button" onClick={scrollToRef(sandboxRef)} style={STORY_LINK_STYLE}>Try different assumptions ↓</button>
        <button type="button" onClick={scrollToRef(simRef)} style={STORY_LINK_STYLE}>Explore the simulation ↓</button>
      </div>
    </div>
  );
}

const STORY_LINK_STYLE = {
  font: "inherit", fontSize: "var(--text-sm)", fontWeight: 700, color: "var(--blue-text)",
  background: "var(--card-bg)", border: "1px solid var(--blue)", borderRadius: 99,
  padding: "7px 14px", cursor: "pointer",
};

// ── Model picker ─────────────────────────────────────────────────────────────
const MODEL_HINT = {
  naive_seasonal: {
    what: "Looks at what this SKU sold in this same calendar month in prior years, averages those, and uses that as next month's forecast. No trend, no smoothing.",
    how: "Good for a SKU with a strong, repeating yearly pattern and not much long-term drift.",
  },
  linear_trend: {
    what: "Strips out the seasonal up-and-down first, fits a straight line through what's left to catch a rising or falling trend, then adds the season back on top.",
    how: "Good for a SKU steadily gaining or losing popularity on top of its usual seasonal swings.",
  },
  holt_winters: {
    what: "A more adaptive version of naive seasonal: automatically learns how much to trust recent months over old ones, and how much is trend versus season.",
    how: "Good for demand that's gradually shifting, where a fixed rule would react too slowly.",
  },
  holt_damped_seasonal: {
    what: "A trend that's damped so it can't run away over a long horizon, blended evenly with last year's same-month figure scaled to today's level.",
    how: "Built independently by a teammate on their own branch, ported in here. Worth comparing against the other three rather than assuming it's better or worse.",
  },
};

function ModelPicker({ mode, setMode, activeModel, scores, bestScore, models, onPick, lowConfidence }) {
  return (
    <div className="card" style={{ padding: "16px 20px", marginBottom: 16 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10, flexWrap: "wrap", gap: 8 }}>
        <span style={{ fontSize: "var(--text-xs)", fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--text-muted)", display: "flex", alignItems: "center", gap: 8 }}>
          Model selection
          {/* The bracketed form Stan asked for: "statistical forecast" alone
              didn't land for him, but pairing it against the AI framing he
              already knows made it click immediately. Placed here, not in
              ChainStep's tiny badge, since this heading has room for it and
              names all four models at once, not one reasoning-chain step. */}
          <span style={{
            fontSize: 10, fontWeight: 700, letterSpacing: "0.02em", textTransform: "uppercase",
            border: "1px dashed var(--purple)", color: "var(--purple-text)", padding: "1.5px 7px", borderRadius: 5,
          }}>
            Statistical forecast (traditional / predictive AI)
          </span>
        </span>
        <div style={{ display: "flex", border: "1px solid var(--border)", borderRadius: 99, padding: 2, background: "var(--surface-2)" }}>
          {["auto", "manual"].map((m) => (
            <button key={m} type="button" onClick={() => setMode(m)} style={{
              font: "inherit", fontSize: "var(--text-xs)", fontWeight: 700, padding: "5px 14px", borderRadius: 99, border: "none", cursor: "pointer",
              background: mode === m ? "var(--card-bg)" : "transparent", color: mode === m ? "var(--text-primary)" : "var(--text-muted)",
              boxShadow: mode === m ? "var(--shadow)" : "none", textTransform: "capitalize",
            }}>{m}</button>
          ))}
        </div>
      </div>
      {lowConfidence && (
        <div style={{ fontSize: "var(--text-xs)", color: "var(--yellow)", marginBottom: 10 }}>
          Low confidence: sparse sales history behind this backtest.
        </div>
      )}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 10 }}>
        {MODEL_ORDER.map((id) => {
          const modelInfo = models.find((m) => m.id === id);
          const score = scores?.[id];
          const isActive = id === activeModel;
          // Not a score comparison: two models can legitimately tie on WMAPE
          // (naive_seasonal and holt_winters both score 0.15 for this SKU),
          // and only one of them is the real winner backtest() picked.
          // forecast.model / activeModel already carries that exact answer.
          const isWinner = mode === "auto" && id === activeModel;
          // score === 0 (a perfect backtest - every fold predicted exactly right)
          // divides 0/0 into NaN, which renders as an invalid "NaN%" CSS width and
          // breaks the bar entirely. bestScore is a min(), so score === 0 implies
          // bestScore === 0 too - full bar, not a division.
          const barPct = score == null || bestScore == null ? 0
            : score === 0 ? 100
            : Math.max(6, Math.round((bestScore / score) * 100));
          // A <div> with role="button", not a real <button>: the info hint
          // below needs its own focusable trigger, and a <button> can't
          // contain another interactive control (invalid HTML, and the two
          // click targets fight each other) - the same fix this page's own
          // design mockup needed for the same reason.
          return (
            <div key={id} role="button" tabIndex={mode === "manual" ? 0 : -1}
              onClick={() => mode === "manual" && onPick(id)}
              onKeyDown={(e) => { if (mode === "manual" && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); onPick(id); } }}
              style={{
                textAlign: "left", padding: "13px 15px", borderRadius: "var(--radius)", cursor: mode === "manual" ? "pointer" : "default",
                border: `1.5px solid ${isActive ? MODEL_COLOR[id] : "var(--border)"}`,
                background: isActive ? "color-mix(in srgb, " + MODEL_COLOR[id] + " 6%, var(--card-bg))" : "var(--card-bg)",
                position: "relative", boxShadow: "var(--shadow)",
              }}>
              {isWinner && (
                <span style={{
                  position: "absolute", top: -8, right: 10, fontSize: 10, fontWeight: 700, letterSpacing: "0.04em", textTransform: "uppercase",
                  background: "var(--green)", color: "#fff", padding: "2px 8px", borderRadius: 99,
                }}>Auto picks this</span>
              )}
              <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: "var(--text-sm)", fontWeight: 700 }}>
                <span style={{ width: 9, height: 9, borderRadius: 2, background: MODEL_COLOR[id], display: "inline-block" }} />
                {modelInfo?.label || id}
                <HoverHint content={<><div className="hint-panel__hdr">{modelInfo?.label}</div><div className="hint-panel__body">{MODEL_HINT[id].what}</div><div className="hint-panel__body" style={{ marginTop: 8 }}>{MODEL_HINT[id].how}</div></>}>
                  <button type="button" aria-label={`About ${modelInfo?.label || id}`} onClick={(e) => e.stopPropagation()} style={{
                    display: "inline-flex", padding: 0, background: "none", border: "none", cursor: "help", lineHeight: 0,
                  }}>
                    <Info size={12} color="var(--text-muted)" aria-hidden />
                  </button>
                </HoverHint>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 8 }}>
                <div style={{ flex: 1, height: 5, borderRadius: 3, background: "var(--surface-2)", overflow: "hidden" }}>
                  <div style={{ height: "100%", borderRadius: 3, background: MODEL_COLOR[id], width: `${barPct}%` }} />
                </div>
                <span style={{ fontSize: "var(--text-xs)", fontWeight: 700, color: "var(--text-secondary)", whiteSpace: "nowrap" }}>
                  {score != null ? `WMAPE ${score}` : "-"}
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Sales history & forecast chart ──────────────────────────────────────────
function SalesChart({ history, forecast, activeModel }) {
  const data = useMemo(() => {
    const rows = history.map((h) => ({ period: h.period, actual: h.qty }));
    if (forecast?.monthly?.length && rows.length) {
      rows[rows.length - 1] = { ...rows[rows.length - 1], forecast: rows[rows.length - 1].actual };
      for (const m of forecast.monthly) rows.push({ period: m.period, forecast: m.qty });
    }
    return rows;
  }, [history, forecast]);

  return (
    <div className="card" style={{ padding: "18px 20px", marginBottom: 16 }}>
      <h2 style={{ fontSize: "var(--text-lg)", fontWeight: 700, marginBottom: 2, display: "flex", alignItems: "center", gap: 6 }}>
        Sales history &amp; demand forecast
        <ColHint label="Sales history and demand forecast"
          what="Each point is MT sold that month, from real sales transactions - not stock on hand. The dashed line is the active model's forecast for the next few months."
          how="Switch models above to see this line, and everything derived from it below, change." />
      </h2>
      <p style={{ fontSize: "var(--text-xs)", color: "var(--text-muted)", marginBottom: 12 }}>
        Monthly sales quantity in MT, not stock on hand. {history.length} months of history{forecast ? `, ${forecast.horizon_months}-month forecast` : ""}.
      </p>
      {data.length === 0 ? (
        <div style={{ fontSize: "var(--text-sm)", color: "var(--text-muted)", padding: "24px 0" }}>No sales history for this SKU yet.</div>
      ) : (
        <ResponsiveContainer width="100%" height={220}>
          <LineChart data={data} margin={{ top: 8, right: 12, bottom: 0, left: -16 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
            <XAxis dataKey="period" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} interval={Math.ceil(data.length / 8)} />
            <YAxis tick={{ fontSize: 11 }} tickLine={false} axisLine={false} width={60} unit=" MT" />
            <Tooltip contentStyle={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 8, fontSize: "var(--text-xs)" }}
              labelStyle={{ color: "var(--text-primary)", fontWeight: 700 }} />
            <Line type="monotone" dataKey="actual" stroke="var(--text-secondary)" strokeWidth={2} dot={false} name="Actual sales" connectNulls={false} />
            {forecast && (
              <Line type="monotone" dataKey="forecast" stroke={MODEL_COLOR[activeModel]} strokeWidth={2} strokeDasharray="6 4" dot={false}
                name={`Forecast (${activeModel.replace("_", " ")})`} connectNulls={false} />
            )}
          </LineChart>
        </ResponsiveContainer>
      )}
      {!forecast && (
        <div style={{ marginTop: 10, fontSize: "var(--text-sm)", color: "var(--text-secondary)" }}>
          No forecast generated yet. Pick Auto above, or hit Recompute, to get started.
        </div>
      )}
    </div>
  );
}

// ── What-if sandbox ──────────────────────────────────────────────────────────
function WhatIfSandbox({ sku, inputs, setInput, onReset, preview, previewError, hasForecast }) {
  const diverged = (key, saved) => inputs[key] !== saved;
  return (
    <div className="card" style={{ padding: "18px 20px", marginBottom: 16, border: "1.5px solid var(--blue)" }}>
      <h2 style={{ fontSize: "var(--text-lg)", fontWeight: 700, marginBottom: 2, display: "flex", alignItems: "center", gap: 8 }}>
        What if...
        <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.04em", textTransform: "uppercase", border: "1px dashed var(--blue)", color: "var(--blue-text)", padding: "1.5px 7px", borderRadius: 5 }}>
          Sandbox
        </span>
      </h2>
      <p style={{ fontSize: "var(--text-xs)", color: "var(--text-muted)", marginBottom: 14 }}>
        Drag these to see how the suggested reorder point responds. These are this SKU's real settings, nothing here is saved until you use the SKU edit form.
      </p>
      {!hasForecast ? (
        <div style={{ fontSize: "var(--text-sm)", color: "var(--text-muted)" }}>Generate a forecast first (Recompute above) to use the sandbox.</div>
      ) : (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: "4px 28px" }}>
            <div>
              <SliderField
                label={<SandboxLabel text="Lead time" hint={{
                  what: "How many days after you place an order with this supplier before it arrives. A characteristic of this product's supplier, not something read off your sales data.",
                  how: "Feeds King's formula directly: Lead-Time Demand = average daily demand × lead time. Set on the SKU's Policy tab, not calculated here.",
                }} />}
                suffix="days" value={inputs.leadTimeDays} onChange={setInput("leadTimeDays")} min={20} max={90} step={1} />
              <SandboxNote text="No suggestion yet: needs receiving history (this app has no closed purchase-order data to measure a real average from)." />
            </div>
            <div>
              <SliderField
                label={<SandboxLabel text="Lead time variability (σ)" hint={{
                  what: "How much that lead time actually swings, delivery to delivery. A wider spread means a less predictable supplier, also set on the Policy tab, not derived from sales.",
                  how: "Widens the safety stock King's formula asks for: a bigger σ means more stock held just in case a delivery runs late.",
                }} />}
                suffix="days" value={inputs.leadTimeStdDays} onChange={setInput("leadTimeStdDays")} min={0} max={15} step={0.5} />
              <SandboxNote text="No suggestion yet, same reason as lead time above." />
            </div>
            <div>
              <SliderField
                label={<SandboxLabel text="Target service level" hint={{
                  what: "How often you're willing to risk running out before the next delivery lands. 98% means roughly a 2% chance of a stockout in a typical cycle: a business choice, not a measurement.",
                  how: "Converts to a Z-score in King's formula: a higher service level asks for more safety stock for the same demand and lead time.",
                }} />}
                suffix="%" value={inputs.serviceLevelPct} onChange={setInput("serviceLevelPct")} min={80} max={99} step={1} />
              <SandboxNote
                text={`Suggested (${sku.abc_class}-tier default): ${TIER_SERVICE_LEVEL[sku.abc_class] || 95}%`}
                onUse={() => setInput("serviceLevelPct")(TIER_SERVICE_LEVEL[sku.abc_class] || 95)}
              />
            </div>
            <div>
              <SliderField
                label={<SandboxLabel text="Target stock (order-up-to)" hint={{
                  what: "How much stock you want on hand right after a delivery arrives: the level a reorder tries to bring you back up to.",
                  how: "The one figure here with a live formula behind it: forecast demand × (a 30-day review cycle + lead time) + safety stock. Hit “Use” below to apply it.",
                }} />}
                suffix="MT" value={inputs.targetStock} onChange={setInput("targetStock")} min={60} max={300} step={5} />
              {preview && (
                <SandboxNote
                  text={`Suggested (formula-derived): ${Math.round(preview.target_stock_suggested)} MT`}
                  onUse={() => setInput("targetStock")(Math.round(preview.target_stock_suggested))}
                />
              )}
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 14, paddingTop: 12, borderTop: "1px solid var(--border)", flexWrap: "wrap", gap: 10 }}>
            <span style={{ fontSize: "var(--text-xs)", color: "var(--text-muted)" }}>
              Demand variability and the risk buffer stay fixed, they come from the forecast model and the matched risk event, not a setting.
            </span>
            <button type="button" onClick={onReset} style={{
              font: "inherit", fontWeight: 700, fontSize: "var(--text-xs)", padding: "7px 14px", borderRadius: "var(--radius)",
              border: "1px solid var(--border)", background: "var(--surface-2)", color: "var(--text-secondary)", cursor: "pointer",
            }}>Reset to saved values</button>
          </div>
          {previewError && <div style={{ marginTop: 10, fontSize: "var(--text-xs)", color: "var(--red-text)" }}>{previewError}</div>}
        </>
      )}
    </div>
  );
}

// A slider's label, plus the ⓘ this page already uses elsewhere (SalesChart,
// ReorderSimulation). SliderField renders whatever `label` it's given inside
// a plain, un-`htmlFor`'d <label> tag, so nesting ColHint's own button here
// is safe: nothing tries to steal focus back to the range input the way a
// real form-control association would.
function SandboxLabel({ text, hint }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
      {text}
      <ColHint label={text} what={hint.what} how={hint.how} />
    </span>
  );
}

function SandboxNote({ text, onUse }) {
  return (
    <div style={{ fontSize: 10.5, marginTop: 3, display: "flex", alignItems: "center", gap: 6, color: onUse ? "var(--blue-text)" : "var(--text-muted)" }}>
      {text}
      {onUse && (
        <button type="button" onClick={onUse} style={{
          font: "inherit", fontSize: 10, fontWeight: 700, padding: "1px 8px", borderRadius: 99, border: "1px solid var(--blue)",
          background: "var(--blue-light)", color: "var(--blue-text)", cursor: "pointer", flex: "none",
        }}>Use</button>
      )}
    </div>
  );
}

// ── Reasoning chain ──────────────────────────────────────────────────────────
function ReasoningChain({ sku, preview, hasForecast, onUseForecast, modelRef }) {
  const demandLabel = sku.use_forecast ? `forecast (${sku.demand_source?.replace("_", " ") || sku.forecast_model})` : "30-day average";
  return (
    <div className="card" style={{ padding: "18px 20px", marginBottom: 16 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14, flexWrap: "wrap", gap: 8 }}>
        <h2 style={{ fontSize: "var(--text-lg)", fontWeight: 700, display: "flex", alignItems: "center", gap: 6 }}>
          How this becomes the suggested reorder point
          <ColHint label="How this becomes the suggested reorder point"
            what="None of this is generative AI. Forecast demand comes from a statistical forecast model (Naive seasonal, Linear trend, Holt-Winters, or Holt damped + seasonal) - traditional or predictive AI, backtested against real sales history, always producing the same output for the same inputs. Everything after it is a fixed formula (King's formula) applied on top."
            how="The tags below say which is which: SALES HISTORY is a plain historical average (no model behind it yet), YOUR INPUT is something you (or your supplier) told the system, STATISTICAL FORECAST is a model's own output, and no tag means fixed arithmetic on top of those. AI only appears elsewhere in this app, on Actions Needed's Why? button, and only to explain a number, never to calculate one." />
        </h2>
        {hasForecast && (
          <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: "var(--text-xs)", fontWeight: 600, color: "var(--text-secondary)", cursor: "pointer" }}>
            <input type="checkbox" checked={!!sku.use_forecast} onChange={onUseForecast} />
            Use this forecast for safety stock &amp; reorder point
          </label>
        )}
      </div>
      <div style={{ fontSize: "var(--text-xs)", color: "var(--text-muted)", marginBottom: 12 }}>
        Currently operating on the <b style={{ color: "var(--text-secondary)" }}>{demandLabel}</b>.
      </div>
      {!hasForecast ? (
        // Real numbers, not a placeholder: everything here is already on
        // `sku` from GET /skus (engines/index.js), computed off the 30-day
        // average whether or not anyone has ever clicked Recompute. Someone
        // landing on a SKU that's never been forecast used to see one line of
        // muted text here and nothing else - this is the actual math behind
        // today's SUGGESTED figure, not a promise of what a forecast would add.
        <>
          <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
            <ChainStep label="Avg daily sales (30d)" value={`${sku.avg_daily_usage_30d} MT/day`} tag="sales history" />
            <ChainOp>&times;</ChainOp>
            <ChainStep label="Lead time" value={`${sku.lead_time_days} days`} tag="your input" />
            <ChainOp>=</ChainOp>
            <ChainStep label="Lead time demand" value={`${sku.lead_time_demand_mt} MT`} />
            <ChainOp>+</ChainOp>
            <ChainStep label="Safety stock" value={`${sku.safety_stock_mt} MT`} tag="formula" />
            <ChainOp>+</ChainOp>
            <ChainStep label="Risk buffer" value={`+${sku.risk_buffer_mt} MT`} accent="var(--orange)" tag="formula" />
            <ChainOp>=</ChainOp>
            <ChainStep label="Suggested (baseline)" value={`${Math.round(sku.reorder_point_suggested_with_risk)} MT`} accent="var(--blue)" total />
          </div>
          <div style={{
            marginTop: 14, padding: "10px 14px", display: "flex", alignItems: "center",
            justifyContent: "space-between", gap: 12, flexWrap: "wrap",
            background: "var(--purple-light)", border: "1px solid var(--purple)", borderRadius: "var(--radius)",
          }}>
            <span style={{ fontSize: "var(--text-sm)", color: "var(--text-secondary)" }}>
              This is the default calculation - no trend, no seasonality, just a plain average of recent sales.
            </span>
            <button type="button" onClick={scrollToRef(modelRef)} style={STORY_LINK_STYLE}>
              Try the 4 models &darr;
            </button>
          </div>
        </>
      ) : !preview ? (
        <div style={{ fontSize: "var(--text-sm)", color: "var(--text-muted)" }}>Computing…</div>
      ) : (
        <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
          <ChainStep label="Forecast demand" value={`${preview.forecast_avg_daily_demand} MT/day`} tag="statistical forecast" />
          <ChainOp>&times;</ChainOp>
          <ChainStep label="Lead time" value={`${preview.inputs.leadTimeDays} days`} tag="your input" />
          <ChainOp>+</ChainOp>
          <ChainStep label="Safety stock" value={`${preview.safety_stock_mt} MT`} tag="formula" />
          <ChainOp>+</ChainOp>
          <ChainStep label="Risk buffer" value={`+${preview.risk_buffer_mt} MT`} accent="var(--orange)" tag="formula" />
          <ChainOp>=</ChainOp>
          <ChainStep label="Suggested" value={`${Math.round(preview.reorder_point_suggested_with_risk)} MT`} accent="var(--blue)" total />
        </div>
      )}
      {preview?.risk_buffer_reason && (
        <div style={{ marginTop: 12, fontSize: "var(--text-xs)", color: "var(--text-secondary)", display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.04em", border: "1px dashed var(--text-muted)", color: "var(--text-muted)", padding: "1px 6px", borderRadius: 99 }}>illustrative</span>
          {preview.risk_buffer_reason}
        </div>
      )}
    </div>
  );
}

// Three tags, three honest answers to "where did this come from": a person
// typed it in, a statistical forecast model computed it from sales history,
// or it's fixed arithmetic applied to one of those two. None of them is
// generative AI - see the note in ReasoningChain's header. "formula" gets no
// colour of its own on purpose: it's the default, unremarkable case, and
// giving it a tint would spend the same visual weight as the two things
// actually worth flagging.
const CHAIN_TAG_STYLE = {
  "your input": { bg: "var(--blue-light)", fg: "var(--blue)" },
  "statistical forecast": { bg: "var(--purple-light)", fg: "var(--purple)" },
  "sales history": { bg: "var(--surface-2)", fg: "var(--text-secondary)" },
};

function ChainStep({ label, value, accent, tag, total }) {
  const tagStyle = CHAIN_TAG_STYLE[tag];
  return (
    <div style={{
      background: total ? "var(--blue-light)" : accent === "var(--orange)" ? "var(--orange-light)" : "var(--surface-2)",
      border: `1px solid ${total ? "var(--blue)" : accent === "var(--orange)" ? "var(--orange)" : "var(--border)"}`,
      borderRadius: "var(--radius)", padding: "10px 14px", minWidth: 130,
    }}>
      <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: "0.05em", textTransform: "uppercase", color: "var(--text-muted)", display: "flex", alignItems: "center", gap: 5 }}>
        {label}
        {tag && (
          <span style={{
            fontSize: 9.5, fontWeight: 700, padding: "1px 5px", borderRadius: 4,
            background: tagStyle?.bg || "var(--surface-2)",
            color: tagStyle?.fg || "var(--text-muted)",
          }}>{tag}</span>
        )}
      </div>
      <div style={{ fontSize: "var(--text-base)", fontWeight: 700, marginTop: 3, fontVariantNumeric: "tabular-nums" }}>{value}</div>
    </div>
  );
}
function ChainOp({ children }) {
  return <div style={{ color: "var(--text-muted)", fontSize: "var(--text-lg)", fontWeight: 300 }}>{children}</div>;
}

// ── Reorder cycle simulation ─────────────────────────────────────────────────
function buildSawtooth({ startQty, dailyDemand, trigger, leadTimeDays, targetStock, cycles = 2 }) {
  const keyframes = [{ day: 0, qty: startQty }];
  const events = [];
  let qty = startQty, day = 0;
  if (dailyDemand > 0 && trigger < startQty) {
    for (let c = 0; c < cycles; c++) {
      const triggerDay = day + (qty - trigger) / dailyDemand;
      events.push({ type: "trigger", day: triggerDay, qty: trigger, cycle: c });
      const arrivalDay = triggerDay + leadTimeDays;
      const troughQty = round1(trigger - dailyDemand * leadTimeDays);
      keyframes.push({ day: arrivalDay, qty: troughQty });
      const orderQty = round1(targetStock - troughQty);
      events.push({ type: "arrival", day: arrivalDay, qty: targetStock, orderQty, cycle: c });
      keyframes.push({ day: arrivalDay, qty: targetStock });
      qty = targetStock; day = arrivalDay;
    }
    keyframes.push({ day: day + 100, qty: round1(qty - dailyDemand * 100) });
  }
  return { keyframes, events };
}

function ReorderSimulation({ invHistory, preview, inputs, sku }) {
  const histStep = 30;
  const historyPts = invHistory.map((h, i) => ({ day: (i - (invHistory.length - 1)) * histStep, actual: h.closing_qty }));
  const startQty = invHistory.length ? invHistory[invHistory.length - 1].closing_qty : sku.on_hand_qty;

  const sim = useMemo(() => buildSawtooth({
    startQty, dailyDemand: preview.forecast_avg_daily_demand, trigger: preview.reorder_point_suggested_with_risk,
    leadTimeDays: inputs.leadTimeDays, targetStock: inputs.targetStock,
  }), [startQty, preview, inputs]);

  const data = useMemo(() => {
    const rows = historyPts.map((p) => ({ day: p.day, actual: p.actual }));
    sim.keyframes.forEach((k) => rows.push({ day: k.day, simulated: k.qty }));
    return rows.sort((a, b) => a.day - b.day);
  }, [historyPts, sim]);

  const today = new Date();
  const dayToDate = (day) => {
    const d = new Date(today.getTime() + day * DAY_MS);
    return `${d.getDate()} ${d.toLocaleString("en", { month: "short" })} '${String(d.getFullYear()).slice(2)}`;
  };

  return (
    <div className="card" style={{ padding: "18px 20px", marginBottom: 16 }}>
      <h2 style={{ fontSize: "var(--text-lg)", fontWeight: 700, marginBottom: 2, display: "flex", alignItems: "center", gap: 8 }}>
        Reorder cycle simulation
        <ColHint label="Reorder cycle simulation"
          what="The solid line is actual on-hand stock. The dashed line simulates what happens under the sandbox's settings: stock declines at the forecast rate, an order is placed the moment it hits the suggested trigger, and arrives (jumps back up to target stock) one lead time later."
          how="This is a simulation, not a prediction of exact dates: it assumes flat demand and a perfectly-timed order every cycle. Real demand varies - that's what safety stock and the risk buffer already protect against." />
        <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.04em", textTransform: "uppercase", border: "1px dashed var(--text-muted)", color: "var(--text-muted)", padding: "1.5px 7px", borderRadius: 5 }}>Simulated</span>
      </h2>
      <p style={{ fontSize: "var(--text-xs)", color: "var(--text-muted)", marginBottom: 12 }}>
        On-hand stock in MT: {invHistory.length} months actual, then a repeating reorder cycle from the sandbox settings above.
      </p>
      <div style={{ fontSize: "var(--text-xs)", background: "var(--blue-light)", border: "1px solid var(--blue)", borderRadius: "var(--radius)", padding: "8px 12px", marginBottom: 12, color: "var(--text-secondary)" }}>
        &uarr; Demand rate driving this simulation: <b style={{ color: "var(--blue-text)" }}>{preview.forecast_avg_daily_demand} MT/day</b>, the {preview.forecast_model?.replace("_", " ")} forecast from the sales chart above.
      </div>
      <ResponsiveContainer width="100%" height={260}>
        <LineChart data={data} margin={{ top: 20, right: 20, bottom: 0, left: -16 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
          <XAxis dataKey="day" type="number" domain={["dataMin", "dataMax"]} tickFormatter={dayToDate} tick={{ fontSize: 10 }} tickLine={false} axisLine={false} />
          <YAxis tick={{ fontSize: 11 }} tickLine={false} axisLine={false} width={60} unit=" MT" domain={[0, "dataMax + 20"]} />
          <Tooltip contentStyle={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 8, fontSize: "var(--text-xs)" }}
            labelFormatter={dayToDate} formatter={(v) => [`${Math.round(v * 10) / 10} MT`]} />
          <ReferenceLine x={0} stroke="var(--text-muted)" strokeDasharray="2 3" label={{ value: "today", position: "top", fontSize: 10, fill: "var(--text-muted)" }} />
          <ReferenceLine y={preview.reorder_point_suggested_with_risk} stroke="var(--blue)" strokeDasharray="5 3"
            label={{ value: `Suggested ${Math.round(preview.reorder_point_suggested_with_risk)}`, position: "insideBottomRight", fontSize: 10, fill: "var(--blue)" }} />
          <ReferenceLine y={sku.reorder_point_policy} stroke="var(--text-primary)" strokeDasharray="5 3"
            label={{ value: `Approved ${Math.round(sku.reorder_point_policy)}`, position: "insideTopRight", fontSize: 10, fill: "var(--text-secondary)" }} />
          <Line type="monotone" dataKey="actual" stroke="var(--text-secondary)" strokeWidth={2} dot={false} connectNulls={false} name="Actual on-hand" />
          <Line type="linear" dataKey="simulated" stroke="var(--blue)" strokeWidth={2} strokeDasharray="6 4" dot={false} connectNulls name="Simulated cycle" />
          {sim.events.map((ev, i) => (
            <ReferenceDot key={i} x={ev.day} y={ev.qty} r={5} fill={ev.type === "trigger" ? "var(--blue)" : "var(--green)"} stroke="none"
              label={{
                value: ev.type === "trigger" ? `Reorder · ${dayToDate(ev.day)}` : `+${ev.orderQty} MT · ${dayToDate(ev.day)}`,
                position: ev.type === "trigger" ? "bottom" : "top", fontSize: 10, fontWeight: 700,
                fill: ev.type === "trigger" ? "var(--blue)" : "var(--green)",
              }} />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

// ── Inflows vs outflows ──────────────────────────────────────────────────────
function FlowChart({ invHistory }) {
  const data = invHistory.map((h) => ({ period: h.period, receipts: h.receipts_qty, issues: -h.issues_qty }));
  return (
    <div className="card" style={{ padding: "18px 20px", marginBottom: 16 }}>
      <h2 style={{ fontSize: "var(--text-lg)", fontWeight: 700, marginBottom: 2, display: "flex", alignItems: "center", gap: 6 }}>
        Monthly inflows vs outflows
        <ColHint label="Monthly inflows vs outflows"
          what="Receipts (goods arriving) and issues (stock shipped out) for the same months as the simulation above, from the same inventory_history rows its solid line is built from."
          how="The gap between the two bars each month is roughly why the on-hand line rises or falls that month." />
      </h2>
      <p style={{ fontSize: "var(--text-xs)", color: "var(--text-muted)", marginBottom: 12 }}>
        Real goods-receipt and dispatch totals, not the net.
      </p>
      <ResponsiveContainer width="100%" height={180}>
        <BarChart data={data} margin={{ top: 8, right: 12, bottom: 0, left: -16 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
          <XAxis dataKey="period" tick={{ fontSize: 10 }} tickLine={false} axisLine={false} interval={Math.ceil(data.length / 6)} />
          <YAxis tick={{ fontSize: 11 }} tickLine={false} axisLine={false} width={60} unit=" MT" />
          <Tooltip contentStyle={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 8, fontSize: "var(--text-xs)" }}
            formatter={(v, name) => [`${Math.abs(v)} MT`, name === "receipts" ? "Receipts (in)" : "Issues (out)"]} />
          <ReferenceLine y={0} stroke="var(--border)" />
          <Bar dataKey="receipts" fill="var(--green)" radius={[3, 3, 0, 0]} name="receipts" />
          <Bar dataKey="issues" fill="var(--orange)" radius={[0, 0, 3, 3]} name="issues" />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
