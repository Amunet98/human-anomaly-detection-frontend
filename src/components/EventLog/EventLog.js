
// Session-local record of confirmed falls.
//
// Deliberately not persisted to the backend. Writing here would need a public
// unauthenticated write endpoint, which is an abuse vector for very little
// gain, and these are frames from a stranger's own webcam. The backend's
// existing GET /detected history covers the shared feed instead.
export function EventLog({ events, tracked, state }) {
  return (
    <div className="rounded-2xl border border-gray-500/25 overflow-hidden h-full flex flex-col">
      <div className="px-4 py-3 border-b border-gray-500/25">
        <div className="font-mono text-[11px] uppercase tracking-widest opacity-55">
          Event log
        </div>
      </div>

      <div className="px-4 py-3 border-b border-gray-500/25 flex items-center justify-between gap-3">
        <Stat label="Tracked" value={tracked} />
        <Stat label="State" value={state ? state.toUpperCase() : '—'} />
        <Stat label="Falls" value={events.length} />
      </div>

      <div className="flex-1 overflow-y-auto max-h-72 lg:max-h-none">
        {events.length === 0 ? (
          <p className="px-4 py-6 text-xs opacity-50 leading-relaxed">
            No falls confirmed in this session. A detection has to persist for over
            a second before it is recorded here.
          </p>
        ) : (
          <ul>
            {events.map((event) => (
              <li
                key={event.id}
                className="px-4 py-2.5 border-b border-gray-500/15 flex items-center gap-3 font-mono text-xs"
              >
                <span className="w-1.5 h-1.5 rounded-full bg-red-500 flex-shrink-0" />
                <span className="opacity-70">
                  {new Date(event.at).toLocaleTimeString([], {
                    hour: '2-digit',
                    minute: '2-digit',
                    second: '2-digit',
                  })}
                </span>
                <span className="font-bold text-red-500">FALL</span>
                <span className="opacity-50 ml-auto">
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
      <div className="font-mono text-[10px] uppercase tracking-widest opacity-45">{label}</div>
      <div className="font-mono text-sm font-bold truncate">{value}</div>
    </div>
  );
}
