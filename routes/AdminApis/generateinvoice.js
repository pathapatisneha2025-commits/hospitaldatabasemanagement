const express = require("express");
const pool = require("../../db");

const router = express.Router();

function generateInvoiceNo() {
  const today = new Date();
  const yyyy = today.getFullYear();
  const mm = String(today.getMonth() + 1).padStart(2, "0");
  const dd = String(today.getDate()).padStart(2, "0");

  // timestamp + random to ensure uniqueness
  const uniquePart = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
  return `INV${yyyy}${mm}${dd}-${uniquePart}`;
}

/* =========================================================
    1️ GENERATE INVOICE (POST)
========================================================= */
router.post("/generate", async (req, res) => {
  try {
    const { employeeId, subadminId, patientName, patientAge, patientPhone, paymentMode } = req.body;

    if (!employeeId && !subadminId) {
      return res.status(400).json({ success: false, message: "Employee ID or Subadmin ID is required" });
    }

    // Determine the user type
    if (employeeId) {
      const empResult = await pool.query("SELECT full_name FROM employees WHERE id = $1", [employeeId]);
      userName = empResult.rows[0]?.full_name || "Unknown Employee";
      userId = employeeId;
    } else if (subadminId) {
      const subResult = await pool.query("SELECT name FROM subadmin WHERE id = $1", [subadminId]);
      userName = subResult.rows[0]?.name || "Unknown Subadmin";
      userId = subadminId;
    }

    // Fetch cart items (depending on type)
    const cartResult = await pool.query(
      `SELECT id, name, quantity, price FROM cart WHERE employeeid = $1 OR subadminid = $2`,
      [employeeId || null, subadminId || null]
    );

    if (cartResult.rowCount === 0) {
      return res.status(404).json({ success: false, message: "No items found in cart" });
    }

    const medicines = cartResult.rows.map(item => ({
      name: item.name,
      quantity: item.quantity,
      unitPrice: parseFloat(item.price),
      total: parseFloat(item.price) * item.quantity,
    }));

    const totalAmount = medicines.reduce((sum, med) => sum + med.total, 0);
    const invoiceNo = generateInvoiceNo();

    // Save invoice
    const insertInvoice = await pool.query(
      `INSERT INTO invoices 
       (invoice_no, employee_id, subadmin_id, employee_name, patient_name, patient_age, patient_phone, medicines, total_amount, payment_mode, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,NOW() AT TIME ZONE 'Asia/Kolkata')
       RETURNING *`,
      [
        invoiceNo,
        employeeId || null,
        subadminId || null,
        userName,
        patientName,
        patientAge,
        patientPhone,
        JSON.stringify(medicines),
        totalAmount,
        paymentMode,
      ]
    );

    // Clear cart
    await pool.query("DELETE FROM cart WHERE employeeid = $1 OR subadminid = $2", [employeeId || null, subadminId || null]);

    res.json({
      success: true,
      message: "Invoice generated successfully",
      data: { ...insertInvoice.rows[0], medicines },
    });
  } catch (error) {
    console.error("Invoice generation error:", error.message);
    res.status(500).json({ success: false, message: "Server error" });
  }
});


/* =========================================================
   2️ GET ALL INVOICES
========================================================= */
router.get("/all", async (req, res) => {
  try {
    const result = await pool.query(`SELECT * FROM invoices ORDER BY created_at DESC`);
    const data = result.rows.map((row) => ({
      ...row,
      medicines: typeof row.medicines === "string" ? JSON.parse(row.medicines) : (row.medicines || []),
    }));
    res.json({ success: true, count: result.rowCount, data });
  } catch (error) {
    console.error("Fetch invoices error:", error.message);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

/* =========================================================
   3️ GET SINGLE INVOICE BY ID
========================================================= */
router.get("/:id", async (req, res) => {
  try {
    const { id } = req.params;

    const result = await pool.query(
      `SELECT * FROM invoices WHERE id = $1`,
      [id]
    );

    if (result.rowCount === 0)
      return res.status(404).json({ success: false, message: "Invoice not found" });

    const invoice = result.rows[0];
    invoice.medicines = typeof invoice.medicines === "string" ? JSON.parse(invoice.medicines) : (invoice.medicines || []);

    res.json({ success: true, data: invoice });
  } catch (error) {
    console.error("Fetch invoice by ID error:", error.message);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

/* =========================================================
   4 DELETE INVOICE BY ID
========================================================= */
router.delete("/delete/:id", async (req, res) => {
  try {
    const { id } = req.params;

    const result = await pool.query(`DELETE FROM invoices WHERE id = $1 RETURNING *`, [id]);

    if (result.rowCount === 0)
      return res.status(404).json({ success: false, message: "Invoice not found" });

    res.json({ success: true, message: "Invoice deleted successfully" });
  } catch (error) {
    console.error("Delete invoice by ID error:", error.message);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

module.exports = router;
