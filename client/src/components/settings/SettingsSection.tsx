interface SettingsSectionProps {
  icon: React.ReactNode;
  title: string;
  description: string;
  children: React.ReactNode;
}

/**
 * The heading block every settings section shares.
 *
 * Previously repeated inline eight times, each with its own hand-written SVG —
 * which is how the page ended up with icons that were not Carbon's and headings
 * that drifted in capitalisation.
 */
export function SettingsSection({ icon, title, description, children }: SettingsSectionProps) {
  return (
    <section className="settings-section">
      <header className="settings-section__header">
        <span className="settings-section__icon" aria-hidden="true">
          {icon}
        </span>
        <div>
          <h3 className="settings-section__title">{title}</h3>
          <p className="settings-section__desc">{description}</p>
        </div>
      </header>
      <div className="settings-section__body">{children}</div>
    </section>
  );
}
