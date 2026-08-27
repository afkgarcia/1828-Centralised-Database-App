import { describe, expect, it } from 'vitest';
import phasesJson from '../../../../shared/data/phases.json';
import type { PhaseTemplate } from '@shared/types';
import { openDb } from '../client';
import { importTemplates, seedDemoData } from '../seed';
import { getWorld } from '../queries';

const templates = phasesJson as PhaseTemplate[];

describe('getWorld (renderer snapshot)', () => {
  it('returns the seeded hierarchy in shared-type shape', () => {
    const db = openDb(':memory:');
    importTemplates(db, templates);
    seedDemoData(db, templates);
    const world = getWorld(db);

    expect(world.cities.map((c) => c.name)).toEqual(['Leiden', 'Amsterdam', 'Utrecht']);
    expect(world.projects.map((p) => p.name)).toEqual([
      'Pieterskwartier',
      'Sloterdijk Noord',
      'Utrecht Oost',
    ]);

    const leiden = world.cities[0]!;
    expect(leiden.approved).toBe(true);
    expect(leiden.tasks).toHaveLength(26);
    expect(leiden.tasks.every((task) => task.status === 'DONE')).toBe(true);
    // Attachments ride along in order-preserving task lists
    expect(leiden.tasks[0]!.attachments[0]!.name).toBe('G40 lijst verrijkt');
    expect(leiden.tasks[1]!.attachments[0]!.kind).toBe('GOOGLE_DOC');

    const pieterskwartier = world.projects[0]!;
    expect(pieterskwartier.cityId).toBe(leiden.id);
    expect(pieterskwartier.phases).toHaveLength(9);
    expect(pieterskwartier.phases.map((ph) => ph.idx)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8]);
    expect(pieterskwartier.phases[0]!.sheet).toBe('Acquisitiefase');
    expect(pieterskwartier.phases[0]!.tasks).toHaveLength(27);
    expect(pieterskwartier.phases[0]!.tasks[0]!.attachments).toHaveLength(1);

    // linkHint carried through; no fabricated attachments beyond the 4 demo ones
    const allTasks = [
      ...world.cities.flatMap((c) => c.tasks),
      ...world.projects.flatMap((p) => p.phases.flatMap((ph) => ph.tasks)),
    ];
    expect(allTasks.filter((task) => task.linkHint.length > 0).length).toBeGreaterThan(0);
    expect(allTasks.flatMap((task) => task.attachments)).toHaveLength(4);
  });
});
