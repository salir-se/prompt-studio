import '@testing-library/jest-dom';
import { installConsoleSilencer } from '@prompt-studio/observability/test';

// Silent on pass, dump-to-stderr on fail; captured entries are also assertable.
installConsoleSilencer();
