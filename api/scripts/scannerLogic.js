const cv = require('opencv-wasm');
const { createCanvas, loadImage } = require('canvas');
const levenshtein = require('fast-levenshtein');

/**
 * Advanced Scanner Logic for OMR and Handwriting Detection
 */
class ScannerLogic {
  
  /**
   * Compares two strings with a tolerance for minor spelling errors
   * @param {string} studentAns 
   * @param {string} correctAns 
   * @param {number} threshold - Maximum allowed distance (default 2)
   */
  static isMatch(studentAns, correctAns, threshold = 2) {
    if (!studentAns || !correctAns) return false;
    
    const s = studentAns.toLowerCase().trim();
    const c = correctAns.toLowerCase().trim();
    
    // Exact match
    if (s === c) return true;

    // Fuzzy matching for common OCR errors in A, B, C, D
    if (c === 'a' && (s === '4' || s === '^' || s === '@')) return true;
    if (c === 'b' && (s === '8' || s === '3' || s === '6' || s === '13')) return true;
    if (c === 'c' && (s === '(' || s === '[' || s === '{' || s === '0' || s === '<')) return true;
    if (c === 'd' && (s === '0' || s === '|)' || s === 'p' || s === 'cl')) return true;

    // Dynamic threshold based on word length
    const dynamicThreshold = this.calculateDynamicThreshold(c, threshold);
    
    // Levenshtein distance for fuzzy matching
    const distance = levenshtein.get(s, c);
    if (distance <= dynamicThreshold) return true;

    // Jaro-Winkler similarity for better string matching
    const similarity = this.jaroWinklerSimilarity(s, c);
    if (similarity >= 0.85) return true;

    // Check if one string is contained within the other (for partial matches)
    if (s.includes(c) || c.includes(s)) return true;

    // Check if they share most characters (for OCR errors)
    if (this.shareMostCharacters(s, c, 0.7)) return true;

    return false;
  }

  /**
   * Calculates dynamic threshold based on word length
   * Longer words allow more errors
   */
  static calculateDynamicThreshold(word, baseThreshold) {
    const len = word.length;
    if (len <= 2) return 0; // Strict for single letters
    if (len <= 4) return 1; // Allow 1 error for short words
    if (len <= 7) return 2; // Allow 2 errors for medium words
    return Math.min(3, Math.floor(len / 3)); // Allow more errors for longer words
  }

  /**
   * Calculates Jaro-Winkler similarity between two strings
   * Returns a value between 0 and 1
   */
  static jaroWinklerSimilarity(s1, s2) {
    if (s1 === s2) return 1.0;
    
    const len1 = s1.length;
    const len2 = s2.length;
    
    if (len1 === 0 || len2 === 0) return 0.0;
    
    const matchDistance = Math.floor(Math.max(len1, len2) / 2) - 1;
    if (matchDistance < 0) return 0.0;
    
    const s1Matches = new Array(len1).fill(false);
    const s2Matches = new Array(len2).fill(false);
    
    let matches = 0;
    let transpositions = 0;
    
    for (let i = 0; i < len1; i++) {
      const start = Math.max(0, i - matchDistance);
      const end = Math.min(i + matchDistance + 1, len2);
      
      for (let j = start; j < end; j++) {
        if (s2Matches[j] || s1[i] !== s2[j]) continue;
        s1Matches[i] = true;
        s2Matches[j] = true;
        matches++;
        break;
      }
    }
    
    if (matches === 0) return 0.0;
    
    let k = 0;
    for (let i = 0; i < len1; i++) {
      if (!s1Matches[i]) continue;
      while (!s2Matches[k]) k++;
      if (s1[i] !== s2[k]) transpositions++;
      k++;
    }
    
    const jaro = (matches / len1 + matches / len2 + (matches - transpositions / 2) / matches) / 3;
    
    // Jaro-Winkler adjustment for common prefix
    let prefix = 0;
    for (let i = 0; i < Math.min(len1, len2, 4); i++) {
      if (s1[i] === s2[i]) prefix++;
      else break;
    }
    
    return jaro + (prefix * 0.1 * (1 - jaro));
  }

  /**
   * Checks if two strings share most of their characters
   * Useful for OCR errors where characters are misread
   */
  static shareMostCharacters(s1, s2, threshold = 0.7) {
    const set1 = new Set(s1);
    const set2 = new Set(s2);
    
    let intersection = 0;
    for (const char of set1) {
      if (set2.has(char)) intersection++;
    }
    
    const union = new Set([...set1, ...set2]).size;
    const similarity = intersection / union;
    
    return similarity >= threshold;
  }

  /**
   * Detects if an answer is encircled using Hough Circle Transform
   * @param {Buffer|string} imageSource - Image path or buffer of the MCQ zone
   */
  static async detectEncircledLetter(imageSource) {
    try {
      // Ensure OpenCV is ready
      // Note: opencv-wasm often needs initialization
      if (!cv.Mat) await new Promise(resolve => cv.onRuntimeInitialized = resolve);

      const img = await loadImage(imageSource);
      const canvas = createCanvas(img.width, img.height);
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0);
      
      const imageData = ctx.getImageData(0, 0, img.width, img.height);
      const src = cv.matFromImageData(imageData);
      const gray = new cv.Mat();
      const circles = new cv.Mat();
      
      cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);
      cv.GaussianBlur(gray, gray, new cv.Size(9, 9), 2, 2);
      
      // Hough Circle Transform
      cv.HoughCircles(gray, circles, cv.HOUGH_GRADIENT, 1, 45, 75, 40, 0, 0);
      
      let detected = null;
      if (circles.cols > 0) {
        // We found at least one circle
        // For simplicity, we assume the circle contains the letter
        // In a real scenario, we'd check the center of the circle against A, B, C, D positions
        detected = true; 
      }

      // Cleanup
      src.delete(); gray.delete(); circles.delete();
      
      return detected;
    } catch (error) {
      console.error('Circle Detection Error:', error);
      return null;
    }
  }

  /**
   * Crops a specific region from an image
   */
  static async cropRegion(imagePath, rect) {
    const { x, y, width, height } = rect;
    const img = await loadImage(imagePath);
    const canvas = createCanvas(width, height);
    const ctx = canvas.getContext('2d');
    
    ctx.drawImage(img, x, y, width, height, 0, 0, width, height);
    return canvas.toBuffer('image/png');
  }

  /**
   * Identifies question numbers and their bounding boxes from Tesseract full-page data
   * @param {object} tesseractData - The full 'data' object from Tesseract.recognize
   */
  static findQuestionCoordinates(tesseractData) {
    const questions = [];
    const words = tesseractData?.words || [];
    
    words.forEach(word => {
      // Look for patterns like "1.", "1", "Q1", "2)", etc.
      const match = word.text.match(/^(?:Q|q)?(\d+)[\.\)]?$/);
      if (match) {
        questions.push({
          number: match[1],
          text: word.text,
          bbox: word.bbox // { x0, y0, x1, y1 }
        });
      }
    });
    
    return questions;
  }
}

module.exports = ScannerLogic;
