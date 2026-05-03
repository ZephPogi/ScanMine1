const cv = require('opencv-wasm');
const { createCanvas, loadImage } = require('canvas');
const fs = require('fs');
const path = require('path');

/**
 * Image Pre-processing Service using OpenCV.js
 * Applies grayscale and binarization to improve OCR detection rates
 */
class ImagePreprocessor {
  /**
   * Ensures OpenCV is initialized
   */
  static async ensureOpenCVReady() {
    if (!cv.Mat) {
      await new Promise(resolve => {
        cv.onRuntimeInitialized = resolve;
      });
    }
  }

  /**
   * Converts image to grayscale
   * @param {string} imagePath - Path to the image file
   * @returns {Promise<Buffer>} - Grayscale image buffer
   */
  static async toGrayscale(imagePath) {
    await this.ensureOpenCVReady();

    try {
      const img = await loadImage(imagePath);
      const canvas = createCanvas(img.width, img.height);
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0);

      const imageData = ctx.getImageData(0, 0, img.width, img.height);
      const src = cv.matFromImageData(imageData);
      const gray = new cv.Mat();

      // Convert to grayscale
      cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);

      // Convert back to buffer
      const grayImageData = new cv.Mat();
      cv.cvtColor(gray, grayImageData, cv.COLOR_GRAY2RGBA);

      const buffer = Buffer.from(grayImageData.data);
      const resultCanvas = createCanvas(img.width, img.height);
      const resultCtx = resultCanvas.getContext('2d');
      const resultImageData = resultCtx.createImageData(img.width, img.height);
      resultImageData.data.set(buffer);
      resultCtx.putImageData(resultImageData, 0, 0);

      // Cleanup
      src.delete();
      gray.delete();
      grayImageData.delete();

      return resultCanvas.toBuffer('image/png');
    } catch (error) {
      console.error('Grayscale conversion error:', error);
      throw error;
    }
  }

  /**
   * Applies binarization (thresholding) to image
   * Converts to black and white for better OCR accuracy
   * @param {string} imagePath - Path to the image file
   * @param {number} threshold - Threshold value (0-255), default 140
   * @returns {Promise<Buffer>} - Binarized image buffer
   */
  static async binarize(imagePath, threshold = 140) {
    await this.ensureOpenCVReady();

    try {
      const img = await loadImage(imagePath);
      const canvas = createCanvas(img.width, img.height);
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0);

      const imageData = ctx.getImageData(0, 0, img.width, img.height);
      const d = imageData.data;

      // Apply grayscale then threshold
      for (let i = 0; i < d.length; i += 4) {
        const lum = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
        // Keep dark ink (< threshold) as black, everything else white
        const val = lum < threshold ? 0 : 255;
        d[i] = d[i + 1] = d[i + 2] = val;
      }

      ctx.putImageData(imageData, 0, 0);
      return canvas.toBuffer('image/png');
    } catch (error) {
      console.error('Binarization error:', error);
      throw error;
    }
  }

  /**
   * Applies adaptive thresholding (better for varying lighting conditions)
   * @param {string} imagePath - Path to the image file
   * @returns {Promise<Buffer>} - Adaptively thresholded image buffer
   */
  static async adaptiveThreshold(imagePath) {
    await this.ensureOpenCVReady();

    try {
      const img = await loadImage(imagePath);
      const canvas = createCanvas(img.width, img.height);
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0);

      const imageData = ctx.getImageData(0, 0, img.width, img.height);
      const src = cv.matFromImageData(imageData);
      const gray = new cv.Mat();
      const binary = new cv.Mat();

      // Convert to grayscale
      cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);

      // Apply adaptive thresholding
      // blockSize: size of neighborhood (odd number, typically 11-31)
      // C: constant subtracted from mean (typically 2-10)
      cv.adaptiveThreshold(
        gray,
        binary,
        255,
        cv.ADAPTIVE_THRESH_GAUSSIAN_C,
        cv.THRESH_BINARY,
        15,
        5
      );

      // Convert back to RGBA
      const rgba = new cv.Mat();
      cv.cvtColor(binary, rgba, cv.COLOR_GRAY2RGBA);

      const buffer = Buffer.from(rgba.data);
      const resultCanvas = createCanvas(img.width, img.height);
      const resultCtx = resultCanvas.getContext('2d');
      const resultImageData = resultCtx.createImageData(img.width, img.height);
      resultImageData.data.set(buffer);
      resultCtx.putImageData(resultImageData, 0, 0);

      // Cleanup
      src.delete();
      gray.delete();
      binary.delete();
      rgba.delete();

      return resultCanvas.toBuffer('image/png');
    } catch (error) {
      console.error('Adaptive thresholding error:', error);
      throw error;
    }
  }

  /**
   * Upscales image for better OCR accuracy
   * @param {string} imagePath - Path to the image file
   * @param {number} scaleFactor - Scale factor (default 2)
   * @returns {Promise<Buffer>} - Upscaled image buffer
   */
  static async upscale(imagePath, scaleFactor = 2) {
    try {
      const img = await loadImage(imagePath);
      const newWidth = img.width * scaleFactor;
      const newHeight = img.height * scaleFactor;
      const canvas = createCanvas(newWidth, newHeight);
      const ctx = canvas.getContext('2d');
      
      // Use high-quality scaling
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(img, 0, 0, newWidth, newHeight);

      return canvas.toBuffer('image/png');
    } catch (error) {
      console.error('Upscaling error:', error);
      throw error;
    }
  }

  /**
   * Resizes image to fit within max dimensions while maintaining aspect ratio
   * @param {string} imagePath - Path to the image file
   * @param {number} maxWidth - Maximum width (default 2000)
   * @param {number} maxHeight - Maximum height (default 2000)
   * @returns {Promise<Buffer>} - Resized image buffer
   */
  static async resize(imagePath, maxWidth = 2000, maxHeight = 2000) {
    try {
      const img = await loadImage(imagePath);
      
      // Calculate new dimensions maintaining aspect ratio
      let newWidth = img.width;
      let newHeight = img.height;
      
      if (img.width > maxWidth || img.height > maxHeight) {
        const widthRatio = maxWidth / img.width;
        const heightRatio = maxHeight / img.height;
        const ratio = Math.min(widthRatio, heightRatio);
        
        newWidth = Math.round(img.width * ratio);
        newHeight = Math.round(img.height * ratio);
      }

      const canvas = createCanvas(newWidth, newHeight);
      const ctx = canvas.getContext('2d');
      
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(img, 0, 0, newWidth, newHeight);

      console.log(`Image resized from ${img.width}x${img.height} to ${newWidth}x${newHeight}`);
      return canvas.toBuffer('image/png');
    } catch (error) {
      console.error('Resize error:', error);
      throw error;
    }
  }

  /**
   * Compresses image by reducing JPEG quality
   * @param {string} imagePath - Path to the image file
   * @param {number} quality - JPEG quality (0.0 to 1.0, default 0.8)
   * @returns {Promise<Buffer>} - Compressed image buffer
   */
  static async compress(imagePath, quality = 0.8) {
    try {
      const img = await loadImage(imagePath);
      const canvas = createCanvas(img.width, img.height);
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0);

      return canvas.toBuffer('image/jpeg', { quality });
    } catch (error) {
      console.error('Compression error:', error);
      throw error;
    }
  }

  /**
   * Complete preprocessing pipeline: grayscale + binarize + upscale
   * @param {string} imagePath - Path to the image file
   * @param {object} options - Preprocessing options
   * @returns {Promise<Buffer>} - Preprocessed image buffer
   */
  static async preprocess(imagePath, options = {}) {
    const {
      grayscale = true,
      binarize = true,
      adaptiveThreshold = false,
      upscale = true,
      scaleFactor = 2,
      threshold = 140
    } = options;

    try {
      let processedBuffer = fs.readFileSync(imagePath);
      let tempPath = imagePath;

      // Step 1: Upscale (if enabled)
      if (upscale) {
        const img = await loadImage(processedBuffer);
        const newWidth = img.width * scaleFactor;
        const newHeight = img.height * scaleFactor;
        const canvas = createCanvas(newWidth, newHeight);
        const ctx = canvas.getContext('2d');
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(img, 0, 0, newWidth, newHeight);
        processedBuffer = canvas.toBuffer('image/png');
      }

      // Step 2: Grayscale + Binarize (using canvas for simplicity)
      if (grayscale || binarize) {
        const img = await loadImage(processedBuffer);
        const canvas = createCanvas(img.width, img.height);
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0);

        const imageData = ctx.getImageData(0, 0, img.width, img.height);
        const d = imageData.data;

        for (let i = 0; i < d.length; i += 4) {
          const lum = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
          
          if (binarize) {
            // Binarize
            const val = lum < threshold ? 0 : 255;
            d[i] = d[i + 1] = d[i + 2] = val;
          } else if (grayscale) {
            // Just grayscale
            d[i] = d[i + 1] = d[i + 2] = lum;
          }
        }

        ctx.putImageData(imageData, 0, 0);
        processedBuffer = canvas.toBuffer('image/png');
      }

      // Step 3: Adaptive threshold (if enabled and using OpenCV)
      if (adaptiveThreshold) {
        const img = await loadImage(processedBuffer);
        const canvas = createCanvas(img.width, img.height);
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0);

        const imageData = ctx.getImageData(0, 0, img.width, img.height);
        const src = cv.matFromImageData(imageData);
        const gray = new cv.Mat();
        const binary = new cv.Mat();

        cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);
        cv.adaptiveThreshold(gray, binary, 255, cv.ADAPTIVE_THRESH_GAUSSIAN_C, cv.THRESH_BINARY, 15, 5);

        const rgba = new cv.Mat();
        cv.cvtColor(binary, rgba, cv.COLOR_GRAY2RGBA);

        const buffer = Buffer.from(rgba.data);
        const resultImageData = ctx.createImageData(img.width, img.height);
        resultImageData.data.set(buffer);
        ctx.putImageData(resultImageData, 0, 0);

        processedBuffer = canvas.toBuffer('image/png');

        src.delete();
        gray.delete();
        binary.delete();
        rgba.delete();
      }

      console.log('Image preprocessed successfully');
      return processedBuffer;

    } catch (error) {
      console.error('Preprocessing error:', error);
      throw error;
    }
  }

  /**
   * Saves preprocessed buffer to a temporary file
   * @param {Buffer} buffer - Image buffer
   * @param {string} outputPath - Output path
   */
  static async savePreprocessed(buffer, outputPath) {
    fs.writeFileSync(outputPath, buffer);
    console.log(`Preprocessed image saved to: ${outputPath}`);
  }
}

module.exports = ImagePreprocessor;
