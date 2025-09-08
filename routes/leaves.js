const express = require("express");
const router = express.Router();
const pool = require("../db"); // PostgreSQL pool connection

// POST API - Apply for Leave
router.post("/add", async (req, res) => {
  try {
    const {
      employee_id,        // 👈 new
      employee_name,
      department,
      leave_type,
      start_date,
      end_date,
      leave_hours,
      reason,
      status,
      leavestaken,        // 👈 existing
      leaves_duration,    // 👈 new
      salary_deduction    // 👈 new
    } = req.body;

    // Basic validation
    if (!employee_name || !department || !leave_type || !start_date || !end_date) {
      return res.status(400).json({ error: "All required fields must be provided." });
    }

    const query = `
      INSERT INTO leaves (
        employee_id,
        employee_name,
        department,
        leave_type,
        start_date,
        end_date,
        leave_hours,
        reason,
        status,
        leavestaken,
        leaves_duration,
        salary_deduction
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, COALESCE($9, 'Pending'), COALESCE($10, 0.0), $11, COALESCE($12, 0.00))
      RETURNING *;
    `;

    const values = [
      employee_id || null,
      employee_name,
      department,
      leave_type,
      start_date,
      end_date,
      leave_hours || null,
      reason || null,
      status,
      leavestaken,
      leaves_duration || null,
      salary_deduction
    ];

    const result = await pool.query(query, values);

    res.status(201).json({
      message: "Leave application submitted successfully.",
      leave: result.rows[0]
    });
  } catch (error) {
    console.error("Error adding leave:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/salary-deduction", async (req, res) => {
  try {
    const { employeeId, employeeName, leaveDuration, startDate, endDate } = req.body;

    // 1️⃣ Fetch employee salary
    const result = await pool.query(
      "SELECT monthly_salary FROM employees WHERE id = $1",
      [employeeId]
    );
    if (result.rows.length === 0)
      return res.status(404).json({ message: "Employee not found" });
    
    const monthlySalary = result.rows[0].monthly_salary;

    // 2️⃣ Fetch leave policy
    const policyResult = await pool.query(
      `SELECT number_of_leaves AS allowed_leaves
       FROM leave_policies
       WHERE employee_id = $1`,
      [employeeId]
    );
    if (policyResult.rows.length === 0)
      return res.status(404).json({ message: "No leave policy found" });
    
    const paidLeaves = parseInt(policyResult.rows[0].allowed_leaves, 10);

    // 3️⃣ Convert leave duration to days
    let equivalentLeaveDays = 0;
    const workingHoursPerDay = 10;
    if (leaveDuration.toLowerCase() === "hourly") {
      const hours = (new Date(endDate) - new Date(startDate)) / (1000 * 60 * 60);
      equivalentLeaveDays = hours / workingHoursPerDay;
    } else if (leaveDuration.toLowerCase() === "halfday") {
      equivalentLeaveDays = 0.5;
    } else {
      equivalentLeaveDays =
        (new Date(endDate).setHours(0,0,0,0) - new Date(startDate).setHours(0,0,0,0)) /
        (1000 * 60 * 60 * 24) + 1;
    }

    // 4️⃣ Already used leaves this month
    const leaveResult = await pool.query(
      `SELECT COALESCE(SUM(leavestaken),0.0) AS used_leaves
       FROM leaves
       WHERE employee_id = $1
         AND start_date >= date_trunc('month', CURRENT_DATE)
         AND start_date < (date_trunc('month', CURRENT_DATE) + interval '1 month')`,
      [employeeId]
    );
    const usedLeaves = parseFloat(leaveResult.rows[0].used_leaves);
    const totalUsedLeaves = usedLeaves + equivalentLeaveDays;

    // 5️⃣ Remaining paid leaves
    const remainingPaidLeaves = Math.max(paidLeaves - totalUsedLeaves, 0);

    // 6️⃣ Fetch leave status for this period
    const leaveStatusResult = await pool.query(
      `SELECT status
       FROM leaves
       WHERE employee_id = $1 AND start_date = $2 AND end_date = $3
       LIMIT 1`,
      [employeeId, startDate, endDate]
    );
    const leaveStatus = leaveStatusResult.rows.length > 0
      ? leaveStatusResult.rows[0].status
      : "pending"; // default if no record

    // 7️⃣ Deduction slab
    let deductionPerDay = 0, unauthorizedPenalty = 0;
    if (monthlySalary >= 4500 && monthlySalary <= 7500) {
      deductionPerDay = 700; unauthorizedPenalty = 35;
    } else if (monthlySalary >= 7501 && monthlySalary <= 9500) {
      deductionPerDay = 1400; unauthorizedPenalty = 70;
    } else if (monthlySalary >= 9501) {
      deductionPerDay = 2800; unauthorizedPenalty = 105;
    }

    // 8️⃣ Always calculate unpaid days deduction
    const unpaidDays = Math.max(totalUsedLeaves - paidLeaves, 0);
    let salaryDeduction = deductionPerDay * unpaidDays;

    // 9️⃣ Calculate unauthorized leave penalty if leave is cancelled
    let UnauthorizedLeaves = 0;
    let unauthorizedPenaltyTotal = 0;

    if (leaveStatus.toLowerCase() === "cancelled") {
      if (leaveDuration.toLowerCase() === "hourly") {
        // Unauthorized hours treated as fraction of a day
        const hours = (new Date(endDate) - new Date(startDate)) / (1000 * 60 * 60);
        UnauthorizedLeaves = hours / workingHoursPerDay;
      } else if (leaveDuration.toLowerCase() === "halfday") {
        UnauthorizedLeaves = 0.5;
      } else {
        // Count Off Duty days from attendance for multiple/full days
        const attendanceResult = await pool.query(
          `SELECT COUNT(*) AS off_duty_days
           FROM attendance
           WHERE employee_id = $1
             AND status ILIKE 'Off Duty'
             AND timestamp >= $2::date
             AND timestamp < ($3::date + interval '1 day')`,
          [employeeId, startDate, endDate]
        );

        UnauthorizedLeaves = parseInt(attendanceResult.rows[0].off_duty_days, 10) || 0;
      }

      unauthorizedPenaltyTotal = UnauthorizedLeaves * unauthorizedPenalty;
    }

    // 🔟 Total penalty
    const totalPenalty = salaryDeduction + unauthorizedPenaltyTotal;

    // 11️⃣ Return response
    res.json({
      employeeId,
      employeeName,
      monthlySalary,
      paidLeaves,
      usedLeaves,
      remainingPaidLeaves,
      deductionPerDay,
      unauthorizedPenalty,
      unpaidDays,
      salaryDeduction,
      UnauthorizedLeaves,
      unauthorizedPenaltyTotal,
      totalPenalty,
      leaveStatus
    });

  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Error calculating salary deduction" });
  }
});







// GET leaves by employee ID without storing employee_id in leaves table (based on full_name)
router.get("/by-employee/:id", async (req, res) => {
  try {
    const { id } = req.params;

    // 1️⃣ Get leave records ordered by start_date
    const leaveQuery = `
      SELECT l.*
      FROM leaves l
      JOIN employees e ON e.full_name = l.employee_name
      WHERE e.id = $1
      ORDER BY l.start_date, l.id;
    `;
    const leaveResult = await pool.query(leaveQuery, [id]);

    if (leaveResult.rows.length === 0) {
      return res.status(404).json({ message: "No leave records found for this employee." });
    }

    // 2️⃣ Allowed leaves
    const policyQuery = `
      SELECT number_of_leaves AS allowed_leaves
      FROM leave_policies
      WHERE employee_id = $1;
    `;
    const policyResult = await pool.query(policyQuery, [id]);
    const allowedLeaves = policyResult.rows.length > 0 ? policyResult.rows[0].allowed_leaves : 0;

    // 3️⃣ Calculate unpaid days per leave
    let cumulativeUsed = 0;
    const leavesWithUnpaid = leaveResult.rows.map((leave) => {
      const leaveTaken = parseFloat(leave.leavestaken);

      cumulativeUsed += leaveTaken;

      // Unpaid days = cumulative used - allowed (cumulative), capped to leaveTaken
      let unpaid_days = Math.max(cumulativeUsed - allowedLeaves, 0);
      unpaid_days = unpaid_days > leaveTaken ? leaveTaken : unpaid_days;

      // Optional: round to 2 decimals
      unpaid_days = parseFloat(unpaid_days.toFixed(2));

      return { ...leave, unpaid_days };
    });

    // 4️⃣ Total monthly used leaves
    const usedLeavesMonth = leaveResult.rows.reduce((sum, l) => sum + parseFloat(l.leavestaken), 0);

    // 5️⃣ Total unpaid leaves
    const totalUnpaid = Math.max(usedLeavesMonth - allowedLeaves, 0);

    res.status(200).json({
      message: "Leave records fetched successfully.",
      allowedLeaves,
      usedLeavesMonth,
      unpaidLeaves: totalUnpaid,
      leaves: leavesWithUnpaid
    });
  } catch (error) {
    console.error("Error fetching leaves by employee ID:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});


//  READ ALL - Get all leaves
router.get("/all", async (req, res) => {
  try {
    const result = await pool.query("SELECT * FROM leaves ORDER BY start_date DESC");
    res.status(200).json({
      message: "All leaves fetched successfully.",
      leaves: result.rows,
    });
  } catch (error) {
    console.error("Error fetching all leaves:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});
// POST - Update Leave Status
// POST - Update Leave Status
router.post("/update-status", async (req, res) => {
  try {
    const { id, status } = req.body; // ✅ get id from body

  

    const query = `
      UPDATE leaves 
      SET status = $1 
      WHERE id = $2 
      RETURNING *;
    `;

    const result = await pool.query(query, [status, id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Leave not found." });
    }

    res.status(200).json({
      message: `Leave status updated to ${status}.`,
      leave: result.rows[0],
    });
  } catch (error) {
    console.error("Error updating leave status:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});
// DELETE - Remove a leave by ID
router.delete("/delete/:id", async (req, res) => {
  try {
    const { id } = req.params;

    const query = `
      DELETE FROM leaves
      WHERE id = $1
      RETURNING *;
    `;

    const result = await pool.query(query, [id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Leave not found." });
    }

    res.status(200).json({
      message: "Leave deleted successfully.",
      deletedLeave: result.rows[0],
    });
  } catch (error) {
    console.error("Error deleting leave:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});


module.exports = router;
