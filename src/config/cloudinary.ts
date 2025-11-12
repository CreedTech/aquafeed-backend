import { v2 as cloudinary } from 'cloudinary';
import { Readable } from 'stream';

// Configure Cloudinary with environment variables
cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET
});

/**
 * Upload an image buffer to Cloudinary using streams
 * @param fileBuffer - The buffer of the file to upload
 * @param folder - Optional folder name in Cloudinary (default: 'aquafeed_receipts')
 */
export const uploadImage = (fileBuffer: Buffer, folder: string = 'aquafeed_receipts'): Promise<string> => {
    return new Promise((resolve, reject) => {
        const uploadStream = cloudinary.uploader.upload_stream(
            {
                folder,
                resource_type: 'image',
                allowed_formats: ['jpg', 'png', 'jpeg', 'webp'],
                transformation: [{ width: 1000, crop: 'limit' }] // Optimize size
            },
            (error, result) => {
                if (error) return reject(error);
                if (!result) return reject(new Error('Cloudinary upload failed'));
                resolve(result.secure_url);
            }
        );

        // createReadStream from buffer and pipe to Cloudinary
        const stream = Readable.from(fileBuffer);
        stream.pipe(uploadStream);
    });
};

export default cloudinary;
