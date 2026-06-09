import { useState, useEffect, useCallback, useRef } from "react";

// ── Constants ────────────────────────────────────────────────────────────────
const GENERATIONS = [
  { id: 1, name: "Gen 1", range: [1,   151]  },
  { id: 2, name: "Gen 2", range: [152, 251]  },
  { id: 3, name: "Gen 3", range: [252, 386]  },
  { id: 4, name: "Gen 4", range: [387, 493]  },
  { id: 5, name: "Gen 5", range: [494, 649]  },
  { id: 6, name: "Gen 6", range: [650, 721]  },
  { id: 7, name: "Gen 7", range: [722, 809]  },
  { id: 8, name: "Gen 8", range: [810, 905]  },
  { id: 9, name: "Gen 9", range: [906, 1025] },
];

const TYPE_COLORS = {
  fire:     { bg: "#FF6B35", light: "#FFE0D0", fr: "Feu"      },
  water:    { bg: "#4A9FFF", light: "#D0E8FF", fr: "Eau"      },
  grass:    { bg: "#3DB35E", light: "#D0F0DB", fr: "Plante"   },
  electric: { bg: "#F7CE00", light: "#FFF6B0", fr: "Électrik" },
  psychic:  { bg: "#FF5F8A", light: "#FFD6E5", fr: "Psy"      },
  ice:      { bg: "#74D4E8", light: "#D8F5FF", fr: "Glace"    },
  dragon:   { bg: "#6C4FDF", light: "#E0D8FF", fr: "Dragon"   },
  dark:     { bg: "#4A4060", light: "#D8D4E8", fr: "Ténèbres" },
  fairy:    { bg: "#FF97D0", light: "#FFE0F3", fr: "Fée"      },
  fighting: { bg: "#C94D27", light: "#F5D4C8", fr: "Combat"   },
  poison:   { bg: "#9B59B6", light: "#EDD8F5", fr: "Poison"   },
  ground:   { bg: "#B8944A", light: "#F5EBCC", fr: "Sol"      },
  rock:     { bg: "#9B8C5B", light: "#EEEAD8", fr: "Roche"    },
  bug:      { bg: "#82B230", light: "#E5F0C0", fr: "Insecte"  },
  ghost:    { bg: "#5B4D7A", light: "#DDD8EE", fr: "Spectre"  },
  steel:    { bg: "#7A8FA6", light: "#DDE4EC", fr: "Acier"    },
  normal:   { bg: "#A8A878", light: "#E8E8D0", fr: "Normal"   },
  flying:   { bg: "#89A0D0", light: "#D8E0F5", fr: "Vol"      },
};

// ── Type effectiveness chart (attacking type → defending types hit for 2x) ───
// For each defending type, what attacking types deal 2x, 0.5x, or 0x damage
const TYPE_DEFENSE = {
  normal:   { weak:["fighting"],             resist:["ghost"],                   immune:["ghost"] },
  fire:     { weak:["water","ground","rock"], resist:["fire","grass","ice","bug","steel","fairy"], immune:[] },
  water:    { weak:["electric","grass"],      resist:["fire","water","ice","steel"], immune:[] },
  grass:    { weak:["fire","ice","poison","flying","bug"], resist:["water","electric","grass","ground"], immune:[] },
  electric: { weak:["ground"],               resist:["electric","flying","steel"], immune:[] },
  ice:      { weak:["fire","fighting","rock","steel"], resist:["ice"],            immune:[] },
  fighting: { weak:["flying","psychic","fairy"], resist:["bug","rock","dark"],   immune:[] },
  poison:   { weak:["ground","psychic"],      resist:["grass","fighting","poison","bug","fairy"], immune:[] },
  ground:   { weak:["water","grass","ice"],   resist:["poison","rock"],           immune:["electric"] },
  flying:   { weak:["electric","ice","rock"], resist:["grass","fighting","bug"],  immune:["ground"] },
  psychic:  { weak:["bug","ghost","dark"],    resist:["fighting","psychic"],      immune:[] },
  bug:      { weak:["fire","flying","rock"],  resist:["grass","fighting","ground"],immune:[] },
  rock:     { weak:["water","grass","fighting","ground","steel"], resist:["normal","fire","poison","flying"], immune:[] },
  ghost:    { weak:["ghost","dark"],          resist:["poison","bug"],            immune:["normal","fighting"] },
  dragon:   { weak:["ice","dragon","fairy"],  resist:["fire","water","electric","grass"], immune:[] },
  dark:     { weak:["fighting","bug","fairy"], resist:["ghost","dark"],           immune:["psychic"] },
  steel:    { weak:["fire","fighting","ground"], resist:["normal","grass","ice","flying","psychic","bug","rock","dragon","steel","fairy"], immune:["poison"] },
  fairy:    { weak:["poison","steel"],        resist:["fighting","bug","dark"],   immune:["dragon"] },
};

// Compute effective multipliers for a pokemon given its types
function computeMatchups(types) {
  const multipliers = {};
  const allTypes = Object.keys(TYPE_DEFENSE);
  allTypes.forEach(atk => { multipliers[atk] = 1; });

  types.forEach(defType => {
    const chart = TYPE_DEFENSE[defType];
    if (!chart) return;
    chart.weak.forEach(atk => { if (!chart.immune.includes(atk)) multipliers[atk] = (multipliers[atk]||1) * 2; });
    chart.resist.forEach(atk => { multipliers[atk] = (multipliers[atk]||1) * 0.5; });
    chart.immune.forEach(atk => { multipliers[atk] = 0; });
  });

  // Override: if a type appears in immune for any defending type, set to 0
  types.forEach(defType => {
    const chart = TYPE_DEFENSE[defType];
    if (!chart) return;
    chart.immune.forEach(atk => { multipliers[atk] = 0; });
  });

  const weaknesses  = allTypes.filter(t => multipliers[t] >= 2).sort((a,b) => multipliers[b]-multipliers[a]);
  const resistances = allTypes.filter(t => multipliers[t] > 0 && multipliers[t] < 1);
  const immunities  = allTypes.filter(t => multipliers[t] === 0);
  return { multipliers, weaknesses, resistances, immunities };
}

const STAT_LABELS = { hp:"PV", attack:"Attaque", defense:"Défense",
  "special-attack":"Att. Spé", "special-defense":"Déf. Spé", speed:"Vitesse" };

const ELO_K = 32;
const INITIAL_ELO = 1200;
const PROFILES_KEY  = "pokerank_profiles_v1";
const ACTIVE_KEY    = "pokerank_active_v1";
const NAMES_FR_KEY  = "pokerank_names_fr_v3"; // bumped to force refresh of bad cached names

// ── French names cache (localStorage) ───────────────────────────────────────
let frNamesCache = null;
function getFrCache() {
  if (frNamesCache) return frNamesCache;
  try { frNamesCache = JSON.parse(localStorage.getItem(NAMES_FR_KEY) || "{}"); }
  catch { frNamesCache = {}; }
  return frNamesCache;
}
function saveFrCache() {
  try { localStorage.setItem(NAMES_FR_KEY, JSON.stringify(frNamesCache || {})); } catch {}
}

// ── Profile storage ──────────────────────────────────────────────────────────
function loadProfiles() {
  try { return JSON.parse(localStorage.getItem(PROFILES_KEY) || "{}"); } catch { return {}; }
}
function saveProfiles(p) {
  try { localStorage.setItem(PROFILES_KEY, JSON.stringify(p)); } catch {}
}
function loadActiveId() {
  try { return localStorage.getItem(ACTIVE_KEY) || null; } catch { return null; }
}
function saveActiveId(id) {
  try { localStorage.setItem(ACTIVE_KEY, id); } catch {}
}
function emptyData() { return { elos: {}, matches: 0, history: [] }; }

// ── Gen helper ───────────────────────────────────────────────────────────────
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
    const frCache = getFrCache();
    let frName = frCache[id];
    if (!frName) {
      try {
        const sr = await fetch(`https://pokeapi.co/api/v2/pokemon-species/${id}`);
        const sd = await sr.json();
        // Strictly use French name from species — never fall back to English
        frName = sd.names.find(n => n.language.name === "fr")?.name;
        // If no French name exists at all (very rare), use capitalized raw name
        if (!frName) frName = d.name.charAt(0).toUpperCase() + d.name.slice(1).replace(/-/g," ");
        frCache[id] = frName;
        saveFrCache();
      } catch { frName = d.name.charAt(0).toUpperCase() + d.name.slice(1).replace(/-/g," "); }
    }
    const poke = {
      id, name: frName,
      nameRaw: d.name,
      sprite: d.sprites.other["official-artwork"].front_default || d.sprites.front_default,
      types: d.types.map(t => t.type.name),
      gen: getGen(id),
      height: d.height,
      weight: d.weight,
      stats: d.stats.map(s => ({ name: s.stat.name, value: s.base_stat })),
      abilities: d.abilities.map(a => ({ name: a.ability.name.replace(/-/g," "), hidden: a.is_hidden })),
      speciesUrl: d.species.url,
    };
    pokeCache[id] = poke;
    return poke;
  } catch { return null; }
}

const descTranslationCache = {};

async function translateToFrench(text) {
  if (descTranslationCache[text]) return descTranslationCache[text];
  try {
    const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(text)}&langpair=en|fr`;
    const res = await fetch(url);
    const d = await res.json();
    const translated = d.responseData?.translatedText;
    if (translated && d.responseStatus === 200) {
      descTranslationCache[text] = translated;
      return translated;
    }
  } catch {}
  return text; // fallback: return original if translation fails
}

async function fetchSpeciesDetail(speciesUrl) {
  try {
    const res = await fetch(speciesUrl);
    const d = await res.json();

    // Try French first, pick most recent entry
    const frEntries = d.flavor_text_entries.filter(e => e.language.name === "fr");
    let desc = "";
    let needsTranslation = false;

    if (frEntries.length > 0) {
      desc = frEntries[frEntries.length - 1].flavor_text;
    } else {
      // No French entry — grab latest English and translate
      const enEntries = d.flavor_text_entries.filter(e => e.language.name === "en");
      if (enEntries.length > 0) {
        const enText = enEntries[enEntries.length - 1].flavor_text.replace(/\f|\n/g, " ");
        needsTranslation = true;
        desc = enText;
      }
    }

    const cleanDesc = desc.replace(/\f|\n/g, " ").trim();

    const category = d.genera?.find(g => g.language.name === "fr")?.genus
                   || d.genera?.find(g => g.language.name === "en")?.genus || "";
    const evolutionUrl = d.evolution_chain?.url || null;
    const base = { desc: cleanDesc, needsTranslation, category, evolutionUrl,
                   captureRate: d.capture_rate, happiness: d.base_happiness };

    if (needsTranslation && cleanDesc) {
      const translated = await translateToFrench(cleanDesc);
      return { ...base, desc: translated, needsTranslation: false };
    }

    return base;
  } catch { return { desc: "", category: "", evolutionUrl: null }; }
}

// ── French item / trigger translations ───────────────────────────────────────
const ITEMS_FR = {
  // Pierres d'évolution
  "fire-stone":"Pierre Feu","water-stone":"Pierre Eau","thunder-stone":"Pierre Foudre",
  "leaf-stone":"Pierre Plante","moon-stone":"Pierre Lune","sun-stone":"Pierre Soleil",
  "shiny-stone":"Pierre Éclat","dusk-stone":"Pierre Nuit","dawn-stone":"Pierre Aube",
  "ice-stone":"Pierre Glace","oval-stone":"Pierre Ovale",
  // Objets tenus / trade
  "kings-rock":"Roche Royale","metal-coat":"Revêt. Métal","dragon-scale":"Écaille Dragon",
  "upgrade":"Mise à Jour","dubious-disc":"Disque Douteux","electirizer":"Électriseur",
  "magmarizer":"Magmariseur","protector":"Protecteur","reaper-cloth":"Linceul",
  "razor-fang":"Croc Rasoir","razor-claw":"Griffe Rasoir","deep-sea-tooth":"Dent Abyssale",
  "deep-sea-scale":"Écaille Abyssale","prism-scale":"Écaille Prisme",
  "whipped-dream":"Rêve Fouetté","sachet":"Sachet Parfumé",
  "strawberry-sweet":"Fraise Sucrée","love-sweet":"Cœur Sucré",
  "berry-sweet":"Baie Sucrée","clover-sweet":"Trèfle Sucré",
  "flower-sweet":"Fleur Sucrée","star-sweet":"Étoile Sucrée",
  "ribbon-sweet":"Ruban Sucré","chipped-pot":"Pot Ébréché","cracked-pot":"Pot Fissuré",
  "sweet-apple":"Pomme Sucrée","tart-apple":"Pomme Acidulée",
  "galarica-cuff":"Bracelet Galaria","galarica-wreath":"Couronne Galaria",
  "black-augurite":"Augure Noir","peat-block":"Bloc Tourbe",
  "auspicious-armor":"Armure Faste","malicious-armor":"Armure Néfaste",
  "scroll-of-darkness":"Parchemin Ténèbres","scroll-of-waters":"Parchemin Eaux",
  "leaders-crest":"Crête Chef","syrupy-apple":"Pomme Sirupeuse",
  "unremarkable-teacup":"Tasse Ordinaire","masterpiece-teacup":"Tasse Chef-d'Œuvre",
  "metal-alloy":"Alliage Métal",
  // Triggers
  "trade":"Échange","level-up":"Montée niveau","use-item":"Utiliser objet",
  "shed":"Mue","spin":"Tournoiement","tower-of-darkness":"Tour Ténèbres",
  "tower-of-waters":"Tour Eaux","three-critical-hits":"3 Coups Critiques",
  "take-damage":"Encaisser dégâts","other":"Spécial",
  // Lieux
  "mount-lanakila":"Mont Lanakila","eterna-forest":"Forêt Éterna",
  "twist-mountain":"Mont Tordu",
};

function translateTrigger(detail) {
  if (!detail) return null;
  if (detail.min_level) {
    let s = `Niv. ${detail.min_level}`;
    if (detail.time_of_day === "day") s += " (jour)";
    if (detail.time_of_day === "night") s += " (nuit)";
    if (detail.needs_overworld_rain) s += " (pluie)";
    return s;
  }
  if (detail.item) {
    const key = detail.item.name;
    return ITEMS_FR[key] || key.replace(/-/g," ").replace(/\b\w/g,c=>c.toUpperCase());
  }
  if (detail.held_item) {
    const key = detail.held_item.name;
    const fr = ITEMS_FR[key] || key.replace(/-/g," ").replace(/\b\w/g,c=>c.toUpperCase());
    return `Tenir ${fr}`;
  }
  if (detail.trigger?.name === "trade") {
    return detail.held_item
      ? `Échange avec ${ITEMS_FR[detail.held_item.name] || detail.held_item.name.replace(/-/g," ")}`
      : "Échange";
  }
  if (detail.min_happiness) return `Bonheur ≥${detail.min_happiness}`;
  if (detail.min_affection) return `Affection ≥${detail.min_affection}`;
  if (detail.min_beauty) return `Beauté ≥${detail.min_beauty}`;
  if (detail.known_move) return `Connaît ${detail.known_move.name.replace(/-/g," ")}`;
  if (detail.known_move_type) return `Connaît attaque ${detail.known_move_type.name}`;
  if (detail.location) return `À ${detail.location.name.replace(/-/g," ")}`;
  if (detail.party_species) return `Avec ${detail.party_species.name.replace(/-/g," ")} dans l'équipe`;
  if (detail.relative_physical_stats === 1) return "ATT > DÉF";
  if (detail.relative_physical_stats === -1) return "DÉF > ATT";
  if (detail.relative_physical_stats === 0) return "ATT = DÉF";
  if (detail.needs_overworld_rain) return "Sous la pluie";
  if (detail.turn_upside_down) return "Retourner la console";
  const tname = detail.trigger?.name;
  if (tname) return ITEMS_FR[tname] || tname.replace(/-/g," ");
  return null;
}

async function fetchEvolutionChain(url) {
  try {
    const res = await fetch(url);
    const d = await res.json();
    const chain = [];
    const walk = async (node) => {
      const speciesId = parseInt(node.species.url.split("/").filter(Boolean).pop());
      const poke = await fetchPoke(speciesId);
      const detail = node.evolution_details?.[0];
      const trigger = translateTrigger(detail);
      chain.push({ poke, trigger });
      for (const next of (node.evolves_to || [])) await walk(next);
    };
    await walk(d.chain);
    return chain;
  } catch { return []; }
}

// ── ELO helpers ──────────────────────────────────────────────────────────────
function expectedScore(rA, rB) { return 1 / (1 + Math.pow(10, (rB - rA) / 400)); }
function updateElo(rA, rB, scoreA) {
  const ea = expectedScore(rA, rB);
  return [Math.round(rA + ELO_K*(scoreA-ea)), Math.round(rB + ELO_K*((1-scoreA)-(1-ea)))];
}

// ── Matchmaking ──────────────────────────────────────────────────────────────
function pickOpponents(elos, totalMatches, genFilter = 0) {
  const gen = genFilter > 0 ? GENERATIONS.find(g => g.id === genFilter) : null;
  const allIds = gen
    ? Array.from({ length: gen.range[1]-gen.range[0]+1 }, (_,i) => gen.range[0]+i)
    : Array.from({ length: 1025 }, (_,i) => i+1);
  if (allIds.length < 2) return null;
  // For gen-filtered mode, lower cold-start threshold
  const threshold = gen ? Math.min(10, Math.floor(allIds.length / 5)) : 20;
  if (totalMatches < threshold || Object.keys(elos).length < 5) {
    const a = allIds[Math.floor(Math.random()*allIds.length)];
    let b; do { b = allIds[Math.floor(Math.random()*allIds.length)]; } while (b===a);
    return [a,b];
  }
  if (Math.random() < 0.7) {
    const sorted = [...allIds].sort((a,b) => (elos[b]||INITIAL_ELO)-(elos[a]||INITIAL_ELO));
    const pivot = Math.floor(Math.random()*sorted.length);
    const a = sorted[pivot];
    const cands = sorted.slice(Math.max(0,pivot-20), pivot+21).filter(x=>x!==a);
    if (cands.length) return [a, cands[Math.floor(Math.random()*cands.length)]];
  }
  const a = allIds[Math.floor(Math.random()*allIds.length)];
  let b; do { b = allIds[Math.floor(Math.random()*allIds.length)]; } while (b===a);
  return [a,b];
}

// ── Export helpers ────────────────────────────────────────────────────────────

// Convert a remote image URL to base64 via a canvas (works cross-origin for PokeAPI sprites)
async function toBase64(url) {
  return new Promise(resolve => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      const c = document.createElement("canvas");
      c.width = img.naturalWidth; c.height = img.naturalHeight;
      c.getContext("2d").drawImage(img, 0, 0);
      try { resolve(c.toDataURL("image/png")); } catch { resolve(url); }
    };
    img.onerror = () => resolve("");
    img.src = url + (url.includes("?") ? "&" : "?") + "_cb=" + Date.now();
  });
}

// Preload all sprites as base64 so html2canvas doesn't hit CORS issues
async function preloadSprites(ids, pokeDataMap) {
  const b64 = {};
  await Promise.all(ids.map(async id => {
    const url = pokeDataMap[id]?.sprite;
    if (url) b64[id] = await toBase64(url);
  }));
  return b64;
}

function buildExportHTML(topPokes, pokeDataMap, eloMap, b64sprites, title, matches, isTop50) {
  const tc = id => TYPE_COLORS[pokeDataMap[id]?.types?.[0]] || TYPE_COLORS.normal;
  const name = id => pokeDataMap[id]?.name || `#${id}`;
  const typeFr = id => tc(id).fr || pokeDataMap[id]?.types?.[0] || "";
  const elo = id => eloMap[id] || INITIAL_ELO;
  const img = id => b64sprites[id] ? `<img src="${b64sprites[id]}" style="width:100%;height:100%;object-fit:contain;display:block;">` : "";

  // ── Podium card (top 3) ────────────────────────────────────────────────────
  const MEDALS = ["🥇","🥈","🥉"];
  const PODIUM_HEIGHTS = ["140px","110px","90px"];   // visual podium step heights
  const PODIUM_ORDER   = [1, 0, 2];                  // display order: 2nd | 1st | 3rd
  const PODIUM_SPRITE  = ["110px","130px","100px"];  // sprite size per slot (1st biggest)

  const podiumCard = (rank) => {
    const id = topPokes[rank];
    if (!id) return "";
    const c = tc(id);
    const spriteSize = PODIUM_SPRITE[rank];
    return `
      <div style="display:flex;flex-direction:column;align-items:center;gap:0;flex:1;max-width:160px;">
        <!-- sprite + info -->
        <div style="display:flex;flex-direction:column;align-items:center;gap:6px;padding-bottom:8px;">
          <div style="font-size:22px;line-height:1;">${MEDALS[rank]}</div>
          <div style="width:${spriteSize};height:${spriteSize};border-radius:16px;background:${c.light};display:flex;align-items:center;justify-content:center;overflow:hidden;">
            ${img(id)}
          </div>
          <div style="font-size:13px;font-weight:800;color:#1A1025;text-align:center;line-height:1.2;">${name(id)}</div>
          <div style="font-size:10px;font-weight:700;color:${c.bg};background:${c.light};border:1.5px solid ${c.bg};border-radius:12px;padding:2px 9px;">${typeFr(id)}</div>
          <div style="font-size:10px;color:#A89FC0;font-weight:600;">ELO ${elo(id)}</div>
        </div>
        <!-- podium step -->
        <div style="width:100%;height:${PODIUM_HEIGHTS[rank]};background:linear-gradient(160deg,${c.light},${c.bg}22);border-radius:8px 8px 0 0;border-top:3px solid ${c.bg};"></div>
      </div>`;
  };

  const podiumHTML = `
    <div style="display:flex;align-items:flex-end;justify-content:center;gap:8px;margin-bottom:20px;">
      ${PODIUM_ORDER.map(r => podiumCard(r)).join("")}
    </div>`;

  // ── List row ───────────────────────────────────────────────────────────────
  const listRow = (id, rank, small = false) => {
    const c = tc(id);
    const sz = small ? "36px" : "48px";
    const fs = small ? "12px" : "13px";
    return `
      <div style="display:flex;align-items:center;gap:12px;padding:${small?"6px 12px":"8px 14px"};border-radius:10px;background:${rank<=3?c.light+"55":"#FAFAF8"};border:1px solid ${rank<=3?c.bg+"30":"#F0EDF8"};margin-bottom:5px;">
        <div style="width:28px;text-align:center;font-size:${small?"11px":"13px"};font-weight:800;color:${rank<=3?c.bg:"#A89FC0"};flex-shrink:0;">${rank<=3?MEDALS[rank-1]:"#"+rank}</div>
        <div style="width:${sz};height:${sz};border-radius:8px;background:${c.light};flex-shrink:0;overflow:hidden;display:flex;align-items:center;justify-content:center;">
          ${img(id)}
        </div>
        <div style="flex:1;min-width:0;">
          <div style="font-size:${fs};font-weight:700;color:#1A1025;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${name(id)}</div>
          <div style="display:flex;gap:5px;margin-top:2px;align-items:center;">
            <span style="font-size:9px;font-weight:700;color:${c.bg};background:${c.light};border:1px solid ${c.bg};border-radius:9px;padding:1px 7px;">${typeFr(id)}</span>
            <span style="font-size:9px;color:#A89FC0;">Gen ${pokeDataMap[id]?.gen||"?"}</span>
          </div>
        </div>
        <div style="font-size:${small?"10px":"11px"};font-weight:700;color:${c.bg};flex-shrink:0;">ELO ${elo(id)}</div>
      </div>`;
  };

  // ── TOP 10 layout ──────────────────────────────────────────────────────────
  if (!isTop50) {
    const rest = topPokes.slice(3, 10);
    return `
      <div style="font-family:'Nunito',sans-serif;background:#F8F6FF;padding:28px;width:520px;box-sizing:border-box;">
        <div style="height:5px;background:linear-gradient(90deg,#6C4FDF,#FF5F8A);border-radius:3px;margin-bottom:20px;"></div>
        <div style="display:flex;align-items:center;gap:10px;margin-bottom:6px;">
          <div style="width:30px;height:30px;border-radius:8px;background:linear-gradient(135deg,#6C4FDF,#FF5F8A);display:flex;align-items:center;justify-content:center;font-size:16px;">⚡</div>
          <span style="font-size:20px;font-weight:900;color:#1A1025;">Poké<span style="color:#6C4FDF;">Rank</span> — ${title}</span>
        </div>
        <div style="font-size:11px;color:#A89FC0;margin-bottom:22px;">${matches} duels joués · ${new Date().toLocaleDateString("fr-FR")}</div>
        ${podiumHTML}
        <div style="font-size:10px;font-weight:800;color:#A89FC0;letter-spacing:0.08em;margin-bottom:8px;">SUITE DU CLASSEMENT</div>
        ${rest.map((id,i) => listRow(id, i+4, false)).join("")}
      </div>`;
  }

  // ── TOP 50 layout ──────────────────────────────────────────────────────────
  // Top 10 horizontal cards, then 40 in 2-column list
  const top10 = topPokes.slice(0, 10);
  const rest40 = topPokes.slice(10, 50);
  const half = Math.ceil(rest40.length / 2);
  const col1 = rest40.slice(0, half);
  const col2 = rest40.slice(half);

  const compactCard = (id, rank) => {
    const c = tc(id);
    const medal = rank <= 3 ? MEDALS[rank-1] : `#${rank}`;
    return `
      <div style="display:flex;flex-direction:column;align-items:center;gap:5px;background:#fff;border-radius:12px;border:1.5px solid ${rank<=3?c.bg+"60":"#E8E4F0"};padding:10px 8px;min-width:0;">
        <div style="font-size:11px;font-weight:800;color:${rank<=3?c.bg:"#A89FC0"};">${medal}</div>
        <div style="width:56px;height:56px;border-radius:10px;background:${c.light};overflow:hidden;display:flex;align-items:center;justify-content:center;">${img(id)}</div>
        <div style="font-size:10px;font-weight:700;color:#1A1025;text-align:center;line-height:1.2;max-width:72px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${name(id)}</div>
        <span style="font-size:9px;font-weight:700;color:${c.bg};background:${c.light};border:1px solid ${c.bg};border-radius:9px;padding:1px 6px;">${typeFr(id)}</span>
        <div style="font-size:9px;color:#A89FC0;">ELO ${elo(id)}</div>
      </div>`;
  };

  return `
    <div style="font-family:'Nunito',sans-serif;background:#F8F6FF;padding:28px;width:860px;box-sizing:border-box;">
      <div style="height:5px;background:linear-gradient(90deg,#6C4FDF,#FF5F8A);border-radius:3px;margin-bottom:20px;"></div>
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:6px;">
        <div style="width:30px;height:30px;border-radius:8px;background:linear-gradient(135deg,#6C4FDF,#FF5F8A);display:flex;align-items:center;justify-content:center;font-size:16px;">⚡</div>
        <span style="font-size:20px;font-weight:900;color:#1A1025;">Poké<span style="color:#6C4FDF;">Rank</span> — ${title}</span>
      </div>
      <div style="font-size:11px;color:#A89FC0;margin-bottom:22px;">${matches} duels joués · ${new Date().toLocaleDateString("fr-FR")}</div>

      <div style="font-size:10px;font-weight:800;color:#A89FC0;letter-spacing:0.08em;margin-bottom:10px;">TOP 10</div>
      <div style="display:grid;grid-template-columns:repeat(10,1fr);gap:7px;margin-bottom:24px;">
        ${top10.map((id,i) => compactCard(id, i+1)).join("")}
      </div>

      <div style="font-size:10px;font-weight:800;color:#A89FC0;letter-spacing:0.08em;margin-bottom:10px;">SUITE DU CLASSEMENT (#11 – #50)</div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:0 16px;">
        <div>${col1.map((id,i) => listRow(id, i+11, true)).join("")}</div>
        <div>${col2.map((id,i) => listRow(id, i+11+half, true)).join("")}</div>
      </div>
    </div>`;
}

async function exportRankingImage(topPokes, pokeDataMap, eloMap, title, matches) {
  const isTop50 = topPokes.length > 10;

  // Preload all sprites as base64
  const b64sprites = await preloadSprites(topPokes, pokeDataMap);

  const html = buildExportHTML(topPokes, pokeDataMap, eloMap, b64sprites, title, matches, isTop50);

  // Inject into a hidden off-screen div, capture with html2canvas
  const wrapper = document.createElement("div");
  wrapper.style.cssText = "position:fixed;left:-9999px;top:0;z-index:-1;";
  wrapper.innerHTML = `
    <link href="https://fonts.googleapis.com/css2?family=Nunito:wght@400;600;700;800;900&display=swap" rel="stylesheet">
    ${html}`;
  document.body.appendChild(wrapper);

  // Wait for fonts + images
  await new Promise(r => setTimeout(r, 800));

  const target = wrapper.querySelector("div[style*='font-family']");

  // Load html2canvas dynamically
  if (!window.html2canvas) {
    await new Promise((res, rej) => {
      const s = document.createElement("script");
      s.src = "https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js";
      s.onload = res; s.onerror = rej;
      document.head.appendChild(s);
    });
  }

  const canvas = await window.html2canvas(target, {
    scale: 2, useCORS: true, allowTaint: false,
    backgroundColor: "#F8F6FF", logging: false,
  });

  document.body.removeChild(wrapper);

  const link = document.createElement("a");
  link.download = `pokerank-${title.toLowerCase().replace(/[\s—]+/g, "-")}.png`;
  link.href = canvas.toDataURL("image/png");
  link.click();
}

// ── TypeBadge ────────────────────────────────────────────────────────────────
function TypeBadge({ type }) {
  const c = TYPE_COLORS[type] || TYPE_COLORS.normal;
  return (
    <span style={{ background:c.light, color:c.bg, border:`1.5px solid ${c.bg}`,
      borderRadius:20, padding:"2px 10px", fontSize:11, fontWeight:700,
      textTransform:"capitalize", letterSpacing:"0.04em" }}>
      {c.fr || type}
    </span>
  );
}

// ── StatBar ──────────────────────────────────────────────────────────────────
function StatBar({ name, value }) {
  const max = 255;
  const pct = (value/max)*100;
  const color = value>=100?"#3DB35E":value>=60?"#F7CE00":"#FF6B35";
  return (
    <div style={{ display:"flex", alignItems:"center", gap:10 }}>
      <div style={{ width:80, fontSize:11, color:"#A89FC0", fontWeight:600, textAlign:"right", flexShrink:0 }}>
        {STAT_LABELS[name]||name}
      </div>
      <div style={{ width:30, fontSize:12, fontWeight:700, color:"#1A1025", textAlign:"right", flexShrink:0 }}>{value}</div>
      <div style={{ flex:1, height:6, background:"#F0EDF8", borderRadius:3, overflow:"hidden" }}>
        <div style={{ height:"100%", width:`${pct}%`, background:color, borderRadius:3, transition:"width 0.6s" }} />
      </div>
    </div>
  );
}

// ── Pokemon Detail Panel ─────────────────────────────────────────────────────
function PokePanel({ poke, onClose }) {
  const [detail, setDetail] = useState(null);
  const [evoChain, setEvoChain] = useState(null);
  const [loadingEvo, setLoadingEvo] = useState(false);
  const tc = TYPE_COLORS[poke.types?.[0]] || TYPE_COLORS.normal;

  useEffect(() => {
    fetchSpeciesDetail(poke.speciesUrl).then(async (d) => {
      setDetail(d);
      if (d.evolutionUrl) {
        setLoadingEvo(true);
        const chain = await fetchEvolutionChain(d.evolutionUrl);
        setEvoChain(chain);
        setLoadingEvo(false);
      }
    });
  }, [poke.id]);

  return (
    <>
      {/* Overlay */}
      <div onClick={onClose} style={{ position:"fixed", inset:0, background:"rgba(26,16,37,0.4)", zIndex:200,
        animation:"fadeInOverlay 0.2s ease" }} />
      {/* Panel */}
      <div style={{
        position:"fixed", top:0, right:0, bottom:0, width:"min(420px, 100vw)",
        background:"#fff", zIndex:201, overflowY:"auto",
        boxShadow:"-8px 0 40px rgba(108,79,223,0.15)",
        animation:"slideIn 0.28s cubic-bezier(0.4,0,0.2,1)",
      }}>
        {/* Header bg */}
        <div style={{ background:`linear-gradient(160deg, ${tc.light} 0%, #fff 100%)`, padding:"28px 24px 20px", position:"relative" }}>
          <button onClick={onClose} style={{
            position:"absolute", top:16, right:16, background:"rgba(255,255,255,0.8)",
            border:"none", borderRadius:10, width:32, height:32, cursor:"pointer",
            fontSize:16, display:"flex", alignItems:"center", justifyContent:"center",
          }}>✕</button>
          <div style={{ display:"flex", alignItems:"flex-end", gap:16 }}>
            <img src={poke.sprite} alt={poke.name}
              style={{ width:120, height:120, objectFit:"contain", filter:`drop-shadow(0 4px 16px ${tc.bg}40)` }} />
            <div>
              <div style={{ fontSize:12, color:"#A89FC0", fontWeight:600, marginBottom:4 }}>
                #{String(poke.id).padStart(4,"0")} · {detail?.category||""}
              </div>
              <div style={{ fontSize:26, fontWeight:900, color:"#1A1025", lineHeight:1.1 }}>{poke.name}</div>
              <div style={{ fontSize:11, color:"#A89FC0", marginBottom:8 }}>Génération {poke.gen}</div>
              <div style={{ display:"flex", gap:6, flexWrap:"wrap" }}>
                {poke.types.map(t => <TypeBadge key={t} type={t} />)}
              </div>
            </div>
          </div>
        </div>

        <div style={{ padding:"0 24px 32px", display:"flex", flexDirection:"column", gap:24 }}>
          {/* Description */}
          {detail?.desc && (
            <div style={{ padding:"14px 16px", background:"#F8F6FF", borderRadius:12, fontSize:13, color:"#4A3F6B", lineHeight:1.7, fontStyle:"italic" }}>
              "{detail.desc}"
            </div>
          )}

          {/* Physical */}
          <div>
            <div style={{ fontSize:12, fontWeight:800, color:"#A89FC0", letterSpacing:"0.08em", marginBottom:10 }}>MORPHOLOGIE</div>
            <div style={{ display:"flex", gap:12 }}>
              <div style={{ flex:1, background:"#F8F6FF", borderRadius:12, padding:"12px 16px", textAlign:"center" }}>
                <div style={{ fontSize:20, fontWeight:800, color:"#1A1025" }}>{(poke.height/10).toFixed(1)} m</div>
                <div style={{ fontSize:11, color:"#A89FC0", marginTop:2 }}>Taille</div>
              </div>
              <div style={{ flex:1, background:"#F8F6FF", borderRadius:12, padding:"12px 16px", textAlign:"center" }}>
                <div style={{ fontSize:20, fontWeight:800, color:"#1A1025" }}>{(poke.weight/10).toFixed(1)} kg</div>
                <div style={{ fontSize:11, color:"#A89FC0", marginTop:2 }}>Poids</div>
              </div>
              {detail?.captureRate != null && (
                <div style={{ flex:1, background:"#F8F6FF", borderRadius:12, padding:"12px 16px", textAlign:"center" }}>
                  <div style={{ fontSize:20, fontWeight:800, color:"#1A1025" }}>{detail.captureRate}</div>
                  <div style={{ fontSize:11, color:"#A89FC0", marginTop:2 }}>Capture</div>
                </div>
              )}
            </div>
          </div>

          {/* Matchups */}
          {(() => {
            const { multipliers, weaknesses, resistances, immunities } = computeMatchups(poke.types);
            return (
              <div style={{ display:"flex", flexDirection:"column", gap:14 }}>
                {weaknesses.length > 0 && (
                  <div>
                    <div style={{ fontSize:12, fontWeight:800, color:"#A89FC0", letterSpacing:"0.08em", marginBottom:8 }}>
                      FAIBLESSES
                    </div>
                    <div style={{ display:"flex", flexWrap:"wrap", gap:6 }}>
                      {weaknesses.map(t => {
                        const c = TYPE_COLORS[t] || TYPE_COLORS.normal;
                        const mult = multipliers[t];
                        return (
                          <div key={t} style={{ display:"flex", alignItems:"center", gap:4,
                            background:c.light, border:`1.5px solid ${c.bg}`,
                            borderRadius:20, padding:"3px 10px 3px 8px" }}>
                            <span style={{ fontSize:11, fontWeight:700, color:c.bg, textTransform:"capitalize" }}>
                              {c.fr || t}
                            </span>
                            <span style={{ fontSize:10, fontWeight:800, color:"#fff",
                              background:c.bg, borderRadius:10, padding:"1px 5px", lineHeight:1.4 }}>
                              ×{mult}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
                {resistances.length > 0 && (
                  <div>
                    <div style={{ fontSize:12, fontWeight:800, color:"#A89FC0", letterSpacing:"0.08em", marginBottom:8 }}>
                      RÉSISTANCES
                    </div>
                    <div style={{ display:"flex", flexWrap:"wrap", gap:6 }}>
                      {resistances.map(t => {
                        const c = TYPE_COLORS[t] || TYPE_COLORS.normal;
                        const mult = multipliers[t];
                        return (
                          <div key={t} style={{ display:"flex", alignItems:"center", gap:4,
                            background:"#F8F6FF", border:"1.5px solid #E8E4F0",
                            borderRadius:20, padding:"3px 10px 3px 8px" }}>
                            <span style={{ fontSize:11, fontWeight:700, color:c.bg, textTransform:"capitalize" }}>
                              {c.fr || t}
                            </span>
                            <span style={{ fontSize:10, fontWeight:800, color:"#6C4FDF",
                              background:"#EDE8FF", borderRadius:10, padding:"1px 5px", lineHeight:1.4 }}>
                              ×{mult}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
                {immunities.length > 0 && (
                  <div>
                    <div style={{ fontSize:12, fontWeight:800, color:"#A89FC0", letterSpacing:"0.08em", marginBottom:8 }}>
                      IMMUNITÉS
                    </div>
                    <div style={{ display:"flex", flexWrap:"wrap", gap:6 }}>
                      {immunities.map(t => {
                        const c = TYPE_COLORS[t] || TYPE_COLORS.normal;
                        return (
                          <div key={t} style={{ display:"flex", alignItems:"center", gap:4,
                            background:"#F0F0F0", border:"1.5px solid #D8D8D8",
                            borderRadius:20, padding:"3px 10px 3px 8px" }}>
                            <span style={{ fontSize:11, fontWeight:700, color:"#888", textTransform:"capitalize" }}>
                              {c.fr || t}
                            </span>
                            <span style={{ fontSize:10, fontWeight:800, color:"#888",
                              background:"#E0E0E0", borderRadius:10, padding:"1px 5px", lineHeight:1.4 }}>
                              ×0
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            );
          })()}

          {/* Evolution chain */}
          <div>
            <div style={{ fontSize:12, fontWeight:800, color:"#A89FC0", letterSpacing:"0.08em", marginBottom:10 }}>ÉVOLUTIONS</div>
            {loadingEvo && <div style={{ color:"#A89FC0", fontSize:13 }}>Chargement…</div>}
            {!loadingEvo && evoChain && evoChain.length <= 1 && (
              <div style={{ color:"#A89FC0", fontSize:13, fontStyle:"italic" }}>Pas d'évolution connue.</div>
            )}
            {!loadingEvo && evoChain && evoChain.length > 1 && (
              <div style={{ display:"flex", alignItems:"center", gap:8, flexWrap:"wrap" }}>
                {evoChain.map((entry, i) => (
                  <div key={entry.poke?.id||i} style={{ display:"flex", alignItems:"center", gap:8 }}>
                    {i > 0 && (
                      <div style={{ display:"flex", flexDirection:"column", alignItems:"center", gap:2 }}>
                        <div style={{ fontSize:16, color:"#C0B8D8" }}>→</div>
                        {entry.trigger && (
                          <div style={{ fontSize:9, color:"#A89FC0", fontWeight:600, textAlign:"center",
                            maxWidth:56, lineHeight:1.2, textTransform:"capitalize" }}>
                            {entry.trigger}
                          </div>
                        )}
                      </div>
                    )}
                    <div style={{ display:"flex", flexDirection:"column", alignItems:"center", gap:4,
                      padding:"8px", borderRadius:12,
                      background: entry.poke?.id===poke.id ? tc.light : "#F8F6FF",
                      border: entry.poke?.id===poke.id ? `2px solid ${tc.bg}` : "1.5px solid #F0EDF8",
                    }}>
                      {entry.poke?.sprite && (
                        <img src={entry.poke.sprite} alt={entry.poke.name}
                          style={{ width:52, height:52, objectFit:"contain" }} />
                      )}
                      <div style={{ fontSize:11, fontWeight:700, color:"#1A1025", textAlign:"center" }}>
                        {entry.poke?.name||"?"}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
      <style>{`
        @keyframes slideIn { from { transform:translateX(100%); } to { transform:translateX(0); } }
        @keyframes fadeInOverlay { from { opacity:0; } to { opacity:1; } }
      `}</style>
    </>
  );
}

// ── Reset modal ──────────────────────────────────────────────────────────────
function ResetModal({ onConfirm, onCancel, matchCount }) {
  return (
    <div style={{ position:"fixed", inset:0, zIndex:500, background:"rgba(26,16,37,0.55)",
      display:"flex", alignItems:"center", justifyContent:"center" }}>
      <div style={{ background:"#fff", borderRadius:20, padding:"36px 32px", maxWidth:380, width:"90%",
        boxShadow:"0 24px 80px rgba(108,79,223,0.18)", textAlign:"center" }}>
        <div style={{ fontSize:40, marginBottom:12 }}>⚠️</div>
        <div style={{ fontSize:19, fontWeight:800, color:"#1A1025", marginBottom:8 }}>Réinitialiser le classement ?</div>
        <div style={{ fontSize:14, color:"#A89FC0", lineHeight:1.6, marginBottom:28 }}>
          Tu vas perdre <strong style={{ color:"#FF5F8A" }}>{matchCount} duels</strong> et tous les scores ELO. Irréversible.
        </div>
        <div style={{ display:"flex", gap:10 }}>
          <button onClick={onCancel} style={{ flex:1, padding:"12px", borderRadius:12, border:"1.5px solid #E8E4F0",
            background:"#F8F6FF", fontSize:14, fontWeight:700, color:"#6C4FDF", cursor:"pointer" }}>Annuler</button>
          <button onClick={onConfirm} style={{ flex:1, padding:"12px", borderRadius:12, border:"none",
            background:"linear-gradient(135deg,#FF5F8A,#C94D27)", fontSize:14, fontWeight:700, color:"#fff", cursor:"pointer" }}>
            Tout effacer
          </button>
        </div>
      </div>
    </div>
  );
}

// ── WELCOME / PROFILE SCREEN ─────────────────────────────────────────────────
function WelcomeScreen({ onLogin }) {
  const [profiles, setProfiles] = useState(() => loadProfiles());
  const [newName, setNewName] = useState("");
  const [error, setError] = useState("");
  const [creating, setCreating] = useState(Object.keys(loadProfiles()).length === 0);

  const create = () => {
    const name = newName.trim();
    if (!name) { setError("Entre un nom !"); return; }
    if (Object.values(profiles).some(p => p.name.toLowerCase() === name.toLowerCase())) {
      setError("Ce nom est déjà pris."); return;
    }
    const id = `profile_${Date.now()}`;
    const updated = { ...profiles, [id]: { id, name, data: emptyData(), createdAt: Date.now() } };
    saveProfiles(updated);
    setProfiles(updated);
    saveActiveId(id);
    onLogin(updated[id]);
  };

  const login = (profile) => { saveActiveId(profile.id); onLogin(profile); };

  const deleteProfile = (e, id) => {
    e.stopPropagation();
    if (!window.confirm(`Supprimer le profil "${profiles[id].name}" ? Toutes les données seront perdues.`)) return;
    const updated = { ...profiles };
    delete updated[id];
    saveProfiles(updated);
    setProfiles(updated);
    if (Object.keys(updated).length === 0) setCreating(true);
  };

  const profileList = Object.values(profiles).sort((a,b) => b.createdAt - a.createdAt);

  return (
    <div style={{ minHeight:"100vh", background:"#F8F6FF",
      display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", padding:24 }}>

      {/* Logo */}
      <div style={{ textAlign:"center", marginBottom:40 }}>
        <div style={{ width:72, height:72, borderRadius:20,
          background:"linear-gradient(135deg,#6C4FDF,#FF5F8A)",
          display:"flex", alignItems:"center", justifyContent:"center",
          fontSize:36, margin:"0 auto 16px",
          boxShadow:"0 12px 40px rgba(108,79,223,0.3)" }}>⚡</div>
        <div style={{ fontSize:38, fontWeight:900, color:"#1A1025", letterSpacing:"-0.03em" }}>
          Poké<span style={{ color:"#6C4FDF" }}>Rank</span>
        </div>
        <div style={{ fontSize:14, color:"#A89FC0", marginTop:6 }}>Classe tes Pokémon préférés</div>
      </div>

      <div style={{ width:"100%", maxWidth:400 }}>
        {/* Existing profiles */}
        {profileList.length > 0 && !creating && (
          <div style={{ marginBottom:24 }}>
            <div style={{ fontSize:12, fontWeight:800, color:"#A89FC0", letterSpacing:"0.08em", marginBottom:12 }}>
              CHOISIR UN PROFIL
            </div>
            <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
              {profileList.map(p => (
                <div key={p.id} onClick={() => login(p)}
                  style={{ display:"flex", alignItems:"center", gap:14, padding:"14px 18px",
                    borderRadius:14, background:"#fff", border:"1.5px solid #E8E4F0",
                    cursor:"pointer", transition:"all 0.15s",
                    boxShadow:"0 2px 8px rgba(0,0,0,0.04)" }}
                  onMouseEnter={e=>{ e.currentTarget.style.borderColor="#6C4FDF"; e.currentTarget.style.transform="translateY(-2px)"; }}
                  onMouseLeave={e=>{ e.currentTarget.style.borderColor="#E8E4F0"; e.currentTarget.style.transform="none"; }}>
                  <div style={{ width:40, height:40, borderRadius:12,
                    background:"linear-gradient(135deg,#6C4FDF22,#FF5F8A22)",
                    display:"flex", alignItems:"center", justifyContent:"center",
                    fontSize:18, fontWeight:800, color:"#6C4FDF" }}>
                    {p.name.charAt(0).toUpperCase()}
                  </div>
                  <div style={{ flex:1 }}>
                    <div style={{ fontSize:15, fontWeight:700, color:"#1A1025" }}>{p.name}</div>
                    <div style={{ fontSize:11, color:"#A89FC0" }}>
                      {p.data?.matches||0} duels · {Object.keys(p.data?.elos||{}).length} Pokémon classés
                    </div>
                  </div>
                  <button onClick={(e)=>deleteProfile(e,p.id)} title="Supprimer"
                    style={{ background:"none", border:"none", cursor:"pointer", color:"#E8E4F0",
                      fontSize:16, padding:4, borderRadius:6, transition:"color 0.15s" }}
                    onMouseEnter={e=>e.currentTarget.style.color="#FF5F8A"}
                    onMouseLeave={e=>e.currentTarget.style.color="#E8E4F0"}>✕</button>
                </div>
              ))}
            </div>
            <button onClick={() => setCreating(true)}
              style={{ width:"100%", marginTop:12, padding:"11px", borderRadius:12,
                border:"1.5px dashed #C9C0E8", background:"transparent",
                fontSize:13, fontWeight:700, color:"#6C4FDF", cursor:"pointer" }}>
              + Nouveau profil
            </button>
          </div>
        )}

        {/* Create form */}
        {creating && (
          <div style={{ background:"#fff", borderRadius:16, padding:"24px", border:"1.5px solid #E8E4F0",
            boxShadow:"0 4px 20px rgba(108,79,223,0.08)" }}>
            <div style={{ fontSize:16, fontWeight:800, color:"#1A1025", marginBottom:16 }}>
              {profileList.length === 0 ? "Créer ton profil" : "Nouveau profil"}
            </div>
            <input
              autoFocus
              placeholder="Ton pseudo…"
              value={newName}
              onChange={e => { setNewName(e.target.value); setError(""); }}
              onKeyDown={e => e.key==="Enter" && create()}
              style={{ width:"100%", padding:"12px 14px", borderRadius:10,
                border:`1.5px solid ${error?"#FF5F8A":"#E8E4F0"}`,
                fontSize:15, outline:"none", boxSizing:"border-box", marginBottom:error?6:12 }}
            />
            {error && <div style={{ fontSize:12, color:"#FF5F8A", marginBottom:10 }}>{error}</div>}
            <button onClick={create} style={{
              width:"100%", padding:"13px", borderRadius:12, border:"none",
              background:"linear-gradient(135deg,#6C4FDF,#FF5F8A)",
              fontSize:15, fontWeight:800, color:"#fff", cursor:"pointer",
            }}>Commencer !</button>
            {profileList.length > 0 && (
              <button onClick={() => { setCreating(false); setNewName(""); setError(""); }}
                style={{ width:"100%", marginTop:8, padding:"10px", borderRadius:12,
                  border:"none", background:"none", fontSize:13, color:"#A89FC0", cursor:"pointer" }}>
                Retour
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ── POKEDEX VIEW ─────────────────────────────────────────────────────────────
function PokedexView() {
  const [genFilter, setGenFilter] = useState(1);
  const [pokes, setPokes] = useState([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState(null);

  useEffect(() => {
    const gen = GENERATIONS.find(g => g.id === genFilter);
    if (!gen) return;
    setLoading(true);
    const [start,end] = gen.range;
    const ids = Array.from({ length:end-start+1 }, (_,i) => start+i);
    let loaded = [];
    setPokes([]);
    const run = async () => {
      for (let i=0; i<ids.length; i+=20) {
        const results = await Promise.all(ids.slice(i,i+20).map(id => fetchPoke(id)));
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
    <div style={{ padding:"24px" }}>
      {selected && <PokePanel poke={selected} onClose={() => setSelected(null)} />}

      <div style={{ display:"flex", gap:12, flexWrap:"wrap", marginBottom:20, alignItems:"center" }}>
        <div style={{ display:"flex", gap:6, flexWrap:"wrap", flex:1 }}>
          {GENERATIONS.map(g => (
            <button key={g.id} onClick={() => setGenFilter(g.id)} style={{
              padding:"6px 14px", borderRadius:20,
              border:genFilter===g.id?"2px solid #6C4FDF":"1.5px solid #E8E4F0",
              background:genFilter===g.id?"#6C4FDF":"#fff",
              color:genFilter===g.id?"#fff":"#6C4FDF",
              fontSize:12, fontWeight:600, cursor:"pointer", transition:"all 0.15s",
            }}>{g.name}</button>
          ))}
        </div>
        <input placeholder="Rechercher…" value={search} onChange={e=>setSearch(e.target.value)}
          style={{ padding:"8px 14px", borderRadius:12, border:"1.5px solid #E8E4F0",
            fontSize:13, outline:"none", width:160 }} />
      </div>

      <div style={{ fontSize:13, color:"#A89FC0", marginBottom:16 }}>
        {loading ? `Chargement… (${pokes.length} chargés)` : `${filtered.length} Pokémon`}
        {!loading && <span style={{ marginLeft:8, fontSize:12 }}>· Clique sur un Pokémon pour sa fiche</span>}
      </div>

      <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill, minmax(130px, 1fr))", gap:12 }}>
        {filtered.map(poke => {
          const tc = TYPE_COLORS[poke.types[0]] || TYPE_COLORS.normal;
          return (
            <div key={poke.id} onClick={() => setSelected(poke)}
              style={{ borderRadius:16, border:"1.5px solid #F0EDF8", background:"#fff",
                padding:"12px 8px", display:"flex", flexDirection:"column", alignItems:"center", gap:6,
                cursor:"pointer", transition:"all 0.15s" }}
              onMouseEnter={e=>{ e.currentTarget.style.borderColor=tc.bg; e.currentTarget.style.transform="translateY(-3px)"; e.currentTarget.style.boxShadow=`0 8px 24px ${tc.bg}25`; }}
              onMouseLeave={e=>{ e.currentTarget.style.borderColor="#F0EDF8"; e.currentTarget.style.transform="none"; e.currentTarget.style.boxShadow="none"; }}>
              <div style={{ width:80, height:80, borderRadius:12, background:tc.light,
                display:"flex", alignItems:"center", justifyContent:"center" }}>
                {poke.sprite
                  ? <img src={poke.sprite} alt={poke.name} style={{ width:64, height:64, objectFit:"contain" }} />
                  : <div style={{ width:40, height:40, borderRadius:8, background:"#E8E4F0" }} />}
              </div>
              <div style={{ fontSize:10, color:"#C0B8D8", fontWeight:600 }}>#{String(poke.id).padStart(4,"0")}</div>
              <div style={{ fontSize:12, fontWeight:700, color:"#1A1025", textAlign:"center", lineHeight:1.3 }}>{poke.name}</div>
              <div style={{ display:"flex", gap:4, flexWrap:"wrap", justifyContent:"center" }}>
                {poke.types.map(t => <TypeBadge key={t} type={t} />)}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── useLayout hook ────────────────────────────────────────────────────────────
function useLayout() {
  const [layout, setLayout] = useState(() => {
    const w = window.innerWidth, h = window.innerHeight;
    return { mobile: w < 768, portrait: h > w };
  });
  useEffect(() => {
    const update = () => {
      const w = window.innerWidth, h = window.innerHeight;
      setLayout({ mobile: w < 768, portrait: h > w });
    };
    window.addEventListener("resize", update);
    window.addEventListener("orientationchange", update);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("orientationchange", update);
    };
  }, []);
  return layout;
}

// ── TINDER VIEW ──────────────────────────────────────────────────────────────
function TinderView({ data, setData }) {
  const [left, setLeft] = useState(null);
  const [right, setRight] = useState(null);
  const [loading, setLoading] = useState(true);
  const [swipeAnim, setSwipeAnim] = useState(null);
  const [swipeLabel, setSwipeLabel] = useState(null);
  const [undoStack, setUndoStack] = useState([]);
  const [undoFlash, setUndoFlash] = useState(false);
  const [genFilter, setGenFilter] = useState(0);
  const touchStart = useRef(null);
  const containerRef = useRef(null);
  const { mobile, portrait } = useLayout();
  const isVertical = mobile && portrait;

  const loadPair = useCallback(async (d, gen) => {
    setLoading(true);
    const pair = pickOpponents(d.elos, d.matches, gen);
    if (!pair) { setLoading(false); return; }
    const [p1,p2] = await Promise.all([fetchPoke(pair[0]), fetchPoke(pair[1])]);
    setLeft(p1); setRight(p2); setLoading(false);
  }, []);

  useEffect(() => { loadPair(data, genFilter); }, [genFilter]);

  const vote = useCallback(async (winner) => {
    if (!left || !right || swipeAnim) return;
    const dir = winner==="left"?"left":winner==="right"?"right":"up";
    const label = winner==="left"?`${left.name} gagne !`
                : winner==="right"?`${right.name} gagne !`:"Égalité !";
    setSwipeAnim(dir); setSwipeLabel(label);
    const snapshot = { left, right, prevData: data };
    const newElos = { ...data.elos };
    const eloL = newElos[left.id]||INITIAL_ELO, eloR = newElos[right.id]||INITIAL_ELO;
    const scoreL = winner==="left"?1:winner==="right"?0:0.5;
    const [nL,nR] = updateElo(eloL,eloR,scoreL);
    newElos[left.id]=nL; newElos[right.id]=nR;
    const newData = {
      ...data, elos:newElos, matches:data.matches+1,
      history:[{l:left.id,r:right.id,w:winner,ts:Date.now()},...data.history.slice(0,499)]
    };
    setData(newData);
    setUndoStack(prev => [...prev.slice(-19), snapshot]);
    setTimeout(async () => { setSwipeAnim(null); setSwipeLabel(null); await loadPair(newData, genFilter); }, 400);
  }, [left,right,data,swipeAnim,loadPair,setData,genFilter]);

  const undo = useCallback(() => {
    if (undoStack.length===0||swipeAnim) return;
    const last = undoStack[undoStack.length-1];
    setUndoStack(prev=>prev.slice(0,-1));
    setData(last.prevData);
    setLeft(last.left); setRight(last.right);
    setSwipeLabel(null);
    setUndoFlash(true);
    setTimeout(()=>setUndoFlash(false), 600);
  }, [undoStack,swipeAnim,setData]);

  useEffect(() => {
    const h = e => {
      if (e.key==="ArrowLeft")       vote("left");
      else if (e.key==="ArrowRight") vote("right");
      else if (e.key==="ArrowUp")    vote("draw");
      else if (e.key==="ArrowDown")  undo();
    };
    window.addEventListener("keydown",h);
    return ()=>window.removeEventListener("keydown",h);
  }, [vote,undo]);

  // Count matches for current gen filter only
  const genMatchCount = genFilter === 0
    ? data.matches
    : data.history.filter(h => {
        const gen = GENERATIONS.find(g => h.l >= g.range[0] && h.l <= g.range[1]);
        return gen?.id === genFilter;
      }).length;

  // Phase thresholds scale with pool size (fewer pokemon = faster calibration)
  const poolSize = genFilter === 0 ? 1025
    : (() => { const g = GENERATIONS.find(g => g.id === genFilter); return g ? g.range[1]-g.range[0]+1 : 1025; })();
  const t1 = Math.round(poolSize * 0.05);   // Découverte
  const t2 = Math.round(poolSize * 0.15);   // Calibrage
  const t3 = Math.round(poolSize * 0.35);   // Affinage
  const t4 = Math.round(poolSize * 0.70);   // Précision
  const phase =
    genMatchCount < t1 ? "Découverte" :
    genMatchCount < t2 ? "Calibrage"  :
    genMatchCount < t3 ? "Affinage"   :
    genMatchCount < t4 ? "Précision"  : "Maître";

  const phasebar = (
    <div style={{ display:"flex", alignItems:"center", gap:12 }}>
      <div style={{ fontSize:12, color:"#A89FC0", fontWeight:500 }}>
        {genMatchCount} duels{genFilter > 0 ? ` Gen ${genFilter}` : ""} · <span style={{ color:"#6C4FDF", fontWeight:700 }}>{phase}</span>
      </div>
      <div style={{ width:80, height:4, background:"#F0EDF8", borderRadius:4, overflow:"hidden" }}>
        <div style={{ height:"100%", width:`${Math.min(100,(genMatchCount/t4)*100)}%`,
          background:"linear-gradient(90deg,#6C4FDF,#FF5F8A)", borderRadius:4 }} />
      </div>
    </div>
  );

  const getSwipeStyle = (side) => {
    if (!swipeAnim) return {};
    if (swipeAnim==="up") return { transform:"translateY(-140%)", opacity:0, transition:"all 0.35s cubic-bezier(0.4,0,0.6,1)" };
    if (swipeAnim==="left"  && side==="left")  return { transform:"translateX(-140%) rotate(-15deg)", opacity:0, transition:"all 0.35s cubic-bezier(0.4,0,0.6,1)" };
    if (swipeAnim==="right" && side==="right") return { transform:"translateX(140%) rotate(15deg)",  opacity:0, transition:"all 0.35s cubic-bezier(0.4,0,0.6,1)" };
    return {};
  };

  const cardW   = isVertical ? Math.min(window.innerWidth-48, 320) : mobile ? 160 : 240;
  const spriteS = isVertical ? 110 : mobile ? 80 : 150;

  const DuelCard = ({ poke, side }) => {
    const tc = poke?(TYPE_COLORS[poke.types?.[0]]||TYPE_COLORS.normal):TYPE_COLORS.normal;
    return (
      <div style={{ display:"flex", flexDirection:"column", alignItems:"center", gap:6 }}>
        <div onClick={()=>vote(side)} style={{
          width:cardW, background:"#fff", borderRadius:20,
          border:"2.5px solid #E8E4F0", padding:mobile?"12px 10px 16px":"20px 16px 24px",
          cursor:"pointer", transition:"border-color 0.2s,box-shadow 0.2s",
          boxShadow:"0 4px 20px rgba(0,0,0,0.08)", display:"flex", flexDirection:"column",
          alignItems:"center", gap:mobile?7:12, userSelect:"none",
          ...getSwipeStyle(side) }}
          onMouseEnter={e=>{ e.currentTarget.style.borderColor=tc.bg; e.currentTarget.style.boxShadow=`0 16px 48px ${tc.bg}30`; }}
          onMouseLeave={e=>{ e.currentTarget.style.borderColor="#E8E4F0"; e.currentTarget.style.boxShadow="0 4px 20px rgba(0,0,0,0.08)"; }}>
          <div style={{ width:spriteS, height:spriteS, borderRadius:16, background:tc.light,
            display:"flex", alignItems:"center", justifyContent:"center", overflow:"hidden" }}>
            {poke?.sprite
              ? <img src={poke.sprite} alt={poke.name} style={{ width:"85%", height:"85%", objectFit:"contain" }} />
              : <div style={{ fontSize:32, color:"#ccc" }}>?</div>}
          </div>
          <div style={{ fontSize:10, color:"#A89FC0", fontWeight:600 }}>#{String(poke?.id||"").padStart(4,"0")}</div>
          <div style={{ fontSize:mobile?14:20, fontWeight:700, color:"#1A1025", textAlign:"center", lineHeight:1.2 }}>
            {poke?.name||"…"}
          </div>
          <div style={{ display:"flex", gap:5, flexWrap:"wrap", justifyContent:"center" }}>
            {poke?.types?.map(t=><TypeBadge key={t} type={t} />)}
          </div>
          <div style={{ fontSize:10, color:"#A89FC0", fontWeight:500 }}>Gen {poke?.gen}</div>
        </div>
      </div>
    );
  };

  // Gen selector bar
  const genSelector = (
    <div style={{ display:"flex", gap:6, flexWrap:"wrap", justifyContent:"center" }}>
      {[0,...GENERATIONS.map(g=>g.id)].map(g=>(
        <button key={g} onClick={()=>setGenFilter(g)} style={{
          padding:"5px 12px", borderRadius:20, fontSize:11, fontWeight:700, cursor:"pointer",
          border: genFilter===g ? "2px solid #6C4FDF" : "1.5px solid #E8E4F0",
          background: genFilter===g ? "#6C4FDF" : "#fff",
          color: genFilter===g ? "#fff" : "#6C4FDF",
          transition:"all 0.15s" }}>
          {g===0 ? "Tous" : `Gen ${g}`}
        </button>
      ))}
    </div>
  );

  const statusLabel = (
    <div style={{ height:20, textAlign:"center" }}>
      {undoFlash
        ? <span style={{ fontSize:13, fontWeight:700, color:"#F7CE00" }}>↩ Duel annulé</span>
        : swipeLabel
          ? <span style={{ fontSize:14, fontWeight:700, color:"#6C4FDF" }}>{swipeLabel}</span>
          : null}
    </div>
  );

  const undoBtn = (compact) => (
    <button onClick={undo} disabled={undoStack.length===0} style={{
      background: undoStack.length===0?"#FAFAF8":"#FFFBEC",
      border:`1.5px solid ${undoStack.length===0?"#F0EDF8":"#F7CE0080"}`,
      borderRadius:12, padding: compact?"8px 10px":"10px 18px",
      cursor: undoStack.length===0?"default":"pointer",
      fontSize: compact?11:12, fontWeight:700,
      color: undoStack.length===0?"#D0C8E8":"#B8960A",
      opacity: undoStack.length===0?0.5:1 }}>
      ↩ Annuler
    </button>
  );
  const drawBtn = (compact) => (
    <button onClick={()=>vote("draw")} style={{
      background:"#F5F3FF", border:"1.5px solid #C9C0E8", borderRadius:12,
      padding: compact?"8px 10px":"10px 18px",
      cursor:"pointer", fontSize: compact?11:12, fontWeight:700, color:"#6C4FDF" }}>
      ↑ Hésit.
    </button>
  );

  const commonStyle = { userSelect:"none", WebkitUserSelect:"none" };

  // ── PORTRAIT MOBILE ───────────────────────────────────────────────────────
  if (isVertical) {
    return (
      <div ref={containerRef}
        style={{ ...commonStyle, display:"flex", flexDirection:"column",
          alignItems:"center", padding:"10px 16px 16px", gap:8,
          minHeight:"calc(100dvh - 116px)" }}>
        {genSelector}
        {phasebar}
        {statusLabel}
        {loading ? (
          <>
            <div style={{ width:cardW, height:170, borderRadius:20, background:"#F5F3FF", animation:"pulse 1.2s infinite" }} />
            <div style={{ width:cardW, height:170, borderRadius:20, background:"#F5F3FF", animation:"pulse 1.2s infinite" }} />
          </>
        ) : (
          <>
            <DuelCard poke={left}  side="left" />
            <div style={{ display:"flex", alignItems:"center", gap:8 }}>
              <div style={{ width:30, height:1, background:"#E8E4F0" }} />
              <span style={{ fontSize:14, fontWeight:800, color:"#D0C8E8" }}>VS</span>
              <div style={{ width:30, height:1, background:"#E8E4F0" }} />
            </div>
            <DuelCard poke={right} side="right" />
          </>
        )}
        <div style={{ display:"flex", gap:10, marginTop:4 }}>
          {undoBtn(false)}
          {drawBtn(false)}
        </div>
        <div style={{ fontSize:11, color:"#C0B8D8", textAlign:"center" }}>
          Boutons ou touches ← → ↑ ↓
        </div>
        <style>{`@keyframes pulse{0%,100%{opacity:1}50%{opacity:0.5}}`}</style>
      </div>
    );
  }

  // ── LANDSCAPE / DESKTOP ───────────────────────────────────────────────────
  return (
    <div ref={containerRef}
      style={{ ...commonStyle, display:"flex", flexDirection:"column",
        alignItems:"center", padding: mobile?"12px 6px":"32px 20px",
        gap: mobile?10:20, minHeight: mobile?"calc(100dvh - 110px)":500 }}>
      {genSelector}
      {phasebar}
      {statusLabel}
      {loading ? (
        <div style={{ display:"flex", gap: mobile?10:32, alignItems:"center" }}>
          {[0,1].map(i=><div key={i} style={{ width:cardW, height:mobile?200:320, borderRadius:20, background:"#F5F3FF", animation:"pulse 1.2s infinite" }} />)}
        </div>
      ) : (
        <div style={{ display:"flex", gap: mobile?10:32, alignItems:"center" }}>
          <DuelCard poke={left}  side="left"  />
          <div style={{ display:"flex", flexDirection:"column", alignItems:"center", gap: mobile?8:12, flexShrink:0 }}>
            {drawBtn(mobile)}
            <div style={{ fontSize:mobile?16:22, fontWeight:800, color:"#D0C8E8" }}>VS</div>
            {undoBtn(mobile)}
          </div>
          <DuelCard poke={right} side="right" />
        </div>
      )}
      {!mobile && (
        <div style={{ fontSize:12, color:"#C0B8D8", textAlign:"center" }}>
          Clic sur la carte · ← → ↑ ↓ · Swipe sur mobile
        </div>
      )}
      <style>{`@keyframes pulse{0%,100%{opacity:1}50%{opacity:0.5}}`}</style>
    </div>
  );
}
// ── RANKING VIEW ─────────────────────────────────────────────────────────────
function RankingView({ data, onReset, onImport }) {
  const { mobile } = useLayout();
  const [genFilter, setGenFilter] = useState(0);
  const [pokeData, setPokeData] = useState({});
  const [page, setPage] = useState(0);
  const [exporting, setExporting] = useState(false);
  const [exportCount, setExportCount] = useState(null);
  const fileInputRef = useRef(null);
  const PER_PAGE = 25;

  const rankedIds = Object.entries(data.elos).sort((a,b)=>b[1]-a[1]).map(([id])=>parseInt(id));

  useEffect(() => {
    if (!rankedIds.length) return;
    const toLoad = rankedIds.filter(id=>!pokeData[id]);
    Promise.all(toLoad.map(id=>fetchPoke(id))).then(results => {
      const nd={...pokeData}; results.forEach(p=>{if(p)nd[p.id]=p;}); setPokeData(nd);
    });
  }, [data.elos]);

  const filtered = rankedIds.filter(id =>
    genFilter===0||(pokeData[id]?.gen||getGen(id))===genFilter
  );
  const paginated = filtered.slice(page*PER_PAGE,(page+1)*PER_PAGE);
  const maxElo = data.elos[rankedIds[0]]||INITIAL_ELO;
  const minElo = data.elos[rankedIds[rankedIds.length-1]]||INITIAL_ELO;
  const eloRange = maxElo-minElo||1;

  const handleExport = async (count) => {
    setExporting(true); setExportCount(count);
    const top = filtered.slice(0,count);
    const missing = top.filter(id=>!pokeData[id]);
    let fullData = pokeData;
    if (missing.length) {
      const results = await Promise.all(missing.map(id=>fetchPoke(id)));
      const nd={...pokeData}; results.forEach(p=>{if(p)nd[p.id]=p;});
      setPokeData(nd); fullData=nd;
    }
    const title = genFilter===0?`Top ${count}`:`Top ${count} — Gen ${genFilter}`;
    await exportRankingImage(top, fullData, data.elos, title, data.matches);
    setExporting(false); setExportCount(null);
  };

  const exportJSON = () => {
    const blob = new Blob([JSON.stringify(data,null,2)],{type:"application/json"});
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href=url; a.download="pokerank-classement.json"; a.click();
    URL.revokeObjectURL(url);
  };

  const importJSON = (e) => {
    const file = e.target.files[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const parsed = JSON.parse(ev.target.result);
        if (!parsed.elos||parsed.matches==null){alert("Fichier invalide.");return;}
        onImport(parsed);
        alert(`✅ Importé ! ${parsed.matches} duels récupérés.`);
      } catch { alert("Erreur de lecture du fichier."); }
    };
    reader.readAsText(file);
    e.target.value="";
  };

  const genInfo = GENERATIONS.find(g => g.id === genFilter);
  const totalInGen = genInfo ? (genInfo.range[1] - genInfo.range[0] + 1) : 1025;
  const filteredRankedCount = filtered.length;
  const rankingTitle = genFilter === 0
    ? "Classement Global"
    : `Classement ${genInfo?.name || `Gen ${genFilter}`}`;

  return (
    <div style={{ padding:"24px 24px 40px" }}>
      {/* Header */}
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start",
        marginBottom:24, flexWrap:"wrap", gap:12 }}>
        <div>
          <div style={{ fontSize:22, fontWeight:800, color:"#1A1025" }}>{rankingTitle}</div>
          <div style={{ fontSize:13, color:"#A89FC0", marginTop:4 }}>
            <span style={{ color: filteredRankedCount > 0 ? "#6C4FDF" : "#A89FC0", fontWeight:700 }}>
              {filteredRankedCount}
            </span>
            <span> sur {totalInGen} Pokémon classés · {data.matches} duels joués</span>
            {data.matches<20&&<span style={{ color:"#FF9F43", marginLeft:8 }}>⚠ Calibrage en cours</span>}
          </div>
        </div>
        <div style={{ display:"flex", gap:8, flexWrap:"wrap" }}>
          {filtered.length>=10&&(
            <button onClick={()=>handleExport(10)} disabled={exporting} style={{
              padding:"8px 14px", borderRadius:10, cursor:"pointer",
              border:"1.5px solid #6C4FDF",
              background:exporting&&exportCount===10?"#6C4FDF":"#F5F3FF",
              color:exporting&&exportCount===10?"#fff":"#6C4FDF",
              fontSize:12, fontWeight:700, opacity:exporting?0.7:1 }}>
              {exporting&&exportCount===10?"⏳…":"📸 Top 10"}
            </button>
          )}
          {filtered.length>=50&&(
            <button onClick={()=>handleExport(50)} disabled={exporting} style={{
              padding:"8px 14px", borderRadius:10, cursor:"pointer",
              border:"1.5px solid #6C4FDF",
              background:exporting&&exportCount===50?"#6C4FDF":"#F5F3FF",
              color:exporting&&exportCount===50?"#fff":"#6C4FDF",
              fontSize:12, fontWeight:700, opacity:exporting?0.7:1 }}>
              {exporting&&exportCount===50?"⏳…":"📸 Top 50"}
            </button>
          )}
          <button onClick={exportJSON} style={{ padding:"8px 14px", borderRadius:10,
            cursor:"pointer", border:"1.5px solid #3DB35E", background:"#F0FBF4",
            color:"#3DB35E", fontSize:12, fontWeight:700 }}>⬇ Exporter</button>
          <button onClick={()=>fileInputRef.current?.click()} style={{ padding:"8px 14px",
            borderRadius:10, cursor:"pointer", border:"1.5px solid #4A9FFF",
            background:"#F0F8FF", color:"#4A9FFF", fontSize:12, fontWeight:700 }}>⬆ Importer</button>
          <input ref={fileInputRef} type="file" accept=".json" onChange={importJSON} style={{ display:"none" }} />
          <button onClick={onReset} style={{ padding:"8px 14px", borderRadius:10,
            cursor:"pointer", border:"1.5px solid #FFCDD2", background:"#FFF5F5",
            color:"#C94D27", fontSize:12, fontWeight:700 }}>🗑 Réinitialiser</button>
        </div>
      </div>

      {/* Gen filter */}
      <div style={{ display:"flex", gap:8, flexWrap:"wrap", marginBottom:24 }}>
        {[0,...GENERATIONS.map(g=>g.id)].map(g=>(
          <button key={g} onClick={()=>{setGenFilter(g);setPage(0);}} style={{
            padding:"6px 14px", borderRadius:20,
            border:genFilter===g?"2px solid #6C4FDF":"1.5px solid #E8E4F0",
            background:genFilter===g?"#6C4FDF":"#fff",
            color:genFilter===g?"#fff":"#6C4FDF",
            fontSize:12, fontWeight:600, cursor:"pointer", transition:"all 0.15s" }}>
            {g===0?"Tous":`Gen ${g}`}
          </button>
        ))}
      </div>

      {/* List */}
      {filtered.length===0 ? (
        <div style={{ textAlign:"center", color:"#A89FC0", padding:"60px 0", fontSize:15 }}>
          Aucun Pokémon classé pour cette génération.<br/>
          <span style={{ fontSize:13 }}>Jouez des duels dans le mode Tinder !</span>
        </div>
      ) : (
        <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
          {paginated.map(id => {
            const globalRank = filtered.indexOf(id)+1;
            const elo = data.elos[id]||INITIAL_ELO;
            const poke = pokeData[id];
            const barWidth = ((elo-minElo)/eloRange)*100;
            const tc = poke?(TYPE_COLORS[poke.types?.[0]]||TYPE_COLORS.normal):TYPE_COLORS.normal;
            const medal = globalRank===1?"🥇":globalRank===2?"🥈":globalRank===3?"🥉":null;
            return (
              <div key={id} style={{ display:"flex", alignItems:"center", gap:16,
                padding:"10px 16px", borderRadius:14,
                background:globalRank<=3?`${tc.light}60`:"#FAFAF8",
                border:`1.5px solid ${globalRank<=3?tc.bg+"40":"#F0EDF8"}` }}>
                <div style={{ width:36, textAlign:"center", fontSize:14, fontWeight:800,
                  color:globalRank<=3?tc.bg:"#A89FC0" }}>{medal||`#${globalRank}`}</div>
                <div style={{ width:44, height:44, borderRadius:10, background:tc.light,
                  display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0 }}>
                  {poke?.sprite
                    ? <img src={poke.sprite} alt={poke.name} style={{ width:36, height:36, objectFit:"contain" }} />
                    : <div style={{ width:24, height:24, borderRadius:6, background:"#E8E4F0", animation:"pulse 1.2s infinite" }} />}
                </div>
                <div style={{ flex:1, minWidth:0 }}>
                  <div style={{ fontSize:14, fontWeight:700, color:"#1A1025" }}>{poke?.name||`#${id}`}</div>
                  <div style={{ display:"flex", gap:4, marginTop:3 }}>
                    {poke?.types?.map(t=><TypeBadge key={t} type={t} />) ||
                      <div style={{ height:16, width:40, borderRadius:8, background:"#F0EDF8" }} />}
                  </div>
                </div>
                <div style={{ width:mobile?60:160, display:"flex", flexDirection:"column", gap:4, flexShrink:0 }}>
                  <div style={{ display:"flex", justifyContent:"space-between" }}>
                    <span style={{ fontSize:11, color:"#A89FC0", fontWeight:500 }}>{mobile?"":"ELO"}</span>
                    <span style={{ fontSize:13, fontWeight:700, color:tc.bg }}>{elo}</span>
                  </div>
                  {!mobile && (
                  <div style={{ height:6, background:"#F0EDF8", borderRadius:3, overflow:"hidden" }}>
                    <div style={{ height:"100%", width:`${barWidth}%`,
                      background:`linear-gradient(90deg,${tc.bg}90,${tc.bg})`, borderRadius:3 }} />
                  </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Pagination */}
      {filtered.length>PER_PAGE&&(
        <div style={{ display:"flex", justifyContent:"center", gap:12, marginTop:24 }}>
          <button onClick={()=>setPage(p=>Math.max(0,p-1))} disabled={page===0}
            style={{ padding:"8px 18px", borderRadius:10, border:"1.5px solid #E8E4F0",
              background:"#fff", cursor:"pointer", fontSize:13, color:"#6C4FDF",
              opacity:page===0?0.4:1 }}>← Précédent</button>
          <span style={{ fontSize:13, color:"#A89FC0", padding:"8px 0" }}>
            {page+1} / {Math.ceil(filtered.length/PER_PAGE)}
          </span>
          <button onClick={()=>setPage(p=>Math.min(Math.ceil(filtered.length/PER_PAGE)-1,p+1))}
            disabled={page>=Math.ceil(filtered.length/PER_PAGE)-1}
            style={{ padding:"8px 18px", borderRadius:10, border:"1.5px solid #E8E4F0",
              background:"#fff", cursor:"pointer", fontSize:13, color:"#6C4FDF",
              opacity:page>=Math.ceil(filtered.length/PER_PAGE)-1?0.4:1 }}>Suivant →</button>
        </div>
      )}
      <style>{`@keyframes pulse{0%,100%{opacity:1}50%{opacity:0.5}}`}</style>
    </div>
  );
}

// ── ROOT APP ─────────────────────────────────────────────────────────────────
export default function App() {
  const [profile, setProfile] = useState(null);
  const [tab, setTab] = useState("pokedex");
  const [showReset, setShowReset] = useState(false);
  const { mobile } = useLayout();

  useEffect(() => {
    const lastId = loadActiveId();
    if (lastId) {
      const profiles = loadProfiles();
      if (profiles[lastId]) setProfile(profiles[lastId]);
    }
  }, []);

  const data = profile?.data || emptyData();

  const setData = (newData) => {
    const profiles = loadProfiles();
    const updated = { ...profiles, [profile.id]: { ...profile, data: newData } };
    saveProfiles(updated);
    setProfile({ ...profile, data: newData });
  };

  const handleImport = (importedData) => setData(importedData);
  const handleReset  = () => setShowReset(true);
  const confirmReset = () => { setData(emptyData()); setShowReset(false); };
  const handleLogout = () => { saveActiveId(""); setProfile(null); setTab("pokedex"); };

  if (!profile) return <WelcomeScreen onLogin={setProfile} />;

  const tabs = [
    { id:"pokedex",  label:"Pokédex",    icon:"📖" },
    { id:"tinder",   label:"Duels",      icon:"⚔️"  },
    { id:"ranking",  label:"Classement", icon:"🏆"  },
  ];

  return (
    <div style={{ minHeight:"100vh", background:"#F8F6FF",
      fontFamily:"'Nunito','Segoe UI',sans-serif",
      paddingBottom: mobile ? 64 : 0 }}>
      <link href="https://fonts.googleapis.com/css2?family=Nunito:wght@400;500;600;700;800;900&display=swap" rel="stylesheet" />

      {showReset && <ResetModal matchCount={data.matches} onConfirm={confirmReset} onCancel={()=>setShowReset(false)} />}

      {/* ── TOP HEADER ── */}
      <div style={{ background:"#fff", borderBottom:"1.5px solid #F0EDF8",
        padding: mobile?"0 16px":"0 24px",
        display:"flex", alignItems:"center", justifyContent:"space-between",
        height: mobile?52:60, position:"sticky", top:0, zIndex:100 }}>

        <div style={{ display:"flex", alignItems:"center", gap:8 }}>
          <div style={{ width:28, height:28, borderRadius:8,
            background:"linear-gradient(135deg,#6C4FDF,#FF5F8A)",
            display:"flex", alignItems:"center", justifyContent:"center", fontSize:14 }}>⚡</div>
          <span style={{ fontSize:mobile?15:18, fontWeight:900, color:"#1A1025", letterSpacing:"-0.02em" }}>
            Poké<span style={{ color:"#6C4FDF" }}>Rank</span>
          </span>
        </div>

        {/* Desktop nav */}
        {!mobile && (
          <div style={{ display:"flex", gap:4 }}>
            {tabs.map(t=>(
              <button key={t.id} onClick={()=>setTab(t.id)} style={{
                padding:"7px 18px", borderRadius:10, border:"none",
                background:tab===t.id?"#6C4FDF":"transparent",
                color:tab===t.id?"#fff":"#A89FC0",
                fontSize:13, fontWeight:700, cursor:"pointer", transition:"all 0.15s",
                display:"flex", alignItems:"center", gap:6 }}>
                <span>{t.icon}</span><span>{t.label}</span>
              </button>
            ))}
          </div>
        )}

        {/* Profile */}
        <div style={{ display:"flex", alignItems:"center", gap:mobile?6:10 }}>
          <div style={{ display:"flex", alignItems:"center", gap:6, padding:"4px 10px",
            borderRadius:20, background:"#F5F3FF", border:"1.5px solid #E8E4F0" }}>
            <div style={{ width:20, height:20, borderRadius:6,
              background:"linear-gradient(135deg,#6C4FDF,#FF5F8A)",
              display:"flex", alignItems:"center", justifyContent:"center",
              fontSize:10, fontWeight:800, color:"#fff" }}>
              {profile.name.charAt(0).toUpperCase()}
            </div>
            {!mobile && <span style={{ fontSize:12, fontWeight:700, color:"#4A3F6B" }}>{profile.name}</span>}
          </div>
          <button onClick={handleLogout} style={{ background:"none",
            border:"1.5px solid #E8E4F0", borderRadius:8, padding:"4px 8px",
            cursor:"pointer", fontSize:11, color:"#A89FC0", fontWeight:600 }}>
            {mobile?"↩":"Changer"}
          </button>
        </div>
      </div>

      {/* ── CONTENT ── */}
      <div style={{ maxWidth:mobile?"100%":960, margin:"0 auto" }}>
        {tab==="pokedex"  && <PokedexView />}
        {tab==="tinder"   && <TinderView data={data} setData={setData} />}
        {tab==="ranking"  && <RankingView data={data} onReset={handleReset} onImport={handleImport} />}
      </div>

      {/* ── BOTTOM NAV mobile ── */}
      {mobile && (
        <div style={{ position:"fixed", bottom:0, left:0, right:0, zIndex:100,
          background:"#fff", borderTop:"1.5px solid #F0EDF8",
          display:"flex", height:64, boxShadow:"0 -4px 20px rgba(0,0,0,0.06)" }}>
          {tabs.map(t=>(
            <button key={t.id} onClick={()=>setTab(t.id)} style={{
              flex:1, display:"flex", flexDirection:"column", alignItems:"center",
              justifyContent:"center", gap:3, border:"none", background:"transparent",
              cursor:"pointer", transition:"color 0.15s", position:"relative",
              color: tab===t.id?"#6C4FDF":"#A89FC0" }}>
              <span style={{ fontSize:22 }}>{t.icon}</span>
              <span style={{ fontSize:10, fontWeight:700 }}>{t.label}</span>
              {tab===t.id && (
                <div style={{ position:"absolute", top:0, left:"50%",
                  transform:"translateX(-50%)", width:36, height:3,
                  background:"#6C4FDF", borderRadius:"0 0 3px 3px" }} />
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
