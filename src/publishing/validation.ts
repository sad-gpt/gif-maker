import { z } from 'zod';
export const settingsSchema = z.object({ title: z.string().max(80), description: z.string().max(180), template: z.enum(['grid', 'collage', 'scrapbook']), background: z.string().regex(/^#[a-f\d]{6}$/i), captions: z.boolean() });
export const imagePath = /^images\/\d{2}\.(gif|png|jpg|jpeg|webp|avif|bmp|svg)$/;
export const allowedPath = (path: string) => imagePath.test(path) || ['index.html', 'gallery.json', '.nojekyll', 'START-HERE.txt', 'fonts/dm-sans.woff2', 'fonts/lora.woff2', 'fonts/lora-italic.woff2', 'fonts/OFL-dm-sans.txt', 'fonts/OFL-lora.txt'].includes(path);
export const manifestSchema = z.object({ format: z.literal('gif-and-giggles'), version: z.literal(1), settings: settingsSchema, items: z.array(z.object({ id: z.string().min(1).max(100), name: z.string().max(255), caption: z.string().max(100), path: z.string().regex(imagePath), extension: z.enum(['gif', 'png', 'jpg', 'jpeg', 'webp', 'avif', 'bmp', 'svg']) })).min(1).max(60) });
export const publishSchema = z.object({ key: z.string().uuid(), name: z.string().regex(/^[a-z0-9](?:[a-z0-9-]{0,58}[a-z0-9])?$/), repoId: z.number().int().positive().optional(), publicConfirmed: z.literal(true), manifest: manifestSchema, files: z.array(z.object({ path: z.string().refine(allowedPath), size: z.number().int().min(0).max(20 * 1024 * 1024), digest: z.string().regex(/^[a-f0-9]{64}$/) })).min(8).max(70) }).superRefine((data, ctx) => {
  const paths = data.files.map(file => file.path);
  const required = ['index.html', 'gallery.json', '.nojekyll', 'fonts/dm-sans.woff2', 'fonts/lora.woff2', 'fonts/lora-italic.woff2', ...data.manifest.items.map(item => item.path)];
  if (new Set(paths).size !== paths.length || required.some(path => !paths.includes(path))) ctx.addIssue({ code: 'custom', message: 'Missing or duplicated gallery files.' });
  if (new Set(data.manifest.items.map(item => item.path)).size !== data.manifest.items.length || new Set(data.manifest.items.map(item => item.id)).size !== data.manifest.items.length) ctx.addIssue({ code: 'custom', message: 'Duplicated image entries.' });
  if (data.files.some(file => imagePath.test(file.path) && !data.manifest.items.some(item => item.path === file.path && file.path.endsWith(`.${item.extension}`)))) ctx.addIssue({ code: 'custom', message: 'Unexpected image file.' });
  if (data.files.filter(file => imagePath.test(file.path)).reduce((sum, file) => sum + file.size, 0) > 150 * 1024 * 1024 || data.files.reduce((sum, file) => sum + file.size, 0) > 154 * 1024 * 1024) ctx.addIssue({ code: 'custom', message: 'Gallery exceeds the total size limit.' });
});
export type PublishInput = z.infer<typeof publishSchema>;
