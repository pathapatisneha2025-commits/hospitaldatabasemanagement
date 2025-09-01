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
    const { employeeId, employeeName, department, leaveDuration, startDate, endDate } = req.body;

    // ✅ Fetch employee salary using employeeId
    const result = await pool.query(
      "SELECT monthly_salary FROM employees WHERE id = $1",
      [employeeId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: "Employee not found" });
    }

    const monthlySalary = result.rows[0].monthly_salary;

    // ✅ Calculate working days in current month
    const today = new Date();
    const year = today.getFullYear();
    const month = today.getMonth();
    const totalDaysInMonth = new Date(year, month + 1, 0).getDate();
    const workingDays = totalDaysInMonth - 4; // Excluding weekly offs
    const workingHoursPerDay = 10;

    // ✅ Fetch leave policy using department
const policyResult = await pool.query(
      `SELECT number_of_leaves AS allowed_leaves
       FROM leave_policies
       WHERE employee_id = $1`,
      [employeeId]
    );

    if (policyResult.rows.length === 0) {
      return res.status(404).json({ message: "No leave policy found for this department" });
    }

    const paidLeaves = parseInt(policyResult.rows[0].allowed_leaves, 10);

    let equivalentLeaveDays = 0;

    // 🔹 Convert leave duration into days
    if (leaveDuration.toLowerCase() === "hourly") {
      const hours = (new Date(endDate) - new Date(startDate)) / (1000 * 60 * 60);
      equivalentLeaveDays = hours / workingHoursPerDay;
    } else if (leaveDuration.toLowerCase() === "halfday") {
      equivalentLeaveDays = 0.5;
    } else if (leaveDuration.toLowerCase() === "fullday") {
      equivalentLeaveDays =
        (new Date(endDate).setHours(0, 0, 0, 0) - new Date(startDate).setHours(0, 0, 0, 0)) /
          (1000 * 60 * 60 * 24) +
        1;
    } else if (leaveDuration.toLowerCase() === "multipleday") {
      equivalentLeaveDays =
        (new Date(endDate).setHours(0, 0, 0, 0) - new Date(startDate).setHours(0, 0, 0, 0)) /
          (1000 * 60 * 60 * 24) +
        1;
    }

    // 🔹 Get leaves already taken this month
    const leaveResult = await pool.query(
      `SELECT COALESCE(SUM(leavestaken), 0.0) as used_leaves
       FROM leaves 
       WHERE employee_id = $1
         AND start_date >= date_trunc('month', CURRENT_DATE)
         AND start_date < (date_trunc('month', CURRENT_DATE) + interval '1 month')`,
      [employeeId]
    );

    const usedLeaves = parseFloat(leaveResult.rows[0].used_leaves);
    const totalUsedLeaves = usedLeaves + equivalentLeaveDays;

    // Remaining paid leaves
    const remainingPaidLeaves = Math.max(paidLeaves - totalUsedLeaves, 0);

    let unpaidDays = 0;
    let salaryDeduction = 0;
    let deductionPerDay = 0; // ✅ initialize

    if (totalUsedLeaves > paidLeaves) {
      unpaidDays = totalUsedLeaves - paidLeaves;

      // ✅ Deduction slab
      if (monthlySalary >= 4500 && monthlySalary <= 7500) {
        deductionPerDay = 700;
      } else if (monthlySalary >= 7501 && monthlySalary <= 9500) {
        deductionPerDay = 1400;
      } else if (monthlySalary >= 9501) {
        deductionPerDay = 2800;
      }

      // ✅ Direct per-day deduction
      salaryDeduction = deductionPerDay * unpaidDays;
    }

    res.json({
      employeeId,
      employeeName,
      department,
      monthlySalary,
      workingDays,   // ✅ kept in response
      equivalentLeaveDays,
      usedLeaves,
      totalUsedLeaves,
      remainingPaidLeaves,
      paidLeaves,
      unpaidDays,
      deductionPerDay, // ✅ added to response
      salaryDeduction,
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

    const query = `
      SELECT l.*
      FROM leaves l
      JOIN employees e ON e.full_name = l.employee_name
      WHERE e.id = $1;
    `;

    const result = await pool.query(query, [id]);

    if (result.rows.length === 0) {
      return res.status(404).json({
        message: "No leave records found for this employee."
      });
    }

    res.status(200).json({
      message: "Leave records fetched successfully.",
      leaves: result.rows
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
