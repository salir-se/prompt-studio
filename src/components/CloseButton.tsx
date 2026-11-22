import { Button } from '@prompt-studio/ui/button';
import { X } from '@prompt-studio/ui/icons';

export function CloseButton({
  onClick,
  label = 'Close',
  disabled,
}: {
  onClick: () => void;
  label?: string;
  disabled?: boolean;
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      className="max-sm:size-11"
      data-toolbar-mode="icons"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
    >
      <X className="size-4" aria-hidden="true" />
    </Button>
  );
}
