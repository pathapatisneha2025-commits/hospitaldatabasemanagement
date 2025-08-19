const express = require("express");
const router = express.Router();
const pool = require("../db"); // PostgreSQL pool connection

// POST API - Apply for Leave
router.post("/add", async (req, res) => {
  try {
    const {
      employee_name,
      department,
      leave_type,
      start_date,
      end_date,
      leave_hours,
      reason,
      status
    } = req.body;

    // Basic validation
    if (!employee_name || !department || !leave_type || !start_date || !end_date) {
      return res.status(400).json({ error: "All required fields must be provided." });
    }

    const query = `
      INSERT INTO leaves (
        employee_name,
        department,
        leave_type,
        start_date,
        end_date,
        leave_hours,
        reason,
        status
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, COALESCE($8, 'Pending'))
      RETURNING *;
    `;

    const values = [
      employee_name,
      department,
      leave_type,
      start_date,
      end_date,
      leave_hours || null,
      reason || null,
      status
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
app.post("/salary-deduction", async (req, res) => {
  try {
    const { employeeId, leaveDuration, startDate, endDate } = req.body;

    // Fetch employee monthly salary from DB
    const result = await pool.query(
      "SELECT monthly_salary FROM employees WHERE id = $1",
      [employeeId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: "Employee not found" });
    }

    const monthlySalary = result.rows[0].salary;
    const workingDays = 22; // Avg working days in month
    const workingHoursPerDay = 8;

    // Calculate per day and per hour salary
    const perDaySalary = monthlySalary / workingDays;
    const perHourSalary = perDaySalary / workingHoursPerDay;

    let salaryDeduction = 0;

    if (leaveDuration.toLowerCase() === "hourly") {
      const hours =
        (new Date(endDate) - new Date(startDate)) / (1000 * 60 * 60);
      salaryDeduction = hours * perHourSalary;
    } else if (leaveDuration.toLowerCase() === "halfday") {
      salaryDeduction = perDaySalary / 2;
    } else if (leaveDuration.toLowerCase() === "fullday") {
      const days =
        (new Date(endDate).setHours(0, 0, 0, 0) -
          new Date(startDate).setHours(0, 0, 0, 0)) /
          (1000 * 60 * 60 * 24) +
        1;
      salaryDeduction = days * perDaySalary;
    }

    res.json({
      employeeId,
      monthlySalary,
      leaveDuration,
      startDate,
      endDate,
      salaryDeduction: salaryDeduction.toFixed(2),
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Error calculating salary deduction" });
  }
});

app.listen(3000, () => {
  console.log("Server running on port 3000");
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


module.exports = router;
