import { useState } from 'react';

interface CompanyLogoProps {
  /** Logo URL. Null or absent falls straight through to the initial. */
  src?: string | null;
  /** Company or person name — supplies the initial, so it is required. */
  name: string;
  /** Base class. The placeholder gets `${className}--placeholder` alongside it. */
  className?: string;
  size?: 'sm' | 'md' | 'lg';
}

/**
 * A company logo that degrades to the name's initial.
 *
 * This existed in seven places as an `<img>` whose `onError` set
 * `display: none`, which is why it is now a component. Two problems came with
 * that shape:
 *
 *  - **The fallback never ran.** Only the *absent-URL* case rendered an initial;
 *    a URL that 404s — the common case, since these point at a third-party logo
 *    service — hid the image and left a gap. That is precisely the case the
 *    fallback was written for.
 *  - **Rows jumped.** Where the placeholder was omitted entirely, a row with a
 *    logo and a row without were indented differently, so a table column visibly
 *    failed to line up.
 *
 * Rendering the initial whenever there is no usable image fixes both: something
 * always occupies the slot.
 */
export function CompanyLogo({ src, name, className = 'customer-logo', size }: CompanyLogoProps) {
  const [failed, setFailed] = useState(false);
  const classes = [className, size ? `${className}--${size}` : null].filter(Boolean).join(' ');

  if (!src || failed) {
    const initial = name?.trim().charAt(0).toUpperCase() || '?';
    return (
      <span className={`${classes} ${className}--placeholder`} aria-hidden="true">
        {initial}
      </span>
    );
  }

  return (
    <img
      src={src}
      alt=""
      className={classes}
      // State, not a style mutation: setting `display: none` on the element left
      // nothing behind it, and the component could never recover if the same
      // logo later loaded.
      onError={() => setFailed(true)}
    />
  );
}
