import { useState, useEffect, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Button, InlineNotification, Theme } from '@carbon/react';
import { ArrowRight } from '@carbon/icons-react';
import { api } from '../../api/client';
import { MailvizLogo } from '../shared/MailvizLogo';

const ERROR_MESSAGES: Record<string, string> = {
  unauthorized: 'Your email is not authorized to access this application.',
  no_email: 'Could not retrieve your email from Google.',
  missing_code: 'Missing authorization code from Google.',
  invalid_state: 'Invalid OAuth state. Please try again.',
};

function WaterBackground() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let animationId: number;
    let time = 0;

    const resize = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
    };
    resize();
    window.addEventListener('resize', resize);

    const render = () => {
      time += 0.008;
      const { width, height } = canvas;

      ctx.fillStyle = '#161616';
      ctx.fillRect(0, 0, width, height);

      const imageData = ctx.getImageData(0, 0, width, height);
      const data = imageData.data;
      const step = 4;

      for (let y = 0; y < height; y += step) {
        for (let x = 0; x < width; x += step) {
          const nx = x / width;
          const ny = y / height;

          // Layered waves
          const w1 = Math.sin(nx * 6 + time * 1.2) * Math.cos(ny * 5 - time * 0.8);
          const w2 = Math.sin(nx * 8 - time * 0.6 + ny * 3) * Math.cos(ny * 7 + time * 1.1);
          const w3 = Math.sin((nx + ny) * 10 + time * 0.9) * 0.5;
          const w4 = Math.cos(nx * 4 - ny * 6 + time * 0.7) * Math.sin(nx * 3 + time * 1.3);
          const w5 = Math.sin(nx * 12 + ny * 8 - time * 1.5) * 0.3;

          const caustic = (w1 + w2 + w3 + w4 + w5) / 4.5;
          const intensity = Math.pow(Math.max(0, caustic), 1.4);

          // Deep blue-purple-cyan palette
          const zone = Math.sin(nx * 2.5 + ny * 1.5 + time * 0.2);
          const purple = Math.max(0, zone) * 0.4;
          const cyan = Math.max(0, -zone) * 0.3;

          const r = Math.floor(intensity * 40 + purple * 80 + 8);
          const g = Math.floor(intensity * 40 + cyan * 60 + 8);
          const b = Math.floor(intensity * 180 + purple * 30 + 20);

          for (let dy = 0; dy < step && y + dy < height; dy++) {
            for (let dx = 0; dx < step && x + dx < width; dx++) {
              const i = ((y + dy) * width + (x + dx)) * 4;
              data[i] = r;
              data[i + 1] = g;
              data[i + 2] = b;
              data[i + 3] = 255;
            }
          }
        }
      }

      ctx.putImageData(imageData, 0, 0);

      // Glowing highlights
      ctx.globalCompositeOperation = 'screen';
      const highlights = [
        { color: 'rgba(120, 80, 220, 0.07)', ox: 0.6, oy: 0.25 },
        { color: 'rgba(50, 150, 255, 0.06)', ox: 0.7, oy: 0.6 },
        { color: 'rgba(0, 200, 220, 0.05)', ox: 0.5, oy: 0.8 },
        { color: 'rgba(100, 100, 255, 0.05)', ox: 0.8, oy: 0.4 },
      ];
      for (let i = 0; i < highlights.length; i++) {
        const h = highlights[i];
        const cx = width * (h.ox + 0.08 * Math.sin(time * 0.3 + i * 1.5));
        const cy = height * (h.oy + 0.1 * Math.cos(time * 0.25 + i));
        const radius = 200 + 100 * Math.sin(time * 0.4 + i);
        const gradient = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius);
        gradient.addColorStop(0, h.color);
        gradient.addColorStop(1, 'rgba(0, 0, 0, 0)');
        ctx.fillStyle = gradient;
        ctx.fillRect(0, 0, width, height);
      }
      ctx.globalCompositeOperation = 'source-over';

      animationId = requestAnimationFrame(render);
    };

    render();

    return () => {
      cancelAnimationFrame(animationId);
      window.removeEventListener('resize', resize);
    };
  }, []);

  return <canvas ref={canvasRef} className="login-water-canvas" />;
}

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
        <WaterBackground />
        <div className="login-panel">
          <div className="login-panel__content">
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.25rem' }}>
              <MailvizLogo size={40} />
              <h1 className="login-panel__title" style={{ margin: 0 }}>Mailviz</h1>
            </div>
            <p className="login-panel__subtitle">
              Personal CRM & Email Manager
            </p>

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
      </div>
    </Theme>
  );
}
