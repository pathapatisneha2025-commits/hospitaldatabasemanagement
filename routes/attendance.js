// routes/location.js
const express = require('express');
const router = express.Router();
const { loadModels, getFaceDescriptorFromUrl, euclideanDistance } = require('../utils/faceUtils');
const pool = require('../db');
const multer = require('multer');

const { CloudinaryStorage } = require('multer-storage-cloudinary');
const cloudinary = require('../cloudinary');

// Load face-api models at server start
(async () => {
  await loadModels();
  console.log('Models loaded');
})();

const storage = new CloudinaryStorage({
  cloudinary,
  params: {
    folder: 'employee_faces',
    allowed_formats: ['jpg', 'jpeg', 'png'],
  },
});

const upload = multer({ storage });

// 👉 Use multer middleware for file upload
router.post('/verify-face', upload.single('image'), async (req, res) => {
  try {
    const { employeeId } = req.body;

    if (!employeeId || !req.file || !req.file.path) {
      return res.status(400).json({
        success: false,
        message: 'employeeId and image file are required',
      });
    }

    const capturedUrl = req.file.path;

    // Fetch registered image URL from DB
    const result = await pool.query('SELECT image FROM employees WHERE id = $1', [employeeId]);

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
        capturedUrl,
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
  const { employeeId,latitude, longitude } = req.body;

  if (!employeeId||!latitude || !longitude) {
    return res.status(400).json({ success: false, message: 'Missing coordinates' });
  }

  const distance = getDistanceFromLatLonInMeters(latitude, longitude, OFFICE_LAT, OFFICE_LNG);

  if (distance <= RADIUS_IN_METERS) {
    return res.json({ locationVerified: true });
  } else {
    return res.json({ locationVerified: false, distance });
  }
});
router.post('/mark-attendance', async (req, res) => {
  try {
    const { employeeId, capturedUrl, locationVerified, faceVerified } = req.body;

    if (!employeeId || !capturedUrl) {
      return res.status(400).json({ success: false, message: 'Missing required fields' });
    }

    // Step 1: Decide status based on verification
    let status = 'Off Duty';
    if (locationVerified === true && faceVerified === true) {
      status = 'On Duty';
    }

    // Step 2: Get employee salary (fixed working_days = 26)
    const employeeResult = await pool.query(
      'SELECT monthly_salary FROM employees WHERE id = $1',
      [employeeId]
    );
    if (employeeResult.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Employee not found' });
    }

    const { monthly_salary } = employeeResult.rows[0];
    const working_days = 26; // Fixed value
    const per_day_salary = monthly_salary / working_days;

    let deduction_amount = 0;
    let remaining_salary = monthly_salary;

    // Step 3: Get last remaining salary for the current month
    const lastAttendance = await pool.query(
      `SELECT remaining_salary
       FROM attendance
       WHERE employee_id = $1
         AND DATE_TRUNC('month', timestamp) = DATE_TRUNC('month', CURRENT_DATE)
       ORDER BY timestamp DESC
       LIMIT 1`,
      [employeeId]
    );

    if (lastAttendance.rows.length > 0) {
      remaining_salary = parseFloat(lastAttendance.rows[0].remaining_salary);
    }

    // Step 4: Deduct if Off Duty
    if (status.toLowerCase() === 'off duty') {
      deduction_amount = per_day_salary;
      remaining_salary -= deduction_amount;
    }

    // Step 5: Insert attendance record
    await pool.query(
      `INSERT INTO attendance
        (employee_id, timestamp, image_url, status, deduction_amount, remaining_salary)
       VALUES ($1, NOW(), $2, $3, $4, $5)`,
      [employeeId, capturedUrl, status, deduction_amount, remaining_salary]
    );

    return res.json({
      success: true,
      message: 'Attendance marked successfully',
      data: {
        employeeId,
        status,
        deduction_amount,
        remaining_salary
      }
    });

  } catch (error) {
    console.error('Mark attendance error:', error.message);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});



module.exports = router;
