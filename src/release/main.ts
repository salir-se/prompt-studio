import { runCli } from './update';

const argv = process.argv.slice(2);
const code = await runCli(argv, process.env, (line) => {
  process.stdout.write(line.endsWith('\n') ? line : `${line}\n`);
});
const startedEditor = argv.length === 0 || (!argv.includes('--help') && !argv.includes('help') && argv[0] !== 'update');
if (!startedEditor || code !== 0) process.exit(code);
