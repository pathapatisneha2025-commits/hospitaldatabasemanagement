const express = require("express");
const router = express.Router();
const pool = require("../db"); // PostgreSQL pool connection

// POST API - Apply for Leave
router.post("/add", async (req, res) => {
  try {
    const {
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
      salary_deduction,
    } = req.body;

    if (!employee_name || !department || !leave_type || !start_date || !end_date) {
      return res.status(400).json({ error: "All required fields must be provided." });
    }

    // 1️⃣ Insert new leave request
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
      salary_deduction,
    ];

    const leaveResult = await pool.query(query, values);
    const leave = leaveResult.rows[0];

    // 2️⃣ Insert notification message: "New leave request by {employee_name}"
    const notifResult = await pool.query(
      `INSERT INTO leavenotifications (employee_id, message, leave_id)
       VALUES ($1, $2, $3) RETURNING *`,
      [employee_id, `New leave request by ${employee_name}`, leave.id]
    );

    const notification = notifResult.rows[0];

    // 3️⃣ Push live notification via WebSocket if employee is online
    const ws = clients.get(employee_id.toString());
    if (ws && ws.readyState === ws.OPEN) {
      ws.send(
        JSON.stringify({
          type: "leaveRequest",
          notification,
        })
      );
    }

    //  Done
    res.status(201).json({
      message: "Leave application submitted successfully",
      leave,
      notification,
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
    const employeeResult = await pool.query(
      "SELECT monthly_salary FROM employees WHERE id = $1",
      [employeeId]
    );
    if (employeeResult.rows.length === 0)
      return res.status(404).json({ message: "Employee not found" });

    const monthlySalary = parseFloat(employeeResult.rows[0].monthly_salary);

    // 2️⃣ Get current month and total days in month
    const now = new Date();
    const currentMonth = now.toLocaleString("default", { month: "long" });
    const currentYear = now.getFullYear();
    const totalDaysInMonth = new Date(currentYear, now.getMonth() + 1, 0).getDate();

    // 3️⃣ Fetch working days for the employee from employee_working_days table
    const workResult = await pool.query(
      `SELECT working_days 
       FROM employee_working_days 
       WHERE employee_id = $1 AND month = $2 LIMIT 1`,
      [employeeId, `${currentMonth} ${currentYear}`]
    );

    let workingDays = 0;
    if (workResult.rows.length > 0) {
      workingDays = parseInt(workResult.rows[0].working_days, 10);
    } else {
      // Default fallback if no record found
      workingDays = totalDaysInMonth;
    }

    // 4️⃣ Calculate paid leaves = total days - working days
    const paidLeaves = totalDaysInMonth - workingDays;

    // 5️⃣ Convert leave duration to days
    let equivalentLeaveDays = 0;
    const workingHoursPerDay = 10;
    if (leaveDuration.toLowerCase() === "hourly") {
      const hours = (new Date(endDate) - new Date(startDate)) / (1000 * 60 * 60);
      equivalentLeaveDays = hours / workingHoursPerDay;
    } else if (leaveDuration.toLowerCase() === "firsthalf" || leaveDuration.toLowerCase() === "secondhalf") {
      equivalentLeaveDays = 0.5;
    } else {
      equivalentLeaveDays =
        (new Date(endDate).setHours(0,0,0,0) - new Date(startDate).setHours(0,0,0,0)) / (1000 * 60 * 60 * 24) + 1;
    }

    // 6️⃣ Calculate used leaves for this month
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

    // 7️⃣ Remaining paid leaves (based on working days logic)
    const remainingPaidLeaves = Math.max(paidLeaves - totalUsedLeaves, 0);

    // 8️⃣ Fetch leave status
    const leaveStatusResult = await pool.query(
      `SELECT status FROM leaves WHERE employee_id = $1 AND start_date = $2 AND end_date = $3 LIMIT 1`,
      [employeeId, startDate, endDate]
    );
    const leaveStatus = leaveStatusResult.rows.length > 0
      ? leaveStatusResult.rows[0].status
      : "pending";

    // 9️⃣ Fetch deduction details
    const deductionResult = await pool.query(
      `SELECT deduction_per_day, unauthorized_penalty
       FROM employee_leavededuction
       WHERE employee_id = $1
       LIMIT 1`,
      [employeeId]
    );

    let deductionPerDay = 0, unauthorizedPenalty = 0;
    if (deductionResult.rows.length > 0) {
      deductionPerDay = parseFloat(deductionResult.rows[0].deduction_per_day);
      unauthorizedPenalty = parseFloat(deductionResult.rows[0].unauthorized_penalty);
    }

    // 🔟 Calculate unpaid days and salary deduction
    const unpaidDays = Math.max(totalUsedLeaves - paidLeaves, 0);
    const salaryDeduction = deductionPerDay * unpaidDays;

    // 11️⃣ Unauthorized leave penalty
    let UnauthorizedLeaves = 0, unauthorizedPenaltyTotal = 0;
    if (leaveStatus.toLowerCase() === "cancelled") {
      UnauthorizedLeaves = equivalentLeaveDays;
      unauthorizedPenaltyTotal = UnauthorizedLeaves * unauthorizedPenalty;
    }

    const totalPenalty = salaryDeduction + unauthorizedPenaltyTotal;

    // 12️⃣ Final response
    res.json({
      employeeId,
      employeeName,
      month: `${currentMonth} ${currentYear}`,
      totalDaysInMonth,
      workingDays,
      paidLeaves,
      monthlySalary: monthlySalary.toFixed(2),
      usedLeaves: usedLeaves.toFixed(2),
      leavesTaken: totalUsedLeaves.toFixed(2),
      remainingPaidLeaves: remainingPaidLeaves.toFixed(2),
      deductionPerDay: deductionPerDay.toFixed(2),
      unauthorizedPenalty: unauthorizedPenalty.toFixed(2),
      unpaidDays: unpaidDays.toFixed(2),
      salaryDeduction: salaryDeduction.toFixed(2),
      UnauthorizedLeaves: UnauthorizedLeaves.toFixed(2),
      unauthorizedPenaltyTotal: unauthorizedPenaltyTotal.toFixed(2),
      totalPenalty: totalPenalty.toFixed(2),
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

    // 2️⃣ Get allowed leaves from policy
    const policyQuery = `
      SELECT number_of_leaves AS allowed_leaves
      FROM leave_policies
      WHERE employee_id = $1;
    `;
    const policyResult = await pool.query(policyQuery, [id]);
    const allowedLeaves = policyResult.rows.length > 0 ? policyResult.rows[0].allowed_leaves : 0;

    // 3️⃣ Calculate cumulative unpaid days per leave
    let cumulativeUsed = 0;
    const leavesWithUnpaid = leaveResult.rows.map((leave) => {
      const leaveTaken = parseFloat(leave.leavestaken);

      cumulativeUsed += leaveTaken;

      // Unpaid days = cumulative used - allowed leaves (cumulative)
      let unpaid_days = cumulativeUsed - allowedLeaves;
      unpaid_days = unpaid_days < 0 ? 0 : unpaid_days;
      unpaid_days = parseFloat(unpaid_days.toFixed(2));

      return { ...leave, unpaid_days };
    });

    // 4️⃣ Total monthly used leaves
    const usedLeavesMonth = leaveResult.rows.reduce((sum, l) => sum + parseFloat(l.leavestaken), 0);

    // 5️⃣ Total unpaid leaves (overall)
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
