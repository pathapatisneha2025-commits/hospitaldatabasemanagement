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

/* =========================================================
   2️ GET ALL BREAK LOGS (Admin / HR view)
========================================================= */
router.get("/all", async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, employee_id, break_type, timestamp, image_url, status
       FROM break_logs
       ORDER BY timestamp DESC`
    );
    res.json({ success: true, count: result.rowCount, data: result.rows });
  } catch (error) {
    console.error("Get breaks error:", error.message);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

/* =========================================================
   3️ GET BREAKS BY EMPLOYEE ID
========================================================= */
router.get("/employee/:employeeId", async (req, res) => {
  try {
    const { employeeId } = req.params;
    const result = await pool.query(
      `SELECT id, employee_id, break_type, timestamp, image_url, status
       FROM break_logs
       WHERE employee_id = $1
       ORDER BY timestamp DESC`,
      [employeeId]
    );

    if (result.rowCount === 0)
      return res.status(404).json({ success: false, message: "No break logs found" });

    res.json({ success: true, data: result.rows });
  } catch (error) {
    console.error("Get employee breaks error:", error.message);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

/* =========================================================
   5️ UPDATE BREAK STATUS (Manual admin correction)
========================================================= */
router.put("/update/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    const validStatuses = ["On Break", "Returned", "Rejected"];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({ success: false, message: "Invalid status value" });
    }

    const result = await pool.query(
      `UPDATE break_logs SET status = $1 WHERE id = $2 RETURNING *`,
      [status, id]
    );

    if (result.rowCount === 0)
      return res.status(404).json({ success: false, message: "Break log not found" });

    res.json({ success: true, message: "Break status updated", data: result.rows[0] });
  } catch (error) {
    console.error("Update break error:", error.message);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

/* =========================================================
   6️⃣ DELETE BREAK LOG (Admin only)
========================================================= */
router.delete("/delete/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query(`DELETE FROM break_logs WHERE id = $1 RETURNING *`, [id]);

    if (result.rowCount === 0)
      return res.status(404).json({ success: false, message: "Break log not found" });

    res.json({ success: true, message: "Break log deleted successfully" });
  } catch (error) {
    console.error("Delete break error:", error.message);
    res.status(500).json({ success: false, message: "Server error" });
  }
});
// =========================
// 5️ Summary: present, absent, on break, late (today)
// =========================
router.get("/totalemployeescount", async (req, res) => {
  try {
    // Count attendance (present / absent / late)
    const attendanceResult = await pool.query(`
      SELECT 
        COUNT(*) FILTER (WHERE a.status = 'On Duty') AS total_present,
        COUNT(*) FILTER (WHERE a.status = 'Absent') AS total_absent,
        COUNT(*) FILTER (
          WHERE a.status = 'On Duty'
            AND a.timestamp > (DATE(a.timestamp) + e.schedule_in)
        ) AS total_late
      FROM attendance a
      JOIN employees e ON a.employee_id = e.id
      WHERE DATE(a.timestamp) = CURRENT_DATE
    `);

    // Count employees currently on break
    const breakResult = await pool.query(`
      SELECT COUNT(DISTINCT employee_id) AS employees_on_break
      FROM break_logs bl
      WHERE break_type = 'Break In'
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
    `);

    return res.json({
      success: true,
      summary: {
        total_present: attendanceResult.rows[0].total_present,
        total_absent: attendanceResult.rows[0].total_absent,
        total_late: attendanceResult.rows[0].total_late,
        employees_on_break: breakResult.rows[0].employees_on_break
      }
    });
  } catch (error) {
    console.error("Attendance & break summary error:", error.message);
    res.status(500).json({ success: false, message: "Server error" });
  }
});




// =========================
// 3️ List employees currently on break ,present,absemnt,late based on department wise(today)
// =========================
router.get("/by-department", async (req, res) => {
  try {
    // 1️⃣ Fetch attendance data (join by department name)
    const attendanceQuery = `
      SELECT 
        d.id AS department_id,
        d.department_name,
        e.full_name,
        e.email,
        a.status,
        a.timestamp,
        e.schedule_in
      FROM attendance a
      JOIN employees e ON a.employee_id = e.id
      LEFT JOIN department d ON d.department_name = e.department
      WHERE DATE(a.timestamp) = CURRENT_DATE
      ORDER BY d.department_name, e.full_name
    `;
    const attendanceResult = await pool.query(attendanceQuery);

    // 2️⃣ Fetch employees currently on break (join by department name)
    const breakQuery = `
      SELECT 
        d.id AS department_id,
        d.department_name,
        e.full_name,
        e.email,
        bl.timestamp AS break_in_time
      FROM break_logs bl
      JOIN employees e ON e.id = bl.employee_id
      LEFT JOIN department d ON d.department_name = e.department
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
      ORDER BY d.department_name, bl.timestamp ASC
    `;
    const breakResult = await pool.query(breakQuery);

    // 3️⃣ Group attendance by department and status
    const groupedData = {
      present: {},
      absent: {},
      late: {}
    };

    attendanceResult.rows.forEach(row => {
      const deptKey = row.department_name;

      // Initialize department objects if not exists
      ['present', 'absent', 'late'].forEach(status => {
        if (!groupedData[status][deptKey]) {
          groupedData[status][deptKey] = {
            department_id: row.department_id,
            department_name: row.department_name,
            employees: []
          };
        }
      });

      // Categorize attendance
      if (row.status === 'Absent') {
        groupedData.absent[deptKey].employees.push({
          full_name: row.full_name,
          email: row.email
        });
      } else if (row.status === 'On Duty' && row.onduty_timestamp > row.schedule_in) {
        groupedData.late[deptKey].employees.push({
          full_name: row.full_name,
          email: row.email
        });
      } else if (row.status === 'On Duty') {
        groupedData.present[deptKey].employees.push({
          full_name: row.full_name,
          email: row.email
        });
      }
    });

    // 4️⃣ Group breaks by department
    const breaksByDepartment = {};
    breakResult.rows.forEach(row => {
      const deptKey = row.department_name;
      if (!breaksByDepartment[deptKey]) {
        breaksByDepartment[deptKey] = {
          department_id: row.department_id,
          department_name: row.department_name,
          employees: []
        };
      }
      breaksByDepartment[deptKey].employees.push({
        full_name: row.full_name,
        email: row.email,
        break_in_time: row.break_in_time
      });
    });

    return res.json({
      success: true,
      present: Object.values(groupedData.present),
      absent: Object.values(groupedData.absent),
      late: Object.values(groupedData.late),
      employeesOnBreak: Object.values(breaksByDepartment)
    });
  } catch (error) {
    console.error("Department-wise attendance & break error:", error.message);
    res.status(500).json({ success: false, message: "Server error" });
  }
});


router.get("/late-employees-report", async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT 
        e.full_name,
        TO_CHAR(a.timestamp, 'YYYY-MM-DD') AS date,        -- format date only
        TO_CHAR(a.timestamp, 'HH24:MI') AS time,          -- format time HH:MM
        COUNT(*) OVER (PARTITION BY e.id) AS late_count   -- total times employee was late
      FROM attendance a
      JOIN employees e ON a.employee_id = e.id
      WHERE a.status = 'On Duty' 
        AND a.timestamp::time > e.schedule_in
      ORDER BY e.full_name, a.timestamp DESC
    `);

    res.json({
      success: true,
      data: result.rows
    });
  } catch (error) {
    console.error("Late employees report error:", error.message);
    res.status(500).json({ success: false, message: "Server error" });
  }
});



module.exports = router;
