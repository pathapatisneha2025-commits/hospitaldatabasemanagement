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
    const adminId = req.body.adminId ? parseInt(req.body.adminId, 10) : null;
    const file = req.file;

    // Require image
    if (!file) {
      return res.status(400).json({ success: false, message: "Image required" });
    }

    // Require at least ONE ID
    if (!employeeId && !subadminId && !adminId) {
      return res.status(400).json({
        success: false,
        message: "Employee ID, Subadmin ID, or Admin ID required"
      });
    }

    const capturedUrl = file.path;

    // ---------------- FETCH REGISTERED IMAGE ----------------
    let registeredUrl;
    let tableName = "";
    let userId = null;

    if (employeeId) {
      tableName = "employees";
      userId = employeeId;
    } else if (subadminId) {
      tableName = "subadmin";
      userId = subadminId;
    } else if (adminId) {
      tableName = "admin";
      userId = adminId;
    }

    const result = await pool.query(`SELECT image FROM ${tableName} WHERE id = $1`, [userId]);

    if (result.rowCount === 0) {
      return res.status(404).json({
        success: false,
        message: `${tableName} not found`
      });
    }

    registeredUrl = result.rows[0].image;

    // ---------------- DOWNLOAD BOTH IMAGES ----------------
    const [registeredImg, capturedImg] = await Promise.all([
      axios.get(registeredUrl, { responseType: "arraybuffer" }),
      axios.get(capturedUrl, { responseType: "arraybuffer" })
    ]);

    // ---------------- AWS REKOGNITION ----------------
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
      adminId: adminId || null,
    });

  } catch (error) {
    console.error("Face verification error:", error.message);
    res.status(500).json({ success: false, message: "Server error" });
  }
});




// ✅ Location verification
const OFFICE_LAT = 17.677829;
const OFFICE_LNG = 83.198689;
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
  const { employeeId, subadminId, adminId, latitude, longitude } = req.body;

  // Require at least ONE ID
  if ((!employeeId && !subadminId && !adminId) || !latitude || !longitude) {
    return res.status(400).json({
      success: false,
      message: "Missing coordinates or ID",
    });
  }

  // Calculate distance
  const distance = getDistanceFromLatLonInMeters(
    latitude,
    longitude,
    OFFICE_LAT,
    OFFICE_LNG
  );

  // Within allowed radius
  const isVerified = distance <= RADIUS_IN_METERS;

  return res.json({
    success: true,
    locationVerified: isVerified,
    employeeId: employeeId || null,
    subadminId: subadminId || null,
    adminId: adminId || null,
    distance,
  });
});



// ✅ Mark attendance
router.post("/mark-attendance", async (req, res) => {
  try {
    const {
      employeeId,
      subadminId,
      adminId,      // ✅ Added adminId
      capturedUrl,
      locationVerified,
      faceVerified,
    } = req.body;

    if ((!employeeId && !subadminId && !adminId) || !capturedUrl) {
      return res
        .status(400)
        .json({ success: false, message: "Missing required fields" });
    }

    const status =
      locationVerified === true && faceVerified === true ? "On Duty" : "Absent";

    // ✅ Determine which ID to use and the column
    let idToUse;
    let columnToUse;

    if (employeeId) {
      idToUse = employeeId;
      columnToUse = "employee_id";
    } else if (subadminId) {
      idToUse = subadminId;
      columnToUse = "subadmin_id";
    } else if (adminId) {
      idToUse = adminId;
      columnToUse = "admin_id";
    }

    // ✅ Insert attendance
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
        adminId: adminId || null,
        status: row.status,
        timestamp: row.timestamp,
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






// ✅ Delete Attendance + Breaks by IDs
router.delete("/delete", async (req, res) => {
  try {
    const { loginId, logoutId, breakIds } = req.body; // breakIds = array of break_log IDs

    if (!loginId && !logoutId && (!breakIds || breakIds.length === 0)) {
      return res.status(400).json({ success: false, message: "No IDs provided" });
    }

    const deletedRows = [];

    // Delete login record
    if (loginId) {
      const result = await pool.query(
        `DELETE FROM attendance WHERE id = $1 RETURNING *`,
        [loginId]
      );
      if (result.rowCount > 0) deletedRows.push(result.rows[0]);
    }

    // Delete logout record
    if (logoutId) {
      const result = await pool.query(
        `DELETE FROM attendance WHERE id = $1 RETURNING *`,
        [logoutId]
      );
      if (result.rowCount > 0) deletedRows.push(result.rows[0]);
    }

    // Delete breaks by IDs
    if (breakIds && breakIds.length > 0) {
      const result = await pool.query(
        `DELETE FROM break_logs WHERE id = ANY($1::int[]) RETURNING *`,
        [breakIds]
      );
      if (result.rowCount > 0) deletedRows.push(...result.rows);
    }

    if (deletedRows.length === 0) {
      return res.status(404).json({ success: false, message: "No matching records found" });
    }

    res.json({
      success: true,
      message: "Attendance + specified break records deleted successfully",
      data: deletedRows,
    });
  } catch (error) {
    console.error("Delete error:", error.message);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

// ✅ Update Attendance + specific Break status by ID
router.put("/update", async (req, res) => {
  try {
    const { loginId, logoutId, checkIn, checkOut, breakUpdates } = req.body;
    // breakUpdates = [{ id: breakId, status: "On Break" | "Returned" }, ...]

    if (!loginId && !logoutId && (!breakUpdates || breakUpdates.length === 0)) {
      return res
        .status(400)
        .json({ success: false, message: "Missing attendance or break IDs" });
    }

    // Update login record
    if (loginId) {
      await pool.query(
        `UPDATE attendance SET timestamp = $1 WHERE id = $2`,
        [checkIn, loginId]
      );
    }

    // Update logout record
    if (logoutId) {
      await pool.query(
        `UPDATE attendance SET timestamp = $1 WHERE id = $2`,
        [checkOut, logoutId]
      );
    }

    // Update break status individually by ID
    if (breakUpdates && breakUpdates.length > 0) {
      for (const b of breakUpdates) {
        await pool.query(
          `UPDATE break_logs SET status = $1 WHERE id = $2`,
          [b.status, b.id]
        );
      }
    }

    return res.json({
      success: true,
      message: "Attendance and break status updated successfully",
    });
  } catch (error) {
    console.error("Update error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to update records",
    });
  }
});



// ✅ Logout Route with proper daily, weekly, monthly hours
router.post("/logout", async (req, res) => {
  try {
    const {
      employeeId,
      subadminId,
      adminId,
      capturedUrl,
      locationVerified,
      faceVerified,
    } = req.body;

    if ((!employeeId && !subadminId && !adminId) || !capturedUrl) {
      return res
        .status(400)
        .json({ success: false, message: "Missing required fields" });
    }

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
      return `${hrs}h ${mins}m`;
    };

    const parseHoursStrToSeconds = (str) => {
      if (!str) return 0;
      const match = str.match(/(\d+)h\s*(\d+)?m?/);
      const hrs = parseInt(match?.[1] || 0);
      const mins = parseInt(match?.[2] || 0);
      return hrs * 3600 + mins * 60;
    };

    // ---------------- EMPLOYEE LOGOUT ----------------
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

      // Session worked time
      const sessionRes = await pool.query(
        `SELECT EXTRACT(EPOCH FROM (NOW() AT TIME ZONE 'Asia/Kolkata' - $1)) AS seconds`,
        [onDutyTime]
      );
      const sessionSeconds = parseInt(sessionRes.rows[0].seconds, 10);
      const sessionHours = formatHours(sessionSeconds);

      // Remaining hours (10-hour workday)
      const totalDaySeconds = 10 * 3600;
      const remainingSeconds = Math.max(totalDaySeconds - sessionSeconds, 0);
      const remainingHours = formatHours(remainingSeconds);

      // Overtime
      let overtime = "0h 0m";
      const empRes = await pool.query(
        `SELECT schedule_out FROM employees WHERE id = $1`,
        [employeeId]
      );
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

      // Previous sessions
      const prevDaily = await pool.query(
        `SELECT session_hours FROM attendance
         WHERE employee_id = $1 AND DATE(timestamp) = CURRENT_DATE`,
        [employeeId]
      );
      const prevWeekly = await pool.query(
        `SELECT session_hours FROM attendance
         WHERE employee_id = $1
           AND DATE_PART('week', timestamp) = DATE_PART('week', CURRENT_DATE)
           AND DATE_PART('year', timestamp) = DATE_PART('year', CURRENT_DATE)`,
        [employeeId]
      );
      const prevMonthly = await pool.query(
        `SELECT session_hours FROM attendance
         WHERE employee_id = $1
           AND DATE_TRUNC('month', timestamp) = DATE_TRUNC('month', CURRENT_DATE)`,
        [employeeId]
      );

      const dailyTotalSec =
        sessionSeconds +
        prevDaily.rows.reduce((sum, r) => sum + parseHoursStrToSeconds(r.session_hours), 0);
      const weeklyTotalSec =
        sessionSeconds +
        prevWeekly.rows.reduce((sum, r) => sum + parseHoursStrToSeconds(r.session_hours), 0);
      const monthlyTotalSec =
        sessionSeconds +
        prevMonthly.rows.reduce((sum, r) => sum + parseHoursStrToSeconds(r.session_hours), 0);

      const dailyHoursStr = formatHours(dailyTotalSec);
      const weeklyHoursStr = formatHours(weeklyTotalSec);
      const monthlyHoursStr = formatHours(monthlyTotalSec);

      const insertResult = await pool.query(
        `INSERT INTO attendance
          (employee_id, timestamp, image_url, status, session_hours, overtime, remaining_hours, daily_hours, weekly_hours, monthly_hours)
         VALUES ($1, NOW() AT TIME ZONE 'Asia/Kolkata', $2, $3, $4, $5, $6, $7, $8, $9)
         RETURNING id, timestamp`,
        [
          employeeId,
          capturedUrl,
          status,
          sessionHours,
          overtime,
          remainingHours,
          dailyHoursStr,
          weeklyHoursStr,
          monthlyHoursStr,
        ]
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


    // ---------------- SUBADMIN LOGOUT ----------------
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

    // ---------------- ADMIN LOGOUT ----------------
    if (adminId) {
      // fetch last On Duty timestamp if needed
      const onDuty = await pool.query(
        `SELECT id, timestamp FROM attendance
         WHERE admin_id = $1 AND status = 'On Duty'
         ORDER BY timestamp DESC LIMIT 1`,
        [adminId]
      );

      let sessionHours = "0h 0m";
      if (onDuty.rows.length > 0) {
        const onDutyTime = onDuty.rows[0].timestamp;
        const sessionRes = await pool.query(
          `SELECT EXTRACT(EPOCH FROM (NOW() AT TIME ZONE 'Asia/Kolkata' - $1)) AS seconds`,
          [onDutyTime]
        );
        const sessionSeconds = parseInt(sessionRes.rows[0].seconds, 10);
        sessionHours = formatHours(sessionSeconds);
      }

      const insertResult = await pool.query(
        `INSERT INTO attendance (admin_id, timestamp, image_url, status, session_hours)
         VALUES ($1, NOW() AT TIME ZONE 'Asia/Kolkata', $2, $3, $4)
         RETURNING id, timestamp`,
        [adminId, capturedUrl, status, sessionHours]
      );

      return res.json({
        success: true,
        message: "Admin logout marked successfully",
        data: {
          admin_id: adminId,
          status,
          timestamp: insertResult.rows[0].timestamp,
          session_hours: sessionHours,
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



router.get("/logout/:employeeId", async (req, res) => {
  try {
    const { employeeId } = req.params;

    // Helper function: convert seconds → hours + minutes
    const formatHours = (seconds) => {
      const hrs = Math.floor(seconds / 3600);
      const mins = Math.floor((seconds % 3600) / 60);
      return `${hrs} hrs ${mins} mins`;
    };

    // 1️⃣ Fetch all "Off Duty" records for this employee
    const allRes = await pool.query(
      `SELECT employee_id, timestamp, session_hours, remaining_hours, overtime, image_url
       FROM attendance
       WHERE status = 'Off Duty' AND employee_id = $1
       ORDER BY timestamp DESC`,
      [employeeId]
    );

    if (allRes.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "No logout records found for this employee",
      });
    }

    // 2️⃣ Fetch daily "Off Duty" records
    const dailyRes = await pool.query(
      `SELECT employee_id, timestamp, session_hours, remaining_hours, overtime, image_url
       FROM attendance
       WHERE status = 'Off Duty' AND employee_id = $1
         AND DATE(timestamp) = CURRENT_DATE
       ORDER BY timestamp`,
      [employeeId]
    );

    // 3️⃣ Fetch weekly records
    const weeklyRes = await pool.query(
      `SELECT employee_id, timestamp, session_hours, remaining_hours, overtime, image_url
       FROM attendance
       WHERE status = 'Off Duty' AND employee_id = $1
         AND DATE_PART('week', timestamp) = DATE_PART('week', CURRENT_DATE)
         AND DATE_PART('year', timestamp) = DATE_PART('year', CURRENT_DATE)
       ORDER BY timestamp`,
      [employeeId]
    );

    // 4️⃣ Fetch monthly records
    const monthlyRes = await pool.query(
      `SELECT employee_id, timestamp, session_hours, remaining_hours, overtime, image_url
       FROM attendance
       WHERE status = 'Off Duty' AND employee_id = $1
         AND DATE_TRUNC('month', timestamp) = DATE_TRUNC('month', CURRENT_DATE)
       ORDER BY timestamp`,
      [employeeId]
    );

    // 5️⃣ Calculate total worked hours (daily / weekly / monthly)
    const [dailyTotal, weeklyTotal, monthlyTotal] = await Promise.all([
      pool.query(
        `SELECT COALESCE(SUM(EXTRACT(EPOCH FROM session_hours)), 0) AS total_seconds
         FROM attendance
         WHERE employee_id = $1
           AND status = 'Off Duty'
           AND DATE(timestamp) = CURRENT_DATE`,
        [employeeId]
      ),
      pool.query(
        `SELECT COALESCE(SUM(EXTRACT(EPOCH FROM session_hours)), 0) AS total_seconds
         FROM attendance
         WHERE employee_id = $1
           AND status = 'Off Duty'
           AND DATE_PART('week', timestamp) = DATE_PART('week', CURRENT_DATE)
           AND DATE_PART('year', timestamp) = DATE_PART('year', CURRENT_DATE)`,
        [employeeId]
      ),
      pool.query(
        `SELECT COALESCE(SUM(EXTRACT(EPOCH FROM session_hours)), 0) AS total_seconds
         FROM attendance
         WHERE employee_id = $1
           AND status = 'Off Duty'
           AND DATE_TRUNC('month', timestamp) = DATE_TRUNC('month', CURRENT_DATE)`,
        [employeeId]
      ),
    ]);

    const dailySeconds = Math.floor(parseFloat(dailyTotal.rows[0].total_seconds));
    const weeklySeconds = Math.floor(parseFloat(weeklyTotal.rows[0].total_seconds));
    const monthlySeconds = Math.floor(parseFloat(monthlyTotal.rows[0].total_seconds));

    const daily_hours = formatHours(dailySeconds);
    const weekly_hours = formatHours(weeklySeconds);
    const monthly_hours = formatHours(monthlySeconds);

    // ✅ Final response
    return res.json({
      success: true,
      message: "Fetched logout records with daily, weekly, and monthly summaries",
      data: {
        status: "Off Duty",
        totals: {
          daily_hours,
          weekly_hours,
          monthly_hours,
        },
        attendance: {
          all: allRes.rows,
          daily: dailyRes.rows,
          weekly: weeklyRes.rows,
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
    const { view = "weekly", month } = req.query;
    const today = new Date();
    let start, end;

    // 🔹 MONTHLY
    if (view === "monthly") {
      const monthInt = month ? parseInt(month, 10) - 1 : today.getMonth();
      start = new Date(today.getFullYear(), monthInt, 1);
      end = new Date(today.getFullYear(), monthInt + 1, 0);

    // 🔹 WEEKLY
    } else {
      const day = today.getDay();
      const diffToMonday = (day === 0 ? -6 : 1) - day;
      start = new Date(today);
      start.setDate(today.getDate() + diffToMonday);
      end = new Date(start);
      end.setDate(start.getDate() + 6);
    }

    const startStr = start.toISOString().split("T")[0];
    const endStr = end.toISOString().split("T")[0];

    // 🔥 UPDATED QUERY WITH leaves_duration & Pending + Approved
    const query = `
      SELECT 
        e.id AS employee_id,
        e.full_name AS employee_name,
        e.department,
        d::date AS date,

        MIN(a.timestamp) FILTER (WHERE a.status = 'On Duty') AS check_in,
        MAX(a.timestamp) FILTER (WHERE a.status = 'Off Duty') AS check_out,

        CASE 
          WHEN l.id IS NOT NULL THEN 
            COALESCE(l.leaves_duration, 'FullDay')  
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
        AND l.status IN ('approved')  -- 🔥 Accept pending leave also
        AND d BETWEEN l.start_date AND l.end_date

      GROUP BY e.id, e.full_name, e.department, d, l.leaves_duration, l.id
      ORDER BY e.full_name, d;
    `;

    const result = await pool.query(query, [startStr, endStr]);

    // -------------------------
    // PROCESS RESULT
    // -------------------------
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
        status: row.status,  // FullDay / FirstHalf / SecondHalf / Hourly / Present / Absent
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
      month: month || today.getMonth() + 1,
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