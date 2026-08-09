import { IconBrandGithub } from "@tabler/icons-react";

export function FooterLinks() {
  return (
    <footer className="border-t border-line mt-auto">
      <div className="page-gutter py-8 flex flex-col sm:flex-row items-center justify-between gap-4 text-center sm:text-left">
        <p className="text-sm text-dim">
          Built at <abbr title="Acharya Institute of Technology" className="no-underline">AIT</abbr> by{' '}
          <span className="text-head">Bimesh Poudel</span> and{' '}
          <span className="text-head">Prashanna KC</span>
        </p>

        <a
          href="https://github.com/Amunet98/human-anomaly-detection-frontend"
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-2 min-h-11 px-3 -mx-3 rounded-lg font-mono text-xs text-dim no-underline transition-colors duration-200 hover:text-head"
        >
          <IconBrandGithub size={16} aria-hidden="true" />
          Source
        </a>
      </div>
    </footer>
  );
}
