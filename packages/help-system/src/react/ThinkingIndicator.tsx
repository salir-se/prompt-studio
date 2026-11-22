import type { CSSProperties } from 'react';

// In-flight indicator for the help chat: while the assistant request is processing
// (HelpPanel `busy`), we show a placeholder "Thinking…" turn in the conversation so
// the user knows their question was received and a reply is coming.
//
// Styled to match an assistant message bubble. Dependency-free: the bouncing dots
// are driven by a scoped <style> keyframe (inline styles can't express keyframes),
// and degrade to three static dots where animation is unavailable.

const ANIMATION = 'salir-help-thinking-bounce';

const dotStyle: CSSProperties = {
  width: 6,
  height: 6,
  borderRadius: '50%',
  background: 'currentColor',
  opacity: 0.55,
  animation: `${ANIMATION} 1.2s ease-in-out infinite`,
};

/** A placeholder assistant turn shown while a reply is being generated. */
export function ThinkingIndicator() {
  return (
    <li
      data-help-thinking
      // Announced via the conversation log's aria-live; the label gives screen
      // readers a meaningful phrase instead of three decorative dots.
      aria-label="Assistant is thinking"
      style={{
        alignSelf: 'flex-start',
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        maxWidth: '85%',
        padding: '8px 12px',
        borderRadius: 10,
        background: 'var(--muted, #f4f4f5)',
        color: 'inherit',
      }}
    >
      <style>{`@keyframes ${ANIMATION}{0%,80%,100%{opacity:.3;transform:translateY(0)}40%{opacity:.9;transform:translateY(-3px)}}`}</style>
      <span style={{ fontSize: 13, opacity: 0.8 }}>Thinking</span>
      <span aria-hidden="true" style={{ display: 'inline-flex', gap: 4 }}>
        <span style={dotStyle} />
        <span style={{ ...dotStyle, animationDelay: '0.15s' }} />
        <span style={{ ...dotStyle, animationDelay: '0.3s' }} />
      </span>
    </li>
  );
}
