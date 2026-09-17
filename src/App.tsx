import { useCallback, useEffect, useRef, useState } from "react";
import "./App.css";
import {
  CATEGORY_LABELS,
  DIMENSION_LABELS,
  SUGGESTION_TYPE_LABELS,
  type AnalyzeResult,
  type DimensionScores,
  type WritingSuggestion,
} from "./types";

const DEFAULT_DEBOUNCE_MS = 500;

const WRITING_STARTERS = [
  {
    id: "contrarian",
    title: "⚡ Contrarian Take",
    text: `Most advice about [topic] is dead wrong.\n\nHere is what 90% of people miss:\n\n1. [Key point 1]\n2. [Key point 2]\n3. [Key point 3]\n\nWhat would you add to this?`,
  },
  {
    id: "playbook",
    title: "📋 Tactical Playbook",
    text: `How to [desirable outcome] without [common pain point]:\n\nStep 1: [First tactical step]\nStep 2: [Second tactical step]\nStep 3: [Third tactical step]\n\nBookmark this for your next sprint.`,
  },
  {
    id: "story",
    title: "📖 Costly Lesson",
    text: `Last year, we lost [time/money] trying to [goal].\n\nHere is the biggest mistake we made and the 3 rules we follow today:\n\n• Rule 1: [Detail]\n• Rule 2: [Detail]\n• Rule 3: [Detail]`,
  },
  {
    id: "question",
    title: "❓ Discussion Starter",
    text: `Quick question for builders & creators:\n\nWhat is one workflow habit or tool that 10x'd your output this year?\n\nI'll start in the replies:`,
  },
];

function pct(n: number): string {
  return `${Math.round(n * 100)}%`;
}

function scoreTone(n: number): "low" | "mid" | "high" {
  if (n >= 0.7) return "high";
  if (n >= 0.4) return "mid";
  return "low";
}

export default function App() {
  const [text, setText] = useState("");
  const [debounceMs, setDebounceMs] = useState(DEFAULT_DEBOUNCE_MS);
  const [result, setResult] = useState<AnalyzeResult | null>(null);
  const [status, setStatus] = useState<"idle" | "waiting" | "loading" | "error">(
    "idle",
  );
  const [error, setError] = useState<string | null>(null);
  const [serverMode, setServerMode] = useState<"live" | "mock" | "unknown">(
    "unknown",
  );
  const [history, setHistory] = useState<string[]>([]);
  const [appliedId, setAppliedId] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const abortRef = useRef<AbortController | null>(null);
  const reqId = useRef(0);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    fetch("/api/health")
      .then((r) => r.json())
      .then((d: { mode?: "live" | "mock" }) => {
        if (d.mode) setServerMode(d.mode);
      })
      .catch(() => setServerMode("unknown"));
  }, []);

  const runAnalyze = useCallback(async (draft: string) => {
    const trimmed = draft.trim();
    if (!trimmed) {
      setResult(null);
      setStatus("idle");
      setError(null);
      return;
    }

    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    const id = ++reqId.current;
    setStatus("loading");
    setError(null);

    try {
      const res = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: draft }),
        signal: ac.signal,
      });
      if (!res.ok) {
        throw new Error(`Analyze failed (${res.status})`);
      }
      const data = (await res.json()) as AnalyzeResult;
      if (id !== reqId.current) return;
      setResult(data);
      setStatus("idle");
    } catch (err) {
      if (ac.signal.aborted) return;
      if (id !== reqId.current) return;
      setStatus("error");
      setError(err instanceof Error ? err.message : "Analyze failed");
    }
  }, []);

  useEffect(() => {
    const trimmed = text.trim();
    if (!trimmed) {
      const t = window.setTimeout(() => {
        setResult(null);
        setStatus("idle");
      }, 0);
      return () => window.clearTimeout(t);
    }
    const waitTimer = window.setTimeout(() => {
      setStatus("waiting");
    }, 0);
    const t = window.setTimeout(() => {
      void runAnalyze(text);
    }, debounceMs);
    return () => {
      window.clearTimeout(waitTimer);
      window.clearTimeout(t);
      abortRef.current?.abort();
    };
  }, [text, debounceMs, runAnalyze]);

  const handleApplySuggestion = useCallback(
    (suggestion: WritingSuggestion) => {
      setHistory((prev) => [...prev, text]);
      let newText = text;

      if (suggestion.action === "replace_all") {
        newText = suggestion.suggestedText;
      } else if (suggestion.action === "append") {
        const trimmed = text.trimEnd();
        newText = trimmed
          ? `${trimmed}\n\n${suggestion.suggestedText}`
          : suggestion.suggestedText;
      } else if (suggestion.action === "replace_hook") {
        const trimmed = text.trim();
        if (!trimmed) {
          newText = suggestion.suggestedText;
        } else {
          const paragraphs = trimmed.split(/\n\s*\n/);
          if (paragraphs.length > 1) {
            paragraphs[0] = suggestion.suggestedText;
            newText = paragraphs.join("\n\n");
          } else {
            const lines = trimmed.split("\n");
            if (lines.length > 1) {
              lines[0] = suggestion.suggestedText;
              newText = lines.join("\n");
            } else {
              newText = suggestion.suggestedText;
            }
          }
        }
      }

      setText(newText);
      setAppliedId(suggestion.id);
      setTimeout(() => {
        setAppliedId((curr) => (curr === suggestion.id ? null : curr));
      }, 2000);
    },
    [text],
  );

  const handleUndo = useCallback(() => {
    if (history.length === 0) return;
    const previous = history[history.length - 1];
    setHistory((prev) => prev.slice(0, -1));
    setText(previous);
  }, [history]);

  const handleCopySuggestion = useCallback(
    (id: string, suggestionText: string) => {
      void navigator.clipboard.writeText(suggestionText).then(() => {
        setCopiedId(id);
        setTimeout(() => {
          setCopiedId((curr) => (curr === id ? null : curr));
        }, 1800);
      });
    },
    [],
  );

  const handleUseStarter = useCallback((starterText: string) => {
    setText(starterText);
    textareaRef.current?.focus();
  }, []);

  const dims = result?.dimensions;
  const composite = result?.composite ?? 0;
  const suggestions = result?.suggestions ?? [];

  return (
    <div className="shell">
      <header className="header">
        <div>
          <p className="eyebrow">DraftPulse · experimental · Jev</p>
          <h1>Viral post analyzer</h1>
          <p className="sub">
            Pause typing and get dimension scores + real-time writing suggestions.
            Heuristic until calibrated on real outcomes.
          </p>
        </div>
        <div className="badges">
          <span className={`pill pill-${serverMode}`}>
            {serverMode === "live"
              ? "Jev live"
              : serverMode === "mock"
                ? "Mock mode"
                : "…"}
          </span>
          {result?.model ? <span className="pill">{result.model}</span> : null}
        </div>
      </header>

      <main className="grid">
        <section className="composer card">
          <div className="composer-header">
            <label className="label" htmlFor="draft">
              Draft
            </label>
            {history.length > 0 && (
              <button
                type="button"
                className="btn-undo"
                onClick={handleUndo}
                title="Revert last applied suggestion"
              >
                ↩ Undo ({history.length})
              </button>
            )}
          </div>

          <textarea
            ref={textareaRef}
            id="draft"
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Write the post. Stop typing — analysis and writing suggestions run after the debounce."
            rows={14}
            maxLength={8000}
          />

          <div className="composer-meta">
            <span>{text.length} chars</span>
            <label className="debounce">
              Debounce
              <input
                type="range"
                min={300}
                max={1200}
                step={100}
                value={debounceMs}
                onChange={(e) => setDebounceMs(Number(e.target.value))}
              />
              <span>{debounceMs}ms</span>
            </label>
            <span className="status" aria-live="polite">
              {status === "waiting" && "Waiting…"}
              {status === "loading" && "Analyzing…"}
              {status === "error" && (error ?? "Error")}
              {status === "idle" && result && "Updated"}
            </span>
          </div>

          {!text.trim() && (
            <div className="starters-section">
              <p className="label starters-label">Writing starters & templates</p>
              <div className="starters-grid">
                {WRITING_STARTERS.map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    className="starter-card"
                    onClick={() => handleUseStarter(s.text)}
                  >
                    <span className="starter-title">{s.title}</span>
                    <span className="starter-snippet">
                      {s.text.slice(0, 75).replace(/\n/g, " ")}…
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </section>

        <aside className="results">
          <section className="card score-card">
            <div className="score-row">
              <div>
                <p className="label">Viral potential</p>
                <p className={`big-score tone-${scoreTone(composite)}`}>
                  {pct(composite)}
                </p>
              </div>
              {result ? (
                <div className="category">
                  <p className="label">Category</p>
                  <p className="category-value">
                    {CATEGORY_LABELS[result.category]}
                  </p>
                  <p className="muted">
                    confidence {pct(result.categoryConfidence)}
                  </p>
                </div>
              ) : (
                <p className="muted empty-hint">Scores appear after you pause.</p>
              )}
            </div>
            <div
              className="meter"
              role="meter"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.round(composite * 100)}
              aria-label="Viral potential"
            >
              <div
                className={`meter-fill tone-${scoreTone(composite)}`}
                style={{ width: pct(composite) }}
              />
            </div>
          </section>

          {/* Writing Suggestions Card */}
          <section className="card suggestions-card">
            <div className="suggestions-header">
              <p className="label">Writing Suggestions</p>
              {suggestions.length > 0 && (
                <span className="suggestions-count-badge">
                  {suggestions.length} available
                </span>
              )}
            </div>

            {suggestions.length > 0 ? (
              <div className="suggestions-list">
                {suggestions.map((s) => (
                  <div key={s.id} className="suggestion-item">
                    <div className="suggestion-top">
                      <span className={`suggestion-badge badge-${s.type}`}>
                        {SUGGESTION_TYPE_LABELS[s.type]}
                      </span>
                      <span className="suggestion-title">{s.title}</span>
                    </div>

                    <p className="suggestion-desc">{s.explanation}</p>

                    <div className="suggestion-preview">
                      <pre className="suggestion-text">{s.suggestedText}</pre>
                    </div>

                    <div className="suggestion-actions">
                      <button
                        type="button"
                        className={`btn-apply ${appliedId === s.id ? "is-applied" : ""}`}
                        onClick={() => handleApplySuggestion(s)}
                        disabled={appliedId === s.id}
                      >
                        {appliedId === s.id ? "✓ Applied to draft" : s.actionLabel}
                      </button>
                      <button
                        type="button"
                        className="btn-copy"
                        onClick={() => handleCopySuggestion(s.id, s.suggestedText)}
                        title="Copy text to clipboard"
                      >
                        {copiedId === s.id ? "✓ Copied" : "Copy"}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="muted">
                {text.trim()
                  ? "Analyzing draft to generate writing suggestions…"
                  : "Start writing or choose a starter template above to see suggestions."}
              </p>
            )}
          </section>

          <section className="card">
            <p className="label">Dimensions</p>
            <ul className="dim-list">
              {(
                Object.keys(DIMENSION_LABELS) as (keyof DimensionScores)[]
              ).map((key) => {
                const v = dims?.[key] ?? 0;
                return (
                  <li key={key}>
                    <div className="dim-head">
                      <span>{DIMENSION_LABELS[key]}</span>
                      <span className={`tone-${scoreTone(v)}`}>{pct(v)}</span>
                    </div>
                    <div className="bar">
                      <div
                        className={`bar-fill tone-${scoreTone(v)}`}
                        style={{ width: pct(v) }}
                      />
                    </div>
                  </li>
                );
              })}
            </ul>
          </section>

          <section className="card">
            <p className="label">Tips</p>
            {result?.tips?.length ? (
              <ul className="tips">
                {result.tips.map((tip) => (
                  <li key={tip}>{tip}</li>
                ))}
              </ul>
            ) : (
              <p className="muted">Keep writing — tips show with the first analysis.</p>
            )}
          </section>

          <section className="card stub">
            <p className="label">Similar posts</p>
            <p className="muted">
              Stub for inspiration once the calibration corpus exists (phase 2).
            </p>
          </section>
        </aside>
      </main>
    </div>
  );
}
