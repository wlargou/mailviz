import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Button, InlineNotification, Theme } from '@carbon/react';
import { Login } from '@carbon/icons-react';
import { api } from '../../api/client';

const ERROR_MESSAGES: Record<string, string> = {
  unauthorized: 'Your email is not authorized to access this application.',
  no_email: 'Could not retrieve your email from Google.',
  missing_code: 'Missing authorization code from Google.',
  invalid_state: 'Invalid OAuth state. Please try again.',
};

export function LoginPage() {
  const [searchParams] = useSearchParams();
  const [loading, setLoading] = useState(false);
  const error = searchParams.get('error');

  const handleLogin = async () => {
    setLoading(true);
    try {
      const { data } = await api.get<{ data: { url: string } }>('/auth/login/google/url');
      window.location.href = data.data.url;
    } catch {
      setLoading(false);
    }
  };

  return (
    <Theme theme="g100">
      <div className="login-page">
        <div className="login-card">
          <div className="login-card__header">
            <h1 className="login-card__title">MailViz</h1>
            <p className="login-card__subtitle">Personal CRM &amp; Email Manager</p>
          </div>

          {error && (
            <InlineNotification
              kind="error"
              title="Sign in failed"
              subtitle={ERROR_MESSAGES[error] || 'An unexpected error occurred.'}
              lowContrast
              hideCloseButton
              className="login-card__error"
            />
          )}

          <Button
            kind="primary"
            size="lg"
            className="login-card__button"
            onClick={handleLogin}
            disabled={loading}
            renderIcon={Login}
          >
            {loading ? 'Redirecting...' : 'Sign in with Google'}
          </Button>
        </div>
      </div>
    </Theme>
  );
}
