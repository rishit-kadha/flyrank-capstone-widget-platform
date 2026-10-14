import { z } from 'zod';
import { AppError } from './errors.js';

const field = z.object({
  name: z.string().regex(/^[a-z][a-z0-9_]{0,39}$/).refine(name => !['website', 'widget_id', '__proto__', 'constructor', 'prototype'].includes(name)),
  label: z.string().trim().min(1).max(80),
  type: z.enum(['text', 'email', 'textarea']),
  required: z.boolean(),
}).strict();
export const widgetSchema = z.object({
  type: z.enum(['signup', 'contact', 'popover']).default('contact'),
  title: z.string().trim().min(1).max(120),
  description: z.string().trim().max(500).default(''),
  button_text: z.string().trim().min(1).max(60).default('Send message'),
  fields: z.array(field).min(1).max(8).refine(fields => new Set(fields.map(f => f.name)).size === fields.length, 'Field names must be unique'),
  display: z.object({
    accent: z.string().regex(/^#[0-9a-fA-F]{6}$/).default('#2563eb'),
    position: z.enum(['inline', 'bottom-right']).default('inline'),
  }).strict().default({ accent: '#2563eb', position: 'inline' }),
  active: z.boolean().default(true),
}).strict();
// Patch fields deliberately have no defaults: omission must preserve stored values.
export const widgetPatchSchema = z.object({
  type: z.enum(['signup', 'contact', 'popover']).optional(),
  title: widgetSchema.shape.title.optional(),
  description: z.string().trim().max(500).optional(),
  button_text: z.string().trim().min(1).max(60).optional(),
  fields: widgetSchema.shape.fields.optional(),
  display: z.object({
    accent: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
    position: z.enum(['inline', 'bottom-right']).optional(),
  }).strict().optional(),
  active: z.boolean().optional(),
}).strict();
export const uuidSchema = z.string().uuid();
export const loginSchema = z.object({ email: z.string().trim().email().max(254).transform(s => s.toLowerCase()), password: z.string().min(1).max(256) }).strict();
export const submissionSchema = z.object({
  widget_id: uuidSchema,
  fields: z.record(z.string(), z.string().max(4000)).refine(fields => Object.keys(fields).length <= 8, 'At most eight fields'),
  website: z.string().max(200).optional().default(''),
}).strict();
export const demoSchema = z.object({ geo_a_down: z.boolean(), geo_b_down: z.boolean(), notification_fail: z.boolean() }).strict();
export const idempotencySchema = z.string().min(8).max(100).regex(/^[A-Za-z0-9_-]+$/);
export const querySchema = z.object({
  widget_id: uuidSchema.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).max(100000).default(0),
}).strict();
export function parse(schema, value) {
  const result = schema.safeParse(value);
  if (!result.success) throw new AppError(400, 'validation_error', 'Invalid input', result.error.issues.map(issue => ({ path: issue.path.join('.'), message: issue.message })));
  return result.data;
}
export function validateFields(config, values) {
  const keys = new Set(config.fields.map(field => field.name));
  const result = {};
  for (const key of Object.keys(values)) if (!keys.has(key)) throw new AppError(400, 'validation_error', 'Unknown form field: ' + key);
  for (const field of config.fields) {
    const value = (values[field.name] || '').trim();
    if (field.required && !value) throw new AppError(400, 'validation_error', field.label + ' is required');
    if (value.length > (field.type === 'textarea' ? 4000 : 254)) throw new AppError(400, 'validation_error', field.label + ' is too long');
    if (field.type === 'email' && value && !z.string().email().safeParse(value).success) throw new AppError(400, 'validation_error', field.label + ' must be an email');
    result[field.name] = value;
  }
  return result;
}
