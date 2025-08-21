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
const OFFICE_LAT =  14.683436;
const OFFICE_LNG =  77.576371;
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

    // Step 2: Insert attendance record (no salary tracking here)
    await pool.query(
      `INSERT INTO attendance
        (employee_id, timestamp, image_url, status)
       VALUES ($1, (NOW() AT TIME ZONE 'Asia/Kolkata'), $2, $3)`,
      [employeeId, capturedUrl, status]
    );

    return res.json({
      success: true,
      message: 'Attendance marked successfully',
      data: {
        employeeId,
        status
      }
    });

  } catch (error) {
    console.error('Mark attendance error:', error.message);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});
// ✅ LOGOUT API
router.post('/logout', async (req, res) => {
  try {
    const { employeeId } = req.body;

    if (!employeeId) {
      return res.status(400).json({ success: false, message: 'Missing employeeId' });
    }

    const status = 'Off Duty';

    // Insert a new "Off Duty" record
    await pool.query(
      `INSERT INTO attendance
        (employee_id, timestamp, status)
       VALUES ($1,(NOW() AT TIME ZONE 'Asia/Kolkata'), $2)`,
      [employeeId, status]
    );

    return res.json({
      success: true,
      message: 'Logout marked successfully',
      data: { employeeId, status }
    });

  } catch (error) {
    console.error('Logout error:', error.message);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// GET all logout records
router.get('/logout/all', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT * 
       FROM attendance 
       WHERE status = 'Off Duty'
       ORDER BY timestamp DESC`
    );

    return res.json({
      success: true,
      data: result.rows
    });
  } catch (error) {
    console.error('Get logout error:', error.message);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});
// DELETE a specific logout record
router.delete('/logout/delete/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const result = await pool.query(
      `DELETE FROM attendance WHERE id = $1 AND status = 'Off Duty' RETURNING *`,
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Logout record not found' });
    }

    return res.json({
      success: true,
      message: 'Logout record deleted successfully',
      data: result.rows[0]
    });

  } catch (error) {
    console.error('Delete logout error:', error.message);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});



// Get all attendance records
router.get('/all', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT a.id, a.employee_id, e.full_name, a.timestamp, a.image_url, a.status, a.remaining_salary
       FROM attendance a
       JOIN employees e ON a.employee_id = e.id
       ORDER BY a.timestamp DESC`
    );

    res.json({
      success: true,
      count: result.rows.length,
      data: result.rows
    });
  } catch (error) {
    console.error('Get attendance error:', error.message);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// Get attendance by employee ID
router.get('/employee/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const result = await pool.query(
      `SELECT a.id, a.employee_id, e.full_name, a.timestamp, a.image_url, a.status, a.remaining_salary
       FROM attendance a
       JOIN employees e ON a.employee_id = e.id
       WHERE a.employee_id = $1
       ORDER BY a.timestamp DESC`,
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'No attendance records found for this employee',
      });
    }

    res.json({
      success: true,
      count: result.rows.length,
      data: result.rows,
    });
  } catch (error) {
    console.error('Get attendance by employee error:', error.message);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});



module.exports = router;
