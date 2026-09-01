import { Button } from '@carbon/react';
import { useLocation, useNavigate } from 'react-router-dom';
import { EmptyState } from './EmptyState';

/**
 * What an unmatched URL renders.
 *
 * Before this, an unmatched path rendered nothing — the router simply had no
 * element for it, so the page went blank. That is how a single wrong link (the
 * thread reader pointed at `/companies/:id`, a route that has never existed)
 * became a white screen with no header, no side nav, and no way back except the
 * browser's Back button.
 *
 * It sits inside the shell deliberately, so the navigation survives and the
 * user can leave without using browser chrome. Showing the path they asked for
 * is the useful part: it turns "the app broke" into "that link is wrong", which
 * is the difference between a bug report and a shrug.
 */
export function NotFoundPage() {
  const navigate = useNavigate();
  const { pathname } = useLocation();

  return (
    <div className="page-content">
      <EmptyState
        title="Page not found"
        description={`Nothing lives at ${pathname}.`}
        action={
          <Button kind="tertiary" size="md" onClick={() => navigate('/')}>
            Go to dashboard
          </Button>
        }
      />
    </div>
  );
}
