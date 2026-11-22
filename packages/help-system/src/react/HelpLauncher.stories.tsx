// Plain CSF3 — no `@storybook/react-vite` import so the package's typecheck stays
// dependency-free (Storybook types are wired by the host app, not this package).
import { HelpLauncher } from './HelpLauncher';

const meta = { title: 'Help/HelpLauncher', component: HelpLauncher };
export default meta;

export const Closed = {
  args: { isOpen: false, onClick: () => {} },
};

export const Open = {
  args: { isOpen: true, onClick: () => {} },
};

export const CustomLabel = {
  args: { isOpen: false, label: 'Open help', onClick: () => {} },
};
