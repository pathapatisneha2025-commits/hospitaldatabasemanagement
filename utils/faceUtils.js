const faceapi = require('face-api.js');
const canvas = require('canvas');
const fetch = require('node-fetch');

// Setup canvas for face-api
const { Canvas, Image, ImageData } = canvas;
faceapi.env.monkeyPatch({ Canvas, Image, ImageData });

// Cloudinary model hosting base URL
const MODEL_URL = 'https://res.cloudinary.com/dtsdj9mll/raw/upload/employee';

// Load models from Cloudinary
const loadModels = async () => {
  await faceapi.nets.ssdMobilenetv1.loadFromUri(`${MODEL_URL}/ssd_mobilenetv1_model`);
  await faceapi.nets.faceLandmark68Net.loadFromUri(`${MODEL_URL}/face_landmark_68_model`);
  await faceapi.nets.faceRecognitionNet.loadFromUri(`${MODEL_URL}/face_recognition_model`);
  console.log("Models loaded from Cloudinary");
};

// Load image from Cloudinary URL and get face descriptor
const getFaceDescriptorFromUrl = async (url) => {
  try {
    const response = await fetch(url);
    const buffer = await response.buffer();
    const img = await canvas.loadImage(buffer);

    const detection = await faceapi
      .detectSingleFace(img)
      .withFaceLandmarks()
      .withFaceDescriptor();

    return detection?.descriptor || null;
  } catch (error) {
    console.error('Error getting face descriptor:', error.message);
    return null;
  }
};

// Calculate Euclidean distance manually
const euclideanDistance = (desc1, desc2) => {
  let sum = 0;
  for (let i = 0; i < desc1.length; i++) {
    sum += (desc1[i] - desc2[i]) ** 2;
  }
  return Math.sqrt(sum);
};

module.exports = {
  loadModels,
  getFaceDescriptorFromUrl,
  euclideanDistance,
};
