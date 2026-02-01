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
const { Parser } = require("json2csv");
const ExcelJS = require("exceljs");
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

router.post("/verify-face", upload.single("image"), async (req, res) => {
  try {
    const employeeId = req.body.employeeId
      ? parseInt(req.body.employeeId, 10)
      : null;
    const subadminId = req.body.subadminId
      ? parseInt(req.body.subadminId, 10)
      : null;
    const adminId = req.body.adminId
      ? parseInt(req.body.adminId, 10)
      : null;
    const phone = req.body.phone || null;
    const file = req.file;

    // ✅ Require image
    if (!file) {
      return res.status(400).json({
        success: false,
        message: "Image required",
      });
    }

    // ✅ Require at least ONE identifier
    if (!employeeId && !subadminId && !adminId && !phone) {
      return res.status(400).json({
        success: false,
        message: "Employee ID or phone required",
      });
    }

    const capturedUrl = file.path;

    // --------------------------------------------------
    // 🔍 RESOLVE REGISTERED IMAGE
    // --------------------------------------------------
    let registeredUrl = null;
    let resolvedEmployeeId = null;

    // 1️⃣ EMPLOYEE ID
    if (employeeId) {
      const empRes = await pool.query(
        "SELECT id, image FROM employees WHERE id = $1",
        [employeeId]
      );

      if (empRes.rowCount === 0) {
        return res.status(404).json({
          success: false,
          message: "Employee not found",
        });
      }

      registeredUrl = empRes.rows[0].image;
      resolvedEmployeeId = empRes.rows[0].id;
    }

    // 2️⃣ PHONE → EMPLOYEE
   else if (phone) {
  const empRes = await pool.query(
    "SELECT id, image FROM employees WHERE mobile = $1",
    [phone]
  );

  if (empRes.rowCount === 0) {
    return res.status(404).json({
      success: false,
      message: "No employee registered with this phone",
    });
  }

  registeredUrl = empRes.rows[0].image;
  resolvedEmployeeId = empRes.rows[0].id;
}


    // 3️⃣ SUBADMIN
    else if (subadminId) {
      const subRes = await pool.query(
        "SELECT image FROM subadmin WHERE id = $1",
        [subadminId]
      );

      if (subRes.rowCount === 0) {
        return res.status(404).json({
          success: false,
          message: "Subadmin not found",
        });
      }

      registeredUrl = subRes.rows[0].image;
    }

    // 4️⃣ ADMIN
    else if (adminId) {
      const adminRes = await pool.query(
        "SELECT image FROM admin WHERE id = $1",
        [adminId]
      );

      if (adminRes.rowCount === 0) {
        return res.status(404).json({
          success: false,
          message: "Admin not found",
        });
      }

      registeredUrl = adminRes.rows[0].image;
    }

    // --------------------------------------------------
    // ⬇️ DOWNLOAD IMAGES
    // --------------------------------------------------
    const [registeredImg, capturedImg] = await Promise.all([
      axios.get(registeredUrl, { responseType: "arraybuffer" }),
      axios.get(capturedUrl, { responseType: "arraybuffer" }),
    ]);

    // --------------------------------------------------
    // 🤖 AWS REKOGNITION
    // --------------------------------------------------
    const params = {
      SourceImage: { Bytes: Buffer.from(registeredImg.data) },
      TargetImage: { Bytes: Buffer.from(capturedImg.data) },
      SimilarityThreshold: 80,
    };

    const rekognitionResult = await rekognition
      .compareFaces(params)
      .promise();

    const faceVerified =
      rekognitionResult.FaceMatches &&
      rekognitionResult.FaceMatches.length > 0;

    // --------------------------------------------------
    // ✅ RESPONSE
    // --------------------------------------------------
    return res.json({
      success: true,
      faceVerified,
      message: faceVerified ? "Face verified" : "Face not verified",
      capturedUrl,
      employeeId: resolvedEmployeeId || employeeId || null,
      phone: phone || null,
    });
  } catch (error) {
    console.error("Face verification error:", error.message);
    res.status(500).json({
      success: false,
      message: "Server error",
    });
  }
});





// ✅ Location verification
const OFFICE_LAT = 17.677825;
const OFFICE_LNG = 83.198960;
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
  const {
    employeeId,
    subadminId,
    adminId,
    phone,          // ✅ ADD PHONE
    latitude,
    longitude
  } = req.body;

  // Require at least ONE identifier
  if (
    (!employeeId && !subadminId && !adminId && !phone) ||
    latitude == null ||
    longitude == null
  ) {
    return res.status(400).json({
      success: false,
      message: "Missing coordinates or identifier",
    });
  }

  // Calculate distance
  const distance = getDistanceFromLatLonInMeters(
    latitude,
    longitude,
    OFFICE_LAT,
    OFFICE_LNG
  );

  const isVerified = distance <= RADIUS_IN_METERS;

  return res.json({
    success: true,
    locationVerified: isVerified,
    employeeId: employeeId || null,
    subadminId: subadminId || null,
    adminId: adminId || null,
    phone: phone || null,     // ✅ RETURN PHONE
    distance,
  });
});




// ✅ Mark attendance
router.post("/mark-attendance", async (req, res) => {
  try {
    const {
      employeeId,
      subadminId,
      adminId,
      phone,             // ✅ New field for quick attendance
      capturedUrl,
      locationVerified,
      faceVerified,
    } = req.body;

    if ((!employeeId && !subadminId && !adminId && !phone) || !capturedUrl) {
      return res
        .status(400)
        .json({ success: false, message: "Missing required fields" });
    }

    const status =
      locationVerified === true && faceVerified === true ? "On Duty" : "Absent";

    // Determine which ID or phone to use
    let columnToUse, valueToUse;

    if (employeeId) {
      columnToUse = "employee_id";
      valueToUse = employeeId;
    } else if (subadminId) {
      columnToUse = "subadmin_id";
      valueToUse = subadminId;
    } else if (adminId) {
      columnToUse = "admin_id";
      valueToUse = adminId;
    } else if (phone) {
      columnToUse = "phone";      // ✅ Store phone if employee not logged in
      valueToUse = phone;
    }

    // Insert attendance
    const insertResult = await pool.query(
      `INSERT INTO attendance (${columnToUse}, timestamp, image_url, status)
       VALUES ($1, (NOW() AT TIME ZONE 'Asia/Kolkata'), $2, $3)
       RETURNING id, ${columnToUse}, status, timestamp`,
      [valueToUse, capturedUrl, status]
    );

    const row = insertResult.rows[0];

    return res.json({
      success: true,
      message: "Attendance marked successfully",
      data: {
        employeeId: employeeId || null,
        subadminId: subadminId || null,
        adminId: adminId || null,
        phone: phone || null,      // ✅ Return phone if used
        status: row.status,
        timestamp: row.timestamp,
      },
    });
  } catch (error) {
    console.error("Mark attendance error:", error.message);
    res.status(500).json({ success: false, message: "Server error" });
  }
});


// ------------------------------------------------------
// ✅ ATTENDANCE EXPORT (CSV + EXCEL) WITH BREAK LOGS JOINED
// ------------------------------------------------------
router.get("/export", async (req, res) => {
  try {
    const format = req.query.format || "csv";

    // Query attendance with aggregated break logs
    const query = `
      SELECT
        a.employee_id,
        e.full_name,
        a.status AS attendance_status,
        a.timestamp AS attendance_time,
        a.session_hours,
        COALESCE(STRING_AGG(bl.break_type, ', ' ORDER BY bl.timestamp), '-') AS break_types,
        COALESCE(STRING_AGG(bl.status, ', ' ORDER BY bl.timestamp), '-') AS break_statuses,
        COALESCE(STRING_AGG(bl.timestamp::text, ', ' ORDER BY bl.timestamp), '-') AS break_times
      FROM attendance a
      LEFT JOIN employees e ON e.id = a.employee_id
      LEFT JOIN break_logs bl 
        ON bl.employee_id = a.employee_id
        AND DATE(bl.timestamp) = DATE(a.timestamp)
      GROUP BY a.employee_id, e.full_name, a.status, a.timestamp, a.session_hours
      ORDER BY a.employee_id, a.timestamp;
    `;

    const result = await pool.query(query);

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "No attendance records found",
      });
    }

    // Map rows to export-friendly format
    const rows = result.rows.map((r) => ({
      employee_id: r.employee_id,
      name: r.full_name,
      attendance_status: r.attendance_status,
      attendance_time: r.attendance_time,
      total_hours: r.session_hours || 0,
      break_types: r.break_types,
      break_statuses: r.break_statuses,
      break_times: r.break_times,
    }));

    if (format === "csv") {
      const fields = [
        { label: "Employee ID", value: "employee_id" },
        { label: "Name", value: "name" },
        { label: "Attendance Status", value: "attendance_status" },
        { label: "Attendance Time", value: "attendance_time" },
        { label: "Total Hours", value: "total_hours" },
        { label: "Break Types", value: "break_types" },
        { label: "Break Statuses", value: "break_statuses" },
        { label: "Break Times", value: "break_times" },
      ];

      const parser = new Parser({ fields });
      const csv = parser.parse(rows);

      const fileName = `attendance_${Date.now()}.csv`;
      res.header("Content-Type", "text/csv");
      res.attachment(fileName);
      return res.send(csv);
    }

    res.status(400).json({
      success: false,
      message: "Unsupported export format. Only 'csv' is supported.",
    });
  } catch (error) {
    console.error("Export Error:", error);
    res.status(500).json({ success: false, message: "Export failed" });
  }
});


 // ✅ Fetch all "On Duty" attendance records
// router.get("/login/all", async (req, res) => {
//   try {
//     const result = await pool.query(`
//       SELECT 
//         a.id, 
//         a.employee_id, 
//         e.full_name, 
//         a.timestamp, 
//         a.image_url, 
//         a.status
//       FROM attendance a
//       JOIN employees e ON a.employee_id = e.id
//       WHERE a.status = 'On Duty'
//       ORDER BY a.timestamp DESC
//     `);

//     if (result.rows.length === 0) {
//       return res.status(404).json({
//         success: false,
//         message: "No 'On Duty' attendance records found",
//       });
//     }

//     return res.json({
//       success: true,
//       count: result.rows.length,
//       data: result.rows,
//     });
//   } catch (error) {
//     console.error("Get all On Duty attendance error:", error.message);
//     res.status(500).json({
//       success: false,
//       message: "Server error",
//     });
//   }
// });

// ✅ Fetch all "On Duty" attendance records (ID + Phone based)
router.get("/login/all", async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT 
        a.id,
        a.employee_id,
        a.phone,
        (a.timestamp AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Kolkata') AS timestamp,
        a.status,
        COALESCE(e1.full_name, e2.full_name, 'Unknown Employee') AS full_name,
        COALESCE(e1.image, e2.image, a.image_url) AS image_url
      FROM attendance a
      LEFT JOIN employees e1 ON e1.id = a.employee_id
      LEFT JOIN employees e2 ON e2.mobile = a.phone
      WHERE a.status = 'On Duty'
      ORDER BY a.timestamp DESC
    `);

    res.json({
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
            phone,          // added phone

      subadminId,
      adminId,
      capturedUrl,
      locationVerified,
      faceVerified,
    } = req.body;

    if ((!employeeId && !phone && !subadminId && !adminId) || !capturedUrl) {
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
 if (employeeId || phone) {
      let onDuty;
      if (employeeId) {
        onDuty = await pool.query(
          `SELECT id, timestamp FROM attendance
           WHERE employee_id = $1 AND status = 'On Duty'
           ORDER BY timestamp DESC LIMIT 1`,
          [employeeId]
        );
      } else if (phone) {
        onDuty = await pool.query(
          `SELECT id, timestamp FROM attendance
           WHERE phone = $1 AND status = 'On Duty'
           ORDER BY timestamp DESC LIMIT 1`,
          [phone]
        );
      }

      if (onDuty.rows.length === 0) {
        return res.json({
          success: true,
          message: "Logout marked (no On Duty found for employee).",
          data: { employee_id: employeeId || null, phone: phone || null, status },
        });
      }

      const onDutyTime = onDuty.rows[0].timestamp;

      // Current session worked time
      const sessionRes = await pool.query(
        `SELECT EXTRACT(EPOCH FROM (NOW() AT TIME ZONE 'Asia/Kolkata' - $1)) AS seconds`,
        [onDutyTime]
      );
      const sessionSeconds = parseInt(sessionRes.rows[0].seconds, 10);
      const sessionHours = formatHours(sessionSeconds);

      // Previous sessions totals
      const fetchPrevSessions = async (query, param) => {
        const res = await pool.query(query, [param]);
        return res.rows.reduce((sum, r) => sum + parseHoursStrToSeconds(r.session_hours), 0);
      };

      let paramId = employeeId || phone;

      const dailyTotalSec = sessionSeconds + await fetchPrevSessions(
        employeeId
          ? `SELECT session_hours FROM attendance WHERE employee_id = $1 AND DATE(timestamp) = CURRENT_DATE`
          : `SELECT session_hours FROM attendance WHERE phone = $1 AND DATE(timestamp) = CURRENT_DATE`,
        paramId
      );
      const weeklyTotalSec = sessionSeconds + await fetchPrevSessions(
        employeeId
          ? `SELECT session_hours FROM attendance WHERE employee_id = $1 AND DATE_PART('week', timestamp) = DATE_PART('week', CURRENT_DATE) AND DATE_PART('year', timestamp) = DATE_PART('year', CURRENT_DATE)`
          : `SELECT session_hours FROM attendance WHERE phone = $1 AND DATE_PART('week', timestamp) = DATE_PART('week', CURRENT_DATE) AND DATE_PART('year', timestamp) = DATE_PART('year', CURRENT_DATE)`,
        paramId
      );
      const monthlyTotalSec = sessionSeconds + await fetchPrevSessions(
        employeeId
          ? `SELECT session_hours FROM attendance WHERE employee_id = $1 AND DATE_TRUNC('month', timestamp) = DATE_TRUNC('month', CURRENT_DATE)`
          : `SELECT session_hours FROM attendance WHERE phone = $1 AND DATE_TRUNC('month', timestamp) = DATE_TRUNC('month', CURRENT_DATE)`,
        paramId
      );

      const dailyHoursStr = formatHours(dailyTotalSec);
      const weeklyHoursStr = formatHours(weeklyTotalSec);
      const monthlyHoursStr = formatHours(monthlyTotalSec);

      // Insert logout record
      const insertResult = await pool.query(
        `INSERT INTO attendance
          (employee_id, phone, timestamp, image_url, status, session_hours, daily_hours, weekly_hours, monthly_hours)
         VALUES ($1, $2, NOW() AT TIME ZONE 'Asia/Kolkata', $3, $4, $5, $6, $7, $8)
         RETURNING id, timestamp`,
        [
          employeeId || null,
          phone || null,
          capturedUrl,
          status,
          sessionHours,
          dailyHoursStr,
          weeklyHoursStr,
          monthlyHoursStr,
        ]
      );

      return res.json({
        success: true,
        message: "Employee logout marked successfully",
        data: {
          employee_id: employeeId || null,
          phone: phone || null,
          status,
          timestamp: insertResult.rows[0].timestamp,
          sessionHours,
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
    // 1️⃣ All Off Duty records (individual)
    const allRes = await pool.query(
      `SELECT 
         a.*,
         e.full_name
       FROM attendance a
       LEFT JOIN employees e ON e.id = a.employee_id
       WHERE a.status = 'Off Duty'
       ORDER BY a.timestamp DESC`
    );

    // 2️⃣ Daily totals
    const dailyRes = await pool.query(
      `SELECT
         a.employee_id,
         e.full_name,
         SUM(EXTRACT(EPOCH FROM (a.session_hours::interval))) AS total_seconds
       FROM attendance a
       LEFT JOIN employees e ON e.id = a.employee_id
       WHERE a.status = 'Off Duty'
         AND DATE(a.timestamp) = CURRENT_DATE
       GROUP BY a.employee_id, e.full_name
       ORDER BY e.full_name`
    );

    // 3️⃣ Monthly totals
    const monthlyRes = await pool.query(
      `SELECT
         a.employee_id,
         e.full_name,
         SUM(EXTRACT(EPOCH FROM (a.session_hours::interval))) AS total_seconds
       FROM attendance a
       LEFT JOIN employees e ON e.id = a.employee_id
       WHERE a.status = 'Off Duty'
         AND DATE_TRUNC('month', a.timestamp) = DATE_TRUNC('month', CURRENT_DATE)
       GROUP BY a.employee_id, e.full_name
       ORDER BY e.full_name`
    );
    const formatHours = (seconds) => {
  const hrs = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  return `${hrs}h ${mins}m`;
};

    // Convert seconds to "xh ym" strings
    const daily = dailyRes.rows.map(r => ({
      employee_id: r.employee_id,
      full_name: r.full_name,
      total_hours: formatHours(r.total_seconds)
    }));

    const monthly = monthlyRes.rows.map(r => ({
      employee_id: r.employee_id,
      full_name: r.full_name,
      total_hours: formatHours(r.total_seconds)
    }));

    return res.json({
      success: true,
      message: "Fetched all logout records with aggregated totals",
      data: {
        status: "Off Duty",
        attendance: {
          all: allRes.rows,
          daily,
          monthly,
        },
      },
    });
  } catch (error) {
    console.error("Get logout error:", error.message);
    res.status(500).json({ success: false, message: "Server error" });
  }
});



// router.get("/logout/:employeeId", async (req, res) => {
//   try {
//     const { employeeId } = req.params;

//     // Helper function: convert seconds → hours + minutes
//     const formatHours = (seconds) => {
//       const hrs = Math.floor(seconds / 3600);
//       const mins = Math.floor((seconds % 3600) / 60);
//       return `${hrs} hrs ${mins} mins`;
//     };

//     // 1️⃣ Fetch all "Off Duty" records for this employee
//     const allRes = await pool.query(
//       `SELECT employee_id, timestamp, session_hours, remaining_hours, overtime, image_url
//        FROM attendance
//        WHERE status = 'Off Duty' AND employee_id = $1
//        ORDER BY timestamp DESC`,
//       [employeeId]
//     );

//     if (allRes.rows.length === 0) {
//       return res.status(404).json({
//         success: false,
//         message: "No logout records found for this employee",
//       });
//     }

//     // 2️⃣ Fetch daily "Off Duty" records
//     const dailyRes = await pool.query(
//       `SELECT employee_id, timestamp, session_hours, remaining_hours, overtime, image_url
//        FROM attendance
//        WHERE status = 'Off Duty' AND employee_id = $1
//          AND DATE(timestamp) = CURRENT_DATE
//        ORDER BY timestamp`,
//       [employeeId]
//     );

//     // 3️⃣ Fetch weekly records
//     const weeklyRes = await pool.query(
//       `SELECT employee_id, timestamp, session_hours, remaining_hours, overtime, image_url
//        FROM attendance
//        WHERE status = 'Off Duty' AND employee_id = $1
//          AND DATE_PART('week', timestamp) = DATE_PART('week', CURRENT_DATE)
//          AND DATE_PART('year', timestamp) = DATE_PART('year', CURRENT_DATE)
//        ORDER BY timestamp`,
//       [employeeId]
//     );

//     // 4️⃣ Fetch monthly records
//     const monthlyRes = await pool.query(
//       `SELECT employee_id, timestamp, session_hours, remaining_hours, overtime, image_url
//        FROM attendance
//        WHERE status = 'Off Duty' AND employee_id = $1
//          AND DATE_TRUNC('month', timestamp) = DATE_TRUNC('month', CURRENT_DATE)
//        ORDER BY timestamp`,
//       [employeeId]
//     );

//     // 5️⃣ Calculate total worked hours (daily / weekly / monthly)
//     const [dailyTotal, weeklyTotal, monthlyTotal] = await Promise.all([
//       pool.query(
//         `SELECT COALESCE(SUM(EXTRACT(EPOCH FROM session_hours)), 0) AS total_seconds
//          FROM attendance
//          WHERE employee_id = $1
//            AND status = 'Off Duty'
//            AND DATE(timestamp) = CURRENT_DATE`,
//         [employeeId]
//       ),
//       pool.query(
//         `SELECT COALESCE(SUM(EXTRACT(EPOCH FROM session_hours)), 0) AS total_seconds
//          FROM attendance
//          WHERE employee_id = $1
//            AND status = 'Off Duty'
//            AND DATE_PART('week', timestamp) = DATE_PART('week', CURRENT_DATE)
//            AND DATE_PART('year', timestamp) = DATE_PART('year', CURRENT_DATE)`,
//         [employeeId]
//       ),
//       pool.query(
//         `SELECT COALESCE(SUM(EXTRACT(EPOCH FROM session_hours)), 0) AS total_seconds
//          FROM attendance
//          WHERE employee_id = $1
//            AND status = 'Off Duty'
//            AND DATE_TRUNC('month', timestamp) = DATE_TRUNC('month', CURRENT_DATE)`,
//         [employeeId]
//       ),
//     ]);

//     const dailySeconds = Math.floor(parseFloat(dailyTotal.rows[0].total_seconds));
//     const weeklySeconds = Math.floor(parseFloat(weeklyTotal.rows[0].total_seconds));
//     const monthlySeconds = Math.floor(parseFloat(monthlyTotal.rows[0].total_seconds));

//     const daily_hours = formatHours(dailySeconds);
//     const weekly_hours = formatHours(weeklySeconds);
//     const monthly_hours = formatHours(monthlySeconds);

//     // ✅ Final response
//     return res.json({
//       success: true,
//       message: "Fetched logout records with daily, weekly, and monthly summaries",
//       data: {
//         status: "Off Duty",
//         totals: {
//           daily_hours,
//           weekly_hours,
//           monthly_hours,
//         },
//         attendance: {
//           all: allRes.rows,
//           daily: dailyRes.rows,
//           weekly: weeklyRes.rows,
//           monthly: monthlyRes.rows,
//         },
//       },
//     });
//   } catch (error) {
//     console.error("Get logout by ID error:", error.message);
//     res.status(500).json({ success: false, message: "Server error" });
//   }
// });

router.get("/logout/:identifier", async (req, res) => {
  try {
    const { identifier } = req.params;

    // Detect phone vs employeeId
    const isPhone = /^\d{10}$/.test(identifier);

    const condition = isPhone
      ? "phone = $1"
      : "employee_id = $1";

    const value = identifier;

    // Helper: seconds → hrs mins
    const formatHours = (seconds) => {
      const hrs = Math.floor(seconds / 3600);
      const mins = Math.floor((seconds % 3600) / 60);
      return `${hrs} hrs ${mins} mins`;
    };

    // 🔹 All records
    const allRes = await pool.query(
      `SELECT employee_id, phone, timestamp, session_hours, remaining_hours, overtime, image_url
       FROM attendance
       WHERE status='Off Duty' AND ${condition}
       ORDER BY timestamp DESC`,
      [value]
    );

    if (!allRes.rows.length) {
      return res.status(404).json({
        success: false,
        message: "No logout records found",
      });
    }

    // 🔹 Daily / Weekly / Monthly lists
    const [dailyRes, weeklyRes, monthlyRes] = await Promise.all([
      pool.query(
        `SELECT * FROM attendance
         WHERE status='Off Duty' AND ${condition}
         AND DATE(timestamp) = CURRENT_DATE
         ORDER BY timestamp`,
        [value]
      ),
      pool.query(
        `SELECT * FROM attendance
         WHERE status='Off Duty' AND ${condition}
         AND DATE_PART('week', timestamp) = DATE_PART('week', CURRENT_DATE)
         AND DATE_PART('year', timestamp) = DATE_PART('year', CURRENT_DATE)
         ORDER BY timestamp`,
        [value]
      ),
      pool.query(
        `SELECT * FROM attendance
         WHERE status='Off Duty' AND ${condition}
         AND DATE_TRUNC('month', timestamp) = DATE_TRUNC('month', CURRENT_DATE)
         ORDER BY timestamp`,
        [value]
      ),
    ]);

    // 🔹 Totals
    const [dailyTotal, weeklyTotal, monthlyTotal] = await Promise.all([
      pool.query(
        `SELECT COALESCE(SUM(EXTRACT(EPOCH FROM session_hours)),0) total
         FROM attendance
         WHERE status='Off Duty' AND ${condition}
         AND DATE(timestamp)=CURRENT_DATE`,
        [value]
      ),
      pool.query(
        `SELECT COALESCE(SUM(EXTRACT(EPOCH FROM session_hours)),0) total
         FROM attendance
         WHERE status='Off Duty' AND ${condition}
         AND DATE_PART('week', timestamp)=DATE_PART('week', CURRENT_DATE)
         AND DATE_PART('year', timestamp)=DATE_PART('year', CURRENT_DATE)`,
        [value]
      ),
      pool.query(
        `SELECT COALESCE(SUM(EXTRACT(EPOCH FROM session_hours)),0) total
         FROM attendance
         WHERE status='Off Duty' AND ${condition}
         AND DATE_TRUNC('month', timestamp)=DATE_TRUNC('month', CURRENT_DATE)`,
        [value]
      ),
    ]);

    // ✅ Final response
    res.json({
      success: true,
      status: "Off Duty",
      totals: {
        daily_hours: formatHours(dailyTotal.rows[0].total),
        weekly_hours: formatHours(weeklyTotal.rows[0].total),
        monthly_hours: formatHours(monthlyTotal.rows[0].total),
      },
      attendance: {
        all: allRes.rows,
        daily: dailyRes.rows,
        weekly: weeklyRes.rows,
        monthly: monthlyRes.rows,
      },
    });
  } catch (err) {
    console.error("Logout route error:", err.message);
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
      `SELECT a.id, a.employee_id, e.full_name, a.timestamp, a.image_url, a.status,a.phone
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