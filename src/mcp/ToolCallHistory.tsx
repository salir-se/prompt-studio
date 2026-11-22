import type { ToolCallTrace } from './contracts';
export function ToolCallHistory({ calls }: { calls: ToolCallTrace[] }) {
  if (!calls.length) return null;
  return (
    <section aria-label="Tool call history" className="grid min-w-0 gap-3">
      <h4 className="text-sm font-medium">Tool calls · {calls.length}</h4>
      {calls.map((call) => (
        <details key={call.id} className="min-w-0 rounded-lg border p-3 text-xs">
          <summary className="cursor-pointer break-words">
            <span className="mr-2 rounded border px-1.5 py-0.5 font-medium">{call.mode.toUpperCase()}</span>
            {call.name} · {call.error ? 'Failed' : call.finishedAt ? 'Completed' : 'Running…'}
          </summary>
          <div className="mt-3 grid min-w-0 gap-2">
            <p className="break-all">
              {call.serverName ?? call.serverId} · {call.toolName}
            </p>
            <p>{new Date(call.startedAt).toLocaleString()}</p>
            <h5 className="font-medium">Arguments</h5>
            <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-words">
              {JSON.stringify(call.input, null, 2)}
            </pre>
            <h5 className="font-medium">
              {call.mode === 'mock' ? 'Predefined mock result' : call.mode === 'real' ? 'MCP result' : 'Refusal'}
            </h5>
            <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words">
              {JSON.stringify(call.result, null, 2) ?? 'No result yet.'}
            </pre>
            {call.error && (
              <p role="alert" className="text-destructive">
                {call.error}
              </p>
            )}
          </div>
        </details>
      ))}
    </section>
  );
}
