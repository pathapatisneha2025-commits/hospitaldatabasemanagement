const express = require("express");
const pool = require("../..//db"); // 2 levels up from AdminApis folder
const router = express.Router();

// =========================
// 1️ Break In / Break Out
// =========================
router.post("/breaks", async (req, res) => {
  try {
    const {
      employeeId,
      subadminId,
      capturedUrl,
      locationVerified,
      faceVerified,
      breakType,
    } = req.body;

    // ✅ Validate inputs
    if ((!employeeId && !subadminId) || !breakType) {
      return res.status(400).json({
        success: false,
        message: "Missing required fields",
      });
    }

    if (!["Break In", "Break Out"].includes(breakType)) {
      return res.status(400).json({
        success: false,
        message: "Invalid break type",
      });
    }

    // ✅ Correct status logic
    let status = "Rejected";

    if (breakType === "Break In") {
      if (locationVerified) {
        status = "On Break";
      }
    }

    if (breakType === "Break Out") {
      if (locationVerified && faceVerified) {
        status = "Returned";
      }
    }

    // ✅ Insert record
    await pool.query(
      `INSERT INTO break_logs 
       (employee_id, subadmin_id, break_type, timestamp, image_url, status)
       VALUES ($1, $2, $3, (NOW() AT TIME ZONE 'Asia/Kolkata'), $4, $5)`,
      [employeeId || null, subadminId || null, breakType, capturedUrl || null, status]
    );

    return res.json({
      success: true,
      message: `${breakType} logged successfully`,
      data: {
        employeeId: employeeId || null,
        subadminId: subadminId || null,
        breakType,
        status,
      },
    });
  } catch (error) {
    console.error("Break log error:", error.message);
    res.status(500).json({
      success: false,
      message: "Server error",
    });
  }
});



router.get("/employee/all", async (req, res) => {
  try {
    const result = await pool.query(
      `
      SELECT 
        b.id,
        b.employee_id,
        COALESCE(e.full_name, 'Unknown Employee') AS user_name,
        COALESCE(e.department, 'Unknown') AS department,
        b.break_type,
        b.timestamp,
        b.image_url,
        b.status
      FROM break_logs b
      LEFT JOIN employees e ON b.employee_id = e.id
      WHERE b.employee_id IS NOT NULL
      ORDER BY b.timestamp DESC
      `
    );

    res.json({
      success: true,
      count: result.rowCount,
      data: result.rows,
    });

  } catch (error) {
    console.error("Get employee breaks error:", error.message);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

/* =========================================================
   2️ GET ALL BREAK LOGS (Admin / HR view)
========================================================= */
router.get("/all", async (req, res) => {
  try {
    const result = await pool.query(
      `
      SELECT 
        b.id,
        b.employee_id,
        b.subadmin_id,
        COALESCE(e.full_name, s.name) AS user_name, -- ✅ Prefer employee name, fallback to subadmin name
        b.break_type,
        b.timestamp,
        b.image_url,
        b.status
      FROM break_logs b
      LEFT JOIN employees e ON b.employee_id = e.id
      LEFT JOIN subadmin s ON b.subadmin_id = s.id
      ORDER BY b.timestamp DESC
      `
    );

    res.json({
      success: true,
      count: result.rowCount,
      data: result.rows,
    });
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
router.put("/update", async (req, res) => {
  try {
    const { breakInId, breakOutId, status } = req.body;

    const validStatuses = ["On Break", "Returned", "Rejected"];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({ success: false, message: "Invalid status value" });
    }

    let updatedRows = [];

    // Update Break In
    if (breakInId) {
      const resultIn = await pool.query(
        `UPDATE break_logs SET status = $1 WHERE id = $2 RETURNING *`,
        [status, breakInId]
      );
      if (resultIn.rowCount > 0) updatedRows.push(resultIn.rows[0]);
    }

    // Update Break Out (if exists)
    if (breakOutId) {
      const resultOut = await pool.query(
        `UPDATE break_logs SET status = $1 WHERE id = $2 RETURNING *`,
        [status, breakOutId]
      );
      if (resultOut.rowCount > 0) updatedRows.push(resultOut.rows[0]);
    }

    if (updatedRows.length === 0) {
      return res.status(404).json({ success: false, message: "No matching records found" });
    }

    res.json({
      success: true,
      message: "Break log(s) updated successfully",
      data: updatedRows,
    });
  } catch (error) {
    console.error("Update break error:", error.message);
    res.status(500).json({ success: false, message: "Server error" });
  }
});


// PUT /BreakIn-attendance/update/:employee_id

router.put("/updatelogs/:employeeId", async (req, res) => {
  try {
    const { employeeId } = req.params;
    const { status } = req.body;

    // Convert employeeId to number safely
    const empId = parseInt(employeeId, 10);

    if (isNaN(empId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid employee_id format",
      });
    }

    const result = await pool.query(
      "UPDATE break_logs SET status = $1 WHERE employee_id = $2 RETURNING *",
      [status, empId]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({
        success: false,
        message: `No records found for employee_id ${empId}`,
      });
    }

    res.json({
      success: true,
      message: `All records updated successfully for employee_id ${empId}`,
      updatedCount: result.rowCount,
      updated: result.rows,
    });
  } catch (err) {
    console.error("❌ Update error:", err);
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
// DELETE both Break In and Break Out by employee_id
// ✅ DELETE /BreakIn-attendance/delete/:employee_id

router.delete("/deletelog/:employeeId", async (req, res) => {
  try {
    const { employeeId } = req.params;
const empId = parseInt(employeeId, 10);

const result = await pool.query(
  "DELETE FROM break_logs WHERE employee_id = $1 RETURNING *",
  [empId]
);


    console.log("🗑️ Deleted rows:", result.rowCount);

    if (result.rowCount === 0) {
      return res.status(404).json({
        success: false,
        message: `No break logs found for employee_id ${employeeId}`,
      });
    }

    res.json({
      success: true,
      message: `All break logs deleted successfully for employee_id ${employeeId}`,
      deletedCount: result.rowCount,
      deleted: result.rows,
    });
  } catch (error) {
    console.error("❌ Delete error:", error);
    res.status(500).json({ success: false, message: "Server error" });
  }
});




// =========================
// 5️ Summary: present, absent, on break, late (today)
// =========================
// router.get("/totalemployeescount", async (req, res) => {
//   try {
//     // 1️⃣ Total employees
//     const empResult = await pool.query(`
//       SELECT COUNT(*) AS total_employees
//       FROM employees
      
//     `);

//     // 2️⃣ Present (On Duty today)
//     const presentResult = await pool.query(`
//       SELECT COUNT(DISTINCT employee_id) AS total_present
//       FROM attendance
//       WHERE DATE(timestamp) = CURRENT_DATE
//         AND status = 'On Duty'
//     `);

//     // 3️⃣ On Leave today
//     const leaveResult = await pool.query(`
//       SELECT COUNT(DISTINCT employee_id) AS total_on_leave
//       FROM leaves
//       WHERE status = 'Approved'
//         AND CURRENT_DATE BETWEEN start_date AND end_date
//     `);

//     // 4️⃣ On Break
//     const breakResult = await pool.query(`
//       SELECT COUNT(DISTINCT employee_id) AS employees_on_break
//       FROM break_logs bl
//       WHERE break_type = 'Break In'
//         AND bl.status = 'On Break'
//         AND DATE(bl.timestamp) = CURRENT_DATE
//         AND NOT EXISTS (
//           SELECT 1
//           FROM break_logs bo
//           WHERE bo.employee_id = bl.employee_id
//             AND bo.break_type = 'Break Out'
//             AND DATE(bo.timestamp) = CURRENT_DATE
//             AND bo.timestamp > bl.timestamp
//         )
//     `);

//     const total_employees = Number(empResult.rows[0].total_employees);
//     const total_present = Number(presentResult.rows[0].total_present);
//     const total_on_leave = Number(leaveResult.rows[0].total_on_leave);

//     // 5️⃣ NEW LOGIC: ABSENT = (Total − Present − On Leave)
//     const total_absent = total_employees - total_present ;

//     return res.json({
//       success: true,
//       summary: {
//         total_employees,
//         total_present,
//         total_absent,
//         total_on_leave,
//         employees_on_break: breakResult.rows[0].employees_on_break
//       }
//     });

//   } catch (error) {
//     console.error("Attendance summary error:", error.message);
//     res.status(500).json({
//       success: false,
//       message: "Server error"
//     });
//   }
// });

// router.post("/employee-attendance-summary/:employeeId", async (req, res) => {
//   try {
//     const { employeeId } = req.params;
//     const { filter } = req.body; // now comes from body instead of query
//     let dateCondition = "";

//     // 🕒 Date range filter logic
//     if (filter === "weekly") {
//       dateCondition = `a.timestamp >= date_trunc('week', CURRENT_DATE)`;
//     } else if (filter === "monthly") {
//       dateCondition = `a.timestamp >= date_trunc('month', CURRENT_DATE)`;
//     } else {
//       dateCondition = `DATE(a.timestamp) = CURRENT_DATE`;
//     }

//     // 🧮 Total present, absent, and late counts for one employee
//     const attendanceResult = await pool.query(
//       `
//       SELECT 
//         COUNT(*) FILTER (WHERE a.status = 'On Duty') AS total_present,
//         COUNT(*) FILTER (WHERE a.status = 'Absent') AS total_absent,
//         COUNT(*) FILTER (
//           WHERE a.status = 'On Duty'
//             AND a.timestamp > (DATE(a.timestamp) + e.schedule_in)
//         ) AS total_late
//       FROM attendance a
//       JOIN employees e ON a.employee_id = e.id
//       WHERE e.id = $1
//         AND ${dateCondition};
//       `,
//       [employeeId]
//     );

//     // 🧘 Employee currently on break (only for daily)
//     let breakResult = { rows: [{ employees_on_break: 0 }] };
//     if (filter === "daily" || !filter) {
//       breakResult = await pool.query(
//         `
//         SELECT COUNT(DISTINCT employee_id) AS employees_on_break
//         FROM break_logs bl
//         WHERE bl.employee_id = $1
//           AND break_type = 'Break In'
//           AND bl.status = 'On Break'
//           AND DATE(bl.timestamp) = CURRENT_DATE
//           AND NOT EXISTS (
//             SELECT 1
//             FROM break_logs bo
//             WHERE bo.employee_id = bl.employee_id
//               AND bo.break_type = 'Break Out'
//               AND DATE(bo.timestamp) = CURRENT_DATE
//               AND bo.timestamp > bl.timestamp
//           )
//         `,
//         [employeeId]
//       );
//     }

//     // 🧰 Working days info
//     const workResult = await pool.query(
//       `
//       SELECT working_days 
//       FROM employee_working_days 
//       WHERE employee_id = $1 
//       LIMIT 1;
//       `,
//       [employeeId]
//     );

//     // ✅ Format and send final response
//     return res.json({
//       success: true,
//       period: filter || "daily",
//       summary: {
//         total_present: attendanceResult.rows[0]?.total_present || 0,
//         total_absent: attendanceResult.rows[0]?.total_absent || 0,
//         total_late: attendanceResult.rows[0]?.total_late || 0,
//         employees_on_break:
//           filter === "daily" || !filter
//             ? breakResult.rows[0]?.employees_on_break || 0
//             : null,
//         working_days: workResult.rows[0]?.working_days || null
//       }
//     });
//   } catch (error) {
//     console.error("Employee attendance summary error:", error.message);
//     res.status(500).json({ success: false, message: "Server error" });
//   }
// });
// 🔹 Total Employees Summary (including real-time login/logout)
router.get("/totalemployeescount", async (req, res) => {
  try {
    // 1️⃣ Total employees
    const empResult = await pool.query(`
      SELECT COUNT(*) AS total_employees
      FROM employees
    `);
    const total_employees = Number(empResult.rows[0].total_employees);

    // 2️⃣ Employees present today (last record On Duty) — match by employee_id OR phone
    const presentResult = await pool.query(`
      SELECT COUNT(DISTINCT e.id) AS total_present
      FROM attendance a
      JOIN employees e
        ON a.employee_id = e.id OR a.phone = e.mobile
      WHERE DATE(a.timestamp) = CURRENT_DATE
        AND a.status = 'On Duty'
    `);
    const total_present = Number(presentResult.rows[0].total_present);

    // 3️⃣ Employees on leave today
    const leaveResult = await pool.query(`
      SELECT COUNT(DISTINCT employee_id) AS total_on_leave
      FROM leaves
      WHERE status = 'Approved'
        AND CURRENT_DATE BETWEEN start_date AND end_date
    `);
    const total_on_leave = Number(leaveResult.rows[0].total_on_leave);

    // 4️⃣ Employees currently on break
    const breakResult = await pool.query(`
      SELECT COUNT(DISTINCT bl.employee_id) AS employees_on_break
      FROM break_logs bl
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
    `);

    // 5️⃣ Employees currently logged in (On Duty but not on break)
    const loggedInResult = await pool.query(`
      SELECT COUNT(*) AS logged_in
      FROM (
        SELECT DISTINCT e.id
        FROM attendance a
        JOIN employees e
          ON a.employee_id = e.id OR a.phone = e.mobile
        WHERE DATE(a.timestamp) = CURRENT_DATE
          AND a.status = 'On Duty'
          AND NOT EXISTS (
            SELECT 1
            FROM break_logs bl
            WHERE bl.employee_id = e.id
              AND bl.break_type = 'Break In'
              AND bl.status = 'On Break'
              AND DATE(bl.timestamp) = CURRENT_DATE
              AND bl.timestamp > a.timestamp
          )
      ) t
    `);
    const logged_in = Number(loggedInResult.rows[0].logged_in);

    // 6️⃣ Absents = total_employees − present − on_leave
    const total_absent = total_employees - total_present - total_on_leave;

    return res.json({
      success: true,
      summary: {
        total_employees,
        total_present,
        total_absent,
        total_on_leave,
        employees_on_break: Number(breakResult.rows[0].employees_on_break),
        logged_in,
        logged_out:
          total_employees -
          logged_in -
          Number(breakResult.rows[0].employees_on_break) -
          total_on_leave,
      },
    });
  } catch (error) {
    console.error("Attendance summary error:", error.message);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

// 🔹 Employee Attendance Summary (daily, weekly, monthly) + real-time status
router.post("/employee-attendance-summary/:employeeId", async (req, res) => {
  try {
    const { employeeId } = req.params;
    const { filter } = req.body; // daily / weekly / monthly
    let dateCondition = "";

    if (filter === "weekly") dateCondition = `a.timestamp >= date_trunc('week', CURRENT_DATE)`;
    else if (filter === "monthly") dateCondition = `a.timestamp >= date_trunc('month', CURRENT_DATE)`;
    else dateCondition = `DATE(a.timestamp) = CURRENT_DATE`;

    // Total present, absent, late for this employee or phone
    const attendanceResult = await pool.query(
      `
      SELECT 
        COUNT(*) FILTER (
          WHERE a.status = 'On Duty'
            AND (a.employee_id = $1 OR a.phone = (
              SELECT phone FROM employees WHERE id = $1 LIMIT 1
            ))
        ) AS total_present,
        COUNT(*) FILTER (
          WHERE a.status = 'Absent'
            AND (a.employee_id = $1 OR a.phone = (
              SELECT phone FROM employees WHERE id = $1 LIMIT 1
            ))
        ) AS total_absent,
        COUNT(*) FILTER (
          WHERE a.status = 'On Duty' 
            AND a.timestamp > (DATE(a.timestamp) + e.schedule_in)
            AND (a.employee_id = $1 OR a.phone = (
              SELECT phone FROM employees WHERE id = $1 LIMIT 1
            ))
        ) AS total_late
      FROM attendance a
      JOIN employees e ON e.id = $1
      WHERE ${dateCondition};
      `,
      [employeeId]
    );

    // Currently on break (only for daily)
    let breakResult = { rows: [{ employees_on_break: 0 }] };
    if (filter === "daily" || !filter) {
      breakResult = await pool.query(
        `
        SELECT COUNT(*) AS on_break
        FROM break_logs bl
        WHERE (bl.employee_id = $1 OR bl.phone = (SELECT phone FROM employees WHERE id = $1 LIMIT 1))
          AND bl.break_type = 'Break In'
          AND bl.status = 'On Break'
          AND DATE(bl.timestamp) = CURRENT_DATE
          AND NOT EXISTS (
            SELECT 1
            FROM break_logs bo
            WHERE (bo.employee_id = $1 OR bo.phone = (SELECT phone FROM employees WHERE id = $1 LIMIT 1))
              AND bo.break_type = 'Break Out'
              AND DATE(bo.timestamp) = CURRENT_DATE
              AND bo.timestamp > bl.timestamp
          )
        `,
        [employeeId]
      );
    }

    // Currently logged in (On Duty but not on break)
    const loggedInResult = await pool.query(
      `
      SELECT COUNT(*) AS logged_in
      FROM (
        SELECT DISTINCT COALESCE(a.employee_id, a.phone) AS emp
        FROM attendance a
        WHERE (a.employee_id = $1 OR a.phone = (SELECT phone FROM employees WHERE id = $1 LIMIT 1))
          AND DATE(a.timestamp) = CURRENT_DATE
          AND a.status = 'On Duty'
          AND NOT EXISTS (
            SELECT 1
            FROM break_logs bl
            WHERE COALESCE(bl.employee_id, bl.phone) = COALESCE(a.employee_id, a.phone)
              AND bl.break_type = 'Break In'
              AND bl.status = 'On Break'
              AND DATE(bl.timestamp) = CURRENT_DATE
              AND bl.timestamp > a.timestamp
          )
      ) t
      `,
      [employeeId]
    );

    // Working days info
    const workResult = await pool.query(
      `SELECT working_days FROM employee_working_days WHERE employee_id = $1 LIMIT 1`,
      [employeeId]
    );

    return res.json({
      success: true,
      period: filter || "daily",
      summary: {
        total_present: attendanceResult.rows[0]?.total_present || 0,
        total_absent: attendanceResult.rows[0]?.total_absent || 0,
        total_late: attendanceResult.rows[0]?.total_late || 0,
        employees_on_break:
          filter === "daily" || !filter ? breakResult.rows[0]?.on_break || 0 : null,
        logged_in: loggedInResult.rows[0]?.logged_in || 0,
        logged_out:
          (attendanceResult.rows[0]?.total_present || 0) - 
          (loggedInResult.rows[0]?.logged_in || 0),
        working_days: workResult.rows[0]?.working_days || null,
      },
    });
  } catch (error) {
    console.error("Employee attendance summary error:", error.message);
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
