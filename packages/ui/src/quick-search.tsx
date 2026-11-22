import { Search, X } from 'lucide-react';
import { type ComponentProps, type ReactElement, type ReactNode, useRef } from 'react';
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from './input-group';
import { m } from './text';

const CLEAR_SEARCH = { key: 'ui.quickSearch.clear', defaultValue: 'Clear search' };

type InputProps = Omit<ComponentProps<'input'>, 'children' | 'className' | 'defaultValue' | 'onChange' | 'value'>;
const inputStyle = {
  'data-slot': 'input-group-control',
  className: 'h-11 min-w-0 md:h-8 [&::-webkit-search-cancel-button]:appearance-none',
};

type QuickSearchProps = InputProps & {
  className?: string;
  value: string;
  onValueChange: (value: string) => void;
  renderGroup?: (group: ReactElement) => ReactNode;
  renderInput?: (inputProps: typeof inputStyle) => ReactNode;
  children?: ReactNode;
};

export function QuickSearch({
  value,
  onValueChange,
  className,
  renderGroup,
  renderInput,
  children,
  ...props
}: QuickSearchProps) {
  const group = useRef<HTMLDivElement>(null);
  const control = (
    <InputGroup ref={group} className={className} data-quick-search="">
      <InputGroupAddon>
        <Search aria-hidden="true" />
      </InputGroupAddon>
      {renderInput ? (
        renderInput(inputStyle)
      ) : (
        <InputGroupInput
          aria-label={props.id || props['aria-labelledby'] ? undefined : props.placeholder}
          {...props}
          {...inputStyle}
          value={value}
          onChange={(event) => onValueChange(event.target.value)}
        />
      )}
      {children}
      {!!value && !props.disabled && !props.readOnly && (
        // A combobox popup hides its sibling content from assistive technology. Keep the clear control
        // available beside the textbox while its list is open, without announcing every query change.
        <InputGroupAddon align="inline-end" aria-live={renderGroup ? 'off' : undefined}>
          <InputGroupButton
            size="icon-xs"
            data-slot="quick-search-clear"
            aria-label={m(CLEAR_SEARCH)}
            className="size-11 text-muted-foreground md:size-6"
            onMouseDown={(event) => event.preventDefault()}
            onKeyDown={(event) => {
              if (event.key !== 'Escape') event.stopPropagation();
            }}
            onClick={() => {
              onValueChange('');
              group.current?.querySelector('input')?.focus();
            }}
          >
            <X aria-hidden="true" className="size-4" />
          </InputGroupButton>
        </InputGroupAddon>
      )}
    </InputGroup>
  );
  return renderGroup ? renderGroup(control) : control;
}
