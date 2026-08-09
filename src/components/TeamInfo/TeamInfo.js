import { IconBrandGithub, IconMail, IconPhone } from '@tabler/icons-react';

function initials(name) {
  return name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0].toUpperCase())
    .join('');
}

export function TeamInfo({ name, title, phone, email, github }) {
  // Initials rather than a photo. The two avatars this previously pointed at
  // were both dead: one a LinkedIn CDN URL whose signature expired in 2023
  // (`e=1694044800`), the other a bare "WhatsApp Image ....jpg" filename that
  // was never in the bundle at all - so every visitor got two broken images.
  // Initials can't rot.
  const handle = github?.replace(/^https?:\/\/github\.com\//, '');

  return (
    <div className="w-full max-w-sm rounded-2xl border border-line bg-raise p-5 flex gap-4 items-start">
      <span
        className="grid h-16 w-16 flex-shrink-0 place-items-center rounded-xl bg-accent-dim border border-accent font-mono text-lg font-bold text-accent"
        aria-hidden="true"
      >
        {initials(name)}
      </span>

      <div className="min-w-0">
        <p className="font-mono text-[11px] uppercase tracking-widest text-dim">{title}</p>
        <p className="text-lg font-semibold text-head mt-0.5">{name}</p>

        <ul className="mt-3 space-y-1.5 text-sm">
          <ContactRow icon={IconMail} href={`mailto:${email}`} label={email} />
          <ContactRow icon={IconPhone} href={`tel:${phone}`} label={phone} />
          {handle && (
            <ContactRow icon={IconBrandGithub} href={github} label={handle} external />
          )}
        </ul>
      </div>
    </div>
  );
}

function ContactRow({ icon: Icon, href, label, external = false }) {
  return (
    <li>
      <a
        href={href}
        {...(external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
        className="inline-flex items-center gap-2 min-h-11 text-dim no-underline transition-colors duration-200 hover:text-accent break-all"
      >
        <Icon size={16} stroke={1.5} className="flex-shrink-0" aria-hidden="true" />
        {label}
      </a>
    </li>
  );
}
