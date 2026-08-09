import { useState } from 'react';
import { IconChevronDown } from '@tabler/icons-react';

// Session-local record of confirmed falls.
//
// Deliberately not persisted to the backend. Writing here would need a public
// unauthenticated write endpoint, which is an abuse vector for very little
// gain, and these are frames from a stranger's own webcam. The backend's
// existing GET /detected history covers the shared feed instead.
export function EventLog({ events, tracked, state }) {
  // Collapsed by default on phones: this sits directly under the camera, and
  // an expanded list pushes the feed itself off-screen. The stats row stays
  // visible either way, so the live state is never hidden behind a tap. On
  // large screens it is a rail beside the feed and always open.
  const [open, setOpen] = useState(false);

  return (
    <div className="rounded-2xl border border-line overflow-hidden h-full flex flex-col bg-raise">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-controls="event-log-list"
        className="px-4 min-h-11 border-b border-line flex items-center justify-between gap-3 text-left cursor-pointer lg:cursor-default w-full"
      >
        <span className="font-mono text-[11px] uppercase tracking-widest text-dim">
          Event log
        </span>
        <IconChevronDown
          size={16}
          className={`text-dim transition-transform duration-200 lg:hidden ${
            open ? 'rotate-180' : ''
          }`}
          aria-hidden="true"
        />
      </button>

      <div className="px-4 py-3 border-b border-line flex items-center justify-between gap-3">
        <Stat label="Tracked" value={tracked} />
        <Stat label="State" value={state ? state.toUpperCase() : '—'} />
        <Stat label="Falls" value={events.length} />
      </div>

      <div
        id="event-log-list"
        className={`flex-1 overflow-y-auto max-h-72 lg:max-h-none ${
          open ? 'block' : 'hidden'
        } lg:block`}
      >
        {events.length === 0 ? (
          <p className="px-4 py-6 text-xs text-dim leading-relaxed">
            No falls confirmed in this session. A detection has to persist for over
            a second before it is recorded here.
          </p>
        ) : (
          <ul>
            {events.map((event) => (
              <li
                key={event.id}
                className="px-4 py-2.5 border-b border-line/60 flex items-center gap-3 font-mono text-xs"
              >
                <span className="w-1.5 h-1.5 rounded-full bg-accent flex-shrink-0" />
                <span className="text-dim">
                  {new Date(event.at).toLocaleTimeString([], {
                    hour: '2-digit',
                    minute: '2-digit',
                    second: '2-digit',
                  })}
                </span>
                <span className="font-bold text-accent">FALL</span>
                <span className="text-dim ml-auto">
                  #{event.trackId} · {Math.round(event.confidence * 100)}%
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function Stat({ label, value }) {
  return (
    <div className="min-w-0">
      <div className="font-mono text-[10px] uppercase tracking-widest text-dim">{label}</div>
      {/* Tabular figures so the tracked/falls counters don't shift the row
          width every time they tick. */}
      <div className="font-mono text-sm font-bold text-head truncate tabular-nums">{value}</div>
    </div>
  );
}
