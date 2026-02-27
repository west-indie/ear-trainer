import { readLocal, writeLocal } from "./storage";

export type AnalyticsEventName =
  | "page_view"
  | "session_start"
  | "session_complete"
  | "session_abandon"
  | "question_answered"
  | "sync_push"
  | "sync_pull"
  | "export_snapshot"
  | "import_snapshot"
  | "authoring_saved";

export type AnalyticsEvent = {
  id: string;
  name: AnalyticsEventName;
  ts: number;
  route: string;
  data?: Record<string, string | number | boolean | null>;
};

export type AnalyticsSummary = {
  totalEvents: number;
  pageViews: number;
  completedSessions: number;
  abandonedSessions: number;
  answerCount: number;
  completionRate: number;
  topRoutes: Array<{ route: string; count: number }>;
  dropOffRoutes: Array<{ route: string; count: number }>;
};

const KEY = "et_analytics_v1";
const EVENT = "et_analytics_changed";
const LIMIT = 600;

function eventId() {
  return `evt_${Math.random().toString(36).slice(2, 10)}`;
}

function emitAnalyticsChanged() {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(EVENT));
  }
}

export function getAnalyticsEvents() {
  return readLocal<AnalyticsEvent[]>(KEY, []);
}

export function trackEvent(
  name: AnalyticsEventName,
  route: string,
  data?: AnalyticsEvent["data"],
) {
  const events = getAnalyticsEvents();
  events.push({
    id: eventId(),
    name,
    route,
    data,
    ts: Date.now(),
  });
  writeLocal(KEY, events.slice(-LIMIT));
  emitAnalyticsChanged();
}

export function clearAnalytics() {
  writeLocal(KEY, []);
  emitAnalyticsChanged();
}

export function getAnalyticsSummary(): AnalyticsSummary {
  const events = getAnalyticsEvents();
  const pageViews = events.filter((event) => event.name === "page_view").length;
  const completedSessions = events.filter((event) => event.name === "session_complete").length;
  const abandonedSessions = events.filter((event) => event.name === "session_abandon").length;
  const answerCount = events.filter((event) => event.name === "question_answered").length;

  const routeCounts = new Map<string, number>();
  const dropOffCounts = new Map<string, number>();

  for (const event of events) {
    routeCounts.set(event.route, (routeCounts.get(event.route) ?? 0) + 1);
    if (event.name === "session_abandon") {
      dropOffCounts.set(event.route, (dropOffCounts.get(event.route) ?? 0) + 1);
    }
  }

  const toArray = (map: Map<string, number>) =>
    [...map.entries()]
      .map(([route, count]) => ({ route, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);

  const started = completedSessions + abandonedSessions;

  return {
    totalEvents: events.length,
    pageViews,
    completedSessions,
    abandonedSessions,
    answerCount,
    completionRate: started > 0 ? completedSessions / started : 0,
    topRoutes: toArray(routeCounts),
    dropOffRoutes: toArray(dropOffCounts),
  };
}

export function subscribeAnalytics(listener: () => void) {
  if (typeof window === "undefined") return () => {};

  const onStorage = (event: StorageEvent) => {
    if (event.key === KEY) listener();
  };
  const onEvent = () => listener();

  window.addEventListener("storage", onStorage);
  window.addEventListener(EVENT, onEvent);

  return () => {
    window.removeEventListener("storage", onStorage);
    window.removeEventListener(EVENT, onEvent);
  };
}
