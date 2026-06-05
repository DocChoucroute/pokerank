import { useState, useEffect, useCallback, useRef } from "react";

// ── Constants ────────────────────────────────────────────────────────────────
const GENERATIONS = [
  { id: 1, name: "Gen I", range: [1, 151] },
  { id: 2, name: "Gen II", range: [152, 251] },
  { id: 3, name: "Gen III", range: [252, 386] },
  { id: 4, name: "Gen IV", range: [387, 493] },
  { id: 5, name: "Gen V", range: [494, 649] },
  { id: 6, name: "Gen VI", range: [650, 721] },
  { id: 7, name: "Gen VII", range: [722, 809] },
  { id: 8, name: "Gen VIII", range: [810, 905] },
  { id: 9, name: "Gen IX", range: [906, 1025] },
];

const TYPE_COLORS = {
  fire:     { bg: "#FF6B35", light: "#FFE0D0" },
  water:    { bg: "#4A9FFF", light: "#D0E8FF" },
  grass:    { bg: "#3DB35E", light: "#D0F0DB" },
  electric: { bg: "#F7CE00", light: "#FFF6B0" },
  psychic:  { bg: "#FF5F8A", light: "#FFD6E5" },
  ice:      { bg: "#74D4E8", light: "#D8F5FF" },
  dragon:   { bg: "#6C4FDF", light: "#E0D8FF" },
  dark:     { bg: "#4A4060", light: "#D8D4E8" },
  fairy:    { bg: "#FF97D0", light: "#FFE0F3" },
  fighting: { bg: "#C94D27", light: "#F5D4C8" },
  poison:   { bg: "#9B59B6", light: "#EDD8F5" },
  ground:   { bg: "#B8944A", light: "#F5EBCC" },
  rock:     { bg: "#9B8C5B", light: "#EEEAD8" },
  bug:      { bg: "#82B230", light: "#E5F0C0" },
  ghost:    { bg: "#5B4D7A", light: "#DDD8EE" },
  steel:    { bg: "#7A8FA6", light: "#DDE4EC" },
  normal:   { bg: "#A8A878", light: "#E8E8D0" },
  flying:   { bg: "#89A0D0", light: "#D8E0F5" },
};

const ELO_K = 32;
const INITIAL_ELO = 1200;
const STORAGE_KEY = "pokerank_data_v2";

// ── ELO helpers ──────────────────────────────────────────────────────────────
function expectedScore(rA, rB) { return 1 / (1 + Math.pow(10, (rB - rA) / 400)); }
function updateElo(rA, rB, scoreA) {
  const ea = expectedScore(rA, rB);
  return [
    Math.round(rA + ELO_K * (scoreA - ea)),
    Math.round(rB + ELO_K * ((1 - scoreA) - (1 - ea))),
  ];
}

// ── Storage helpers ──────────────────────────────────────────────────────────
function loadData() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : { elos: {}, matches: 0, history: [] };
  } catch { return { elos: {}, matches: 0, history: [] }; }
}
function saveData(d) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(d)); } catch {}
}

// ── Generation helper ────────────────────────────────────────────────────────
function getGen(id) {
  return GENERATIONS.find(g => id >= g.range[0] && id <= g.range[1])?.id ?? 1;
}

// ── Pokemon cache & fetch ────────────────────────────────────────────────────
const pokeCache = {};
async function fetchPoke(id) {
  if (pokeCache[id]) return pokeCache[id];
  try {
    const res = await fetch(`https://pokeapi.co/api/v2/pokemon/${id}`);
    const d = await res.json();
    const poke = {
      id,
      name: d.name.charAt(0).toUpperCase() + d.name.slice(1).replace(/-/g, " "),
      sprite: d.sprites.other["official-artwork"].front_default || d.sprites.front_default,
      types: d.types.map(t => t.type.name),
      gen: getGen(id),
    };
    pokeCache[id] = poke;
    return poke;
  } catch { return null; }
}

// ── Matchmaking ──────────────────────────────────────────────────────────────
function pickOpponents(elos, allIds, totalMatches) {
  const eligible = allIds.filter(id => id >= 1 && id <= 1025);
  if (eligible.length < 2) return null;
  if (totalMatches < 20 || Object.keys(elos).length < 10) {
    const a = eligible[Math.floor(Math.random() * eligible.length)];
    let b; do { b = eligible[Math.floor(Math.random() * eligible.length)]; } while (b === a);
    return [a, b];
  }
  if (Math.random() < 0.7) {
    const sorted = [...eligible].sort((a, b) => (elos[b] || INITIAL_ELO) - (elos[a] || INITIAL_ELO));
    const pivot = Math.floor(Math.random() * sorted.length);
    const a = sorted[pivot];
    const candidates = sorted.slice(Math.max(0, pivot - 20), pivot + 21).filter(x => x !== a);
    if (candidates.length) return [a, candidates[Math.floor(Math.random() * candidates.length)]];
  }
  const a = eligible[Math.floor(Math.random() * eligible.length)];
  let b; do { b = eligible[Math.floor(Math.random() * eligible.length)]; } while (b === a);
  return [a, b];
}

// ── Export canvas helper ─────────────────────────────────────────────────────
async function exportRankingImage(topPokes, pokeDataMap, eloMap, title, matches) {
  const count = topPokes.length;
  const COLS = count <= 10 ? 5 : 10;
  const ROWS = Math.ceil(count / COLS);
  const CARD_W = 140, CARD_H = 180, PAD = 20, HEADER = 90;
  const W = COLS * CARD_W + (COLS + 1) * PAD;
  const H = HEADER + ROWS * CARD_H + (ROWS + 1) * PAD + 40;

  const canvas = document.createElement("canvas");
  canvas.width = W * 2; canvas.height = H * 2;
  const ctx = canvas.getContext("2d");
  ctx.scale(2, 2);

  // Background
  ctx.fillStyle = "#F8F6FF";
  ctx.fillRect(0, 0, W, H);

  // Header gradient bar
  const grad = ctx.createLinearGradient(0, 0, W, 0);
  grad.addColorStop(0, "#6C4FDF"); grad.addColorStop(1, "#FF5F8A");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, W, 6);

  // Title
  ctx.fillStyle = "#1A1025";
  ctx.font = "bold 22px 'Nunito', sans-serif";
  ctx.fillText(`⚡ PokéRank — ${title}`, PAD, 40);
  ctx.fillStyle = "#A89FC0";
  ctx.font = "13px 'Nunito', sans-serif";
  ctx.fillText(`${count} Pokémon · ${matches} duels joués`, PAD, 62);

  // Load all images first
  const imgMap = {};
  await Promise.all(topPokes.map(id => {
    const poke = pokeDataMap[id];
    if (!poke?.sprite) return Promise.resolve();
    return new Promise(resolve => {
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.onload = () => { imgMap[id] = img; resolve(); };
      img.onerror = resolve;
      img.src = poke.sprite;
    });
  }));

  // Draw cards
  topPokes.forEach((id, i) => {
    const col = i % COLS, row = Math.floor(i / COLS);
    const x = PAD + col * (CARD_W + PAD);
    const y = HEADER + PAD + row * (CARD_H + PAD);
    const poke = pokeDataMap[id];
    const tc = (poke && TYPE_COLORS[poke.types?.[0]]) || TYPE_COLORS.normal;
    const elo = eloMap[id] || INITIAL_ELO;
    const rank = i + 1;

    // Card bg
    ctx.fillStyle = "#FFFFFF";
    ctx.beginPath();
    ctx.roundRect(x, y, CARD_W, CARD_H, 12);
    ctx.fill();

    // Top color strip
    ctx.fillStyle = tc.light;
    ctx.beginPath();
    ctx.roundRect(x, y, CARD_W, 100, [12, 12, 0, 0]);
    ctx.fill();

    // Sprite
    if (imgMap[id]) {
      ctx.drawImage(imgMap[id], x + 20, y + 8, 100, 84);
    }

    // Rank badge
    ctx.fillStyle = rank <= 3 ? tc.bg : "#6C4FDF";
    ctx.beginPath();
    ctx.roundRect(x + 6, y + 6, 28, 20, 6);
    ctx.fill();
    ctx.fillStyle = "#fff";
    ctx.font = "bold 11px 'Nunito', sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(rank <= 3 ? ["🥇","🥈","🥉"][rank-1] : `#${rank}`, x + 20, y + 20);
    ctx.textAlign = "left";

    // Name
    ctx.fillStyle = "#1A1025";
    ctx.font = "bold 12px 'Nunito', sans-serif";
    ctx.textAlign = "center";
    const name = poke?.name || `#${id}`;
    ctx.fillText(name.length > 12 ? name.slice(0, 11) + "…" : name, x + CARD_W / 2, y + 114);

    // Type badge
    ctx.fillStyle = tc.light;
    ctx.beginPath();
    ctx.roundRect(x + 20, y + 122, CARD_W - 40, 18, 9);
    ctx.fill();
    ctx.fillStyle = tc.bg;
    ctx.font = "bold 10px 'Nunito', sans-serif";
    ctx.fillText(poke?.types?.[0] || "", x + CARD_W / 2, y + 134);

    // ELO
    ctx.fillStyle = "#A89FC0";
    ctx.font = "11px 'Nunito', sans-serif";
    ctx.fillText(`ELO ${elo}`, x + CARD_W / 2, y + 155);

    ctx.textAlign = "left";
  });

  // Footer
  ctx.fillStyle = "#C0B8D8";
  ctx.font = "11px 'Nunito', sans-serif";
  ctx.textAlign = "center";
  ctx.fillText(`Généré par PokéRank · ${new Date().toLocaleDateString("fr-FR")}`, W / 2, H - 12);

  // Download
  const link = document.createElement("a");
  link.download = `pokerank-${title.toLowerCase().replace(/\s+/g, "-")}.png`;
  link.href = canvas.toDataURL("image/png");
  link.click();
}

// ── Reset confirmation modal ─────────────────────────────────────────────────
function ResetModal({ onConfirm, onCancel, matchCount }) {
  return (
    <div style={{
      position: "fixed", inset: 0, zIndex: 999,
      background: "rgba(26,16,37,0.55)",
      display: "flex", alignItems: "center", justifyContent: "center",
      animation: "fadeIn 0.15s ease",
    }}>
      <div style={{
        background: "#fff", borderRadius: 20,
        padding: "36px 32px", maxWidth: 380, width: "90%",
        boxShadow: "0 24px 80px rgba(108,79,223,0.18)",
        textAlign: "center",
      }}>
        <div style={{ fontSize: 40, marginBottom: 12 }}>⚠️</div>
        <div style={{ fontSize: 19, fontWeight: 800, color: "#1A1025", marginBottom: 8 }}>
          Réinitialiser le classement ?
        </div>
        <div style={{ fontSize: 14, color: "#A89FC0", lineHeight: 1.6, marginBottom: 28 }}>
          Tu vas perdre <strong style={{ color: "#FF5F8A" }}>{matchCount} duels</strong> et tous
          les scores ELO accumulés. Cette action est irréversible.
        </div>
        <div style={{ display: "flex", gap: 10 }}>
          <button onClick={onCancel} style={{
            flex: 1, padding: "12px", borderRadius: 12,
            border: "1.5px solid #E8E4F0", background: "#F8F6FF",
            fontSize: 14, fontWeight: 700, color: "#6C4FDF", cursor: "pointer",
          }}>
            Annuler
          </button>
          <button onClick={onConfirm} style={{
            flex: 1, padding: "12px", borderRadius: 12,
            border: "none", background: "linear-gradient(135deg, #FF5F8A, #C94D27)",
            fontSize: 14, fontWeight: 700, color: "#fff", cursor: "pointer",
          }}>
            Tout effacer
          </button>
        </div>
      </div>
      <style>{`@keyframes fadeIn { from { opacity:0; } to { opacity:1; } }`}</style>
    </div>
  );
}

// ── TypeBadge ────────────────────────────────────────────────────────────────
function TypeBadge({ type }) {
  const c = TYPE_COLORS[type] || TYPE_COLORS.normal;
  return (
    <span style={{
      background: c.light, color: c.bg,
      border: `1.5px solid ${c.bg}`,
      borderRadius: 20, padding: "2px 10px",
      fontSize: 11, fontWeight: 700, textTransform: "capitalize",
      letterSpacing: "0.04em",
    }}>{type}</span>
  );
}

// ── PokeCard ─────────────────────────────────────────────────────────────────
function PokeCard({ poke, swipeDir, onSwipe }) {
  const [hover, setHover] = useState(false);
  const typeColor = poke ? (TYPE_COLORS[poke.types?.[0]] || TYPE_COLORS.normal) : TYPE_COLORS.normal;
  const swipeAnimation = swipeDir ? {
    transform: swipeDir === "left" ? "translateX(-120%) rotate(-15deg)" :
               swipeDir === "right" ? "translateX(120%) rotate(15deg)" : "translateY(-120%)",
    opacity: 0,
    transition: "all 0.35s cubic-bezier(0.4, 0, 0.6, 1)",
  } : {};

  return (
    <div onClick={onSwipe}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        width: 240, background: "#fff", borderRadius: 24,
        border: `2.5px solid ${hover ? typeColor.bg : "#E8E4F0"}`,
        padding: "20px 16px 24px", cursor: "pointer",
        transition: "border-color 0.2s, transform 0.2s, box-shadow 0.2s",
        transform: hover && !swipeDir ? "translateY(-6px) scale(1.02)" : "none",
        boxShadow: hover ? `0 16px 48px ${typeColor.bg}30` : "0 4px 20px rgba(0,0,0,0.08)",
        display: "flex", flexDirection: "column", alignItems: "center", gap: 12,
        userSelect: "none", ...swipeAnimation,
      }}>
      <div style={{
        width: 150, height: 150, borderRadius: 20,
        background: typeColor.light,
        display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden",
      }}>
        {poke?.sprite
          ? <img src={poke.sprite} alt={poke.name} style={{ width: "85%", height: "85%", objectFit: "contain" }} />
          : <div style={{ fontSize: 48, color: "#ccc" }}>?</div>}
      </div>
      <div style={{ fontSize: 11, color: "#A89FC0", fontWeight: 600, letterSpacing: "0.08em" }}>
        #{String(poke?.id || "").padStart(4, "0")}
      </div>
      <div style={{ fontSize: 20, fontWeight: 700, color: "#1A1025", textAlign: "center", lineHeight: 1.2 }}>
        {poke?.name || "…"}
      </div>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", justifyContent: "center" }}>
        {poke?.types?.map(t => <TypeBadge key={t} type={t} />)}
      </div>
      <div style={{ fontSize: 11, color: "#A89FC0", fontWeight: 500 }}>Génération {poke?.gen}</div>
    </div>
  );
}

// ── TINDER VIEW ──────────────────────────────────────────────────────────────
function TinderView({ data, setData }) {
  const [left, setLeft] = useState(null);
  const [right, setRight] = useState(null);
  const [loading, setLoading] = useState(true);
  const [swipeAnim, setSwipeAnim] = useState(null);
  const [swipeLabel, setSwipeLabel] = useState(null);
  const touchStart = useRef(null);
  const allIds = Array.from({ length: 1025 }, (_, i) => i + 1);

  const loadPair = useCallback(async (d) => {
    setLoading(true);
    const pair = pickOpponents(d.elos, allIds, d.matches);
    if (!pair) { setLoading(false); return; }
    const [p1, p2] = await Promise.all([fetchPoke(pair[0]), fetchPoke(pair[1])]);
    setLeft(p1); setRight(p2); setLoading(false);
  }, []);

  useEffect(() => { loadPair(data); }, []);

  const vote = useCallback(async (winner) => {
    if (!left || !right || swipeAnim) return;
    const dir = winner === "left" ? "left" : winner === "right" ? "right" : "up";
    const label = winner === "left" ? `${left.name} gagne !` :
                  winner === "right" ? `${right.name} gagne !` : "Égalité !";
    setSwipeAnim(dir); setSwipeLabel(label);
    const newElos = { ...data.elos };
    const eloL = newElos[left.id] || INITIAL_ELO;
    const eloR = newElos[right.id] || INITIAL_ELO;
    const scoreL = winner === "left" ? 1 : winner === "right" ? 0 : 0.5;
    const [nL, nR] = updateElo(eloL, eloR, scoreL);
    newElos[left.id] = nL; newElos[right.id] = nR;
    const newData = {
      ...data, elos: newElos, matches: data.matches + 1,
      history: [{ l: left.id, r: right.id, w: winner, ts: Date.now() }, ...data.history.slice(0, 499)],
    };
    setData(newData); saveData(newData);
    setTimeout(async () => { setSwipeAnim(null); setSwipeLabel(null); await loadPair(newData); }, 400);
  }, [left, right, data, swipeAnim, loadPair, setData]);

  const handleTouchStart = (e) => { touchStart.current = { x: e.touches[0].clientX, y: e.touches[0].clientY }; };
  const handleTouchEnd = (e) => {
    if (!touchStart.current) return;
    const dx = e.changedTouches[0].clientX - touchStart.current.x;
    const dy = e.changedTouches[0].clientY - touchStart.current.y;
    if (Math.abs(dy) > Math.abs(dx) && dy < -60) { vote("draw"); return; }
    if (Math.abs(dx) > 60) vote(dx < 0 ? "left" : "right");
    touchStart.current = null;
  };

  useEffect(() => {
    const h = (e) => {
      if (e.key === "ArrowLeft") vote("left");
      else if (e.key === "ArrowRight") vote("right");
      else if (e.key === "ArrowUp") vote("draw");
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [vote]);

  const matchCount = data.matches;
  const phase = matchCount < 20 ? "Découverte" : matchCount < 60 ? "Calibrage" : "Affinage";

  return (
    <div onTouchStart={handleTouchStart} onTouchEnd={handleTouchEnd}
      style={{ display: "flex", flexDirection: "column", alignItems: "center", padding: "32px 20px", gap: 32, minHeight: 500 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
        <div style={{ fontSize: 13, color: "#A89FC0", fontWeight: 500 }}>
          {matchCount} duels · Phase : <span style={{ color: "#6C4FDF", fontWeight: 700 }}>{phase}</span>
        </div>
        <div style={{ width: 120, height: 4, background: "#F0EDF8", borderRadius: 4, overflow: "hidden" }}>
          <div style={{ height: "100%", width: `${Math.min(100, (matchCount / 60) * 100)}%`,
            background: "linear-gradient(90deg, #6C4FDF, #FF5F8A)", borderRadius: 4, transition: "width 0.5s" }} />
        </div>
      </div>
      <div style={{ height: 28 }}>
        {swipeLabel && <div style={{ fontSize: 16, fontWeight: 700, color: "#6C4FDF", animation: "fadeIn 0.2s ease" }}>{swipeLabel}</div>}
      </div>
      {loading ? (
        <div style={{ display: "flex", gap: 32, alignItems: "center" }}>
          {[0,1].map(i => <div key={i} style={{ width: 240, height: 340, borderRadius: 24, background: "#F5F3FF", animation: "pulse 1.2s infinite" }} />)}
        </div>
      ) : (
        <div style={{ display: "flex", gap: 32, alignItems: "center" }}>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 8 }}>
            <div style={{ fontSize: 11, color: "#A89FC0", fontWeight: 600, letterSpacing: "0.06em" }}>← GAUCHE</div>
            <PokeCard poke={left} swipeDir={swipeAnim === "left" ? "left" : null} onSwipe={() => vote("left")} />
            <div style={{ padding: "6px 16px", borderRadius: 12, background: "#F5F3FF", color: "#6C4FDF", fontSize: 12, fontWeight: 600 }}>
              ELO {data.elos[left?.id] || INITIAL_ELO}
            </div>
          </div>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 12 }}>
            <button onClick={() => vote("draw")} style={{
              background: "#F5F3FF", border: "1.5px solid #C9C0E8", borderRadius: 14,
              padding: "10px 18px", cursor: "pointer", fontSize: 12, fontWeight: 700,
              color: "#6C4FDF", transition: "all 0.15s",
            }}>↑ Hésitation</button>
            <div style={{ fontSize: 22, fontWeight: 800, color: "#D0C8E8" }}>VS</div>
          </div>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 8 }}>
            <div style={{ fontSize: 11, color: "#A89FC0", fontWeight: 600, letterSpacing: "0.06em" }}>DROITE →</div>
            <PokeCard poke={right} swipeDir={swipeAnim === "right" ? "right" : swipeAnim === "up" ? "up" : null} onSwipe={() => vote("right")} />
            <div style={{ padding: "6px 16px", borderRadius: 12, background: "#F5F3FF", color: "#6C4FDF", fontSize: 12, fontWeight: 600 }}>
              ELO {data.elos[right?.id] || INITIAL_ELO}
            </div>
          </div>
        </div>
      )}
      <div style={{ fontSize: 12, color: "#C0B8D8", textAlign: "center" }}>
        Clic sur la carte · Touches ← → ↑ · Swipe sur mobile
      </div>
      <style>{`
        @keyframes fadeIn { from { opacity:0; transform:scale(0.9); } to { opacity:1; transform:scale(1); } }
        @keyframes pulse { 0%,100%{opacity:1;} 50%{opacity:0.5;} }
      `}</style>
    </div>
  );
}

// ── RANKING VIEW ─────────────────────────────────────────────────────────────
function RankingView({ data, onReset }) {
  const [genFilter, setGenFilter] = useState(0);
  const [pokeData, setPokeData] = useState({});
  const [page, setPage] = useState(0);
  const [exporting, setExporting] = useState(false);
  const [exportCount, setExportCount] = useState(null); // 10 | 50
  const PER_PAGE = 25;

  const rankedIds = Object.entries(data.elos)
    .sort((a, b) => b[1] - a[1])
    .map(([id]) => parseInt(id));

  useEffect(() => {
    if (!rankedIds.length) return;
    const toLoad = rankedIds.filter(id => !pokeData[id]);
    Promise.all(toLoad.map(id => fetchPoke(id))).then(results => {
      const nd = { ...pokeData };
      results.forEach(p => { if (p) nd[p.id] = p; });
      setPokeData(nd);
    });
  }, [data.elos]);

  const filtered = rankedIds.filter(id =>
    genFilter === 0 || (pokeData[id]?.gen || getGen(id)) === genFilter
  );

  const paginated = filtered.slice(page * PER_PAGE, (page + 1) * PER_PAGE);
  const maxElo = data.elos[rankedIds[0]] || INITIAL_ELO;
  const minElo = data.elos[rankedIds[rankedIds.length - 1]] || INITIAL_ELO;
  const eloRange = maxElo - minElo || 1;

  const handleExport = async (count) => {
    setExporting(true);
    setExportCount(count);
    const top = filtered.slice(0, count);
    // Preload any missing poke data
    const missing = top.filter(id => !pokeData[id]);
    if (missing.length) {
      const results = await Promise.all(missing.map(id => fetchPoke(id)));
      const nd = { ...pokeData };
      results.forEach(p => { if (p) nd[p.id] = p; });
      setPokeData(nd);
      await exportRankingImage(top, { ...pokeData, ...nd }, data.elos,
        genFilter === 0 ? `Top ${count}` : `Top ${count} — Gen ${genFilter}`, data.matches);
    } else {
      await exportRankingImage(top, pokeData, data.elos,
        genFilter === 0 ? `Top ${count}` : `Top ${count} — Gen ${genFilter}`, data.matches);
    }
    setExporting(false);
    setExportCount(null);
  };

  return (
    <div style={{ padding: "32px 24px" }}>
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 24, flexWrap: "wrap", gap: 12 }}>
        <div>
          <div style={{ fontSize: 22, fontWeight: 800, color: "#1A1025" }}>Classement ELO</div>
          <div style={{ fontSize: 13, color: "#A89FC0", marginTop: 4 }}>
            {rankedIds.length} Pokémon classés · {data.matches} duels joués
            {data.matches < 20 && <span style={{ color: "#FF9F43", marginLeft: 8 }}>⚠ Classement en cours de calibrage</span>}
          </div>
        </div>

        {/* Action buttons */}
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {/* Export buttons */}
          {filtered.length >= 10 && (
            <button onClick={() => handleExport(10)} disabled={exporting}
              style={{
                padding: "8px 16px", borderRadius: 10, cursor: "pointer",
                border: "1.5px solid #6C4FDF", background: exporting && exportCount === 10 ? "#6C4FDF" : "#F5F3FF",
                color: exporting && exportCount === 10 ? "#fff" : "#6C4FDF",
                fontSize: 12, fontWeight: 700, display: "flex", alignItems: "center", gap: 6,
                transition: "all 0.15s", opacity: exporting ? 0.7 : 1,
              }}>
              {exporting && exportCount === 10 ? "⏳ Export…" : "📸 Top 10"}
            </button>
          )}
          {filtered.length >= 50 && (
            <button onClick={() => handleExport(50)} disabled={exporting}
              style={{
                padding: "8px 16px", borderRadius: 10, cursor: "pointer",
                border: "1.5px solid #6C4FDF", background: exporting && exportCount === 50 ? "#6C4FDF" : "#F5F3FF",
                color: exporting && exportCount === 50 ? "#fff" : "#6C4FDF",
                fontSize: 12, fontWeight: 700, display: "flex", alignItems: "center", gap: 6,
                transition: "all 0.15s", opacity: exporting ? 0.7 : 1,
              }}>
              {exporting && exportCount === 50 ? "⏳ Export…" : "📸 Top 50"}
            </button>
          )}
          {/* Reset button */}
          <button onClick={onReset}
            style={{
              padding: "8px 16px", borderRadius: 10, cursor: "pointer",
              border: "1.5px solid #FFCDD2", background: "#FFF5F5",
              color: "#C94D27", fontSize: 12, fontWeight: 700,
              display: "flex", alignItems: "center", gap: 6,
              transition: "all 0.15s",
            }}>
            🗑 Réinitialiser
          </button>
        </div>
      </div>

      {/* Gen filter */}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 24 }}>
        {[0, ...GENERATIONS.map(g => g.id)].map(g => (
          <button key={g} onClick={() => { setGenFilter(g); setPage(0); }}
            style={{
              padding: "6px 14px", borderRadius: 20,
              border: genFilter === g ? "2px solid #6C4FDF" : "1.5px solid #E8E4F0",
              background: genFilter === g ? "#6C4FDF" : "#fff",
              color: genFilter === g ? "#fff" : "#6C4FDF",
              fontSize: 12, fontWeight: 600, cursor: "pointer", transition: "all 0.15s",
            }}>
            {g === 0 ? "Tous" : `Gen ${g}`}
          </button>
        ))}
      </div>

      {/* Export hint */}
      {filtered.length > 0 && filtered.length < 10 && (
        <div style={{ fontSize: 12, color: "#A89FC0", marginBottom: 16, padding: "8px 14px", background: "#F8F6FF", borderRadius: 10, border: "1px dashed #E8E4F0" }}>
          💡 Il faut au moins 10 Pokémon classés pour exporter une image. Continue les duels !
        </div>
      )}

      {/* Rankings list */}
      {filtered.length === 0 ? (
        <div style={{ textAlign: "center", color: "#A89FC0", padding: "60px 0", fontSize: 15 }}>
          Aucun Pokémon classé pour cette génération.<br />
          <span style={{ fontSize: 13 }}>Jouez des duels dans le mode Tinder !</span>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {paginated.map((id) => {
            const globalRank = filtered.indexOf(id) + 1;
            const elo = data.elos[id] || INITIAL_ELO;
            const poke = pokeData[id];
            const barWidth = ((elo - minElo) / eloRange) * 100;
            const typeColor = poke ? (TYPE_COLORS[poke.types?.[0]] || TYPE_COLORS.normal) : TYPE_COLORS.normal;
            const medal = globalRank === 1 ? "🥇" : globalRank === 2 ? "🥈" : globalRank === 3 ? "🥉" : null;

            return (
              <div key={id} style={{
                display: "flex", alignItems: "center", gap: 16, padding: "10px 16px", borderRadius: 14,
                background: globalRank <= 3 ? `${typeColor.light}60` : "#FAFAF8",
                border: `1.5px solid ${globalRank <= 3 ? typeColor.bg + "40" : "#F0EDF8"}`,
                transition: "all 0.15s",
              }}>
                <div style={{ width: 36, textAlign: "center", fontSize: 14, fontWeight: 800, color: globalRank <= 3 ? typeColor.bg : "#A89FC0" }}>
                  {medal || `#${globalRank}`}
                </div>
                <div style={{ width: 44, height: 44, borderRadius: 10, background: typeColor.light,
                  display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                  {poke?.sprite
                    ? <img src={poke.sprite} alt={poke.name} style={{ width: 36, height: 36, objectFit: "contain" }} />
                    : <div style={{ width: 24, height: 24, borderRadius: 6, background: "#E8E4F0", animation: "pulse 1.2s infinite" }} />}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 14, fontWeight: 700, color: "#1A1025" }}>{poke?.name || `#${id}`}</div>
                  <div style={{ display: "flex", gap: 4, marginTop: 3 }}>
                    {poke?.types?.map(t => <TypeBadge key={t} type={t} />) ||
                      <div style={{ height: 16, width: 40, borderRadius: 8, background: "#F0EDF8" }} />}
                  </div>
                </div>
                <div style={{ width: 160, display: "flex", flexDirection: "column", gap: 4, flexShrink: 0 }}>
                  <div style={{ display: "flex", justifyContent: "space-between" }}>
                    <span style={{ fontSize: 11, color: "#A89FC0", fontWeight: 500 }}>ELO</span>
                    <span style={{ fontSize: 13, fontWeight: 700, color: typeColor.bg }}>{elo}</span>
                  </div>
                  <div style={{ height: 6, background: "#F0EDF8", borderRadius: 3, overflow: "hidden" }}>
                    <div style={{ height: "100%", width: `${barWidth}%`,
                      background: `linear-gradient(90deg, ${typeColor.bg}90, ${typeColor.bg})`,
                      borderRadius: 3, transition: "width 0.5s" }} />
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Pagination */}
      {filtered.length > PER_PAGE && (
        <div style={{ display: "flex", justifyContent: "center", gap: 12, marginTop: 24 }}>
          <button onClick={() => setPage(p => Math.max(0, p - 1))} disabled={page === 0}
            style={{ padding: "8px 18px", borderRadius: 10, border: "1.5px solid #E8E4F0",
              background: "#fff", cursor: "pointer", fontSize: 13, color: "#6C4FDF", opacity: page === 0 ? 0.4 : 1 }}>
            ← Précédent
          </button>
          <span style={{ fontSize: 13, color: "#A89FC0", padding: "8px 0" }}>
            {page + 1} / {Math.ceil(filtered.length / PER_PAGE)}
          </span>
          <button onClick={() => setPage(p => Math.min(Math.ceil(filtered.length / PER_PAGE) - 1, p + 1))}
            disabled={page >= Math.ceil(filtered.length / PER_PAGE) - 1}
            style={{ padding: "8px 18px", borderRadius: 10, border: "1.5px solid #E8E4F0",
              background: "#fff", cursor: "pointer", fontSize: 13, color: "#6C4FDF",
              opacity: page >= Math.ceil(filtered.length / PER_PAGE) - 1 ? 0.4 : 1 }}>
            Suivant →
          </button>
        </div>
      )}
      <style>{`@keyframes pulse { 0%,100%{opacity:1;} 50%{opacity:0.5;} }`}</style>
    </div>
  );
}

// ── POKEDEX VIEW ─────────────────────────────────────────────────────────────
function PokedexView() {
  const [genFilter, setGenFilter] = useState(1);
  const [pokes, setPokes] = useState([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");

  useEffect(() => {
    const gen = GENERATIONS.find(g => g.id === genFilter);
    if (!gen) return;
    setLoading(true);
    const [start, end] = gen.range;
    const ids = Array.from({ length: end - start + 1 }, (_, i) => start + i);
    let loaded = [];
    const batchSize = 20;
    setPokes([]);
    const run = async () => {
      for (let i = 0; i < ids.length; i += batchSize) {
        const results = await Promise.all(ids.slice(i, i + batchSize).map(id => fetchPoke(id)));
        loaded = [...loaded, ...results.filter(Boolean)];
        setPokes([...loaded]);
      }
      setLoading(false);
    };
    run();
  }, [genFilter]);

  const filtered = pokes.filter(p =>
    !search || p.name.toLowerCase().includes(search.toLowerCase()) || String(p.id).includes(search)
  );

  return (
    <div style={{ padding: "24px" }}>
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 20, alignItems: "center" }}>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", flex: 1 }}>
          {GENERATIONS.map(g => (
            <button key={g.id} onClick={() => setGenFilter(g.id)}
              style={{
                padding: "6px 14px", borderRadius: 20,
                border: genFilter === g.id ? "2px solid #6C4FDF" : "1.5px solid #E8E4F0",
                background: genFilter === g.id ? "#6C4FDF" : "#fff",
                color: genFilter === g.id ? "#fff" : "#6C4FDF",
                fontSize: 12, fontWeight: 600, cursor: "pointer", transition: "all 0.15s",
              }}>{g.name}</button>
          ))}
        </div>
        <input placeholder="Rechercher…" value={search} onChange={e => setSearch(e.target.value)}
          style={{ padding: "8px 14px", borderRadius: 12, border: "1.5px solid #E8E4F0", fontSize: 13, outline: "none", width: 160 }} />
      </div>
      <div style={{ fontSize: 13, color: "#A89FC0", marginBottom: 16 }}>
        {loading ? `Chargement… (${pokes.length} chargés)` : `${filtered.length} Pokémon`}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(130px, 1fr))", gap: 12 }}>
        {filtered.map(poke => {
          const typeColor = TYPE_COLORS[poke.types[0]] || TYPE_COLORS.normal;
          return (
            <div key={poke.id} style={{
              borderRadius: 16, border: "1.5px solid #F0EDF8", background: "#fff",
              padding: "12px 8px", display: "flex", flexDirection: "column", alignItems: "center", gap: 6,
              transition: "all 0.15s", cursor: "default",
            }}
              onMouseEnter={e => { e.currentTarget.style.borderColor = typeColor.bg; e.currentTarget.style.transform = "translateY(-3px)"; e.currentTarget.style.boxShadow = `0 8px 24px ${typeColor.bg}25`; }}
              onMouseLeave={e => { e.currentTarget.style.borderColor = "#F0EDF8"; e.currentTarget.style.transform = "none"; e.currentTarget.style.boxShadow = "none"; }}>
              <div style={{ width: 80, height: 80, borderRadius: 12, background: typeColor.light, display: "flex", alignItems: "center", justifyContent: "center" }}>
                {poke.sprite
                  ? <img src={poke.sprite} alt={poke.name} style={{ width: 64, height: 64, objectFit: "contain" }} />
                  : <div style={{ width: 40, height: 40, borderRadius: 8, background: "#E8E4F0" }} />}
              </div>
              <div style={{ fontSize: 10, color: "#C0B8D8", fontWeight: 600 }}>#{String(poke.id).padStart(4, "0")}</div>
              <div style={{ fontSize: 12, fontWeight: 700, color: "#1A1025", textAlign: "center", lineHeight: 1.3 }}>{poke.name}</div>
              <div style={{ display: "flex", gap: 4, flexWrap: "wrap", justifyContent: "center" }}>
                {poke.types.map(t => <TypeBadge key={t} type={t} />)}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── ROOT APP ─────────────────────────────────────────────────────────────────
export default function App() {
  const [tab, setTab] = useState("pokedex");
  const [data, setData] = useState(() => loadData());
  const [showResetModal, setShowResetModal] = useState(false);

  const handleReset = () => setShowResetModal(true);
  const confirmReset = () => {
    const empty = { elos: {}, matches: 0, history: [] };
    setData(empty);
    saveData(empty);
    setShowResetModal(false);
  };

  const tabs = [
    { id: "pokedex", label: "Pokédex", icon: "📖" },
    { id: "tinder", label: "Duels", icon: "⚔️" },
    { id: "ranking", label: "Classement", icon: "🏆" },
  ];

  return (
    <div style={{ minHeight: "100vh", background: "#F8F6FF", fontFamily: "'Nunito', 'Segoe UI', sans-serif" }}>
      <link href="https://fonts.googleapis.com/css2?family=Nunito:wght@400;500;600;700;800;900&display=swap" rel="stylesheet" />

      {showResetModal && (
        <ResetModal
          matchCount={data.matches}
          onConfirm={confirmReset}
          onCancel={() => setShowResetModal(false)}
        />
      )}

      {/* Header */}
      <div style={{
        background: "#fff", borderBottom: "1.5px solid #F0EDF8", padding: "0 24px",
        display: "flex", alignItems: "center", justifyContent: "space-between",
        height: 60, position: "sticky", top: 0, zIndex: 100,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{
            width: 32, height: 32, borderRadius: 10,
            background: "linear-gradient(135deg, #6C4FDF, #FF5F8A)",
            display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16,
          }}>⚡</div>
          <span style={{ fontSize: 18, fontWeight: 900, color: "#1A1025", letterSpacing: "-0.02em" }}>
            Poké<span style={{ color: "#6C4FDF" }}>Rank</span>
          </span>
        </div>
        <div style={{ display: "flex", gap: 4 }}>
          {tabs.map(t => (
            <button key={t.id} onClick={() => setTab(t.id)} style={{
              padding: "7px 18px", borderRadius: 10, border: "none",
              background: tab === t.id ? "#6C4FDF" : "transparent",
              color: tab === t.id ? "#fff" : "#A89FC0",
              fontSize: 13, fontWeight: 700, cursor: "pointer", transition: "all 0.15s",
              display: "flex", alignItems: "center", gap: 6,
            }}>
              <span>{t.icon}</span><span>{t.label}</span>
            </button>
          ))}
        </div>
        <div style={{ fontSize: 12, color: "#A89FC0", fontWeight: 500 }}>{data.matches} duels</div>
      </div>

      <div style={{ maxWidth: 960, margin: "0 auto" }}>
        {tab === "pokedex" && <PokedexView />}
        {tab === "tinder" && <TinderView data={data} setData={setData} />}
        {tab === "ranking" && <RankingView data={data} onReset={handleReset} />}
      </div>
    </div>
  );
}
