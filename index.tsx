import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { Download, RefreshCw } from "lucide-react";
import snapshot from "../data/bulletin.json";
import { ARCHIVE_FROM, ARCHIVE_TO } from "@/lib/archive";
import { refreshBulletin } from "@/lib/bulletin.functions";
import type { BulletinFile, BulletinMatch } from "@/lib/bulletin";
import { activeOdds, countOdds, findOdds, MARKETS, MIN_MATCH, type MarketKey, type OddsInput } from "@/lib/match-odds";

export const Route = createFileRoute("/")({ component: Home });

const TOLERANCES = [
  { value: 0.05, name: "Sıkı" },
  { value: 0.08, name: "Yakın" },
  { value: 0.12, name: "Geniş" },
];

const EMPTY: OddsInput = { o1: "", ox: "", o2: "", alt: "", ust: "" };
const INITIAL = snapshot as BulletinFile;

function formatDate(iso: string) {
  const [y, m, d] = iso.split("-");
  return `${d}.${m}.${y}`;
}

function resultOf(score: string): "1" | "X" | "2" | null {
  const [home, away] = score.split("-").map(Number);
  if (!Number.isFinite(home) || !Number.isFinite(away)) return null;
  if (home > away) return "1";
  if (home === away) return "X";
  return "2";
}

function oddsOf(match: BulletinMatch): OddsInput {
  return {
    o1: match.o1.toFixed(2),
    ox: match.ox.toFixed(2),
    o2: match.o2.toFixed(2),
    alt: match.alt == null ? "" : match.alt.toFixed(2),
    ust: match.ust == null ? "" : match.ust.toFixed(2),
  };
}

function firstPlayable(file: BulletinFile) {
  return file.matches.find((match) => match.alt != null && match.ust != null) ?? file.matches[0];
}

function Crest() {
  return (
    <svg viewBox="0 0 32 32" className="size-11 shrink-0" aria-hidden>
      <rect width="32" height="32" rx="8" className="fill-primary" />
      <mask id="ay-yildiz">
        <rect width="32" height="32" fill="white" />
        <circle cx="17.2" cy="16" r="6.2" fill="black" />
      </mask>
      <circle cx="14.2" cy="16" r="7.4" fill="white" mask="url(#ay-yildiz)" />
      <path
        fill="white"
        d="M23.2 16l1.15 1.9 2.15-.2-1.35 1.7.7 2.05-1.95-1.05-1.95 1.05.7-2.05-1.35-1.7 2.15.2z"
      />
    </svg>
  );
}

function Sheet({
  raw,
  editable,
  onChange,
}: {
  raw: OddsInput;
  editable: boolean;
  onChange?: (key: MarketKey, value: string) => void;
}) {
  const lifted = activeOdds(raw);
  return (
    <div className="overflow-hidden rounded-2xl border border-border">
      <div className="grid grid-cols-5 bg-surface-2 text-center text-xs text-muted">
        {MARKETS.map((market) => (
          <div key={market.key} className="border-r border-border px-1 py-2 last:border-r-0">
            {market.label}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-5">
        {MARKETS.map((market) =>
          editable ? (
            <input
              key={market.key}
              inputMode="decimal"
              aria-label={market.label}
              value={raw[market.key]}
              placeholder="—"
              onChange={(event) => onChange?.(market.key, event.target.value)}
              className="h-14 border-t border-r border-border bg-bg text-center font-mono text-lg text-fg outline-none last:border-r-0 focus:bg-surface"
            />
          ) : (
            <div
              key={market.key}
              className="flex h-14 items-center justify-center border-t border-r border-border bg-bg font-mono text-lg last:border-r-0"
            >
              {raw[market.key] || "—"}
            </div>
          ),
        )}
      </div>
      <div className="grid grid-cols-5 bg-bg text-center font-mono text-xs text-muted">
        {MARKETS.map((market) => {
          const lift = lifted.find((item) => item.key === market.key);
          return (
            <div key={market.key} className="border-t border-r border-border px-1 py-2 last:border-r-0">
              {lift ? lift.bet365.toFixed(2) : "—"}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Home() {
  const opening = firstPlayable(INITIAL);
  const [tab, setTab] = useState<"manuel" | "bulten">("manuel");
  const [bulletin, setBulletin] = useState(INITIAL);
  const [selectedId, setSelectedId] = useState(opening?.id ?? 0);
  const [manual, setManual] = useState<OddsInput>(EMPTY);
  const [query, setQuery] = useState("");
  const [tolerance, setTolerance] = useState(0.08);
  const [shown, setShown] = useState(30);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [scan, setScan] = useState<Record<number, number>>({});
  const [scanned, setScanned] = useState(0);

  const selected = bulletin.matches.find((match) => match.id === selectedId);
  const raw = tab === "manuel" ? manual : selected ? oddsOf(selected) : EMPTY;
  const found = useMemo(() => findOdds(raw, tolerance), [raw, tolerance]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase("tr");
    const rows = needle
      ? bulletin.matches.filter((match) =>
          `${match.home} ${match.away} ${match.league}`.toLocaleLowerCase("tr").includes(needle),
        )
      : bulletin.matches;
    return [...rows].sort((a, b) => (scan[b.id] ?? 0) - (scan[a.id] ?? 0) || a.time.localeCompare(b.time));
  }, [bulletin.matches, query, scan]);

  const withHits = filtered.filter((match) => (scan[match.id] ?? 0) > 0).length;

  useEffect(() => {
    if (tab !== "bulten") return;
    let cancel = false;
    let index = 0;
    const next: Record<number, number> = {};
    setScanned(0);
    const step = () => {
      if (cancel) return;
      const end = Math.min(index + 20, bulletin.matches.length);
      for (; index < end; index += 1) {
        const match = bulletin.matches[index];
        next[match.id] = countOdds(oddsOf(match), tolerance);
      }
      setScan({ ...next });
      setScanned(index);
      if (index < bulletin.matches.length) window.setTimeout(step, 0);
    };
    const timer = window.setTimeout(step, 0);
    return () => {
      cancel = true;
      window.clearTimeout(timer);
    };
  }, [tab, bulletin, tolerance]);

  async function reload() {
    setLoading(true);
    setError("");
    try {
      const next = await refreshBulletin();
      setBulletin(next);
      const match = firstPlayable(next);
      if (match) setSelectedId(match.id);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Bülten alınamadı");
    } finally {
      setLoading(false);
    }
  }

  function download() {
    const header = ["Tarih", "Lig", "Ev", "Deplasman", "Skor", "Tutan", ...found.active.map((item) => item.label)];
    const lines = [header.join(";")];
    for (const hit of found.hits) {
      const prices = found.active.map((item) => {
        const price = hit.row[item.index];
        return typeof price === "number" ? price.toFixed(2) : "";
      });
      lines.push(
        [formatDate(hit.row[0]), hit.row[1], hit.row[2], hit.row[3], hit.row[4], hit.matched, ...prices].join(";"),
      );
    }
    const blob = new Blob([`\uFEFF${lines.join("\n")}`], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "eslesen-maclar.csv";
    link.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="min-h-screen bg-bg">
      <div className="flex h-1.5" aria-hidden>
        <span className="flex-1 bg-azure" />
        <span className="flex-1 bg-primary" />
        <span className="flex-1 bg-hit" />
      </div>
      <main className="mx-auto flex w-full max-w-5xl flex-col gap-5 px-4 py-6 sm:py-8">
        <header className="flex items-center gap-3">
          <Crest />
          <div>
            <p className="text-sm text-muted">Ay-yıldız arşivi</p>
            <h1 className="text-2xl font-semibold tracking-tight">Dört Oran</h1>
          </div>
        </header>
        <p className="max-w-2xl text-sm text-muted">
          Yazılan İddaa oranı Bet365 karşılığına çevrilir ve {formatDate(ARCHIVE_FROM)} – {formatDate(ARCHIVE_TO)}{" "}
          arşivinde aranır. En az {MIN_MATCH} oran tutan eski maç gelir.
        </p>

        <div role="tablist" aria-label="Çalışma" className="grid grid-cols-2 rounded-3xl bg-surface p-1">
          {(
            [
              ["manuel", "Manuel analiz"],
              ["bulten", "Bülten"],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={tab === id}
              onClick={() => {
                setTab(id);
                setShown(30);
              }}
              className={
                tab === id
                  ? "h-11 rounded-2xl bg-primary text-sm font-medium text-primary-fg"
                  : "h-11 rounded-2xl text-sm text-muted"
              }
            >
              {label}
            </button>
          ))}
        </div>

        {tab === "manuel" ? (
          <section className="flex flex-col gap-3">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-lg font-medium">Oran tablosu</h2>
              <button
                type="button"
                onClick={() => {
                  setManual(EMPTY);
                  setShown(30);
                }}
                className="h-11 rounded-lg border border-border px-3 text-sm"
              >
                Temizle
              </button>
            </div>
            <Sheet
              raw={manual}
              editable
              onChange={(key, value) => {
                setManual((prev) => ({ ...prev, [key]: value }));
                setShown(30);
              }}
            />
            <p className="text-xs text-muted">Üst satır İddaa. Alt satır arşivde aranan Bet365 karşılığı.</p>
          </section>
        ) : (
          <section className="flex flex-col gap-3">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h2 className="text-lg font-medium">{bulletin.date}</h2>
                <p className="text-sm text-muted">
                  {scanned < bulletin.matches.length
                    ? `Taranıyor ${scanned} / ${bulletin.matches.length}`
                    : `${withHits} maçta eski karşılık var`}
                </p>
              </div>
              <button
                type="button"
                onClick={reload}
                disabled={loading}
                className="flex h-11 items-center gap-2 rounded-lg bg-primary px-3 text-sm text-primary-fg disabled:opacity-60"
              >
                <RefreshCw className="size-4" aria-hidden />
                {loading ? "İniyor" : "Bülteni indir"}
              </button>
            </div>
            {error && <p className="text-sm text-primary">{error}</p>}
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Takım veya lig"
              className="h-11 rounded-lg border border-border bg-surface px-3 outline-none"
            />
            <div className="max-h-64 overflow-y-auto rounded-2xl border border-border">
              {filtered.slice(0, 80).map((match) => {
                const count = scan[match.id];
                const on = match.id === selectedId;
                return (
                  <button
                    key={match.id}
                    type="button"
                    onClick={() => {
                      setSelectedId(match.id);
                      setShown(30);
                    }}
                    className={
                      on
                        ? "flex w-full items-center justify-between gap-3 border-b border-border bg-primary px-3 py-3 text-left text-primary-fg"
                        : "flex w-full items-center justify-between gap-3 border-b border-border bg-bg px-3 py-3 text-left"
                    }
                  >
                    <span>
                      <span className="font-mono text-xs">{match.time}</span> {match.home} – {match.away}
                    </span>
                    <span className="font-mono text-xs">{count == null ? "…" : count.toLocaleString("tr-TR")}</span>
                  </button>
                );
              })}
            </div>
            {selected && (
              <>
                <p className="text-sm text-muted">
                  {selected.time} {selected.home} – {selected.away}
                </p>
                <Sheet raw={oddsOf(selected)} editable={false} />
              </>
            )}
          </section>
        )}

        <div className="flex flex-wrap gap-2">
          {TOLERANCES.map((item) => (
            <button
              key={item.value}
              type="button"
              onClick={() => {
                setTolerance(item.value);
                setShown(30);
              }}
              className={
                item.value === tolerance
                  ? "h-11 rounded-full bg-primary px-4 text-sm text-primary-fg"
                  : "h-11 rounded-full border border-border bg-surface px-4 text-sm"
              }
            >
              {item.name}
              <span className="ml-1 font-mono">±{item.value.toFixed(2)}</span>
            </button>
          ))}
        </div>

        <div className="flex items-end justify-between gap-3">
          <h2 className="text-xl font-semibold">
            {found.active.length < MIN_MATCH
              ? "En az iki oran gerekli"
              : `${found.hits.length.toLocaleString("tr-TR")} eski maç`}
          </h2>
          {found.hits.length > 0 && (
            <button
              type="button"
              onClick={download}
              className="flex h-11 items-center gap-2 rounded-lg border border-border bg-surface px-3 text-sm"
            >
              <Download className="size-4" aria-hidden />
              Excel
            </button>
          )}
        </div>
        <p className="text-sm text-muted">Yeşil kutu tutan orandır. İkiden az yeşil olan maç elenir.</p>

        {found.active.length >= MIN_MATCH && found.hits.length === 0 && (
          <p className="rounded-3xl border border-border bg-surface px-4 py-6 text-muted">
            Bu oranlar birlikte tutmuyor. Toleransı genişlet.
          </p>
        )}

        <ul className="flex flex-col gap-3">
          {found.hits.slice(0, shown).map((hit) => (
            <li
              key={`${hit.row[0]}-${hit.row[1]}-${hit.row[2]}-${hit.row[3]}`}
              className="rounded-3xl border border-border bg-surface px-4 py-3"
            >
              <div className="flex items-baseline justify-between gap-3">
                <div className="font-medium">
                  {hit.row[2]} <span className="text-muted">–</span> {hit.row[3]}
                </div>
                <div className="rounded-full bg-hit px-2 py-1 font-mono text-sm text-hit-fg">{hit.matched} oran</div>
              </div>
              <div className="mt-1 flex flex-wrap gap-x-3 text-sm text-muted">
                <span>{formatDate(hit.row[0])}</span>
                <span>{hit.row[1]}</span>
                <span className="font-mono text-fg">{hit.row[4] || "—"}</span>
                <span>{resultOf(hit.row[4]) ? `MS ${resultOf(hit.row[4])}` : ""}</span>
              </div>
              <div className="mt-3 grid grid-cols-5 gap-1 font-mono text-xs sm:gap-2 sm:text-sm">
                {found.active.map((market, index) => {
                  const price = hit.row[market.index];
                  const on = hit.flags[index];
                  return (
                    <div
                      key={market.key}
                      className={
                        on
                          ? "rounded-md bg-hit px-1 py-2 text-center text-hit-fg"
                          : "rounded-md bg-bg px-1 py-2 text-center text-muted"
                      }
                    >
                      <div>{market.short}</div>
                      <div>{typeof price === "number" ? price.toFixed(2) : "—"}</div>
                    </div>
                  );
                })}
              </div>
            </li>
          ))}
        </ul>

        {shown < found.hits.length && (
          <button
            type="button"
            onClick={() => setShown((count) => count + 30)}
            className="h-12 rounded-2xl border border-border bg-surface"
          >
            Daha fazla ({shown} / {found.hits.length})
          </button>
        )}
      </main>
    </div>
  );
}
