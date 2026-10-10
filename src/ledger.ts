import { API_ORIGIN } from './auth.ts';

type LedgerEventType = 'funding' | 'refund' | 'stripe_balance' | 'funding_state' | 'compute' | 'legacy_usage' | 'wallet_checkpoint';
interface LedgerEntry {
  sequence: number;
  event_key: string;
  user_id: string;
  event_type: LedgerEventType;
  occurred_at: number;
  recorded_at: number;
  data: Record<string, unknown>;
}
interface LedgerPage {
  entries: LedgerEntry[];
  throughSequence: number;
  nextCursor: number | null;
}
interface PagePosition { after: number; throughSequence?: number; }
interface LedgerElements {
  page: HTMLElement;
  status: HTMLElement;
  error: HTMLElement;
  table: HTMLElement;
  rows: HTMLTableSectionElement;
  refresh: HTMLButtonElement;
  previous: HTMLButtonElement;
  next: HTMLButtonElement;
  pagination: HTMLElement;
}

const PAGE_SIZE = 100;
const EVENT_LABELS: Record<LedgerEventType, string> = {
  funding: 'Funding', refund: 'Refund', stripe_balance: 'Stripe balance', funding_state: 'Funding state',
  compute: 'Compute usage', legacy_usage: 'Legacy usage', wallet_checkpoint: 'Wallet checkpoint',
};
const MAX_DATE_MS = 8_640_000_000_000_000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isSafeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value);
}

function isLedgerEntry(value: unknown): value is LedgerEntry {
  return isRecord(value)
    && isSafeInteger(value.sequence) && value.sequence > 0
    && typeof value.event_key === 'string' && value.event_key.length > 0
    && typeof value.user_id === 'string' && value.user_id.length > 0
    && typeof value.event_type === 'string' && Object.hasOwn(EVENT_LABELS, value.event_type)
    && isSafeInteger(value.occurred_at) && value.occurred_at >= 0 && value.occurred_at <= MAX_DATE_MS
    && isSafeInteger(value.recorded_at) && value.recorded_at >= 0 && value.recorded_at <= MAX_DATE_MS
    && isRecord(value.data);
}

function parsePage(value: unknown, position: PagePosition): LedgerPage | null {
  if (!isRecord(value) || !Array.isArray(value.entries)
    || !isSafeInteger(value.throughSequence) || value.throughSequence < position.after
    || (position.throughSequence !== undefined && value.throughSequence !== position.throughSequence)
    || !(value.nextCursor === null || isSafeInteger(value.nextCursor))) return null;
  const entries = value.entries;
  if (!entries.every(isLedgerEntry)) return null;
  let previous = position.after;
  for (const entry of entries as LedgerEntry[]) {
    if (entry.sequence <= previous || entry.sequence > value.throughSequence) return null;
    previous = entry.sequence;
  }
  const nextCursor = value.nextCursor as number | null;
  if (entries.length > PAGE_SIZE) return null;
  if (nextCursor !== null && (entries.length === 0 || nextCursor <= position.after
    || nextCursor !== previous || nextCursor >= value.throughSequence)) return null;
  return { entries: entries as LedgerEntry[], throughSequence: value.throughSequence, nextCursor };
}

function formatCents(value: unknown): string | null {
  if (!isSafeInteger(value)) return null;
  const amount = (value / 100).toLocaleString(undefined, { style: 'currency', currency: 'USD' });
  return amount;
}

function formatNumber(value: unknown): string | null {
  return isSafeInteger(value) ? value.toLocaleString() : null;
}

function formatBoolean(value: unknown): string | null {
  return typeof value === 'boolean' ? (value ? 'Yes' : 'No') : null;
}

function addDetail(parts: string[], label: string, value: string | null) {
  if (value !== null) parts.push(`${label} ${value}`);
}

function summary(entry: LedgerEntry): string {
  const data = entry.data;
  const parts: string[] = [];
  switch (entry.event_type) {
    case 'funding':
      addDetail(parts, 'Paid', formatCents(data.amountPaidCents));
      addDetail(parts, 'Credit', formatCents(data.creditCents));
      addDetail(parts, 'Tax', formatCents(data.taxCollectedCents));
      break;
    case 'refund':
      addDetail(parts, 'Refund', formatCents(data.amountCents));
      if (Object.hasOwn(data, 'taxRefundedCents')) {
        addDetail(parts, 'Tax refunded', data.taxRefundedCents === null ? 'unknown' : formatCents(data.taxRefundedCents));
      }
      break;
    case 'stripe_balance':
      addDetail(parts, 'Amount', formatCents(data.amountCents));
      addDetail(parts, 'Fee', formatCents(data.processingFeeCents));
      addDetail(parts, 'Net', formatCents(data.netCents));
      if (typeof data.category === 'string') parts.push(data.category);
      break;
    case 'funding_state':
      addDetail(parts, 'Credit', formatCents(data.creditCents));
      addDetail(parts, 'Revoked', formatCents(data.revokedCents));
      addDetail(parts, 'Refunded credit', formatCents(data.refundedCreditCents));
      addDetail(parts, 'Disputed', formatBoolean(data.disputed));
      break;
    case 'compute':
      addDetail(parts, 'Usage', formatNumber(data.unitMs) === null ? null : `${formatNumber(data.unitMs)} weighted ms`);
      if (typeof data.name === 'string' && data.name) parts.push(data.name);
      if (typeof data.size === 'string' && data.size) parts.push(data.size);
      break;
    case 'legacy_usage':
      addDetail(parts, 'Usage', formatNumber(data.unitMs) === null ? null : `${formatNumber(data.unitMs)} weighted ms`);
      break;
    case 'wallet_checkpoint':
      addDetail(parts, 'Used', formatNumber(data.usedUnitMs) === null ? null : `${formatNumber(data.usedUnitMs)} weighted ms`);
      break;
  }
  return parts.length ? parts.join(' · ') : '—';
}

function formatUtc(value: number): string {
  return new Date(value).toLocaleString('en-US', {
    year: 'numeric', month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
    timeZone: 'UTC', timeZoneName: 'short',
  });
}

function makeCell(text: string, className?: string): HTMLTableCellElement {
  const cell = document.createElement('td');
  cell.textContent = text;
  if (className) cell.className = className;
  return cell;
}

function renderEntry(entry: LedgerEntry): HTMLTableRowElement {
  const row = document.createElement('tr');
  row.append(makeCell(entry.sequence.toLocaleString(), 'ledger-sequence'));
  const occurred = document.createElement('td');
  const time = document.createElement('time');
  time.dateTime = new Date(entry.occurred_at).toISOString();
  time.textContent = formatUtc(entry.occurred_at);
  occurred.append(time);
  row.append(occurred);
  row.append(makeCell(EVENT_LABELS[entry.event_type]));
  row.append(makeCell(entry.user_id, 'ledger-user-id'));

  const detailsCell = document.createElement('td');
  const eventSummary = document.createElement('p');
  eventSummary.className = 'ledger-event-summary';
  eventSummary.textContent = summary(entry);
  const detail = document.createElement('details');
  const summaryElement = document.createElement('summary');
  summaryElement.textContent = 'View data';
  const recorded = document.createElement('p');
  recorded.className = 'ledger-recorded';
  recorded.textContent = `Recorded ${formatUtc(entry.recorded_at)}`;
  const source = document.createElement('pre');
  source.className = 'ledger-source';
  source.textContent = JSON.stringify(entry, null, 2);
  detail.append(summaryElement, recorded, source);
  detailsCell.append(eventSummary, detail);
  row.append(detailsCell);
  return row;
}

export function createLedgerView(elements: LedgerElements, canAccess: () => boolean, onAuthFailure: (status: 401 | 403) => void) {
  let active = false;
  let requestID = 0;
  let controller: AbortController | null = null;
  let history: PagePosition[] = [{ after: 0 }];
  let pageIndex = 0;
  let nextCursor: number | null = null;

  function abortRequest() {
    requestID++;
    controller?.abort();
    controller = null;
    elements.refresh.disabled = false;
    elements.previous.disabled = pageIndex === 0;
    elements.next.disabled = nextCursor === null;
    elements.page.setAttribute('aria-busy', 'false');
  }

  function clear() {
    abortRequest();
    history = [{ after: 0 }];
    pageIndex = 0;
    nextCursor = null;
    elements.rows.replaceChildren();
    elements.table.hidden = true;
    elements.pagination.hidden = true;
    elements.error.hidden = true;
    elements.error.textContent = '';
    elements.status.textContent = '';
    elements.previous.disabled = true;
    elements.next.disabled = true;
  }

  async function load(position: PagePosition, mode: 'initial' | 'refresh' | 'next' | 'previous') {
    if (!active || !canAccess()) return;
    controller?.abort();
    const currentController = new AbortController();
    controller = currentController;
    const id = ++requestID;
    const preserve = mode === 'next' || mode === 'previous';
    elements.refresh.disabled = true;
    elements.previous.disabled = true;
    elements.next.disabled = true;
    elements.page.setAttribute('aria-busy', 'true');
    elements.error.hidden = true;
    elements.error.textContent = '';
    elements.status.textContent = preserve ? 'Loading ledger page…' : 'Loading ledger…';
    if (!preserve) {
      elements.rows.replaceChildren();
      elements.table.hidden = true;
      elements.pagination.hidden = true;
    }

    const query = new URLSearchParams({ after: String(position.after), limit: String(PAGE_SIZE), format: 'json' });
    if (position.throughSequence !== undefined) query.set('throughSequence', String(position.throughSequence));
    try {
      const response = await fetch(`${API_ORIGIN}/admin/accounting/ledger?${query}`, {
        credentials: 'include', headers: { accept: 'application/json' }, signal: currentController.signal,
      });
      if (id !== requestID || !active || !canAccess()) return;
      if (response.status === 401 || response.status === 403) {
        clear();
        onAuthFailure(response.status);
        return;
      }
      const value: unknown = await response.json().catch(() => null);
      if (id !== requestID || !active || !canAccess()) return;
      const result = response.ok ? parsePage(value, position) : null;
      if (!result) throw new Error('ledger_unavailable');

      const rows = document.createDocumentFragment();
      for (const entry of result.entries) rows.append(renderEntry(entry));
      elements.rows.replaceChildren(rows);
      elements.table.hidden = result.entries.length === 0;
      nextCursor = result.nextCursor;
      if (mode === 'refresh' || mode === 'initial') {
        history = [{ after: 0, throughSequence: result.throughSequence }];
        pageIndex = 0;
      } else if (mode === 'next') {
        history = history.slice(0, pageIndex + 1);
        history.push({ after: position.after, throughSequence: result.throughSequence });
        pageIndex++;
      } else {
        pageIndex = Math.max(0, pageIndex - 1);
      }
      const pageStart = result.entries[0]?.sequence;
      const pageEnd = result.entries.at(-1)?.sequence;
      if (result.entries.length) {
        elements.status.textContent = `Sequences ${pageStart?.toLocaleString()}–${pageEnd?.toLocaleString()} · Snapshot through ${result.throughSequence.toLocaleString()}`;
        elements.pagination.hidden = false;
      } else {
        elements.status.textContent = history.length > 1
          ? `No entries on this page · Snapshot through ${result.throughSequence.toLocaleString()}`
          : 'No ledger entries.';
        elements.pagination.hidden = true;
      }
      elements.previous.disabled = pageIndex === 0;
      elements.next.disabled = nextCursor === null;
    } catch {
      if (id !== requestID || currentController.signal.aborted || !active) return;
      elements.status.textContent = preserve
        ? `Could not load page ${pageIndex + (mode === 'next' ? 2 : 0)}.`
        : 'Could not load the ledger.';
      elements.error.textContent = 'Check your connection and retry with the page controls or Refresh.';
      elements.error.hidden = false;
      elements.previous.disabled = pageIndex === 0;
      elements.next.disabled = nextCursor === null;
    } finally {
      if (id === requestID) {
        controller = null;
        elements.refresh.disabled = false;
        elements.page.setAttribute('aria-busy', 'false');
      }
    }
  }

  elements.refresh.addEventListener('click', () => {
    history = [{ after: 0 }];
    pageIndex = 0;
    nextCursor = null;
    load({ after: 0 }, 'refresh');
  });
  elements.previous.addEventListener('click', () => {
    if (pageIndex <= 0) return;
    load(history[pageIndex - 1], 'previous');
  });
  elements.next.addEventListener('click', () => {
    if (nextCursor === null) return;
    const current = history[pageIndex];
    load({ after: nextCursor, throughSequence: current.throughSequence }, 'next');
  });

  return {
    setActive(value: boolean) {
      if (active === value) return;
      active = value;
      if (!active) clear();
      else {
        history = [{ after: 0 }];
        pageIndex = 0;
        nextCursor = null;
        void load({ after: 0 }, 'initial');
      }
    },
  };
}
