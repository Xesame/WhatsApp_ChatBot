/** Calls to the API (same address as this page; see vite.config.ts). */

export class ApiError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export async function api<T>(
  path: string,
  init: { method?: string; body?: unknown } = {},
): Promise<T> {
  const response = await fetch(path, {
    method: init.method ?? 'GET',
    credentials: 'same-origin',
    headers: init.body === undefined ? {} : { 'content-type': 'application/json' },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
  const text = await response.text();
  const json = text ? (JSON.parse(text) as unknown) : null;
  if (!response.ok) {
    const body = json as { error?: string; message?: string; issues?: string[] } | null;
    const message = [
      body?.error ?? body?.message ?? response.statusText,
      ...(body?.issues ?? []),
    ].join(': ');
    throw new ApiError(response.status, message);
  }
  return json as T;
}

// Response shapes (dates arrive as ISO strings).

export interface Owner {
  id: string;
  name: string;
  email: string;
  role: string;
}

export interface Connection {
  account: string;
  state: string;
  qrSvg: string | null;
  pairingCode: string | null;
  lastConnectedAt: string | null;
  lastDisconnectedAt: string | null;
  lastDisconnectReason: string | null;
  lastMessageAt: string | null;
  updatedAt: string;
}

export interface Group {
  id: number;
  name: string | null;
  watched: boolean;
  sourceType: 'developer' | 'broker' | null;
  isMember: boolean;
  lastMessageAt: string | null;
  messages: number;
}

export type UnitRecord = Record<string, unknown> & {
  id: number;
  status: string;
  confidence: number;
  needsReview: boolean;
  reviewReasons: string[];
  priceCurrency: string;
};

export interface Source {
  messageId: number;
  role: string;
  sentAt: string;
  groupName: string | null;
  text: string | null;
  media: {
    id: number;
    kind: string;
    mimeType: string | null;
    status: string;
    derivedText: string | null;
    derivedMethod: string | null;
  } | null;
}

export interface PriceRow {
  id: number;
  minPrice: number | null;
  maxPrice: number | null;
  priceCurrency: string;
  downPayment: number | null;
  installmentYears: number | null;
  observedAt: string;
}

export interface UnitView {
  unit: UnitRecord;
  names: { developer: string | null; project: string | null; city: string | null };
  sources: Source[];
  prices: PriceRow[];
}

export interface Entity {
  id: number;
  nameEn: string;
  nameAr: string;
  developerId?: number;
  cityId?: number;
  aliases: { id: number; alias: string; source: string }[];
  unitCount: number;
}
export type EntityKind = 'city' | 'developer' | 'project';

export interface Stats {
  days: {
    day: string;
    messages: number;
    processed: number;
    skipped: number;
    failed: number;
    modelCalls: number;
    costUsd: number;
    inputTokens: number;
    outputTokens: number;
  }[];
  extractionSuccessRate: number | null;
  needsReviewRate: number | null;
  units: Record<string, number>;
  needsReview: number;
}

export interface FailedJob {
  id: string;
  queue: string;
  data: unknown;
  error: string | null;
  failedAt: string | null;
  retries: number;
}

export interface Settings {
  usdEgpRate: number | null;
  usdEgpRateFallback: number | null;
}

// Firm dashboard (Phase 6)

export interface Me {
  id: string;
  name: string;
  email: string;
  role: 'owner' | 'firm_admin' | 'agent';
  locale: 'en' | 'ar';
  firm: { id: number; name: string } | null;
}

export interface Names {
  en: string;
  ar: string;
}

export interface SearchItem {
  id: number;
  project: Names | null;
  developer: Names | null;
  city: Names | null;
  category: string | null;
  unitType: string | null;
  bedrooms: number | null;
  bathrooms: number | null;
  minArea: number | null;
  maxArea: number | null;
  minPrice: number | null;
  maxPrice: number | null;
  priceCurrency: string;
  minPriceEgp: number | null;
  maxPriceEgp: number | null;
  pricePerSqm: number | null;
  previousMinPrice: number | null;
  downPayment: number | null;
  installmentYears: number | null;
  deliveryYear: number | null;
  readyToMove: boolean;
  finishingSpecs: string | null;
  status: string;
  sourceCount: number;
  firstSeenAt: string;
  lastSeenAt: string;
}

export interface SearchPage {
  items: SearchItem[];
  total: number;
  page: number;
  pageSize: number;
}

export interface FilterOptions {
  cities: (Names & { id: number })[];
  developers: (Names & { id: number })[];
  projects: (Names & { id: number; developerId: number; cityId: number })[];
}

export interface ListingDetail {
  unit: Record<string, unknown> & { id: number; status: string; priceCurrency: string };
  names: { project: Names | null; developer: Names | null; city: Names | null };
  prices: {
    minPrice: number | null;
    maxPrice: number | null;
    priceCurrency: string;
    downPayment: number | null;
    installmentYears: number | null;
    observedAt: string;
  }[];
  sources: {
    role: string;
    sentAt: string;
    postedIn: string | null;
    text: string | null;
    media: { id: number; kind: string; mimeType: string | null; text: string | null } | null;
  }[];
  notes: {
    id: number;
    body: string;
    authorName: string | null;
    mine: boolean;
    createdAt: string;
  }[];
  usdEgpRate: number | null;
}

export interface SavedSearch {
  id: number;
  name: string;
  filters: Record<string, unknown>;
  alertChannel: 'none' | 'whatsapp' | 'telegram';
  active: boolean;
  ownerName: string | null;
  mine: boolean;
  createdAt: string;
}

export interface TeamMember {
  id: string;
  name: string;
  email: string;
  role: string;
  locale: string;
  status: 'invited' | 'active' | 'removed';
  createdAt: string;
}

export interface CreatedLink {
  link: string;
  expiresAt: string;
  purpose?: 'invite' | 'reset';
  userId?: string;
}

export interface UsageRow {
  day: string;
  kind: string;
  count: number;
}

export interface FirmSummary {
  id: number;
  name: string;
  plan: string;
  status: 'active' | 'suspended';
  maxUsers: number;
  contractStart: string | null;
  contractEnd: string | null;
  notes: string | null;
  activeUsers: number;
  searches30d: number;
  exports30d: number;
  createdAt: string;
}
