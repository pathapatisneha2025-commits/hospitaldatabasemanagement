const express = require("express");
const router = express.Router();
const pool = require("../db");
const multer = require("multer");
const { CloudinaryStorage } = require("multer-storage-cloudinary");
const cloudinary = require("../cloudinary");
const { spawn } = require("child_process");
const path = require("path");
const axios = require("axios");
const rekognition = require("../awsConfig");

// ✅ Cloudinary storage
// storage config (reuse for both routes)
const storage = new CloudinaryStorage({
  cloudinary,
  params: {
    folder: "employee_faces",   // ✅ separate folder for face captures
    allowed_formats: ["jpg", "jpeg", "png", "webp"],
    public_id: (req, file) => {
      const nameWithoutExt = path.parse(file.originalname).name;
      return Date.now() + "-" + nameWithoutExt;
    },
  },
});

const upload = multer({ storage });

// 🚀 VERIFY FACE ROUTE
router.post("/verify-face", upload.single("image"), async (req, res) => {
  try {
    const employeeId = parseInt(req.body.employeeId, 10);
    const file = req.file;

    if (!file) {
      return res.status(400).json({ success: false, message: "Image required" });
    }
    if (isNaN(employeeId)) {
      return res.status(400).json({ success: false, message: "Valid Employee ID required" });
    }

    const capturedUrl = file.path;

    // ✅ Get registered employee face URL
    const result = await pool.query("SELECT image FROM employees WHERE id = $1", [employeeId]);
    if (result.rowCount === 0) {
      return res.status(404).json({ success: false, message: "Employee not found" });
    }

    const registeredUrl = result.rows[0].image;

    // ✅ Download both images from Cloudinary as bytes
    const [registeredImg, capturedImg] = await Promise.all([
      axios.get(registeredUrl, { responseType: "arraybuffer" }),
      axios.get(capturedUrl, { responseType: "arraybuffer" })
    ]);

    // ✅ Call AWS Rekognition CompareFaces
    const params = {
      SourceImage: { Bytes: Buffer.from(registeredImg.data) },
      TargetImage: { Bytes: Buffer.from(capturedImg.data) },
      SimilarityThreshold: 80 // Minimum similarity required
    };

    const rekognitionResult = await rekognition.compareFaces(params).promise();

    let faceVerified = false;
    let message = "Face not verified";

    if (rekognitionResult.FaceMatches && rekognitionResult.FaceMatches.length > 0) {
      faceVerified = true;
      message = "Face verified";
    }

    return res.json({
      success: true,
      faceVerified,
      message,
      capturedUrl
    });

  } catch (error) {
    console.error("Face verification error:", error.message);
    res.status(500).json({ success: false, message: "Server error" });
  }
});



// ✅ Location verification
const OFFICE_LAT = 14.683566097002268;
const OFFICE_LNG = 77.57632597022224;
const RADIUS_IN_METERS = 1000;

function getDistanceFromLatLonInMeters(lat1, lon1, lat2, lon2) {
  const R = 6371000;
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

router.post("/verify-location", (req, res) => {
  const { employeeId, latitude, longitude } = req.body;
  if (!employeeId || !latitude || !longitude) {
    return res.status(400).json({ success: false, message: "Missing coordinates" });
  }

  const distance = getDistanceFromLatLonInMeters(latitude, longitude, OFFICE_LAT, OFFICE_LNG);
  if (distance <= RADIUS_IN_METERS) {
    return res.json({ locationVerified: true });
  } else {
    return res.json({ locationVerified: false, distance });
  }
});

// ✅ Mark attendance
router.post("/mark-attendance", async (req, res) => {
  try {
    const { employeeId, capturedUrl, locationVerified, faceVerified } = req.body;
    if (!employeeId || !capturedUrl) {
      return res.status(400).json({ success: false, message: "Missing required fields" });
    }

    const status =
      locationVerified === true && faceVerified === true ? "On Duty" : "Absent";

    await pool.query(
      `INSERT INTO attendance (employee_id, timestamp, image_url, status)
       VALUES ($1, (NOW() AT TIME ZONE 'Asia/Kolkata'), $2, $3)`,
      [employeeId, capturedUrl, status]
    );

    return res.json({
      success: true,
      message: "Attendance marked successfully",
      data: { employeeId, status },
    });
  } catch (error) {
    console.error("Mark attendance error:", error.message);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

// ✅ Logout

// ✅ Logout Route with session_hours, daily, weekly, monthly
router.post("/logout", async (req, res) => {
  try {
    const { employeeId, capturedUrl, locationVerified, faceVerified } = req.body;

    if (!employeeId || !capturedUrl) {
      return res.status(400).json({ success: false, message: "Missing required fields" });
    }

    if (locationVerified !== true || faceVerified !== true) {
      return res.status(403).json({
        success: false,
        message: "Logout failed: Location or Face verification failed",
      });
    }

    const status = "Off Duty";

    // 1️⃣ Find last On Duty record
    const onDutyResult = await pool.query(
      `SELECT id, timestamp
       FROM attendance
       WHERE employee_id = $1 AND status = 'On Duty'
       ORDER BY timestamp DESC
       LIMIT 1`,
      [employeeId]
    );

    if (onDutyResult.rows.length === 0) {
      return res.json({
        success: true,
        message: "Logout marked (no matching On Duty found).",
        data: { employeeId, status },
      });
    }

    const onDutyTime = onDutyResult.rows[0].timestamp;

    // ✅ Helper function: convert seconds → "X hrs Y mins"
    const formatHours = (seconds) => {
      const hrs = Math.floor(seconds / 3600);
      const mins = Math.floor((seconds % 3600) / 60);
      return `${hrs} hrs ${mins} mins`;
    };

    // 2️⃣ Calculate session seconds
    const sessionSecondsRes = await pool.query(
      `SELECT EXTRACT(EPOCH FROM (NOW() AT TIME ZONE 'Asia/Kolkata' - $1)) AS seconds`,
      [onDutyTime]
    );
    const sessionSeconds = parseInt(sessionSecondsRes.rows[0].seconds, 10);
    const sessionHours = formatHours(sessionSeconds);

    // 3️⃣ Insert Off Duty with session_hours
    const insertResult = await pool.query(
      `INSERT INTO attendance (employee_id, timestamp, image_url, status, session_hours)
       VALUES ($1, NOW() AT TIME ZONE 'Asia/Kolkata', $2, $3, $4)
       RETURNING id, timestamp`,
      [employeeId, capturedUrl, status, sessionHours]
    );

    const offDutyRow = insertResult.rows[0];
    const offDutyId = offDutyRow.id;
    const offDutyTimestamp = offDutyRow.timestamp;

    // 4️⃣ Daily hours = current session only
    const dailyHours = sessionHours;

    // 5️⃣ Weekly total = sum of all sessions this week
    const weeklyRes = await pool.query(
      `SELECT COALESCE(SUM(EXTRACT(EPOCH FROM session_hours::interval)),0) AS total_seconds
       FROM attendance
       WHERE employee_id = $1
         AND status = 'Off Duty'
         AND DATE_TRUNC('week', timestamp) = DATE_TRUNC('week', $2::timestamp)`,
      [employeeId, offDutyTimestamp]
    );
    const weeklyHours = formatHours(parseInt(weeklyRes.rows[0].total_seconds, 10));

    // 6️⃣ Monthly total = sum of all sessions this month
    const monthlyRes = await pool.query(
      `SELECT COALESCE(SUM(EXTRACT(EPOCH FROM session_hours::interval)),0) AS total_seconds
       FROM attendance
       WHERE employee_id = $1
         AND status = 'Off Duty'
         AND DATE_TRUNC('month', timestamp) = DATE_TRUNC('month', $2::timestamp)`,
      [employeeId, offDutyTimestamp]
    );
    const monthlyHours = formatHours(parseInt(monthlyRes.rows[0].total_seconds, 10));

    // 7️⃣ Update Off Duty row with all totals in "hrs mins"
    await pool.query(
      `UPDATE attendance
       SET daily_hours = $1, weekly_hours = $2, monthly_hours = $3
       WHERE id = $4`,
      [dailyHours, weeklyHours, monthlyHours, offDutyId]
    );

    return res.json({
      success: true,
      message: "Logout marked successfully with hours calculated",
      data: {
        employeeId,
        status,
        sessionHours,  // "X hrs Y mins"
        dailyHours,
        weeklyHours,
        monthlyHours,
      },
    });

  } catch (error) {
    console.error("Logout error:", error.message);
    res.status(500).json({ success: false, message: "Server error" });
  }
});






// ✅ Logout queries
router.get("/logout/all", async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT * FROM attendance WHERE status = 'Off Duty' ORDER BY timestamp DESC`
    );
    return res.json({ success: true, data: result.rows });
  } catch (error) {
    console.error("Get logout error:", error.message);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

router.get("/logout/:employeeId", async (req, res) => {
  try {
    const { employeeId } = req.params;
    const result = await pool.query(
      `SELECT * FROM attendance WHERE status = 'Off Duty' AND employee_id = $1 ORDER BY timestamp DESC`,
      [employeeId]
    );

    if (result.rows.length === 0) {
      return res
        .status(404)
        .json({ success: false, message: "No logout records found for this employee" });
    }
    return res.json({ success: true, data: result.rows });
  } catch (error) {
    console.error("Get logout by ID error:", error.message);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

router.delete("/logout/delete/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query(
      `DELETE FROM attendance WHERE id = $1 AND status = 'Off Duty' RETURNING *`,
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, message: "Logout record not found" });
    }
    return res.json({
      success: true,
      message: "Logout record deleted successfully",
      data: result.rows[0],
    });
  } catch (error) {
    console.error("Delete logout error:", error.message);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

// ✅ Attendance queries
router.get("/all", async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT a.id, a.employee_id, e.full_name, a.timestamp, a.image_url, a.status
       FROM attendance a
       JOIN employees e ON a.employee_id = e.id
       ORDER BY a.timestamp DESC`
    );
    res.json({ success: true, count: result.rows.length, data: result.rows });
  } catch (error) {
    console.error("Get attendance error:", error.message);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

router.get("/employee/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query(
      `SELECT a.id, a.employee_id, e.full_name, a.timestamp, a.image_url, a.status
       FROM attendance a
       JOIN employees e ON a.employee_id = e.id
       WHERE a.employee_id = $1
       ORDER BY a.timestamp DESC`,
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "No attendance records found for this employee",
      });
    }
    res.json({ success: true, count: result.rows.length, data: result.rows });
  } catch (error) {
    console.error("Get attendance by employee error:", error.message);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

module.exports = router;