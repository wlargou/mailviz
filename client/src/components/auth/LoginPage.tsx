import { useState } from 'react';
import { authApi } from '../../api/auth';
import { useSearchParams } from 'react-router-dom';
import { Button, InlineNotification, Theme } from '@carbon/react';
import { ArrowRight } from '@carbon/icons-react';
import { BrandMark } from '../shared/BrandMark';
import { useUIStore } from '../../store/uiStore';
import { PRODUCT_DESCRIPTOR, PRODUCT_NAME } from '../../brand';

const ERROR_MESSAGES: Record<string, string> = {
  unauthorized: 'Your email is not authorized to access this application.',
  no_email: 'Could not retrieve your email from Google.',
  missing_code: 'Missing authorization code from Google.',
  invalid_state: 'Invalid OAuth state. Please try again.',
};

/**
 * The sign-in screen: the name and what it is, beside the mark.
 *
 * It was a full-screen canvas animation in blue, purple and cyan with a
 * floating, rotating logo. The design system allows no gradient but the AI aura
 * and no motion outside `prefers-reduced-motion: no-preference`, so the mark is
 * now static and the only motion is the panel's one-time rise, in _login.scss.
 * It follows the saved theme rather than forcing g100, so signing in and the
 * app read as one surface.
 */
export function LoginPage() {
  const theme = useUIStore((s) => s.theme);
  const [searchParams] = useSearchParams();
  const [loading, setLoading] = useState(false);
  const error = searchParams.get('error');

  const handleLogin = async () => {
    setLoading(true);
    try {
      const { data } = await authApi.getLoginUrl();
      window.location.href = data.data.url;
    } catch {
      setLoading(false);
    }
  };

  return (
    <Theme theme={theme}>
      <div className="login-page">
        <div className="login-panel">
          <div className="login-panel__content">
            <BrandMark size={48} className="login-panel__mark" />
            <h1 className="login-panel__title brand-name">{PRODUCT_NAME}</h1>
            <p className="login-panel__subtitle">{PRODUCT_DESCRIPTOR}</p>

            <div className="login-panel__divider" />

            {error && (
              <InlineNotification
                kind="error"
                title="Sign in failed"
                subtitle={ERROR_MESSAGES[error] || 'An unexpected error occurred.'}
                lowContrast
                hideCloseButton
                className="login-panel__error"
              />
            )}

            <p className="login-panel__label">Sign in</p>

            <Button
              kind="primary"
              size="lg"
              className="login-panel__button"
              onClick={handleLogin}
              disabled={loading}
              renderIcon={ArrowRight}
            >
              {loading ? 'Redirecting...' : 'Continue with Google'}
            </Button>
          </div>
        </div>
        {/* The large mark. Decoration: the panel already names the product. */}
        <div className="login-art" aria-hidden="true">
          <BrandMark size={400} className="login-art__mark" />
        </div>
      </div>
    </Theme>
  );
}
