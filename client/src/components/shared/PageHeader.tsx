import { Breadcrumb, BreadcrumbItem } from '@carbon/react';
import { useNavigate } from 'react-router-dom';

interface BreadcrumbEntry {
  label: string;
  href: string;
}

interface PageHeaderProps {
  title: string;
  subtitle?: string;
  breadcrumbs?: BreadcrumbEntry[];
  actions?: React.ReactNode;
  padded?: boolean;
}

export function PageHeader({ title, subtitle, breadcrumbs, actions, padded }: PageHeaderProps) {
  const navigate = useNavigate();

  return (
    <>
      {breadcrumbs && breadcrumbs.length > 0 && (
        <Breadcrumb noTrailingSlash className="page-header__breadcrumb">
          {breadcrumbs.map((bc) => (
            <BreadcrumbItem
              key={bc.href}
              href={bc.href}
              onClick={(e: React.MouseEvent) => {
                e.preventDefault();
                navigate(bc.href);
              }}
            >
              {bc.label}
            </BreadcrumbItem>
          ))}
        </Breadcrumb>
      )}
      <div className={`page-header${padded ? ' page-header--padded' : ''}`}>
        <div className="page-header__info">
          <h1>{title}</h1>
          {subtitle && <p className="page-header__subtitle">{subtitle}</p>}
        </div>
        {actions && <div className="page-header__actions">{actions}</div>}
      </div>
    </>
  );
}
