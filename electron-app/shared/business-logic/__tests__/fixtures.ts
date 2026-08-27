import phasesJson from '../../data/phases.json';
import type { City, PhaseTemplate, Project, Task, User } from '../../types';

/**
 * Test fixtures reproducing the Kotlin AccessCheck seed world:
 * 3 cities, 3 projects (one per city), the 3 seeded users — but with UUID-style
 * ids and template `existingLink` mapped to `linkHint` (never attachments).
 */

export const templates = phasesJson as PhaseTemplate[];
export const cityTemplate = templates[0]!; // Gemeenteontwikkeling, 26 tasks
export const projectTemplates = templates.slice(1); // 9 phases, 312 tasks

let seq = 0;
export function nextId(prefix: string): string {
  seq += 1;
  return `${prefix}-${seq.toString().padStart(4, '0')}`;
}

export function taskFromTemplate(tmpl: PhaseTemplate['tasks'][number], idPrefix: string): Task {
  return {
    id: nextId(idPrefix),
    step: tmpl.step,
    blok: tmpl.blok,
    deliverable: tmpl.deliverable,
    r: tmpl.r,
    a: tmpl.a,
    s: tmpl.s,
    c: tmpl.c,
    iCol: tmpl.i,
    opm: tmpl.opm,
    linkHint: tmpl.existingLink,
    status: 'OPEN',
    attachments: [],
    custom: false,
  };
}

export function buildCity(name: string): City {
  return {
    id: nextId('city'),
    name,
    tasks: cityTemplate.tasks.map((t) => taskFromTemplate(t, `ct-${name}`)),
    submitted: false,
    approved: false,
  };
}

export function buildProject(name: string, cityId: string): Project {
  return {
    id: nextId('proj'),
    name,
    cityId,
    phases: projectTemplates.map((ph, idx) => ({
      id: nextId('phase'),
      idx,
      sheet: ph.sheet,
      tasks: ph.tasks.map((t) => taskFromTemplate(t, `pt-${name}-${idx}`)),
      submitted: false,
      approved: false,
    })),
  };
}

export interface World {
  leiden: City;
  amsterdam: City;
  utrecht: City;
  pieterskwartier: Project;
  sloterdijk: Project;
  utrechtOost: Project;
  cities: City[];
  projects: Project[];
  ernest: User;
  pia: User;
  niels: User;
  users: User[];
}

export function buildWorld(): World {
  const leiden = buildCity('Leiden');
  const amsterdam = buildCity('Amsterdam');
  const utrecht = buildCity('Utrecht');
  const pieterskwartier = buildProject('Pieterskwartier', leiden.id);
  const sloterdijk = buildProject('Sloterdijk Noord', amsterdam.id);
  const utrechtOost = buildProject('Utrecht Oost', utrecht.id);

  const ernest: User = {
    id: nextId('user'),
    email: 'ernest@1828.nl',
    displayName: 'Ernest',
    role: 'OWNER',
    status: 'ACTIVE',
    accessAllCities: true,
    cityAccess: [],
    projectAccess: [],
  };
  const pia: User = {
    id: nextId('user'),
    email: 'pia@1828.nl',
    displayName: 'Pia (PM)',
    role: 'PM',
    status: 'ACTIVE',
    accessAllCities: false,
    cityAccess: [leiden.id],
    projectAccess: [],
  };
  const niels: User = {
    id: nextId('user'),
    email: 'niels@1828.nl',
    displayName: 'Niels (OM)',
    role: 'OM',
    status: 'PENDING',
    accessAllCities: false,
    cityAccess: [],
    projectAccess: [],
  };

  return {
    leiden,
    amsterdam,
    utrecht,
    pieterskwartier,
    sloterdijk,
    utrechtOost,
    cities: [leiden, amsterdam, utrecht],
    projects: [pieterskwartier, sloterdijk, utrechtOost],
    ernest,
    pia,
    niels,
    users: [ernest, pia, niels],
  };
}
