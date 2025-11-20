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
    const usages = req.body; // now expecting an array

    if (!Array.isArray(usages) || usages.length === 0) {
      return res.status(400).json({ message: "No usage data provided" });
    }

    const insertedRows = [];
    for (const u of usages) {
      const { emp_name, emp_email, department, description, amount, amount_used } = u;

      if (!emp_name || !emp_email || !description || !amount_used) {
        return res.status(400).json({ message: "Required fields missing in one of the rows" });
      }

      const newUsage = await pool.query(
        `INSERT INTO employee_allowance_usage 
          (emp_name, emp_email, department, description, amount, amount_used)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
        [emp_name, emp_email, department || null, description, amount, amount_used]
      );

      insertedRows.push(newUsage.rows[0]);
    }

    res.json(insertedRows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});


// ==========================
// ✅ GET allowance usage export CSV
// ==========================
router.get("/export", async (req, res) => {
  try {
    const rows = await pool.query(
      "SELECT * FROM employee_allowance_usage ORDER BY id DESC"
    );

    let csv = "S.No,Name,Department,Description,Amount,AmountUsed,Date\n";

    rows.rows.forEach((r, idx) => {
      const d = new Date(r.created_at);
      const excelDate = `="${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}"`;
      const safeDescription = (r.description || "").replace(/"/g, '""');

      csv += `${idx + 1},"${r.emp_name}","${r.department}","${safeDescription}",${r.amount},${r.amount_used},${excelDate}\n`;
    });

    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader(
      "Content-Disposition",
      "attachment; filename=AllowanceUsage.csv"
    );

    return res.send("\uFEFF" + csv);
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
    const { emp_name, emp_email, department, description, amount, amount_used } = req.body;

    if (!emp_name || !emp_email || !department || !description || amount === undefined || amount_used == null) {
      return res.status(400).json({ message: "All fields are required" });
    }

    const updated = await pool.query(
      `UPDATE employee_allowance_usage
       SET emp_name = $1, emp_email = $2, department = $3, description = $4, amount = $5, amount_used = $6
       WHERE id = $7
       RETURNING *`,
      [emp_name, emp_email, department, description, amount, amount_used, id]
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
