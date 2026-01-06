const express = require("express");
const router = express.Router();
const pool = require("../db");


// ✅ CREATE department limit
router.post("/add", async (req, res) => {
  try {
    const { department, maxLeavesPerDay, maxBreaksPerDay } = req.body;

    if (
      !department ||
      maxLeavesPerDay === undefined ||
      maxBreaksPerDay === undefined
    ) {
      return res.status(400).json({ message: "Invalid data" });
    }

    const query = `
      INSERT INTO departments_leave_limit 
        (department, max_leaves_per_day, max_breaks_per_day)
      VALUES ($1, $2, $3)
      RETURNING *;
    `;

    const result = await pool.query(query, [
      department.trim(),
      maxLeavesPerDay,
      maxBreaksPerDay,
    ]);

    res.json(result.rows[0]);
  } catch (err) {
    if (err.code === "23505") {
      return res.status(409).json({ message: "Department already exists" });
    }
    console.error(err);
    res.status(500).json({ message: "Server error" });
  }
});



// ✅ UPDATE department limit
router.put("/update/:department", async (req, res) => {
  try {
    const { department } = req.params;
    const { maxLeavesPerDay, maxBreaksPerDay } = req.body;

    if (
      maxLeavesPerDay === undefined &&
      maxBreaksPerDay === undefined
    ) {
      return res.status(400).json({ message: "Nothing to update" });
    }

    const query = `
      UPDATE departments_leave_limit
      SET 
        max_leaves_per_day = COALESCE($1, max_leaves_per_day),
        max_breaks_per_day = COALESCE($2, max_breaks_per_day)
      WHERE department = $3
      RETURNING *;
    `;

    const result = await pool.query(query, [
      maxLeavesPerDay,
      maxBreaksPerDay,
      department,
    ]);

    if (result.rowCount === 0) {
      return res.status(404).json({ message: "Department not found" });
    }

    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error" });
  }
});




// ✅ DELETE department limit
router.delete("/delete/:department", async (req, res) => {
  try {
    const { department } = req.params;

    const result = await pool.query(
      "DELETE FROM departments_leave_limit WHERE department = $1 RETURNING *;",
      [department]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ message: "Department not found" });
    }

    res.json({ message: "Department deleted successfully" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error" });
  }
});



// ✅ GET all department limits
router.get("/all", async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT * FROM departments_leave_limit ORDER BY department"
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error" });
  }
});



// ✅ TODAY STATUS (Admin Dashboard)
router.get("/today-status", async (req, res) => {
  try {
    const query = `
      SELECT
        d.department,
        d.max_leaves_per_day,
        d.max_breaks_per_day,

        COUNT(l.id) FILTER (WHERE l.status='APPROVED') AS leaves_taken,
        COUNT(b.id) FILTER (WHERE b.status='APPROVED') AS breaks_taken

      FROM departments_leave_limit d

      LEFT JOIN leaves l
        ON d.department = l.department
        AND l.start_date::date = CURRENT_DATE

      LEFT JOIN breaks b
        ON d.department = b.department
        AND b.break_date::date = CURRENT_DATE

      GROUP BY 
        d.department, 
        d.max_leaves_per_day,
        d.max_breaks_per_day

      ORDER BY d.department;
    `;

    const result = await pool.query(query);

    const data = result.rows.map(r => ({
      department: r.department,

      maxLeavesPerDay: r.max_leaves_per_day,
      leavesTaken: Number(r.leaves_taken),
      leavesRemaining: r.max_leaves_per_day - Number(r.leaves_taken),

      maxBreaksPerDay: r.max_breaks_per_day,
      breaksTaken: Number(r.breaks_taken),
      breaksRemaining: r.max_breaks_per_day - Number(r.breaks_taken),
    }));

    res.json(data);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error" });
  }
});


module.exports = router;
