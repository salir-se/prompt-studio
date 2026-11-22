/** A second Studio server must not recover work still owned by a live process. */
export function isProcessAlive(pid: number | undefined): boolean {
  if (!Number.isInteger(pid) || !pid || pid < 1) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}
