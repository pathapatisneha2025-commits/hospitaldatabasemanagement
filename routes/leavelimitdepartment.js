const express = require("express");
const router = express.Router();
const pool = require("../db");

// ✅ Create / Update department limit
router.post("/department-limit", async (req, res) => {
  const { department, maxLeavesPerDay } = req.body;

  const query = `
    INSERT INTO departments_leave_limit (department, max_leaves_per_day)
    VALUES ($1, $2)
    ON CONFLICT (department)
    DO UPDATE SET max_leaves_per_day = $2
    RETURNING *;
  `;

  const result = await pool.query(query, [department, maxLeavesPerDay]);
  res.json(result.rows[0]);
});


// ✅ Get all department limits
router.get("/department-limits", async (req, res) => {
  const result = await pool.query(
    "SELECT * FROM departments_leave_limit ORDER BY department"
  );
  res.json(result.rows);
});


// ✅ Today status (admin view)
router.get("/today-status", async (req, res) => {
  const query = `
    SELECT
      d.department,
      d.max_leaves_per_day,
      COUNT(l.id) FILTER (WHERE l.status='APPROVED') AS taken
    FROM departments_leave_limit d
    LEFT JOIN leaves l
      ON d.department = l.department
      AND l.leave_date = CURRENT_DATE
    GROUP BY d.department, d.max_leaves_per_day
    ORDER BY d.department;
  `;

  const result = await pool.query(query);

  const data = result.rows.map(r => ({
    department: r.department,
    maxLeavesPerDay: r.max_leaves_per_day,
    taken: Number(r.taken),
    remaining: r.max_leaves_per_day - Number(r.taken),
  }));

  res.json(data);
});

module.exports = router;
