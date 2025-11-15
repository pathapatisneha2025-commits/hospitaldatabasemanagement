const express = require("express");
const router = express.Router();
const pool = require("../db");

// ==========================
// ✅ GET all allowance usage
// ==========================
router.get("/all", async (req, res) => {
  try {
    const usage = await pool.query(
      "SELECT * FROM employee_allowance_usage ORDER BY created_at DESC"
    );
    res.json(usage.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});



// ==========================
// ✅ POST new allowance usage
// ==========================
router.post("/add", async (req, res) => {
  try {
    const { emp_name, emp_email, department, description, amount } = req.body;

    // Validate required fields
    if (!emp_name || !emp_email || !department || !description) {
      return res.status(400).json({ message: "All fields are required" });
    }

    // If amount is not provided in body, fetch from employee_allowances
    let finalAmount = amount;
    if (!finalAmount) {
      const emp = await pool.query(
        "SELECT allowance_amount FROM employee_allowances WHERE emp_email = $1",
        [emp_email]
      );

      if (emp.rows.length === 0) {
        return res.status(404).json({ message: "Employee allowance not found" });
      }

      finalAmount = emp.rows[0].allowance_amount;
    }

    const newUsage = await pool.query(
      `INSERT INTO employee_allowance_usage 
        (emp_name, emp_email, department, description, amount)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [emp_name, emp_email, department, description, finalAmount]
    );

    res.json(newUsage.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});

router.get("/export", async (req, res) => {
  try {
    const rows = await pool.query(
      "SELECT * FROM employee_allowance_usage ORDER BY id DESC"
    );

    let csv = "S.No,Name,Department,Description,Amount,Date\n";

    rows.rows.forEach((r, idx) => {
      const d = new Date(r.created_at);

      const excelDate = `="${d.getFullYear()}-${String(
        d.getMonth() + 1
      ).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}"`;

      // Escape double-quotes in description
      const safeDescription = (r.description || "").replace(/"/g, '""');

      csv += `${idx + 1},"${r.emp_name}","${r.department}","${safeDescription}",${r.amount},${excelDate}\n`;
    });

    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader(
      "Content-Disposition",
      "attachment; filename=AllowanceUsage.csv"
    );

    return res.send("\uFEFF" + csv); // add BOM for Excel UTF-8
  } catch (err) {
    console.log(err);
    res.status(500).send("Failed to export CSV");
  }
});

// ==========================
// ✅ GET allowance usage by ID
// ==========================
router.get("/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const usage = await pool.query(
      "SELECT * FROM employee_allowance_usage WHERE id = $1",
      [id]
    );

    if (usage.rows.length === 0) {
      return res.status(404).json({ message: "Usage record not found" });
    }

    res.json(usage.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});

// ==========================
// ✅ PUT update allowance usage by ID
// ==========================
router.put("/update/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const { emp_name, emp_email, department, description, amount } = req.body;

    // Validate required fields
    if (!emp_name || !emp_email || !department || !description || amount === undefined) {
      return res.status(400).json({ message: "All fields are required" });
    }

    const updated = await pool.query(
      `UPDATE employee_allowance_usage 
       SET emp_name = $1, emp_email = $2, department = $3, description = $4, amount = $5
       WHERE id = $6
       RETURNING *`,
      [emp_name, emp_email, department, description, amount, id]
    );

    if (updated.rows.length === 0) {
      return res.status(404).json({ message: "Usage record not found" });
    }

    res.json(updated.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});


// ==========================
// ✅ DELETE allowance usage by ID
// ==========================
router.delete("/delete/:id", async (req, res) => {
  try {
    const { id } = req.params;

    const deleted = await pool.query(
      "DELETE FROM employee_allowance_usage WHERE id = $1 RETURNING *",
      [id]
    );

    if (deleted.rows.length === 0) {
      return res.status(404).json({ message: "Usage record not found" });
    }

    res.json({ message: "Usage record deleted", data: deleted.rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});



module.exports = router;
