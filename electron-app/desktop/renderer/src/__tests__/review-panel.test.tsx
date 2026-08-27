// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Task } from '@shared/types';
import { ReviewPanel } from '../components/ReviewPanel';

afterEach(cleanup);

const task = (over: Partial<Task>): Task => ({
  id: 'x',
  step: '1.4',
  blok: 'Blok A',
  deliverable: 'Deliverable',
  r: 'OM',
  a: 'OM',
  s: '',
  c: '',
  iCol: '',
  opm: '',
  linkHint: '',
  status: 'OPEN',
  attachments: [],
  custom: false,
  ...over,
});

describe('ReviewPanel (Ernest’s approval screen)', () => {
  it('shows done rows green with clickable documents, NA rows greyed, moved rows struck', () => {
    const onOpen = vi.fn();
    render(
      <ReviewPanel
        tasks={[
          task({
            id: 'd1',
            status: 'DONE',
            deliverable: 'Klaar item',
            attachments: [
              {
                id: 'att1',
                name: 'Besluit',
                url: 'https://docs.google.com/document/d/1',
                kind: 'GOOGLE_DOC',
                addedByUserId: 'u1',
                addedByLabel: 'Ernest',
                addedAt: 't',
              },
            ],
          }),
          task({ id: 'n1', status: 'NA', deliverable: 'Nvt item' }),
        ]}
        movedOut={[task({ id: 'm1', step: 'WIP', blok: '', deliverable: 'Doorgeschoven item' })]}
        lang="nl"
        onOpen={onOpen}
      />,
    );

    const rows = screen.getAllByTestId('review-row');
    expect(rows[0]!.className).toContain('done');
    expect(rows[1]!.className).toContain('na');

    // Documents on completed rows stay clickable for the reviewer.
    fireEvent.click(screen.getByText('Besluit'));
    expect(onOpen).toHaveBeenCalledWith('https://docs.google.com/document/d/1');

    // Moved rows: own section, struck-through deliverable.
    const moved = screen.getByTestId('review-moved-row');
    expect(moved.textContent).toContain('Doorgeschoven item');
    expect(screen.getByText('Doorgeschoven item').style.textDecoration).toBe('line-through');
  });

  it('renders nothing moved-related when no rows were moved', () => {
    render(<ReviewPanel tasks={[task({ id: 'a' })]} lang="nl" onOpen={vi.fn()} />);
    expect(screen.queryByTestId('review-moved')).toBeNull();
  });
});
