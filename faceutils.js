// utils/faceUtils.js
const faceapi = require('@vladmandic/face-api');
const canvas = require('canvas');
const path = require('path');
const fetch = require('node-fetch');

// Setup canvas for face-api
const { Canvas, Image, ImageData } = canvas;
faceapi.env.monkeyPatch({ Canvas, Image, ImageData });

// Models folder path
const MODEL_PATH = path.join(__dirname, '../face-api-models');

// Load models from disk
const loadModels = async () => {
  await faceapi.nets.ssdMobilenetv1.loadFromDisk(MODEL_PATH);
  await faceapi.nets.faceRecognitionNet.loadFromDisk(MODEL_PATH);
  await faceapi.nets.faceLandmark68Net.loadFromDisk(MODEL_PATH);
};

// Load image from URL and get face descriptor
const getFaceDescriptorFromUrl = async (url) => {
  const response = await fetch(url);
  const buffer = await response.buffer();
  const img = await canvas.loadImage(buffer);

  const detection = await faceapi
    .detectSingleFace(img)
    .withFaceLandmarks()
    .withFaceDescriptor();

  return detection?.descriptor || null;
};

// Calculate Euclidean distance manually (alternative to faceapi.euclideanDistance)
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
