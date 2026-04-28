"use client";

import { useCallback } from "react";
import { Download, FileJson, FileSpreadsheet, HelpCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
  PopoverHeader,
  PopoverTitle,
  PopoverDescription,
} from "@/components/ui/popover";
import {
  buildStageTimesCsv,
  buildStageTimesExport,
  stageTimesFilenameStem,
} from "@/lib/stage-times-export";
import type { CompareResponse, MatchResponse } from "@/lib/types";

interface Props {
  ct: string;
  id: string;
  match: MatchResponse;
  compareData: CompareResponse;
  selectedIds: number[];
}

function downloadBlob(content: string, filename: string, mimeType: string) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function StageTimesExport({ ct, id, match, compareData, selectedIds }: Props) {
  const buildExport = useCallback(() => {
    return buildStageTimesExport({
      match: { ct, id, name: match.name },
      compareData,
      competitors: match.competitors,
      squads: match.squads,
      selectedIds,
    });
  }, [ct, id, match, compareData, selectedIds]);

  const onDownloadJson = () => {
    const data = buildExport();
    const json = JSON.stringify(data, null, 2);
    downloadBlob(
      json,
      `${stageTimesFilenameStem(data.match)}.json`,
      "application/json;charset=utf-8",
    );
  };

  const onDownloadCsv = () => {
    const data = buildExport();
    const csv = buildStageTimesCsv(data);
    downloadBlob(
      csv,
      `${stageTimesFilenameStem(data.match)}.csv`,
      "text/csv;charset=utf-8",
    );
  };

  const disabled = selectedIds.length === 0;

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-1.5 flex-wrap">
        <h3 className="text-sm font-semibold">Export stage times</h3>
        <Popover>
          <PopoverTrigger asChild>
            <button
              className="text-muted-foreground hover:text-foreground rounded p-0.5 transition-colors focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring"
              aria-label="About stage times export"
            >
              <HelpCircle className="w-3.5 h-3.5" aria-hidden="true" />
            </button>
          </PopoverTrigger>
          <PopoverContent className="w-80" side="bottom" align="start">
            <PopoverHeader>
              <PopoverTitle>Export stage times</PopoverTitle>
              <PopoverDescription>
                Per-stage time and timestamp for each selected competitor, formatted for video editing.
              </PopoverDescription>
            </PopoverHeader>
            <div className="text-xs text-muted-foreground space-y-1.5 mt-2">
              <p>
                <strong>JSON</strong> — one object per competitor with a stages array. Suitable for scripts that auto-cut a recording into per-stage clips.
              </p>
              <p>
                <strong>CSV</strong> — flat rows sorted by competitor then stage. Opens in Excel and imports cleanly into Resolve / Premiere as markers.
              </p>
              <p>
                Each row carries <code>time_seconds</code> (raw stage time) and <code>scorecard_updated_at</code> (ISO timestamp from the RO submission) — useful for aligning a stage run to a long match recording.
              </p>
              <p>
                The export covers the competitors you have selected in the comparison view above.
              </p>
            </div>
          </PopoverContent>
        </Popover>
      </div>

      <p className="text-xs text-muted-foreground">
        Stage times for the competitors you&apos;ve selected, formatted for video editing.
      </p>

      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={onDownloadJson}
          disabled={disabled}
          className="gap-1.5"
        >
          <FileJson className="w-4 h-4" aria-hidden="true" />
          Download JSON
          <Download className="w-3.5 h-3.5 opacity-60" aria-hidden="true" />
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={onDownloadCsv}
          disabled={disabled}
          className="gap-1.5"
        >
          <FileSpreadsheet className="w-4 h-4" aria-hidden="true" />
          Download CSV
          <Download className="w-3.5 h-3.5 opacity-60" aria-hidden="true" />
        </Button>
      </div>

      {disabled && (
        <p className="text-xs text-muted-foreground" role="status">
          Select at least one competitor in the comparison above to enable export.
        </p>
      )}
    </div>
  );
}
