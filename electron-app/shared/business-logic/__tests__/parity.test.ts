import { beforeEach, describe, expect, it } from 'vitest';
import {
  accessibleCityIds,
  approve,
  blokKey,
  canEditTasks,
  changePasswordOutcome,
  defaultDisplayName,
  generateResetCode,
  openTaskCountAcross,
  pendingCitySubmissions,
  pendingPhaseSubmissions,
  projectsForCity,
  roleToFilter,
  visibleEmails,
  defaultAttachmentName,
  detectDriveKind,
  isApprover,
  isPhaseUnlocked,
  isReadyForSubmission,
  loginOutcome,
  markOpenTasksNa,
  moveOpenTasksToNext,
  normalizeUrl,
  openTasks,
  prepareAttachment,
  progressOf,
  reassignAttachments,
  recipientsForApprovalRequested,
  recipientsForCityDecision,
  recipientsForDeliverableSubmitted,
  recipientsForPasswordReset,
  recipientsForPhaseDecision,
  reject,
  removeUserOutcome,
  reopen,
  resetOutcome,
  signupOutcome,
  subjectKeyFor,
  submit,
  relevantTasks,
  tokenizeRasciCell,
  isTaskRelevantToRole,
  userCanAccessProject,
  WIP_STEP,
  withdraw,
} from '../index';
import { format } from '../../i18n';
import { buildWorld, templates, type World } from './fixtures';

/**
 * Parity acceptance suite: the ~60 invariants printed by the Kotlin app's
 * AccessCheck.kt (see ../../../audit/build-runtime-tests.md §3), turned into
 * real assertions, plus regression tests for the three bugs the audit decided
 * to fix rather than carry (MIGRATION_NOTES §1.7).
 */

let w: World;
beforeEach(() => {
  w = buildWorld();
});

describe('template ground truth (phases.json)', () => {
  it('has 10 sheets and 338 tasks with the audited per-phase counts', () => {
    expect(templates.map((p) => p.tasks.length)).toEqual([26, 27, 22, 49, 52, 33, 26, 26, 51, 26]);
    expect(templates[0]!.sheet).toBe('Gemeenteontwikkeling');
    expect(templates[1]!.sheet).toBe('Acquisitiefase');
    expect(templates[9]!.sheet).toBe('Garantiefase');
  });

  it('maps existingLink placeholders to linkHint and creates ZERO attachments from them (bug fix §1.7.1)', () => {
    const withHints = w.cities[0]!.tasks.filter((t) => t.linkHint.trim().length > 0);
    expect(withHints.length).toBeGreaterThan(0);
    for (const city of w.cities) {
      for (const task of city.tasks) expect(task.attachments).toHaveLength(0);
    }
  });
});

describe('access scoping (AccessCheck §3.1–3.2)', () => {
  it('owner sees all cities and projects and is the approver', () => {
    expect(accessibleCityIds(w.ernest, w.cities.map((c) => c.id), w.projects)).toEqual(
      w.cities.map((c) => c.id),
    );
    expect(userCanAccessProject(w.ernest, w.pieterskwartier)).toBe(true);
    expect(isApprover(w.ernest)).toBe(true);
  });

  it('PM scoped to Leiden sees only Leiden and its project', () => {
    expect(accessibleCityIds(w.pia, w.cities.map((c) => c.id), w.projects)).toEqual([w.leiden.id]);
    expect(userCanAccessProject(w.pia, w.pieterskwartier)).toBe(true);
    expect(userCanAccessProject(w.pia, w.sloterdijk)).toBe(false);
    expect(isApprover(w.pia)).toBe(false);
  });

  it('a project grant makes the parent city visible (transitive rule)', () => {
    w.pia.cityAccess = [];
    w.pia.projectAccess = [w.sloterdijk.id];
    expect(accessibleCityIds(w.pia, w.cities.map((c) => c.id), w.projects)).toEqual([
      w.amsterdam.id,
    ]);
  });
});

describe('login outcomes (AccessCheck §3.3)', () => {
  it('pending account with correct password → PENDING', () => {
    expect(loginOutcome(w.niels, true)).toBe('PENDING');
  });
  it('wrong password → BAD_PASSWORD; unknown → UNKNOWN_EMAIL; active+correct → OK', () => {
    expect(loginOutcome(w.ernest, false)).toBe('BAD_PASSWORD');
    expect(loginOutcome(null, true)).toBe('UNKNOWN_EMAIL');
    expect(loginOutcome(w.ernest, true)).toBe('OK');
  });
  it('rejected account → REJECTED', () => {
    expect(loginOutcome({ status: 'REJECTED' }, true)).toBe('REJECTED');
  });
});

describe('approval flow + phase gate (AccessCheck §3.4)', () => {
  it('phase 1 (idx 1) locked until phase 0 approved; unlocked after', () => {
    const flags = w.pieterskwartier.phases.map((p) => p);
    expect(isPhaseUnlocked(1, flags, true)).toBe(false);
    w.pieterskwartier.phases[0]!.approved = true;
    expect(isPhaseUnlocked(1, flags, true)).toBe(true);
  });

  it('submitted phase appears frozen; approve/reject/withdraw transitions behave', () => {
    const phase = w.pieterskwartier.phases[0]!;
    const submitted = submit(phase);
    expect(submitted).toEqual({ ok: true, flags: { submitted: true, approved: false } });
    expect(canEditTasks({ submitted: true, approved: false })).toBe(false);

    // Only the owner approves
    const denied = approve({ submitted: true, approved: false }, w.pia);
    expect(denied).toEqual({ ok: false, error: 'NOT_APPROVER' });
    const approved = approve({ submitted: true, approved: false }, w.ernest);
    expect(approved).toEqual({ ok: true, flags: { submitted: false, approved: true } });

    const rejected = reject({ submitted: true, approved: false }, w.ernest);
    expect(rejected).toEqual({ ok: true, flags: { submitted: false, approved: false } });
    const withdrawn = withdraw({ submitted: true, approved: false });
    expect(withdrawn).toEqual({ ok: true, flags: { submitted: false, approved: false } });
    const reopened = reopen({ submitted: false, approved: true }, w.ernest);
    expect(reopened).toEqual({ ok: true, flags: { submitted: false, approved: false } });
  });

  it('readiness: all done → ready; done+NA mix → ready; any open → not ready', () => {
    const phase = w.pieterskwartier.phases[0]!;
    phase.tasks.forEach((t) => (t.status = 'DONE'));
    expect(isReadyForSubmission(phase.tasks)).toBe(true);
    phase.tasks[0]!.status = 'NA';
    expect(isReadyForSubmission(phase.tasks)).toBe(true);
    phase.tasks[1]!.status = 'OPEN';
    expect(isReadyForSubmission(phase.tasks)).toBe(false);
  });
});

describe('signup (AccessCheck §3.5)', () => {
  it('valid signup OK; duplicates, bad email, weak password rejected', () => {
    expect(signupOutcome('test@1828.nl', 'test', false)).toBe('OK');
    expect(signupOutcome('test@1828.nl', 'test', true)).toBe('ALREADY_EXISTS');
    expect(signupOutcome('not-an-email', 'test', false)).toBe('INVALID_EMAIL');
    expect(signupOutcome('x@y.nl', 'abc', false)).toBe('WEAK_PASSWORD');
  });
});

describe('notification routing (AccessCheck §3.6)', () => {
  it('deliverable + approval-request go to active owners', () => {
    expect(recipientsForDeliverableSubmitted(w.users)).toEqual(['ernest@1828.nl']);
    expect(recipientsForApprovalRequested(w.users)).toEqual(['ernest@1828.nl']);
  });

  it('phase decision goes to the active non-owner team with access (pia), owners as fallback', () => {
    expect(recipientsForPhaseDecision(w.users, w.pieterskwartier)).toEqual(['pia@1828.nl']);
    // No team on Sloterdijk (pia has no access, niels pending) → owners fallback
    expect(recipientsForPhaseDecision(w.users, w.sloterdijk)).toEqual(['ernest@1828.nl']);
  });

  it('city decision mirrors phase decision', () => {
    expect(recipientsForCityDecision(w.users, w.leiden.id, w.projects)).toEqual(['pia@1828.nl']);
    expect(recipientsForCityDecision(w.users, w.utrecht.id, w.projects)).toEqual([
      'ernest@1828.nl',
    ]);
  });

  it('password reset goes only to the account', () => {
    expect(recipientsForPasswordReset('pia@1828.nl')).toEqual(['pia@1828.nl']);
  });

  it('approved-phase subject renders the audited Dutch string', () => {
    const key = subjectKeyFor('PHASE_APPROVED', {});
    expect(format(key, { project: 'Pieterskwartier', phase: '2. Haalbaarheidsfase' })).toBe(
      '🎉 Fase goedgekeurd: Pieterskwartier — 2. Haalbaarheidsfase',
    );
  });
});

describe('Google Drive link handling (AccessCheck §3.7)', () => {
  it('detects every audited kind', () => {
    expect(detectDriveKind('https://docs.google.com/document/d/1XyZ/edit')).toBe('GOOGLE_DOC');
    expect(detectDriveKind('https://docs.google.com/spreadsheets/d/1A/edit')).toBe('GOOGLE_SHEET');
    expect(detectDriveKind('https://docs.google.com/presentation/d/1P/edit')).toBe(
      'GOOGLE_SLIDES',
    );
    expect(detectDriveKind('https://forms.gle/abc')).toBe('GOOGLE_FORM');
    expect(detectDriveKind('https://drive.google.com/drive/folders/1Xyz')).toBe('DRIVE_FOLDER');
    expect(detectDriveKind('https://drive.google.com/file/d/1Xyz/view')).toBe('DRIVE_FILE');
    expect(detectDriveKind('https://example.com/rapport.pdf')).toBe('WEB_LINK');
  });

  it('auto-prefixes https:// and derives default names', () => {
    expect(normalizeUrl('docs.google.com/spreadsheets/d/1Abc/edit')).toBe(
      'https://docs.google.com/spreadsheets/d/1Abc/edit',
    );
    expect(defaultAttachmentName('GOOGLE_DOC', '')).toBe('Google Doc');
    expect(defaultAttachmentName('WEB_LINK', 'https://example.com/x')).toBe('example.com');
    expect(defaultAttachmentName('WEB_LINK', 'not a url')).toBe('Link');
  });

  it('prepareAttachment keeps a provided name and rejects junk', () => {
    const att = prepareAttachment('docs.google.com/spreadsheets/d/1Abc/edit', 'G40 lijst');
    expect(att).toEqual({
      url: 'https://docs.google.com/spreadsheets/d/1Abc/edit',
      kind: 'GOOGLE_SHEET',
      name: 'G40 lijst',
    });
    expect(prepareAttachment('   ', null)).toBeNull();
  });
});

describe('password reset + change (AccessCheck §3.8–3.9)', () => {
  it('reset outcomes: unknown, bad code, weak password, OK; codes single-use by contract', () => {
    expect(resetOutcome(false, null, '123456', 'nieuw')).toBe('UNKNOWN_EMAIL');
    expect(resetOutcome(true, '123456', '000000', 'nieuw')).toBe('BAD_CODE');
    expect(resetOutcome(true, '123456', '123456', 'abc')).toBe('WEAK_PASSWORD');
    expect(resetOutcome(true, '123456', ' 123456 ', 'nieuw')).toBe('OK');
    // after consumption the stored code is null → BAD_CODE
    expect(resetOutcome(true, null, '123456', 'weer')).toBe('BAD_CODE');
  });

  it('change password verifies the current one first', () => {
    expect(changePasswordOutcome(false, 'abcd')).toBe('BAD_CURRENT');
    expect(changePasswordOutcome(true, 'abc')).toBe('WEAK_PASSWORD');
    expect(changePasswordOutcome(true, 'abcd')).toBe('OK');
  });
});

describe('remove user + document handover (AccessCheck §3.10)', () => {
  it('owner can never be removed; nor yourself', () => {
    expect(removeUserOutcome(w.ernest, w.pia)).toBe('IS_OWNER');
    expect(removeUserOutcome(w.pia, w.pia)).toBe('IS_SELF');
    expect(removeUserOutcome(w.pia, w.ernest)).toBe('OK');
  });

  it('reassigns exactly the removed user’s attachments to the replacement', () => {
    const task = w.leiden.tasks[3]!;
    task.attachments.push({
      id: 'att-1',
      name: "Pia's analyse",
      url: 'https://docs.google.com/document/d/1PiaDoc/edit',
      kind: 'GOOGLE_DOC',
      addedByUserId: w.pia.id,
      addedByLabel: 'Pia (PM)',
      addedAt: '2026-07-21T00:00:00Z',
    });
    const { tasks, movedCount } = reassignAttachments(
      w.leiden.tasks,
      w.pia.id,
      w.ernest.id,
      'Ernest',
    );
    expect(movedCount).toBe(1);
    const moved = tasks[3]!.attachments[0]!;
    expect(moved.addedByUserId).toBe(w.ernest.id);
    expect(moved.addedByLabel).toBe('Ernest');
  });
});

describe('unfinished tasks on submit (AccessCheck §3.11)', () => {
  it('mark-N/A converts exactly the open tasks', () => {
    const phase = w.sloterdijk.phases[0]!;
    phase.tasks.slice(0, 5).forEach((t) => (t.status = 'DONE'));
    const openBefore = openTasks(phase.tasks).length;
    expect(openBefore).toBe(22); // 27 in Acquisitiefase − 5 done
    const { tasks, changedIds } = markOpenTasksNa(phase.tasks);
    expect(changedIds).toHaveLength(22);
    expect(openTasks(tasks)).toHaveLength(0);
  });

  it('move-to-WIP relocates open tasks to the head of the next phase', () => {
    const p0 = w.utrechtOost.phases[0]!;
    const p1 = w.utrechtOost.phases[1]!;
    p0.tasks.forEach((t) => (t.status = 'DONE'));
    p0.tasks.slice(0, 3).forEach((t) => (t.status = 'OPEN'));
    const before0 = p0.tasks.length;
    const before1 = p1.tasks.length;

    const { current, next, movedIds } = moveOpenTasksToNext(p0.tasks, p1.tasks);
    expect(movedIds).toHaveLength(3);
    expect(current).toHaveLength(before0 - 3);
    expect(next).toHaveLength(before1 + 3);
    for (const t of next.slice(0, 3)) {
      expect(t.step).toBe(WIP_STEP);
      expect(t.blok).toBe('');
      expect(t.status).toBe('OPEN');
    }
  });
});

describe('city gate (AccessCheck §3.12)', () => {
  it('project phase 0 locked while the city is unapproved; unlocks on approval; phase 1 still gated', () => {
    expect(isPhaseUnlocked(0, w.sloterdijk.phases, w.amsterdam.approved)).toBe(false);
    w.amsterdam.approved = true;
    expect(isPhaseUnlocked(0, w.sloterdijk.phases, w.amsterdam.approved)).toBe(true);
    expect(isPhaseUnlocked(1, w.sloterdijk.phases, w.amsterdam.approved)).toBe(false);
  });
});

describe('progress math (worked example from the client brief)', () => {
  it('5/20 N/A + 12 of remaining 15 done ⇒ exactly 80%', () => {
    const tasks = w.pieterskwartier.phases[3]!.tasks.slice(0, 20);
    tasks.forEach((t) => (t.status = 'OPEN'));
    tasks.slice(0, 5).forEach((t) => (t.status = 'NA'));
    tasks.slice(5, 17).forEach((t) => (t.status = 'DONE'));
    expect(progressOf(tasks, 'all')).toBeCloseTo(0.8, 10);
  });

  it('empty applicable set counts as complete (1.0)', () => {
    const tasks = w.leiden.tasks.slice(0, 3);
    tasks.forEach((t) => (t.status = 'NA'));
    expect(progressOf(tasks, 'all')).toBe(1.0);
  });
});

describe('RASCI matching — regression for the substring bug (§1.7.2)', () => {
  it('tokenizes the dirty separators found in the phase document', () => {
    expect(tokenizeRasciCell('MT/PO')).toEqual(['MT', 'PO']);
    expect(tokenizeRasciCell('MT, PO')).toEqual(['MT', 'PO']);
    expect(tokenizeRasciCell('DENISE + PO')).toEqual(['DENISE', 'PO']);
  });

  it('"PM" no longer matches "PPM" cells', () => {
    const t = { ...w.leiden.tasks[0]!, r: 'PPM', a: '', s: '', c: '' };
    expect(isTaskRelevantToRole(t, 'PM')).toBe(false);
    expect(isTaskRelevantToRole(t, 'PPM')).toBe(true);
  });

  it("'all' filter returns everything", () => {
    expect(relevantTasks(w.leiden.tasks, 'all')).toHaveLength(26);
  });
});

describe('lock enforcement — regression for the custom-row-delete bypass (§1.7.7)', () => {
  it('task edits (incl. custom-row deletion) are illegal on submitted and approved lists', () => {
    expect(canEditTasks({ submitted: false, approved: false })).toBe(true);
    expect(canEditTasks({ submitted: true, approved: false })).toBe(false);
    expect(canEditTasks({ submitted: false, approved: true })).toBe(false);
  });
});

describe('verification round 1 additions (adversarial findings)', () => {
  it('roleToFilter: OWNER maps to "all" — owner sees everything, never zero tasks', () => {
    expect(roleToFilter('OWNER')).toBe('all');
    expect(roleToFilter('PM')).toBe('PM');
    expect(relevantTasks(w.leiden.tasks, roleToFilter('OWNER'))).toHaveLength(26);
  });

  it('pending submissions selectors preserve declaration order, cities before phases by contract', () => {
    w.amsterdam.submitted = true;
    w.utrecht.submitted = true;
    w.utrecht.approved = true; // approved → not pending
    expect(pendingCitySubmissions(w.cities).map((c) => c.name)).toEqual(['Amsterdam']);

    w.pieterskwartier.phases[2]!.submitted = true;
    w.pieterskwartier.phases[0]!.submitted = true;
    w.sloterdijk.phases[1]!.submitted = true;
    const pend = pendingPhaseSubmissions(w.projects);
    expect(pend.map((p) => [p.project.name, p.phaseIdx])).toEqual([
      ['Pieterskwartier', 0],
      ['Pieterskwartier', 2],
      ['Sloterdijk Noord', 1],
    ]);
  });

  it('signup displayName falls back to the email local-part (Kotlin rule)', () => {
    expect(defaultDisplayName('  Pia  ', 'pia@1828.nl')).toBe('Pia');
    expect(defaultDisplayName('   ', 'Niels@1828.NL')).toBe('niels');
    expect(defaultDisplayName(null, 'x@y.nl')).toBe('x');
  });

  it('reset codes are 6-digit within 100000–999999', () => {
    expect(generateResetCode(() => 0)).toBe('100000');
    expect(generateResetCode(() => 0.9999999)).toBe('999999');
    const code = generateResetCode();
    expect(code).toMatch(/^[1-9]\d{5}$/);
  });

  it('move-to-WIP on the last phase (no next) is a guarded no-op', () => {
    const last = w.utrechtOost.phases[8]!;
    last.tasks.slice(0, 2).forEach((task) => (task.status = 'OPEN'));
    const result = moveOpenTasksToNext(last.tasks, null);
    expect(result.movedIds).toHaveLength(0);
    expect(result.current).toHaveLength(last.tasks.length);
  });

  it('moved WIP tasks keep RASCI fields and attachments; blokKey becomes "WIP||"', () => {
    const p0 = w.utrechtOost.phases[0]!;
    const p1 = w.utrechtOost.phases[1]!;
    p0.tasks.forEach((task) => (task.status = 'DONE'));
    const carried = p0.tasks[0]!;
    carried.status = 'OPEN';
    carried.attachments.push({
      id: 'att-wip',
      name: 'Doc',
      url: 'https://docs.google.com/document/d/1/edit',
      kind: 'GOOGLE_DOC',
      addedByUserId: w.pia.id,
      addedByLabel: 'Pia (PM)',
      addedAt: '2026-07-21T00:00:00Z',
    });
    const { next } = moveOpenTasksToNext(p0.tasks, p1.tasks);
    const moved = next[0]!;
    expect(blokKey(moved)).toBe('WIP||');
    expect(moved.r).toBe(carried.r);
    expect(moved.a).toBe(carried.a);
    expect(moved.attachments).toHaveLength(1);
  });

  it('reassignment sweeps city AND phase task lists in one pass (Kotlin scope)', () => {
    const cityTask = w.leiden.tasks[0]!;
    const phaseTask = w.pieterskwartier.phases[1]!.tasks[0]!;
    for (const task of [cityTask, phaseTask]) {
      task.attachments.push({
        id: `att-${task.id}`,
        name: 'Doc',
        url: 'https://docs.google.com/document/d/1/edit',
        kind: 'GOOGLE_DOC',
        addedByUserId: w.pia.id,
        addedByLabel: 'Pia (PM)',
        addedAt: '2026-07-21T00:00:00Z',
      });
    }
    const allLists = [
      ...w.cities.map((c) => c.tasks),
      ...w.projects.flatMap((p) => p.phases.map((ph) => ph.tasks)),
    ].flat();
    const { movedCount } = reassignAttachments(allLists, w.pia.id, w.ernest.id, 'Ernest');
    expect(movedCount).toBe(2);
  });

  it('outbox visibility: owner sees all, colleague only mail addressed to them, order preserved', () => {
    const messages = [
      { to: ['ernest@1828.nl'], subject: 'newest' },
      { to: ['pia@1828.nl'], subject: 'middle' },
      { to: ['ernest@1828.nl'], subject: 'oldest' },
    ];
    expect(visibleEmails(messages, 'ernest@1828.nl', true)).toHaveLength(3);
    const piaView = visibleEmails(messages, 'pia@1828.nl', false);
    expect(piaView.map((m) => m.subject)).toEqual(['middle']);
  });

  it('openTaskCountAcross sums role-filtered open tasks over many lists', () => {
    const lists = [w.leiden.tasks, w.pieterskwartier.phases[0]!.tasks];
    const all = openTaskCountAcross(lists, 'all');
    expect(all).toBe(26 + 27);
    w.leiden.tasks.forEach((task) => (task.status = 'DONE'));
    expect(openTaskCountAcross(lists, 'all')).toBe(27);
  });

  it('projectsForCity scopes by city and by access', () => {
    expect(projectsForCity(w.pia, w.leiden.id, w.projects).map((p) => p.name)).toEqual([
      'Pieterskwartier',
    ]);
    expect(projectsForCity(w.pia, w.amsterdam.id, w.projects)).toHaveLength(0);
    expect(projectsForCity(w.ernest, w.amsterdam.id, w.projects).map((p) => p.name)).toEqual([
      'Sloterdijk Noord',
    ]);
  });
});
