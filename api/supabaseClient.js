const { createClient } = require('@supabase/supabase-js');

// Only load dotenv in local development
if (process.env.NODE_ENV !== 'production') {
  require('dotenv').config();
}

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.warn('Warning: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY environment variables are required for file storage');
}

const supabase = createClient(supabaseUrl, supabaseKey);

const BUCKET_NAME = 'scanned-quizzes';

/**
 * Upload a file to Supabase storage
 * @param {Buffer} fileBuffer - File buffer
 * @param {string} fileName - Name for the file in storage
 * @param {string} mimeType - MIME type of the file
 * @returns {Promise<{publicUrl: string, path: string}>}
 */
async function uploadFile(fileBuffer, fileName, mimeType) {
  // Sanitize filename: remove leading slashes and special characters
  const sanitizedFileName = fileName.replace(/^\/+/, '').replace(/[^a-zA-Z0-9._-]/g, '_');
  const filePath = `${Date.now()}-${sanitizedFileName}`;

  console.log('Uploading to Supabase:', { bucket: BUCKET_NAME, filePath, mimeType });

  const { data, error } = await supabase.storage
    .from(BUCKET_NAME)
    .upload(filePath, fileBuffer, {
      contentType: mimeType,
      upsert: true
    });

  if (error) {
    console.error('Supabase upload error:', error);
    throw new Error(`Failed to upload file: ${error.message}`);
  }

  // Get public URL
  const { data: { publicUrl } } = supabase.storage
    .from(BUCKET_NAME)
    .getPublicUrl(filePath);

  return {
    publicUrl,
    path: filePath
  };
}

/**
 * Delete a file from Supabase storage
 * @param {string} filePath - Path of the file in storage
 * @returns {Promise<void>}
 */
async function deleteFile(filePath) {
  const { error } = await supabase.storage
    .from(BUCKET_NAME)
    .remove([filePath]);

  if (error) {
    console.error('Supabase delete error:', error);
    throw new Error(`Failed to delete file: ${error.message}`);
  }
}

module.exports = {
  supabase,
  uploadFile,
  deleteFile,
  BUCKET_NAME
};
