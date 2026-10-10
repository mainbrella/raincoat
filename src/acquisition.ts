import { API_ORIGIN } from './auth.ts';

type View = 'leads' | 'events';
type Cursor = string | number;
interface Lead {
  id: string;
  repo: string;
  attribution: Record<string, unknown>;
  createdAt: number;
  userId: string | null;
  contactEmail: string | null;
  capturedAt: number | null;
}
interface AcquisitionEvent {
  sequence: number;
  key: string;
  type: string;
  userId: string | null;
  leadId: string | null;
  occurredAt: number;
  recordedAt: number;
  data: Record<string, unknown>;
  repo: string | null;
  attribution: Record<string, unknown> | null;
}
interface AcquisitionElements {
  page: HTMLElement;
  status: HTMLElement;
  error: HTMLElement;
  table: HTMLElement;
  columns: HTMLTableRowElement;
  rows: HTMLTableSectionElement;
  refresh: HTMLButtonElement;
  previous: HTMLButtonElement;
  next: HTMLButtonElement;
  pagination: HTMLElement;
  views: HTMLElement;
  filters: HTMLFormElement;
  eventFilter: HTMLElement;
}

const PAGE_SIZE = 100;
const EVENT_LABELS: Record<string, string> = {
  'repo.submitted': 'Repository submitted', 'lead.captured': 'Lead captured', 'user.created': 'User created',
  'workspace.started': 'Workspace started', 'workload.activated': 'Workload activated',
  'preview.opened': 'Preview opened', 'developer.qualified': 'Developer qualified',
  'wallet.funded_paid': 'Wallet funded (paid)', 'compute.consumed_paid': 'Compute consumed (paid)',
  'launch.failed': 'Launch failed',
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isTime(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 && value <= 8_640_000_000_000_000;
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === 'string';
}

function isLead(value: unknown): value is Lead {
  return isRecord(value) && typeof value.id === 'string' && value.id.length > 0
    && typeof value.repo === 'string' && isRecord(value.attribution) && isTime(value.createdAt)
    && isNullableString(value.userId) && isNullableString(value.contactEmail)
    && (value.capturedAt === null || isTime(value.capturedAt));
}

function isEvent(value: unknown): value is AcquisitionEvent {
  return isRecord(value) && typeof value.sequence === 'number' && Number.isSafeInteger(value.sequence) && value.sequence > 0
    && typeof value.key === 'string' && typeof value.type === 'string' && Object.hasOwn(EVENT_LABELS, value.type)
    && isNullableString(value.userId) && isNullableString(value.leadId) && isNullableString(value.repo)
    && isTime(value.occurredAt) && isTime(value.recordedAt) && isRecord(value.data)
    && (value.attribution === null || isRecord(value.attribution));
}

function parsePage(value: unknown, view: View, after: Cursor | null) {
  if (!isRecord(value) || value.limit !== PAGE_SIZE) return null;
  const items = value[view];
  if (!Array.isArray(items) || items.length > PAGE_SIZE) return null;
  if (view === 'leads') {
    if (!items.every(isLead)) return null;
    const leads = items as Lead[];
    if (value.next !== (leads.at(-1)?.id ?? null)) return null;
    const seen = new Set<string>();
    for (const [index, lead] of leads.entries()) {
      const prior = leads[index - 1];
      if (seen.has(lead.id) || lead.id === after || (prior && (lead.createdAt > prior.createdAt
        || (lead.createdAt === prior.createdAt && lead.id >= prior.id)))) return null;
      seen.add(lead.id);
    }
  } else {
    if (!items.every(isEvent)) return null;
    let sequence = typeof after === 'number' ? after : 0;
    for (const event of items as AcquisitionEvent[]) {
      if (event.sequence <= sequence) return null;
      sequence = event.sequence;
    }
    if (value.next !== (items.at(-1)?.sequence ?? null)) return null;
  }
  return { items: items as (Lead | AcquisitionEvent)[], next: items.length === PAGE_SIZE ? value.next as Cursor : null };
}

function makeCell(text = '', className?: string): HTMLTableCellElement {
  const cell = document.createElement('td');
  cell.textContent = text;
  if (className) cell.className = className;
  return cell;
}

function formatUtc(value: number): string {
  return new Date(value).toLocaleString('en-US', {
    year: 'numeric', month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
    timeZone: 'UTC', timeZoneName: 'short',
  });
}

function makeTime(value: number): HTMLTimeElement {
  const time = document.createElement('time');
  time.dateTime = new Date(value).toISOString();
  time.textContent = formatUtc(value);
  return time;
}

function makeRepository(repo: string | null): HTMLTableCellElement {
  const cell = makeCell(repo || '—', 'acquisition-repo');
  if (repo && /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo)) {
    const link = document.createElement('a');
    link.href = `https://github.com/${repo}`;
    link.target = '_blank';
    link.rel = 'noreferrer';
    link.textContent = repo;
    cell.replaceChildren(link);
  }
  return cell;
}

function makeDetails(value: unknown): HTMLDetailsElement {
  const details = document.createElement('details');
  const summary = document.createElement('summary');
  summary.textContent = 'View data';
  const source = document.createElement('pre');
  source.className = 'acquisition-source';
  source.textContent = JSON.stringify(value, null, 2);
  details.append(summary, source);
  return details;
}

function attributionSummary(attribution: Record<string, unknown>): string {
  const parts = ['utm_source', 'utm_medium', 'utm_campaign', 'creator', 'entryPage', 'variant']
    .flatMap(key => typeof attribution[key] === 'string' && attribution[key] ? [`${key}: ${attribution[key]}`] : []);
  return parts.join(' · ') || 'No attribution';
}

function eventSummary(event: AcquisitionEvent): string {
  const data = event.data;
  if (event.type === 'wallet.funded_paid' && typeof data.considerationCents === 'number' && Number.isSafeInteger(data.considerationCents)) {
    return `Paid consideration ${(data.considerationCents / 100).toLocaleString(undefined, { style: 'currency', currency: 'USD' })}`;
  }
  if (event.type === 'compute.consumed_paid' && typeof data.paidMicroUsdDelta === 'string' && /^-?\d+$/.test(data.paidMicroUsdDelta)) {
    const amount = BigInt(data.paidMicroUsdDelta);
    const absolute = amount < 0n ? -amount : amount;
    return `Paid compute change ${amount < 0n ? '−' : '+'}$${(absolute / 1_000_000n).toLocaleString()}.${(absolute % 1_000_000n).toString().padStart(6, '0')}`;
  }
  return ['basis', 'rule', 'failureStage', 'errorCode'].flatMap(key =>
    typeof data[key] === 'string' && data[key] ? [`${key}: ${data[key]}`] : []).join(' · ');
}

export function createAcquisitionView(elements: AcquisitionElements, canAccess: () => boolean, onAuthFailure: (status: 401 | 403) => void) {
  const userInput = elements.filters.elements.namedItem('userId') as HTMLInputElement;
  const leadInput = elements.filters.elements.namedItem('leadId') as HTMLInputElement;
  const eventSelect = elements.filters.elements.namedItem('event') as HTMLSelectElement;
  for (const [value, label] of Object.entries(EVENT_LABELS)) eventSelect.add(new Option(label, value));

  let active = false;
  let view: View = 'leads';
  let filters = new URLSearchParams();
  let requestID = 0;
  let controller: AbortController | null = null;
  let positions: (Cursor | null)[] = [null];
  let pageIndex = 0;
  let nextCursor: Cursor | null = null;

  function updateControls() {
    elements.previous.disabled = controller !== null || pageIndex === 0;
    elements.next.disabled = controller !== null || nextCursor === null;
    elements.refresh.disabled = controller !== null;
  }

  function clear() {
    requestID++;
    controller?.abort();
    controller = null;
    positions = [null];
    pageIndex = 0;
    nextCursor = null;
    elements.rows.replaceChildren();
    elements.table.hidden = true;
    elements.pagination.hidden = true;
    elements.error.hidden = true;
    elements.error.textContent = '';
    elements.status.textContent = '';
    elements.page.setAttribute('aria-busy', 'false');
    updateControls();
  }

  function updateView() {
    for (const button of elements.views.querySelectorAll<HTMLButtonElement>('button[data-acquisition-view]')) {
      button.setAttribute('aria-pressed', String(button.dataset.acquisitionView === view));
    }
    elements.eventFilter.hidden = view !== 'events';
    eventSelect.disabled = view !== 'events';
    const labels = view === 'leads'
      ? ['Submitted (UTC)', 'Repository', 'Account', 'Attribution']
      : ['Sequence', 'Occurred (UTC)', 'Event', 'Repository', 'User ID', 'Details'];
    elements.columns.replaceChildren(...labels.map((label, index) => {
      const column = document.createElement('th');
      column.scope = 'col';
      column.textContent = label;
      if (index === 0) column.setAttribute('aria-sort', view === 'leads' ? 'descending' : 'ascending');
      return column;
    }));
    elements.table.setAttribute('aria-label', view === 'leads' ? 'Acquisition leads, newest first' : 'Acquisition events, sequence oldest first');
    elements.table.dataset.view = view;
  }

  function applyFilters() {
    filters = new URLSearchParams();
    if (userInput.value.trim()) filters.set('userId', userInput.value.trim());
    if (leadInput.value.trim()) filters.set('leadId', leadInput.value.trim());
    if (view === 'events' && eventSelect.value) filters.set('event', eventSelect.value);
    clear();
    updateView();
    void load(null, 0);
  }

  function renderLead(lead: Lead): HTMLTableRowElement {
    const row = document.createElement('tr');
    const submitted = makeCell('', 'acquisition-date');
    submitted.append(makeTime(lead.createdAt));
    const repo = makeRepository(lead.repo);
    const events = document.createElement('button');
    events.type = 'button';
    events.className = 'acquisition-lead-events';
    events.textContent = 'View events';
    events.setAttribute('aria-label', `View events for ${lead.repo}, lead ${lead.id}`);
    events.addEventListener('click', () => {
      view = 'events';
      userInput.value = '';
      leadInput.value = lead.id;
      eventSelect.value = '';
      applyFilters();
      elements.page.querySelector<HTMLHeadingElement>('h1')?.focus({ preventScroll: true });
    });
    repo.append(events);
    const account = makeCell(lead.contactEmail || (lead.userId ? 'No contact email' : 'Not captured'));
    if (lead.userId) {
      const id = document.createElement('p');
      id.className = 'acquisition-id';
      id.textContent = lead.userId;
      account.append(id);
    }
    if (lead.capturedAt !== null) {
      const captured = document.createElement('p');
      captured.className = 'acquisition-note';
      captured.append('Captured ', makeTime(lead.capturedAt));
      account.append(captured);
    }
    const attribution = makeCell(attributionSummary(lead.attribution));
    attribution.append(makeDetails(lead));
    row.append(submitted, repo, account, attribution);
    return row;
  }

  function renderEvent(event: AcquisitionEvent): HTMLTableRowElement {
    const row = document.createElement('tr');
    const occurred = makeCell('', 'acquisition-date');
    occurred.append(makeTime(event.occurredAt));
    const eventCell = makeCell(EVENT_LABELS[event.type]);
    const type = document.createElement('p');
    type.className = 'acquisition-note';
    type.textContent = event.type;
    eventCell.append(type);
    const details = makeCell(eventSummary(event));
    if (event.attribution) {
      const attribution = document.createElement('p');
      attribution.className = 'acquisition-note';
      attribution.textContent = attributionSummary(event.attribution);
      details.append(attribution);
    }
    details.append(makeDetails(event));
    row.append(makeCell(event.sequence.toLocaleString(), 'acquisition-sequence'), occurred, eventCell,
      makeRepository(event.repo), makeCell(event.userId || '—', 'acquisition-id'), details);
    return row;
  }

  async function load(after: Cursor | null, targetIndex: number) {
    if (!active || !canAccess()) return;
    controller?.abort();
    const currentController = new AbortController();
    controller = currentController;
    const id = ++requestID;
    updateControls();
    elements.page.setAttribute('aria-busy', 'true');
    elements.error.hidden = true;
    elements.error.textContent = '';
    elements.status.textContent = `Loading ${view}…`;
    const query = new URLSearchParams(filters);
    query.set('limit', String(PAGE_SIZE));
    if (after !== null) query.set('after', String(after));
    try {
      const response = await fetch(`${API_ORIGIN}/admin/acquisition/${view}?${query}`, {
        credentials: 'include', headers: { accept: 'application/json' }, signal: currentController.signal,
      });
      if (id !== requestID || !active || !canAccess()) return;
      if (response.status === 401 || response.status === 403) {
        clear();
        onAuthFailure(response.status);
        return;
      }
      if (response.status === 404) throw new Error('acquisition_disabled');
      const value: unknown = await response.json().catch(() => null);
      if (id !== requestID || !active || !canAccess()) return;
      const result = response.ok ? parsePage(value, view, after) : null;
      if (!result) throw new Error('acquisition_unavailable');
      elements.rows.replaceChildren(...result.items.map(item => 'sequence' in item ? renderEvent(item) : renderLead(item)));
      elements.table.hidden = result.items.length === 0;
      positions = positions.slice(0, targetIndex);
      positions.push(after);
      pageIndex = targetIndex;
      nextCursor = result.next;
      const count = result.items.length;
      const order = view === 'leads' ? 'Newest first' : 'Sequence oldest first';
      elements.status.textContent = count
        ? `${count.toLocaleString()} ${view === 'leads' ? (count === 1 ? 'lead' : 'leads') : (count === 1 ? 'event' : 'events')} · Page ${pageIndex + 1} · ${order}`
        : `No ${view}${pageIndex > 0 ? ' on this page' : filters.size ? ' match these filters' : ' yet'}.`;
      elements.pagination.hidden = pageIndex === 0 && nextCursor === null;
    } catch (cause) {
      if (id !== requestID || currentController.signal.aborted || !active) return;
      elements.status.textContent = `Could not load ${view}.`;
      elements.error.textContent = cause instanceof Error && cause.message === 'acquisition_disabled'
        ? 'Acquisition review is unavailable. The backend must have acquisition enabled and migrations 021 and 022 applied.'
        : 'Check your connection and retry with the page controls or Refresh.';
      elements.error.hidden = false;
    } finally {
      if (id === requestID) {
        controller = null;
        elements.page.setAttribute('aria-busy', 'false');
        updateControls();
      }
    }
  }

  elements.views.addEventListener('click', event => {
    const button = event.target instanceof Element ? event.target.closest<HTMLButtonElement>('button[data-acquisition-view]') : null;
    const nextView = button?.dataset.acquisitionView;
    if ((nextView !== 'leads' && nextView !== 'events') || nextView === view) return;
    view = nextView;
    applyFilters();
  });
  elements.filters.addEventListener('submit', event => {
    event.preventDefault();
    applyFilters();
  });
  elements.filters.addEventListener('reset', event => {
    event.preventDefault();
    userInput.value = '';
    leadInput.value = '';
    eventSelect.value = '';
    applyFilters();
  });
  elements.refresh.addEventListener('click', () => {
    clear();
    void load(null, 0);
  });
  elements.previous.addEventListener('click', () => {
    if (pageIndex > 0 && !controller) void load(positions[pageIndex - 1], pageIndex - 1);
  });
  elements.next.addEventListener('click', () => {
    if (nextCursor !== null && !controller) void load(nextCursor, pageIndex + 1);
  });

  updateView();
  return {
    setActive(value: boolean) {
      if (active === value) return;
      active = value;
      clear();
      if (active) void load(null, 0);
      else {
        view = 'leads';
        filters = new URLSearchParams();
        userInput.value = '';
        leadInput.value = '';
        eventSelect.value = '';
        updateView();
      }
    },
  };
}
