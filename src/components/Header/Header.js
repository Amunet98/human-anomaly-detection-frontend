import { useCallback, useState } from 'react';
import { Link, NavLink } from 'react-router-dom';
import { IconSun, IconMoonStars, IconMenu2, IconX } from '@tabler/icons-react';

// Sticky rather than the old `position: absolute` + `mb={120}` + `mt-20`
// arrangement, which reserved space with magic numbers that only lined up at
// one viewport width and left a gap everywhere else.
export function SiteHeader({ links, theme, onToggleTheme }) {
  const [open, setOpen] = useState(false);

  // Closing on the link's own click rather than in an effect on the pathname:
  // navigation is the event, so handling it directly avoids the extra
  // render pass a setState-in-effect would cascade.
  const close = useCallback(() => setOpen(false), []);

  return (
    <header className="sticky top-0 z-40 border-b border-line bg-canvas/85 backdrop-blur-md">
      <div className="page-gutter flex h-16 items-center justify-between gap-3">
        <Link
          to="/"
          // min-w/h-11: below xs the name is hidden and only the 40px mark
          // remains, which is under the 44px touch minimum on its own.
          className="flex items-center justify-center xs:justify-start gap-3 min-h-11 min-w-11 xs:min-w-0 no-underline text-inherit rounded-sm"
          aria-label="Human Anomaly Detection — home"
        >
          <span className="had-mark" aria-hidden="true">HAD</span>
          {/* Below 400px the mark alone carries the brand: repeating "HAD" as
              text beside a mark that already reads HAD was redundant, and the
              full name crowds the two 44px controls at that width. */}
          <span className="had-name hidden xs:flex flex-col">
            Human Anomaly Detection
            <span className="had-sub">real-time fall detection</span>
          </span>
        </Link>

        <div className="flex items-center gap-1">
          <nav className="hidden sm:flex items-center gap-1" aria-label="Main">
            {links.map((link) => (
              <HeaderLink key={link.link} to={link.link} onClick={close}>
                {link.label}
              </HeaderLink>
            ))}
          </nav>

          <button
            type="button"
            onClick={onToggleTheme}
            className="grid h-11 w-11 place-items-center rounded-lg text-dim transition-colors duration-200 hover:text-head hover:bg-raise cursor-pointer"
            aria-label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
          >
            {theme === 'dark' ? <IconSun size={20} /> : <IconMoonStars size={20} />}
          </button>

          <button
            type="button"
            onClick={() => setOpen((value) => !value)}
            className="grid h-11 w-11 place-items-center rounded-lg text-dim transition-colors duration-200 hover:text-head hover:bg-raise cursor-pointer sm:hidden"
            aria-label={open ? 'Close menu' : 'Open menu'}
            aria-expanded={open}
            aria-controls="header-menu"
          >
            {open ? <IconX size={20} /> : <IconMenu2 size={20} />}
          </button>
        </div>
      </div>

      {open && (
        <nav
          id="header-menu"
          aria-label="Main"
          className="sm:hidden border-t border-line bg-canvas page-gutter pb-3"
        >
          {links.map((link) => (
            <HeaderLink key={link.link} to={link.link} onClick={close} block>
              {link.label}
            </HeaderLink>
          ))}
        </nav>
      )}
    </header>
  );
}

// NavLink rather than the previous useState(links[0].link): that seeded "home"
// as active on every load, so landing directly on /about highlighted the wrong
// item until you clicked something.
function HeaderLink({ to, children, onClick, block = false }) {
  return (
    <NavLink
      to={to}
      end={to === '/'}
      onClick={onClick}
      className={({ isActive }) =>
        [
          'font-mono text-sm no-underline transition-colors duration-200 cursor-pointer',
          block
            ? 'flex items-center min-h-11 px-1 border-b border-line/60 last:border-0'
            : 'flex items-center h-11 px-3 rounded-lg',
          isActive ? 'text-accent' : 'text-dim hover:text-head',
        ].join(' ')
      }
    >
      <span className="text-accent mr-1.5" aria-hidden="true">$</span>
      {children}
    </NavLink>
  );
}
