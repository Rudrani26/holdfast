import "server-only";

/**
 * Local development only: user Application Default Credentials may carry another project as the
 * quota project, so bill this app's calls to its own project. On Cloud Run (K_SERVICE is set) the
 * service account already is the right identity, and forcing a quota project would require an extra
 * `serviceusage.services.use` grant (seen on the first deploy: Storage 403).
 */
export function applyLocalQuotaProject(projectId: string | undefined): void {
  if (process.env.K_SERVICE || !projectId) return;
  process.env.GOOGLE_CLOUD_QUOTA_PROJECT ??= projectId;
}
