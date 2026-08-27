import { beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import phasesJson from '../../../shared/data/phases.json';
import type { PhaseTemplate } from '@shared/types';
import { openDb, type Db } from '../db/client';
import { importTemplates, seedDemoData } from '../db/seed';
import * as schema from '../db/schema';
import {
  addCustomRow,
  createCity,
  createProject,
  deleteCustomRow,
  moveBlok,
  moveTask,
  submitList,
  type ListRef,
} from '../db/mutations';

const templates = phasesJson as PhaseTemplate[];

let db: Db;
let ernestId: string;
let piaId: string;
let leidenId: string;
let amsterdamId: string;

beforeEach(() => {
  db = openDb(':memory:');
  importTemplates(db, templates);
  seedDemoData(db, templates);
  ernestId = db.select().from(schema.users).where(eq(schema.users.email, 'ernest@1828.nl')).get()!.id;
  piaId = db.select().from(schema.users).where(eq(schema.users.email, 'pia@1828.nl')).get()!.id;
  leidenId = db.select().from(schema.cities).where(eq(schema.cities.name, 'Leiden')).get()!.id;
  amsterdamId = db.select().from(schema.cities).where(eq(schema.cities.name, 'Amsterdam')).get()!
    .id;
});

function cityTasks(cityId: string): (typeof schema.tasks.$inferSelect)[] {
  return db
    .select()
    .from(schema.tasks)
    .where(eq(schema.tasks.cityId, cityId))
    .orderBy(schema.tasks.position)
    .all();
}

const keyOf = (row: { step: string; blok: string }): string => `${row.step}||${row.blok}`;

describe('createCity (Kotlin + Stad parity)', () => {
  it('owner creates a city with the full Gemeenteontwikkeling template', () => {
    const result = createCity(db, templates, '  Rotterdam ', ernestId);
    expect(result.ok).toBe(true);
    const id = result.ok ? result.id! : '';
    const rows = cityTasks(id);
    expect(rows).toHaveLength(26); // Gemeenteontwikkeling template count
    expect(rows.every((row) => row.status === 'OPEN' && !row.isCustom)).toBe(true);
    const city = db.select().from(schema.cities).where(eq(schema.cities.id, id)).get()!;
    expect(city.name).toBe('Rotterdam'); // trimmed
    expect(city.submitted).toBe(false); // city gate starts closed
    expect(city.approved).toBe(false);
  });

  it('rejects duplicates, blank names, and non-owners', () => {
    expect(createCity(db, templates, 'Leiden', ernestId)).toEqual({
      ok: false,
      error: 'DUPLICATE',
    });
    expect(createCity(db, templates, '   ', ernestId)).toEqual({
      ok: false,
      error: 'INVALID_NAME',
    });
    expect(createCity(db, templates, 'Rotterdam', piaId)).toEqual({
      ok: false,
      error: 'NOT_OWNER',
    });
  });
});

describe('createProject (Kotlin + Project parity)', () => {
  it('a colleague with city access creates a project with all 9 phases', () => {
    const result = createProject(db, templates, 'Leiden Zuid', leidenId, piaId);
    expect(result.ok).toBe(true);
    const id = result.ok ? result.id! : '';
    const phases = db
      .select()
      .from(schema.phases)
      .where(eq(schema.phases.projectId, id))
      .orderBy(schema.phases.idx)
      .all();
    expect(phases).toHaveLength(9);
    expect(phases[0]!.sheet).toContain('Acquisitie');
    expect(phases.every((ph) => !ph.submitted && !ph.approved)).toBe(true);
  });

  it('enforces city access, global name uniqueness, and a real parent city', () => {
    // Pia's only grant is Leiden.
    expect(createProject(db, templates, 'Nieuw West', amsterdamId, piaId)).toEqual({
      ok: false,
      error: 'NO_ACCESS',
    });
    // Project names are unique across ALL cities (Kotlin AppState.addProject).
    expect(createProject(db, templates, 'Pieterskwartier', amsterdamId, ernestId)).toEqual({
      ok: false,
      error: 'DUPLICATE',
    });
    expect(createProject(db, templates, 'X', 'no-such-city', ernestId)).toEqual({
      ok: false,
      error: 'NOT_FOUND',
    });
  });
});

describe('custom rows (Kotlin admin mode, lock bug fixed)', () => {
  it('adds at the bottom of its blok with empty RASCI and custom flag', () => {
    const ref: ListRef = { cityId: amsterdamId };
    const before = cityTasks(amsterdamId);
    const firstKey = keyOf(before[0]!);
    const lastOfBlok = before.filter((row) => keyOf(row) === firstKey).length - 1;

    const result = addCustomRow(db, ref, firstKey, ' Extra deliverable ', ernestId);
    expect(result.ok).toBe(true);

    const after = cityTasks(amsterdamId);
    expect(after).toHaveLength(before.length + 1);
    const added = after[lastOfBlok + 1]!; // directly under its blok group
    expect(added.deliverable).toBe('Extra deliverable');
    expect(added.isCustom).toBe(true);
    expect(added.r + added.a + added.s + added.c).toBe(''); // empty RASCI
    expect(keyOf(added)).toBe(firstKey);
    // Positions stay dense and ordered.
    expect(after.map((row) => row.position)).toEqual(after.map((_row, i) => i));
  });

  it('is open to any active user but refuses locked lists (Ernest: add-row for everyone)', () => {
    const key = keyOf(cityTasks(amsterdamId)[0]!);
    expect(addCustomRow(db, { cityId: amsterdamId }, key, 'Door Pia', piaId).ok).toBe(true);
    expect(addCustomRow(db, { cityId: amsterdamId }, key, 'X', 'ghost')).toEqual({
      ok: false,
      error: 'NOT_FOUND',
    });
    // Leiden is seeded approved → locked.
    const leidenKey = keyOf(cityTasks(leidenId)[0]!);
    expect(addCustomRow(db, { cityId: leidenId }, leidenKey, 'X', ernestId)).toEqual({
      ok: false,
      error: 'LOCKED',
    });
  });

  it('delete: custom rows only, and NEVER on a submitted list (fixes Kotlin bypass)', () => {
    const ref: ListRef = { cityId: amsterdamId };
    const key = keyOf(cityTasks(amsterdamId)[0]!);
    const added = addCustomRow(db, ref, key, 'Tijdelijk', ernestId);
    const customId = added.ok ? added.id! : '';

    // Template rows have no delete path.
    const templateRow = cityTasks(amsterdamId).find((row) => !row.isCustom)!;
    expect(deleteCustomRow(db, templateRow.id, ernestId)).toEqual({
      ok: false,
      error: 'NOT_CUSTOM',
    });

    // Submit the list → the Kotlin bug allowed deletion here; we refuse.
    expect(submitList(db, ref, 'na').ok).toBe(true);
    expect(deleteCustomRow(db, customId, ernestId)).toEqual({ ok: false, error: 'LOCKED' });

    // Withdraw-equivalent: reopen via direct flag reset, then deletion works.
    db.update(schema.cities).set({ submitted: false }).where(eq(schema.cities.id, amsterdamId)).run();
    expect(deleteCustomRow(db, customId, ernestId)).toEqual({ ok: true });
    expect(cityTasks(amsterdamId).some((row) => row.id === customId)).toBe(false);
  });
});

describe('reorder (Kotlin ▲/▼ parity)', () => {
  it('moveBlok swaps adjacent groups and keeps intra-group order', () => {
    const before = cityTasks(amsterdamId);
    const order: string[] = [];
    for (const row of before) if (!order.includes(keyOf(row))) order.push(keyOf(row));
    expect(order.length).toBeGreaterThan(1);

    expect(moveBlok(db, { cityId: amsterdamId }, order[1]!, -1, ernestId).ok).toBe(true);
    const after = cityTasks(amsterdamId);
    const newOrder: string[] = [];
    for (const row of after) if (!newOrder.includes(keyOf(row))) newOrder.push(keyOf(row));
    expect(newOrder[0]).toBe(order[1]);
    expect(newOrder[1]).toBe(order[0]);
    // Intra-group order preserved.
    const group = (rows: typeof before, key: string): string[] =>
      rows.filter((row) => keyOf(row) === key).map((row) => row.deliverable);
    expect(group(after, order[1]!)).toEqual(group(before, order[1]!));

    // Boundary: first group cannot move further up.
    expect(moveBlok(db, { cityId: amsterdamId }, order[1]!, -1, ernestId)).toEqual({
      ok: false,
      error: 'INVALID_CHOICE',
    });
  });

  it('moveTask swaps neighbours but never crosses a blok boundary', () => {
    const rows = cityTasks(amsterdamId);
    const key0 = keyOf(rows[0]!);
    const groupSize = rows.filter((row) => keyOf(row) === key0).length;
    expect(groupSize).toBeGreaterThan(1);

    expect(moveTask(db, rows[0]!.id, 1, ernestId).ok).toBe(true);
    const after = cityTasks(amsterdamId);
    expect(after[0]!.id).toBe(rows[1]!.id);
    expect(after[1]!.id).toBe(rows[0]!.id);

    // Last row of the blok cannot move into the next blok.
    const lastOfBlok = after[groupSize - 1]!;
    expect(moveTask(db, lastOfBlok.id, 1, ernestId)).toEqual({
      ok: false,
      error: 'INVALID_CHOICE',
    });
    // And reordering is owner-only.
    expect(moveTask(db, after[0]!.id, 1, piaId)).toEqual({ ok: false, error: 'NOT_OWNER' });
  });
});
