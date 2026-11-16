export type Destination = "watch" | "work" | "briefing";
export interface Evidence {
  label: string;
  value: number | null;
  units: string;
  time: number | null;
  quality: string;
  source?: string;
  issued?: number;
  start?: number;
  end?: number;
  points?: Array<{ time: number; value: number }>;
}
export interface Concern {
  id: string;
  kind: string;
  name: string;
  change: string;
  time: number | null;
  timeLabel: string;
  quality: string;
  nextAction: string;
  group: number;
  review: boolean;
  features: any[];
  evidence: Evidence[];
  details: string[];
  links: Array<{ label: string; url: string }>;
  revision?: string;
  alertTiming?: { start: number | null; end: number | null };
  watershed?: string;
  private?: boolean;
  mapGap?: string;
  memberIds?: string[];
  trigger?: { lines: string[]; features?: any[]; relatedIds?: string[]; firstCharts?: string[]; question: string };
  utilityUpdate?: {
    publisher: string; text: string; customers: number | null;
    restoration: { key: string; label: string; passed: boolean };
    estimateChange?: { type: string; previous: string; current: string; detected: number };
  };
}
export interface FeedState {
  concerns: Concern[];
  reference: Concern[];
  features: any[];
  errors: Record<string, string>;
  checked: Record<string, number>;
  loading: boolean;
  bundle?: any;
  watersheds?: any;
  timeline?: any;
  counties?: any[];
}
