import { useState, useEffect, useCallback, useRef } from 'react';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from 'recharts';
import {
  Plus,
  Trophy,
  Calendar,
  Clock,
  Trash2,
  RotateCcw,
  Skull,
  X,
  History,
  AlertCircle,
  Loader2,
  Archive as ArchiveIcon,
  Heart,
  Lock,
} from 'lucide-react';

const COLORS = [
  '#FF6B6B', '#4ECDC4', '#FFD93D', '#A78BFA',
  '#FB923C', '#34D399', '#F472B6', '#60A5FA',
  '#FCD34D', '#F87171', '#10B981', '#818CF8',
];

const SCORE_MIN = -100;
const SCORE_MAX = 100;
const POLL_INTERVAL_MS = 30 * 1000;

// ---------- API client ----------
async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch('/api' + path, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    let errMsg = `${res.status} ${res.statusText}`;
    try {
      const j = await res.json();
      if (j.error) errMsg = j.error;
    } catch {}
    throw new Error(errMsg);
  }
  return res.json();
}

export default function App() {
  // Server data
  const [players, setPlayers] = useState([]);
  const [archived, setArchived] = useState([]);
  const [audit, setAudit] = useState([]);
  const [yourIp, setYourIp] = useState(null);

  // Load state
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // UI state
  const [activeTab, setActiveTab] = useState('today');
  const [showAdd, setShowAdd] = useState(false);
  const [newName, setNewName] = useState('');
  const [lastClicked, setLastClicked] = useState(null);
  const [schandeModal, setSchandeModal] = useState(null);
  const [sliderValue, setSliderValue] = useState(0);
  const [auditOpen, setAuditOpen] = useState(false);
  const [archiveOpen, setArchiveOpen] = useState(false);
  // passwordPrompt: { title, subtitle, confirmLabel, onConfirm }
  const [passwordPrompt, setPasswordPrompt] = useState(null);
  const inflight = useRef(0);

  // ---------- data loading ----------
  const refresh = useCallback(async () => {
    try {
      const data = await api('/state');
      setPlayers(data.players || []);
      setArchived(data.archived || []);
      setAudit(data.audit || []);
      setYourIp(data.your_ip || null);
      setError(null);
    } catch (e) {
      console.error(e);
      setError(e.message || 'Verbindung zum Server fehlgeschlagen');
    }
  }, []);

  useEffect(() => {
    (async () => {
      await refresh();
      setLoading(false);
    })();
  }, [refresh]);

  useEffect(() => {
    const id = setInterval(() => {
      if (
        inflight.current === 0 &&
        !schandeModal &&
        !auditOpen &&
        !archiveOpen &&
        !passwordPrompt
      ) {
        refresh();
      }
    }, POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, [refresh, schandeModal, auditOpen, archiveOpen, passwordPrompt]);

  // ---------- mutations ----------
  const withInflight = async (fn) => {
    inflight.current += 1;
    try {
      return await fn();
    } finally {
      inflight.current -= 1;
    }
  };

  const handleClick = async (personId) => {
    const person = players.find((p) => p.id === personId);
    if (!person || !person.in_game) return;
    setLastClicked(personId);
    setTimeout(() => setLastClicked(null), 400);

    // Optimistic
    setPlayers((prev) =>
      prev.map((p) => {
        if (!p.in_game) return p;
        const isLoser = p.id === personId;
        return {
          ...p,
          today: {
            punkte: p.today.punkte + (isLoser ? 1 : 0),
            runden: p.today.runden + 1,
          },
          all_time: {
            punkte: p.all_time.punkte + (isLoser ? 1 : 0),
            runden: p.all_time.runden + 1,
          },
        };
      })
    );

    const participants = players.filter((p) => p.in_game).map((p) => p.id);
    try {
      await withInflight(() =>
        api('/rounds', { method: 'POST', body: { loser_id: personId, participants } })
      );
      refresh();
    } catch (e) {
      setError(e.message);
      refresh();
    }
  };

  const togglePersonInGame = async (id) => {
    const person = players.find((p) => p.id === id);
    if (!person) return;
    const newValue = !person.in_game;
    setPlayers((prev) =>
      prev.map((p) => (p.id === id ? { ...p, in_game: newValue } : p))
    );
    try {
      await withInflight(() =>
        api(`/players/${id}`, { method: 'PATCH', body: { in_game: newValue } })
      );
    } catch (e) {
      setError(e.message);
      refresh();
    }
  };

  const handleAddPerson = async () => {
    const name = newName.trim();
    if (!name) return;
    const usedActive = players.map((p) => p.color);
    const usedArchived = archived.map((p) => p.color);
    const used = new Set([...usedActive, ...usedArchived]);
    const color = COLORS.find((c) => !used.has(c)) || COLORS[players.length % COLORS.length];
    try {
      await withInflight(() =>
        api('/players', { method: 'POST', body: { name, color } })
      );
      setNewName('');
      setShowAdd(false);
      refresh();
    } catch (e) {
      setError(e.message);
    }
  };

  // Archive (soft delete) — refused server-side for core players
  const handleArchive = async (id) => {
    try {
      await withInflight(() => api(`/players/${id}`, { method: 'DELETE' }));
      refresh();
    } catch (e) {
      setError(e.message);
    }
  };

  // Revive an archived player
  const handleRevive = async (id) => {
    try {
      await withInflight(() => api(`/players/${id}/revive`, { method: 'POST' }));
      refresh();
    } catch (e) {
      setError(e.message);
    }
  };

  // Open password prompt for hard delete
  const openHardDeletePrompt = (player) => {
    setPasswordPrompt({
      title: `${player.name} dauerhaft löschen`,
      subtitle:
        'Spieler und ALLE Runden mit dieser Person werden unwiderruflich gelöscht. Passwort eingeben:',
      confirmLabel: 'Dauerhaft löschen',
      destructive: true,
      onConfirm: async (password) => {
        await api(`/players/${player.id}/hard`, {
          method: 'DELETE',
          body: { password },
        });
        await refresh();
      },
    });
  };

  // Open password prompt for reset
  const openResetPrompt = () => {
    setPasswordPrompt({
      title: 'Alle Runden zurücksetzen',
      subtitle:
        'ALLE bisherigen Runden (heute + all time) werden gelöscht. Spieler und Schande-Scores bleiben. Passwort eingeben:',
      confirmLabel: 'Alles zurücksetzen',
      destructive: true,
      onConfirm: async (password) => {
        await api('/rounds', { method: 'DELETE', body: { password } });
        await refresh();
      },
    });
  };

  // Open password prompt for deleting a single audit entry
  const openDeleteAuditPrompt = (entry) => {
    const isRound = entry.kind === 'round';
    setPasswordPrompt({
      title: isRound ? 'Runde löschen' : 'Schande-Eintrag löschen',
      subtitle: isRound
        ? `Diese Runde von "${entry.player_name}" wird gelöscht. Statistiken aller Teilnehmer dieser Runde werden entsprechend angepasst. Passwort eingeben:`
        : `Diese Schande-Änderung (${entry.delta > 0 ? '+' : ''}${entry.delta}) bei "${entry.player_name}" wird gelöscht und der Score um diesen Betrag rückgängig gemacht. Passwort eingeben:`,
      confirmLabel: 'Eintrag löschen',
      destructive: true,
      onConfirm: async (password) => {
        await api(`/audit/${entry.kind}/${entry.id}`, {
          method: 'DELETE',
          body: { password },
        });
        await refresh();
      },
    });
  };

  const openSchandeModal = (personId) => {
    setSliderValue(0);
    setSchandeModal(personId);
  };

  const applySchande = async () => {
    if (!schandeModal || sliderValue === 0) return;
    const id = schandeModal;
    try {
      await withInflight(() =>
        api('/schande', { method: 'POST', body: { player_id: id, delta: sliderValue } })
      );
      setSchandeModal(null);
      setSliderValue(0);
      refresh();
    } catch (e) {
      setError(e.message);
    }
  };

  // ---------- derived stats ----------
  const stats = players.map((p) => {
    const tab = activeTab === 'today' ? p.today : p.all_time;
    return {
      id: p.id,
      name: p.name,
      color: p.color,
      in_game: p.in_game,
      schande_score: p.schande_score,
      is_core: p.is_core,
      punkte: tab.punkte,
      runden: tab.runden,
      quote: tab.runden > 0 ? tab.punkte / tab.runden : null,
    };
  });

  const sorted = [...stats].sort((a, b) => {
    if (a.quote === null && b.quote === null) return 0;
    if (a.quote === null) return 1;
    if (b.quote === null) return -1;
    return a.quote - b.quote;
  });
  const ranked = sorted.filter((s) => s.quote !== null);
  const totalRounds = activeTab === 'today'
    ? players.reduce((m, p) => Math.max(m, p.today.runden), 0)
    : players.reduce((m, p) => Math.max(m, p.all_time.runden), 0);
  const leader = ranked[0] || null;
  const loser = ranked.length > 1 ? ranked[ranked.length - 1] : null;
  const hasAny = ranked.length > 0;
  const fmtQuote = (q) => (q === null ? '—' : `${(q * 100).toFixed(1)}%`);
  const playersInGame = players.filter((p) => p.in_game).length;

  const sortedChartData = sorted
    .filter((s) => s.quote !== null)
    .map((s) => ({
      name: s.name,
      value: Math.round(s.quote * 1000) / 10,
      fill: s.color,
      punkte: s.punkte,
      runden: s.runden,
    }));

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-amber-50">
        <div className="text-center">
          <Loader2 className="w-10 h-10 mx-auto animate-spin text-stone-400" />
          <div className="mt-3 mono text-xs text-stone-500" style={{ fontFamily: "'Space Mono', monospace" }}>
            lade daten von neon...
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      className="min-h-screen w-full p-4 md:p-8"
      style={{
        fontFamily:
          "'Bricolage Grotesque', 'Space Grotesk', system-ui, -apple-system, sans-serif",
        background:
          'radial-gradient(ellipse at top left, #fef3c7 0%, transparent 50%), radial-gradient(ellipse at bottom right, #fce7f3 0%, transparent 50%), #fffdf7',
      }}
    >
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,400;12..96,600;12..96,800&family=Space+Mono:wght@400;700&display=swap');
        @keyframes pop {
          0% { transform: scale(1); }
          35% { transform: scale(1.06); }
          100% { transform: scale(1); }
        }
        @keyframes rise {
          from { opacity: 0; transform: translateY(10px); }
          to { opacity: 1; transform: translateY(0); }
        }
        @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
        @keyframes scaleIn {
          from { opacity: 0; transform: scale(0.9) translateY(10px); }
          to { opacity: 1; transform: scale(1) translateY(0); }
        }
        .pop { animation: pop 0.4s cubic-bezier(0.34, 1.56, 0.64, 1); }
        .rise { animation: rise 0.3s ease-out; }
        .fadeIn { animation: fadeIn 0.2s ease-out; }
        .scaleIn { animation: scaleIn 0.25s cubic-bezier(0.34, 1.56, 0.64, 1); }
        .mono { font-family: 'Space Mono', ui-monospace, monospace; }

        input[type="range"].schande-slider {
          -webkit-appearance: none; appearance: none;
          width: 100%; height: 10px;
          background: linear-gradient(to right, #dc2626 0%, #f59e0b 50%, #16a34a 100%);
          border-radius: 999px; outline: none;
          border: 2px solid #1c1917;
        }
        input[type="range"].schande-slider::-webkit-slider-thumb {
          -webkit-appearance: none; appearance: none;
          width: 28px; height: 28px;
          background: #1c1917; border-radius: 50%;
          cursor: grab; border: 3px solid white;
          box-shadow: 0 0 0 2px #1c1917, 0 4px 8px rgba(0,0,0,0.2);
          transition: transform 0.1s;
        }
        input[type="range"].schande-slider::-webkit-slider-thumb:active {
          cursor: grabbing; transform: scale(1.15);
        }
        input[type="range"].schande-slider::-moz-range-thumb {
          width: 28px; height: 28px;
          background: #1c1917; border-radius: 50%;
          cursor: grab; border: 3px solid white;
          box-shadow: 0 0 0 2px #1c1917, 0 4px 8px rgba(0,0,0,0.2);
        }
      `}</style>

      <div className="max-w-5xl mx-auto">
        {/* Error toast */}
        {error && (
          <div
            className="fadeIn fixed top-4 right-4 z-50 bg-rose-500 text-white px-4 py-3 rounded-xl shadow-lg flex items-center gap-2 cursor-pointer max-w-md"
            onClick={() => setError(null)}
            title="zum schließen klicken"
          >
            <AlertCircle size={16} className="flex-shrink-0" />
            <span className="text-sm font-bold">{error}</span>
          </div>
        )}

        {/* Header */}
        <header className="mb-8 flex items-end justify-between flex-wrap gap-4">
          <div>
            <h1 className="text-5xl md:text-7xl font-black tracking-tighter text-stone-900 leading-none">
              Mäxle <span className="text-rose-500">Score-Board</span>
            </h1>
            <p className="mono text-xs md:text-sm text-stone-500 mt-2">
              // wer würfelt am besten?
            </p>
          </div>
          <div className="flex flex-col items-end gap-2">
            <div className="flex items-center gap-2">
              <button
                onClick={() => setArchiveOpen(true)}
                className="px-3 py-2 bg-stone-900 text-white rounded-xl font-bold text-xs flex items-center gap-2 hover:bg-amber-500 transition-colors shadow-[0_2px_0_0_rgba(0,0,0,0.9)] hover:shadow-[0_4px_0_0_rgba(0,0,0,0.9)] hover:-translate-y-0.5 active:translate-y-0 active:shadow-[0_1px_0_0_rgba(0,0,0,0.9)] relative"
                title="Archivierte Spieler"
              >
                <ArchiveIcon size={14} /> Archiv
                {archived.length > 0 && (
                  <span className="ml-1 px-1.5 py-0.5 bg-rose-500 rounded-full text-[10px] mono tabular-nums">
                    {archived.length}
                  </span>
                )}
              </button>
              <button
                onClick={() => setAuditOpen(true)}
                className="px-3 py-2 bg-stone-900 text-white rounded-xl font-bold text-xs flex items-center gap-2 hover:bg-rose-500 transition-colors shadow-[0_2px_0_0_rgba(0,0,0,0.9)] hover:shadow-[0_4px_0_0_rgba(0,0,0,0.9)] hover:-translate-y-0.5 active:translate-y-0 active:shadow-[0_1px_0_0_rgba(0,0,0,0.9)]"
                title="Audit-Trail anzeigen"
              >
                <History size={14} /> Audit-Trail
              </button>
            </div>
            <div className="mono text-xs text-stone-400 text-right">
              <div>
                {new Date().toLocaleDateString('de-DE', {
                  weekday: 'long', day: 'numeric', month: 'long',
                })}
              </div>
              <div>{audit.filter((a) => a.kind === 'round').length} runden gespielt</div>
            </div>
          </div>
        </header>

        {/* Person buttons */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
          {players.map((person) => {
            const stat = stats.find((s) => s.id === person.id);
            const schande = person.schande_score;
            const hasSchande = schande !== 0;
            const schandeColor = schande > 0 ? '#16a34a' : schande < 0 ? '#dc2626' : '#78716c';
            const isOut = !person.in_game;
            return (
              <button
                key={person.id}
                onClick={() => handleClick(person.id)}
                className={`group relative bg-white rounded-2xl p-5 pb-7 shadow-[0_2px_0_0_rgba(0,0,0,0.9)] border-2 border-stone-900 text-left transition-all ${
                  isOut
                    ? 'opacity-50 cursor-not-allowed'
                    : 'hover:shadow-[0_6px_0_0_rgba(0,0,0,0.9)] hover:-translate-y-1 active:translate-y-0 active:shadow-[0_1px_0_0_rgba(0,0,0,0.9)]'
                } ${lastClicked === person.id ? 'pop' : ''}`}
              >
                <div className="flex justify-between items-center mb-3 gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <div
                      className="w-4 h-4 rounded-full border-2 border-stone-900 flex-shrink-0"
                      style={{ backgroundColor: person.color }}
                    />
                    <span
                      role="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        e.preventDefault();
                        togglePersonInGame(person.id);
                      }}
                      className={`relative inline-flex w-9 h-5 rounded-full transition-colors flex-shrink-0 border border-stone-900 ${
                        person.in_game ? 'bg-emerald-500' : 'bg-stone-300'
                      }`}
                      title={person.in_game ? 'Im Spiel — abschalten' : 'Nicht im Spiel — anschalten'}
                    >
                      <span
                        className={`absolute top-[1px] w-3.5 h-3.5 bg-white rounded-full shadow transition-transform ${
                          person.in_game ? 'translate-x-[18px]' : 'translate-x-[2px]'
                        }`}
                      />
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span
                      role="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        e.preventDefault();
                        openSchandeModal(person.id);
                      }}
                      className="text-stone-400 hover:text-stone-900 transition-colors p-0.5"
                      title="Ewige-Schande-Score anpassen"
                    >
                      <Skull size={15} />
                    </span>
                    {!person.is_core && (
                      <span
                        role="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          e.preventDefault();
                          handleArchive(person.id);
                        }}
                        className="opacity-0 group-hover:opacity-70 hover:!opacity-100 text-stone-400 hover:text-amber-500 transition-opacity"
                        title="Spieler archivieren"
                      >
                        <ArchiveIcon size={14} />
                      </span>
                    )}
                  </div>
                </div>
                <div className="text-2xl font-black text-stone-900 mb-1 flex items-center gap-2">
                  {person.name}
                  {isOut && (
                    <span className="mono text-[9px] uppercase tracking-widest text-stone-400 font-bold">
                      pausiert
                    </span>
                  )}
                  {person.is_core && (
                    <span className="mono text-[9px] uppercase tracking-widest text-amber-600 font-bold" title="Core-Spieler — nicht archivierbar">
                      ★
                    </span>
                  )}
                </div>
                <div className="flex items-baseline gap-2">
                  <span
                    className="text-5xl font-black tabular-nums"
                    style={{ color: person.color }}
                  >
                    {stat.punkte}
                  </span>
                  <span className="mono text-[10px] text-stone-400 uppercase tracking-widest">
                    / {stat.runden} {stat.runden === 1 ? 'runde' : 'runden'}
                  </span>
                </div>
                <div className="mono text-[11px] font-bold text-stone-600 mt-1">
                  Quote: <span className="text-stone-900">{fmtQuote(stat.quote)}</span>
                </div>
                {hasSchande && (
                  <div
                    className="absolute bottom-2 right-3 mono text-[10px] font-bold tabular-nums flex items-center gap-1"
                    style={{ color: schandeColor }}
                    title="Ewige-Schande-Score"
                  >
                    <Skull size={9} />
                    {schande > 0 ? `+${schande}` : schande}
                  </div>
                )}
              </button>
            );
          })}
        </div>

        {/* Add person */}
        <div className="mb-8">
          {showAdd ? (
            <div className="rise bg-white rounded-2xl p-3 border-2 border-stone-900 flex gap-2 items-center shadow-[0_2px_0_0_rgba(0,0,0,0.9)]">
              <input
                type="text"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleAddPerson();
                  if (e.key === 'Escape') {
                    setShowAdd(false);
                    setNewName('');
                  }
                }}
                placeholder="Name eingeben..."
                autoFocus
                className="flex-1 px-3 py-2 outline-none bg-transparent text-lg font-bold text-stone-900 placeholder:text-stone-300"
              />
              <button
                onClick={handleAddPerson}
                className="px-4 py-2 bg-stone-900 text-white rounded-lg font-bold hover:bg-rose-500 transition-colors text-sm"
              >
                Hinzufügen
              </button>
              <button
                onClick={() => {
                  setShowAdd(false);
                  setNewName('');
                }}
                className="px-3 py-2 text-stone-400 hover:text-stone-900 transition-colors"
                aria-label="Abbrechen"
              >
                ✕
              </button>
            </div>
          ) : (
            <button
              onClick={() => setShowAdd(true)}
              className="px-4 py-2.5 bg-white/40 hover:bg-white border-2 border-dashed border-stone-300 hover:border-stone-900 rounded-xl text-stone-500 hover:text-stone-900 font-bold text-sm transition-all flex items-center gap-2"
            >
              <Plus size={16} /> Person hinzufügen
            </button>
          )}
        </div>

        {/* Stats card */}
        <div className="bg-white rounded-3xl p-5 md:p-8 border-2 border-stone-900 shadow-[0_4px_0_0_rgba(0,0,0,0.9)]">
          <div className="flex items-center justify-between flex-wrap gap-3 mb-6">
            <div className="inline-flex gap-1 p-1 bg-stone-100 rounded-xl">
              <button
                onClick={() => setActiveTab('today')}
                className={`px-4 py-2 rounded-lg font-bold text-sm flex items-center gap-2 transition-all ${
                  activeTab === 'today'
                    ? 'bg-stone-900 text-white shadow'
                    : 'text-stone-500 hover:text-stone-900'
                }`}
              >
                <Clock size={14} /> Heute
              </button>
              <button
                onClick={() => setActiveTab('alltime')}
                className={`px-4 py-2 rounded-lg font-bold text-sm flex items-center gap-2 transition-all ${
                  activeTab === 'alltime'
                    ? 'bg-stone-900 text-white shadow'
                    : 'text-stone-500 hover:text-stone-900'
                }`}
              >
                <Calendar size={14} /> All Time
              </button>
            </div>

            {hasAny && (
              <button
                onClick={openResetPrompt}
                className="text-xs text-stone-400 hover:text-rose-500 transition-colors flex items-center gap-1 mono"
                title="Alle Runden zurücksetzen (Passwort erforderlich)"
              >
                <Lock size={11} /> <RotateCcw size={12} /> reset
              </button>
            )}
          </div>

          {/* Summary stats */}
          <div className="flex flex-wrap gap-8 mb-2 pb-6 border-b border-stone-200">
            <div>
              <div className="mono text-[10px] uppercase tracking-widest text-stone-500 mb-1">
                Runden {activeTab === 'today' ? '(heute)' : '(all time)'}
              </div>
              <div className="text-4xl font-black text-stone-900 tabular-nums">
                {totalRounds}
              </div>
            </div>
            {leader && hasAny && (
              <div>
                <div className="mono text-[10px] uppercase tracking-widest text-stone-500 mb-1 flex items-center gap-1">
                  <Trophy size={10} /> Spitzenreiter
                </div>
                <div className="text-4xl font-black" style={{ color: leader.color }}>
                  {leader.name}
                </div>
                <div className="mono text-[11px] text-stone-500 mt-0.5 tabular-nums">
                  {fmtQuote(leader.quote)} · {leader.punkte}/{leader.runden}
                </div>
              </div>
            )}
            {hasAny && leader && ranked[1] && (
              <div>
                <div className="mono text-[10px] uppercase tracking-widest text-stone-500 mb-1">
                  Vorsprung
                </div>
                <div className="text-4xl font-black text-stone-900 tabular-nums">
                  −{((ranked[1].quote - leader.quote) * 100).toFixed(1)}%
                </div>
              </div>
            )}
            {hasAny && loser && loser.id !== leader.id && (
              <div>
                <div className="mono text-[10px] uppercase tracking-widest text-stone-500 mb-1 flex items-center gap-1">
                  <Skull size={10} /> Schlusslicht
                </div>
                <div className="text-4xl font-black" style={{ color: loser.color }}>
                  {loser.name}
                </div>
                <div className="mono text-[11px] text-stone-500 mt-0.5 tabular-nums">
                  {fmtQuote(loser.quote)} · {loser.punkte}/{loser.runden}
                </div>
              </div>
            )}
          </div>
          <div className="mono text-[10px] text-stone-400 mb-6 italic flex items-center gap-3 flex-wrap">
            <span>// niedrigere quote = besser (punkte ÷ runden)</span>
            <span className="text-emerald-600">● {playersInGame} im spiel</span>
          </div>

          {/* Chart */}
          {hasAny ? (
            <div style={{ height: 340 }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={sortedChartData}
                  margin={{ top: 24, right: 8, left: -8, bottom: 0 }}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke="#e7e5e4" vertical={false} />
                  <XAxis
                    dataKey="name"
                    tick={{ fontSize: 14, fontWeight: 800, fill: '#1c1917' }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <YAxis
                    tick={{ fontSize: 12, fill: '#a8a29e' }}
                    axisLine={false}
                    tickLine={false}
                    domain={[0, 'dataMax']}
                    tickFormatter={(v) => `${v}%`}
                  />
                  <Tooltip
                    cursor={{ fill: 'rgba(0,0,0,0.04)' }}
                    contentStyle={{
                      background: '#1c1917', border: 'none',
                      borderRadius: 12, color: 'white',
                      fontWeight: 700, fontSize: 13, padding: '8px 12px',
                    }}
                    labelStyle={{ color: '#fff', fontWeight: 800 }}
                    itemStyle={{ color: '#fff' }}
                    formatter={(value, _n, item) => [
                      `${value}%  (${item.payload.punkte}/${item.payload.runden})`,
                      'Quote',
                    ]}
                  />
                  <Bar dataKey="value" radius={[10, 10, 0, 0]} animationDuration={600}>
                    {sortedChartData.map((d, i) => (
                      <Cell key={i} fill={d.fill} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <div className="text-center py-16 text-stone-400">
              <div className="text-6xl mb-3">🎲</div>
              <div className="font-bold text-lg text-stone-600">
                Noch keine Runden {activeTab === 'today' ? 'heute' : ''}.
              </div>
              <div className="text-sm mt-1 mono">
                schalte spieler auf „im spiel" und drück bei verlust einen knopf!
              </div>
            </div>
          )}

          {/* Ranking */}
          {hasAny && (
            <div className="mt-6 pt-6 border-t border-stone-200">
              <div className="mono text-[10px] uppercase tracking-widest text-stone-500 mb-3 flex items-center justify-between">
                <span>Ranking</span>
                <span className="text-stone-400 normal-case tracking-normal">quote: weniger ist besser</span>
              </div>
              <div className="space-y-2">
                {sorted.map((s) => {
                  const hasQuote = s.quote !== null;
                  const worstQuote = Math.max(...sorted.map((p) => p.quote ?? 0), 0.0001);
                  const pct = hasQuote ? (s.quote / worstQuote) * 100 : 0;
                  const rankedIndex = ranked.findIndex((r) => r.id === s.id);
                  const isLeader = hasQuote && rankedIndex === 0;
                  const isLoser =
                    hasQuote && ranked.length > 1 && rankedIndex === ranked.length - 1;
                  return (
                    <div key={s.id} className={`flex items-center gap-3 ${!hasQuote ? 'opacity-50' : ''}`}>
                      <div className="mono text-xs text-stone-400 w-5 tabular-nums">
                        {hasQuote ? `${rankedIndex + 1}.` : '—'}
                      </div>
                      <div className="w-4 flex justify-center">
                        {isLeader && <Trophy size={13} className="text-amber-500" />}
                        {isLoser && <Skull size={13} className="text-stone-400" />}
                      </div>
                      <div className="font-bold text-stone-900 w-20 md:w-28 truncate flex items-center gap-1.5">
                        {s.name}
                        {!s.in_game && (
                          <span className="mono text-[8px] uppercase tracking-wider text-stone-400 font-bold">
                            paus
                          </span>
                        )}
                      </div>
                      <div className="flex-1 h-2 bg-stone-100 rounded-full overflow-hidden">
                        {hasQuote && (
                          <div
                            className="h-full rounded-full transition-all duration-500"
                            style={{ width: `${pct}%`, backgroundColor: s.color }}
                          />
                        )}
                      </div>
                      <div className="font-black text-stone-900 tabular-nums w-16 text-right text-sm">
                        {fmtQuote(s.quote)}
                      </div>
                      <div className="mono text-[10px] text-stone-400 tabular-nums w-12 text-right">
                        {s.punkte}/{s.runden}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        <div className="mt-6 text-center mono text-[10px] text-stone-400">
          neon postgres backend · daten geteilt zwischen allen browsern · ★ = core-spieler
        </div>
      </div>

      {/* ---- Schande Modal ---- */}
      {schandeModal && (() => {
        const person = players.find((p) => p.id === schandeModal);
        if (!person) return null;
        const currentScore = person.schande_score;
        const previewScore = Math.max(
          SCORE_MIN,
          Math.min(SCORE_MAX, currentScore + sliderValue)
        );
        const previewColor = previewScore > 0 ? '#16a34a' : previewScore < 0 ? '#dc2626' : '#78716c';
        const sliderColor = sliderValue > 0 ? '#16a34a' : sliderValue < 0 ? '#dc2626' : '#78716c';
        return (
          <div
            className="fadeIn fixed inset-0 z-50 flex items-center justify-center p-4 bg-stone-900/60 backdrop-blur-sm"
            onClick={() => setSchandeModal(null)}
          >
            <div
              className="scaleIn bg-white rounded-3xl border-2 border-stone-900 shadow-[0_8px_0_0_rgba(0,0,0,0.9)] p-6 md:p-8 max-w-md w-full"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-start justify-between mb-6">
                <div>
                  <div className="mono text-[10px] uppercase tracking-widest text-stone-500 mb-1 flex items-center gap-1.5">
                    <Skull size={11} /> Ewige-Schande-Score
                  </div>
                  <div className="text-3xl font-black text-stone-900 flex items-center gap-2">
                    <div
                      className="w-3 h-3 rounded-full border-2 border-stone-900"
                      style={{ backgroundColor: person.color }}
                    />
                    {person.name}
                  </div>
                </div>
                <button
                  onClick={() => setSchandeModal(null)}
                  className="text-stone-400 hover:text-stone-900 transition-colors p-1"
                  aria-label="Schließen"
                >
                  <X size={20} />
                </button>
              </div>

              <div className="grid grid-cols-2 gap-3 mb-6">
                <div className="bg-stone-50 rounded-xl p-4 border border-stone-200">
                  <div className="mono text-[10px] uppercase tracking-widest text-stone-500 mb-1">
                    Aktuell
                  </div>
                  <div
                    className="text-3xl font-black tabular-nums"
                    style={{
                      color: currentScore > 0 ? '#16a34a' : currentScore < 0 ? '#dc2626' : '#78716c',
                    }}
                  >
                    {currentScore > 0 ? `+${currentScore}` : currentScore}
                  </div>
                </div>
                <div
                  className="rounded-xl p-4 border-2 transition-all"
                  style={{ borderColor: previewColor, background: `${previewColor}10` }}
                >
                  <div className="mono text-[10px] uppercase tracking-widest text-stone-500 mb-1">
                    Neu
                  </div>
                  <div className="text-3xl font-black tabular-nums" style={{ color: previewColor }}>
                    {previewScore > 0 ? `+${previewScore}` : previewScore}
                  </div>
                </div>
              </div>

              <div className="mb-6">
                <div className="flex items-center justify-between mb-3">
                  <span className="mono text-[10px] uppercase tracking-widest text-stone-500">
                    Anpassung
                  </span>
                  <span className="text-2xl font-black tabular-nums" style={{ color: sliderColor }}>
                    {sliderValue > 0 ? `+${sliderValue}` : sliderValue}
                  </span>
                </div>
                <input
                  type="range"
                  min={SCORE_MIN}
                  max={SCORE_MAX}
                  step={1}
                  value={sliderValue}
                  onChange={(e) => setSliderValue(Number(e.target.value))}
                  className="schande-slider"
                />
                <div className="flex justify-between mono text-[10px] text-stone-400 mt-2">
                  <span>−100</span>
                  <span>0</span>
                  <span>+100</span>
                </div>
                <div className="flex justify-center gap-2 mt-3 flex-wrap">
                  {[-50, -10, 0, +10, +50].map((v) => (
                    <button
                      key={v}
                      onClick={() => setSliderValue(v)}
                      className="px-2.5 py-1 mono text-[11px] font-bold rounded-md bg-stone-100 hover:bg-stone-900 hover:text-white text-stone-600 transition-colors tabular-nums"
                    >
                      {v > 0 ? `+${v}` : v}
                    </button>
                  ))}
                </div>
              </div>

              <div className="flex gap-2">
                <button
                  onClick={() => setSchandeModal(null)}
                  className="flex-1 px-4 py-3 rounded-xl font-bold text-stone-600 hover:text-stone-900 hover:bg-stone-100 transition-colors"
                >
                  Abbrechen
                </button>
                <button
                  onClick={applySchande}
                  disabled={sliderValue === 0}
                  className="flex-1 px-4 py-3 rounded-xl font-bold bg-stone-900 text-white hover:bg-rose-500 transition-colors disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:bg-stone-900"
                >
                  Übernehmen
                </button>
              </div>
              <div className="mt-4 text-center mono text-[10px] text-stone-400">
                ⌛ score verfällt automatisch um −10 alle 5 min · floor: −100
              </div>
            </div>
          </div>
        );
      })()}

      {/* ---- Archive Modal ---- */}
      {archiveOpen && (() => {
        const fmtDate = (ts) => {
          const d = new Date(ts);
          return d.toLocaleDateString('de-DE', {
            day: '2-digit', month: '2-digit', year: '2-digit',
          });
        };
        return (
          <div
            className="fadeIn fixed inset-0 z-50 flex items-center justify-center p-4 bg-stone-900/60 backdrop-blur-sm"
            onClick={() => setArchiveOpen(false)}
          >
            <div
              className="scaleIn bg-white rounded-3xl border-2 border-stone-900 shadow-[0_8px_0_0_rgba(0,0,0,0.9)] w-full max-w-2xl max-h-[85vh] flex flex-col overflow-hidden"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-start justify-between p-6 pb-4 border-b border-stone-200">
                <div>
                  <div className="mono text-[10px] uppercase tracking-widest text-stone-500 mb-1 flex items-center gap-1.5">
                    <ArchiveIcon size={11} /> Archiv
                  </div>
                  <div className="text-3xl font-black text-stone-900">
                    {archived.length} archivierte Spieler
                  </div>
                  <div className="mono text-[11px] text-stone-400 mt-1">
                    archivierte spieler erscheinen nicht in der all-time statistik
                  </div>
                </div>
                <button
                  onClick={() => setArchiveOpen(false)}
                  className="text-stone-400 hover:text-stone-900 transition-colors p-1"
                  aria-label="Schließen"
                >
                  <X size={20} />
                </button>
              </div>

              <div className="overflow-y-auto flex-1">
                {archived.length === 0 ? (
                  <div className="text-center py-16 text-stone-400">
                    <div className="text-5xl mb-3">📦</div>
                    <div className="font-bold text-stone-600">Archiv ist leer.</div>
                    <div className="text-sm mt-1 mono">
                      du kannst spieler über das archiv-symbol auf den karten archivieren
                    </div>
                  </div>
                ) : (
                  archived.map((p) => (
                    <div
                      key={p.id}
                      className="px-6 py-4 border-b border-stone-100 hover:bg-stone-50 transition-colors flex items-center gap-4"
                    >
                      <div
                        className="w-5 h-5 rounded-full border-2 border-stone-900 flex-shrink-0"
                        style={{ backgroundColor: p.color }}
                      />
                      <div className="flex-1 min-w-0">
                        <div className="font-black text-stone-900 text-lg truncate">
                          {p.name}
                        </div>
                        <div className="mono text-[11px] text-stone-500 mt-0.5 tabular-nums">
                          {p.all_time.punkte}/{p.all_time.runden} · schande {p.schande_score > 0 ? `+${p.schande_score}` : p.schande_score} · archiviert {fmtDate(p.archived_at)}
                        </div>
                      </div>
                      <div className="flex items-center gap-2 flex-shrink-0">
                        <button
                          onClick={() => handleRevive(p.id)}
                          className="px-3 py-2 bg-emerald-500 hover:bg-emerald-600 text-white rounded-lg font-bold text-xs flex items-center gap-1.5 transition-colors shadow-[0_2px_0_0_rgba(0,0,0,0.9)] hover:-translate-y-0.5 active:translate-y-0 active:shadow-[0_1px_0_0_rgba(0,0,0,0.9)]"
                          title="Spieler wieder aktivieren"
                        >
                          <Heart size={12} /> Wiederbeleben
                        </button>
                        {!p.is_core && (
                          <button
                            onClick={() => openHardDeletePrompt(p)}
                            className="px-3 py-2 bg-rose-500 hover:bg-rose-600 text-white rounded-lg font-bold text-xs flex items-center gap-1.5 transition-colors shadow-[0_2px_0_0_rgba(0,0,0,0.9)] hover:-translate-y-0.5 active:translate-y-0 active:shadow-[0_1px_0_0_rgba(0,0,0,0.9)]"
                            title="Dauerhaft löschen (Passwort erforderlich)"
                          >
                            <Trash2 size={12} /> Löschen
                          </button>
                        )}
                      </div>
                    </div>
                  ))
                )}
              </div>

              <div className="px-6 py-3 border-t border-stone-200 mono text-[10px] text-stone-400">
                ★ core-spieler · wiederbeleben aktiviert auch „Im Spiel"
              </div>
            </div>
          </div>
        );
      })()}

      {/* ---- Audit Trail Modal ---- */}
      {auditOpen && (() => {
        const fmt = (ts) => {
          const d = new Date(ts);
          const date = d.toLocaleDateString('de-DE', {
            day: '2-digit', month: '2-digit', year: '2-digit',
          });
          const time = d.toLocaleTimeString('de-DE', {
            hour: '2-digit', minute: '2-digit', second: '2-digit',
          });
          return { date, time };
        };
        const clicksCount = audit.filter((a) => a.kind === 'round').length;
        const schandeCount = audit.filter((a) => a.kind === 'schande').length;
        return (
          <div
            className="fadeIn fixed inset-0 z-50 flex items-center justify-center p-4 bg-stone-900/60 backdrop-blur-sm"
            onClick={() => setAuditOpen(false)}
          >
            <div
              className="scaleIn bg-white rounded-3xl border-2 border-stone-900 shadow-[0_8px_0_0_rgba(0,0,0,0.9)] w-full max-w-2xl max-h-[85vh] flex flex-col overflow-hidden"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-start justify-between p-6 pb-4 border-b border-stone-200">
                <div>
                  <div className="mono text-[10px] uppercase tracking-widest text-stone-500 mb-1 flex items-center gap-1.5">
                    <History size={11} /> Audit-Trail
                  </div>
                  <div className="text-3xl font-black text-stone-900">
                    {audit.length} Einträge
                  </div>
                  <div className="mono text-[11px] text-stone-400 mt-1">
                    deine ip: {yourIp || 'unbekannt'}
                  </div>
                </div>
                <button
                  onClick={() => setAuditOpen(false)}
                  className="text-stone-400 hover:text-stone-900 transition-colors p-1"
                  aria-label="Schließen"
                >
                  <X size={20} />
                </button>
              </div>

              {audit.length > 0 && (
                <div className="grid grid-cols-12 gap-2 px-6 py-2 mono text-[10px] uppercase tracking-widest text-stone-400 border-b border-stone-100 bg-stone-50">
                  <div className="col-span-3">Zeitpunkt</div>
                  <div className="col-span-3">Person</div>
                  <div className="col-span-2">Aktion</div>
                  <div className="col-span-3">IP-Adresse</div>
                  <div className="col-span-1 text-right">—</div>
                </div>
              )}

              <div className="overflow-y-auto flex-1">
                {audit.length === 0 ? (
                  <div className="text-center py-16 text-stone-400">
                    <div className="text-5xl mb-3">📜</div>
                    <div className="font-bold text-stone-600">Noch keine Einträge.</div>
                    <div className="text-sm mt-1 mono">
                      drück einen knopf, um zu starten
                    </div>
                  </div>
                ) : (
                  audit.map((e, i) => {
                    const { date, time } = fmt(e.ts);
                    const isSchande = e.kind === 'schande';
                    return (
                      <div
                        key={`${e.kind}-${e.id}`}
                        className="group grid grid-cols-12 gap-2 px-6 py-3 border-b border-stone-100 hover:bg-stone-50 transition-colors items-center text-sm"
                      >
                        <div className="col-span-3 mono text-[11px] text-stone-600">
                          <div className="font-bold text-stone-900">{time}</div>
                          <div className="text-stone-400">{date}</div>
                        </div>
                        <div className="col-span-3 flex items-center gap-2 min-w-0">
                          <div
                            className="w-2.5 h-2.5 rounded-full border border-stone-900 flex-shrink-0"
                            style={{ backgroundColor: e.player_color }}
                          />
                          <span className="font-bold text-stone-900 truncate">
                            {e.player_name}
                          </span>
                        </div>
                        <div className="col-span-2">
                          {isSchande ? (
                            <span
                              className="mono text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded"
                              style={{
                                background: e.delta >= 0 ? '#dcfce7' : '#fee2e2',
                                color: e.delta >= 0 ? '#166534' : '#991b1b',
                              }}
                            >
                              <Skull size={9} className="inline mr-0.5" />
                              {e.delta > 0 ? `+${e.delta}` : e.delta}
                            </span>
                          ) : (
                            <span className="mono text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded bg-stone-900 text-white">
                              klick
                            </span>
                          )}
                        </div>
                        <div className="col-span-3 mono text-[11px] text-stone-500 truncate">
                          {e.ip || '—'}
                        </div>
                        <div className="col-span-1 flex justify-end">
                          <button
                            onClick={() => openDeleteAuditPrompt(e)}
                            className="opacity-0 group-hover:opacity-50 hover:!opacity-100 text-stone-400 hover:text-rose-500 transition-all p-1 rounded"
                            title="Eintrag löschen + rückgängig machen (Passwort)"
                          >
                            <Trash2 size={13} />
                          </button>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>

              <div className="px-6 py-3 border-t border-stone-200 mono text-[10px] text-stone-400 flex items-center justify-between">
                <span>// hover über zeile zum löschen</span>
                <span>{clicksCount} klicks · {schandeCount} schande-änderungen</span>
              </div>
            </div>
          </div>
        );
      })()}

      {/* ---- Password Prompt Modal ---- */}
      {passwordPrompt && (
        <PasswordPromptModal
          config={passwordPrompt}
          onClose={() => setPasswordPrompt(null)}
        />
      )}
    </div>
  );
}

// ---------- Password Prompt Modal ----------
function PasswordPromptModal({ config, onClose }) {
  const [pw, setPw] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  const handleSubmit = async () => {
    if (!pw || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      await config.onConfirm(pw);
      onClose();
    } catch (e) {
      setError(e.message || 'Fehler');
      setPw('');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      className="fadeIn fixed inset-0 z-[60] flex items-center justify-center p-4 bg-stone-900/70 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="scaleIn bg-white rounded-3xl border-2 border-stone-900 shadow-[0_8px_0_0_rgba(0,0,0,0.9)] p-6 md:p-8 max-w-md w-full"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between mb-4">
          <div>
            <div className="mono text-[10px] uppercase tracking-widest text-rose-500 mb-1 flex items-center gap-1.5">
              <Lock size={11} /> Passwort erforderlich
            </div>
            <div className="text-2xl font-black text-stone-900">{config.title}</div>
          </div>
          <button
            onClick={onClose}
            className="text-stone-400 hover:text-stone-900 transition-colors p-1"
            aria-label="Schließen"
            disabled={submitting}
          >
            <X size={20} />
          </button>
        </div>

        <p className="text-sm text-stone-600 mb-4 leading-relaxed">
          {config.subtitle}
        </p>

        <input
          type="password"
          value={pw}
          onChange={(e) => setPw(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') handleSubmit();
            if (e.key === 'Escape') onClose();
          }}
          placeholder="Passwort..."
          autoFocus
          disabled={submitting}
          className="w-full px-4 py-3 bg-stone-50 border-2 border-stone-300 rounded-xl text-lg font-bold text-stone-900 placeholder:text-stone-300 outline-none focus:border-stone-900 transition-colors mono disabled:opacity-50"
        />

        {error && (
          <div className="mt-3 px-3 py-2 bg-rose-50 border border-rose-200 rounded-lg text-sm font-bold text-rose-700 flex items-center gap-2">
            <AlertCircle size={14} /> {error}
          </div>
        )}

        <div className="flex gap-2 mt-5">
          <button
            onClick={onClose}
            disabled={submitting}
            className="flex-1 px-4 py-3 rounded-xl font-bold text-stone-600 hover:text-stone-900 hover:bg-stone-100 transition-colors disabled:opacity-50"
          >
            Abbrechen
          </button>
          <button
            onClick={handleSubmit}
            disabled={!pw || submitting}
            className={`flex-1 px-4 py-3 rounded-xl font-bold text-white transition-colors flex items-center justify-center gap-2 disabled:opacity-30 disabled:cursor-not-allowed ${
              config.destructive
                ? 'bg-rose-500 hover:bg-rose-600 disabled:hover:bg-rose-500'
                : 'bg-stone-900 hover:bg-rose-500 disabled:hover:bg-stone-900'
            }`}
          >
            {submitting && <Loader2 size={14} className="animate-spin" />}
            {config.confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
