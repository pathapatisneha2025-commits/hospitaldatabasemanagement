const express = require('express');
const router = express.Router();
const pool = require("../../db"); // Adjust path if needed

// -------------------- HELPER FUNCTION --------------------
function generateOrderNo() {
    return Math.floor(100000 + Math.random() * 900000).toString(); // 6-digit string
}

// -------------------- ADD EXPENSE --------------------
router.post("/add", async (req, res) => {
    try {
        const {
            employee_name,
            employee_email,
            expense_date,
            amount,
            category,
            description,
            attachment,
            payment_method,
            status,
            payment_status
        } = req.body;

        // Validate required fields
        if (!employee_name || !employee_email || !expense_date || !amount) {
            return res.status(400).json({
                success: false,
                message: "Missing required fields: employee_name, employee_email, expense_date, amount"
            });
        }

        // Fetch employee_id from employees table
        const empResult = await pool.query(
            "SELECT id, email FROM employees WHERE email = $1",
            [employee_email]
        );

        if (empResult.rows.length === 0) {
            return res.status(404).json({ success: false, message: "Employee not found" });
        }

        const employee_id = empResult.rows[0].id;
        const employee_email_fetched = empResult.rows[0].email;

        // Generate OrderNo
        const OrderNo = generateOrderNo();

        // Insert into expenses table (do NOT include id; it auto-increments)
        const result = await pool.query(
            `INSERT INTO expenses
            (employee_name, employee_id, employee_email, expense_date, amount, category, description, attachment, payment_method, status, payment_status, orderno, created_at)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,NOW() AT TIME ZONE 'Asia/Kolkata')
            RETURNING *`,
            [
                employee_name,
                employee_id,
                employee_email_fetched,
                expense_date,
                amount,
                category || null,
                description || null,
                attachment || null,
                payment_method || null,
                status || "Pending",
                payment_status || "Unpaid",
                OrderNo
            ]
        );

        res.status(201).json({ success: true, data: result.rows[0] });

    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: "Server error", error: err.message });
    }
});



// -------------------- READ (ALL) --------------------
router.get("/all", async (req, res) => {
  try {
    const result = await pool.query("SELECT * FROM late_to_come ORDER BY late_date DESC");
    res.json({ success: true, data: result.rows });
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});



// -------------------- UPDATE --------------------
router.put("/update/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const { late_date, duration, reason, status, employee_name } = req.body;

    const result = await pool.query(
      `UPDATE late_to_come 
       SET late_date = $1, duration = $2, reason = $3, status = $4, employee_name = $5
       WHERE id = $6 RETURNING *`,
      [late_date, duration, reason, status, employee_name, id]
    );

    res.json({ success: true, data: result.rows[0] });
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// -------------------- DELETE --------------------
router.delete("/delete/:id", async (req, res) => {
  try {
    const { id } = req.params;
    await pool.query("DELETE FROM late_to_come WHERE id = $1", [id]);
    res.json({ success: true, message: "Record deleted successfully" });
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
