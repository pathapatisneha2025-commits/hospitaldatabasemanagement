const express = require("express");
const pool = require("../..//db"); // 2 levels up from AdminApis folder
const router = express.Router();

// =========================
// 1️ Break In / Break Out
// =========================
router.post("/breaks", async (req, res) => {
  try {
    const { employeeId, capturedUrl, locationVerified, faceVerified, breakType } = req.body;

    if (!employeeId || !capturedUrl || !breakType) {
      return res.status(400).json({ success: false, message: "Missing required fields" });
    }

    if (breakType !== "Break In" && breakType !== "Break Out") {
      return res.status(400).json({ success: false, message: "Invalid break type" });
    }

    const status =
      locationVerified === true && faceVerified === true
        ? breakType === "Break In"
          ? "On Break"
          : "Returned"
        : "Rejected";

    await pool.query(
      `INSERT INTO break_logs (employee_id, break_type, timestamp, image_url, status)
       VALUES ($1, $2, (NOW() AT TIME ZONE 'Asia/Kolkata'), $3, $4)`,
      [employeeId, breakType, capturedUrl, status]
    );

    return res.json({
      success: true,
      message: `${breakType} logged successfully`,
      data: { employeeId, breakType, status },
    });
  } catch (error) {
    console.error("Break log error:", error.message);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

// =========================
// 2️ Count employees on break (today)
// =========================
router.get("/breaks/count", async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT COUNT(DISTINCT employee_id) AS employees_on_break
      FROM break_logs bl
      WHERE break_type = 'Break In'
        AND status = 'On Break'
        AND DATE(bl.timestamp) = CURRENT_DATE
        AND NOT EXISTS (
          SELECT 1
          FROM break_logs bo
          WHERE bo.employee_id = bl.employee_id
            AND bo.break_type = 'Break Out'
            AND DATE(bo.timestamp) = CURRENT_DATE
            AND bo.timestamp > bl.timestamp
        )
    `);

    return res.json({
      success: true,
      employeesOnBreak: result.rows[0].employees_on_break,
    });
  } catch (error) {
    console.error("Count employees on break error:", error.message);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

// =========================
// 3️ List employees currently on break (today)
// =========================
router.get("/breaks/current", async (req, res) => {
  try {
    const { email } = req.query;

    let query = `
      SELECT e.id AS employee_id, e.name, e.email, bl.timestamp AS break_in_time, bl.image_url
      FROM break_logs bl
      JOIN employees e ON e.id = bl.employee_id
      WHERE bl.break_type = 'Break In'
        AND bl.status = 'On Break'
        AND DATE(bl.timestamp) = CURRENT_DATE
        AND NOT EXISTS (
          SELECT 1
          FROM break_logs bo
          WHERE bo.employee_id = bl.employee_id
            AND bo.break_type = 'Break Out'
            AND DATE(bo.timestamp) = CURRENT_DATE
            AND bo.timestamp > bl.timestamp
        )
    `;

    const params = [];
    if (email) {
      query += " AND e.email = $1";
      params.push(email);
    }

    query += " ORDER BY bl.timestamp ASC";

    const result = await pool.query(query, params);

    return res.json({
      success: true,
      employeesOnBreak: result.rows,
    });
  } catch (error) {
    console.error("List employees on break error:", error.message);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

module.exports = router;
