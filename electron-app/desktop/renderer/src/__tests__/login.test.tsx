// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { User } from '@shared/types';
import { Login } from '../views/Login';
import { api } from '../services/api';

vi.mock('../services/api', () => ({
  api: {
    login: vi.fn(),
    signup: vi.fn(),
    resetRequest: vi.fn(),
    resetComplete: vi.fn(),
  },
}));

const mocked = api as unknown as {
  login: ReturnType<typeof vi.fn>;
  signup: ReturnType<typeof vi.fn>;
  resetRequest: ReturnType<typeof vi.fn>;
  resetComplete: ReturnType<typeof vi.fn>;
};

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function fill(name: string, value: string): void {
  const input = document.querySelector(`[name="${name}"]`) as HTMLInputElement;
  fireEvent.change(input, { target: { value } });
}

describe('Login view', () => {
  it('successful login passes the user up', async () => {
    const user = { id: 'u1', displayName: 'Ernest', role: 'OWNER' } as User;
    mocked.login.mockResolvedValue({ outcome: 'OK', user });
    const onLoggedIn = vi.fn();
    render(<Login lang="nl" onLoggedIn={onLoggedIn} />);
    fill('email', 'ernest@1828.nl');
    fill('password', 'ernest');
    fireEvent.submit(screen.getByTestId('login-form'));
    await waitFor(() => expect(onLoggedIn).toHaveBeenCalledWith(user));
  });

  it('pending account shows the Dutch pending message', async () => {
    mocked.login.mockResolvedValue({ outcome: 'PENDING' });
    render(<Login lang="nl" onLoggedIn={() => {}} />);
    fill('email', 'niels@1828.nl');
    fill('password', 'test');
    fireEvent.submit(screen.getByTestId('login-form'));
    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toContain('wacht op goedkeuring'),
    );
  });

  it('signup flow reaches the submitted confirmation', async () => {
    mocked.signup.mockResolvedValue('OK');
    render(<Login lang="nl" onLoggedIn={() => {}} />);
    fireEvent.click(screen.getByText('Account aanvragen'));
    fill('name', 'Test');
    fill('email', 'test@1828.nl');
    fill('password', 'test');
    fireEvent.submit(screen.getByTestId('signup-form'));
    await waitFor(() => expect(screen.getByTestId('signup-done')).toBeTruthy());
  });

  it('reset flow: unknown email errors, known email advances to the code step', async () => {
    mocked.resetRequest.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    render(<Login lang="nl" onLoggedIn={() => {}} />);
    fireEvent.click(screen.getByText('Wachtwoord vergeten?'));
    fill('email', 'ghost@1828.nl');
    fireEvent.submit(screen.getByTestId('reset-email-form'));
    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());

    fill('email', 'pia@1828.nl');
    fireEvent.submit(screen.getByTestId('reset-email-form'));
    await waitFor(() => expect(screen.getByTestId('reset-code-form')).toBeTruthy());
  });
});
