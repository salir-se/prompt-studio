import { Button } from '@prompt-studio/ui/button';
import type { ReferenceResolution } from '../references-resolver';

export function FileReferenceDetails({
  resolution,
  onOpen,
}: {
  resolution: ReferenceResolution;
  onOpen: (path: string) => void;
}) {
  return (
    <div className="space-y-3 border-t border-border p-5 text-xs">
      <h3 className="text-sm font-semibold">File reference</h3>
      <p className={resolution.state === 'Missing' ? 'font-semibold text-destructive' : 'font-semibold'}>
        {resolution.state}
      </p>
      {resolution.state === 'Found' ? (
        <>
          <p className="break-all rounded-lg border border-border bg-muted/20 p-3 font-mono leading-relaxed">
            {resolution.path}
          </p>
          <Button size="sm" onClick={() => onOpen(resolution.path)}>
            Open file
          </Button>
          <p className="text-muted-foreground">
            Click the file node or press Enter to open it. Alt+R focuses the next file reference.
          </p>
        </>
      ) : resolution.state === 'Ambiguous' ? (
        <>
          <p>Choose the intended project file. The source reference stays as written.</p>
          <div className="grid gap-2">
            {resolution.candidates.map((path) => (
              <Button
                key={path}
                size="sm"
                variant="outline"
                className="h-auto max-w-full justify-start whitespace-normal break-all px-3 py-3 text-left font-mono text-xs"
                onClick={() => onOpen(path)}
              >
                {path}
              </Button>
            ))}
          </div>
        </>
      ) : (
        <p className="text-muted-foreground">
          {resolution.state === 'Missing'
            ? 'This path was not found in the open project. Add the file to the project or correct the reference in the prompt.'
            : 'This reference cannot be opened within the project. Use a project-relative path.'}
        </p>
      )}
    </div>
  );
}
