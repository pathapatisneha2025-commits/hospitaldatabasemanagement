const express = require('express');
const router = express.Router();
const pool = require("../../db"); // Adjust path as needed

// -------------------- HELPER FUNCTION --------------------
function generateOrderNo() {
    return Math.floor(100000 + Math.random() * 900000); // generates 6-digit random number
}

// -------------------- CREATE --------------------
router.post('/add', async (req, res) => {
    try {
        const {
            employee_name,
            employee_id,
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

        if (!employee_name || !employee_id || !employee_email || !expense_date || !amount) {
            return res.status(400).json({ success: false, message: "Required fields missing" });
        }

        const OrderNo = generateOrderNo(); // now this works

        const result = await pool.query(
            `INSERT INTO expenses 
            (employee_name, employee_id, employee_email, expense_date, amount, category, description, attachment, payment_method, status, payment_status, OrderNo, created_at)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,NOW())
            RETURNING *`,
            [employee_name, employee_id, employee_email, expense_date, amount, category, description, attachment, payment_method, status, payment_status, OrderNo]
        );

        res.status(201).json({ success: true, data: result.rows[0] });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: "Server error" });
    }
});

// ... rest of your GET, UPDATE, DELETE routes ...

module.exports = router;
