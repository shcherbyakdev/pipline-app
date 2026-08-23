-- 0049 (Booking page builder): page images (cover, photo, gallery) may be up
-- to 5 MB (features/booking-page/images.ts PAGE_IMAGE_MAX_BYTES). The bucket
-- was created at 1 MB in 0018 for logos, which keep their own 1 MB check in
-- lib/storage/logo.ts. Idempotent.
update storage.buckets set file_size_limit = 5242880 where id = 'branding';
