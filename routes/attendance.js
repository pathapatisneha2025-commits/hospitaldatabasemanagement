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
    const employeeId = req.body.employeeId ? parseInt(req.body.employeeId, 10) : null;
    const subadminId = req.body.subadminId ? parseInt(req.body.subadminId, 10) : null;
    const file = req.file;

    // ✅ Require image and at least one ID
    if (!file) {
      return res.status(400).json({ success: false, message: "Image required" });
    }

    if (!employeeId && !subadminId) {
      return res.status(400).json({ success: false, message: "Either Employee ID or Subadmin ID required" });
    }

    const capturedUrl = file.path;

    // ✅ Fetch registered face image based on ID type
    let registeredUrl;
    if (employeeId) {
      const result = await pool.query("SELECT image FROM employees WHERE id = $1", [employeeId]);
      if (result.rowCount === 0) {
        return res.status(404).json({ success: false, message: "Employee not found" });
      }
      registeredUrl = result.rows[0].image;
    } else {
      const result = await pool.query("SELECT image FROM subadmin WHERE id = $1", [subadminId]);
      if (result.rowCount === 0) {
        return res.status(404).json({ success: false, message: "Subadmin not found" });
      }
      registeredUrl = result.rows[0].image;
    }

    // ✅ Download both images
    const [registeredImg, capturedImg] = await Promise.all([
      axios.get(registeredUrl, { responseType: "arraybuffer" }),
      axios.get(capturedUrl, { responseType: "arraybuffer" })
    ]);

    // ✅ Compare faces using AWS Rekognition
    const params = {
      SourceImage: { Bytes: Buffer.from(registeredImg.data) },
      TargetImage: { Bytes: Buffer.from(capturedImg.data) },
      SimilarityThreshold: 80
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
      capturedUrl,
      employeeId: employeeId || null,
      subadminId: subadminId || null,
    });

  } catch (error) {
    console.error("Face verification error:", error.message);
    res.status(500).json({ success: false, message: "Server error" });
  }
});



// ✅ Location verification
const OFFICE_LAT = 17.677817;
const OFFICE_LNG = 83.198669;
const RADIUS_IN_METERS = 2000;

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
  const { employeeId, subadminId, latitude, longitude } = req.body;

  // ✅ Require either employeeId or subadminId
  if ((!employeeId && !subadminId) || !latitude || !longitude) {
    return res.status(400).json({ success: false, message: "Missing coordinates or ID" });
  }

  // ✅ Calculate distance
  const distance = getDistanceFromLatLonInMeters(latitude, longitude, OFFICE_LAT, OFFICE_LNG);

  // ✅ Verify within radius
  if (distance <= RADIUS_IN_METERS) {
    return res.json({
      success: true,
      locationVerified: true,
      employeeId: employeeId || null,
      subadminId: subadminId || null,
      distance,
    });
  } else {
    return res.json({
      success: true,
      locationVerified: false,
      employeeId: employeeId || null,
      subadminId: subadminId || null,
      distance,
    });
  }
});


// ✅ Mark attendance
router.post("/mark-attendance", async (req, res) => {
  try {
    const { employeeId, subadminId, capturedUrl, locationVerified, faceVerified } = req.body;

    if ((!employeeId && !subadminId) || !capturedUrl) {
      return res.status(400).json({ success: false, message: "Missing required fields" });
    }

    const status =
      locationVerified === true && faceVerified === true ? "On Duty" : "Absent";

    // ✅ Determine which ID to use — employee or subadmin
    const idToUse = employeeId || subadminId;
    const columnToUse = employeeId ? "employee_id" : "subadmin_id";

    // ✅ Insert and return timestamp
    const insertResult = await pool.query(
      `INSERT INTO attendance (${columnToUse}, timestamp, image_url, status)
       VALUES ($1, (NOW() AT TIME ZONE 'Asia/Kolkata'), $2, $3)
       RETURNING id, ${columnToUse}, status, timestamp`,
      [idToUse, capturedUrl, status]
    );

    const row = insertResult.rows[0];

    return res.json({
      success: true,
      message: "Attendance marked successfully",
      data: {
        employeeId: employeeId || null,
        subadminId: subadminId || null,
        status: row.status,
        timestamp: row.timestamp
      },
    });
  } catch (error) {
    console.error("Mark attendance error:", error.message);
    res.status(500).json({ success: false, message: "Server error" });
  }
});


 // ✅ Fetch all "On Duty" attendance records
router.get("/login/all", async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT 
        a.id, 
        a.employee_id, 
        e.full_name, 
        a.timestamp, 
        a.image_url, 
        a.status
      FROM attendance a
      JOIN employees e ON a.employee_id = e.id
      WHERE a.status = 'On Duty'
      ORDER BY a.timestamp DESC
    `);

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "No 'On Duty' attendance records found",
      });
    }

    return res.json({
      success: true,
      count: result.rows.length,
      data: result.rows,
    });
  } catch (error) {
    console.error("Get all On Duty attendance error:", error.message);
    res.status(500).json({
      success: false,
      message: "Server error",
    });
  }
});






// ✅ Delete Attendance Login/Logout Pair
router.delete("/delete", async (req, res) => {
  try {
    const { loginId, logoutId } = req.body;

    if (!loginId && !logoutId) {
      return res.status(400).json({ success: false, message: "No IDs provided" });
    }

    const deletedRows = [];

    if (loginId) {
      const result = await pool.query(`DELETE FROM attendance WHERE id = $1 RETURNING *`, [loginId]);
      if (result.rowCount > 0) deletedRows.push(result.rows[0]);
    }

    if (logoutId) {
      const result = await pool.query(`DELETE FROM attendance WHERE id = $1 RETURNING *`, [logoutId]);
      if (result.rowCount > 0) deletedRows.push(result.rows[0]);
    }

    if (deletedRows.length === 0) {
      return res.status(404).json({ success: false, message: "No matching records found" });
    }

    res.json({
      success: true,
      message: "Login/Logout record(s) deleted successfully",
      data: deletedRows,
    });
  } catch (error) {
    console.error("Delete attendance error:", error.message);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

router.put("/update", async (req, res) => {
  try {
    const { loginId, logoutId, status, checkIn, checkOut } = req.body;

    if (!loginId && !logoutId)
      return res
        .status(400)
        .json({ success: false, message: "Missing attendance IDs" });

    // Update login record if exists
    if (loginId) {
      await pool.query(
        `UPDATE attendance
         SET timestamp = $1 
         WHERE id = $2`,
        [checkIn, loginId]
      );
    }

    // Update logout record if exists
    if (logoutId) {
      await pool.query(
        `UPDATE attendance
         SET timestamp = $1 
         WHERE id = $2`,
        [checkOut, logoutId]
      );
    }

    return res.json({
      success: true,
      message: "Attendance record updated successfully",
    });
  } catch (error) {
    console.error("Update error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to update attendance record",
    });
  }
});


// ✅ Logout Route with session_hours, daily, weekly, monthly
router.post("/logout", async (req, res) => {
  try {
    const { employeeId, subadminId, capturedUrl, locationVerified, faceVerified } = req.body;

    // ✅ Require either employeeId or subadminId
    if ((!employeeId && !subadminId) || !capturedUrl) {
      return res.status(400).json({ success: false, message: "Missing required fields" });
    }

    // ✅ Require both verifications
    if (!locationVerified || !faceVerified) {
      return res.status(403).json({
        success: false,
        message: "Logout failed: Location or Face verification failed",
      });
    }

    const status = "Off Duty";

    const formatHours = (seconds) => {
      const hrs = Math.floor(seconds / 3600);
      const mins = Math.floor((seconds % 3600) / 60);
      return `${hrs} hrs ${mins} mins`;
    };

    // 🧩 EMPLOYEE LOGOUT — Full Calculation
    if (employeeId) {
      const onDuty = await pool.query(
        `SELECT id, timestamp FROM attendance
         WHERE employee_id = $1 AND status = 'On Duty'
         ORDER BY timestamp DESC LIMIT 1`,
        [employeeId]
      );

      if (onDuty.rows.length === 0) {
        return res.json({
          success: true,
          message: "Logout marked (no On Duty found for employee).",
          data: { employee_id: employeeId, status },
        });
      }

      const onDutyTime = onDuty.rows[0].timestamp;

      // ⏱️ Calculate session worked time
      const sessionRes = await pool.query(
        `SELECT EXTRACT(EPOCH FROM (NOW() AT TIME ZONE 'Asia/Kolkata' - $1)) AS seconds`,
        [onDutyTime]
      );
      const sessionSeconds = parseInt(sessionRes.rows[0].seconds, 10);
      const sessionHours = formatHours(sessionSeconds);

      // 🕒 Remaining hours (10-hour workday)
      const totalDaySeconds = 10 * 3600;
      const remainingSeconds = Math.max(totalDaySeconds - sessionSeconds, 0);
      const remainingHours = formatHours(remainingSeconds);

      // 🕓 Overtime
      let overtime = "0 hrs 0 mins";
      const empRes = await pool.query(`SELECT schedule_out FROM employees WHERE id = $1`, [employeeId]);
      if (empRes.rows.length > 0 && empRes.rows[0].schedule_out) {
        const scheduleOut = empRes.rows[0].schedule_out;
        const overtimeRes = await pool.query(
          `SELECT GREATEST(
              EXTRACT(EPOCH FROM ((NOW() AT TIME ZONE 'Asia/Kolkata') 
              - (CURRENT_DATE + $1::time AT TIME ZONE 'Asia/Kolkata'))), 0
            ) AS overtime_seconds`,
          [scheduleOut]
        );
        const overtimeSeconds = parseInt(overtimeRes.rows[0].overtime_seconds, 10);
        if (overtimeSeconds > 0) overtime = formatHours(overtimeSeconds);
      }

      // 📅 Daily/Weekly/Monthly totals
      const dailyRes = await pool.query(
        `SELECT COALESCE(SUM(EXTRACT(EPOCH FROM session_hours)), 0) AS daily_seconds
         FROM attendance
         WHERE employee_id = $1 AND DATE(timestamp) = CURRENT_DATE`,
        [employeeId]
      );

      const weeklyRes = await pool.query(
        `SELECT COALESCE(SUM(EXTRACT(EPOCH FROM session_hours)), 0) AS weekly_seconds
         FROM attendance
         WHERE employee_id = $1
           AND DATE_PART('week', timestamp) = DATE_PART('week', CURRENT_DATE)
           AND DATE_PART('year', timestamp) = DATE_PART('year', CURRENT_DATE)`,
        [employeeId]
      );

      const monthlyRes = await pool.query(
        `SELECT COALESCE(SUM(EXTRACT(EPOCH FROM session_hours)), 0) AS monthly_seconds
         FROM attendance
         WHERE employee_id = $1
           AND DATE_TRUNC('month', timestamp) = DATE_TRUNC('month', CURRENT_DATE)`,
        [employeeId]
      );

      const dailyHoursStr = formatHours(dailyRes.rows[0].daily_seconds);
      const weeklyHoursStr = formatHours(weeklyRes.rows[0].weekly_seconds);
      const monthlyHoursStr = formatHours(monthlyRes.rows[0].monthly_seconds);

      // ✅ Insert Off Duty record for employee
      const insertResult = await pool.query(
        `INSERT INTO attendance 
          (employee_id, timestamp, image_url, status, session_hours, overtime, remaining_hours, daily_hours, weekly_hours, monthly_hours)
         VALUES ($1, NOW() AT TIME ZONE 'Asia/Kolkata', $2, $3, $4, $5, $6, $7, $8, $9)
         RETURNING id, timestamp`,
        [employeeId, capturedUrl, status, sessionHours, overtime, remainingHours, dailyHoursStr, weeklyHoursStr, monthlyHoursStr]
      );

      return res.json({
        success: true,
        message: "Employee logout marked successfully",
        data: {
          employee_id: employeeId,
          status,
          timestamp: insertResult.rows[0].timestamp,
          sessionHours,
          remainingHours,
          overtime,
          daily_hours: dailyHoursStr,
          weekly_hours: weeklyHoursStr,
          monthly_hours: monthlyHoursStr,
        },
      });
    }

    // 🧩 SUBADMIN LOGOUT — Simple record only
    if (subadminId) {
      const insertResult = await pool.query(
        `INSERT INTO attendance (subadmin_id, timestamp, image_url, status)
         VALUES ($1, NOW() AT TIME ZONE 'Asia/Kolkata', $2, $3)
         RETURNING id, timestamp`,
        [subadminId, capturedUrl, status]
      );

      return res.json({
        success: true,
        message: "Subadmin logout marked successfully",
        data: {
          subadmin_id: subadminId,
          status,
          timestamp: insertResult.rows[0].timestamp,
        },
      });
    }

  } catch (error) {
    console.error("Logout error:", error.message);
    res.status(500).json({ success: false, message: "Server error" });
  }
});








router.get("/logout/all", async (req, res) => {
  try {
    // 1️⃣ Fetch all "Off Duty" records
    const allRes = await pool.query(
      `SELECT * FROM attendance WHERE status = 'Off Duty' ORDER BY timestamp DESC`
    );

    // 2️⃣ Fetch daily records for all employees (today)
    const dailyRes = await pool.query(
      `SELECT employee_id, timestamp, session_hours, remaining_hours, overtime
       FROM attendance
       WHERE status = 'Off Duty' 
         AND DATE(timestamp) = CURRENT_DATE
       ORDER BY timestamp`
    );

    // 3️⃣ Fetch monthly records for all employees (current month)
    const monthlyRes = await pool.query(
      `SELECT employee_id, timestamp, session_hours, remaining_hours, overtime
       FROM attendance
       WHERE status = 'Off Duty'
         AND DATE_TRUNC('month', timestamp) = DATE_TRUNC('month', CURRENT_DATE)
       ORDER BY timestamp`
    );

    return res.json({
      success: true,
      message: "Fetched all logout records with daily and monthly summary for all employees",
      data: {
        status: "Off Duty",
        attendance: {
          all: allRes.rows,
          daily: dailyRes.rows,      // Includes all employees for today
          monthly: monthlyRes.rows,  // Includes all employees for the current month
        },
      },
    });
  } catch (error) {
    console.error("Get logout error:", error.message);
    res.status(500).json({ success: false, message: "Server error" });
  }
});



// ✅ Logout by Employee ID with daily and monthly summaries
router.get("/logout/:employeeId", async (req, res) => {
  try {
    const { employeeId } = req.params;

    // 1️⃣ Fetch all "Off Duty" records for this employee
    const allRes = await pool.query(
      `SELECT employee_id, timestamp, session_hours, remaining_hours, overtime, image_url
       FROM attendance
       WHERE status = 'Off Duty' AND employee_id = $1
       ORDER BY timestamp DESC`,
      [employeeId]
    );

    if (allRes.rows.length === 0) {
      return res
        .status(404)
        .json({ success: false, message: "No logout records found for this employee" });
    }

    // 2️⃣ Fetch daily records for this employee (today)
    const dailyRes = await pool.query(
      `SELECT employee_id, timestamp, session_hours, remaining_hours, overtime, image_url
       FROM attendance
       WHERE status = 'Off Duty' AND employee_id = $1
         AND DATE(timestamp) = CURRENT_DATE
       ORDER BY timestamp`,
      [employeeId]
    );

    // 3️⃣ Fetch monthly records for this employee (current month)
    const monthlyRes = await pool.query(
      `SELECT employee_id, timestamp, session_hours, remaining_hours, overtime, image_url
       FROM attendance
       WHERE status = 'Off Duty' AND employee_id = $1
         AND DATE_TRUNC('month', timestamp) = DATE_TRUNC('month', CURRENT_DATE)
       ORDER BY timestamp`,
      [employeeId]
    );

    return res.json({
      success: true,
      message: "Fetched logout records with daily and monthly summary for this employee",
      data: {
        status: "Off Duty",
        attendance: {
          all: allRes.rows,
          daily: dailyRes.rows,
          monthly: monthlyRes.rows,
        },
      },
    });
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
router.get("/combined", async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT *
      FROM attendance
      ORDER BY employee_id, timestamp ASC
    `);

    const rows = result.rows;
    const sessions = [];

    let activeSession = {}; // store On Duty before Off Duty

    for (const row of rows) {
      const empId = row.employee_id;

      if (row.status === "On Duty") {
        // Start of session
        activeSession[empId] = {
          employee_id: empId,
          login_time: row.timestamp,
          image_url_on: row.image_url,
        };
      } else if (row.status === "Off Duty" && activeSession[empId]) {
        // End of session
        const loginTime = new Date(activeSession[empId].login_time);
        const logoutTime = new Date(row.timestamp);
        const diffMs = logoutTime - loginTime;

        const hours = Math.floor(diffMs / (1000 * 60 * 60));
        const minutes = Math.floor((diffMs / (1000 * 60)) % 60);

        sessions.push({
          employee_id: empId,
          login_time: activeSession[empId].login_time,
          logout_time: row.timestamp,
          session_hours: `${hours} hrs ${minutes} mins`,
          overtime: row.overtime,
          remaining_hours: row.remaining_hours,
          image_url_on: activeSession[empId].image_url,
          image_url_off: row.image_url,
        });

        delete activeSession[empId]; // reset session
      }
    }

    res.json({
      success: true,
      count: sessions.length,
      data: sessions,
    });
  } catch (error) {
    console.error("Combine attendance error:", error.message);
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
// ✅ Delete both login & logout records for an employee (no date filter)
router.delete("/deletelogs/:employee_id", async (req, res) => {
  try {
    const { employee_id } = req.params;

    // Delete all records for this employee (both On Duty + Off Duty)
    const result = await pool.query(
      `
      DELETE FROM attendance
      WHERE employee_id = $1
      RETURNING *
      `,
      [employee_id]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({
        success: false,
        message: "No attendance records found for this employee",
      });
    }

    res.json({
      success: true,
      message: "All login & logout records deleted successfully",
      deleted: result.rows,
    });
  } catch (error) {
    console.error("❌ Delete attendance error:", error.message);
    res.status(500).json({ success: false, message: "Server error" });
  }
});
router.get("/summary", async (req, res) => {
  try {
    const { view = "weekly", month } = req.query; // add month param
    const today = new Date();
    let start, end;

    // 📅 Determine date range
    if (view === "monthly") {
      if (month) {
        // If month param provided (1-12)
        const monthInt = parseInt(month, 10) - 1; // JS months 0-11
        start = new Date(today.getFullYear(), monthInt, 1);
        end = new Date(today.getFullYear(), monthInt + 1, 0); // last day of month
      } else {
        // Default to current month
        start = new Date(today.getFullYear(), today.getMonth(), 1);
        end = new Date(today.getFullYear(), today.getMonth() + 1, 0);
      }
    } else {
      // Weekly (Monday–Sunday)
      const day = today.getDay();
      const diffToMonday = (day === 0 ? -6 : 1) - day;
      start = new Date(today);
      start.setDate(today.getDate() + diffToMonday);
      end = new Date(start);
      end.setDate(start.getDate() + 6);
    }

    const startStr = start.toISOString().split("T")[0];
    const endStr = end.toISOString().split("T")[0];

    // 🧩 Main SQL Query (combines On Duty + Off Duty into one row per day)
    const query = `
      SELECT 
        e.id AS employee_id,
        e.full_name AS employee_name,
        e.department,
        d::date AS date,
        MIN(a.timestamp) FILTER (WHERE a.status = 'On Duty') AS check_in,
        MAX(a.timestamp) FILTER (WHERE a.status = 'Off Duty') AS check_out,
        CASE
          WHEN l.id IS NOT NULL THEN 'On Leave'
          WHEN MIN(a.timestamp) FILTER (WHERE a.status = 'On Duty') IS NOT NULL
               OR MAX(a.timestamp) FILTER (WHERE a.status = 'Off Duty') IS NOT NULL
          THEN 'Present'
          ELSE 'Absent'
        END AS status
      FROM employees e
      CROSS JOIN generate_series($1::date, $2::date, interval '1 day') AS d
      LEFT JOIN attendance a 
        ON e.id = a.employee_id 
        AND DATE(a.timestamp) = d
      LEFT JOIN leaves l 
        ON e.id = l.employee_id
        AND l.status = 'Approved'
        AND d BETWEEN l.start_date AND l.end_date
      GROUP BY e.id, e.full_name, e.department, d, l.id
      ORDER BY e.full_name, d;
    `;

    const result = await pool.query(query, [startStr, endStr]);

    // 🧮 Group and process data
    const employeeMap = {};
    result.rows.forEach((row) => {
      if (!employeeMap[row.employee_id]) {
        employeeMap[row.employee_id] = {
          employee_id: row.employee_id,
          employee_name: row.employee_name,
          department: row.department,
          days: [],
          presentDays: 0,
          totalDays: 0,
        };
      }

      const formatTime = (t) =>
        t ? new Date(t).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "-";

      let totalHours = "-";
      if (row.check_in && row.check_out) {
        const diffMs = new Date(row.check_out) - new Date(row.check_in);
        const hours = Math.floor(diffMs / (1000 * 60 * 60));
        const minutes = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));
        totalHours = `${hours}h ${minutes}m`;
      }

      employeeMap[row.employee_id].days.push({
        date: row.date,
        status: row.status,
        check_in: formatTime(row.check_in),
        check_out: formatTime(row.check_out),
        working_hours: totalHours,
      });

      if (row.status === "Present") employeeMap[row.employee_id].presentDays++;
      employeeMap[row.employee_id].totalDays++;
    });

    const summary = Object.values(employeeMap).map((emp) => ({
      ...emp,
      attendanceRate: ((emp.presentDays / emp.totalDays) * 100).toFixed(0) + "%",
    }));

    res.json({
      success: true,
      view,
      month: month || (today.getMonth() + 1),
      range: { start: startStr, end: endStr },
      data: summary,
    });
  } catch (error) {
    console.error("Error fetching attendance summary:", error.message);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

router.get("/late-count/:employeeId/:year/:month", async (req, res) => {
  try {
    const { employeeId, year, month } = req.params;

    if (!employeeId || !year || !month) {
      return res.status(400).json({ success: false, message: "Missing required parameters." });
    }

    // ✅ Your SQL query for late entries
    const lateResult = await pool.query(
      `SELECT 
          DATE(a.timestamp) AS day,
          FLOOR(EXTRACT(EPOCH FROM (MIN(a.timestamp)::time - e.schedule_in)) / 300) AS blocks
       FROM attendance a
       JOIN employees e ON a.employee_id = e.id
       WHERE a.employee_id = $1
         AND EXTRACT(YEAR FROM a.timestamp) = $2
         AND EXTRACT(MONTH FROM a.timestamp) = $3
         AND a.status ILIKE 'On Duty'
       GROUP BY DATE(a.timestamp), e.schedule_in
       HAVING MIN(a.timestamp)::time > e.schedule_in;`,
      [employeeId, year, month]
    );

    // ✅ Count number of late days
    const lateCount = lateResult.rows.length;

    return res.json({
      success: true,
      employeeId,
      year,
      month,
      lateCount,
      lateDetails: lateResult.rows, // optional: contains day + blocks
    });
  } catch (error) {
    console.error("Error fetching late count:", error);
    return res.status(500).json({
      success: false,
      message: "Server error while fetching late count",
    });
  }
});

module.exports = router;