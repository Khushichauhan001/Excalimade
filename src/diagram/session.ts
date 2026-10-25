// Module-level state shared between the eager register module and the lazily loaded dialogs.
// Kept dependency-free so importing it from register.ts costs nothing.
import type { ChartData } from "./chart/table";

export interface AiHistoryItem {
  id: number;
  prompt: string;
  mermaid?: string;
  error?: string;
}

export const session = {
  /** Pasted table waiting for the chart dialog. */
  chart: null as null | { raw: string; data: ChartData | null },
  /** Mermaid source to pre-fill the Mermaid dialog with (paste, "Open in Mermaid editor"). */
  mermaidDraft: null as string | null,
  /** Text-to-diagram prompt history for this browser session. */
  aiHistory: [] as AiHistoryItem[],
  aiUsage: {} as Partial<Record<"text-to-diagram" | "wireframe-to-code", { remaining: number; limit: number }>>,
  /** Last generated wireframe HTML per frame id (survives closing the dialog). */
  wireframeResults: new Map<string, string>(),
};
