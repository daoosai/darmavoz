import imageCompression from "browser-image-compression";

const IMAGE_COMPRESSION_OPTIONS = {
  maxSizeMB: 1,
  maxWidthOrHeight: 1920,
  useWebWorker: true,
};

export async function compressImageFile(file: File): Promise<File> {
  return imageCompression(file, IMAGE_COMPRESSION_OPTIONS);
}

export async function compressImageFiles(files: Iterable<File>): Promise<File[]> {
  return Promise.all(Array.from(files, compressImageFile));
}
