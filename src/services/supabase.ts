import { createClient } from "@supabase/supabase-js";
import { config } from "../config/env.js";

export const supabase = createClient(
  config.supabaseUrl,
  config.supabaseServiceRoleKey || config.supabaseAnonKey
);

// ── Storage helpers ──

export async function uploadFile(
  bucket: string,
  path: string,
  file: Buffer | Blob,
  contentType: string
): Promise<string> {
  const { error } = await supabase.storage
    .from(bucket)
    .upload(path, file, { contentType, upsert: true });
  if (error) throw new Error(`Upload failed: ${error.message}`);

  const {
    data: { publicUrl },
  } = supabase.storage.from(bucket).getPublicUrl(path);
  return publicUrl;
}

export async function downloadFile(
  bucket: string,
  path: string
): Promise<Buffer> {
  const { data, error } = await supabase.storage.from(bucket).download(path);
  if (error) throw new Error(`Download failed: ${error.message}`);
  return Buffer.from(await data.arrayBuffer());
}

// ── Generic CRUD helpers ──

export async function insertRow(
  table: string,
  data: Record<string, unknown>
): Promise<Record<string, unknown> & { id: string }> {
  const { data: row, error } = await supabase
    .from(table)
    .insert(data as never)
    .select()
    .single();
  if (error) throw new Error(`Insert into ${table} failed: ${error.message}`);
  return row as Record<string, unknown> & { id: string };
}

export async function updateRow(
  table: string,
  id: string,
  data: Record<string, unknown>
): Promise<void> {
  const { error } = await supabase.from(table).update(data).eq("id", id);
  if (error) throw new Error(`Update ${table} failed: ${error.message}`);
}

export async function fetchRows<T>(
  table: string,
  filters?: Record<string, unknown>,
  options?: { limit?: number; orderBy?: string; ascending?: boolean }
): Promise<T[]> {
  let query = supabase.from(table).select("*");
  if (filters) {
    for (const [key, value] of Object.entries(filters)) {
      query = query.eq(key, value);
    }
  }
  if (options?.orderBy) {
    query = query.order(options.orderBy, {
      ascending: options.ascending ?? false,
    });
  }
  if (options?.limit) {
    query = query.limit(options.limit);
  }
  const { data, error } = await query;
  if (error) throw new Error(`Fetch from ${table} failed: ${error.message}`);
  return data as T[];
}
