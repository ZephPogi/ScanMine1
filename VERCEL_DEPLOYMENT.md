# Vercel Deployment Guide for ScanMine

## Environment Variables

Configure these environment variables in your Vercel project settings (Settings > Environment Variables):

### Required (Supabase)

- `DATABASE_URL` - Supabase PostgreSQL connection string (from Supabase Dashboard > Settings > Database)
- `SUPABASE_URL` - Supabase project URL (from Supabase Dashboard > Settings > API)
- `SUPABASE_SERVICE_ROLE_KEY` - Supabase service role key (from Supabase Dashboard > Settings > API)
- `OCR_SPACE_API_KEY` - API key for OCR.space service (get from https://ocr.space/)

### Required (Alternative PostgreSQL)

If not using Supabase, use these instead:
- `DB_HOST` - PostgreSQL database host
- `DB_PORT` - PostgreSQL database port (default: 5432)
- `DB_NAME` - Database name
- `DB_USER` - Database user
- `DB_PASSWORD` - Database password

### Optional

- `NODE_ENV` - Set to `production` (automatically set by Vercel)
- `PORT` - Server port (Vercel handles this automatically)

## Database Setup

ScanMine uses PostgreSQL with Supabase integration for both database and file storage.

### Supabase Setup

1. Create a Supabase project at https://supabase.com
2. Run the schema from `server/schema.sql` in the Supabase SQL Editor
3. Run the migration from `server/migration_add_image_urls.sql` to add image URL columns
4. Create a storage bucket named `scanned-quizzes` in Supabase Storage
5. Make the bucket public (or configure appropriate RLS policies)

### Database Schema

The schema is defined in `server/schema.sql`. Run this SQL on your PostgreSQL database to create the required tables.

## File Storage

ScanMine now uses Supabase Storage for file uploads:
- **Bucket Name**: `scanned-quizzes`
- **Files Stored**: Student paper scans, answer key images, lesson files
- **URLs Saved**: Public URLs are stored in database columns (`image_url`, `file_path`)

### Supabase Storage Setup

1. Go to Supabase Dashboard > Storage
2. Create a new bucket named `scanned-quizzes`
3. Enable public access or configure Row Level Security (RLS) policies
4. Files are uploaded with timestamp prefixes to avoid conflicts

## OCR.space Timeout

The OCR.space API calls have a 45-second timeout configured to stay within Vercel's 60-second serverless function limit. This is configured in `server/scripts/ocrSpaceService.js`.

## Deployment Steps

1. Push your code to GitHub
2. Import the project in Vercel
3. Configure environment variables in Vercel dashboard
4. Deploy

## Post-Deployment Checklist

- [ ] Set up Supabase project and run schema.sql
- [ ] Run migration_add_image_urls.sql
- [ ] Create `scanned-quizzes` storage bucket in Supabase
- [ ] Configure all environment variables in Vercel
- [ ] Test OCR functionality with a sample image
- [ ] Test file upload to Supabase Storage
- [ ] Verify images are accessible via public URLs
- [ ] Set up custom domain (optional)

## Troubleshooting

### OCR Timeout Errors
If OCR operations timeout frequently:
- Increase `maxDuration` in vercel.json (Pro plan allows up to 300s)
- Consider moving OCR to a separate microservice
- Use a faster OCR provider or implement queue-based processing

### Database Connection Issues
- Verify `DATABASE_URL` is set correctly for Supabase
- Ensure your Supabase project allows connections from Vercel
- Check SSL/TLS requirements (Supabase requires SSL)

### File Upload Issues
- Verify `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are set
- Ensure `scanned-quizzes` bucket exists in Supabase Storage
- Check bucket permissions (public or proper RLS policies)
- Verify file size limit (currently set to 5MB)

### Image URL Issues
- Check that bucket is public or RLS policies allow public access
- Verify the bucket name matches `scanned-quizzes` in server/supabaseClient.js
- Test public URL access directly in browser
