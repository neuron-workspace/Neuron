import type { RepositoryInfo } from '../electron.d';

/** Whether another recent workspace has the same name, so this one needs its folder shown. */
export function sharedName(recents: RepositoryInfo[], repo: RepositoryInfo): boolean {
  return recents.some((other) => other.path !== repo.path && other.name === repo.name);
}

/** The two folders above a workspace, which is what tells two of one name apart. */
export function parentFolder(dir: string): string {
  const parts = dir.split(/[\\/]+/).filter(Boolean);
  return parts.slice(-3, -1).join('/');
}
