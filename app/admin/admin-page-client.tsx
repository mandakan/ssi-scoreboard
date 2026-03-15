"use client";

import { useState, useCallback, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Shield,
  Trash2,
  RefreshCw,
  Search,
  UserX,
  UserCheck,
  Activity,
  LogOut,
} from "lucide-react";

interface CacheHealthResult {
  timestamp: string;
  env: Record<string, string>;
  ping: { result: string; error: string | null; latencyMs: number | null };
}

interface Suppression {
  shooterId: number;
  suppressedAt: string;
}

interface ShooterSearchResult {
  shooterId: number;
  name: string;
  club: string | null;
  division: string | null;
  lastSeen: string;
}

type AdminSection = "health" | "purge" | "suppress" | "suppressions";

function authHeaders(token: string) {
  return { Authorization: `Bearer ${token}` };
}

// ─── Login screen ──────────────────────────────────────────────────────────────

function LoginForm({ onLogin }: { onLogin: (token: string) => void }) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!password.trim()) return;
    setLoading(true);
    setError(null);

    try {
      const res = await fetch("/api/admin/cache/health", {
        headers: authHeaders(password.trim()),
      });
      if (res.ok) {
        sessionStorage.setItem("ssi-admin-token", password.trim());
        onLogin(password.trim());
      } else {
        setError("Invalid password");
      }
    } catch {
      setError("Failed to connect");
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="min-h-screen flex flex-col items-center justify-center p-4">
      <Card className="w-full max-w-sm">
        <CardHeader className="text-center">
          <Shield className="mx-auto h-8 w-8 text-muted-foreground mb-2" />
          <CardTitle>Admin Access</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <Input
              type="password"
              placeholder="Admin password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoFocus
              autoComplete="off"
            />
            {error && (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            )}
            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? "Verifying..." : "Sign in"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </main>
  );
}

// ─── Cache Health section ──────────────────────────────────────────────────────

function CacheHealthSection({ token }: { token: string }) {
  const [result, setResult] = useState<CacheHealthResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const check = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/cache/health", {
        headers: authHeaders(token),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setResult(await res.json());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed");
    } finally {
      setLoading(false);
    }
  }, [token]);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Activity className="h-4 w-4" />
          Cache Health
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <Button onClick={check} disabled={loading} size="sm">
          <RefreshCw className={`h-4 w-4 mr-2 ${loading ? "animate-spin" : ""}`} />
          {loading ? "Checking..." : "Run health check"}
        </Button>

        {error && (
          <p role="alert" className="text-sm text-destructive">{error}</p>
        )}

        {result && (
          <div className="space-y-2 text-sm">
            <p className="text-muted-foreground">
              Checked at {new Date(result.timestamp).toLocaleString()}
            </p>
            <div className="grid grid-cols-2 gap-1">
              {Object.entries(result.env).map(([key, val]) => (
                <div key={key} className="contents">
                  <span className="font-mono text-xs text-muted-foreground truncate">{key}</span>
                  <span className={`text-xs ${val === "MISSING" ? "text-destructive" : "text-green-600 dark:text-green-400"}`}>
                    {val === "MISSING" ? "MISSING" : "set"}
                  </span>
                </div>
              ))}
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs font-medium">Ping:</span>
              <span className={`text-xs ${result.ping.result === "ok" ? "text-green-600 dark:text-green-400" : "text-destructive"}`}>
                {result.ping.result}
              </span>
              {result.ping.latencyMs != null && (
                <span className="text-xs text-muted-foreground">{result.ping.latencyMs}ms</span>
              )}
              {result.ping.error && (
                <span className="text-xs text-destructive">{result.ping.error}</span>
              )}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Cache Purge section ───────────────────────────────────────────────────────

function CachePurgeSection({ token }: { token: string }) {
  const [ct, setCt] = useState("22");
  const [matchId, setMatchId] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const purge = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!matchId.trim()) return;
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch(
        `/api/admin/cache/purge?ct=${encodeURIComponent(ct)}&id=${encodeURIComponent(matchId.trim())}`,
        { method: "DELETE", headers: authHeaders(token) },
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setResult(`Purged ${data.purged?.length ?? 0} cache keys`);
      setMatchId("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Trash2 className="h-4 w-4" />
          Cache Purge
        </CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={purge} className="space-y-3">
          <div className="flex gap-2">
            <Input
              type="text"
              placeholder="ct"
              value={ct}
              onChange={(e) => setCt(e.target.value)}
              className="w-16"
              aria-label="Content type"
            />
            <Input
              type="text"
              placeholder="Match ID"
              value={matchId}
              onChange={(e) => setMatchId(e.target.value)}
              className="flex-1"
              aria-label="Match ID"
            />
          </div>
          <Button type="submit" disabled={loading || !matchId.trim()} size="sm" variant="destructive">
            {loading ? "Purging..." : "Purge match cache"}
          </Button>
          {result && <p className="text-sm text-green-600 dark:text-green-400">{result}</p>}
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        </form>
      </CardContent>
    </Card>
  );
}

// ─── Shooter Suppression section ───────────────────────────────────────────────

function ShooterSuppressSection({
  token,
  onSuppressed,
}: {
  token: string;
  onSuppressed: () => void;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<ShooterSearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [suppressingId, setSuppressingId] = useState<number | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const search = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!query.trim()) return;
    setSearching(true);
    setMessage(null);
    try {
      const res = await fetch(
        `/api/shooter/search?q=${encodeURIComponent(query.trim())}&limit=10`,
      );
      const data: ShooterSearchResult[] = await res.json();
      setResults(data);
      if (data.length === 0) setMessage("No shooters found");
    } catch {
      setMessage("Search failed");
    } finally {
      setSearching(false);
    }
  };

  const suppress = async (shooterId: number, name: string) => {
    if (!confirm(`Suppress shooter "${name}" (ID: ${shooterId})?\n\nThis will delete their profile, match history, and achievements. They will not be re-indexed until unsuppressed.`)) {
      return;
    }
    setSuppressingId(shooterId);
    try {
      const res = await fetch(`/api/shooter/${shooterId}`, {
        method: "DELETE",
        headers: authHeaders(token),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setResults((prev) => prev.filter((r) => r.shooterId !== shooterId));
      setMessage(`Suppressed shooter ${name} (${shooterId})`);
      onSuppressed();
    } catch {
      setMessage("Suppression failed");
    } finally {
      setSuppressingId(null);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <UserX className="h-4 w-4" />
          Suppress Shooter
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <form onSubmit={search} className="flex gap-2">
          <Input
            type="text"
            placeholder="Search by name..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="flex-1"
            aria-label="Shooter name search"
          />
          <Button type="submit" disabled={searching || !query.trim()} size="sm">
            <Search className="h-4 w-4 mr-2" />
            {searching ? "..." : "Search"}
          </Button>
        </form>

        {message && <p className="text-sm text-muted-foreground">{message}</p>}

        {results.length > 0 && (
          <div className="space-y-1">
            {results.map((r) => (
              <div
                key={r.shooterId}
                className="flex items-center justify-between rounded-md border border-border px-3 py-2 text-sm"
              >
                <div className="min-w-0">
                  <p className="font-medium truncate">{r.name}</p>
                  <p className="text-xs text-muted-foreground truncate">
                    {[r.club, r.division].filter(Boolean).join(" / ") || `ID: ${r.shooterId}`}
                  </p>
                </div>
                <Button
                  size="sm"
                  variant="destructive"
                  onClick={() => suppress(r.shooterId, r.name)}
                  disabled={suppressingId === r.shooterId}
                  className="ml-2 shrink-0"
                >
                  <UserX className="h-3 w-3 mr-1" />
                  {suppressingId === r.shooterId ? "..." : "Suppress"}
                </Button>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Suppression List section ──────────────────────────────────────────────────

function SuppressionListSection({ token, refreshKey }: { token: string; refreshKey: number }) {
  const [suppressions, setSuppressions] = useState<Suppression[]>([]);
  const [loading, setLoading] = useState(false);
  const [unsuppressingId, setUnsuppressingId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/suppressions", {
        headers: authHeaders(token),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setSuppressions(await res.json());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed");
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => { load(); }, [load, refreshKey]);

  const unsuppress = async (shooterId: number) => {
    if (!confirm(`Unsuppress shooter ${shooterId}? They will be re-indexed on the next match page visit.`)) {
      return;
    }
    setUnsuppressingId(shooterId);
    try {
      const res = await fetch(
        `/api/admin/suppressions?shooterId=${shooterId}`,
        { method: "DELETE", headers: authHeaders(token) },
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setSuppressions((prev) => prev.filter((s) => s.shooterId !== shooterId));
    } catch {
      setError("Unsuppress failed");
    } finally {
      setUnsuppressingId(null);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <UserCheck className="h-4 w-4" />
          Suppressed Shooters
          <Button
            size="sm"
            variant="ghost"
            onClick={load}
            disabled={loading}
            className="ml-auto"
            aria-label="Refresh suppression list"
          >
            <RefreshCw className={`h-3 w-3 ${loading ? "animate-spin" : ""}`} />
          </Button>
        </CardTitle>
      </CardHeader>
      <CardContent>
        {error && <p role="alert" className="text-sm text-destructive mb-2">{error}</p>}

        {suppressions.length === 0 && !loading && (
          <p className="text-sm text-muted-foreground">No suppressed shooters</p>
        )}

        {suppressions.length > 0 && (
          <div className="space-y-1">
            {suppressions.map((s) => (
              <div
                key={s.shooterId}
                className="flex items-center justify-between rounded-md border border-border px-3 py-2 text-sm"
              >
                <div>
                  <span className="font-mono">{s.shooterId}</span>
                  <span className="text-xs text-muted-foreground ml-2">
                    {new Date(s.suppressedAt).toLocaleDateString()}
                  </span>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => unsuppress(s.shooterId)}
                  disabled={unsuppressingId === s.shooterId}
                >
                  <UserCheck className="h-3 w-3 mr-1" />
                  {unsuppressingId === s.shooterId ? "..." : "Unsuppress"}
                </Button>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Main admin page ───────────────────────────────────────────────────────────

const SECTIONS: { id: AdminSection; label: string }[] = [
  { id: "health", label: "Health" },
  { id: "purge", label: "Purge" },
  { id: "suppress", label: "Suppress" },
  { id: "suppressions", label: "Suppressed" },
];

function getStoredToken(): string | null {
  if (typeof window === "undefined") return null;
  return sessionStorage.getItem("ssi-admin-token");
}

export function AdminPageClient() {
  const [token, setToken] = useState<string | null>(getStoredToken);
  const [activeSection, setActiveSection] = useState<AdminSection>("health");
  const [suppressionRefreshKey, setSuppressionRefreshKey] = useState(0);

  const logout = () => {
    sessionStorage.removeItem("ssi-admin-token");
    setToken(null);
  };

  if (!token) {
    return <LoginForm onLogin={setToken} />;
  }

  return (
    <main className="min-h-screen flex flex-col items-center p-4 pt-8 sm:p-6 sm:pt-12">
      <div className="w-full max-w-2xl space-y-6">
        <div className="flex items-center justify-between">
          <h1 className="text-xl font-bold flex items-center gap-2">
            <Shield className="h-5 w-5" />
            Admin
          </h1>
          <Button size="sm" variant="ghost" onClick={logout}>
            <LogOut className="h-4 w-4 mr-2" />
            Sign out
          </Button>
        </div>

        {/* Section tabs */}
        <nav className="flex gap-1 border-b border-border pb-px" aria-label="Admin sections">
          {SECTIONS.map((s) => (
            <button
              key={s.id}
              onClick={() => setActiveSection(s.id)}
              className={`px-3 py-2 text-sm font-medium rounded-t-md transition-colors ${
                activeSection === s.id
                  ? "bg-background text-foreground border border-border border-b-background -mb-px"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {s.label}
            </button>
          ))}
        </nav>

        {/* Active section */}
        {activeSection === "health" && <CacheHealthSection token={token} />}
        {activeSection === "purge" && <CachePurgeSection token={token} />}
        {activeSection === "suppress" && (
          <ShooterSuppressSection
            token={token}
            onSuppressed={() => setSuppressionRefreshKey((k) => k + 1)}
          />
        )}
        {activeSection === "suppressions" && (
          <SuppressionListSection token={token} refreshKey={suppressionRefreshKey} />
        )}
      </div>
    </main>
  );
}
