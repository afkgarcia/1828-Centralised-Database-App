import { describe, expect, it } from 'vitest';
import { count, eq } from 'drizzle-orm';
import phasesJson from '../../../../shared/data/phases.json';
import type { PhaseTemplate } from '@shared/types';
import { openDb } from '../client';
import { importTemplates, seedDemoData } from '../seed';
import * as t from '../schema';

const templates = phasesJson as PhaseTemplate[];

describe('database import + demo seed (migration checkpoint 1)', () => {
  it('imports the audited template counts and reports RASCI anomalies', () => {
    const db = openDb(':memory:');
    const report = importTemplates(db, templates);

    expect(report.phases).toBe(10);
    expect(report.tasks).toBe(338);
    expect(report.linkHints).toBe(302);
    // Dirty tokens found in the source workbook, surfaced for Ernest to clean up
    expect(report.rasciAnomalies).toContain('DENISE');
    expect(report.rasciAnomalies).toContain('PP');

    const phaseRows = db.select({ n: count() }).from(t.phaseTemplates).get();
    const taskRows = db.select({ n: count() }).from(t.taskTemplates).get();
    expect(phaseRows?.n).toBe(10);
    expect(taskRows?.n).toBe(338);

    // Idempotent: second import adds nothing
    importTemplates(db, templates);
    expect(db.select({ n: count() }).from(t.taskTemplates).get()?.n).toBe(338);
  });

  it('seeds the Kotlin demo world: 3 cities, 3 projects, 27 phases, 1014 tasks, Leiden approved', () => {
    const db = openDb(':memory:');
    importTemplates(db, templates);
    seedDemoData(db, templates);

    expect(db.select({ n: count() }).from(t.cities).get()?.n).toBe(3);
    expect(db.select({ n: count() }).from(t.projects).get()?.n).toBe(3);
    expect(db.select({ n: count() }).from(t.phases).get()?.n).toBe(27);
    // 3 cities × 26 + 3 projects × 312
    expect(db.select({ n: count() }).from(t.tasks).get()?.n).toBe(3 * 26 + 3 * 312);
    expect(db.select({ n: count() }).from(t.attachments).get()?.n).toBe(4);
    expect(db.select({ n: count() }).from(t.users).get()?.n).toBe(3);

    const leiden = db.select().from(t.cities).where(eq(t.cities.name, 'Leiden')).get()!;
    expect(leiden.approved).toBe(true);
    expect(leiden.submitted).toBe(false); // Kotlin seed: approved without a submitted flag

    // Pia's Leiden grant exists and is her only grant
    const pia = db.select().from(t.users).where(eq(t.users.email, 'pia@1828.nl')).get()!;
    const grants = db
      .select()
      .from(t.userCityAccess)
      .where(eq(t.userCityAccess.userId, pia.id))
      .all();
    expect(grants.map((g) => g.cityId)).toEqual([leiden.id]);
    const leidenOpen = db
      .select({ n: count() })
      .from(t.tasks)
      .where(eq(t.tasks.cityId, leiden.id))
      .get();
    expect(leidenOpen?.n).toBe(26);
    const leidenTasks = db.select().from(t.tasks).where(eq(t.tasks.cityId, leiden.id)).all();
    expect(leidenTasks.every((task) => task.status === 'DONE')).toBe(true);

    // Seed is idempotent too
    seedDemoData(db, templates);
    expect(db.select({ n: count() }).from(t.cities).get()?.n).toBe(3);

    // No attachment was fabricated from linkHint placeholders (§1.7.1):
    // exactly the 4 demo attachments exist, all with real URLs.
    const atts = db.select().from(t.attachments).all();
    expect(atts.every((a) => a.url.startsWith('https://'))).toBe(true);
  });
});
