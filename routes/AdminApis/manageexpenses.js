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

        if (!employee_name || !employee_email || !expense_date || !amount) {
            return res.status(400).json({ success: false, message: "Required fields missing" });
        }

        const empResult = await pool.query(
            'SELECT id, email FROM employees WHERE email = $1',
            [employee_email]
        );

        if (empResult.rows.length === 0) {
            return res.status(404).json({ success: false, message: "Employee not found" });
        }

        const employee_id = empResult.rows[0].id;
        const employee_email_fetched = empResult.rows[0].email;

        const OrderNo = generateOrderNo();

        const result = await pool.query(
            `INSERT INTO expenses 
            (employee_name, employee_id, employee_email, expense_date, amount, category, description, attachment, payment_method, status, payment_status, OrderNo, created_at)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,NOW())
            RETURNING *`,
            [employee_name, employee_id, employee_email_fetched, expense_date, amount, category, description, attachment, payment_method, status, payment_status, OrderNo]
        );

        res.status(201).json({ success: true, data: result.rows[0] });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: "Server error" });
    }
});

// -------------------- GET ALL EXPENSES --------------------
router.get('/all', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM expenses ORDER BY created_at DESC');
        res.status(200).json({ success: true, data: result.rows });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: "Server error" });
    }
});

// -------------------- GET SINGLE EXPENSE --------------------
router.get('/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const result = await pool.query('SELECT * FROM expenses WHERE id = $1', [id]);

        if (result.rows.length === 0) {
            return res.status(404).json({ success: false, message: "Expense not found" });
        }

        res.status(200).json({ success: true, data: result.rows[0] });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: "Server error" });
    }
});

// -------------------- UPDATE EXPENSE --------------------
router.put('/update/:id', async (req, res) => {
    try {
        const { id } = req.params;
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

        const expense = await pool.query('SELECT * FROM expenses WHERE id = $1', [id]);
        if (expense.rows.length === 0) {
            return res.status(404).json({ success: false, message: "Expense not found" });
        }

        const empResult = await pool.query(
            'SELECT id, email FROM employees WHERE email = $1',
            [employee_email]
        );

        if (empResult.rows.length === 0) {
            return res.status(404).json({ success: false, message: "Employee not found" });
        }

        const employee_id = empResult.rows[0].id;

        const result = await pool.query(
            `UPDATE expenses SET 
                employee_name=$1, employee_id=$2, employee_email=$3, expense_date=$4, amount=$5, category=$6, 
                description=$7, attachment=$8, payment_method=$9, status=$10, payment_status=$11, updated_at=NOW()
             WHERE id=$12 RETURNING *`,
            [employee_name, employee_id, employee_email, expense_date, amount, category, description, attachment, payment_method, status, payment_status, id]
        );

        res.status(200).json({ success: true, data: result.rows[0] });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: "Server error" });
    }
});

// -------------------- DELETE EXPENSE --------------------
router.delete('/delete/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const expense = await pool.query('SELECT * FROM expenses WHERE id = $1', [id]);

        if (expense.rows.length === 0) {
            return res.status(404).json({ success: false, message: "Expense not found" });
        }

        await pool.query('DELETE FROM expenses WHERE id = $1', [id]);
        res.status(200).json({ success: true, message: "Expense deleted successfully" });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: "Server error" });
    }
});

module.exports = router;
