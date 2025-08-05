// routes/location.js
const express = require('express');
const router = express.Router();
const { loadModels, getFaceDescriptorFromUrl, euclideanDistance } = require('../utils/faceUtils');
const pool = require('../db');

// Load face-api models at server start
loadModels();


router.post('/verify-face', async (req, res) => {
  try {
    const { employeeId, capturedUrl } = req.body;

    if (!employeeId || !capturedUrl) {
      return res.status(400).json({
        success: false,
        message: 'Both employeeId and capturedUrl are required',
      });
    }

    // Fetch registered image URL from DB
    const result = await pool.query(
      'SELECT image FROM employees WHERE id = $1',
      [employeeId]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({
        success: false,
        message: 'Employee not found',
      });
    }

    const registeredUrl = result.rows[0].image;

    // Get face descriptors
    const registeredDescriptor = await getFaceDescriptorFromUrl(registeredUrl);
    const capturedDescriptor = await getFaceDescriptorFromUrl(capturedUrl);

    if (!registeredDescriptor || !capturedDescriptor) {
      return res.status(400).json({
        success: false,
        message: 'Could not detect face in one or both images',
      });
    }

    // Compare descriptors
    const distance = euclideanDistance(registeredDescriptor, capturedDescriptor);
    const isMatch = distance < 0.6;

    res.json({
      success: true,
      match: isMatch,
      distance,
    });
  } catch (error) {
    console.error('Face verification error:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Office coordinates (example)
const OFFICE_LAT =  17.677607;
const OFFICE_LNG =  83.198662;
const RADIUS_IN_METERS = 1000; // Acceptable distance

function getDistanceFromLatLonInMeters(lat1, lon1, lat2, lon2) {
  const R = 6371000; // Earth radius in meters
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

router.post('/verify-location', (req, res) => {
  const { latitude, longitude } = req.body;

  if (!latitude || !longitude) {
    return res.status(400).json({ success: false, message: 'Missing coordinates' });
  }

  const distance = getDistanceFromLatLonInMeters(latitude, longitude, OFFICE_LAT, OFFICE_LNG);

  if (distance <= RADIUS_IN_METERS) {
    return res.json({ locationVerified: true });
  } else {
    return res.json({ locationVerified: false, distance });
  }
});

module.exports = router;
