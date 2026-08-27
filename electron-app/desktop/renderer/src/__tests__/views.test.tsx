// @vitest-environment jsdom
import { useState } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RoleFilter } from '@shared/types';
import { buildWorld, type World } from '../../../../shared/business-logic/__tests__/fixtures';
import { Dashboard } from '../views/Dashboard';
import { CityDetail } from '../views/CityDetail';
import { ProjectDetail } from '../views/ProjectDetail';

let w: World;
beforeEach(() => {
  w = buildWorld();
});
afterEach(cleanup);

describe('Dashboard (read-only)', () => {
  it('renders a tile per city with project counts and the stats strip', () => {
    render(
      <Dashboard cities={w.cities} projects={w.projects} lang="nl" onOpenCity={() => {}} />,
    );
    expect(screen.getAllByTestId('city-tile')).toHaveLength(3);
    expect(screen.getByText('Leiden')).toBeTruthy();
    // 3 cities × 26 + 3 projects × 312 open tasks in the raw fixture world
    expect(screen.getByText(String(3 * 26 + 3 * 312))).toBeTruthy();
  });

  it('city tile click navigates', () => {
    const onOpenCity = vi.fn();
    render(<Dashboard cities={w.cities} projects={w.projects} lang="nl" onOpenCity={onOpenCity} />);
    fireEvent.click(screen.getAllByTestId('city-tile')[0]!);
    expect(onOpenCity).toHaveBeenCalledWith(w.leiden.id);
  });
});

describe('CityDetail (read-only)', () => {
  it('renders all 26 tasks grouped under blok headers and the gate hint when unapproved', () => {
    render(
      <CityDetail
        city={w.leiden}
        projects={[w.pieterskwartier]}
        lang="nl"
        filter="all"
        onFilterChange={() => {}}
        onOpenProject={() => {}}
        onOpenUrl={() => {}}
        onBack={() => {}}
      />,
    );
    expect(screen.getAllByTestId('task-row')).toHaveLength(26);
    expect(screen.getByText('1.1')).toBeTruthy(); // blok step chip
    expect(screen.getByTestId('approval-banner').textContent).toContain('26'); // 26 open
    expect(screen.getAllByTestId('project-tile')[0]!.textContent).toContain('🔒');
  });

  it('approved city shows the approved banner and unlocked project tile', () => {
    w.leiden.approved = true;
    render(
      <CityDetail
        city={w.leiden}
        projects={[w.pieterskwartier]}
        lang="nl"
        filter="all"
        onFilterChange={() => {}}
        onOpenProject={() => {}}
        onOpenUrl={() => {}}
        onBack={() => {}}
      />,
    );
    expect(screen.getByTestId('approval-banner').textContent).toContain(
      'Gemeenteontwikkeling goedgekeurd',
    );
    expect(screen.getAllByTestId('project-tile')[0]!.textContent).not.toContain('🔒');
  });

  it('RASCI filter chips narrow the visible rows (tokenized: PM ≠ PPM)', () => {
    function Harness(): JSX.Element {
      const [filter, setFilter] = useState<RoleFilter>('all');
      return (
        <CityDetail
          city={w.leiden}
          projects={[]}
          lang="nl"
          filter={filter}
          onFilterChange={setFilter}
          onOpenProject={() => {}}
          onOpenUrl={() => {}}
          onBack={() => {}}
        />
      );
    }
    render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: 'PPM' }));
    // Gemeenteontwikkeling has no PPM-tagged tasks → zero rows
    expect(screen.queryAllByTestId('task-row')).toHaveLength(0);
    fireEvent.click(screen.getByRole('button', { name: 'OM' }));
    expect(screen.getAllByTestId('task-row').length).toBeGreaterThan(0);
  });
});

describe('ProjectDetail (read-only)', () => {
  it('locks phase 1 behind the city gate with the explanatory message', () => {
    render(
      <ProjectDetail
        project={w.pieterskwartier}
        city={w.leiden}
        phaseIdx={0}
        lang="nl"
        filter="all"
        onFilterChange={() => {}}
        onSelectPhase={() => {}}
        onOpenUrl={() => {}}
        onBack={() => {}}
        onBackToCity={() => {}}
      />,
    );
    expect(screen.getAllByTestId('phase-tab')).toHaveLength(9);
    expect(screen.getByTestId('lock-note').textContent).toContain('Leiden');
    // every tab disabled: city unapproved gates phase 0, phase 0 gates the rest
    for (const tab of screen.getAllByTestId('phase-tab')) {
      expect((tab as HTMLButtonElement).disabled).toBe(true);
    }
  });

  it('city approval unlocks phase 1 only; later phases stay gated', () => {
    w.leiden.approved = true;
    render(
      <ProjectDetail
        project={w.pieterskwartier}
        city={w.leiden}
        phaseIdx={0}
        lang="nl"
        filter="all"
        onFilterChange={() => {}}
        onSelectPhase={() => {}}
        onOpenUrl={() => {}}
        onBack={() => {}}
        onBackToCity={() => {}}
      />,
    );
    const tabs = screen.getAllByTestId('phase-tab') as HTMLButtonElement[];
    expect(tabs[0]!.disabled).toBe(false);
    expect(tabs[1]!.disabled).toBe(true);
    expect(screen.getAllByTestId('task-row')).toHaveLength(27);
  });

  it('submitted phase shows the review panel with clickable document chips', () => {
    w.leiden.approved = true;
    const phase = w.pieterskwartier.phases[0]!;
    phase.submitted = true;
    phase.tasks[0]!.attachments.push({
      id: 'att-review',
      name: 'Acquisitie-map',
      url: 'https://drive.google.com/drive/folders/1X',
      kind: 'DRIVE_FOLDER',
      addedByUserId: null,
      addedByLabel: 'Pia (PM)',
      addedAt: '2026-07-21T00:00:00Z',
    });
    const onOpenUrl = vi.fn();
    render(
      <ProjectDetail
        project={w.pieterskwartier}
        city={w.leiden}
        phaseIdx={0}
        lang="nl"
        filter="all"
        onFilterChange={() => {}}
        onSelectPhase={() => {}}
        onOpenUrl={onOpenUrl}
        onBack={() => {}}
        onBackToCity={() => {}}
      />,
    );
    // The review panel replaces the docs strip: docs live on their own rows.
    expect(screen.getByTestId('review-panel')).toBeTruthy();
    fireEvent.click(screen.getAllByText('Acquisitie-map')[0]!);
    expect(onOpenUrl).toHaveBeenCalledWith('https://drive.google.com/drive/folders/1X');
  });
});
