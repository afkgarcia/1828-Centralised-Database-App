// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildWorld, type World } from '../../../../shared/business-logic/__tests__/fixtures';
import { CityDetail } from '../views/CityDetail';
import { ProjectDetail } from '../views/ProjectDetail';
import type { ListActions } from '../components/ListActions';

let w: World;
let actions: { [K in keyof ListActions]: ReturnType<typeof vi.fn> };
beforeEach(() => {
  w = buildWorld();
  actions = {
    setTaskStatus: vi.fn(),
    markAll: vi.fn(),
    submit: vi.fn(),
    decide: vi.fn(),
    addAttachment: vi.fn(),
    attachFile: vi.fn(),
    removeAttachment: vi.fn(),
    addCustomRow: vi.fn(),
    deleteCustomRow: vi.fn(),
    moveBlok: vi.fn(),
    moveTask: vi.fn(),
  };
});
afterEach(cleanup);

function renderCity(canApprove = false): void {
  render(
    <CityDetail
      city={w.amsterdam}
      projects={[]}
      lang="nl"
      filter="all"
      onFilterChange={() => {}}
      onOpenProject={() => {}}
      onOpenUrl={() => {}}
      onBack={() => {}}
      actions={actions}
      canApprove={canApprove}
    />,
  );
}

describe('interactive approval flow (step 5)', () => {
  it('status box and N/A pill call setTaskStatus with the right transitions', () => {
    renderCity();
    const firstBox = screen.getAllByTestId('status-box')[0]!;
    fireEvent.click(firstBox); // OPEN → DONE
    expect(actions.setTaskStatus).toHaveBeenCalledWith(w.amsterdam.tasks[0]!.id, 'DONE');
    const firstNa = screen.getAllByTestId('na-toggle')[0]!;
    fireEvent.click(firstNa); // OPEN → NA
    expect(actions.setTaskStatus).toHaveBeenCalledWith(w.amsterdam.tasks[0]!.id, 'NA');
  });

  it('submit with open tasks runs the two-step dialog; city offers N/A only', () => {
    renderCity();
    fireEvent.click(screen.getByText('Indienen ter goedkeuring'));
    expect(actions.submit).not.toHaveBeenCalled(); // dialog first — 26 open
    const dialog = screen.getByTestId('submit-dialog');
    expect(dialog.textContent).toContain('26');
    fireEvent.click(screen.getByText('Ga verder'));
    expect(screen.queryByText('Verplaats naar volgende fase (WIP)')).toBeNull(); // no move for cities
    fireEvent.click(screen.getByText('Markeer als n.v.t.'));
    expect(actions.submit).toHaveBeenCalledWith('na');
  });

  it('submitted city shows approve/reject to the approver and they dispatch decisions', () => {
    w.amsterdam.submitted = true;
    renderCity(true);
    fireEvent.click(screen.getByText('✓ Fase goedkeuren'));
    expect(actions.decide).toHaveBeenCalledWith('approve');
  });

  it('submitted list becomes the read-only review panel; non-approver sees withdraw', () => {
    w.amsterdam.submitted = true;
    renderCity(false);
    // Submitted → the review panel replaces the interactive list entirely.
    expect(screen.getByTestId('review-panel')).toBeTruthy();
    expect(screen.queryAllByRole('button', { name: 'OPEN' })).toHaveLength(0);
    fireEvent.click(screen.getByText('Intrekken'));
    expect(actions.decide).toHaveBeenCalledWith('withdraw');
  });

  it('project phase submit dialog offers the WIP move when a next phase exists', () => {
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
        actions={actions}
        canApprove={false}
      />,
    );
    fireEvent.click(screen.getByText('Indienen ter goedkeuring'));
    fireEvent.click(screen.getByText('Ga verder'));
    fireEvent.click(screen.getByText('Verplaats naar volgende fase (WIP)'));
    expect(actions.submit).toHaveBeenCalledWith('move');
  });
});
