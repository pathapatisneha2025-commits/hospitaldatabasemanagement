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
    const { emp_id, emp_name, emp_email, department, description, amount_used } = req.body;

    if (!emp_name || !emp_email || !description || !amount_used || !emp_id) {
      return res.status(400).json({ message: "Required fields missing" });
    }

    // Convert description array to comma-separated string
    const descriptionStr = Array.isArray(description) ? description.join(", ") : description;

    // Ensure amount_used is processed as an array of numbers
    let amountUsedArray = [];

    if (Array.isArray(amount_used)) {
      amountUsedArray = amount_used.map(a => parseFloat(a) || 0);
    } else if (typeof amount_used === "string") {
      amountUsedArray = amount_used.split(",").map(a => parseFloat(a.trim()) || 0);
    } else {
      amountUsedArray = [parseFloat(amount_used) || 0];
    }

    // Sum total used
    const totalUsed = amountUsedArray.reduce((sum, val) => sum + val, 0);
    // Store as comma-separated string
    const amountUsedStr = amountUsedArray.join(", ");

    // Insert into database including emp_id
    const newUsage = await pool.query(
      `INSERT INTO employee_allowance_usage 
        (emp_id, emp_name, emp_email, department, description, amount, amount_used)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [emp_id, emp_name, emp_email, department || null, descriptionStr, totalUsed, amountUsedStr]
    );

    res.json(newUsage.rows[0]);
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
// ✅ GET allowance usage by Employee ID
// ==========================
router.get("/employee/:emp_id", async (req, res) => {
  try {
    const { emp_id } = req.params;

    // Check if emp_id is provided
    if (!emp_id) {
      return res.status(400).json({ message: "Employee ID is required" });
    }

    const usage = await pool.query(
      "SELECT * FROM employee_allowance_usage WHERE emp_id = $1 ORDER BY created_at DESC",
      [emp_id]
    );

    if (usage.rows.length === 0) {
      return res.status(404).json({ message: "No allowance usage found for this employee" });
    }

    res.json(usage.rows);
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
