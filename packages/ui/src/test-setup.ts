import '@testing-library/jest-dom';
import { installConsoleSilencer, installHappyDomStorage } from '@prompt-studio/observability/test';

// Memory-buffered console capture: silent on pass, dump-to-stderr on fail.
installConsoleSilencer();
// Restore real localStorage/sessionStorage under happy-dom + vitest.
installHappyDomStorage();
