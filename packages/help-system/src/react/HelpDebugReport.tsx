import type { TargetIssue } from '../core/targetScanner';

/**
 * Dev-only "Help Debug Mode" surface (ADR-089 §8a G11): renders the target-health
 * issues from {@link scanHelpTargets} as a plain list. Presentational + theme-free
 * (host decides where to mount it — typically behind a dev flag). No DOM scanning
 * here; the host passes the scan result in.
 */
export interface HelpDebugReportProps {
  issues: TargetIssue[];
}

export function HelpDebugReport({ issues }: HelpDebugReportProps) {
  if (issues.length === 0) {
    return <p data-help-debug="ok">Help targets healthy — no issues found on this page.</p>;
  }
  return (
    <ul data-help-debug="issues" aria-label="Help target issues">
      {issues.map((issue, index) => (
        <li key={`${issue.kind}:${issue.helpId ?? issue.videoId ?? index}`} data-issue-kind={issue.kind}>
          {issue.detail}
        </li>
      ))}
    </ul>
  );
}
