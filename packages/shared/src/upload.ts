import { z } from "zod";
import { UPLOAD_ARCHIVE_EXT, UPLOAD_IMAGE_EXT } from "./config";

export const uploadKindSchema = z.enum(["image", "attachment"]);
export type UploadKind = z.infer<typeof uploadKindSchema>;

export const uploadSignSchema = z.object({
  kind: uploadKindSchema,
  filename: z.string().trim().min(1).max(240),
  contentType: z.string().trim().min(1).max(120),
  size: z.number().int().positive(),
});

export type UploadSignInput = z.infer<typeof uploadSignSchema>;

export const uploadCompleteSchema = z.object({
  key: z.string().trim().min(1).max(500),
  kind: uploadKindSchema,
  size: z.number().int().positive(),
  contentType: z.string().trim().min(1).max(120),
});

export type UploadCompleteInput = z.infer<typeof uploadCompleteSchema>;

export const uploadResultSchema = z.object({
  key: z.string(),
  url: z.string(),
  size: z.number().int().nonnegative(),
  contentType: z.string(),
});

export type UploadResult = z.infer<typeof uploadResultSchema>;
