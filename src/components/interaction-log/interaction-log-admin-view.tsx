"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Loader2, RefreshCcw } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";

type InteractionLogMode = "everyone" | "allowlist" | "denylist" | "percentage";
type InteractionLogIdentityMode = "identified" | "pseudonymous";

type InteractionLogSettings = {
  masterEnabled: boolean;
  mode: InteractionLogMode;
  allowlistEmails: string[];
  denylistEmails: string[];
  samplePercentage: number;
  retentionDays: number;
  disclosureEnabled: boolean;
  storageIdentityMode: InteractionLogIdentityMode;
  updatedAt: string;
  updatedByEmail: string | null;
};

type InteractionLogEntry = {
  id: string;
  identityMode: InteractionLogIdentityMode;
  userSub: string | null;
  userEmail: string | null;
  userName: string | null;
  userPseudonym: string | null;
  threadId: number | null;
  senderId: string;
  capturedAt: string;
  source: "sync" | "long-task-callback";
  traceId: string | null;
  history: unknown[];
  serviceSnapshots: unknown[];
  expiresAt: string;
};

function emailsToText(emails: string[]): string {
  return emails.join("\n");
}

function textToEmails(text: string): string[] {
  return text
    .split(/[\n,]/)
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
}

export default function InteractionLogAdminView({
  storageMode,
  storageDescription,
  storageWarning,
}: {
  storageMode: "local-file" | "postgres";
  storageDescription: string;
  storageWarning: string | null;
}) {
  const [settings, setSettings] = useState<InteractionLogSettings | null>(null);
  const [settingsLoading, setSettingsLoading] = useState(true);
  const [settingsSaving, setSettingsSaving] = useState(false);
  const [settingsError, setSettingsError] = useState<string | null>(null);
  const [allowlistText, setAllowlistText] = useState("");
  const [denylistText, setDenylistText] = useState("");

  const [entries, setEntries] = useState<InteractionLogEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [entriesLoading, setEntriesLoading] = useState(false);
  const [entriesError, setEntriesError] = useState<string | null>(null);
  const [userEmailFilter, setUserEmailFilter] = useState("");
  const [selectedEntry, setSelectedEntry] = useState<InteractionLogEntry | null>(null);

  const loadSettings = useCallback(async () => {
    setSettingsLoading(true);
    setSettingsError(null);
    try {
      const response = await fetch("/api/admin/interaction-log/settings", { cache: "no-store" });
      if (!response.ok) throw new Error(`Failed to load settings (${response.status})`);
      const data = (await response.json()) as InteractionLogSettings;
      setSettings(data);
      setAllowlistText(emailsToText(data.allowlistEmails));
      setDenylistText(emailsToText(data.denylistEmails));
    } catch (error) {
      setSettingsError(error instanceof Error ? error.message : "Failed to load settings");
    } finally {
      setSettingsLoading(false);
    }
  }, []);

  const loadEntries = useCallback(async () => {
    setEntriesLoading(true);
    setEntriesError(null);
    try {
      const params = new URLSearchParams();
      if (userEmailFilter.trim()) params.set("userEmail", userEmailFilter.trim());
      const response = await fetch(`/api/admin/interaction-log?${params.toString()}`, { cache: "no-store" });
      if (!response.ok) throw new Error(`Failed to load entries (${response.status})`);
      const data = (await response.json()) as { total: number; results: InteractionLogEntry[] };
      setEntries(data.results);
      setTotal(data.total);
    } catch (error) {
      setEntriesError(error instanceof Error ? error.message : "Failed to load entries");
    } finally {
      setEntriesLoading(false);
    }
  }, [userEmailFilter]);

  useEffect(() => {
    void loadSettings();
  }, [loadSettings]);

  useEffect(() => {
    void loadEntries();
  }, [loadEntries]);

  async function handleSaveSettings() {
    if (!settings) return;
    setSettingsSaving(true);
    setSettingsError(null);
    try {
      const response = await fetch("/api/admin/interaction-log/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          masterEnabled: settings.masterEnabled,
          mode: settings.mode,
          allowlistEmails: textToEmails(allowlistText),
          denylistEmails: textToEmails(denylistText),
          samplePercentage: settings.samplePercentage,
          retentionDays: settings.retentionDays,
          disclosureEnabled: settings.disclosureEnabled,
          storageIdentityMode: settings.storageIdentityMode,
        }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({ message: `Failed to save (${response.status})` }));
        throw new Error(body.message ?? `Failed to save (${response.status})`);
      }
      const data = (await response.json()) as InteractionLogSettings;
      setSettings(data);
      setAllowlistText(emailsToText(data.allowlistEmails));
      setDenylistText(emailsToText(data.denylistEmails));
    } catch (error) {
      setSettingsError(error instanceof Error ? error.message : "Failed to save settings");
    } finally {
      setSettingsSaving(false);
    }
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-6">
      <div>
        <Link href="/" className="mb-2 inline-flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="size-4" />
          Back to chat
        </Link>
        <h1 className="text-2xl font-semibold">Interaction Log</h1>
        <p className="text-muted-foreground text-sm">
          Admin-controlled full-turn chat capture for specific users, separate from message feedback.
        </p>
      </div>

      {storageMode === "local-file" && storageWarning && (
        <Alert>
          <AlertTitle>Local file storage</AlertTitle>
          <AlertDescription>{storageWarning}</AlertDescription>
        </Alert>
      )}

      <section className="space-y-4 rounded-lg border p-4">
        <h2 className="font-medium">Settings</h2>
        {settingsLoading && <div className="text-muted-foreground text-sm">Loading settings...</div>}
        {settingsError && (
          <Alert variant="destructive">
            <AlertDescription>{settingsError}</AlertDescription>
          </Alert>
        )}
        {settings && (
          <div className="space-y-4">
            <div className="flex items-center gap-2">
              <Checkbox
                id="master-enabled"
                checked={settings.masterEnabled}
                onCheckedChange={(checked) => setSettings({ ...settings, masterEnabled: checked === true })}
              />
              <Label htmlFor="master-enabled">Capture is currently active</Label>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Targeting mode</Label>
                <Select
                  value={settings.mode}
                  onValueChange={(value) => setSettings({ ...settings, mode: value as InteractionLogMode })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="allowlist">Allowlist only</SelectItem>
                    <SelectItem value="denylist">Everyone except denylist</SelectItem>
                    <SelectItem value="everyone">Everyone</SelectItem>
                    <SelectItem value="percentage">Percentage sample</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label>Storage identity mode</Label>
                <Select
                  value={settings.storageIdentityMode}
                  onValueChange={(value) =>
                    setSettings({ ...settings, storageIdentityMode: value as InteractionLogIdentityMode })
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="identified">Identified (real email/name)</SelectItem>
                    <SelectItem value="pseudonymous">Pseudonymous (stable hash)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Allowlist emails (one per line)</Label>
                <Textarea rows={3} value={allowlistText} onChange={(e) => setAllowlistText(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label>Denylist emails (one per line)</Label>
                <Textarea rows={3} value={denylistText} onChange={(e) => setDenylistText(e.target.value)} />
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-3">
              <div className="space-y-1.5">
                <Label>Sample percentage (0-100)</Label>
                <Input
                  type="number"
                  min={0}
                  max={100}
                  value={settings.samplePercentage}
                  onChange={(e) => setSettings({ ...settings, samplePercentage: Number(e.target.value) })}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Retention (days)</Label>
                <Input
                  type="number"
                  min={1}
                  value={settings.retentionDays}
                  onChange={(e) => setSettings({ ...settings, retentionDays: Number(e.target.value) })}
                />
                <p className="text-muted-foreground text-xs">
                  Retention resets from each conversation's most recent activity, so an active conversation never expires mid-use.
                </p>
              </div>
              <div className="flex items-center gap-2 pt-6">
                <Checkbox
                  id="disclosure-enabled"
                  checked={settings.disclosureEnabled}
                  onCheckedChange={(checked) => setSettings({ ...settings, disclosureEnabled: checked === true })}
                />
                <Label htmlFor="disclosure-enabled">Show in-scope users a disclosure banner</Label>
              </div>
            </div>

            <div className="flex items-center gap-3">
              <Button onClick={() => void handleSaveSettings()} disabled={settingsSaving}>
                {settingsSaving ? <Loader2 className="size-4 animate-spin" /> : null}
                Save settings
              </Button>
              {settings.updatedAt && (
                <span className="text-muted-foreground text-xs">
                  Last updated {new Date(settings.updatedAt).toLocaleString(undefined, { hour12: false })}
                  {settings.updatedByEmail ? ` by ${settings.updatedByEmail}` : ""}
                </span>
              )}
            </div>
          </div>
        )}
      </section>

      <section className="space-y-4 rounded-lg border p-4">
        <div className="flex items-center justify-between">
          <h2 className="font-medium">Captured conversations ({total})</h2>
          <Button variant="outline" size="sm" onClick={() => void loadEntries()} disabled={entriesLoading}>
            {entriesLoading ? <Loader2 className="size-4 animate-spin" /> : <RefreshCcw className="size-4" />}
            Refresh
          </Button>
        </div>

        <Input
          placeholder="Filter by user email"
          value={userEmailFilter}
          onChange={(e) => setUserEmailFilter(e.target.value)}
        />

        {entriesError && (
          <Alert variant="destructive">
            <AlertDescription>{entriesError}</AlertDescription>
          </Alert>
        )}

        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Captured</TableHead>
              <TableHead>Identity</TableHead>
              <TableHead>Source</TableHead>
              <TableHead>Thread</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {entries.map((entry) => (
              <TableRow key={entry.id} className="cursor-pointer" onClick={() => setSelectedEntry(entry)}>
                <TableCell>{new Date(entry.capturedAt).toLocaleString(undefined, { hour12: false })}</TableCell>
                <TableCell>
                  {entry.identityMode === "pseudonymous" ? (
                    <Badge variant="secondary">{entry.userPseudonym}</Badge>
                  ) : (
                    entry.userEmail ?? entry.userSub ?? "unknown"
                  )}
                </TableCell>
                <TableCell>{entry.source}</TableCell>
                <TableCell>{entry.threadId ?? "-"}</TableCell>
              </TableRow>
            ))}
            {entries.length === 0 && !entriesLoading && (
              <TableRow>
                <TableCell colSpan={4} className="text-muted-foreground text-center">
                  No captured conversations yet.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </section>

      <p className="text-muted-foreground text-xs">Entry storage: {storageMode} ({storageDescription})</p>

      <Sheet open={!!selectedEntry} onOpenChange={(open) => !open && setSelectedEntry(null)}>
        <SheetContent className="w-full overflow-y-auto sm:max-w-xl">
          <SheetHeader>
            <SheetTitle>Interaction log entry</SheetTitle>
          </SheetHeader>
          {selectedEntry && (
            <div className="space-y-4 px-4 pb-4 text-sm">
              <div>
                <div className="font-medium">Identity</div>
                {selectedEntry.identityMode === "pseudonymous" ? (
                  <div>pseudonym: {selectedEntry.userPseudonym}</div>
                ) : (
                  <>
                    <div>email: {selectedEntry.userEmail}</div>
                    <div>name: {selectedEntry.userName}</div>
                    <div>sub: {selectedEntry.userSub}</div>
                  </>
                )}
              </div>
              <div>
                <div className="font-medium">Trace</div>
                <div>senderId: {selectedEntry.senderId}</div>
                <div>threadId: {selectedEntry.threadId ?? "-"}</div>
                <div>source: {selectedEntry.source}</div>
                <div>traceId: {selectedEntry.traceId ?? "-"}</div>
                <div>expires: {new Date(selectedEntry.expiresAt).toLocaleString(undefined, { hour12: false })}</div>
              </div>
              <details>
                <summary className="cursor-pointer font-medium">History ({selectedEntry.history.length})</summary>
                <pre className="mt-2 max-h-96 overflow-auto rounded bg-muted p-2 text-xs">
                  {JSON.stringify(selectedEntry.history, null, 2)}
                </pre>
              </details>
              <details>
                <summary className="cursor-pointer font-medium">Service snapshots</summary>
                <pre className="mt-2 max-h-96 overflow-auto rounded bg-muted p-2 text-xs">
                  {JSON.stringify(selectedEntry.serviceSnapshots, null, 2)}
                </pre>
              </details>
            </div>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}
