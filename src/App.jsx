import React, { useState, useMemo, useEffect, useCallback } from 'react'
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer
} from 'recharts'

// ── FRED API (Freddie Mac — datos reales, actualización semanal) ──
const FRED_API_KEY = '5dbee5cd207c8dc08ae81eeae0a3ec0f'
const REFRESH_MS   = 60 * 60 * 1000   // re-verificar cada hora

// Spreads típicos de mercado relativos al 30yr conventional
const SPREAD = { jumbo: 0.18, arm: -0.08, fha: -0.42, va: -0.38 }

// ── Deterministic PRNG (respaldo sin red) ─────────────────────
function rand(n) {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453
  return x - Math.floor(x)
}

const EPOCH_MS = new Date('2020-01-06').getTime()
function absWeekNow() {
  return Math.floor((Date.now() - EPOCH_MS) / (7 * 24 * 60 * 60 * 1000))
}

// ── Historial de respaldo calibrado a historia real de EE.UU. ──
function buildFallbackHistory() {
  const nowWeek = absWeekNow()
  const WEEKS   = 260
  const data    = []
  let r30 = 3.20, r15 = 2.80

  for (let i = 0; i < WEEKS; i++) {
    const w    = nowWeek - (WEEKS - 1) + i
    const date = new Date(EPOCH_MS + w * 7 * 24 * 60 * 60 * 1000)
    const yr   = date.getFullYear()
    const mo   = date.getMonth()

    let d30, d15
    if      (w < 100) { d30 = -0.003; d15 = -0.002 }
    else if (w < 175) { d30 =  0.051; d15 =  0.048 }
    else if (w < 225) { d30 =  0.007; d15 =  0.006 }
    else              { d30 = -0.008; d15 = -0.007 }

    r30 = Math.max(2.65, Math.min(7.9, r30 + d30 + (rand(w * 17 + 3) - 0.5) * 0.08))
    r15 = Math.max(2.35, Math.min(7.4, r15 + d15 + (rand(w * 17 + 7) - 0.5) * 0.06))

    data.push({
      label:     mo === 0 ? `${yr}` : '',
      fullLabel: `${yr}-${String(mo + 1).padStart(2, '0')}`,
      rate30: parseFloat(r30.toFixed(2)),
      rate15: parseFloat(r15.toFixed(2)),
    })
  }
  return data
}

function buildFallbackRates(history) {
  const last = history[history.length - 1]
  const prev = history[history.length - 2]
  const r30  = last.rate30, r15 = last.rate15
  const c30  = parseFloat((r30 - prev.rate30).toFixed(2))
  const c15  = parseFloat((r15 - prev.rate15).toFixed(2))
  const recent = history.slice(-52)
  const min30  = +Math.min(...recent.map(d => d.rate30)).toFixed(2)
  const max30  = +Math.max(...recent.map(d => d.rate30)).toFixed(2)
  const min15  = +Math.min(...recent.map(d => d.rate15)).toFixed(2)
  const max15  = +Math.max(...recent.map(d => d.rate15)).toFixed(2)
  const mk = (sp) => ({ rate: +(r30+sp).toFixed(2), change: +c30.toFixed(2), min: +(min30+sp).toFixed(2), max: +(max30+sp).toFixed(2) })
  return [
    { label: '30 Yr. Fixed', rate: r30, change: c30, min: min30, max: max30 },
    { label: '15 Yr. Fixed', rate: r15, change: c15, min: min15, max: max15 },
    { label: '30 Yr. Jumbo', ...mk( 0.18) },
    { label: '7/6 SOFR ARM', ...mk(-0.08) },
    { label: '30 Yr. FHA',   ...mk(-0.42) },
    { label: '30 Yr. VA',    ...mk(-0.38) },
  ]
}

// ── FRED fetch ────────────────────────────────────────────────
async function fredFetch(seriesId, limit) {
  const base =
    `https://api.stlouisfed.org/fred/series/observations` +
    `?series_id=${seriesId}&api_key=${FRED_API_KEY}` +
    `&file_type=json&limit=${limit}&sort_order=desc`

  const proxies = [
    `https://corsproxy.io/?${encodeURIComponent(base)}`,
    `https://api.allorigins.win/raw?url=${encodeURIComponent(base)}`,
    `https://thingproxy.freeboard.io/fetch/${base}`,
  ]

  for (const url of proxies) {
    try {
      const res = await fetch(url)
      if (!res.ok) continue
      const json = await res.json()
      if (json.observations) return json.observations.filter(o => o.value !== '.')
    } catch {
      continue
    }
  }
  throw new Error('All proxies failed')
}

async function loadFredData() {
  const [obs30, obs15] = await Promise.all([
    fredFetch('MORTGAGE30US', 260),
    fredFetch('MORTGAGE15US', 260),
  ])

  const r30 = parseFloat(obs30[0].value)
  const r15 = parseFloat(obs15[0].value)
  const c30 = parseFloat((r30 - parseFloat(obs30[1]?.value ?? r30)).toFixed(2))
  const c15 = parseFloat((r15 - parseFloat(obs15[1]?.value ?? r15)).toFixed(2))

  const v30 = obs30.slice(0, 52).map(o => parseFloat(o.value))
  const v15 = obs15.slice(0, 52).map(o => parseFloat(o.value))
  const min30 = +Math.min(...v30).toFixed(2), max30 = +Math.max(...v30).toFixed(2)
  const min15 = +Math.min(...v15).toFixed(2), max15 = +Math.max(...v15).toFixed(2)

  const mk = (sp) => ({ rate: +(r30+sp).toFixed(2), change: +c30.toFixed(2), min: +(min30+sp).toFixed(2), max: +(max30+sp).toFixed(2) })
  const rates = [
    { label: '30 Yr. Fixed', rate: r30, change: c30, min: min30, max: max30 },
    { label: '15 Yr. Fixed', rate: r15, change: c15, min: min15, max: max15 },
    { label: '30 Yr. Jumbo', ...mk( SPREAD.jumbo) },
    { label: '7/6 SOFR ARM', ...mk( SPREAD.arm)   },
    { label: '30 Yr. FHA',   ...mk( SPREAD.fha)   },
    { label: '30 Yr. VA',    ...mk( SPREAD.va)     },
  ]

  const map15 = {}
  obs15.forEach(o => { map15[o.date] = parseFloat(o.value) })

  const chartData = obs30.slice().reverse().map(o => {
    const d = new Date(o.date + 'T12:00:00')
    return {
      label:     d.getMonth() === 0 ? `${d.getFullYear()}` : '',
      fullLabel: o.date.slice(0, 7),
      rate30:    parseFloat(o.value),
      rate15:    map15[o.date] ?? null,
    }
  })

  const fredDate = new Date(obs30[0].date + 'T12:00:00')
  const fetchedAt = new Date()

  const datePart = fredDate.toLocaleDateString('en-US', {
    weekday: 'short', month: 'short', day: 'numeric', year: 'numeric'
  })
  const timePart = fetchedAt.toLocaleTimeString('en-US', {
    hour: 'numeric', minute: '2-digit', hour12: true
  })
  const updatedLabel = `${datePart} · ${timePart}`

  return { rates, chartData, updatedLabel }
}

// ── Helpers ───────────────────────────────────────────────────
function calcMonthly(principal, rate, years) {
  const r = rate / 100 / 12, n = years * 12
  if (r === 0) return principal / n
  return (principal * r * Math.pow(1 + r, n)) / (Math.pow(1 + r, n) - 1)
}

function RangeBar({ min, max, current }) {
  const pct = Math.max(0, Math.min(100, ((current - min) / (max - min)) * 100))
  return (
    <div className="range-bar-wrap">
      <span>{min.toFixed(2)}%</span>
      <div className="range-bar-outer">
        <div className="range-bar-fill" style={{ width: `${pct}%` }} />
        <div className="range-needle"   style={{ left:  `${pct}%` }} />
      </div>
      <span>{max.toFixed(2)}%</span>
    </div>
  )
}

function RateCard({ item, loanAmount }) {
  const years   = item.label.startsWith('15') ? 15 : 30
  const payment = calcMonthly(loanAmount, item.rate, years)
  const cls     = item.change > 0 ? 'positive' : item.change < 0 ? 'negative' : 'neutral'
  const sign    = item.change > 0 ? '+' : ''
  return (
    <div className="rate-card">
      <div className="rate-label">{item.label}</div>
      <div className="rate-value-row">
        <span className="rate-pct">{item.rate.toFixed(2)}%</span>
        <span className={`rate-change ${cls}`}>{sign}{item.change.toFixed(2)}</span>
      </div>
      <RangeBar min={item.min} max={item.max} current={item.rate} />
      <div className="rate-monthly">${Math.round(payment).toLocaleString()} / mo</div>
    </div>
  )
}

// ── Main ──────────────────────────────────────────────────────
export default function App() {
  const fallbackHistory = buildFallbackHistory()

  const [history,  setHistory]  = useState(fallbackHistory)
  const [rates,    setRates]    = useState(() => buildFallbackRates(fallbackHistory))
  const [updated,  setUpdated]  = useState('Loading…')
  const [loading,  setLoading]  = useState(true)
  const [loanInput, setLoanInput] = useState('250,000')

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      const data = await loadFredData()
      setRates(data.rates)
      setHistory(data.chartData)
      setUpdated(data.updatedLabel)
    } catch (err) {
      console.warn('FRED fetch failed — using estimated rates.', err)
      const h = buildFallbackHistory()
      setHistory(h)
      setRates(buildFallbackRates(h))
      setUpdated('Estimated rates')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    refresh()
    const timer = setInterval(refresh, REFRESH_MS)
    return () => clearInterval(timer)
  }, [refresh])

  const loanAmount = useMemo(() => {
    const n = parseInt(loanInput.replace(/,/g, ''), 10)
    return isNaN(n) || n <= 0 ? 250000 : n
  }, [loanInput])

  function handleLoan(e) {
    const raw = e.target.value.replace(/[^0-9]/g, '')
    if (!raw) { setLoanInput(''); return }
    setLoanInput(parseInt(raw, 10).toLocaleString())
  }

  const needlePct = 48

  return (
    <div className="page">

      {/* ── Header ── */}
      <div className="header">
        <div className="header-inner">
          <h1>Today's Mortgage Rates <span>📊</span></h1>
          <div className="header-right">
            {loading
              ? <span className="spinner" title="Fetching live rates…" />
              : <span className="updated-label">Updated {updated}</span>
            }
            <div className="header-buttons">
              <button className="btn-share">Share</button>
              <button className="btn-more">More Rates Data ▾</button>
            </div>
          </div>
        </div>
      </div>

      {/* ── Content ── */}
      <div className="content">
        <p className="subtitle">
          Rates sourced from Freddie Mac (PMMS) via FRED.
          {!loading && updated && updated !== 'Estimated rates' &&
            <> Last data: <strong>{updated}</strong>.</>
          }
          {' '}Updated weekly every Thursday.
        </p>

        {/* Rate Grid */}
        <div className="rate-grid">
          {rates.map(item => (
            <RateCard key={item.label} item={item} loanAmount={loanAmount} />
          ))}
        </div>

        {/* Loan Row */}
        <div className="loan-row">
          <span>Estimated Principal &amp; Interest</span>
          <span>Loan Amount:</span>
          <input className="loan-input" value={loanInput} onChange={handleLoan} />
          <a href="#" className="loan-link">Mortgage Calculators</a>
        </div>

        {/* Bottom */}
        <div className="bottom-section">

          {/* Chart */}
          <div className="chart-section">
            <h3>30 and 15 Year Fixed Rates</h3>
            <ResponsiveContainer width="100%" height={260}>
              <AreaChart data={history} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
                <defs>
                  <linearGradient id="g30" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%"  stopColor="#0C2139" stopOpacity={0.45} />
                    <stop offset="95%" stopColor="#0C2139" stopOpacity={0.02} />
                  </linearGradient>
                  <linearGradient id="g15" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%"  stopColor="#BAD532" stopOpacity={0.55} />
                    <stop offset="95%" stopColor="#BAD532" stopOpacity={0.02} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis dataKey="label" tick={{ fontSize: 11 }} interval={0} />
                <YAxis
                  domain={[2.5, 8]}
                  tickFormatter={v => `${v}%`}
                  tick={{ fontSize: 11 }}
                  width={36}
                />
                <Tooltip
                  formatter={(v, name) => [`${v}%`, name]}
                  labelFormatter={(_, payload) => payload?.[0]?.payload?.fullLabel ?? ''}
                />
                <Area type="monotone" dataKey="rate30" name="30YR"
                  stroke="#0C2139" strokeWidth={2} fill="url(#g30)" />
                <Area type="monotone" dataKey="rate15" name="15YR"
                  stroke="#BAD532" strokeWidth={2} fill="url(#g15)" />
              </AreaChart>
            </ResponsiveContainer>
            <div className="chart-links">
              <strong>More Charts:</strong>{' '}
              {['30YR','15YR','30YR Jumbo','30YR FHA','5/1 ARM'].map((c, i, arr) => (
                <React.Fragment key={c}>
                  <a href="#">{c}</a>
                  {i < arr.length - 1 && <span>|</span>}
                </React.Fragment>
              ))}
            </div>
          </div>

          {/* Trend Panel */}
          <div>
            <div className="trend-title">Friday's Rate Trend</div>
            <div className="trend-bar-wrap">
              <div className="trend-bar">
                <div className="trend-seg pos">POSITIVE</div>
                <div className="trend-seg min">MINIMAL</div>
                <div className="trend-seg neg">NEGATIVE</div>
              </div>
              <div className="trend-needle" style={{ left: `${needlePct}%` }} />
            </div>
            <p className="trend-text">
              <span className="mbs-link">MBS prices</span> have{' '}
              <span className="highlight-green">increased slightly</span> today.
              This may result in <strong>minimal positive impact</strong> on
              mortgage rates today.
            </p>
            <p className="trend-disclaimer">
              This tool provides an idea of the underlying trends in{' '}
              <a href="#">MBS that may influence mortgage rates</a> today.
              It is not intended to forecast lender rate changes.
            </p>
          </div>

        </div>
      </div>
    </div>
  )
}
