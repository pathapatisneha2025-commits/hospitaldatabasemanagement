const express = require("express");
const pool = require("../../db");

const router = express.Router();

let invoiceCounter = 1;

/* =========================================================
   🔢 Helper: Generate Unique Invoice Number
========================================================= */
function generateInvoiceNo() {
  const today = new Date();
  const yyyy = today.getFullYear();
  const mm = String(today.getMonth() + 1).padStart(2, "0");
  const dd = String(today.getDate()).padStart(2, "0");
  const datePart = `${yyyy}${mm}${dd}`;
  const counterPart = String(invoiceCounter).padStart(3, "0");
  invoiceCounter++;
  return `INV${datePart}-${counterPart}`;
}

/* =========================================================
   🧾 1️⃣ GENERATE INVOICE (POST)
   Combines all invoice + items into a single table
========================================================= */
router.post("/generate", async (req, res) => {
  try {
    const { employeeId, patientName, patientAge, patientPhone, paymentMode } = req.body;

    if (!employeeId) {
      return res.status(400).json({ success: false, message: "Employee ID is required" });
    }

    // Fetch full employee name
    const empResult = await pool.query(
      "SELECT full_name FROM employees WHERE id = $1",
      [employeeId]
    );
    const employeeName = empResult.rows[0]?.full_name || "Unknown";

    // Fetch cart items
    const cartResult = await pool.query(
      `SELECT id, name, quantity, price FROM cart WHERE employeeid = $1`,
      [employeeId]
    );

    if (cartResult.rowCount === 0) {
      return res.status(404).json({ success: false, message: "No items found in cart" });
    }

    const medicines = cartResult.rows.map((item) => ({
      name: item.name,
      quantity: item.quantity,
      unitPrice: parseFloat(item.price),
      total: parseFloat(item.price) * item.quantity,
    }));

    const totalAmount = medicines.reduce((sum, med) => sum + med.total, 0);
    const invoiceNo = generateInvoiceNo();

    // Convert medicines to JSON string for single-table storage
    const medicinesJSON = JSON.stringify(medicines);

    // Save invoice with embedded medicine list
    const insertInvoice = await pool.query(
      `INSERT INTO invoices 
       (invoice_no, employee_id, employee_name, patient_name, patient_age, patient_phone, 
        medicines, total_amount, payment_mode, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW() AT TIME ZONE 'Asia/Kolkata')
       RETURNING *`,
      [
        invoiceNo,
        employeeId,
        employeeName,
        patientName,
        patientAge,
        patientPhone,
        medicinesJSON,
        totalAmount,
        paymentMode,
      ]
    );

    // Optional: Clear employee's cart after generating invoice
    await pool.query("DELETE FROM cart WHERE employeeid = $1", [employeeId]);

    res.json({
      success: true,
      message: "Invoice generated successfully",
      data: {
        ...insertInvoice.rows[0],
        medicines: medicines,
      },
    });
  } catch (error) {
    console.error("Invoice generation error:", error.message);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

/* =========================================================
   2️⃣ GET ALL INVOICES
========================================================= */
router.get("/all", async (req, res) => {
  try {
    const result = await pool.query(`SELECT * FROM invoices ORDER BY created_at DESC`);
    const data = result.rows.map((row) => ({
      ...row,
      medicines: JSON.parse(row.medicines || "[]"),
    }));
    res.json({ success: true, count: result.rowCount, data });
  } catch (error) {
    console.error("Fetch invoices error:", error.message);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

/* =========================================================
   3️⃣ GET SINGLE INVOICE BY INVOICE NO
========================================================= */
router.get("/:invoiceNo", async (req, res) => {
  try {
    const { invoiceNo } = req.params;

    const result = await pool.query(
      `SELECT * FROM invoices WHERE invoice_no = $1`,
      [invoiceNo]
    );

    if (result.rowCount === 0)
      return res.status(404).json({ success: false, message: "Invoice not found" });

    const invoice = result.rows[0];
    invoice.medicines = JSON.parse(invoice.medicines || "[]");

    res.json({ success: true, data: invoice });
  } catch (error) {
    console.error("Fetch single invoice error:", error.message);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

/* =========================================================
   4️⃣ UPDATE PATIENT DETAILS / PAYMENT MODE
========================================================= */
router.put("/:invoiceNo", async (req, res) => {
  try {
    const { invoiceNo } = req.params;
    const { patientName, patientAge, patientPhone, paymentMode } = req.body;

    const result = await pool.query(
      `UPDATE invoices
       SET patient_name = COALESCE($1, patient_name),
           patient_age = COALESCE($2, patient_age),
           patient_phone = COALESCE($3, patient_phone),
           payment_mode = COALESCE($4, payment_mode)
       WHERE invoice_no = $5
       RETURNING *`,
      [patientName, patientAge, patientPhone, paymentMode, invoiceNo]
    );

    if (result.rowCount === 0)
      return res.status(404).json({ success: false, message: "Invoice not found" });

    const updatedInvoice = result.rows[0];
    updatedInvoice.medicines = JSON.parse(updatedInvoice.medicines || "[]");

    res.json({
      success: true,
      message: "Invoice updated successfully",
      data: updatedInvoice,
    });
  } catch (error) {
    console.error("Update invoice error:", error.message);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

/* =========================================================
   5️⃣ DELETE INVOICE
========================================================= */
router.delete("/:invoiceNo", async (req, res) => {
  try {
    const { invoiceNo } = req.params;

    const result = await pool.query(`DELETE FROM invoices WHERE invoice_no = $1 RETURNING *`, [
      invoiceNo,
    ]);

    if (result.rowCount === 0)
      return res.status(404).json({ success: false, message: "Invoice not found" });

    res.json({ success: true, message: "Invoice deleted successfully" });
  } catch (error) {
    console.error("Delete invoice error:", error.message);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

module.exports = router;
