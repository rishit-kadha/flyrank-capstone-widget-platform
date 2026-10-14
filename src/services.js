import { AppError, notFound } from './errors.js';
import { validateFields } from './validation.js';
import { requestHash, sha256 } from './security.js';

export function createSubmissionService({ repo, geoService }) {
  return {
    async submit({ body, idempotencyKey, ip }) {
      if (body.website) throw new AppError(400, 'submission_rejected', 'Submission rejected');
      const widget = await repo.getPublicWidget(body.widget_id);
      if (!widget) throw notFound();
      const fields = validateFields(widget, body.fields);
      const sortedFields = Object.fromEntries(Object.entries(fields).sort(([a], [b]) => a.localeCompare(b)));
      const hash = requestHash({ widget_id: widget.id, fields: sortedFields });
      const settings = await repo.getDemoSettings(widget.tenant_id);
      let geo = null;
      try { geo = await geoService.lookup(ip, settings); } catch { /* Enrichment cannot prevent capture. */ }
      const result = await repo.createSubmission({
        tenantId: widget.tenant_id, widgetId: widget.id, fields,
        geo, ipHash: sha256(ip), idempotencyKey, requestHash: hash,
      });
      if (result.conflict) throw new AppError(409, 'idempotency_conflict', 'This idempotency key was already used with different input');
      return { id: result.submission.id, replayed: result.replayed, geo: result.submission.geo };
    },
  };
}
