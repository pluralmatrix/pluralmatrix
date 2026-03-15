import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import LoginPage from '../pages/LoginPage';
import { AuthProvider } from '../hooks/useAuth';
import { BrowserRouter } from 'react-router-dom';

describe('LoginPage', () => {
  it('renders login form', () => {
    render(
      <AuthProvider>
        <BrowserRouter>
          <LoginPage />
        </BrowserRouter>
      </AuthProvider>,
    );

    expect(screen.getByText(/PluralMatrix/i)).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/@user:server.com/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Sign In/i })).toBeInTheDocument();
  });
});
