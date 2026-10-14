export async function processOneJob({
  repo, notify, maxAttempts = 3, retryDelayMs = 2000, log = console.log,
}) {
  const job = await repo.claimJob();
  if (!job) return false;
  try {
    if (job.attempts > maxAttempts) throw new Error('Retry budget exhausted after worker interruption');
    const settings = await repo.getDemoSettings(job.tenant_id);
    if (settings.notification_fail) throw new Error('Simulated notification failure');
    await notify(job);
    const completed = await repo.completeJob(job.id, job.attempts);
    if (completed) log(JSON.stringify({ event: 'notification_sent', job_id: job.id }));
  } catch {
    const updated = await repo.failJob(job.id, 'Notification delivery failed', retryDelayMs * 2 ** Math.max(0, job.attempts - 1), maxAttempts, job.attempts);
    if (updated) log(JSON.stringify({ event: updated.status === 'failed' ? 'notification_failure_alert' : 'notification_retry', job_id: job.id, attempts: job.attempts }));
  }
  return true;
}
